// 我的棋譜：對局結束時存檔、列出自己下過的局、打開一局（免費帳號每天有次數上限）

import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./db";
import { gamePlayers, games, replayViews, users } from "./schema";
import { subscriptionOf } from "./billing";
import type {
  DrawReason,
  GameRecord,
  GameSummary,
  LocalGameUpload,
  MoveMsg,
  PlayMsg,
  ProfileStats,
  RatingChange,
  RecordSeat,
  ReplayQuota,
} from "../src/protocol";
import type { Side } from "../src/rules";
import { TURN_ORDER, newGame, step } from "../src/game";
import { MANSIONS } from "../src/sky";
import { placements, rate } from "../src/rank";

export const FREE_REPLAYS_PER_DAY = 3;
const LIST_LIMIT = 100;
const MAX_LOCAL_MOVES = 3000; // 單機棋譜最多幾步，擋掉亂塞的資料
const MAX_LOCAL_AGE_MS = 24 * 60 * 60 * 1000; // 開局時間最早只認到一天前
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 次數以台灣時間的日期計算，午夜重置
const TAIPEI_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export const taipeiDay = (now: Date) => TAIPEI_DATE.format(now); // 例如 "2026-10-19"

export type FinishedGame = {
  celestial: boolean;
  skyStart: number;
  moves: MoveMsg[];
  seats: Record<Side, RecordSeat>;
  players: { userId: string; side: Side }[]; // 有登入的玩家
  places?: Partial<Record<Side, number>>; // 各家第幾名（1 起算）
  winner: Side | null;
  drawReason: DrawReason | null;
  startedAt: Date;
  finishedAt: Date;
  // 積分對局：名次（由好到壞，同組同名次）。三家都要是登入玩家
  rated?: { order: Side[][] };
  local?: boolean; // 單機對電腦的局
};

const isSide = (v: unknown): v is Side => TURN_ORDER.includes(v as Side);
const isIndex = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 16;
const isMove = (v: unknown): v is MoveMsg => {
  const m = v as Partial<PlayMsg & { timeout: unknown }> | null;
  if (m && "timeout" in m) return isSide(m.timeout);
  return (
    typeof m?.pieceId === "string" &&
    m.pieceId.length <= 32 &&
    isSide(m.to?.panel) &&
    isIndex(m.to.row) &&
    isIndex(m.to.col)
  );
};

// 只留需要的欄位；jsonb 存的時候也會重排物件的欄位順序，讀出來時排回原本的樣子
const cleanMove = (m: MoveMsg): MoveMsg =>
  "timeout" in m
    ? { timeout: m.timeout }
    : { pieceId: m.pieceId, to: { panel: m.to.panel, row: m.to.row, col: m.to.col } };

// 單機傳上來的棋譜：從頭重下一遍，每一步都要合法、最後要分出結果，才回傳要存的內容。
// 勝負、和局原因、名次都用重下的結果，不信任傳上來的
export function localGameFrom(
  body: unknown,
  user: { id: string; name: string },
  now = new Date()
): FinishedGame | null {
  const b = body as Partial<LocalGameUpload> | null;
  if (typeof b?.celestial !== "boolean") return null;
  if (!Number.isInteger(b.skyStart) || b.skyStart! < 0 || b.skyStart! >= MANSIONS.length) return null;
  if (!Array.isArray(b.moves) || b.moves.length > MAX_LOCAL_MOVES || !b.moves.every(isMove)) return null;
  if (!Array.isArray(b.aiSides) || !b.aiSides.every(isSide)) return null;

  const aiSides = new Set(b.aiSides);
  const humans = TURN_ORDER.filter((side) => !aiSides.has(side));
  if (!humans.length) return null; // 三家都是電腦就不算自己的棋譜

  let game = newGame({ celestial: b.celestial, skyStart: b.skyStart });
  try {
    for (const move of b.moves) {
      const next = step(game, move);
      if (next === game) return null;
      game = next;
    }
  } catch {
    return null; // 奇怪的座標之類的，當成不合法
  }
  if (game.turn !== null) return null;

  // 自己坐哪一家：有下紅方就是紅方（單機畫面的下方），不然是第一個自己下的
  const mySide = humans.includes("Center") ? "Center" : humans[0];
  const places: Partial<Record<Side, number>> = {};
  let ahead = 0;
  for (const group of placements(game)) {
    for (const side of group) places[side] = ahead + 1;
    ahead += group.length;
  }
  const started = new Date(typeof b.startedAt === "string" ? b.startedAt : NaN);
  const startedOk = started.getTime() <= now.getTime() && now.getTime() - started.getTime() <= MAX_LOCAL_AGE_MS;
  return {
    celestial: b.celestial,
    skyStart: b.skyStart!,
    moves: b.moves.map(cleanMove),
    seats: Object.fromEntries(
      TURN_ORDER.map((side): [Side, RecordSeat] => [
        side,
        aiSides.has(side) ? { kind: "ai" } : { kind: "human", name: user.name },
      ])
    ) as Record<Side, RecordSeat>,
    players: [{ userId: user.id, side: mySide }],
    places,
    winner: game.winner,
    drawReason: game.drawReason,
    startedAt: startedOk ? started : now,
    finishedAt: now,
    local: true,
  };
}

export type SavedGame = { id: string; ratings: Partial<Record<Side, RatingChange>> };

// 存一局；沒有登入玩家參加就不存，回傳 null。
// 積分對局在同一個交易裡算分，並鎖住三個帳號，避免同時結束的兩局互相蓋掉積分
export async function saveGame(db: Db, game: FinishedGame): Promise<SavedGame | null> {
  if (!game.players.length) return null;
  return db.transaction(async (tx) => {
    const ratings: Partial<Record<Side, RatingChange>> = {};
    if (game.rated) {
      const rows = await tx
        .select({ id: users.id, rating: users.rating, games: users.ratedGames })
        .from(users)
        .where(inArray(users.id, game.players.map((p) => p.userId)))
        .orderBy(users.id)
        .for("update");
      const rated = game.players.flatMap((p) => {
        const row = rows.find((r) => r.id === p.userId);
        return row ? [{ ...p, rating: row.rating, games: row.games }] : [];
      });
      const after = rate(rated, game.rated.order);
      for (const p of rated) {
        const next = after.get(p.side)!;
        ratings[p.side] = { before: p.rating, after: next };
        await tx
          .update(users)
          .set({ rating: next, ratedGames: p.games + 1 })
          .where(eq(users.id, p.userId));
      }
    }
    const [row] = await tx
      .insert(games)
      .values({
        celestial: game.celestial,
        skyStart: game.skyStart,
        moves: game.moves,
        seats: game.seats,
        winner: game.winner,
        drawReason: game.drawReason,
        rated: !!game.rated,
        local: !!game.local,
        startedAt: game.startedAt,
        finishedAt: game.finishedAt,
      })
      .returning({ id: games.id });
    await tx
      .insert(gamePlayers)
      .values(
        game.players.map((p) => ({
          gameId: row.id,
          userId: p.userId,
          side: p.side,
          place: game.places?.[p.side] ?? null,
          ratingBefore: ratings[p.side]?.before ?? null,
          ratingAfter: ratings[p.side]?.after ?? null,
        }))
      );
    return { id: row.id, ratings };
  });
}

export async function ratingOf(
  db: Db,
  userId: string
): Promise<{ rating: number; games: number } | null> {
  const [row] = await db
    .select({ rating: users.rating, games: users.ratedGames })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

// 個人資料的戰績：積分局各名次幾次；連線對局的局數、勝場、和局（單機對電腦不算）
export async function statsOf(db: Db, userId: string): Promise<ProfileStats> {
  const byPlace = await db
    .select({ place: gamePlayers.place, n: count() })
    .from(gamePlayers)
    .innerJoin(games, eq(gamePlayers.gameId, games.id))
    .where(and(eq(gamePlayers.userId, userId), eq(games.rated, true)))
    .groupBy(gamePlayers.place);
  const places: [number, number, number] = [0, 0, 0];
  for (const row of byPlace) {
    if (row.place && row.place >= 1 && row.place <= 3) places[row.place - 1] += row.n;
  }
  const [all] = await db
    .select({
      games: count(),
      wins: sql<number>`count(*) filter (where ${games.winner} = ${gamePlayers.side})`.mapWith(Number),
      draws: sql<number>`count(*) filter (where ${games.winner} is null)`.mapWith(Number),
    })
    .from(gamePlayers)
    .innerJoin(games, eq(gamePlayers.gameId, games.id))
    .where(and(eq(gamePlayers.userId, userId), eq(games.local, false)));
  return {
    rated: { games: byPlace.reduce((a, r) => a + r.n, 0), places },
    all: { games: all?.games ?? 0, wins: all?.wins ?? 0, draws: all?.draws ?? 0 },
  };
}

const changeOf = (before: number | null, after: number | null): RatingChange | null =>
  before !== null && after !== null ? { before, after } : null;

async function usedToday(db: Db, userId: string, day: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(replayViews)
    .where(and(eq(replayViews.userId, userId), eq(replayViews.day, day)));
  return row?.n ?? 0;
}

export async function quotaOf(db: Db, userId: string, now = new Date()): Promise<ReplayQuota> {
  return {
    subscribed: !!(await subscriptionOf(db, userId, now)),
    limit: FREE_REPLAYS_PER_DAY,
    usedToday: await usedToday(db, userId, taipeiDay(now)),
  };
}

// 自己下過的局（新的在前），只有摘要，不含棋步
export async function listGames(db: Db, userId: string, now = new Date()): Promise<GameSummary[]> {
  const day = taipeiDay(now);
  const rows = await db
    .select({
      id: games.id,
      finishedAt: games.finishedAt,
      mySide: gamePlayers.side,
      seats: games.seats,
      winner: games.winner,
      drawReason: games.drawReason,
      moveCount: sql<number>`jsonb_array_length(${games.moves})`.mapWith(Number),
      ratingBefore: gamePlayers.ratingBefore,
      ratingAfter: gamePlayers.ratingAfter,
      local: games.local,
      viewed: replayViews.gameId,
    })
    .from(gamePlayers)
    .innerJoin(games, eq(gamePlayers.gameId, games.id))
    .leftJoin(
      replayViews,
      and(
        eq(replayViews.gameId, games.id),
        eq(replayViews.userId, userId),
        eq(replayViews.day, day)
      )
    )
    .where(eq(gamePlayers.userId, userId))
    .orderBy(desc(games.finishedAt))
    .limit(LIST_LIMIT);
  return rows.map(({ viewed, finishedAt, ratingBefore, ratingAfter, ...r }) => ({
    ...r,
    finishedAt: finishedAt.toISOString(),
    viewedToday: viewed !== null,
    rating: changeOf(ratingBefore, ratingAfter),
  }));
}

export type OpenResult =
  | { kind: "ok"; game: GameRecord; quota: ReplayQuota }
  | { kind: "notFound" }
  | { kind: "quota"; quota: ReplayQuota };

// 打開一局：訂閱中不限次數；免費帳號今天第一次打開這局會用掉一次
export async function openGame(
  db: Db,
  userId: string,
  gameId: string,
  now = new Date()
): Promise<OpenResult> {
  if (!UUID.test(gameId)) return { kind: "notFound" };
  const [row] = await db
    .select({
      game: games,
      mySide: gamePlayers.side,
      ratingBefore: gamePlayers.ratingBefore,
      ratingAfter: gamePlayers.ratingAfter,
    })
    .from(gamePlayers)
    .innerJoin(games, eq(gamePlayers.gameId, games.id))
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId)))
    .limit(1);
  if (!row) return { kind: "notFound" };

  const subscribed = !!(await subscriptionOf(db, userId, now));
  const day = taipeiDay(now);
  if (!subscribed) {
    // 同一個帳號的「檢查次數 → 記一次」一個一個來（資料庫鎖），
    // 兩個分頁同時打開也不會多算或少算
    const allowed = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`replay:${userId}`}))`);
      const [seen] = await tx
        .select({ gameId: replayViews.gameId })
        .from(replayViews)
        .where(
          and(
            eq(replayViews.userId, userId),
            eq(replayViews.day, day),
            eq(replayViews.gameId, gameId)
          )
        )
        .limit(1);
      if (seen) return true;
      if ((await usedToday(tx, userId, day)) >= FREE_REPLAYS_PER_DAY) return false;
      await tx.insert(replayViews).values({ userId, day, gameId });
      return true;
    });
    if (!allowed) return { kind: "quota", quota: await quotaOf(db, userId, now) };
  }

  const g = row.game;
  return {
    kind: "ok",
    game: {
      id: g.id,
      finishedAt: g.finishedAt.toISOString(),
      mySide: row.mySide,
      seats: g.seats,
      winner: g.winner,
      drawReason: g.drawReason,
      moveCount: g.moves.length,
      viewedToday: !subscribed,
      rating: changeOf(row.ratingBefore, row.ratingAfter),
      local: g.local,
      celestial: g.celestial,
      skyStart: g.skyStart,
      moves: g.moves.map(cleanMove),
    },
    quota: await quotaOf(db, userId, now),
  };
}
