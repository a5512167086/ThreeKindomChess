import { type JSX, useMemo, useState } from "react";
import { Stage, Layer, Line, Group, Circle, Text } from "react-konva";

const VERTICALS = 9;
const HORIZONTALS = 5;
const PANEL_WIDTH = 1200;
const PANEL_HEIGHT = 400;
const LINE_COLOR = "#e5e7eb";
const TOP_FOLD = 250;
const SHRINK_PER_ROW = 80;

const LEFT_ROT = 120.5;
const RIGHT_ROT = -120.5;

const SEAM_X = 380;
const SEAM_Y = 620;

// 把 0..HORIZONTALS-1 轉 A..E
const rowLabel = (rowIdx: number) => String.fromCharCode(65 + rowIdx);
// 把 0..VERTICALS-1 轉 1..9
const colLabel = (colIdx: number) => (colIdx + 1).toString();

// 棋子樣式（不同面板不同顏色）
const PANEL_COLORS: Record<
  WarpedPanelProps["panelTag"],
  { fill: string; text: string; stroke: string }
> = {
  Center: { fill: "#fee2e2", text: "#b91c1c", stroke: "#fca5a5" }, // 紅
  Left: { fill: "#e5e7eb", text: "#111827", stroke: "#9ca3af" }, // 黑（灰底黑字）
  Right: { fill: "#dbeafe", text: "#1e3a8a", stroke: "#93c5fd" }, // 藍
};

type WarpedPanelProps = {
  panelTag: "Left" | "Center" | "Right";
  onPick?: (info: {
    panel: string;
    row: number;
    col: number;
    x: number;
    y: number;
  }) => void;
};

// 單片面板
function WarpedPanel({ panelTag, onPick }: WarpedPanelProps) {
  const { verticals, horizontals, crosses, gridPoints } = useMemo(() => {
    const vLines: JSX.Element[] = [];
    const hLines: JSX.Element[] = [];
    const crossLines: JSX.Element[] = [];

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

  // ---- 在這裡畫棋子（上半邊標準象棋排法）----
  // row 0: 車馬相士將士相馬車
  const backRank = [
    { col: 0, label: "車" },
    { col: 1, label: "馬" },
    { col: 2, label: "相" },
    { col: 3, label: "士" },
    { col: 4, label: "將" },
    { col: 5, label: "士" },
    { col: 6, label: "相" },
    { col: 7, label: "馬" },
    { col: 8, label: "車" },
  ].map((p) => ({ row: 4, ...p }));

  // row 2: 炮 at 1,7
  const cannons = [
    { row: 2, col: 1, label: "炮" },
    { row: 2, col: 7, label: "炮" },
  ];

  // row 3: 兵 at 0,2,4,6,8
  const pawns = [0, 2, 4, 6, 8].map((c) => ({ row: 1, col: c, label: "兵" }));

  const pieces = [...backRank, ...cannons, ...pawns];

  const color = PANEL_COLORS[panelTag];

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
      {pieces.map((pc, idx) => {
        const pt = pointMap.get(pointKey(pc.row, pc.col));
        if (!pt) return null;
        return (
          <Group key={`piece-${idx}`} x={pt.x} y={pt.y} listening={false}>
            <Circle
              radius={35}
              fill={color.fill}
              stroke={color.stroke}
              strokeWidth={2}
            />
            <Text
              text={pc.label}
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

      {/* 點擊熱區：透明但可點（置於最上層） */}
      {gridPoints.map((p) => (
        <Circle
          key={`pt-${p.row}-${p.col}`}
          x={p.x}
          y={p.y}
          radius={18} // 熱區可調
          fill="white"
          opacity={0.001} // 幾乎看不見，但仍可點擊
          onClick={() =>
            onPick?.({
              panel: panelTag,
              row: p.row,
              col: p.col,
              x: p.x,
              y: p.y,
            })
          }
          onTap={() =>
            onPick?.({
              panel: panelTag,
              row: p.row,
              col: p.col,
              x: p.x,
              y: p.y,
            })
          }
        />
      ))}
    </Group>
  );
}

export default function App() {
  const stageW = typeof window !== "undefined" ? window.innerWidth : 1280;
  const stageH = typeof window !== "undefined" ? window.innerHeight : 900;

  const cx = stageW / 2;
  const cy = stageH / 2 + 120;

  const [lastPick, setLastPick] = useState<string>("尚未點擊");

  const handlePick = (info: {
    panel: string;
    row: number;
    col: number;
    x: number;
    y: number;
  }) => {
    const rLabel = rowLabel(info.row); // A..E (A=0)
    const cLabel = colLabel(info.col); // 1..9
    setLastPick(
      `${info.panel} 面板：${rLabel}${cLabel}  (x=${info.x.toFixed(
        1
      )}, y=${info.y.toFixed(1)})`
    );
    console.log({ ...info, label: `${rLabel}${cLabel}` });
  };

  return (
    <Stage width={stageW} height={stageH} style={{ background: "#0f172a" }}>
      <Layer>
        {/* 顯示最後一次點擊結果 */}
        <Text x={16} y={16} text={lastPick} fill="#e5e7eb" fontSize={18} />

        {/* 中間面板（紅） */}
        <Group x={cx} y={cy}>
          <WarpedPanel panelTag="Center" onPick={handlePick} />
        </Group>

        {/* 左面板（黑） */}
        <Group x={cx - SEAM_X} y={cy - SEAM_Y} rotation={LEFT_ROT}>
          <WarpedPanel panelTag="Left" onPick={handlePick} />
        </Group>

        {/* 右面板（藍） */}
        <Group x={cx + SEAM_X} y={cy - SEAM_Y} rotation={RIGHT_ROT}>
          <WarpedPanel panelTag="Right" onPick={handlePick} />
        </Group>
      </Layer>
    </Stage>
  );
}
