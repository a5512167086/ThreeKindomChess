// 計時：局時（純函式，前後端共用）
//
// 每人有一筆局時，輪到自己時才扣；局時用完就出局（game.ts 的 timeout）。

import type { Side } from "./rules";
import { TURN_ORDER } from "./game";

export const MAIN_TIME_MS = 20 * 60_000; // 局時 20 分鐘

export type Clock = {
  main: Record<Side, number>; // 各家剩下的局時（不含這一步正在用的）
  startedAt: number; // 這一步開始的時間（Date.now()）
  pausedAt: number | null; // 暫停的時間點（單機回放時暫停）
};

// 連線時傳的格式：用「這一步已經用了多久」代替時間點，避開兩台電腦的時差
export type ClockView = { main: Record<Side, number>; elapsed: number };

export const newClock = (now: number): Clock => ({
  main: Object.fromEntries(TURN_ORDER.map((s) => [s, MAIN_TIME_MS])) as Record<
    Side,
    number
  >,
  startedAt: now,
  pausedAt: null,
});

const elapsed = (c: Clock, now: number) =>
  Math.max(0, (c.pausedAt ?? now) - c.startedAt);

// 走完一步：扣掉這一步用掉的局時（最少扣到 0），下一步從現在開始算
export const afterMove = (c: Clock, mover: Side, now: number): Clock => ({
  ...c,
  main: { ...c.main, [mover]: Math.max(0, c.main[mover] - elapsed(c, now)) },
  startedAt: now,
});

// 某一家目前剩下的局時
export const timeLeft = (c: Clock, side: Side, turn: Side | null, now: number) =>
  Math.max(0, c.main[side] - (side === turn ? elapsed(c, now) : 0));

// 輪到 side 時，過了這個時間點就超時
export const deadline = (c: Clock, side: Side) => c.startedAt + c.main[side];

export const pauseClock = (c: Clock, now: number): Clock =>
  c.pausedAt === null ? { ...c, pausedAt: now } : c;

export const resumeClock = (c: Clock, now: number): Clock =>
  c.pausedAt === null
    ? c
    : { ...c, startedAt: c.startedAt + (now - c.pausedAt), pausedAt: null };

export const toClockView = (c: Clock, now: number): ClockView => ({
  main: c.main,
  elapsed: elapsed(c, now),
});

export const fromClockView = (v: ClockView, now: number): Clock => ({
  main: v.main,
  startedAt: now - v.elapsed,
  pausedAt: null,
});

// 顯示成 分:秒（無條件進位到秒，剩 0.3 秒時還顯示 0:01）
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
