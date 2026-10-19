// 簡單電腦玩家：試走每一步合法步，挑局面分數最高的
//
// 局面分數 = 自己的子力 - 對手子力（打折）- 自己最大的被吃風險 + 將軍小加分
// 只看一步，不做深度搜尋；加一點隨機避免每盤都一樣、也減少重複局面

import { type Kind, type Piece, type Pos, type Side, applyMove, pieceMoves, samePos } from "./rules";
import { type GameState, type PhaseOf, inCheck, legalMoves, phaseOf, play } from "./game";

const VALUE: Record<Kind, number> = {
  general: 0, // 將的價值由勝負與吃將接收棋子體現
  chariot: 9,
  cannon: 4.5,
  horse: 4,
  advisor: 2,
  elephant: 2,
  soldier: 1,
};

const OPPONENT_WEIGHT = 0.5;
const CHECK_BONUS = 0.5;
const NOISE = 0.3;

// 過河兵價值加倍
const pieceValue = (p: Piece) =>
  p.kind === "soldier" && p.pos.panel !== p.origin ? 2 : VALUE[p.kind];

const material = (pieces: Piece[], side: Side) =>
  pieces
    .filter((p) => p.owner === side)
    .reduce((sum, p) => sum + pieceValue(p), 0);

// side 的子裡，被對手吃掉會損失最多的那一顆的損失
function worstThreat(pieces: Piece[], side: Side, phases: PhaseOf): number {
  let worst = 0;
  for (const attacker of pieces) {
    if (attacker.owner === side) continue;
    for (const to of pieceMoves(pieces, attacker, phases(attacker.owner))) {
      const target = pieces.find((p) => samePos(p.pos, to));
      if (!target || target.owner !== side || target.kind === "general") {
        continue;
      }
      // 吃下去之後我方吃得回來：只損失差價
      const after = applyMove(pieces, attacker.id, to);
      const recapture = after.some(
        (p) =>
          p.owner === side &&
          pieceMoves(after, p, phases(p.owner)).some((t) => samePos(t, to))
      );
      const loss = recapture
        ? Math.max(0, pieceValue(target) - pieceValue(attacker))
        : pieceValue(target);
      worst = Math.max(worst, loss);
    }
  }
  return worst;
}

function evaluate(state: GameState, side: Side): number {
  if (state.winner === side) return Infinity;
  if (!state.alive.includes(side)) return -Infinity;

  const phases = phaseOf(state);
  const opponents = state.alive.filter((s) => s !== side);
  const givesCheck = opponents.some((s) => inCheck(state.pieces, s, phases));
  return (
    material(state.pieces, side) -
    OPPONENT_WEIGHT *
      opponents.reduce((sum, s) => sum + material(state.pieces, s), 0) -
    worstThreat(state.pieces, side, phases) +
    (givesCheck ? CHECK_BONUS : 0)
  );
}

// 幫目前輪到的人挑一步；沒有合法步回傳 null
export function chooseMove(
  state: GameState
): { pieceId: string; to: Pos } | null {
  const side = state.turn;
  if (!side) return null;

  let best: { pieceId: string; to: Pos } | null = null;
  let bestScore = -Infinity;
  for (const piece of state.pieces.filter((p) => p.owner === side)) {
    for (const to of legalMoves(state, piece)) {
      const score =
        evaluate(play(state, piece.id, to), side) + Math.random() * NOISE;
      if (!best || score > bestScore) {
        best = { pieceId: piece.id, to };
        bestScore = score;
      }
    }
  }
  return best;
}
