// 訂閱狀態。目前還沒接金流，只有開發用的假訂閱（FAKE_BILLING=1 才能用）。
//
// 之後接金流時，在付款成功的通知（webhook）裡呼叫 grantSubscription，
// 把到期時間延後就好，其他地方都不用改。

import { eq } from "drizzle-orm";
import type { Db } from "./db";
import { subscriptions } from "./schema";
import type { Plan, SubscriptionInfo } from "../src/protocol";

const PLAN_MONTHS: Record<Plan, number> = { monthly: 1, yearly: 12 };

export const isPlan = (v: unknown): v is Plan =>
  typeof v === "string" && v in PLAN_MONTHS;

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

// 付款成功後設定訂閱到期時間
export async function grantSubscription(
  db: Db,
  userId: string,
  plan: Plan,
  until: Date,
  provider: string,
  providerRef: string | null = null
) {
  const values = { plan, provider, providerRef, currentPeriodEnd: until, updatedAt: new Date() };
  await db
    .insert(subscriptions)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: subscriptions.userId, set: values });
}

// 開發用：直接訂閱一期。還在訂閱中就從原本的到期日往後延
export async function fakeSubscribe(db: Db, userId: string, plan: Plan, now = new Date()) {
  const current = await subscriptionOf(db, userId, now);
  const from = current ? new Date(current.until) : now;
  await grantSubscription(db, userId, plan, addMonths(from, PLAN_MONTHS[plan]), "fake");
  return subscriptionOf(db, userId, now);
}

// 開發用：立刻結束訂閱
export async function cancelSubscription(db: Db, userId: string) {
  await db.delete(subscriptions).where(eq(subscriptions.userId, userId));
}
