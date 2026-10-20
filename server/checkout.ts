// 付款流程：開始付款（由 /api/billing/checkout 呼叫）和金流打回來的 /billing/* 路由
//
//   POST /billing/newebpay/notify  藍新的背景通知（伺服器對伺服器，正式付款以這個為準）
//   POST /billing/newebpay/return  付完款藍新把瀏覽器帶回來（也帶結果，本機開發收不到背景通知時靠這個）
//   GET  /billing/paypal/return    在 PayPal 同意付款後帶回來（?token=PayPal 訂單編號），在這裡請款
//   GET  /billing/paypal/cancel    在 PayPal 按取消
//
// 處理完把瀏覽器導回首頁並帶 ?billing=paid|pending|failed|cancelled。
// 這些路由不看登入 cookie：藍新靠簽章、PayPal 靠我們自己去它的 API 請款來確認。

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Db } from "./db";
import {
  amountMatches,
  createPayment,
  markFailed,
  markPaid,
  paymentById,
  paymentByRef,
  setPaymentRef,
} from "./billing";
import { readForm, redirect } from "./http";
import { type NewebPayConfig, checkoutForm, parseResult } from "./newebpay";
import { type PayPalConfig, createPayPal } from "./paypal";
import {
  type CheckoutResponse,
  type PaymentProvider,
  type Plan,
  PLAN_NAMES,
} from "../src/protocol";

export type CheckoutConfig = {
  publicOrigin: string;
  newebpay: NewebPayConfig | null;
  paypal: PayPalConfig | null;
};

type Outcome = "paid" | "pending" | "failed" | "cancelled";

export function createCheckout(db: Db, config: CheckoutConfig) {
  const { publicOrigin, newebpay } = config;
  const paypal = config.paypal && createPayPal(config.paypal);
  const providers: PaymentProvider[] = [
    ...(newebpay ? (["newebpay"] as const) : []),
    ...(paypal ? (["paypal"] as const) : []),
  ];
  const itemDesc = (plan: Plan) => `三國象棋 ${PLAN_NAMES[plan]}`;
  const back = (res: ServerResponse, outcome: Outcome) =>
    redirect(res, `${publicOrigin}/?billing=${outcome}`);

  // 開始付款；這個金流沒設定就回傳 null
  async function start(
    userId: string,
    plan: Plan,
    provider: PaymentProvider
  ): Promise<CheckoutResponse | null> {
    if (provider === "newebpay" && newebpay) {
      const payment = await createPayment(db, userId, plan, provider);
      const form = checkoutForm(newebpay, {
        orderNo: payment.id,
        amount: payment.amount,
        itemDesc: itemDesc(plan),
        notifyUrl: `${publicOrigin}/billing/newebpay/notify`,
        returnUrl: `${publicOrigin}/billing/newebpay/return`,
        clientBackUrl: `${publicOrigin}/?billing=cancelled`,
      });
      return { kind: "form", ...form };
    }
    if (provider === "paypal" && paypal) {
      const payment = await createPayment(db, userId, plan, provider);
      const order = await paypal.createOrder({
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        description: itemDesc(plan),
        returnUrl: `${publicOrigin}/billing/paypal/return`,
        cancelUrl: `${publicOrigin}/billing/paypal/cancel`,
      });
      await setPaymentRef(db, payment.id, order.orderId);
      return { kind: "redirect", url: order.approveUrl };
    }
    return null;
  }

  // 藍新的通知（背景和瀏覽器帶回來的格式一樣）
  async function settleNewebPay(req: IncomingMessage): Promise<Outcome | null> {
    const form = await readForm(req);
    const result = form && newebpay && parseResult(newebpay, form);
    if (!result) return null;
    const payment = await paymentById(db, result.orderNo);
    if (!payment || payment.provider !== "newebpay") return null;
    if (payment.status === "paid") return "paid";
    if (!result.success) {
      await markFailed(db, payment.id);
      return "failed";
    }
    if (!amountMatches(payment, result.amount, "TWD")) {
      console.error(`藍新訂單 ${payment.id} 金額不符：應為 ${payment.amount}，收到 ${result.amount}`);
      return "failed";
    }
    await markPaid(db, payment.id, result.tradeNo);
    return "paid";
  }

  async function settlePayPal(orderId: string): Promise<Outcome> {
    const payment = paypal && (await paymentByRef(db, "paypal", orderId));
    if (!paypal || !payment) return "failed";
    if (payment.status === "paid") return "paid";
    const capture = await paypal.captureOrder(orderId);
    if (capture.customId !== payment.id || !amountMatches(payment, capture.amount, capture.currency)) {
      console.error(`PayPal 訂單 ${orderId} 跟付款 ${payment.id} 對不上`, capture);
      return "failed";
    }
    // 少數情況 PayPal 會先保留款項審核（PENDING），這時先不給訂閱
    if (!capture.completed) return "pending";
    // 紀錄上留 PayPal 的 order id（不換成 capture id），重新整理導回頁時才找得到這筆
    await markPaid(db, payment.id, orderId);
    return "paid";
  }

  // 處理 /billing/* 的請求；不是這裡的路徑就回傳 false 交給別人
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", publicOrigin);
    if (!url.pathname.startsWith("/billing/")) return false;

    try {
      if (req.method === "POST" && url.pathname === "/billing/newebpay/notify") {
        const outcome = await settleNewebPay(req);
        res.writeHead(outcome ? 200 : 400).end(outcome ? "OK" : "bad request");
        return true;
      }
      if (req.method === "POST" && url.pathname === "/billing/newebpay/return") {
        back(res, (await settleNewebPay(req)) ?? "failed");
        return true;
      }
      if (req.method === "GET" && url.pathname === "/billing/paypal/return") {
        const orderId = url.searchParams.get("token");
        back(res, orderId ? await settlePayPal(orderId) : "failed");
        return true;
      }
      if (req.method === "GET" && url.pathname === "/billing/paypal/cancel") {
        const orderId = url.searchParams.get("token");
        const payment = orderId ? await paymentByRef(db, "paypal", orderId) : null;
        if (payment) await markFailed(db, payment.id);
        back(res, "cancelled");
        return true;
      }
      res.writeHead(404).end();
      return true;
    } catch (err) {
      console.error("付款處理失敗", err);
      if (!res.headersSent) {
        if (req.method === "GET" || url.pathname.endsWith("/return")) back(res, "failed");
        else res.writeHead(500).end();
      }
      return true;
    }
  }

  return { providers, start, handle };
}

export type Checkout = ReturnType<typeof createCheckout>;
