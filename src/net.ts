// 連線工具：玩家身分（存在瀏覽器）、帳號登入與 Socket.IO 連線

import { io, type Socket } from "socket.io-client";
import type {
  CheckoutResponse,
  ClientToServerEvents,
  GamesResponse,
  HandshakeAuth,
  LoginProvider,
  MeResponse,
  OpenGameResponse,
  PaymentProvider,
  Plan,
  ProfileResponse,
  ReplayQuota,
  ServerToClientEvents,
  SubscriptionInfo,
} from "./protocol";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const KEYS = {
  playerId: "tkc.playerId",
  name: "tkc.name",
  room: "tkc.activeRoom", // 目前所在的房號，重新整理後自動回去
};

// localStorage 在無痕或封鎖時可能讀不到，失敗就當作沒有
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 存不了就算了，只是重新整理後不會記得
  }
}

const randomId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function playerId(): string {
  let id = read(KEYS.playerId);
  if (!id) {
    id = randomId();
    write(KEYS.playerId, id);
  }
  return id;
}

export const savedName = () => read(KEYS.name) ?? "";
export const saveName = (name: string) => write(KEYS.name, name);

export const savedRoom = () => read(KEYS.room);
export const saveRoom = (code: string | null) => write(KEYS.room, code);

// ---- 帳號（登入狀態存在 cookie，由伺服器管理）----

// 點了就整頁導去登入，登入完會回到首頁
export const loginUrl = (provider: LoginProvider) => `/auth/${provider}`;

// 伺服器沒開的話回傳 null
export async function fetchMe(): Promise<MeResponse | null> {
  try {
    const res = await fetch("/auth/me", { credentials: "same-origin" });
    return res.ok ? ((await res.json()) as MeResponse) : null;
  } catch {
    return null;
  }
}

export async function logout(): Promise<boolean> {
  try {
    const res = await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
    return res.ok;
  } catch {
    return false;
  }
}

// ---- 我的棋譜與訂閱（要登入）----

async function post<T>(path: string, body?: unknown): Promise<{ status: number; data: T | null }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return { status: res.status, data: (await res.json()) as T };
  } catch {
    return { status: 0, data: null };
  }
}

export async function fetchGames(): Promise<GamesResponse | null> {
  try {
    const res = await fetch("/api/games", { credentials: "same-origin" });
    return res.ok ? ((await res.json()) as GamesResponse) : null;
  } catch {
    return null;
  }
}

// 打開一局：成功、今天次數用完、或其他錯誤
export async function openGame(
  id: string
): Promise<
  | ({ kind: "ok" } & OpenGameResponse)
  | { kind: "quota"; quota: ReplayQuota }
  | { kind: "error" }
> {
  const { status, data } = await post<OpenGameResponse & { quota: ReplayQuota }>(
    `/api/games/${encodeURIComponent(id)}/open`
  );
  if (status === 200 && data) return { kind: "ok", ...data };
  if (status === 429 && data) return { kind: "quota", quota: data.quota };
  return { kind: "error" };
}

// 開始付款：成功就離開這個網站去付款頁（藍新用表單 POST、PayPal 直接轉址）；失敗回傳 false
export async function checkout(plan: Plan, provider: PaymentProvider): Promise<boolean> {
  const { status, data } = await post<CheckoutResponse>("/api/billing/checkout", { plan, provider });
  if (status !== 200 || !data) return false;
  if (data.kind === "redirect") {
    location.assign(data.url);
    return true;
  }
  const form = document.createElement("form");
  form.method = "POST";
  form.action = data.action;
  for (const [name, value] of Object.entries(data.fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
  return true;
}

// 開發用的假訂閱；失敗回傳 undefined
export async function fakeSubscribe(plan: Plan): Promise<SubscriptionInfo | null | undefined> {
  const { status, data } = await post<{ subscription: SubscriptionInfo | null }>(
    "/api/billing/fake/subscribe",
    { plan }
  );
  return status === 200 && data ? data.subscription : undefined;
}

export async function fakeCancel(): Promise<boolean> {
  return (await post("/api/billing/fake/cancel")).status === 200;
}

// 連到同一個網址的 /socket.io（開發時由 Vite 轉給伺服器）
export function connect(name: string): GameSocket {
  const auth: HandshakeAuth = { playerId: playerId(), name };
  return io({ auth });
}

// ---- 個人資料（要登入）----

export async function fetchProfile(): Promise<ProfileResponse | null> {
  try {
    const res = await fetch("/api/profile", { credentials: "same-origin" });
    return res.ok ? ((await res.json()) as ProfileResponse) : null;
  } catch {
    return null;
  }
}

// 改帳號的暱稱；成功回傳存下來的名字
export async function renameMe(name: string): Promise<string | null> {
  const { status, data } = await post<{ name: string }>("/api/profile/name", { name });
  return status === 200 && data ? data.name : null;
}
