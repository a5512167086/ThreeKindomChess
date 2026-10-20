// 棋盤繪製：三片彎曲面板、接縫、棋子、落點提示、最後一步箭頭
// 整個棋盤會依「我」的座位旋轉，讓自己那一家永遠在下方。
// 樣式：宣紙底、墨線，各方地盤一層淡淡的己方顏色；棋子是象牙圓片＋楷書字。

import { type JSX, useEffect, useMemo, useState } from "react";
import {
  Stage,
  Layer,
  Line,
  Group,
  Circle,
  Text,
  Arrow,
} from "react-konva";
import type { Piece, Pos, Side } from "./rules";
import { KIND_LABELS } from "./notation";
import { SIDE_INK } from "./sides";

const VERTICALS = 9;
const HORIZONTALS = 5;
const PANEL_WIDTH = 1200;
const PANEL_HEIGHT = 400;
const LINE_COLOR = "rgba(42, 42, 42, 0.6)"; // 墨線
const LINE_WIDTH = 2.5;
const TOP_FOLD = 250;
const SHRINK_PER_ROW = 80;

// 中央三角形（三個 A5 連線）的邊長；三片面板繞三角形中心各差 120°
const TRIANGLE_SIDE = 300;
const HUB_Y = -TOP_FOLD - TRIANGLE_SIDE / Math.sqrt(3);

const SELECT_COLOR = "#c23b22"; // 選中：朱砂
const TARGET_COLOR = "#3e8a5f"; // 可以走：石綠
const LAST_MOVE_COLOR = "#c23b22";
const TERRITORY_OPACITY = 0.06;

// 棋子（棋盤座標的大小，會跟著整盤縮放）
const PIECE_R = 44;
const PIECE_FILL = "#f4eedf"; // 象牙
const PIECE_FONT = '"LXGW WenKai TC", "Kaiti TC", "BiauKai", "KaiTi", serif';
const PIECE_CHARS = Object.values(KIND_LABELS).join("");

type PanelTransform = { x: number; y: number; rotation: number };

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
const PANEL_TRANSFORMS: Record<Side, PanelTransform> = {
  Center: aroundHub(0),
  Left: aroundHub(120),
  Right: aroundHub(-120),
};

// 局部座標 -> 外層座標（與 Konva 先旋轉再平移的順序一致）
const toBoard = (
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

const GRID_ROWS = buildGridRows();

// 一片面板的外框（A 排 → 右緣 → E 排反向 → 左緣），用來畫地盤底色
const PANEL_OUTLINE: number[] = [
  ...GRID_ROWS[0],
  ...GRID_ROWS.slice(1).map((r) => r[VERTICALS - 1]),
  ...[...GRID_ROWS[HORIZONTALS - 1]].reverse().slice(1),
  ...GRID_ROWS.slice(1, HORIZONTALS - 1)
    .reverse()
    .map((r) => r[0]),
].flat();

// 跨面板連線：[面板, row, col] -> [面板, row, col]
const SEAM_LINKS: [[Side, number, number], [Side, number, number]][] = [
  [
    ["Left", 0, 8], // Left A9
    ["Center", 0, 0], // Center A1
  ],
  [
    ["Right", 0, 0], // Right A1
    ["Center", 0, 8], // Center A9
  ],
  [
    ["Left", 0, 0], // Left A1
    ["Right", 0, 8], // Right A9
  ],
  // 三片面板的 A5 連成中央三角形
  [
    ["Center", 0, 4], // Center A5
    ["Left", 0, 4], // Left A5
  ],
  [
    ["Left", 0, 4], // Left A5
    ["Right", 0, 4], // Right A5
  ],
  [
    ["Right", 0, 4], // Right A5
    ["Center", 0, 4], // Center A5
  ],
];

const boardPoint = (p: Pos) =>
  toBoard(PANEL_TRANSFORMS[p.panel], GRID_ROWS[p.row][p.col]);

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
function fitView(w: number, h: number, rotation: number, reserve: Reserve) {
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

// 箭頭終點停在棋子邊緣，不蓋住落點的棋子
const ARROW_GAP = PIECE_R + 6;
function arrowPoints(from: Pos, to: Pos): number[] {
  const [x1, y1] = boardPoint(from);
  const [x2, y2] = boardPoint(to);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const k = Math.max(0, len - ARROW_GAP) / len;
  return [x1, y1, x1 + (x2 - x1) * k, y1 + (y2 - y1) * k];
}

type WarpedPanelProps = {
  panelTag: Side;
  pieces: Piece[]; // 目前位在這片面板上的棋子
  selectedId: string | null;
  targets: Pos[]; // 選中棋子在這片面板上的合法落點
  lastFrom?: Pos; // 正在看的那一步的起點（在這片面板上才有）
  lastTo?: Pos; // 正在看的那一步的終點（在這片面板上才有）
  territory: boolean; // 地盤要不要塗底色
  onPick: (pos: Pos) => void;
};

// 單片面板
function WarpedPanel({
  panelTag,
  pieces,
  selectedId,
  targets,
  lastFrom,
  lastTo,
  territory,
  onPick,
}: WarpedPanelProps) {
  const { verticals, horizontals, crosses, gridPoints } = useMemo(() => {
    const vLines: JSX.Element[] = [];
    const hLines: JSX.Element[] = [];
    const crossLines: JSX.Element[] = [];

    const horizontalPoints = GRID_ROWS;

    for (let j = 0; j < HORIZONTALS; j++) {
      const rowPoints = horizontalPoints[j];
      hLines.push(
        <Line
          key={`h-${j}`}
          points={rowPoints.flat()}
          stroke={LINE_COLOR}
          strokeWidth={LINE_WIDTH}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      );
    }

    for (let i = 0; i < VERTICALS; i++) {
      const vertPoints: number[] = [];
      for (let j = 0; j < HORIZONTALS; j++) {
        vertPoints.push(horizontalPoints[j][i][0], horizontalPoints[j][i][1]);
      }
      vLines.push(
        <Line
          key={`v-${i}`}
          points={vertPoints}
          stroke={LINE_COLOR}
          strokeWidth={LINE_WIDTH}
          listening={false}
        />
      );
    }

    // 大型 X（保留）
    const topRowIdx = HORIZONTALS - 3;
    const midRowIdx = HORIZONTALS - 2;
    const bottomRowIdx = HORIZONTALS - 1;
    const leftColIdx = 3;
    const rightColIdx = 5;
    const midColIdx = Math.floor((VERTICALS - 1) / 2);

    const [tlx, tly] = horizontalPoints[topRowIdx][leftColIdx];
    const [trx, try_] = horizontalPoints[topRowIdx][rightColIdx];
    const [blx, bly] = horizontalPoints[bottomRowIdx][leftColIdx];
    const [brx, bry] = horizontalPoints[bottomRowIdx][rightColIdx];
    const [mx, my] = horizontalPoints[midRowIdx][midColIdx];

    crossLines.push(
      <Line
        key="bigx-tl-mid"
        points={[tlx, tly, mx, my]}
        stroke={LINE_COLOR}
        strokeWidth={LINE_WIDTH}
        listening={false}
      />
    );
    crossLines.push(
      <Line
        key="bigx-mid-br"
        points={[mx, my, brx, bry]}
        stroke={LINE_COLOR}
        strokeWidth={LINE_WIDTH}
        listening={false}
      />
    );
    crossLines.push(
      <Line
        key="bigx-tr-mid"
        points={[trx, try_, mx, my]}
        stroke={LINE_COLOR}
        strokeWidth={LINE_WIDTH}
        listening={false}
      />
    );
    crossLines.push(
      <Line
        key="bigx-mid-bl"
        points={[mx, my, blx, bly]}
        stroke={LINE_COLOR}
        strokeWidth={LINE_WIDTH}
        listening={false}
      />
    );

    // 蒐集所有交叉點 (row, col) -> (x,y)
    const gridPoints: { row: number; col: number; x: number; y: number }[] = [];
    for (let row = 0; row < HORIZONTALS; row++) {
      for (let col = 0; col < VERTICALS; col++) {
        const [x, y] = horizontalPoints[row][col];
        gridPoints.push({ row, col, x, y });
      }
    }

    return {
      verticals: vLines,
      horizontals: hLines,
      crosses: crossLines,
      gridPoints,
    };
  }, []);

  // 建立 grid point 查找
  const pointKey = (r: number, c: number) => `${r},${c}`;
  const pointMap = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    gridPoints.forEach((p) =>
      m.set(pointKey(p.row, p.col), { x: p.x, y: p.y })
    );
    return m;
  }, [gridPoints]);

  return (
    <Group>
      {/* 地盤：一層淡淡的己方顏色（設定裡可以關掉） */}
      {territory && (
        <Line
          points={PANEL_OUTLINE}
          closed
          fill={SIDE_INK[panelTag]}
          opacity={TERRITORY_OPACITY}
          listening={false}
        />
      )}
      {horizontals}
      {verticals}
      {crosses}

      {/* 最後一步：起點畫虛線小圈（在棋子底下） */}
      {lastFrom &&
        (() => {
          const pt = pointMap.get(pointKey(lastFrom.row, lastFrom.col));
          return (
            pt && (
              <Circle
                x={pt.x}
                y={pt.y}
                radius={PIECE_R * 0.55}
                stroke={LAST_MOVE_COLOR}
                strokeWidth={4}
                dash={[10, 7]}
                opacity={0.7}
                listening={false}
              />
            )
          );
        })()}

      {/* 棋子：象牙圓片、外粗內細兩圈、楷書字（不攔截滑鼠事件） */}
      {pieces.map((pc) => {
        const pt = pointMap.get(pointKey(pc.pos.row, pc.pos.col));
        if (!pt) return null;
        const ink = SIDE_INK[pc.owner];
        const selected = pc.id === selectedId;
        // 過河到別人面板的棋子轉 180°，與那片面板的棋子面對面
        const rotation = pc.owner === panelTag ? 0 : 180;
        return (
          <Group
            key={pc.id}
            x={pt.x}
            y={pt.y}
            rotation={rotation}
            listening={false}
          >
            {selected && (
              <Circle radius={PIECE_R + 10} stroke={SELECT_COLOR} strokeWidth={5} />
            )}
            <Circle
              radius={PIECE_R}
              fill={PIECE_FILL}
              stroke={ink}
              strokeWidth={5}
              shadowColor="#40301a"
              shadowBlur={6}
              shadowOffsetY={4}
              shadowOpacity={0.35}
            />
            <Circle radius={PIECE_R - 10} stroke={ink} strokeWidth={2} opacity={0.6} />
            <Text
              text={KIND_LABELS[pc.kind]}
              fontFamily={PIECE_FONT}
              fontStyle="bold"
              fontSize={PIECE_R * 1.12}
              fill={ink}
              width={PIECE_R * 2}
              height={PIECE_R * 2}
              offsetX={PIECE_R}
              offsetY={PIECE_R - 2}
              align="center"
              verticalAlign="middle"
            />
          </Group>
        );
      })}

      {/* 最後一步：終點的棋子外面一圈虛線 */}
      {lastTo &&
        (() => {
          const pt = pointMap.get(pointKey(lastTo.row, lastTo.col));
          if (!pt) return null;
          return (
            <Circle
              x={pt.x}
              y={pt.y}
              radius={PIECE_R + 8}
              stroke={LAST_MOVE_COLOR}
              strokeWidth={3}
              dash={[10, 7]}
              opacity={0.7}
              listening={false}
            />
          );
        })()}

      {/* 合法落點：空點畫綠色小點，可吃的子畫綠色外圈 */}
      {targets.map((t) => {
        const pt = pointMap.get(pointKey(t.row, t.col));
        if (!pt) return null;
        const capture = pieces.some(
          (pc) => pc.pos.row === t.row && pc.pos.col === t.col
        );
        return capture ? (
          <Circle
            key={`target-${t.row}-${t.col}`}
            x={pt.x}
            y={pt.y}
            radius={PIECE_R + 8}
            stroke={TARGET_COLOR}
            strokeWidth={5}
            listening={false}
          />
        ) : (
          <Circle
            key={`target-${t.row}-${t.col}`}
            x={pt.x}
            y={pt.y}
            radius={11}
            fill={TARGET_COLOR}
            opacity={0.9}
            listening={false}
          />
        );
      })}

      {/* 點擊熱區：透明但可點（置於最上層） */}
      {gridPoints.map((p) => (
        <Circle
          key={`pt-${p.row}-${p.col}`}
          x={p.x}
          y={p.y}
          radius={PIECE_R} // 與棋子同大，點棋子任何地方都算
          fill="white"
          opacity={0.001} // 幾乎看不見，但仍可點擊
          onClick={() => onPick({ panel: panelTag, row: p.row, col: p.col })}
          onTap={() => onPick({ panel: panelTag, row: p.row, col: p.col })}
        />
      ))}
    </Group>
  );
}

type BoardProps = {
  width: number;
  height: number;
  me: Side; // 這一家畫在下方
  pieces: Piece[];
  selectedId: string | null;
  targets: Pos[];
  shownMove?: { from: Pos; to: Pos }; // 要標示的那一步
  reserve?: Reserve; // 四周留給其他東西的空間
  territory?: boolean; // 地盤要不要塗底色
  onPick: (pos: Pos) => void;
};

const NO_RESERVE: Reserve = { left: 0, right: 0, top: 0, bottom: 0 };

// 棋子的楷書是網路字型；畫布不會自己重畫，所以等字型載入後重畫一次
function usePieceFont(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    document.fonts
      ?.load(`700 40px ${PIECE_FONT}`, PIECE_CHARS)
      .then(() => alive && setReady(true))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}

export function Board({
  width,
  height,
  me,
  pieces,
  selectedId,
  targets,
  shownMove,
  reserve = NO_RESERVE,
  territory = true,
  onPick,
}: BoardProps) {
  const fontReady = usePieceFont();
  // 旋轉整個棋盤，抵消自己面板的角度，讓自己在下方
  const viewRotation = -PANEL_TRANSFORMS[me].rotation;
  const { left, right, top, bottom } = reserve;
  const view = useMemo(
    () => fitView(width, height, viewRotation, { left, right, top, bottom }),
    [width, height, viewRotation, left, right, top, bottom]
  );

  const panelProps = (panel: Side) => ({
    panelTag: panel,
    pieces: pieces.filter((p) => p.pos.panel === panel),
    selectedId,
    targets: targets.filter((t) => t.panel === panel),
    lastFrom: shownMove?.from.panel === panel ? shownMove.from : undefined,
    lastTo: shownMove?.to.panel === panel ? shownMove.to : undefined,
    territory,
    onPick,
  });

  return (
    <Stage
      width={width}
      height={height}
      x={view.x}
      y={view.y}
      scaleX={view.scale}
      scaleY={view.scale}
    >
      <Layer key={fontReady ? "font" : "fallback"}>
        <Group rotation={viewRotation}>
          {/* 跨面板連線（畫在面板下層） */}
          {SEAM_LINKS.map(([[tagA, rowA, colA], [tagB, rowB, colB]]) => (
            <Line
              key={`seam-${tagA}${rowA}${colA}-${tagB}${rowB}${colB}`}
              points={[
                ...toBoard(PANEL_TRANSFORMS[tagA], GRID_ROWS[rowA][colA]),
                ...toBoard(PANEL_TRANSFORMS[tagB], GRID_ROWS[rowB][colB]),
              ]}
              stroke={LINE_COLOR}
              strokeWidth={LINE_WIDTH}
              listening={false}
            />
          ))}

          {(["Center", "Left", "Right"] as Side[]).map((panel) => (
            <Group key={panel} {...PANEL_TRANSFORMS[panel]}>
              <WarpedPanel {...panelProps(panel)} />
            </Group>
          ))}

          {/* 正在看的那一步：從起點指到終點的箭頭 */}
          {shownMove && (
            <Arrow
              points={arrowPoints(shownMove.from, shownMove.to)}
              stroke={LAST_MOVE_COLOR}
              fill={LAST_MOVE_COLOR}
              strokeWidth={6}
              pointerLength={24}
              pointerWidth={24}
              opacity={0.55}
              listening={false}
            />
          )}
        </Group>
      </Layer>
    </Stage>
  );
}
