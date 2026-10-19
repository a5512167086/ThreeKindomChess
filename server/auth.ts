// 帳號與登入：登入憑證（cookie）、建立帳號、/auth/* 的 HTTP 路由
//
//   GET  /auth/me               目前登入的帳號與可用的登入方式
//   POST /auth/logout           登出
//   GET  /auth/google           導到 Google 登入
//   GET  /auth/google/callback  Google 導回來的地方

import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { and, eq, gt } from "drizzle-orm";
import type { Db } from "./db";
import { identities, sessions, users } from "./schema";
import {
  type GoogleConfig,
  decodeAttempt,
  encodeAttempt,
  finishGoogleLogin,
  googleAuthUrl,
  newLoginAttempt,
} from "./google";
import { type LoginProvider, type MeResponse, MAX_NAME_LENGTH } from "../src/protocol";

export type Account = { id: string; name: string; avatarUrl: string | null };

export type AuthConfig = {
  publicOrigin: string; // 玩家在瀏覽器網址列看到的網址，例如 http://localhost:5173
  google: GoogleConfig | null; // 沒設定就不能用 Google 登入
  fetch?: typeof fetch; // 測試時換成假的
};

const SESSION_COOKIE = "tkc_session";
const GOOGLE_COOKIE = "tkc_google";
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
const LOGIN_ATTEMPT_TTL_S = 10 * 60;

// ---- cookie ----

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header?.split(";") ?? []) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // 格式壞掉的 cookie 就略過
    }
  }
  return out;
}

function cookie(
  config: AuthConfig,
  name: string,
  value: string,
  { maxAge, path = "/" }: { maxAge: number; path?: string }
) {
  const secure = config.publicOrigin.startsWith("https:") ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

// ---- 帳號與登入憑證 ----

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function accountFromCookie(
  db: Db,
  cookieHeader: string | undefined
): Promise<Account | null> {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!token) return null;
  const rows = await db
    .select({ id: users.id, name: users.displayName, avatarUrl: users.avatarUrl })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

export async function renameAccount(db: Db, userId: string, name: string) {
  await db.update(users).set({ displayName: name }).where(eq(users.id, userId));
}

async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

// 用某種登入方式登入：第一次就建新帳號，之後找回同一個帳號
export async function signInWith(
  db: Db,
  provider: LoginProvider,
  providerUserId: string,
  profile: { name: string; avatarUrl: string | null }
): Promise<string> {
  const find = async () =>
    (
      await db
        .select({ userId: identities.userId })
        .from(identities)
        .where(
          and(eq(identities.provider, provider), eq(identities.providerUserId, providerUserId))
        )
        .limit(1)
    )[0]?.userId;

  const existing = await find();
  if (existing) {
    // 名字是玩家自己改的就不覆蓋，頭像跟著登入方式更新
    await db.update(users).set({ avatarUrl: profile.avatarUrl }).where(eq(users.id, existing));
    return existing;
  }

  const [user] = await db
    .insert(users)
    .values({ displayName: profile.name.slice(0, MAX_NAME_LENGTH), avatarUrl: profile.avatarUrl })
    .returning({ id: users.id });
  const linked = await db
    .insert(identities)
    .values({ provider, providerUserId, userId: user.id })
    .onConflictDoNothing()
    .returning({ userId: identities.userId });
  if (linked.length) return user.id;

  // 同時登入兩次、另一邊先建好了：刪掉這邊多建的帳號，用那邊的
  await db.delete(users).where(eq(users.id, user.id));
  const winner = await find();
  if (!winner) throw new Error("登入方式綁定失敗");
  return winner;
}

// ---- HTTP 路由 ----

function redirect(res: ServerResponse, location: string, cookies: string[] = []) {
  res.writeHead(302, { Location: location, "Set-Cookie": cookies, "Cache-Control": "no-store" });
  res.end();
}

function json(res: ServerResponse, status: number, body: unknown, cookies: string[] = []) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Set-Cookie": cookies,
  });
  res.end(JSON.stringify(body));
}

// 處理 /auth/* 的請求；不是這裡的路徑就回傳 false 交給別人
export function createAuthHandler(db: Db, config: AuthConfig) {
  const fetchFn = config.fetch ?? fetch;
  const googleRedirect = `${config.publicOrigin}/auth/google/callback`;
  const providers: LoginProvider[] = config.google ? ["google"] : [];
  const clearGoogleCookie = cookie(config, GOOGLE_COOKIE, "", { maxAge: 0, path: "/auth/google" });

  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", config.publicOrigin);
    if (!url.pathname.startsWith("/auth/")) return false;

    try {
      if (req.method === "GET" && url.pathname === "/auth/me") {
        const account = await accountFromCookie(db, req.headers.cookie);
        const body: MeResponse = {
          account: account && { name: account.name, avatarUrl: account.avatarUrl },
          providers,
        };
        json(res, 200, body);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/auth/logout") {
        // 只接受從自己網站送來的登出
        const origin = req.headers.origin;
        if (origin && origin !== config.publicOrigin) {
          json(res, 403, { error: "forbidden" });
          return true;
        }
        const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
        if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
        json(res, 200, { ok: true }, [cookie(config, SESSION_COOKIE, "", { maxAge: 0 })]);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/auth/google") {
        if (!config.google) {
          redirect(res, "/?login=unavailable");
          return true;
        }
        const attempt = newLoginAttempt();
        redirect(res, googleAuthUrl(config.google, googleRedirect, attempt), [
          cookie(config, GOOGLE_COOKIE, encodeAttempt(attempt), {
            maxAge: LOGIN_ATTEMPT_TTL_S,
            path: "/auth/google",
          }),
        ]);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/auth/google/callback") {
        const attempt = decodeAttempt(parseCookies(req.headers.cookie)[GOOGLE_COOKIE]);
        const code = url.searchParams.get("code");
        // 玩家在 Google 那邊按了取消
        if (url.searchParams.get("error")) {
          redirect(res, "/?login=cancelled", [clearGoogleCookie]);
          return true;
        }
        const profile =
          config.google && attempt && code && url.searchParams.get("state") === attempt.state
            ? await finishGoogleLogin(config.google, googleRedirect, code, attempt, fetchFn)
            : null;
        if (!profile) {
          redirect(res, "/?login=failed", [clearGoogleCookie]);
          return true;
        }
        const userId = await signInWith(db, "google", profile.sub, {
          name: profile.name ?? "Google 玩家",
          avatarUrl: profile.picture,
        });
        const token = await createSession(db, userId);
        redirect(res, "/", [
          clearGoogleCookie,
          cookie(config, SESSION_COOKIE, token, { maxAge: SESSION_TTL_MS / 1000 }),
        ]);
        return true;
      }

      json(res, 404, { error: "not found" });
      return true;
    } catch (err) {
      console.error("登入處理失敗", err);
      if (!res.headersSent) json(res, 500, { error: "server error" });
      return true;
    }
  };
}
