// 連線模式：連上伺服器 → 建房 / 加入 / 自動配對 → 等待室 → 對局
//
// 棋局只由伺服器推進：這裡送出「想走的一步」，收到伺服器廣播後
// 才用同一份 play() 套用到本地棋局。

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import type { Side } from "./rules";
import { type GameState, TURN_ORDER, play, replay } from "./game";
import { type ChatMessage, type RoomView, ROOM_SIZE } from "./protocol";
import { type GameSocket, connect, saveRoom } from "./net";
import { type Clock, fromClockView } from "./clock";
import { GameView } from "./GameView";
import { PANEL_COLORS, sideName } from "./sides";

export type OnlineAction =
  | { type: "create" }
  | { type: "join"; code: string }
  | { type: "match" }
  | { type: "resume" }; // 重新整理後回到原本的房間

const ERROR_SHOW_MS = 3000;

export function OnlineGame({
  name,
  action,
  onExit,
}: {
  name: string;
  action: OnlineAction;
  onExit: (notice?: string) => void;
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
    let inRoom = false;
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
      if (!r) {
        setGameState(null);
        setChats([]);
        if (inRoom) onExitRef.current("你已離開房間");
      }
      inRoom = !!r;

      // 連上後第一次收到房間狀態：已經在房間裡就是重連，否則執行要做的事
      if (!pending) return;
      const todo = pending;
      pending = null;
      if (r) return;
      if (todo.type === "create") socket.emit("room:create", report);
      else if (todo.type === "join") socket.emit("room:join", todo.code, report);
      else if (todo.type === "match") socket.emit("match:find", report);
      else onExitRef.current("原本的房間已經不在了");
    });

    socket.on("match:status", setMatching);

    socket.on("game:sync", (moves, clockView) => {
      setGameState(replay(moves));
      setClock(fromClockView(clockView, Date.now()));
    });
    socket.on("game:move", (move, index, clockView) => {
      // 步數對不上（例如漏收）就請伺服器重送整盤
      if (!current || index !== current.history.length) {
        socket.emit("game:resync");
        return;
      }
      const next = play(current, move.pieceId, move.to);
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
            <h2 style={{ marginTop: 0 }}>自動配對中…</h2>
            <p>
              目前排隊 {matching} / {ROOM_SIZE} 人，湊滿就會自動開局
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
    return `${sideName(side)}（${who}${seat.online ? "" : "・離線"}）`;
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
            <div style={{ fontSize: 14, opacity: 0.8 }}>
              房號 {room.code}
              {mySeat && (
                <>
                  ・你是
                  <span style={{ color: PANEL_COLORS[mySeat].stroke }}>
                    {sideName(mySeat)}
                  </span>
                </>
              )}
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              {room.status === "finished" &&
                (isHost ? (
                  <button
                    onClick={() => socketRef.current?.emit("room:start", report)}
                  >
                    再來一局
                  </button>
                ) : (
                  <span style={{ fontSize: 14 }}>等待房主開新局…</span>
                ))}
              <button onClick={leave}>離開房間</button>
            </div>
          </>
        }
      />
    </>
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
    <Panel>
      <div style={{ opacity: 0.7 }}>房號</div>
      <div style={{ fontSize: 40, fontWeight: "bold", letterSpacing: 6 }}>
        {room.code}
      </div>
      <div style={{ display: "flex", gap: 8, margin: "8px 0 16px" }}>
        <input readOnly value={inviteUrl} style={{ flex: 1, minWidth: 0 }} />
        <button onClick={copy}>{copied ? "已複製" : "複製邀請連結"}</button>
      </div>

      <div style={{ marginBottom: 8 }}>
        玩家 {room.members.length} / {ROOM_SIZE}
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px" }}>
        {room.members.map((m) => (
          <li key={m.playerId} style={{ padding: "4px 0" }}>
            {m.online ? "🟢" : "⚪"} {m.name}
            {m.playerId === room.hostId && "（房主）"}
            {m.playerId === me && "（你）"}
          </li>
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <li key={`empty-${i}`} style={{ padding: "4px 0", opacity: 0.5 }}>
            ⚪ 空位
          </li>
        ))}
      </ul>

      <p style={{ fontSize: 14, opacity: 0.7, margin: "0 0 12px" }}>
        紅、藍、黑的座位會在開局時隨機分配
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {isHost ? (
          <button onClick={onStart}>
            開始對局
            {empty > 0 ? `（${empty} 個空位由電腦補上）` : ""}
          </button>
        ) : (
          <span>等待房主開始…</span>
        )}
        <button onClick={onLeave}>離開房間</button>
      </div>
    </Panel>
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
