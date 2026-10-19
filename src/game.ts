// 三國象棋棋局流程（純函式）：輪流、不允許送將、吃將出局、長將長捉、勝負
//
// - 走完之後自己的將不能被任何一家吃到（不允許送將）
// - 將被吃掉的一方出局，剩下的棋子全部歸吃將的人
// - 輪到的人沒有合法步可走（被將死或困斃）就跳過，直到將真的被吃掉
// - 場上只剩一家就贏；所有人都沒棋可走則和局
// - 長將、長捉（長打）：同一局面第 3 次出現時，循環中每步都在將軍或捉子的人
//   不能再走出這個局面（必須變著）；沒人長打或所有人都長打則判和
// - 星象（sky.ts）：每一輪推進一宿，每一家都用「自己那一輪」的四象走棋

import {
  type Piece,
  type Pos,
  type Side,
  applyMove,
  initialPieces,
  middleSoldierId,
  pieceMoves,
  posKey,
  samePos,
} from "./rules";
import { type Phase, phaseAt } from "./sky";

// 輪流順序（畫面上逆時針：下 → 右上 → 左上）
export const TURN_ORDER: Side[] = ["Center", "Right", "Left"];

// 局面重複幾次算循環
const REPETITION_LIMIT = 3;

type HistoryEntry = {
  mover: Side;
  from: Pos;
  to: Pos;
  before: Piece[];
  after: Piece[];
  alive: Side[]; // 走這步之前還在場上的玩家
  round: number; // 這步是在第幾輪走的
  key: string; // 走完後的局面
};

export type GameState = {
  pieces: Piece[];
  alive: Side[]; // 還在場上的玩家（照輪流順序）
  turn: Side | null; // 輪到誰；棋局結束為 null
  winner: Side | null;
  drawReason: "noMoves" | "repetition" | null; // 和局原因
  skipped: Side[]; // 上一步之後因為無棋可走被跳過的玩家
  celestial: boolean; // 有沒有星象；false = 古典規則
  skyStart: number; // 開局時在哪一宿（0 = 角宿），天象從這裡開始輪轉
  round: number; // 第幾輪（0 起算）：輪流順序繞回第一家時 +1
  startKey: string; // 開局局面
  history: HistoryEntry[];
};

// 局面識別：所有棋子（主人、原主人、種類、位置）＋ 剛走完的人 ＋ 當時的四象
const positionKey = (pieces: Piece[], mover: Side, phase: Phase | null) =>
  pieces
    .map((p) => `${p.owner}/${p.origin}/${p.kind}/${posKey(p.pos)}`)
    .sort()
    .join("|") + `#${mover}${phase ? `@${phase}` : ""}`;

// 開局設定：重播同一局時要用一樣的設定，才會得到一樣的天象
export type GameSetup = { celestial: boolean; skyStart: number };

export function newGame({
  celestial = true,
  skyStart = 0,
}: Partial<GameSetup> = {}): GameState {
  const pieces = initialPieces();
  return {
    pieces,
    alive: [...TURN_ORDER],
    turn: TURN_ORDER[0],
    winner: null,
    drawReason: null,
    skipped: [],
    celestial,
    skyStart,
    round: 0,
    startKey: positionKey(
      pieces,
      TURN_ORDER[TURN_ORDER.length - 1],
      celestial ? phaseAt(skyStart) : null
    ),
    history: [],
  };
}

// 每一家下一次走棋時的四象（null = 古典規則）
export type PhaseOf = (side: Side) => Phase | null;

// 輪到 ref 時：輪流順序在 ref 之後（含 ref）的還在這一輪，在前面的要等到下一輪。
// sky 是從角宿算起的宿數（開局的宿 + 第幾輪）
const phasesFrom =
  (celestial: boolean, sky: number, ref: Side | null): PhaseOf =>
  (side) => {
    if (!celestial) return null;
    const sameRound =
      !ref || TURN_ORDER.indexOf(side) >= TURN_ORDER.indexOf(ref);
    return phaseAt(sameRound ? sky : sky + 1);
  };

export const phaseOf = (state: GameState): PhaseOf =>
  phasesFrom(state.celestial, state.skyStart + state.round, state.turn);

const attacks = (
  pieces: Piece[],
  attacker: Piece,
  target: Pos,
  phase: Phase | null
) => pieceMoves(pieces, attacker, phase).some((t) => samePos(t, target));

// 某一方的將是否會被其他玩家吃到（各家用自己下一次走棋時的四象）
export function inCheck(pieces: Piece[], side: Side, phases: PhaseOf): boolean {
  const general = pieces.find((p) => p.owner === side && p.kind === "general");
  if (!general) return false;
  return pieces.some(
    (p) => p.owner !== side && attacks(pieces, p, general.pos, phases(p.owner))
  );
}

// 走一步並處理吃將：被吃將的一方出局，剩下的棋子全部歸吃將的人
function resolveMove(
  pieces: Piece[],
  alive: Side[],
  piece: Piece,
  to: Pos
): { pieces: Piece[]; alive: Side[] } {
  const captured = pieces.find((p) => samePos(p.pos, to));
  const next = applyMove(pieces, piece.id, to);
  if (captured?.kind !== "general") return { pieces: next, alive };

  const loser = captured.owner;
  return {
    pieces: next.map((p) =>
      p.owner === loser ? { ...p, owner: piece.owner } : p
    ),
    alive: alive.filter((s) => s !== loser),
  };
}

// 走完不會讓自己的將被吃的落點
function safeMoves(
  pieces: Piece[],
  alive: Side[],
  piece: Piece,
  phases: PhaseOf
): Pos[] {
  return pieceMoves(pieces, piece, phases(piece.owner)).filter(
    (to) =>
      !inCheck(resolveMove(pieces, alive, piece, to).pieces, piece.owner, phases)
  );
}

// ---- 長將、長捉 ----

// side 是否正在將軍任何一家
const givesCheck = (pieces: Piece[], side: Side, phases: PhaseOf) =>
  pieces.some(
    (g) =>
      g.kind === "general" &&
      g.owner !== side &&
      pieces.some(
        (p) => p.owner === side && attacks(pieces, p, g.pos, phases(side))
      )
  );

// side 目前「捉」住的子，回傳「攻擊者>目標」的集合。
// 捉：能合法吃掉、且目標的主人吃不回來（馬、炮捉車則有保護也算）。
// 將、兵捉子不算捉；捉沒過河的兵不算捉；吃將是將軍不是捉。
function chasePairs(
  pieces: Piece[],
  alive: Side[],
  side: Side,
  phases: PhaseOf
): Set<string> {
  const result = new Set<string>();
  for (const p of pieces) {
    if (p.owner !== side || p.kind === "general" || p.kind === "soldier") {
      continue;
    }
    for (const to of safeMoves(pieces, alive, p, phases)) {
      const target = pieces.find((q) => samePos(q.pos, to));
      if (!target || target.kind === "general") continue;
      if (target.kind === "soldier" && target.pos.panel === target.origin) {
        continue;
      }
      const biggerTarget =
        target.kind === "chariot" && (p.kind === "horse" || p.kind === "cannon");
      if (!biggerTarget) {
        const after = applyMove(pieces, p.id, to);
        const protectedTarget = after.some(
          (q) =>
            q.owner === target.owner && attacks(after, q, to, phases(q.owner))
        );
        if (protectedTarget) continue;
      }
      result.add(`${p.id}>${target.id}`);
    }
  }
  return result;
}

// 這一步是不是「打」（將軍或新產生的捉）
const attackMoveCache = new WeakMap<HistoryEntry, boolean>();
function isAttackMove(e: HistoryEntry, state: GameState): boolean {
  let result = attackMoveCache.get(e);
  if (result === undefined) {
    const phases = phasesFrom(state.celestial, state.skyStart + e.round, e.mover);
    const before = chasePairs(e.before, e.alive, e.mover, phases);
    result =
      givesCheck(e.after, e.mover, phases) ||
      [...chasePairs(e.after, e.alive, e.mover, phases)].some(
        (c) => !before.has(c)
      );
    attackMoveCache.set(e, result);
  }
  return result;
}

// 判斷這一步造成的局面重複：
//   none      ：還沒到循環次數，或循環中有人長打但不是走這步的人
//   forbidden ：走這步的人在長打，必須變著
//   draw      ：沒人長打，或所有人都在長打
function judgeRepetition(
  state: GameState,
  entry: HistoryEntry
): "none" | "forbidden" | "draw" {
  const positions = [state.startKey, ...state.history.map((h) => h.key)];
  const seen = positions.filter((k) => k === entry.key).length;
  if (seen + 1 < REPETITION_LIMIT) return "none";

  // 上一次出現這個局面之後的所有步，就是這個循環
  const cycle = [
    ...state.history.slice(positions.lastIndexOf(entry.key)),
    entry,
  ];
  const movers = [...new Set(cycle.map((e) => e.mover))];
  const violators = movers.filter((side) =>
    cycle
      .filter((e) => e.mover === side)
      .every((e) => isAttackMove(e, state))
  );

  if (violators.includes(entry.mover) && violators.length < movers.length) {
    return "forbidden";
  }
  if (violators.length === 0 || violators.length === movers.length) {
    return "draw";
  }
  return "none";
}

function makeEntry(state: GameState, piece: Piece, to: Pos) {
  const next = resolveMove(state.pieces, state.alive, piece, to);
  const entry: HistoryEntry = {
    mover: piece.owner,
    from: piece.pos,
    to,
    before: state.pieces,
    after: next.pieces,
    alive: state.alive,
    round: state.round,
    key: positionKey(
      next.pieces,
      piece.owner,
      state.celestial ? phaseAt(state.skyStart + state.round) : null
    ),
  };
  return { next, entry };
}

// 不管輪到誰，這顆棋子在目前局面能走的位置
function movesFor(state: GameState, piece: Piece): Pos[] {
  return safeMoves(state.pieces, state.alive, piece, phaseOf(state)).filter(
    (to) => judgeRepetition(state, makeEntry(state, piece, to).entry) !== "forbidden"
  );
}

const hasAnyMove = (state: GameState, side: Side) =>
  state.pieces.some((p) => p.owner === side && movesFor(state, p).length > 0);

// 兩家之間的聊天室：任一方的中兵正站在對方面板上時才開；有人出局就關
export function chatOpen(state: GameState, a: Side, b: Side): boolean {
  if (!state.alive.includes(a) || !state.alive.includes(b)) return false;
  const soldierIn = (owner: Side, panel: Side) =>
    state.pieces.some(
      (p) =>
        p.id === middleSoldierId(owner) &&
        p.owner === owner &&
        p.pos.panel === panel
    );
  return soldierIn(a, b) || soldierIn(b, a);
}

// 目前輪到的人，這顆棋子能走的位置
export function legalMoves(state: GameState, piece: Piece): Pos[] {
  if (piece.owner !== state.turn) return [];
  return movesFor(state, piece);
}

// 執行一步；不合法就原封不動回傳
export function play(state: GameState, pieceId: string, to: Pos): GameState {
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!piece || !legalMoves(state, piece).some((t) => samePos(t, to))) {
    return state;
  }

  const { next, entry } = makeEntry(state, piece, to);
  const base: GameState = {
    ...state,
    pieces: next.pieces,
    alive: next.alive,
    skipped: [],
    history: [...state.history, entry],
  };

  if (next.alive.length === 1) {
    return { ...base, turn: null, winner: next.alive[0] };
  }
  if (judgeRepetition(state, entry) === "draw") {
    return { ...base, turn: null, drawReason: "repetition" };
  }

  // 找下一個有棋可走的玩家（最後才輪回自己）；都沒有就和局。
  // 繞過輪流順序的最後一家就進入下一輪，每一家都用自己那一輪的四象判斷
  const skipped: Side[] = [];
  const n = next.alive.length;
  const start = next.alive.indexOf(piece.owner);
  for (let i = 1; i <= n; i++) {
    const side = next.alive[(start + i) % n];
    const round = state.round + (start + i >= n ? 1 : 0);
    const candidate: GameState = { ...base, turn: side, round, skipped };
    if (hasAnyMove(candidate, side)) return candidate;
    skipped.push(side);
  }
  return { ...base, turn: null, drawReason: "noMoves", skipped };
}

// 從開局照順序重播一串棋步（連線同步、看棋譜用）；遇到不合法的步就停在那裡
export function replay(
  moves: { pieceId: string; to: Pos }[],
  setup?: Partial<GameSetup>
): GameState {
  let g = newGame(setup);
  for (const m of moves) {
    const next = play(g, m.pieceId, m.to);
    if (next === g) break;
    g = next;
  }
  return g;
}
