// 對局畫面：棋盤 + 左上狀態 + 右上直書棋譜 + 左下右下密談
// 本機對電腦（LocalGame）、連線對戰（OnlineGame）與看棋譜（Records）共用，
// 差別只在誰能操作、走棋與聊天要送去哪裡。設計稿在 Figma「三垣 UI」的「對弈」。

import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  type Phase,
  PHASE_INFO,
  mansionAt,
  nextPhase,
  phaseAt,
  roundsLeftInPhase,
} from "./sky";
import type { ChatMessage } from "./protocol";
import { ChatBox } from "./ChatBox";
import { KIND_LABELS, chineseNumber, moveNotation } from "./notation";
import { type Clock, formatTime, timeLeft } from "./clock";
import { Board } from "./Board";
import { type Reserve, boardScale } from "./boardGeometry";
import { PANEL_NAMES, SIDE_INK, squareName } from "./sides";
import { useSettings } from "./settings";
import "./game.css";

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

// 局時剩這麼少時加粗
const CLOCK_WARN_MS = 60_000;

// 四象在紙上的顏色：青龍青綠、玄武墨、白虎灰、朱雀朱砂
const PHASE_INK: Record<Phase, string> = {
  dragon: "#2f7d5b",
  tortoise: "#2a2a2a",
  tiger: "#7a7468",
  bird: "#c23b22",
};

// 天象：第一行是四象和效果，第二行小字寫宿名、第幾輪、還剩幾輪換到下一個四象
// sky 是從角宿算起的宿數（開局的宿 + 輪數）
function SkySummary({ round, sky }: { round: number; sky: number }) {
  const phase = phaseAt(sky);
  const info = PHASE_INFO[phase];
  const next = PHASE_INFO[nextPhase(phase)];
  return (
    <section className="sky">
      <p className="sky-line">
        <b style={{ color: PHASE_INK[phase] }}>{info.name}</b>
        {info.effect}
      </p>
      <p className="note sky-note" title={`${next.name}：${next.effect}`}>
        {mansionAt(sky)}宿{"　"}第{chineseNumber(round + 1)}輪{"　"}再
        {chineseNumber(roundsLeftInPhase(sky))}輪轉入{next.name}
      </p>
    </section>
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

// 版面有兩種：狀態和棋譜放棋盤左右（寬螢幕），或放上面、密談在下面（直的或窄的螢幕）。
// 先用大概的尺寸比一比哪一種棋盤比較大，決定之後再量真正的位置
const SIDES_GUESS: Reserve = { left: 230, right: 170, top: 12, bottom: 12 };
const STACKED_GUESS: Reserve = { left: 0, right: 0, top: 290, bottom: 64 };
const prefersStacked = (w: number, h: number) =>
  boardScale(w, h, STACKED_GUESS) > boardScale(w, h, SIDES_GUESS);

// 棋盤和旁邊東西之間至少留這麼多
const BOARD_GAP = 8;
// 疊起來的版面底下留給收起來的密談
const CHAT_ROOM = 64;

// 量左上狀態和右上棋譜實際佔到哪裡，棋盤避開它們。棋譜區寬度固定，走棋不會讓棋盤跳動
type PanelEdges = { statusRight: number; statusBottom: number; movesLeft: number; movesBottom: number };
function usePanelEdges(
  statusRef: RefObject<HTMLElement | null>,
  movesRef: RefObject<HTMLElement | null>,
  layoutKey: string
): PanelEdges | null {
  const [edges, setEdges] = useState<PanelEdges | null>(null);
  useLayoutEffect(() => {
    const status = statusRef.current;
    const moves = movesRef.current;
    if (!status || !moves) return;
    const measure = () => {
      const s = status.getBoundingClientRect();
      const m = moves.getBoundingClientRect();
      const next = { statusRight: s.right, statusBottom: s.bottom, movesLeft: m.left, movesBottom: m.bottom };
      setEdges((prev) =>
        prev &&
        (Object.keys(next) as (keyof PanelEdges)[]).every((k) => Math.round(prev[k]) === Math.round(next[k]))
          ? prev
          : next
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(status);
    observer.observe(moves);
    return () => observer.disconnect();
  }, [statusRef, movesRef, layoutKey]);
  return edges;
}

type GameViewProps = {
  game: GameState;
  clock: Clock | null;
  me: Side; // 畫在下方的那一家，也是聊天時「我」的身分
  canPlay: boolean; // 目前輪到的那一家能不能由這台電腦操作
  turnNote: string; // 狀態列的補充說明，例如「電腦思考中…」
  seatName: (side: Side) => string; // 例如「藍方」「藍方（小明）」
  chats?: ChatMessage[]; // 我看得到的私聊訊息
  onSendChat?: (to: Side, text: string) => void; // 沒給就不顯示聊天框（例如看棋譜）
  onMove: (pieceId: string, to: Pos) => void;
  onReviewingChange?: (reviewing: boolean) => void;
  startAtOpening?: boolean; // 一打開就停在開局（看棋譜用），而不是最後一步
  controls?: ReactNode; // 左上角額外的按鈕區
};

export function GameView({
  game,
  clock,
  me,
  canPlay,
  turnNote,
  seatName,
  chats = [],
  onSendChat,
  onMove,
  onReviewingChange,
  startAtOpening = false,
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

  const statusRef = useRef<HTMLElement>(null);
  const movesRef = useRef<HTMLElement>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const settings = useSettings();

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
  const [viewIndex, setViewIndex] = useState<number | null>(() =>
    startAtOpening && game.history.length > 0 ? 0 : null
  );
  const total = game.history.length;
  const shownIndex = viewIndex ?? total;
  const reviewing = shownIndex < total;
  const shownMove = shownIndex > 0 ? game.history[shownIndex - 1] : undefined;
  const shownPieces = shownMove
    ? shownMove.after
    : game.history[0]?.before ?? game.pieces;
  // 正在看的局面之後下一步所在的輪
  const shownRound = reviewing ? game.history[shownIndex].round : game.round;

  // 左上的選單（回大廳、重新開始…）。還沒動過（null）時：下到一半結束就自動打開，讓「再來一局」看得到；
  // 一打開就已經結束的（看棋譜）不自動打開
  const [menuOpen, setMenuOpen] = useState<boolean | null>(null);
  const [openedFinished] = useState(game.turn === null);
  const showMenu = !!controls && (menuOpen ?? (game.turn === null && !openedFinished));
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showMenu) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [showMenu]);

  useEffect(() => {
    onReviewingChange?.(reviewing);
  }, [reviewing, onReviewingChange]);

  const goTo = (index: number) => {
    setSelectedId(null);
    setViewIndex(index >= total ? null : Math.max(0, index));
  };

  // 鍵盤 ← → 翻棋譜。棋譜由右往左排，所以預設 ← 是較新的一步、→ 是較早的一步；設定裡可以反過來
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 在聊天輸入框裡按方向鍵是移動游標，不是翻棋譜
      if (e.target instanceof HTMLInputElement) return;
      const step = settings.arrowLeftIsNext ? 1 : -1;
      if (e.key === "ArrowLeft") goTo(shownIndex + step);
      else if (e.key === "ArrowRight") goTo(shownIndex - step);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // 棋譜自動捲到正在看的那一步
  const activeMoveRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    activeMoveRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [shownIndex]);

  const handlePick = (pos: Pos) => {
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
        <span style={{ color: SIDE_INK[side] }}>{seatName(side)}</span>
      </span>
    ));

  const chatBoxProps = (partner: Side, corner: "left" | "right") => ({
    title: `與${seatName(partner)}密談`,
    accent: SIDE_INK[partner],
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
        color: SIDE_INK[m.from],
        text: m.text,
      })),
    onSend: (text: string) => onSendChat?.(partner, text),
  });

  // 棋盤避開狀態和棋譜：寬螢幕在左右兩邊，直的螢幕在上面（下面留給密談）
  const stacked = prefersStacked(size.w, size.h);
  const edges = usePanelEdges(statusRef, movesRef, `${stacked} ${size.w} ${size.h}`);
  const reserve: Reserve = !edges
    ? stacked
      ? STACKED_GUESS
      : SIDES_GUESS
    : stacked
      ? {
          left: 0,
          right: 0,
          top: Math.max(edges.statusBottom, edges.movesBottom) + BOARD_GAP,
          bottom: onSendChat ? CHAT_ROOM : 12,
        }
      : {
          left: edges.statusRight + BOARD_GAP,
          right: size.w - edges.movesLeft + BOARD_GAP,
          top: 12,
          bottom: 12,
        };

  return (
    <div className={`game${stacked ? " is-stacked" : ""}`}>
      <div className="game-board">
        <Board
          width={size.w}
          height={size.h}
          me={me}
          pieces={shownPieces}
          selectedId={selectedId}
          targets={reviewing || !settings.showTargets ? [] : targets}
          shownMove={settings.showLastMove ? shownMove : undefined}
          reserve={reserve}
          territory={settings.showTerritory}
          onPick={handlePick}
        />
      </div>

      {/* 左上：選單、輪到誰、將軍、天象、時間 */}
      <aside className="game-status" ref={statusRef}>
        <div className="status-head">
          {controls && (
            <div className="game-menu" ref={menuRef}>
              <button
                className="menu-button"
                onClick={() => setMenuOpen(!showMenu)}
                aria-expanded={showMenu}
                aria-label="選單"
                title="選單"
              >
                <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
                  <path d="M3 5H19M3 11H19M3 17H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              {showMenu && <div className="game-controls">{controls}</div>}
            </div>
          )}
          <TurnHeader game={game} seatName={seatName} turnNote={turnNote} />
        </div>

        {/* 固定一行高（沒事就空著，下面才不會跳動）：這一步的將軍、跳過；沒事時寫誰出局 */}
        <p className="alerts">
          {checked.length > 0 && !game.winner && (
            <span className="alert-check">將軍：{sideList(checked)}{"　"}</span>
          )}
          {game.skipped.length > 0 && (
            <span className="alert-quiet">{sideList(game.skipped)}無棋可走，跳過</span>
          )}
          {!(checked.length > 0 && !game.winner) &&
            game.skipped.length === 0 &&
            game.alive.length < TURN_ORDER.length && (
              <span className="alert-quiet">
                出局：{sideList(TURN_ORDER.filter((s) => !game.alive.includes(s)))}
                {game.timedOut.length > 0 && `（${sideList(game.timedOut)}超時）`}
              </span>
            )}
        </p>

        {(game.celestial || clock) && <hr className="fold-rule" />}
        {game.celestial && <SkySummary round={shownRound} sky={game.skyStart + shownRound} />}

        {/* 三家時間一行；滑鼠移上去看是誰。出局的那家變淡 */}
        {clock && (
          <ul className="clocks">
            {TURN_ORDER.map((side) => {
              const left = timeLeft(clock, side, currentSide, now);
              const active = side === currentSide;
              const out = !game.alive.includes(side);
              return (
                <li
                  key={side}
                  className={out ? "out" : active ? "active" : undefined}
                  title={`${seatName(side)}${game.timedOut.includes(side) ? "（超時）" : ""}`}
                >
                  <SideSeal side={side} />
                  <span
                    className="time"
                    style={active && left <= CLOCK_WARN_MS ? { fontWeight: 700 } : undefined}
                  >
                    {formatTime(left)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* 右上：直書棋譜。由右往左，最新的一步在最左邊 */}
      <aside className="game-moves" aria-label="棋譜" ref={movesRef}>
        <header className="moves-head">
          <h2>棋譜</h2>
          {/* 窄的時候「共幾步」換到第二行（固定兩行，步數變長也不會讓高度跳） */}
          <span className="note">
            <span>{shownIndex === 0 ? "開局" : `第${chineseNumber(shownIndex)}步`}</span>
            <span className="moves-total">共{total === 0 ? "〇" : chineseNumber(total)}步</span>
          </span>
        </header>
        <ol className="move-strip">
          {total === 0 && <li className="empty">還沒走棋</li>}
          {game.history.map((e, i) => (
            <li
              key={i}
              ref={i + 1 === shownIndex ? activeMoveRef : undefined}
              className={i + 1 === shownIndex ? "active" : undefined}
              onClick={() => goTo(i + 1)}
              title={moveSquares(e)}
            >
              <span className="num">{chineseNumber(i + 1)}</span>
              <span className="who" style={{ color: SIDE_INK[e.mover] }}>
                {PANEL_NAMES[e.mover]}
              </span>
              <span className="text">{describeMove(e)}</span>
            </li>
          ))}
        </ol>
        {/* 往左是較新的步，往右是較早的步（鍵盤 ← → 預設也一樣，設定裡可以反過來） */}
        <nav className="move-nav">
          <button onClick={() => goTo(total)} disabled={!reviewing} title="最新" aria-label="最新">
            <NavIcon d="M3 3V17M17 3L6 10L17 17Z" />
          </button>
          <button onClick={() => goTo(shownIndex + 1)} disabled={!reviewing} title="下一步" aria-label="下一步">
            <NavIcon d="M15 3L4 10L15 17Z" />
          </button>
          <button onClick={() => goTo(shownIndex - 1)} disabled={shownIndex === 0} title="上一步" aria-label="上一步">
            <NavIcon d="M5 3L16 10L5 17Z" />
          </button>
          <button onClick={() => goTo(0)} disabled={shownIndex === 0} title="最初" aria-label="最初">
            <NavIcon d="M3 3L14 10L3 17ZM17 3V17" />
          </button>
        </nav>
        <p className="note review-note" hidden={!reviewing}>
          回放中，按最左邊的符號回到目前局面
        </p>
      </aside>

      {/* 密談：左下、右下分別是畫面上左右兩邊的對手 */}
      {onSendChat && (
        <>
          <ChatBox {...chatBoxProps(leftOf(me), "left")} />
          <ChatBox {...chatBoxProps(rightOf(me), "right")} />
        </>
      )}
    </div>
  );
}

// 各方的小方印（紅、黑、藍）
function SideSeal({ side }: { side: Side }) {
  return (
    <span className="side-seal" style={{ background: SIDE_INK[side] }} aria-hidden>
      {PANEL_NAMES[side]}
    </span>
  );
}

// 輪到誰／誰贏了／和局
function TurnHeader({
  game,
  seatName,
  turnNote,
}: {
  game: GameState;
  seatName: (side: Side) => string;
  turnNote: string;
}) {
  const side = game.winner ?? game.turn;
  if (!side) {
    return (
      <div className="turn">
        <span className="side-seal" style={{ background: "var(--grey-ink)" }} aria-hidden>
          和
        </span>
        <div>
          <p className="turn-main">和局</p>
          <p className="turn-sub">
            {game.drawReason === "repetition" ? "局面重複" : "所有人都沒棋可走"}
          </p>
        </div>
      </div>
    );
  }
  const short = `${PANEL_NAMES[side]}方`;
  // 有玩家名字（例如「藍方（小明）」）或補充說明時才多寫一行
  const name = seatName(side);
  const sub = game.winner ? (name !== short ? name : "") : turnNote || (name !== short ? name : "");
  return (
    <div className="turn">
      <SideSeal side={side} />
      <div>
        <p className="turn-main" style={game.winner ? { color: SIDE_INK[side] } : undefined}>
          {game.winner ? `${short}獲勝` : short}
          {/* 朱雀的第二步 */}
          {!game.winner && game.extraMove && <span className="turn-again">再走一步</span>}
        </p>
        {/* 第二行一直留著（沒字就空白），「電腦思考中…」出現消失時下面才不會跳 */}
        <p className="turn-sub">{sub || " "}</p>
      </div>
    </div>
  );
}

function NavIcon({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <path d={d} fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
