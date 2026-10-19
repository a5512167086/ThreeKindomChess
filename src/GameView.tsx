// 對局畫面：棋盤 + 左上狀態 + 右上棋譜 + 左下右下私聊
// 本機對電腦（LocalGame）與連線對戰（OnlineGame）共用，差別只在誰能操作、
// 走棋與聊天要送去哪裡。

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { Pos, Side } from "./rules";
import { samePos } from "./rules";
import {
  type GameState,
  TURN_ORDER,
  chatOpen,
  inCheck,
  legalMoves,
  phaseOf,
} from "./game";
import {
  PHASE_INFO,
  mansionAt,
  nextPhase,
  phaseAt,
  roundsLeftInPhase,
} from "./sky";
import type { ChatMessage } from "./protocol";
import { ChatBox } from "./ChatBox";
import { KIND_LABELS, moveNotation } from "./notation";
import { type Clock, formatTime, timeLeft } from "./clock";
import { Board } from "./Board";
import { PANEL_COLORS, PANEL_NAMES, squareName } from "./sides";

// 右上角棋譜框大小
const MOVE_LIST_WIDTH = 260;
const MOVE_LIST_MAX_HEIGHT = 280;

type MoveRecord = GameState["history"][number];

// 一步棋的四字記譜：「炮二平五」「兵五入黑」「馬八進七 吃藍兵」
function describeMove(e: MoveRecord): string {
  const text = moveNotation(
    e.before,
    e.mover,
    e.from,
    e.to,
    (side) => PANEL_NAMES[side]
  );
  const captured = e.before.find((p) => samePos(p.pos, e.to));
  return `${text}${
    captured
      ? ` 吃${PANEL_NAMES[captured.owner]}${KIND_LABELS[captured.kind]}${
          captured.kind === "general" ? "（出局）" : ""
        }`
      : ""
  }`;
}

// 滑鼠移到棋譜上顯示的座標寫法：「紅C2→紅C5」
const moveSquares = (e: MoveRecord) =>
  `${squareName(e.from)}→${squareName(e.to)}`;

// 座位在畫面上的左右鄰居：輪流順序在畫面上是逆時針
const rightOf = (side: Side) =>
  TURN_ORDER[(TURN_ORDER.indexOf(side) + 1) % TURN_ORDER.length];
const leftOf = (side: Side) =>
  TURN_ORDER[(TURN_ORDER.indexOf(side) + TURN_ORDER.length - 1) % TURN_ORDER.length];

// 讀秒剩這麼少時轉紅色
const CLOCK_WARN_MS = 10_000;

// 天象：目前的宿與四象效果，以及還剩幾輪換到下一個四象
function SkyStatus({ round }: { round: number }) {
  const phase = phaseAt(round);
  const info = PHASE_INFO[phase];
  const next = PHASE_INFO[nextPhase(phase)];
  return (
    <div style={{ margin: "6px 0", fontSize: 15 }}>
      <div>
        天象：{mansionAt(round)}宿・第 {round + 1} 輪
      </div>
      <div style={{ color: info.color, fontWeight: "bold" }}>
        {info.name}：{info.effect}
      </div>
      <div style={{ fontSize: 13, opacity: 0.7 }}>
        再 {roundsLeftInPhase(round)} 輪後轉入
        <span style={{ color: next.color }}>{next.name}</span>（{next.effect}）
      </div>
    </div>
  );
}

// 時鐘走動時每 250ms 更新一次畫面
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

type GameViewProps = {
  game: GameState;
  clock: Clock | null;
  me: Side; // 畫在下方的那一家，也是聊天時「我」的身分
  canPlay: boolean; // 目前輪到的那一家能不能由這台電腦操作
  turnNote: string; // 狀態列的補充說明，例如「電腦思考中…」
  seatName: (side: Side) => string; // 例如「藍方」「藍方（小明）」
  chats: ChatMessage[]; // 我看得到的私聊訊息
  onSendChat: (to: Side, text: string) => void;
  onMove: (pieceId: string, to: Pos) => void;
  onReviewingChange?: (reviewing: boolean) => void;
  controls?: ReactNode; // 左上角額外的按鈕區
};

export function GameView({
  game,
  clock,
  me,
  canPlay,
  turnNote,
  seatName,
  chats,
  onSendChat,
  onMove,
  onReviewingChange,
  controls,
}: GameViewProps) {
  const [size, setSize] = useState({
    w: window.innerWidth,
    h: window.innerHeight,
  });
  useEffect(() => {
    const onResize = () =>
      setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [lastPick, setLastPick] = useState("尚未點擊");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { pieces, turn: currentSide } = game;
  const selected = pieces.find((p) => p.id === selectedId) ?? null;
  const targets = useMemo(
    () => (selected && canPlay ? legalMoves(game, selected) : []),
    [game, selected, canPlay]
  );
  const checked = useMemo(
    () =>
      game.alive.filter((side) => inCheck(game.pieces, side, phaseOf(game))),
    [game]
  );
  const now = useNow(!!clock && currentSide !== null && clock.pausedAt === null);

  // 回放：viewIndex = 看第幾步走完後的局面（0 = 開局）；null = 目前局面
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const total = game.history.length;
  const shownIndex = viewIndex ?? total;
  const reviewing = shownIndex < total;
  const shownMove = shownIndex > 0 ? game.history[shownIndex - 1] : undefined;
  const shownPieces = shownMove
    ? shownMove.after
    : game.history[0]?.before ?? game.pieces;
  // 正在看的局面之後下一步所在的輪
  const shownRound = reviewing ? game.history[shownIndex].round : game.round;

  useEffect(() => {
    onReviewingChange?.(reviewing);
  }, [reviewing, onReviewingChange]);

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

  const handlePick = (pos: Pos) => {
    setLastPick(squareName(pos));

    // 回放中不能走棋
    if (reviewing) return;

    // 已選子且點到合法落點：走棋
    if (selected && targets.some((t) => samePos(t, pos))) {
      onMove(selected.id, pos);
      setSelectedId(null);
      return;
    }

    // 點到可操作的子就選它（再點一次取消），其他情況取消選取
    const clicked = pieces.find((p) => samePos(p.pos, pos));
    if (
      canPlay &&
      clicked &&
      clicked.owner === currentSide &&
      clicked.id !== selectedId
    ) {
      setSelectedId(clicked.id);
    } else {
      setSelectedId(null);
    }
  };

  // 一串座位名稱，各自用該方的顏色：「藍方（999）、黑方（電腦）」
  const sideList = (sides: Side[]) =>
    sides.map((side, i) => (
      <span key={side}>
        {i > 0 && "、"}
        <span style={{ color: PANEL_COLORS[side].stroke }}>{seatName(side)}</span>
      </span>
    ));

  const chatBoxProps = (partner: Side, corner: "left" | "right") => ({
    title: `與${seatName(partner)}密談`,
    accent: PANEL_COLORS[partner].stroke,
    corner,
    open: chatOpen(game, me, partner),
    closedHint: game.alive.includes(partner)
      ? "任一方的中兵進入對方領域才能聊"
      : "對方已出局",
    lines: chats
      .filter(
        (m) =>
          (m.from === me && m.to === partner) ||
          (m.from === partner && m.to === me)
      )
      .map((m) => ({
        key: String(m.id),
        mine: m.from === me,
        name: seatName(m.from),
        color: PANEL_COLORS[m.from].stroke,
        text: m.text,
      })),
    onSend: (text: string) => onSendChat(partner, text),
  });

  return (
    <div style={{ position: "relative" }}>
      {/* 左上：狀態（不跟著棋盤縮放） */}
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
            color: PANEL_COLORS[game.winner ?? currentSide ?? me].stroke,
            marginBottom: 4,
          }}
        >
          {game.winner
            ? `${seatName(game.winner)}獲勝！`
            : currentSide
            ? `輪到：${seatName(currentSide)}${turnNote ? `・${turnNote}` : ""}`
            : game.drawReason === "repetition"
            ? "和局：局面重複"
            : "和局：所有人都沒棋可走"}
        </div>
        {checked.length > 0 && !game.winner && (
          <div style={{ color: "#f87171", fontWeight: "bold" }}>
            將軍：{sideList(checked)}
          </div>
        )}
        {game.skipped.length > 0 && (
          <div style={{ color: "#fbbf24" }}>
            {sideList(game.skipped)}無棋可走，跳過
          </div>
        )}
        {game.alive.length < TURN_ORDER.length && (
          <div style={{ opacity: 0.7 }}>
            出局：{sideList(TURN_ORDER.filter((s) => !game.alive.includes(s)))}
          </div>
        )}
        {game.celestial && <SkyStatus round={shownRound} />}
        {clock && (
          <div
            style={{
              margin: "6px 0",
              fontSize: 15,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {TURN_ORDER.map((side) => {
              const left = timeLeft(clock, side, currentSide, now);
              const active = side === currentSide;
              const byoyomi = left.main <= 0;
              return (
                <div
                  key={side}
                  style={{
                    display: "flex",
                    gap: 6,
                    fontWeight: active ? "bold" : undefined,
                    opacity: !game.alive.includes(side) ? 0.4 : active ? 1 : 0.75,
                  }}
                >
                  <span style={{ width: 14 }}>{active ? "▶" : ""}</span>
                  <span style={{ color: PANEL_COLORS[side].stroke, minWidth: 130 }}>
                    {seatName(side)}
                  </span>
                  <span
                    style={{
                      color: !byoyomi
                        ? undefined
                        : active && left.byoyomi <= CLOCK_WARN_MS
                        ? "#f87171"
                        : "#fbbf24",
                    }}
                  >
                    {byoyomi
                      ? `讀秒 ${formatTime(left.byoyomi)}`
                      : formatTime(left.main)}
                  </span>
                </div>
              );
            })}
            {clock.pausedAt !== null && (
              <div style={{ fontSize: 13, opacity: 0.7 }}>回放中，計時暫停</div>
            )}
          </div>
        )}
        <div style={{ fontSize: 14, opacity: 0.7 }}>點選：{lastPick}</div>
        {controls && (
          <div style={{ marginTop: 8, pointerEvents: "auto", fontSize: 16 }}>
            {controls}
          </div>
        )}
      </div>

      {/* 私聊：左下、右下分別是畫面上左右兩邊的對手 */}
      <ChatBox {...chatBoxProps(leftOf(me), "left")} />
      <ChatBox {...chatBoxProps(rightOf(me), "right")} />

      {/* 右上：棋譜 */}
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
              回放中，按 ⏭ 回到目前局面
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
              <span title={moveSquares(e)}>{describeMove(e)}</span>
            </li>
          ))}
        </ol>
      </div>

      <Board
        width={size.w}
        height={size.h}
        me={me}
        pieces={shownPieces}
        selectedId={selectedId}
        targets={reviewing ? [] : targets}
        shownMove={shownMove}
        onPick={handlePick}
      />
    </div>
  );
}
