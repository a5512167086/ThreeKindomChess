// 四字記譜法：棋子 + 從第幾路 + 進/退/平 + 數字（例如「炮二平五」）
//
// 每一家都用自己的視角記：路數從自己右手邊數 1~9，往對手方向是「進」。
// 跨面板的對應與兩人象棋的鏡像一致：自己面板 f = col、y = 4 - row；
// 別人的面板 f = 8 - col、y = 5 + row（兩個鄰居都一樣）。

import type { Kind, Piece, Pos, Side } from "./rules";

export const KIND_LABELS: Record<Kind, string> = {
  chariot: "車",
  horse: "馬",
  elephant: "相",
  advisor: "士",
  general: "將",
  cannon: "炮",
  soldier: "兵",
};

const NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

// 中文數字（步數、輪數用）：7 → 七、12 → 十二、105 → 一百〇五；一千以上直接用阿拉伯數字
export function chineseNumber(n: number): string {
  const digit = (d: number) => (d === 0 ? "〇" : NUMERALS[d - 1]);
  if (n < 1 || n >= 1000 || !Number.isInteger(n)) return String(n);
  if (n < 10) return digit(n);
  if (n < 100) {
    const tens = Math.floor(n / 10), ones = n % 10;
    return `${tens === 1 ? "" : digit(tens)}十${ones ? digit(ones) : ""}`;
  }
  const hundreds = Math.floor(n / 100), rest = n % 100;
  if (rest === 0) return `${digit(hundreds)}百`;
  if (rest < 10) return `${digit(hundreds)}百〇${digit(rest)}`;
  // 一百一十二：百位後面的十要寫「一十」
  return `${digit(hundreds)}百${rest < 20 ? "一" : ""}${chineseNumber(rest)}`;
}

// 斜著走的棋子，最後的數字寫「到第幾路」；直著走的進退寫「走幾步」
const DIAGONAL_KINDS: Kind[] = ["horse", "elephant", "advisor"];

// 從 side 的視角看某個位置：f 0..8（路數 = 9 - f）、y 0..9（越大越靠對手）
const view = (side: Side, p: Pos) =>
  p.panel === side
    ? { f: p.col, y: 4 - p.row }
    : { f: 8 - p.col, y: 5 + p.row };

const fileName = (f: number) => NUMERALS[8 - f];

// 同一路有多顆同種棋子時的前後稱呼（由前往後）
const orderNames = (count: number) =>
  count === 2
    ? ["前", "後"]
    : count === 3
    ? ["前", "中", "後"]
    : NUMERALS.slice(0, count);

// sideName：各家的簡稱（例如 紅/藍/黑），用在中路過河的「入黑」
export function moveNotation(
  before: Piece[],
  mover: Side,
  from: Pos,
  to: Pos,
  sideName: (side: Side) => string
): string {
  const piece = before.find(
    (p) =>
      p.pos.panel === from.panel &&
      p.pos.row === from.row &&
      p.pos.col === from.col
  );
  if (!piece) return "?";

  const label = KIND_LABELS[piece.kind];
  const a = view(mover, from);
  const b = view(mover, to);

  // 棋子名稱：同一路有同種的子就用「前炮」「後炮」，否則「炮二」
  const sameFile = before
    .filter(
      (p) =>
        p.owner === mover &&
        p.kind === piece.kind &&
        view(mover, p.pos).f === a.f
    )
    .sort((p, q) => view(mover, q.pos).y - view(mover, p.pos).y);
  const head =
    sameFile.length > 1
      ? `${orderNames(sameFile.length)[sameFile.indexOf(piece)]}${label}`
      : `${label}${fileName(a.f)}`;

  const dy = b.y - a.y;
  const diagonal = DIAGONAL_KINDS.includes(piece.kind);

  // 中路（第五路）過河分兩邊，「進」改寫成「入某家」：
  // 兵五入黑、馬四入藍；車炮一次走多步再補步數，例如 車五入黑三
  if (to.panel !== mover && to.panel !== from.panel && b.f === 4) {
    const steps = !diagonal && dy > 1 ? NUMERALS[dy - 1] : "";
    return `${head}入${sideName(to.panel)}${steps}`;
  }

  const action = dy > 0 ? "進" : dy < 0 ? "退" : "平";
  const number =
    dy === 0 || diagonal ? fileName(b.f) : NUMERALS[Math.abs(dy) - 1];
  return `${head}${action}${number}`;
}
