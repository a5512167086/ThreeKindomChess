// 積分與段位：只有「積分配對」的對局會改變積分。
//
// 段位：青銅、白銀、黃金、白金、鑽石、大師、菁英，每個段位分 Ⅰ、Ⅱ、Ⅲ（Ⅲ 最高），
// 每一小段 100 分。新帳號從 0 分（青銅Ⅰ）開始，最高的菁英Ⅲ是 2000 分以上，沒有上限。
//
// 算分用 Elo 的想法，把三人局拆成兩兩比較：名次在前的算贏、同名次算和。
// 贏了比自己高分的人加得多，輸給比自己低分的人扣得多。

import type { Side } from "./rules";
import type { GameState } from "./game";

export const TIERS = ["青銅", "白銀", "黃金", "白金", "鑽石", "大師", "菁英"] as const;
// 用全形的羅馬數字：直書時也是正的
export const DIVISIONS = ["Ⅰ", "Ⅱ", "Ⅲ"] as const;
export const POINTS_PER_DIVISION = 100;
export const START_RATING = 0;
const TOP = TIERS.length * DIVISIONS.length - 1; // 菁英Ⅲ的編號

// 前幾局變動比較大，讓新玩家快一點到自己該在的段位
export const PROVISIONAL_GAMES = 10;
const K_PROVISIONAL = 80;
const K_NORMAL = 40;
const ELO_SCALE = 400; // 差 400 分，高分的一方贏面約 10:1

export type Rank = {
  tier: (typeof TIERS)[number];
  division: (typeof DIVISIONS)[number];
  label: string; // 「黃金Ⅱ」
  tierIndex: number; // 0 = 青銅 … 6 = 菁英
  toNext: number | null; // 再幾分升下一小段；菁英Ⅲ沒有下一段
};

export function rankOf(points: number): Rank {
  const index = Math.min(Math.floor(Math.max(0, points) / POINTS_PER_DIVISION), TOP);
  const tierIndex = Math.floor(index / DIVISIONS.length);
  const tier = TIERS[tierIndex];
  const division = DIVISIONS[index % DIVISIONS.length];
  return {
    tier,
    division,
    label: `${tier}${division}`,
    tierIndex,
    toNext: index === TOP ? null : (index + 1) * POINTS_PER_DIVISION - points,
  };
}

// 名次：由好到壞，每一組是同名次的幾家。
// 贏家（或和局時還在場上的幾家）第一，接著是越晚出局的越前面；
// 中途離開房間的人一律排最後（越早走的越後面），就算電腦替他下贏了也一樣
export function placements(game: GameState, quitters: Side[] = []): Side[][] {
  const out: Side[] = [];
  game.history.forEach((e, i) => {
    const after = game.history[i + 1]?.alive ?? game.alive;
    for (const side of e.alive) if (!after.includes(side)) out.push(side);
  });
  const top = game.winner ? [game.winner] : [...game.alive];
  const groups = [top, ...out.reverse().map((s) => [s])]
    .map((g) => g.filter((s) => !quitters.includes(s)))
    .filter((g) => g.length > 0);
  return [...groups, ...[...quitters].reverse().map((s) => [s])];
}

export type RatedPlayer = { side: Side; rating: number; games: number };

// 每一家的新積分（不會低於 0）
export function rate(players: RatedPlayer[], order: Side[][]): Map<Side, number> {
  const place = (side: Side) => order.findIndex((g) => g.includes(side));
  const result = new Map<Side, number>();
  for (const me of players) {
    let sum = 0;
    for (const other of players) {
      if (other === me) continue;
      const expected = 1 / (1 + 10 ** ((other.rating - me.rating) / ELO_SCALE));
      const a = place(me.side);
      const b = place(other.side);
      const score = a < b ? 1 : a === b ? 0.5 : 0;
      sum += score - expected;
    }
    const k = me.games < PROVISIONAL_GAMES ? K_PROVISIONAL : K_NORMAL;
    const delta = Math.round((k / (players.length - 1)) * sum);
    result.set(me.side, Math.max(0, me.rating + delta));
  }
  return result;
}

// 配對：等越久，能接受的分差越大；等滿一分鐘就不挑了
const MATCH_WINDOW_BASE = 150;
const MATCH_WINDOW_STEP = 100; // 每多等 10 秒放寬這麼多
const MATCH_ANYONE_AFTER_MS = 60_000;

export function matchWindow(waitedMs: number): number {
  if (waitedMs >= MATCH_ANYONE_AFTER_MS) return Infinity;
  return MATCH_WINDOW_BASE + MATCH_WINDOW_STEP * Math.floor(waitedMs / 10_000);
}

export type QueueEntry = { id: string; rating: number; since: number };

// 從排隊的人裡挑出一組三人：分差要在三個人都能接受的範圍內，
// 能湊的組裡挑分差最小的。湊不到就回傳 null
export function pickMatch(queue: QueueEntry[], now: number, size = 3): QueueEntry[] | null {
  const sorted = [...queue].sort((a, b) => a.rating - b.rating);
  let best: QueueEntry[] | null = null;
  let bestSpread = Infinity;
  for (let i = 0; i + size <= sorted.length; i++) {
    const group = sorted.slice(i, i + size);
    const spread = group[size - 1].rating - group[0].rating;
    const window = Math.min(...group.map((e) => matchWindow(now - e.since)));
    if (spread <= window && spread < bestSpread) {
      best = group;
      bestSpread = spread;
    }
  }
  return best;
}
