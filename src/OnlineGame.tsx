// 連線模式：連上伺服器 → 建房 / 加入 / 自動配對 → 等待室 → 對局
//
// 棋局只由伺服器推進：這裡送出「想走的一步」，收到伺服器廣播後
// 才用同一份 play() 套用到本地棋局。

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import type { Side } from "./rules";
import { type GameState, TURN_ORDER, replay, step, stepCount } from "./game";
import { type ChatMessage, type RatingChange, type RoomView, ROOM_SIZE } from "./protocol";
import { type GameSocket, connect, saveRoom } from "./net";
import { type Clock, fromClockView } from "./clock";
import { GameView } from "./GameView";
import { SheetPage } from "./SheetPage";
import { SIDE_INK, sideName } from "./sides";
import { rankOf } from "./rank";

export type OnlineAction =
  | { type: "create" }
  | { type: "join"; code: string }
  | { type: "match" }
  | { type: "resume" }; // 重新整理後回到原本的房間

const ERROR_SHOW_MS = 3000;

export function OnlineGame({
  name,
  action,
  rating,
  onExit,
  onRematch,
}: {
  name: string;
  action: OnlineAction;
  rating: number | null; // 自己的積分（排積分配對時顯示段位）
  onExit: (notice?: string) => void;
  onRematch: () => void; // 積分對局結束後再排一次
}) {
  const [me, setMe] = useState<string | null>(null); // 伺服器給的公開代號
  const socketRef = useRef<GameSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [matching, setMatching] = useState<number | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [chats, setChats] = useState<ChatMessage[]>([]);
  const [clock, setClock] = useState<Clock | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 在 effect 裡用最新的 onExit，但不因為它變了就重連
  const onExitRef = useRef(onExit);
  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  useEffect(() => {
    const socket = connect(name);
    socketRef.current = socket;
    let pending: OnlineAction | null = action;
    let roomCode: string | null = null;
    let current: GameState | null = null;
    const setGameState = (g: GameState | null) => {
      current = g;
      setGame(g);
    };
    const report = (res: { ok: boolean; error?: string }) => {
      if (!res.ok) setError(res.error ?? "發生錯誤");
    };

    socket.on("connect", () => {
      setConnected(true);
      setConnectFailed(false);
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnectFailed(true));
    socket.on("session:me", setMe);

    socket.on("room:state", (r) => {
      setRoom(r);
      saveRoom(r?.code ?? null);
      // 離開房間或換到別的房間：原本的棋局和密談不要了
      if (r?.code !== roomCode) {
        setGameState(null);
        setChats([]);
      }
      if (!r && roomCode) onExitRef.current("你已離開房間");
      roomCode = r?.code ?? null;

      // 連上後第一次收到房間狀態：已經在房間裡就是重連，否則執行要做的事。
      // 要加入的是別的房間（點了新的邀請連結）就換過去
      if (!pending) return;
      const todo = pending;
      pending = null;
      if (todo.type === "join" && r?.code !== todo.code) socket.emit("room:join", todo.code, report);
      else if (r) return;
      else if (todo.type === "create") socket.emit("room:create", report);
      else if (todo.type === "match") socket.emit("match:find", report);
      else onExitRef.current("原本的房間已經不在了");
    });

    socket.on("match:status", setMatching);

    socket.on("game:sync", (moves, clockView, setup) => {
      setGameState(replay(moves, setup));
      setClock(fromClockView(clockView, Date.now()));
    });
    socket.on("game:move", (move, index, clockView) => {
      // 步數對不上（例如漏收）就請伺服器重送整盤
      if (!current || index !== stepCount(current)) {
        socket.emit("game:resync");
        return;
      }
      const next = step(current, move);
      if (next === current) {
        socket.emit("game:resync");
        return;
      }
      setGameState(next);
      setClock(fromClockView(clockView, Date.now()));
    });

    socket.on("chat:sync", setChats);
    socket.on("chat:message", (m) => setChats((c) => [...c, m]));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [name, action]);

  // 錯誤訊息幾秒後自動消失
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), ERROR_SHOW_MS);
    return () => clearTimeout(timer);
  }, [error]);

  const report = (res: { ok: boolean; error?: string }) => {
    if (!res.ok) setError(res.error ?? "發生錯誤");
  };

  const leave = () => {
    socketRef.current?.emit("room:leave");
    saveRoom(null);
    onExit();
  };
  const rematch = () => {
    socketRef.current?.emit("room:leave");
    saveRoom(null);
    onRematch();
  };

  const errorToast = error && (
    <div
      style={{
        position: "fixed",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10,
        padding: "8px 16px",
        borderRadius: 8,
        background: "#7f1d1d",
        color: "#fee2e2",
      }}
    >
      {error}
    </div>
  );

  if (!connected || !me) {
    return (
      <Panel>
        {errorToast}
        <p>{connectFailed ? "連不上伺服器，請確認伺服器有在執行（yarn server）" : "連線中…"}</p>
        <button onClick={() => onExit()}>回大廳</button>
      </Panel>
    );
  }

  if (!room) {
    return (
      <Panel>
        {errorToast}
        {matching !== null ? (
          <>
            <h2 style={{ marginTop: 0 }}>積分配對中…</h2>
            {rating !== null && (
              <p>
                你是{rankOf(rating).label}（{rating} 分）
              </p>
            )}
            <p>
              目前有 {matching} 人在排。會先找分數相近的對手，等越久範圍放越寬
            </p>
            <button
              onClick={() => {
                socketRef.current?.emit("match:cancel");
                onExit();
              }}
            >
              取消
            </button>
          </>
        ) : (
          <>
            <p>{error ?? "處理中…"}</p>
            <button onClick={() => onExit()}>回大廳</button>
          </>
        )}
      </Panel>
    );
  }

  if (room.status === "waiting" || !game || !room.seats) {
    return (
      <>
        {errorToast}
        <WaitingRoom
          room={room}
          me={me}
          onStart={() => socketRef.current?.emit("room:start", report)}
          onLeave={leave}
        />
      </>
    );
  }

  const seats = room.seats;
  const mySeat =
    TURN_ORDER.find((side) => {
      const seat = seats[side];
      return seat.kind === "human" && seat.playerId === me;
    }) ?? null;

  const seatName = (side: Side) => {
    const seat = seats[side];
    if (seat.kind === "ai") return `${sideName(side)}（電腦）`;
    const who = seat.playerId === me ? "你" : seat.name;
    const rank = seat.rating === null ? "" : `，${rankOf(seat.rating).label}`;
    return `${sideName(side)}（${who}${rank}${seat.online ? "" : "，離線"}）`;
  };

  const turnSeat = game.turn ? seats[game.turn] : null;
  const turnNote =
    game.turn === null || !turnSeat
      ? ""
      : game.turn === mySeat
      ? "輪到你了"
      : turnSeat.kind === "ai"
      ? "電腦思考中…"
      : turnSeat.online
      ? "等待對手…"
      : "等待對手重新連線…";

  const isHost = room.hostId === me;

  return (
    <>
      {errorToast}
      <GameView
        key={room.round}
        game={game}
        clock={clock}
        me={mySeat ?? "Center"}
        canPlay={mySeat !== null && game.turn === mySeat}
        turnNote={turnNote}
        seatName={seatName}
        chats={chats}
        onSendChat={(to, text) =>
          socketRef.current?.emit("chat:send", to, text, report)
        }
        onMove={(pieceId, to) =>
          socketRef.current?.emit("game:move", { pieceId, to }, report)
        }
        controls={
          <>
            <p className="note">
              房號 {room.code}
              {mySeat && (
                <>
                  ，你是
                  <span style={{ color: SIDE_INK[mySeat] }}>{sideName(mySeat)}</span>
                </>
              )}
            </p>
            {room.rated && room.status === "finished" && (
              <RatingResult change={mySeat ? room.ratingChanges?.[mySeat] : undefined} pending={!room.ratingChanges} />
            )}
            <div className="row">
              <button onClick={leave}>離開房間</button>
              {room.status === "finished" && room.rated && (
                <button onClick={rematch}>再配一局</button>
              )}
              {room.status === "finished" &&
                !room.rated &&
                (isHost ? (
                  <button
                    onClick={() => socketRef.current?.emit("room:start", report)}
                  >
                    再來一局
                  </button>
                ) : (
                  <span className="note">等待房主開新局…</span>
                ))}
            </div>
          </>
        }
      />
    </>
  );
}

// 積分對局結束：這局加減多少分、有沒有升降段
function RatingResult({
  change,
  pending,
}: {
  change: RatingChange | undefined;
  pending: boolean;
}) {
  if (pending) return <p className="note">算分中…</p>;
  if (!change) return null;
  const diff = change.after - change.before;
  const before = rankOf(change.before);
  const after = rankOf(change.after);
  const moved = before.label !== after.label;
  return (
    <p>
      積分 {change.before} → {change.after}
      <span style={{ color: diff >= 0 ? "var(--green)" : "var(--vermilion)", marginLeft: 6 }}>
        {diff >= 0 ? `+${diff}` : diff}
      </span>
      {moved && (
        <>
          <br />
          {change.after > change.before ? "升上" : "降到"}
          {after.label}
        </>
      )}
    </p>
  );
}

// ---- 等待室 ----

function WaitingRoom({
  room,
  me,
  onStart,
  onLeave,
}: {
  room: RoomView;
  me: string;
  onStart: () => void;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const inviteUrl = `${location.origin}${location.pathname}?room=${room.code}`;
  const isHost = room.hostId === me;
  const empty = ROOM_SIZE - room.members.length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <SheetPage title={isHost ? "建立房間" : "加入房間"} exitLabel="離開房間" onExit={onLeave}>
      <section className="sheet-section">
        <h2>房號</h2>
        <p className="room-code">{room.code}</p>
        <p className="note">把房號或邀請連結傳給朋友，他們在大廳「加入房間」輸入房號就能進來</p>
        <div className="field invite">
          <input
            type="text"
            readOnly
            value={inviteUrl}
            aria-label="邀請連結"
            onFocus={(e) => e.target.select()}
          />
          <button className="sheet-button" onClick={copy}>
            {copied ? "已複製" : "複製邀請連結"}
          </button>
        </div>
      </section>

      <section className="sheet-section">
        <div className="section-head">
          <h2>玩家</h2>
          <span className="note">
            {room.members.length} / {ROOM_SIZE}
          </span>
        </div>
        <ul className="seats">
          {room.members.map((m) => {
            const tags = [m.playerId === room.hostId && "房主", m.playerId === me && "你"]
              .filter(Boolean)
              .join("・");
            return (
              <li key={m.playerId} className={`seat${m.online ? "" : " offline"}`}>
                <span className={`seat-dot${m.online ? " online" : ""}`} />
                <span className="seat-name">{m.name}</span>
                {tags && <span className="seat-tag">{tags}</span>}
                <span className="note seat-note">{m.online ? "已連線" : "離線"}</span>
              </li>
            );
          })}
          {Array.from({ length: empty }, (_, i) => (
            <li key={`empty-${i}`} className="seat empty">
              <span className="seat-dot" />
              <span className="seat-name">空位</span>
              <span className="note seat-note">開局時由電腦補上</span>
            </li>
          ))}
        </ul>
        <p className="note">紅、藍、黑的座位會在開局時隨機分配</p>
      </section>

      <section className="sheet-section">
        <div className="start-row">
          {isHost ? (
            <>
              <button className="sheet-button primary" onClick={onStart}>
                開始對局
              </button>
              <span className="note">{empty > 0 ? `${empty} 個空位由電腦補上` : "人到齊了"}</span>
            </>
          ) : (
            <>
              <span>等待房主開始…</span>
              <span className="note">房主按下開始後就會開局，空位由電腦補上</span>
            </>
          )}
        </div>
      </section>
    </SheetPage>
  );
}

// 置中的卡片
export function Panel({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          padding: 24,
          borderRadius: 12,
          background: "#111a2e",
          border: "1px solid #334155",
          color: "#e5e7eb",
          ...style,
        }}
      >
        {children}
      </div>
    </div>
  );
}
