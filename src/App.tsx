// 大廳：單機對電腦，或連線（建房、輸入房號加入、自動配對）

import { useState } from "react";
import { MAX_NAME_LENGTH } from "./protocol";
import { saveName, savedName, savedRoom } from "./net";
import { LocalGame } from "./LocalGame";
import { type OnlineAction, OnlineGame, Panel } from "./OnlineGame";

type Mode =
  | { kind: "menu" }
  | { kind: "local" }
  | { kind: "online"; action: OnlineAction };

// 邀請連結帶的房號：?room=ABCDE
const inviteCode = () =>
  new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "";

export default function App() {
  const [name, setName] = useState(savedName);
  const [code, setCode] = useState(inviteCode);
  const [notice, setNotice] = useState<string | null>(null);
  // 重新整理前在房間裡的話，直接連回去
  const [mode, setMode] = useState<Mode>(() =>
    savedRoom() && savedName()
      ? { kind: "online", action: { type: "resume" } }
      : { kind: "menu" }
  );

  const backToMenu = (message?: string) => {
    setNotice(message ?? null);
    setMode({ kind: "menu" });
  };

  if (mode.kind === "local") return <LocalGame onExit={() => backToMenu()} />;
  if (mode.kind === "online") {
    return (
      <OnlineGame name={name.trim()} action={mode.action} onExit={backToMenu} />
    );
  }

  const trimmed = name.trim();
  const goOnline = (action: OnlineAction) => {
    if (!trimmed) {
      setNotice("連線對戰要先輸入暱稱");
      return;
    }
    saveName(trimmed);
    setNotice(null);
    setMode({ kind: "online", action });
  };

  const row = { display: "flex", gap: 8, marginTop: 12 } as const;

  return (
    <Panel>
      <h1 style={{ margin: "0 0 16px", textAlign: "center" }}>三國象棋</h1>

      <label style={{ display: "block", marginBottom: 4 }}>暱稱</label>
      <input
        value={name}
        maxLength={MAX_NAME_LENGTH}
        onChange={(e) => setName(e.target.value)}
        placeholder="連線時顯示給其他玩家"
        style={{ width: "100%", boxSizing: "border-box" }}
      />

      {notice && <p style={{ color: "#fbbf24", margin: "12px 0 0" }}>{notice}</p>}

      <div style={row}>
        <button style={{ flex: 1 }} onClick={() => goOnline({ type: "create" })}>
          建立房間
        </button>
        <button style={{ flex: 1 }} onClick={() => goOnline({ type: "match" })}>
          自動配對
        </button>
      </div>

      <div style={row}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter" && code.trim()) {
              goOnline({ type: "join", code: code.trim() });
            }
          }}
          placeholder="輸入房號"
          style={{ flex: 1, minWidth: 0, letterSpacing: 2 }}
        />
        <button
          disabled={!code.trim()}
          onClick={() => goOnline({ type: "join", code: code.trim() })}
        >
          加入房間
        </button>
      </div>

      <hr style={{ borderColor: "#334155", margin: "20px 0" }} />

      <button
        style={{ width: "100%" }}
        onClick={() => {
          setNotice(null);
          setMode({ kind: "local" });
        }}
      >
        單機遊玩（對電腦）
      </button>
    </Panel>
  );
}
