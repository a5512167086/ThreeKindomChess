// 單機模式：同一台電腦上下棋，可以把任意幾家交給電腦

import { useCallback, useEffect, useState } from "react";
import type { Pos, Side } from "./rules";
import { type GameState, TURN_ORDER, newGame, play } from "./game";
import { chooseMove } from "./ai";
import { randomSkyStart } from "./sky";
import {
  type Clock,
  afterMove,
  deadline,
  newClock,
  pauseClock,
  resumeClock,
} from "./clock";
import type { ChatMessage } from "./protocol";
import { GameView } from "./GameView";
import { sideName } from "./sides";

// 電腦每步之間的停頓，讓人看得清楚它走了什麼
const AI_DELAY_MS = 600;

// 單機時坐在畫面下方的一家（聊天也以這家的身分）
const ME: Side = "Center";

// 棋局與時鐘一起更新，走一步時同時扣時間
type Match = { game: GameState; clock: Clock };

const startMatch = (celestial: boolean): Match => ({
  game: newGame({ celestial, skyStart: randomSkyStart() }),
  clock: newClock(Date.now()),
});

function applyMove(m: Match, pieceId: string, to: Pos, now: number): Match {
  const mover = m.game.turn;
  if (!mover) return m;
  const game = play(m.game, pieceId, to);
  if (game === m.game) return m;
  return { game, clock: afterMove(m.clock, mover, now) };
}

export function LocalGame({ onExit }: { onExit: () => void }) {
  // 星象規則：改了之後按重新開始才生效
  const [celestial, setCelestial] = useState(true);
  const [match, setMatch] = useState(() => startMatch(true));
  const { game, clock } = match;
  const [round, setRound] = useState(0); // 重新開始時換掉 GameView，清空選取與回放
  const [chats, setChats] = useState<ChatMessage[]>([]);

  // 哪幾家交給電腦（預設你下紅方，藍、黑給電腦）
  const [aiSides, setAiSides] = useState<Side[]>(["Right", "Left"]);
  const aiTurn = game.turn !== null && aiSides.includes(game.turn);

  // 回放時電腦與時鐘都暫停
  const [reviewing, setReviewing] = useState(false);
  const onReviewingChange = useCallback((r: boolean) => {
    setReviewing(r);
    setMatch((m) => {
      const c = r ? pauseClock(m.clock, Date.now()) : resumeClock(m.clock, Date.now());
      return c === m.clock ? m : { ...m, clock: c };
    });
  }, []);

  // 若這段時間內棋局已變（例如按了重新開始）就不要套用
  const playFor = (from: GameState) => {
    const move = chooseMove(from);
    if (move) {
      setMatch((m) =>
        m.game === from ? applyMove(m, move.pieceId, move.to, Date.now()) : m
      );
    }
  };

  // 輪到電腦：停一下再走
  useEffect(() => {
    if (!aiTurn || reviewing) return;
    const timer = setTimeout(() => playFor(game), AI_DELAY_MS);
    return () => clearTimeout(timer);
  }, [game, aiTurn, reviewing]);

  // 超時：局時加讀秒都用完，由電腦代走一步
  useEffect(() => {
    const turn = game.turn;
    if (!turn || reviewing) return;
    const wait = Math.max(0, deadline(clock, turn) - Date.now());
    const timer = setTimeout(() => playFor(game), wait);
    return () => clearTimeout(timer);
  }, [game, clock, reviewing]);

  const toggleAi = (side: Side) =>
    setAiSides((sides) =>
      sides.includes(side) ? sides.filter((s) => s !== side) : [...sides, side]
    );

  const restart = () => {
    setMatch(startMatch(celestial));
    setChats([]);
    setRound((r) => r + 1);
  };

  const onMove = (pieceId: string, to: Pos) =>
    setMatch((m) => applyMove(m, pieceId, to, Date.now()));

  const onSendChat = (to: Side, text: string) =>
    setChats((c) => [...c, { id: c.length, from: ME, to, text }]);

  return (
    <GameView
      key={round}
      game={game}
      clock={clock}
      me={ME}
      canPlay={!aiTurn}
      turnNote={aiTurn ? "電腦思考中…" : ""}
      seatName={sideName}
      chats={chats}
      onSendChat={onSendChat}
      onMove={onMove}
      onReviewingChange={onReviewingChange}
      controls={
        <>
          <div>
            電腦下：
            {TURN_ORDER.map((side) => (
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
          <div>
            <label style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={celestial}
                onChange={() => setCelestial((c) => !c)}
              />
              星象規則
            </label>
            {celestial !== game.celestial && (
              <span style={{ fontSize: 13, opacity: 0.7 }}>（重新開始後生效）</span>
            )}
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button onClick={restart}>重新開始</button>
            <button onClick={onExit}>回大廳</button>
          </div>
        </>
      }
    />
  );
}
