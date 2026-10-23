// 藍新金流 MPG（幕前支付）：把訂單加密成表單，讓瀏覽器 POST 到藍新的付款頁；
// 付完款藍新會打 NotifyURL（背景）並把瀏覽器帶回 ReturnURL，兩邊帶的 TradeInfo 一樣。
//
// TradeInfo = AES-256-CBC(參數字串, HashKey, HashIV) 轉 hex
// TradeSha  = SHA256("HashKey=...&" + TradeInfo + "&HashIV=...") 轉大寫

import { createCipheriv, createDecipheriv, createHash, timingSafeEqual } from "node:crypto";

export type NewebPayConfig = {
  merchantId: string;
  hashKey: string; // 32 字
  hashIV: string; // 16 字
  live: boolean; // false 用測試環境（ccore）
};

const VERSION = "2.3";
// 藍新的範例以 32 bytes 為一組補位（PKCS7），自己補才跟官方一致
const BLOCK = 32;

const gatewayUrl = (c: NewebPayConfig) =>
  `https://${c.live ? "core" : "ccore"}.newebpay.com/MPG/mpg_gateway`;

export function encrypt(c: NewebPayConfig, plain: string): string {
  const data = Buffer.from(plain, "utf8");
  const pad = BLOCK - (data.length % BLOCK);
  const cipher = createCipheriv("aes-256-cbc", c.hashKey, c.hashIV).setAutoPadding(false);
  const padded = Buffer.concat([data, Buffer.alloc(pad, pad)]);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("hex");
}

export function decrypt(c: NewebPayConfig, hex: string): string | null {
  try {
    const decipher = createDecipheriv("aes-256-cbc", c.hashKey, c.hashIV).setAutoPadding(false);
    const buf = Buffer.concat([decipher.update(hex, "hex"), decipher.final()]);
    const pad = buf[buf.length - 1];
    const padded = pad >= 1 && pad <= BLOCK && buf.subarray(buf.length - pad).every((b) => b === pad);
    return buf.subarray(0, padded ? buf.length - pad : buf.length).toString("utf8");
  } catch {
    return null;
  }
}

export const tradeSha = (c: NewebPayConfig, tradeInfo: string) =>
  createHash("sha256")
    .update(`HashKey=${c.hashKey}&${tradeInfo}&HashIV=${c.hashIV}`)
    .digest("hex")
    .toUpperCase();

export type NewebPayOrder = {
  orderNo: string;
  amount: string; // 台幣整數
  itemDesc: string; // 50 字以內
  notifyUrl: string;
  returnUrl: string;
  clientBackUrl: string; // 付款頁上「返回商店」
  now?: Date;
};

// 要 POST 到藍新的表單
export function checkoutForm(c: NewebPayConfig, order: NewebPayOrder) {
  const params = new URLSearchParams({
    MerchantID: c.merchantId,
    RespondType: "JSON",
    TimeStamp: String(Math.floor((order.now ?? new Date()).getTime() / 1000)),
    Version: VERSION,
    MerchantOrderNo: order.orderNo,
    Amt: order.amount,
    ItemDesc: order.itemDesc,
    NotifyURL: order.notifyUrl,
    ReturnURL: order.returnUrl,
    ClientBackURL: order.clientBackUrl,
    EmailModify: "1", // 我們沒有玩家的 email，讓他在付款頁自己填（收付款通知用）
    LoginType: "0",
    CREDIT: "1",
  });
  const tradeInfo = encrypt(c, params.toString());
  return {
    action: gatewayUrl(c),
    fields: {
      MerchantID: c.merchantId,
      TradeInfo: tradeInfo,
      TradeSha: tradeSha(c, tradeInfo),
      Version: VERSION,
    },
  };
}

export type NewebPayResult = {
  success: boolean;
  message: string;
  orderNo: string;
  amount: string;
  tradeNo: string;
};

// 讀 NotifyURL / ReturnURL 收到的表單；簽章不對或解不開回傳 null
export function parseResult(c: NewebPayConfig, form: URLSearchParams): NewebPayResult | null {
  const tradeInfo = form.get("TradeInfo");
  const sha = form.get("TradeSha");
  if (!tradeInfo || !sha) return null;
  const expected = Buffer.from(tradeSha(c, tradeInfo));
  const got = Buffer.from(sha.toUpperCase());
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;

  const text = decrypt(c, tradeInfo);
  if (!text) return null;
  try {
    const data = JSON.parse(text) as {
      Status?: string;
      Message?: string;
      Result?: { MerchantID?: string; MerchantOrderNo?: string; Amt?: number | string; TradeNo?: string };
    };
    const r = data.Result;
    if (!r || r.MerchantID !== c.merchantId || !r.MerchantOrderNo) return null;
    return {
      success: data.Status === "SUCCESS",
      message: data.Message ?? "",
      orderNo: r.MerchantOrderNo,
      amount: String(r.Amt ?? ""),
      tradeNo: r.TradeNo ?? "",
    };
  } catch {
    return null;
  }
}
