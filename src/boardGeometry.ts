// 棋盤的幾何：三片彎曲面板的交叉點座標、面板怎麼擺，以及整盤要縮放到多大才塞得進畫面。
// Board 畫圖用；GameView 也拿來比哪一種版面棋盤比較大。

import type { Side } from "./rules";

export const VERTICALS = 9;
export const HORIZONTALS = 5;
const PANEL_WIDTH = 1200;
const PANEL_HEIGHT = 400;
const TOP_FOLD = 250;
const SHRINK_PER_ROW = 80;

// 中央三角形（三個 A5 連線）的邊長；三片面板繞三角形中心各差 120°
const TRIANGLE_SIDE = 300;
const HUB_Y = -TOP_FOLD - TRIANGLE_SIDE / Math.sqrt(3);

export type PanelTransform = { x: number; y: number; rotation: number };

// 繞 (0, HUB_Y) 旋轉 deg 度：換算成 Konva 的「先旋轉再平移」
const aroundHub = (deg: number): PanelTransform => {
  const rad = (deg * Math.PI) / 180;
  return {
    x: HUB_Y * Math.sin(rad),
    y: HUB_Y * (1 - Math.cos(rad)),
    rotation: deg,
  };
};

// 每片面板在棋盤座標中的位移與旋轉（面板 Group 與跨面板連線共用）
export const PANEL_TRANSFORMS: Record<Side, PanelTransform> = {
  Center: aroundHub(0),
  Left: aroundHub(120),
  Right: aroundHub(-120),
};

// 局部座標 -> 外層座標（與 Konva 先旋轉再平移的順序一致）
export const toBoard = (
  t: PanelTransform,
  [x, y]: [number, number]
): [number, number] => {
  const rad = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [t.x + x * cos - y * sin, t.y + x * sin + y * cos];
};

// 計算面板所有交叉點的局部座標：[row][col] -> [x, y]
function buildGridRows(): [number, number][][] {
  const startY = 0;
  const hSpacing = PANEL_HEIGHT / (HORIZONTALS - 1);

  const horizontalPoints: [number, number][][] = [];

  for (let j = 0; j < HORIZONTALS; j++) {
    const y = startY + j * hSpacing;
    const shrinkTotal = SHRINK_PER_ROW * j;
    const rowWidth = PANEL_WIDTH - shrinkTotal;
    const rowStartX = -rowWidth / 2;

    const fold = TOP_FOLD * (1 - j / (HORIZONTALS - 1));

    const rowPoints: [number, number][] = [];
    const vSpacingRow = rowWidth / (VERTICALS - 1);
    const midX = rowStartX + rowWidth / 2;

    for (let i = 0; i < VERTICALS; i++) {
      const x = rowStartX + i * vSpacingRow;
      const distToMid = Math.abs(x - midX);
      const maxDist = rowWidth / 2;
      const factor = 1 - distToMid / maxDist; // 中央 1、邊緣 0
      const yPoint = y - fold * factor;
      rowPoints.push([x, yPoint]);
    }

    horizontalPoints.push(rowPoints);
  }

  return horizontalPoints;
}

export const GRID_ROWS = buildGridRows();

// 整個棋盤旋轉 rotation 度之後的外框，含棋子半徑的留白
const FIT_PADDING = 60;
function boardBounds(rotation: number) {
  const view = { x: 0, y: 0, rotation };
  const pts = (Object.values(PANEL_TRANSFORMS) as PanelTransform[]).flatMap(
    (t) => GRID_ROWS.flat().map((p) => toBoard(view, toBoard(t, p)))
  );
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  return {
    minX: Math.min(...xs) - FIT_PADDING,
    maxX: Math.max(...xs) + FIT_PADDING,
    minY: Math.min(...ys) - FIT_PADDING,
    maxY: Math.max(...ys) + FIT_PADDING,
  };
}

export type Reserve = { left: number; right: number; top: number; bottom: number };

// 讓整個棋盤剛好塞進 w x h 的視窗扣掉 reserve（留給狀態列、棋譜）後的區域並置中
export function fitView(w: number, h: number, rotation: number, reserve: Reserve) {
  const { minX, maxX, minY, maxY } = boardBounds(rotation);
  const innerW = Math.max(1, w - reserve.left - reserve.right);
  const innerH = Math.max(1, h - reserve.top - reserve.bottom);
  const scale = Math.min(innerW / (maxX - minX), innerH / (maxY - minY));
  return {
    scale,
    x: reserve.left + innerW / 2 - ((minX + maxX) / 2) * scale,
    y: reserve.top + innerH / 2 - ((minY + maxY) / 2) * scale,
  };
}

// 留這些空間時棋盤會畫多大（三片面板繞中心對稱，哪一家在下方都差不多大）
export const boardScale = (w: number, h: number, reserve: Reserve) =>
  fitView(w, h, 0, reserve).scale;

