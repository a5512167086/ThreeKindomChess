// 訂閱狀態與付款紀錄。
//
// 每次付款買一期：先建一筆 pending 的付款，金流通知付款成功時呼叫 markPaid，
// 從目前的到期日（已過期就從現在）往後延一期。開發用的假訂閱（FAKE_BILLING=1）
// 跳過付款直接延期。

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "./db";
import { payments, subscriptions } from "./schema";
import { type PaymentProvider, type Plan, type SubscriptionInfo, PLAN_PRICES } from "../src/protocol";

const PLAN_MONTHS: Record<Plan, number> = { monthly: 1, yearly: 12 };

export type Payment = typeof payments.$inferSelect;

export const isPlan = (v: unknown): v is Plan =>
  typeof v === "string" && v in PLAN_MONTHS;

export const isPaymentProvider = (v: unknown): v is PaymentProvider =>
  typeof v === "string" && v in PLAN_PRICES;

function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

// 訂閱中就回傳方案與到期時間，沒訂閱或已過期回傳 null
export async function subscriptionOf(
  db: Db,
  userId: string,
  now = new Date()
): Promise<SubscriptionInfo | null> {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  if (!row || row.currentPeriodEnd <= now) return null;
  return { plan: row.plan, until: row.currentPeriodEnd.toISOString() };
}

// 延長一期：還在訂閱中就從原本的到期日往後延
async function extendSubscription(
  db: Db,
  userId: string,
  plan: Plan,
  provider: string,
  providerRef: string | null,
  now: Date
) {
  const current = await subscriptionOf(db, userId, now);
  const from = current ? new Date(current.until) : now;
  const values = {
    plan,
    provider,
    providerRef,
    currentPeriodEnd: addMonths(from, PLAN_MONTHS[plan]),
    updatedAt: now,
  };
  await db
    .insert(subscriptions)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: subscriptions.userId, set: values });
}

// ---- 付款 ----

// 訂單編號：只用英數字、30 字以內（藍新的 MerchantOrderNo 限制）
const newOrderId = () => `TK${Date.now().toString(36)}${randomBytes(6).toString("hex")}`.toUpperCase();

// 開始付款：照價目表建一筆 pending 的付款
export async function createPayment(
  db: Db,
  userId: string,
  plan: Plan,
  provider: PaymentProvider
): Promise<Payment> {
  const { currency, amounts } = PLAN_PRICES[provider];
  const [row] = await db
    .insert(payments)
    .values({ id: newOrderId(), userId, plan, provider, amount: amounts[plan], currency })
    .returning();
  return row;
}

export async function setPaymentRef(db: Db, id: string, providerRef: string) {
  await db.update(payments).set({ providerRef }).where(eq(payments.id, id));
}

export async function paymentById(db: Db, id: string): Promise<Payment | null> {
  const [row] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
  return row ?? null;
}

export async function paymentByRef(
  db: Db,
  provider: PaymentProvider,
  providerRef: string
): Promise<Payment | null> {
  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.provider, provider), eq(payments.providerRef, providerRef)))
    .limit(1);
  return row ?? null;
}

// 金流回報的金額跟訂單上的一樣才算數（"99" 和 "99.00" 視為相同）
export const amountMatches = (payment: Payment, amount: string, currency: string) =>
  currency.toUpperCase() === payment.currency &&
  Math.round(Number(amount) * 100) === Math.round(Number(payment.amount) * 100);

// 付款成功：第一次通知才延長訂閱，之後重複的通知不做事。
// 回傳 false 表示這筆已經處理過（或不存在）
export async function markPaid(
  db: Db,
  paymentId: string,
  providerRef: string,
  now = new Date()
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(payments)
      .set({ status: "paid", providerRef, paidAt: now })
      .where(and(eq(payments.id, paymentId), eq(payments.status, "pending")))
      .returning();
    if (!row) return false;
    await extendSubscription(tx, row.userId, row.plan, row.provider, providerRef, now);
    return true;
  });
}

// 金流說付款失敗；已經付款成功的不會被改回來
export async function markFailed(db: Db, paymentId: string) {
  await db
    .update(payments)
    .set({ status: "failed" })
    .where(and(eq(payments.id, paymentId), eq(payments.status, "pending")));
}

// ---- 開發用 ----

// 直接訂閱一期，不用付錢
export async function fakeSubscribe(db: Db, userId: string, plan: Plan, now = new Date()) {
  await extendSubscription(db, userId, plan, "fake", null, now);
  return subscriptionOf(db, userId, now);
}

// 立刻結束訂閱
export async function cancelSubscription(db: Db, userId: string) {
  await db.delete(subscriptions).where(eq(subscriptions.userId, userId));
}
