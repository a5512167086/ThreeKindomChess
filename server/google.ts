// Google 登入（OpenID Connect 授權碼流程 + PKCE）
//
// 1. 把玩家導到 Google 選帳號，帶上 state、nonce 和 PKCE 的 code_challenge。
// 2. Google 把玩家導回 /auth/google/callback，網址裡帶一次性的授權碼（code）。
// 3. 伺服器拿授權碼和 client secret 直接向 Google 換 id_token。這是伺服器跟
//    Google 之間的 HTTPS 連線，所以只要檢查 iss / aud / exp / nonce 就能相信它。
//
// 只要 openid 和 profile（名字、頭像），不拿 email。

import { createHash, randomBytes } from "node:crypto";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const CLOCK_SKEW_S = 60;
const TIMEOUT_MS = 10_000;

type Fetch = typeof fetch;

export type GoogleConfig = { clientId: string; clientSecret: string };

// 一次登入嘗試要記住的亂數，存在 cookie 裡等 Google 導回來時比對
export type LoginAttempt = { state: string; verifier: string; nonce: string };

export type GoogleProfile = {
  sub: string; // Google 帳號的固定編號
  name: string | null;
  picture: string | null;
};

const random = () => randomBytes(32).toString("base64url");

export const newLoginAttempt = (): LoginAttempt => ({
  state: random(),
  verifier: random(),
  nonce: random(),
});

export const encodeAttempt = (a: LoginAttempt) =>
  [a.state, a.verifier, a.nonce].join(".");

export function decodeAttempt(value: string | undefined): LoginAttempt | null {
  const parts = value?.split(".") ?? [];
  if (parts.length !== 3 || parts.some((p) => !/^[\w-]{20,}$/.test(p))) return null;
  const [state, verifier, nonce] = parts;
  return { state, verifier, nonce };
}

export function googleAuthUrl(
  config: GoogleConfig,
  redirectUri: string,
  attempt: LoginAttempt
): string {
  const challenge = createHash("sha256").update(attempt.verifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile",
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${AUTH_URL}?${params}`;
}

// 用授權碼換 id_token 並檢查；成功回傳 Google 的帳號資料，失敗回傳 null
export async function finishGoogleLogin(
  config: GoogleConfig,
  redirectUri: string,
  code: string,
  attempt: LoginAttempt,
  fetchFn: Fetch = fetch
): Promise<GoogleProfile | null> {
  let idToken: unknown;
  try {
    const res = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: attempt.verifier,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    idToken = ((await res.json()) as { id_token?: unknown }).id_token;
  } catch {
    return null;
  }
  if (typeof idToken !== "string") return null;

  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString());
  } catch {
    return null;
  }

  const now = Date.now() / 1000;
  if (!ISSUERS.has(claims.iss as string)) return null;
  if (claims.aud !== config.clientId) return null;
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S < now) return null;
  if (claims.nonce !== attempt.nonce) return null;
  if (typeof claims.sub !== "string" || !claims.sub) return null;

  const picture = claims.picture;
  return {
    sub: claims.sub,
    name: typeof claims.name === "string" ? claims.name : null,
    picture: typeof picture === "string" && picture.startsWith("https://") ? picture : null,
  };
}
