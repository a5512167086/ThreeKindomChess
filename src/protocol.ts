// 前後端共用的連線訊息格式（Socket.IO 事件）
//
// 伺服器是唯一的權威：玩家只送「想走哪一步」，伺服器用 game.ts 檢查後
// 才廣播給整個房間；客戶端收到後用同一份 play() 套用，所以三邊棋局一定一致。

import type { Pos, Side } from "./rules";
import type { ClockView } from "./clock";

export const ROOM_SIZE = 3;
export const MAX_NAME_LENGTH = 12;
export const MAX_CHAT_LENGTH = 200;

export type MoveMsg = { pieceId: string; to: Pos };

export type ChatMessage = { id: number; from: Side; to: Side; text: string };

export type SeatInfo =
  | { kind: "human"; playerId: string; name: string; online: boolean }
  | { kind: "ai" };

export type RoomStatus = "waiting" | "playing" | "finished";

// 房間裡看到的 playerId 都是「公開代號」，不是拿來連線的身分，
// 所以就算被別人看到也沒辦法冒充
export type RoomView = {
  code: string;
  hostId: string;
  status: RoomStatus;
  members: { playerId: string; name: string; online: boolean }[];
  seats: Record<Side, SeatInfo> | null; // 開局後才有
  round: number; // 第幾局（再來一局時 +1）
};

export type AckResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export type Ack<T = object> = (res: AckResult<T>) => void;

export interface ClientToServerEvents {
  "room:create": (ack: Ack<{ code: string }>) => void;
  "room:join": (code: string, ack: Ack) => void;
  "room:leave": () => void;
  "room:start": (ack: Ack) => void; // 房主開局；空位由電腦補上
  "match:find": (ack: Ack) => void;
  "match:cancel": () => void;
  "game:move": (move: MoveMsg, ack: Ack) => void;
  "game:resync": () => void;
  "chat:send": (to: Side, text: string, ack: Ack) => void;
}

export interface ServerToClientEvents {
  "session:me": (playerId: string) => void; // 連上後第一個訊息：自己的公開代號
  "room:state": (room: RoomView | null) => void; // null = 不在任何房間
  "match:status": (waiting: number | null) => void; // 排隊人數；null = 沒在排隊
  // 整盤棋譜與目前時鐘（開局、重連時）
  "game:sync": (moves: MoveMsg[], clock: ClockView) => void;
  // 第 index 步（從 0 起算）與走完後的時鐘
  "game:move": (move: MoveMsg, index: number, clock: ClockView) => void;
  "chat:sync": (messages: ChatMessage[]) => void; // 自己看得到的全部訊息
  "chat:message": (message: ChatMessage) => void;
}

// 連線時帶的身分：playerId 存在瀏覽器裡，重新整理後還是同一個人。
// 已登入的話伺服器改用 cookie 裡的帳號，playerId 會被忽略。
export type HandshakeAuth = { playerId: string; name: string };

// ---- 帳號（HTTP：/auth/*）----

export type Plan = "monthly" | "yearly";
export const PLAN_NAMES: Record<Plan, string> = { monthly: "月訂閱", yearly: "年訂閱" };

// until 是訂閱到期時間（ISO 字串）
export type SubscriptionInfo = { plan: Plan; until: string };

// GET /auth/me 的回應：沒登入時 account 是 null；
// providers 是伺服器有設定好的登入方式（沒設定就不顯示按鈕）；
// fakeBilling 表示開發用的假訂閱按鈕可以用
export type LoginProvider = "google";
export type AccountInfo = {
  name: string;
  avatarUrl: string | null;
  subscription: SubscriptionInfo | null;
};
export type MeResponse = {
  account: AccountInfo | null;
  providers: LoginProvider[];
  fakeBilling: boolean;
};

// ---- 我的棋譜（HTTP：/api/*）----

export type DrawReason = "noMoves" | "repetition";

// 開局時坐在那一家的是誰
export type RecordSeat = { kind: "ai" } | { kind: "human"; name: string };

// 免費帳號每天能打開幾局棋譜；訂閱中不限
export type ReplayQuota = { subscribed: boolean; limit: number; usedToday: number };

export type GameSummary = {
  id: string;
  finishedAt: string;
  mySide: Side;
  seats: Record<Side, RecordSeat>;
  winner: Side | null;
  drawReason: DrawReason | null;
  moveCount: number;
  viewedToday: boolean; // 今天打開過的局，再看不扣次數
};

export type GameRecord = GameSummary & { celestial: boolean; moves: MoveMsg[] };

// GET /api/games
export type GamesResponse = { games: GameSummary[]; quota: ReplayQuota };
// POST /api/games/:id/open；次數用完時 status 429，回傳 { error: "quota", quota }
export type OpenGameResponse = { game: GameRecord; quota: ReplayQuota };
