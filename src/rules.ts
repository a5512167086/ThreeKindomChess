// 三國象棋走法規則（純函式，不依賴畫面）
//
// 座標：每片面板 row 0..4 = A..E（A 靠中央、E 是底線），col 0..8 = 1..9 路。
//
// 跨面板：每片面板 A 排的左右兩半各面對一個鄰居，中間就是河。
//   Center 1-5 路 ↔ Left 9-5 路、Center 5-9 路 ↔ Right 5-1 路、
//   Left 1-5 路 ↔ Right 9-5 路；中路（5 路）兩邊都能過。
//
// 計算走法時，以棋子「所在」面板為準展開成一張標準 9x10 虛擬棋盤：
//   f = col，y = 4 - row（自己這半 y 0..4，E 排 y=0）
//   y 5..9 是河對岸：f 0..4 屬於 low 鄰居，f 4..8 屬於 high 鄰居，
//   對岸的 col = 8 - f、row = y - 5。

import type { Phase } from "./sky";

export type Side = "Center" | "Left" | "Right";

export type Kind =
  | "chariot"
  | "horse"
  | "elephant"
  | "advisor"
  | "general"
  | "cannon"
  | "soldier";

export type Pos = { panel: Side; row: number; col: number };

// owner：現在的主人（吃將後會換人）；origin：開局時的主人（兵的走法依它判斷）
export type Piece = {
  id: string;
  owner: Side;
  origin: Side;
  kind: Kind;
  pos: Pos;
  frozen?: boolean; // 主人超時出局：留在棋盤上不能動、不威脅別人，但可以被吃
};

export const SIDES: Side[] = ["Center", "Left", "Right"];

// 各面板 1-5 路（low）與 5-9 路（high）面對的鄰居
const NEIGHBORS: Record<Side, { low: Side; high: Side }> = {
  Center: { low: "Left", high: "Right" },
  Left: { low: "Right", high: "Center" },
  Right: { low: "Center", high: "Left" },
};

type Half = keyof (typeof NEIGHBORS)[Side];
const HALVES: Half[] = ["low", "high"];

export const posKey = (p: Pos) => `${p.panel}:${p.row}:${p.col}`;

export const samePos = (a: Pos, b: Pos) =>
  a.panel === b.panel && a.row === b.row && a.col === b.col;

// 虛擬棋盤座標 -> 實際位置；超出棋盤或不屬於這一半的對岸則回傳 null
const resolve = (
  panel: Side,
  half: Half,
  f: number,
  y: number
): Pos | null => {
  if (f < 0 || f > 8 || y < 0 || y > 9) return null;
  if (y <= 4) return { panel, row: 4 - y, col: f };
  if (half === "low" ? f > 4 : f < 4) return null;
  return { panel: NEIGHBORS[panel][half], row: y - 5, col: 8 - f };
};

const ORTHOGONAL: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIAGONAL: [number, number][] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const HORSE: [number, number][] = [
  [1, 2],
  [-1, 2],
  [1, -2],
  [-1, -2],
  [2, 1],
  [2, -1],
  [-2, 1],
  [-2, -1],
];

// 九宮：每片面板 C~E 排、4~6 路
const inPalace = (p: Pos, panel: Side) =>
  p.panel === panel && p.row >= 2 && p.col >= 3 && p.col <= 5;

// 初始擺法：每片面板 E 排車馬相士將士相馬車、C 排炮、B 排兵
export function initialPieces(): Piece[] {
  const backRank: Kind[] = [
    "chariot",
    "horse",
    "elephant",
    "advisor",
    "general",
    "advisor",
    "elephant",
    "horse",
    "chariot",
  ];
  return SIDES.flatMap((owner) => {
    const layout: { kind: Kind; row: number; col: number }[] = [
      ...backRank.map((kind, col) => ({ kind, row: 4, col })),
      { kind: "cannon", row: 2, col: 1 },
      { kind: "cannon", row: 2, col: 7 },
      ...[0, 2, 4, 6, 8].map((col) => ({
        kind: "soldier" as const,
        row: 1,
        col,
      })),
    ];
    return layout.map(({ kind, row, col }) => ({
      id: `${owner}-${kind}-${row}-${col}`,
      owner,
      origin: owner,
      kind,
      pos: { panel: owner, row, col },
    }));
  });
}

// 各家的中兵（開局站在 B5 的兵）的 id，與 initialPieces 的命名一致
export const middleSoldierId = (side: Side) => `${side}-soldier-1-4`;

// 一顆棋子照走法能到的落點（不考慮送將，送將檢查在 game.ts）
// phase：這顆棋子走的那一輪所在的四象；null = 不用星象（古典規則）
export function pieceMoves(
  pieces: Piece[],
  piece: Piece,
  phase: Phase | null
): Pos[] {
  const board = new Map(pieces.map((p) => [posKey(p.pos), p]));
  const { panel, row, col } = piece.pos;
  const f0 = col;
  const y0 = 4 - row;

  const result = new Map<string, Pos>();
  const add = (p: Pos) => result.set(posKey(p), p);
  const occupant = (p: Pos) => board.get(posKey(p));
  // 空格或敵子都能落
  const canLand = (p: Pos) => occupant(p)?.owner !== piece.owner;

  for (const half of HALVES) {
    const at = (f: number, y: number) => resolve(panel, half, f, y);

    switch (piece.kind) {
      case "chariot":
        for (const [df, dy] of ORTHOGONAL) {
          for (let k = 1; ; k++) {
            const p = at(f0 + df * k, y0 + dy * k);
            if (!p) break;
            if (canLand(p)) add(p);
            if (occupant(p)) break;
          }
        }
        break;

      case "cannon": {
        // 隔一子才能吃；沒隔子時只能走空格
        for (const [df, dy] of ORTHOGONAL) {
          let screened = false;
          for (let k = 1; ; k++) {
            const p = at(f0 + df * k, y0 + dy * k);
            if (!p) break;
            if (!occupant(p)) {
              if (!screened) add(p);
              continue;
            }
            if (screened) {
              if (canLand(p)) add(p);
              break;
            }
            screened = true;
          }
        }
        break;
      }

      case "horse":
        // 青龍時馬腿被擋住也能跳
        for (const [df, dy] of HORSE) {
          const leg =
            Math.abs(dy) === 2
              ? at(f0, y0 + Math.sign(dy))
              : at(f0 + Math.sign(df), y0);
          const p = at(f0 + df, y0 + dy);
          const blocked = phase !== "dragon" && (!leg || occupant(leg));
          if (!blocked && p && canLand(p)) add(p);
        }
        break;

      case "elephant":
        // 走田字，象眼被塞住不能走；玄武時可過河，其他時候只能待在所在的面板
        for (const [df, dy] of DIAGONAL) {
          const eye = at(f0 + df, y0 + dy);
          const p = at(f0 + df * 2, y0 + dy * 2);
          if (!eye || occupant(eye) || !p || !canLand(p)) continue;
          if (phase === "tortoise" || p.panel === panel) add(p);
        }
        break;

      case "advisor":
      case "general": {
        // 只能在原本主人的九宮裡走。降士（主人出局後被接收的士）
        // 在玄武時可以出宮；出了宮之後就一直能在宮外斜走一格（也能過河）
        const free =
          piece.kind === "advisor" &&
          piece.owner !== piece.origin &&
          (phase === "tortoise" || !inPalace(piece.pos, piece.origin));
        for (const [df, dy] of piece.kind === "advisor" ? DIAGONAL : ORTHOGONAL) {
          const p = at(f0 + df, y0 + dy);
          if (!p || !canLand(p)) continue;
          if (free || inPalace(p, piece.origin)) add(p);
        }
        break;
      }

      case "soldier": {
        // 在原本主人的面板：只能往河的方向（y+1），白虎時也能橫走；
        // 過河到別人面板：往那片面板的底線走（y-1），也能橫走。
        // 被接收的兵換了主人，走法仍依原本的主人判斷
        const crossed = panel !== piece.origin;
        const sideways: [number, number][] = [
          [1, 0],
          [-1, 0],
        ];
        const steps: [number, number][] = crossed
          ? [[0, -1], ...sideways]
          : phase === "tiger"
          ? [[0, 1], ...sideways]
          : [[0, 1]];
        for (const [df, dy] of steps) {
          const p = at(f0 + df, y0 + dy);
          if (p && canLand(p)) add(p);
        }
        break;
      }
    }
  }

  return [...result.values()];
}

// 執行一步：移動棋子，落點有敵子就吃掉
export function applyMove(pieces: Piece[], pieceId: string, to: Pos): Piece[] {
  return pieces
    .filter((p) => !samePos(p.pos, to))
    .map((p) => (p.id === pieceId ? { ...p, pos: to } : p));
}
