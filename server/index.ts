// 三國象棋連線伺服器：房間、自動配對、權威棋局、電腦補位、私聊轉發、帳號登入
//
// 開發時：yarn server（預設 3001 port），前端的 Vite 會把 /socket.io 和 /auth 轉過來。
// 設定放在專案根目錄的 .env（參考 .env.example）。

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { openDb } from "./db";
import { type Account, accountFromCookie, createAuthHandler, renameAccount } from "./auth";
import { createApiHandler } from "./api";
import { saveGame } from "./records";
import { type GameSetup, type GameState, TURN_ORDER, chatOpen, newGame, play } from "../src/game";
import { randomSkyStart } from "../src/sky";
import { chooseMove } from "../src/ai";
import {
  type Clock,
  afterMove,
  deadline,
  newClock,
  toClockView,
} from "../src/clock";
import type { Side } from "../src/rules";
import {
  type ChatMessage,
  type ClientToServerEvents,
  type HandshakeAuth,
  type MoveMsg,
  type RecordSeat,
  type RoomStatus,
  type RoomView,
  type SeatInfo,
  type ServerToClientEvents,
  MAX_CHAT_LENGTH,
  MAX_NAME_LENGTH,
  ROOM_SIZE,
} from "../src/protocol";

if (existsSync(".env")) process.loadEnvFile();

const PORT = Number(process.env.PORT ?? 3001);
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "http://localhost:5173";
const GOOGLE =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      }
    : null;
// 開發用：不付錢就能訂閱。正式上線絕對不要設
const FAKE_BILLING = process.env.FAKE_BILLING === "1";
const USER_PREFIX = "user:"; // 已登入玩家的 playerId 開頭，訪客不能用
const AI_DELAY_MS = 600; // 電腦每步之間的停頓
const WAITING_GRACE_MS = 30_000; // 還沒開局的房間，斷線多久就移出
const IDLE_ROOM_TTL_MS = 10 * 60_000; // 房間裡沒有真人在線多久就刪除

type SocketData = { account: Account | null };
type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

// id 是連線用的身分（訪客存在瀏覽器裡的代號，或 user:帳號編號），只有本人知道；
// publicId 是給房間裡其他人看的代號
type Player = {
  id: string;
  publicId: string;
  userId: string | null; // 有登入才有，棋譜存在這個帳號底下
  name: string;
  socketId: string | null;
  roomCode: string | null;
};

type Seat = { kind: "human"; playerId: string } | { kind: "ai" };

// 開局時坐在各家的人（中途離開由電腦接手，棋譜仍記在原本的人身上）
type RosterSeat = { name: string; userId: string | null } | null;

type Room = {
  code: string;
  hostId: string;
  memberIds: string[]; // 房裡的真人（最多 3 個）
  status: RoomStatus;
  round: number;
  seats: Record<Side, Seat> | null;
  roster: Record<Side, RosterSeat> | null;
  startedAt: Date | null;
  game: GameState | null;
  moves: MoveMsg[];
  chats: ChatMessage[];
  clock: Clock | null;
  aiTimer: NodeJS.Timeout | null;
  timeoutTimer: NodeJS.Timeout | null; // 輪到的人超時就代走一步
  idleTimer: NodeJS.Timeout | null;
};

const players = new Map<string, Player>();
const rooms = new Map<string, Room>();
const leaveTimers = new Map<string, NodeJS.Timeout>(); // playerId -> 斷線移出計時
let queue: string[] = []; // 自動配對排隊中的 playerId

const { db, label: dbLabel } = await openDb({
  url: process.env.DATABASE_URL,
  pgliteDir: process.env.PGLITE_DIR,
});
const handleAuth = createAuthHandler(db, {
  publicOrigin: PUBLIC_ORIGIN,
  google: GOOGLE,
  fakeBilling: FAKE_BILLING,
});
const handleApi = createApiHandler(db, { publicOrigin: PUBLIC_ORIGIN, fakeBilling: FAKE_BILLING });

const httpServer = createServer(async (req, res) => {
  if (await handleAuth(req, res)) return;
  if (await handleApi(req, res)) return;
  res.writeHead(404).end();
});
const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>(httpServer, {
  cors: { origin: PUBLIC_ORIGIN },
});

// 連線時用 cookie 找出登入的帳號。別的網站發起的連線不採用 cookie，只當訪客
io.use(async (socket, next) => {
  const origin = socket.handshake.headers.origin;
  try {
    socket.data.account =
      !origin || origin === PUBLIC_ORIGIN
        ? await accountFromCookie(db, socket.handshake.headers.cookie)
        : null;
    next();
  } catch (err) {
    console.error("讀取登入狀態失敗", err);
    next(new Error("伺服器錯誤"));
  }
});

// ---- 小工具 ----

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉容易看錯的 0/O/1/I
function newRoomCode(): string {
  for (;;) {
    let code = "";
    for (let i = 0; i < 5; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
    if (!rooms.has(code)) return code;
  }
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const cleanName = (name: unknown) =>
  (typeof name === "string" ? name.trim() : "").slice(0, MAX_NAME_LENGTH) ||
  "無名氏";

const isOnline = (playerId: string) => !!players.get(playerId)?.socketId;

const publicIdOf = (playerId: string) => players.get(playerId)?.publicId ?? "?";

const socketOf = (playerId: string): GameSocket | undefined => {
  const socketId = players.get(playerId)?.socketId;
  return socketId ? io.sockets.sockets.get(socketId) : undefined;
};

const seatOf = (room: Room, playerId: string): Side | null => {
  if (!room.seats) return null;
  return (
    TURN_ORDER.find((side) => {
      const seat = room.seats![side];
      return seat.kind === "human" && seat.playerId === playerId;
    }) ?? null
  );
};

function roomView(room: Room): RoomView {
  const seats = room.seats
    ? (Object.fromEntries(
        TURN_ORDER.map((side): [Side, SeatInfo] => {
          const seat = room.seats![side];
          return [
            side,
            seat.kind === "ai"
              ? { kind: "ai" }
              : {
                  kind: "human",
                  playerId: publicIdOf(seat.playerId),
                  name: players.get(seat.playerId)?.name ?? "?",
                  online: isOnline(seat.playerId),
                },
          ];
        })
      ) as Record<Side, SeatInfo>)
    : null;
  return {
    code: room.code,
    hostId: publicIdOf(room.hostId),
    status: room.status,
    round: room.round,
    members: room.memberIds.map((id) => ({
      playerId: publicIdOf(id),
      name: players.get(id)?.name ?? "?",
      online: isOnline(id),
    })),
    seats,
  };
}

const broadcastRoom = (room: Room) =>
  io.to(room.code).emit("room:state", roomView(room));

const visibleChats = (room: Room, side: Side | null) =>
  side ? room.chats.filter((m) => m.from === side || m.to === side) : [];

// 把某個玩家的連線帶進房間，並補上目前的棋局與聊天
function syncPlayer(room: Room, playerId: string) {
  const socket = socketOf(playerId);
  if (!socket) return;
  socket.join(room.code);
  socket.emit("room:state", roomView(room));
  if (room.game) {
    socket.emit("game:sync", room.moves, clockView(room), setupOf(room.game));
    socket.emit("chat:sync", visibleChats(room, seatOf(room, playerId)));
  }
}

// ---- 房間 ----

function createRoom(hostId: string): Room {
  const room: Room = {
    code: newRoomCode(),
    hostId,
    memberIds: [],
    status: "waiting",
    round: 0,
    seats: null,
    roster: null,
    startedAt: null,
    game: null,
    moves: [],
    chats: [],
    clock: null,
    aiTimer: null,
    timeoutTimer: null,
    idleTimer: null,
  };
  rooms.set(room.code, room);
  return room;
}

function addMember(room: Room, playerId: string) {
  const player = players.get(playerId)!;
  if (!room.memberIds.includes(playerId)) room.memberIds.push(playerId);
  player.roomCode = room.code;
  leaveQueue(playerId);
  syncPlayer(room, playerId);
  broadcastRoom(room);
}

function deleteRoom(room: Room) {
  if (room.aiTimer) clearTimeout(room.aiTimer);
  if (room.timeoutTimer) clearTimeout(room.timeoutTimer);
  if (room.idleTimer) clearTimeout(room.idleTimer);
  for (const id of room.memberIds) {
    const player = players.get(id);
    if (player?.roomCode === room.code) player.roomCode = null;
  }
  io.to(room.code).emit("room:state", null);
  io.in(room.code).socketsLeave(room.code);
  rooms.delete(room.code);
}

// 玩家離開房間；對局中離開的話由電腦接手他的座位
function removeMember(room: Room, playerId: string) {
  const timer = leaveTimers.get(playerId);
  if (timer) clearTimeout(timer);
  leaveTimers.delete(playerId);

  room.memberIds = room.memberIds.filter((id) => id !== playerId);
  const player = players.get(playerId);
  if (player) player.roomCode = null;
  const socket = socketOf(playerId);
  socket?.leave(room.code);
  socket?.emit("room:state", null);

  const side = seatOf(room, playerId);
  if (side && room.seats) room.seats[side] = { kind: "ai" };

  if (room.memberIds.length === 0) {
    deleteRoom(room);
    return;
  }
  if (room.hostId === playerId) room.hostId = room.memberIds[0];
  broadcastRoom(room);
  scheduleAi(room);
}

// 房裡沒有真人在線就開始倒數刪房；有人回來就取消
function updateIdle(room: Room) {
  const anyoneOnline = room.memberIds.some(isOnline);
  if (anyoneOnline && room.idleTimer) {
    clearTimeout(room.idleTimer);
    room.idleTimer = null;
  } else if (!anyoneOnline && !room.idleTimer) {
    room.idleTimer = setTimeout(() => deleteRoom(room), IDLE_ROOM_TTL_MS);
  }
}

// ---- 對局 ----

// 隨機分配座位，空位給電腦
function startGame(room: Room) {
  const sides = shuffle(TURN_ORDER);
  const seats = Object.fromEntries(
    sides.map((side, i): [Side, Seat] => [
      side,
      i < room.memberIds.length
        ? { kind: "human", playerId: room.memberIds[i] }
        : { kind: "ai" },
    ])
  ) as Record<Side, Seat>;

  room.seats = seats;
  room.roster = Object.fromEntries(
    TURN_ORDER.map((side): [Side, RosterSeat] => {
      const seat = seats[side];
      const player = seat.kind === "human" ? players.get(seat.playerId) : undefined;
      return [side, player ? { name: player.name, userId: player.userId } : null];
    })
  ) as Record<Side, RosterSeat>;
  room.startedAt = new Date();
  room.game = newGame({ skyStart: randomSkyStart() });
  room.moves = [];
  room.chats = [];
  room.clock = newClock(Date.now());
  room.status = "playing";
  room.round += 1;

  broadcastRoom(room);
  io.to(room.code).emit("game:sync", [], clockView(room), setupOf(room.game));
  io.to(room.code).emit("chat:sync", []);
  scheduleAi(room);
  scheduleTimeout(room);
}

function applyMove(room: Room, move: MoveMsg): boolean {
  const mover = room.game?.turn;
  if (!room.game || !room.clock || !mover || room.status !== "playing") {
    return false;
  }
  const next = play(room.game, move.pieceId, move.to);
  if (next === room.game) return false;

  room.game = next;
  room.moves.push(move);
  room.clock = afterMove(room.clock, mover, Date.now());
  io.to(room.code).emit("game:move", move, room.moves.length - 1, clockView(room));

  if (next.turn === null) {
    room.status = "finished";
    broadcastRoom(room);
    saveRecord(room);
  }
  scheduleAi(room);
  scheduleTimeout(room);
  return true;
}

// 對局結束：有登入玩家參加就把棋譜存進資料庫（存失敗不影響對局）
function saveRecord(room: Room) {
  const { game, roster, startedAt } = room;
  if (!game || !roster || !startedAt) return;
  const accounts = TURN_ORDER.flatMap((side) => {
    const userId = roster[side]?.userId;
    return userId ? [{ userId, side }] : [];
  });
  saveGame(db, {
    celestial: game.celestial,
    skyStart: game.skyStart,
    moves: [...room.moves],
    seats: Object.fromEntries(
      TURN_ORDER.map((side): [Side, RecordSeat] => {
        const seat = roster[side];
        return [side, seat ? { kind: "human", name: seat.name } : { kind: "ai" }];
      })
    ) as Record<Side, RecordSeat>,
    players: accounts,
    winner: game.winner,
    drawReason: game.drawReason,
    startedAt,
    finishedAt: new Date(),
  }).catch((err) => console.error(`房間 ${room.code} 的棋譜存檔失敗`, err));
}

// 客戶端重播要用的開局設定
const setupOf = (game: GameState): GameSetup => ({
  celestial: game.celestial,
  skyStart: game.skyStart,
});

const clockView = (room: Room) =>
  toClockView(room.clock ?? newClock(Date.now()), Date.now());

// 輪到的人局時加讀秒都用完：由電腦代走一步，下一步仍由他自己下
function scheduleTimeout(room: Room) {
  if (room.timeoutTimer) clearTimeout(room.timeoutTimer);
  room.timeoutTimer = null;
  const turn = room.game?.turn;
  if (room.status !== "playing" || !turn || !room.clock) return;
  const wait = Math.max(0, deadline(room.clock, turn) - Date.now());
  room.timeoutTimer = setTimeout(() => {
    room.timeoutTimer = null;
    if (!room.game) return;
    const move = chooseMove(room.game);
    if (move) applyMove(room, move);
  }, wait);
}

// 輪到電腦就排一步
function scheduleAi(room: Room) {
  if (room.aiTimer) clearTimeout(room.aiTimer);
  room.aiTimer = null;
  const turn = room.game?.turn;
  if (room.status !== "playing" || !turn || room.seats?.[turn].kind !== "ai") {
    return;
  }
  room.aiTimer = setTimeout(() => {
    room.aiTimer = null;
    if (!room.game) return;
    const move = chooseMove(room.game);
    if (move) applyMove(room, move);
  }, AI_DELAY_MS);
}

// ---- 自動配對 ----

function leaveQueue(playerId: string) {
  if (!queue.includes(playerId)) return;
  queue = queue.filter((id) => id !== playerId);
  socketOf(playerId)?.emit("match:status", null);
  announceQueue();
}

const announceQueue = () =>
  queue.forEach((id) => socketOf(id)?.emit("match:status", queue.length));

function tryMatch() {
  queue = queue.filter(isOnline);
  while (queue.length >= ROOM_SIZE) {
    const ids = queue.splice(0, ROOM_SIZE);
    const room = createRoom(ids[0]);
    for (const id of ids) {
      socketOf(id)?.emit("match:status", null);
      addMember(room, id);
    }
    startGame(room);
  }
  announceQueue();
}

// ---- 連線 ----

const isSide = (v: unknown): v is Side =>
  typeof v === "string" && (TURN_ORDER as string[]).includes(v);

const isMove = (v: unknown): v is MoveMsg => {
  const m = v as MoveMsg;
  return (
    !!m &&
    typeof m.pieceId === "string" &&
    !!m.to &&
    isSide(m.to.panel) &&
    Number.isInteger(m.to.row) &&
    Number.isInteger(m.to.col)
  );
};

io.on("connection", (socket: GameSocket) => {
  const auth = socket.handshake.auth as Partial<HandshakeAuth>;
  const account = socket.data.account;
  const guestId =
    typeof auth.playerId === "string" &&
    auth.playerId.length <= 64 &&
    !auth.playerId.startsWith(USER_PREFIX)
      ? auth.playerId
      : null;
  // 登入的話用帳號當身分，換電腦也是同一個人
  const playerId = account ? USER_PREFIX + account.id : guestId;
  if (!playerId) {
    socket.disconnect(true);
    return;
  }

  // 同一個玩家只保留最新的連線（例如開了兩個分頁）
  let player = players.get(playerId);
  if (player?.socketId && player.socketId !== socket.id) {
    io.sockets.sockets.get(player.socketId)?.disconnect(true);
  }
  if (!player) {
    player = {
      id: playerId,
      publicId: randomUUID(),
      userId: account?.id ?? null,
      name: "",
      socketId: null,
      roomCode: null,
    };
    players.set(playerId, player);
  }
  const me = player;
  me.name = cleanName(auth.name || account?.name);
  me.socketId = socket.id;
  // 在大廳改的暱稱存回帳號
  if (account && me.name !== account.name) {
    renameAccount(db, account.id, me.name).catch((err) =>
      console.error("儲存暱稱失敗", err)
    );
  }
  socket.emit("session:me", me.publicId);

  // 重新連線：回到原本的房間
  const timer = leaveTimers.get(playerId);
  if (timer) clearTimeout(timer);
  leaveTimers.delete(playerId);
  const current = me.roomCode ? rooms.get(me.roomCode) : undefined;
  if (current) {
    syncPlayer(current, playerId);
    broadcastRoom(current);
    updateIdle(current);
  } else {
    me.roomCode = null;
    socket.emit("room:state", null);
  }

  const myRoom = () => (me.roomCode ? rooms.get(me.roomCode) : undefined);

  socket.on("room:create", (ack) => {
    if (myRoom()) return ack({ ok: false, error: "你已經在房間裡了" });
    const room = createRoom(playerId);
    addMember(room, playerId);
    ack({ ok: true, code: room.code });
  });

  socket.on("room:join", (rawCode, ack) => {
    const code = String(rawCode ?? "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: "找不到這個房間" });
    const existing = myRoom();
    if (existing && existing !== room) {
      return ack({ ok: false, error: "你已經在別的房間裡了" });
    }
    if (!room.memberIds.includes(playerId)) {
      if (room.status !== "waiting") return ack({ ok: false, error: "這局已經開始了" });
      if (room.memberIds.length >= ROOM_SIZE) return ack({ ok: false, error: "房間已滿" });
    }
    addMember(room, playerId);
    ack({ ok: true });
  });

  socket.on("room:leave", () => {
    leaveQueue(playerId);
    const room = myRoom();
    if (room) removeMember(room, playerId);
  });

  socket.on("room:start", (ack) => {
    const room = myRoom();
    if (!room) return ack({ ok: false, error: "你不在房間裡" });
    if (room.hostId !== playerId) return ack({ ok: false, error: "只有房主可以開始" });
    if (room.status === "playing") return ack({ ok: false, error: "已經在對局中" });
    startGame(room);
    ack({ ok: true });
  });

  socket.on("match:find", (ack) => {
    if (myRoom()) return ack({ ok: false, error: "你已經在房間裡了" });
    if (!queue.includes(playerId)) queue.push(playerId);
    ack({ ok: true });
    tryMatch();
  });

  socket.on("match:cancel", () => leaveQueue(playerId));

  socket.on("game:move", (move, ack) => {
    const room = myRoom();
    if (!room?.game || room.status !== "playing") {
      return ack({ ok: false, error: "沒有進行中的對局" });
    }
    if (room.game.turn !== seatOf(room, playerId)) {
      return ack({ ok: false, error: "還沒輪到你" });
    }
    if (!isMove(move) || !applyMove(room, move)) {
      return ack({ ok: false, error: "這步不合法" });
    }
    ack({ ok: true });
  });

  socket.on("game:resync", () => {
    const room = myRoom();
    if (room?.game) socket.emit("game:sync", room.moves, clockView(room), setupOf(room.game));
  });

  socket.on("chat:send", (to, rawText, ack) => {
    const room = myRoom();
    const from = room ? seatOf(room, playerId) : null;
    if (!room?.game || !from) return ack({ ok: false, error: "沒有進行中的對局" });
    if (!isSide(to) || to === from) return ack({ ok: false, error: "對象不正確" });
    const text = String(rawText ?? "").trim().slice(0, MAX_CHAT_LENGTH);
    if (!text) return ack({ ok: false, error: "訊息是空的" });
    if (!chatOpen(room.game, from, to)) {
      return ack({ ok: false, error: "聊天室還沒接通" });
    }

    const message: ChatMessage = { id: room.chats.length, from, to, text };
    room.chats.push(message);
    for (const side of [from, to]) {
      const seat = room.seats?.[side];
      if (seat?.kind === "human") socketOf(seat.playerId)?.emit("chat:message", message);
    }
    ack({ ok: true });
  });

  socket.on("disconnect", () => {
    if (me.socketId !== socket.id) return; // 已被新的連線取代
    me.socketId = null;
    leaveQueue(playerId);

    const room = myRoom();
    if (!room) return;
    broadcastRoom(room);
    updateIdle(room);
    // 還沒開局就斷線：等一段時間沒回來就移出房間
    if (room.status === "waiting") {
      leaveTimers.set(
        playerId,
        setTimeout(() => {
          leaveTimers.delete(playerId);
          const r = myRoom();
          if (r && !isOnline(playerId)) removeMember(r, playerId);
        }, WAITING_GRACE_MS)
      );
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`三國象棋伺服器啟動：http://localhost:${PORT}`);
  console.log(`資料庫：${dbLabel}`);
  console.log(`Google 登入：${GOOGLE ? "已設定" : "未設定（.env 沒有 GOOGLE_CLIENT_ID / SECRET）"}`);
  if (FAKE_BILLING) console.log("假訂閱：開啟（只能在開發時用）");
});
