// 要登入才能用的 API（/api/*）
//
//   GET  /api/games                   我的棋譜列表與今天的觀看次數
//   POST /api/games/:id/open          打開一局（免費帳號會用掉一次）
//   POST /api/billing/fake/subscribe  開發用：{ plan } 直接訂閱一期
//   POST /api/billing/fake/cancel     開發用：立刻結束訂閱

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Db } from "./db";
import { accountFromCookie } from "./auth";
import { cancelSubscription, fakeSubscribe, isPlan } from "./billing";
import { fromOwnSite, json, readJson } from "./http";
import { listGames, openGame, quotaOf } from "./records";
import type { GamesResponse, OpenGameResponse } from "../src/protocol";

export type ApiConfig = { publicOrigin: string; fakeBilling: boolean };

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

      const open = OPEN_PATH.exec(url.pathname);
      if (req.method === "POST" && open) {
        const result = await openGame(db, account.id, decodeURIComponent(open[1]));
        if (result.kind === "notFound") json(res, 404, { error: "not found" });
        else if (result.kind === "quota") json(res, 429, { error: "quota", quota: result.quota });
        else json(res, 200, { game: result.game, quota: result.quota } satisfies OpenGameResponse);
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
