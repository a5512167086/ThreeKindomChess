// 連線工具：玩家身分（存在瀏覽器）與 Socket.IO 連線

import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  HandshakeAuth,
  ServerToClientEvents,
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

// 連到同一個網址的 /socket.io（開發時由 Vite 轉給伺服器）
export function connect(name: string): GameSocket {
  const auth: HandshakeAuth = { playerId: playerId(), name };
  return io({ auth });
}
