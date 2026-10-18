import { type JSX, useEffect, useMemo, useRef, useState } from "react";
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
import { type Kind, type Piece, type Pos, type Side, samePos } from "./rules";
import {
  type GameState,
  chatOpen,
  inCheck,
  legalMoves,
  newGame,
  play,
} from "./game";
import { ChatBox } from "./ChatBox";
import { chooseMove } from "./ai";

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

// 棋子樣式（依擁有者上色）
const PANEL_COLORS: Record<
  PanelTag,
  { fill: string; text: string; stroke: string }
> = {
  Center: { fill: "#fee2e2", text: "#b91c1c", stroke: "#fca5a5" }, // 紅
  Left: { fill: "#e5e7eb", text: "#111827", stroke: "#9ca3af" }, // 黑（灰底黑字）
  Right: { fill: "#dbeafe", text: "#1e3a8a", stroke: "#93c5fd" }, // 藍
};

const PANEL_NAMES: Record<PanelTag, string> = {
  Center: "紅",
  Left: "黑",
  Right: "藍",
};

const sideName = (side: PanelTag) => `${PANEL_NAMES[side]}方`;

const KIND_LABELS: Record<Kind, string> = {
  chariot: "車",
  horse: "馬",
  elephant: "相",
  advisor: "士",
  general: "將",
  cannon: "炮",
  soldier: "兵",
};

const SELECT_COLOR = "#facc15";
const TARGET_COLOR = "#4ade80";
const LAST_MOVE_COLOR = "#f59e0b";

// 電腦每步之間的停頓，讓人看得清楚它走了什麼
const AI_DELAY_MS = 600;

// 這台電腦前的玩家坐哪一家（棋盤以這家在下方的視角畫；連線後改成自己的座位）
const ME: PanelTag = "Center";

type ChatMessage = { id: number; from: PanelTag; text: string };
const chatKey = (a: PanelTag, b: PanelTag) => [a, b].sort().join("|");

// 右上角棋譜框大小
const MOVE_LIST_WIDTH = 260;
const MOVE_LIST_MAX_HEIGHT = 280;

type PickInfo = {
  panel: PanelTag;
  row: number;
  col: number;
  x: number;
  y: number;
};

type WarpedPanelProps = {
  panelTag: PanelTag;
  pieces: Piece[]; // 目前位在這片面板上的棋子
  selectedId: string | null;
  targets: Pos[]; // 選中棋子在這片面板上的合法落點
  lastMove: Pos[]; // 最後一步的起點與終點（在這片面板上的部分）
  onPick?: (info: PickInfo) => void;
};

type PanelTag = Side;
type PanelTransform = { x: number; y: number; rotation: number };

// 每片面板在棋盤座標中的位移與旋轉（面板 Group 與跨面板連線共用）
const PANEL_TRANSFORMS: Record<PanelTag, PanelTransform> = {
  Center: { x: 0, y: 0, rotation: 0 },
  Left: { x: -SEAM_X, y: -SEAM_Y, rotation: LEFT_ROT },
  Right: { x: SEAM_X, y: -SEAM_Y, rotation: RIGHT_ROT },
};

// 面板局部座標 -> 棋盤座標（與 Konva 先旋轉再平移的順序一致）
const toBoard = (t: PanelTransform, [x, y]: [number, number]) => {
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
const SEAM_LINKS: [[PanelTag, number, number], [PanelTag, number, number]][] =
  [
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

// 整個棋盤（三片面板）在棋盤座標中的外框，含棋子半徑的留白
const FIT_PADDING = 60;
const BOARD_BOUNDS = (() => {
  const pts = (Object.values(PANEL_TRANSFORMS) as PanelTransform[]).flatMap(
    (t) => GRID_ROWS.flat().map((p) => toBoard(t, p))
  );
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  return {
    minX: Math.min(...xs) - FIT_PADDING,
    maxX: Math.max(...xs) + FIT_PADDING,
    minY: Math.min(...ys) - FIT_PADDING,
    maxY: Math.max(...ys) + FIT_PADDING,
  };
})();

type View = { scale: number; x: number; y: number };

// 讓整個棋盤剛好塞進 w x h 的視窗並置中
const fitView = (w: number, h: number): View => {
  const { minX, maxX, minY, maxY } = BOARD_BOUNDS;
  const scale = Math.min(w / (maxX - minX), h / (maxY - minY));
  return {
    scale,
    x: w / 2 - ((minX + maxX) / 2) * scale,
    y: h / 2 - ((minY + maxY) / 2) * scale,
  };
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

type MoveRecord = GameState["history"][number];

// 棋譜上的位置寫法：面板顏色 + 座標，例如「藍C5」
const squareName = (p: Pos) =>
  `${PANEL_NAMES[p.panel]}${rowLabel(p.row)}${colLabel(p.col)}`;

// 一步棋的文字：「炮 紅C2→紅C5 吃藍方馬」
function describeMove(e: MoveRecord): string {
  const piece = e.before.find((p) => samePos(p.pos, e.from));
  const captured = e.before.find((p) => samePos(p.pos, e.to));
  const text = `${piece ? KIND_LABELS[piece.kind] : ""} ${squareName(
    e.from
  )}→${squareName(e.to)}`;
  if (!captured) return text;
  return `${text}  吃${sideName(captured.owner)}${KIND_LABELS[captured.kind]}${
    captured.kind === "general" ? "（出局）" : ""
  }`;
}

const boardPoint = (p: Pos) =>
  toBoard(PANEL_TRANSFORMS[p.panel], GRID_ROWS[p.row][p.col]);

// 箭頭終點停在棋子邊緣，不蓋住落點的棋子
const ARROW_GAP = 38;
function arrowPoints(from: Pos, to: Pos): number[] {
  const [x1, y1] = boardPoint(from);
  const [x2, y2] = boardPoint(to);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const k = Math.max(0, len - ARROW_GAP) / len;
  return [x1, y1, x1 + (x2 - x1) * k, y1 + (y2 - y1) * k];
}

export default function App() {
  const [size, setSize] = useState({
    w: window.innerWidth,
    h: window.innerHeight,
  });
  // 棋盤固定置中並塞滿視窗，只隨視窗大小改變
  const view = fitView(size.w, size.h);

  useEffect(() => {
    const onResize = () =>
      setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [lastPick, setLastPick] = useState<string>("尚未點擊");

  // 棋局狀態
  const [game, setGame] = useState(newGame);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { pieces, turn: currentSide } = game;
  const selected = pieces.find((p) => p.id === selectedId) ?? null;
  const targets = useMemo(
    () => (selected ? legalMoves(game, selected) : []),
    [game, selected]
  );
  const checked = useMemo(
    () => game.alive.filter((side) => inCheck(game.pieces, side)),
    [game]
  );

  // 哪幾家交給電腦（預設你下紅方，藍、黑給電腦）
  const [aiSides, setAiSides] = useState<PanelTag[]>(["Right", "Left"]);
  const aiTurn = currentSide !== null && aiSides.includes(currentSide);

  // 回放：viewIndex = 看第幾步走完後的局面（0 = 開局）；null = 目前局面
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const total = game.history.length;
  const shownIndex = viewIndex ?? total;
  const reviewing = shownIndex < total;
  const shownMove = shownIndex > 0 ? game.history[shownIndex - 1] : undefined;
  const shownPieces = shownMove
    ? shownMove.after
    : game.history[0]?.before ?? game.pieces;

  const goTo = (index: number) => {
    setSelectedId(null);
    setViewIndex(index >= total ? null : Math.max(0, index));
  };

  // 鍵盤 ← → 前後翻
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 在聊天輸入框裡按方向鍵是移動游標，不是翻棋譜
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft") goTo(shownIndex - 1);
      else if (e.key === "ArrowRight") goTo(shownIndex + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // 棋譜列表自動捲到正在看的那一步
  const activeMoveRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    activeMoveRef.current?.scrollIntoView({ block: "nearest" });
  }, [shownIndex]);

  useEffect(() => {
    // 回放時電腦暫停
    if (!aiTurn || reviewing) return;
    const timer = setTimeout(() => {
      const move = chooseMove(game);
      // 若這段時間內棋局已變（例如按了重新開始）就不要套用
      if (move) setGame((g) => (g === game ? play(g, move.pieceId, move.to) : g));
    }, AI_DELAY_MS);
    return () => clearTimeout(timer);
  }, [game, aiTurn, reviewing]);

  const toggleAi = (side: PanelTag) =>
    setAiSides((sides) =>
      sides.includes(side) ? sides.filter((s) => s !== side) : [...sides, side]
    );

  // 私聊：每兩家一個聊天室
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>({});
  const sendChat = (to: PanelTag, text: string) =>
    setChats((c) => {
      const key = chatKey(ME, to);
      const list = c[key] ?? [];
      return { ...c, [key]: [...list, { id: list.length, from: ME, text }] };
    });

  const chatBoxProps = (partner: PanelTag, corner: "left" | "right") => ({
    title: `與${sideName(partner)}密談`,
    accent: PANEL_COLORS[partner].stroke,
    corner,
    open: chatOpen(game, ME, partner),
    closedHint: game.alive.includes(partner)
      ? "任一方的中兵進入對方領域才能聊"
      : "對方已出局",
    lines: (chats[chatKey(ME, partner)] ?? []).map((m) => ({
      key: String(m.id),
      mine: m.from === ME,
      name: sideName(m.from),
      color: PANEL_COLORS[m.from].stroke,
      text: m.text,
    })),
    onSend: (text: string) => sendChat(partner, text),
  });

  const restart = () => {
    setGame(newGame());
    setSelectedId(null);
    setViewIndex(null);
    setChats({});
  };

  const handlePick = (info: PickInfo) => {
    const rLabel = rowLabel(info.row); // A..E (A=0)
    const cLabel = colLabel(info.col); // 1..9
    setLastPick(
      `${info.panel} 面板：${rLabel}${cLabel}  (x=${info.x.toFixed(
        1
      )}, y=${info.y.toFixed(1)})`
    );
    console.log({ ...info, label: `${rLabel}${cLabel}` });

    // 回放中不能走棋
    if (reviewing) return;

    const pos: Pos = { panel: info.panel, row: info.row, col: info.col };

    // 已選子且點到合法落點：走棋（吃子、吃將出局、換下一家都在 play 裡）
    if (selected && targets.some((t) => samePos(t, pos))) {
      setGame(play(game, selected.id, pos));
      setSelectedId(null);
      return;
    }

    // 點到自己的子就選它（再點一次取消），其他情況取消選取
    const clicked = pieces.find((p) => samePos(p.pos, pos));
    if (
      !aiTurn &&
      clicked &&
      clicked.owner === currentSide &&
      clicked.id !== selectedId
    ) {
      setSelectedId(clicked.id);
    } else {
      setSelectedId(null);
    }
  };

  const panelProps = (panel: PanelTag) => ({
    panelTag: panel,
    pieces: shownPieces.filter((p) => p.pos.panel === panel),
    selectedId,
    targets: reviewing ? [] : targets.filter((t) => t.panel === panel),
    lastMove: shownMove
      ? [shownMove.from, shownMove.to].filter((m) => m.panel === panel)
      : [],
    onPick: handlePick,
  });

  return (
    <div style={{ position: "relative" }}>
      {/* 顯示最後一次點擊結果（不跟著棋盤縮放） */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          zIndex: 1,
          color: "#e5e7eb",
          fontSize: 18,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            fontSize: 22,
            fontWeight: "bold",
            color: PANEL_COLORS[game.winner ?? currentSide ?? "Left"].stroke,
            marginBottom: 4,
          }}
        >
          {game.winner
            ? `${sideName(game.winner)}獲勝！`
            : currentSide
            ? `輪到：${sideName(currentSide)}（${currentSide}）${
                aiTurn ? "・電腦思考中…" : ""
              }`
            : game.drawReason === "repetition"
            ? "和局：局面重複"
            : "和局：所有人都沒棋可走"}
        </div>
        {checked.length > 0 && !game.winner && (
          <div style={{ color: "#f87171", fontWeight: "bold" }}>
            將軍：{checked.map(sideName).join("、")}
          </div>
        )}
        {game.skipped.length > 0 && (
          <div style={{ color: "#fbbf24" }}>
            {game.skipped.map(sideName).join("、")}無棋可走，跳過
          </div>
        )}
        {game.alive.length < 3 && (
          <div style={{ opacity: 0.7 }}>
            出局：
            {(Object.keys(PANEL_NAMES) as PanelTag[])
              .filter((s) => !game.alive.includes(s))
              .map(sideName)
              .join("、")}
          </div>
        )}
        <div>{lastPick}</div>
        <div style={{ marginTop: 8, pointerEvents: "auto", fontSize: 16 }}>
          電腦下：
          {(Object.keys(PANEL_NAMES) as PanelTag[]).map((side) => (
            <label key={side} style={{ marginRight: 12, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={aiSides.includes(side)}
                onChange={() => toggleAi(side)}
              />
              {sideName(side)}
            </label>
          ))}
        </div>
        <button
          onClick={restart}
          style={{ marginTop: 8, pointerEvents: "auto", cursor: "pointer" }}
        >
          重新開始
        </button>
      </div>

      {/* 私聊：左下跟左方、右下跟右方 */}
      <ChatBox {...chatBoxProps("Left", "left")} />
      <ChatBox {...chatBoxProps("Right", "right")} />

      {/* 棋譜 */}
      <div
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          width: MOVE_LIST_WIDTH,
          maxHeight: MOVE_LIST_MAX_HEIGHT,
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          background: "rgba(15, 23, 42, 0.9)",
          border: "1px solid #334155",
          borderRadius: 8,
          color: "#e5e7eb",
          fontSize: 13,
        }}
      >
        <div style={{ padding: "8px 10px", borderBottom: "1px solid #334155" }}>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button onClick={() => goTo(0)} disabled={shownIndex === 0}>
              ⏮
            </button>
            <button
              onClick={() => goTo(shownIndex - 1)}
              disabled={shownIndex === 0}
            >
              ◀
            </button>
            <span style={{ flex: 1, textAlign: "center" }}>
              棋譜 {shownIndex} / {total}
            </span>
            <button onClick={() => goTo(shownIndex + 1)} disabled={!reviewing}>
              ▶
            </button>
            <button onClick={() => goTo(total)} disabled={!reviewing}>
              ⏭
            </button>
          </div>
          {reviewing && (
            <div style={{ marginTop: 4, color: "#fbbf24", fontSize: 12 }}>
              回放中（電腦暫停），按 ⏭ 回到目前局面
            </div>
          )}
        </div>
        <ol
          style={{
            flex: 1,
            overflowY: "auto",
            margin: 0,
            padding: "4px 0",
            listStyle: "none",
          }}
        >
          {game.history.map((e, i) => (
            <li
              key={i}
              ref={i + 1 === shownIndex ? activeMoveRef : undefined}
              onClick={() => goTo(i + 1)}
              style={{
                display: "flex",
                gap: 6,
                padding: "2px 10px",
                cursor: "pointer",
                background: i + 1 === shownIndex ? "#334155" : undefined,
              }}
            >
              <span style={{ opacity: 0.5, minWidth: 26, textAlign: "right" }}>
                {i + 1}.
              </span>
              <span
                style={{ color: PANEL_COLORS[e.mover].stroke, fontWeight: "bold" }}
              >
                {PANEL_NAMES[e.mover]}
              </span>
              <span>{describeMove(e)}</span>
            </li>
          ))}
        </ol>
      </div>

      <Stage
        width={size.w}
        height={size.h}
        style={{ background: "#0f172a" }}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
      >
        <Layer>
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

          {/* 中間面板（紅） */}
          <Group {...PANEL_TRANSFORMS.Center}>
            <WarpedPanel {...panelProps("Center")} />
          </Group>

          {/* 左面板（黑） */}
          <Group {...PANEL_TRANSFORMS.Left}>
            <WarpedPanel {...panelProps("Left")} />
          </Group>

          {/* 右面板（藍） */}
          <Group {...PANEL_TRANSFORMS.Right}>
            <WarpedPanel {...panelProps("Right")} />
          </Group>

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
        </Layer>
      </Stage>
    </div>
  );
}
