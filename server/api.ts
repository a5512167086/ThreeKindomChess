// 要登入才能用的 API（/api/*）
//
//   GET  /api/games                   我的棋譜列表與今天的觀看次數
//   POST /api/games/:id/open          打開一局（免費帳號會用掉一次）
//   GET  /api/profile                 個人資料：段位、戰績、帳號與訂閱
//   POST /api/profile/name            { name } 改暱稱
//   POST /api/billing/checkout        { plan, provider } 開始付款（見 server/checkout.ts）
//   POST /api/billing/fake/subscribe  開發用：{ plan } 直接訂閱一期
//   POST /api/billing/fake/cancel     開發用：立刻結束訂閱

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Db } from "./db";
import { accountFromCookie, renameAccount } from "./auth";
import { cancelSubscription, fakeSubscribe, isPaymentProvider, isPlan } from "./billing";
import type { Checkout } from "./checkout";
import { fromOwnSite, json, readJson } from "./http";
import { listGames, openGame, quotaOf, ratingOf, statsOf } from "./records";
import { subscriptionOf } from "./billing";
import { users } from "./schema";
import { eq } from "drizzle-orm";
import {
  type CheckoutResponse,
  type GamesResponse,
  type OpenGameResponse,
  type ProfileResponse,
  MAX_NAME_LENGTH,
} from "../src/protocol";

export type ApiConfig = { publicOrigin: string; fakeBilling: boolean; checkout: Checkout };

const OPEN_PATH = /^\/api\/games\/([^/]+)\/open$/;

export function createApiHandler(db: Db, config: ApiConfig) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", config.publicOrigin);
    if (!url.pathname.startsWith("/api/")) return false;

    try {
      const account = await accountFromCookie(db, req.headers.cookie);
      if (!account) {
        json(res, 401, { error: "login" });
        return true;
      }
      if (req.method !== "GET" && !fromOwnSite(req, config.publicOrigin)) {
        json(res, 403, { error: "forbidden" });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/games") {
        const body: GamesResponse = {
          games: await listGames(db, account.id),
          quota: await quotaOf(db, account.id),
        };
        json(res, 200, body);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/profile") {
        const [user] = await db
          .select({ createdAt: users.createdAt })
          .from(users)
          .where(eq(users.id, account.id))
          .limit(1);
        const rating = await ratingOf(db, account.id);
        const body: ProfileResponse = {
          name: account.name,
          avatarUrl: account.avatarUrl,
          joinedAt: (user?.createdAt ?? new Date()).toISOString(),
          rating: rating?.rating ?? 0,
          ratedGames: rating?.games ?? 0,
          subscription: await subscriptionOf(db, account.id),
          stats: await statsOf(db, account.id),
        };
        json(res, 200, body);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/profile/name") {
        const body = (await readJson(req)) as { name?: unknown } | null;
        const name = typeof body?.name === "string" ? body.name.trim().slice(0, MAX_NAME_LENGTH) : "";
        if (!name) {
          json(res, 400, { error: "empty name" });
          return true;
        }
        await renameAccount(db, account.id, name);
        json(res, 200, { name });
        return true;
      }

      const open = OPEN_PATH.exec(url.pathname);
      if (req.method === "POST" && open) {
        const result = await openGame(db, account.id, decodeURIComponent(open[1]));
        if (result.kind === "notFound") json(res, 404, { error: "not found" });
        else if (result.kind === "quota") json(res, 429, { error: "quota", quota: result.quota });
        else json(res, 200, { game: result.game, quota: result.quota } satisfies OpenGameResponse);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/billing/checkout") {
        const body = (await readJson(req)) as { plan?: unknown; provider?: unknown } | null;
        if (!isPlan(body?.plan) || !isPaymentProvider(body?.provider)) {
          json(res, 400, { error: "bad plan" });
          return true;
        }
        const checkout = await config.checkout.start(account.id, body.plan, body.provider);
        if (checkout) json(res, 200, checkout satisfies CheckoutResponse);
        else json(res, 400, { error: "provider unavailable" });
        return true;
      }

      if (config.fakeBilling && req.method === "POST") {
        if (url.pathname === "/api/billing/fake/subscribe") {
          const body = (await readJson(req)) as { plan?: unknown } | null;
          if (!isPlan(body?.plan)) {
            json(res, 400, { error: "bad plan" });
            return true;
          }
          json(res, 200, { subscription: await fakeSubscribe(db, account.id, body.plan) });
          return true;
        }
        if (url.pathname === "/api/billing/fake/cancel") {
          await cancelSubscription(db, account.id);
          json(res, 200, { subscription: null });
          return true;
        }
      }

      json(res, 404, { error: "not found" });
      return true;
    } catch (err) {
      console.error("API 處理失敗", err);
      if (!res.headersSent) json(res, 500, { error: "server error" });
      return true;
    }
  };
}
