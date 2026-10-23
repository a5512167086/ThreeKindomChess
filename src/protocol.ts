// 前後端共用的連線訊息格式（Socket.IO 事件）
//
// 伺服器是唯一的權威：玩家只送「想走哪一步」，伺服器用 game.ts 檢查後
// 才廣播給整個房間；客戶端收到後用同一份 play() 套用，所以三邊棋局一定一致。

import type { Pos, Side } from "./rules";
import type { ClockView } from "./clock";
import type { GameSetup, GameStep } from "./game";

export const ROOM_SIZE = 3;
export const MAX_NAME_LENGTH = 12;
export const MAX_CHAT_LENGTH = 200;

// 玩家送出的一步棋；廣播和棋譜裡的一步還可能是某一家超時
export type PlayMsg = { pieceId: string; to: Pos };
export type MoveMsg = GameStep;

export type ChatMessage = { id: number; from: Side; to: Side; text: string };

export type SeatInfo =
  // rating：積分對局才有（給大家看段位），其他對局是 null
  | { kind: "human"; playerId: string; name: string; online: boolean; rating: number | null }
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
  rated: boolean; // 積分配對開的房間：只算這一局，不能再來一局
  ratingChanges: Partial<Record<Side, RatingChange>> | null; // 積分對局結束、算完分之後才有
};

export type RatingChange = { before: number; after: number };

export type AckResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export type Ack<T = object> = (res: AckResult<T>) => void;

export interface ClientToServerEvents {
  "room:create": (ack: Ack<{ code: string }>) => void;
  "room:join": (code: string, ack: Ack) => void;
  "room:leave": () => void;
  "room:start": (ack: Ack) => void; // 房主開局；空位由電腦補上
  "match:find": (ack: Ack) => void;
  "match:cancel": () => void;
  "game:move": (move: PlayMsg, ack: Ack) => void;
  "game:resync": () => void;
  "chat:send": (to: Side, text: string, ack: Ack) => void;
}

export interface ServerToClientEvents {
  "session:me": (playerId: string) => void; // 連上後第一個訊息：自己的公開代號
  "room:state": (room: RoomView | null) => void; // null = 不在任何房間
  "match:status": (waiting: number | null) => void; // 積分配對排隊的人數；null = 沒在排隊
  // 整盤棋譜、目前時鐘與開局設定（開局、重連時）
  "game:sync": (moves: MoveMsg[], clock: ClockView, setup: GameSetup) => void;
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

// 金流：台灣玩家用藍新（台幣），海外用 PayPal（美金）。
// PayPal 台灣帳戶不能收台灣境內的款，所以不提供台幣的 PayPal。
// 每次付款買一期，付款成功就從目前的到期日往後延（不會自動扣款）
export type PaymentProvider = "newebpay" | "paypal";
export const PAYMENT_NAMES: Record<PaymentProvider, string> = {
  newebpay: "台灣：信用卡（藍新）",
  paypal: "海外：PayPal（美金）",
};
export const PLAN_PRICES: Record<PaymentProvider, { currency: "TWD" | "USD"; amounts: Record<Plan, string> }> = {
  newebpay: { currency: "TWD", amounts: { monthly: "199", yearly: "1990" } },
  paypal: { currency: "USD", amounts: { monthly: "6.49", yearly: "64.99" } },
};
export const formatPrice = (provider: PaymentProvider, plan: Plan) => {
  const { currency, amounts } = PLAN_PRICES[provider];
  return `${currency === "TWD" ? "NT$" : "US$"}${amounts[plan]}`;
};

// POST /api/billing/checkout { plan, provider } 的回應：
// PayPal 直接轉址；藍新要用表單 POST 到它的付款頁
export type CheckoutResponse =
  | { kind: "redirect"; url: string }
  | { kind: "form"; action: string; fields: Record<string, string> };

// GET /auth/me 的回應：沒登入時 account 是 null；
// providers 是伺服器有設定好的登入方式（沒設定就不顯示按鈕）；
// payments 是伺服器有設定好的金流；fakeBilling 表示開發用的假訂閱按鈕可以用
export type LoginProvider = "google";
export type AccountInfo = {
  name: string;
  avatarUrl: string | null;
  rating: number; // 積分（段位見 src/rank.ts）
  ratedGames: number;
  subscription: SubscriptionInfo | null;
};
export type MeResponse = {
  account: AccountInfo | null;
  providers: LoginProvider[];
  payments: PaymentProvider[];
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
  rating: RatingChange | null; // 積分對局才有：自己這局前後的積分
  local: boolean; // 單機對電腦的局
};

// POST /api/games/local：單機下完一局，登入的話把棋譜傳上來存。
// 伺服器會從頭重下一遍，棋步不合法或棋局沒結束就不存；勝負也由伺服器自己算
export type LocalGameUpload = {
  celestial: boolean;
  skyStart: number;
  moves: MoveMsg[];
  aiSides: Side[]; // 交給電腦的幾家，其他幾家都是自己
  startedAt: string; // ISO
};

export type GameRecord = GameSummary & GameSetup & { moves: MoveMsg[] };

// ---- 個人資料（HTTP：/api/profile）----

export type ProfileStats = {
  rated: { games: number; places: [number, number, number] }; // 積分局：第一、二、三名各幾次
  all: { games: number; wins: number; draws: number }; // 連線對局（含開房、電腦補位，不含單機）
};

// GET /api/profile
export type ProfileResponse = {
  name: string;
  avatarUrl: string | null;
  joinedAt: string; // ISO
  rating: number;
  ratedGames: number;
  subscription: SubscriptionInfo | null;
  stats: ProfileStats;
};
// POST /api/profile/name { name } → { name }（去掉前後空白、截到上限後的名字）

// GET /api/games
export type GamesResponse = { games: GameSummary[]; quota: ReplayQuota };
// POST /api/games/:id/open；次數用完時 status 429，回傳 { error: "quota", quota }
export type OpenGameResponse = { game: GameRecord; quota: ReplayQuota };
