// 棋盤繪製：三片彎曲面板、接縫、棋子、落點提示、最後一步箭頭
// 整個棋盤會依「我」的座位旋轉，讓自己那一家永遠在下方。

import { type JSX, useMemo } from "react";
import {
  Stage,
  Layer,
  Line,
  Group,
  Circle,
  Rect,
  Text,
  Arrow,
} from "react-konva";
import type { Piece, Pos, Side } from "./rules";
import { KIND_LABELS } from "./notation";
import { PANEL_COLORS } from "./sides";

const VERTICALS = 9;
const HORIZONTALS = 5;
const PANEL_WIDTH = 1200;
const PANEL_HEIGHT = 400;
const LINE_COLOR = "#e5e7eb";
const TOP_FOLD = 250;
const SHRINK_PER_ROW = 80;

// 中央三角形（三個 A5 連線）的邊長；三片面板繞三角形中心各差 120°
const TRIANGLE_SIDE = 300;
const HUB_Y = -TOP_FOLD - TRIANGLE_SIDE / Math.sqrt(3);

const SELECT_COLOR = "#facc15";
const TARGET_COLOR = "#4ade80";
const LAST_MOVE_COLOR = "#f59e0b";

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

// 讓整個棋盤剛好塞進 w x h 的視窗並置中
function fitView(w: number, h: number, rotation: number) {
  const { minX, maxX, minY, maxY } = boardBounds(rotation);
  const scale = Math.min(w / (maxX - minX), h / (maxY - minY));
  return {
    scale,
    x: w / 2 - ((minX + maxX) / 2) * scale,
    y: h / 2 - ((minY + maxY) / 2) * scale,
  };
}

// 箭頭終點停在棋子邊緣，不蓋住落點的棋子
const ARROW_GAP = 38;
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
  lastMove: Pos[]; // 最後一步的起點與終點（在這片面板上的部分）
  onPick: (pos: Pos) => void;
};

// 單片面板
function WarpedPanel({
  panelTag,
  pieces,
  selectedId,
  targets,
  lastMove,
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
          strokeWidth={2}
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
          strokeWidth={2}
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
        strokeWidth={2}
        listening={false}
      />
    );
    crossLines.push(
      <Line
        key="bigx-mid-br"
        points={[mx, my, brx, bry]}
        stroke={LINE_COLOR}
        strokeWidth={2}
        listening={false}
      />
    );
    crossLines.push(
      <Line
        key="bigx-tr-mid"
        points={[trx, try_, mx, my]}
        stroke={LINE_COLOR}
        strokeWidth={2}
        listening={false}
      />
    );
    crossLines.push(
      <Line
        key="bigx-mid-bl"
        points={[mx, my, blx, bly]}
        stroke={LINE_COLOR}
        strokeWidth={2}
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
      {horizontals}
      {verticals}
      {crosses}

      {/* 棋子（不攔截滑鼠事件） */}
      {pieces.map((pc) => {
        const pt = pointMap.get(pointKey(pc.pos.row, pc.pos.col));
        if (!pt) return null;
        const color = PANEL_COLORS[pc.owner];
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
            <Circle
              radius={35}
              fill={color.fill}
              stroke={selected ? SELECT_COLOR : color.stroke}
              strokeWidth={selected ? 5 : 2}
            />
            <Text
              text={KIND_LABELS[pc.kind]}
              fontSize={35}
              fontStyle="bold"
              fill={color.text}
              align="center"
              verticalAlign="middle"
              offsetX={18} // 粗估中文字寬度（Konva Text無置中基線，這樣看起來居中）
              offsetY={14}
            />
          </Group>
        );
      })}

      {/* 最後一步：起點與終點畫方框 */}
      {lastMove.map((m) => {
        const pt = pointMap.get(pointKey(m.row, m.col));
        if (!pt) return null;
        return (
          <Rect
            key={`last-${m.row}-${m.col}`}
            x={pt.x - 42}
            y={pt.y - 42}
            width={84}
            height={84}
            stroke={LAST_MOVE_COLOR}
            strokeWidth={4}
            dash={[14, 8]}
            listening={false}
          />
        );
      })}

      {/* 合法落點：空格畫小圓點，可吃的子畫外圈 */}
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
            radius={40}
            stroke={TARGET_COLOR}
            strokeWidth={4}
            listening={false}
          />
        ) : (
          <Circle
            key={`target-${t.row}-${t.col}`}
            x={pt.x}
            y={pt.y}
            radius={12}
            fill={TARGET_COLOR}
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
          radius={35} // 熱區可調（與棋子同大，點棋子任何地方都算）
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
  onPick: (pos: Pos) => void;
};

export function Board({
  width,
  height,
  me,
  pieces,
  selectedId,
  targets,
  shownMove,
  onPick,
}: BoardProps) {
  // 旋轉整個棋盤，抵消自己面板的角度，讓自己在下方
  const viewRotation = -PANEL_TRANSFORMS[me].rotation;
  const view = useMemo(
    () => fitView(width, height, viewRotation),
    [width, height, viewRotation]
  );

  const panelProps = (panel: Side) => ({
    panelTag: panel,
    pieces: pieces.filter((p) => p.pos.panel === panel),
    selectedId,
    targets: targets.filter((t) => t.panel === panel),
    lastMove: shownMove
      ? [shownMove.from, shownMove.to].filter((m) => m.panel === panel)
      : [],
    onPick,
  });

  return (
    <Stage
      width={width}
      height={height}
      style={{ background: "#0f172a" }}
      x={view.x}
      y={view.y}
      scaleX={view.scale}
      scaleY={view.scale}
    >
      <Layer>
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
              strokeWidth={2}
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
              strokeWidth={8}
              pointerLength={28}
              pointerWidth={28}
              opacity={0.85}
              listening={false}
            />
          )}
        </Group>
      </Layer>
    </Stage>
  );
}
