// 大廳：單機對電腦，或連線（建房、輸入房號加入、自動配對）

import { useEffect, useState } from "react";
import { type MeResponse, MAX_NAME_LENGTH, PLAN_NAMES } from "./protocol";
import { fetchMe, loginUrl, logout, saveName, savedName, savedRoom } from "./net";
import { LocalGame } from "./LocalGame";
import { type OnlineAction, OnlineGame, Panel } from "./OnlineGame";
import { RecordsPage } from "./Records";

type Mode =
  | { kind: "menu" }
  | { kind: "local" }
  | { kind: "online"; action: OnlineAction }
  | { kind: "records" };

// 邀請連結帶的房號：?room=ABCDE
const inviteCode = () =>
  new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "";

// 登入沒成功時伺服器導回來會帶 ?login=原因
const LOGIN_NOTICES: Record<string, string> = {
  failed: "登入失敗，請再試一次",
  cancelled: "已取消登入",
  unavailable: "伺服器還沒設定好 Google 登入",
};
const loginNotice = () =>
  LOGIN_NOTICES[new URLSearchParams(location.search).get("login") ?? ""] ?? null;

export default function App() {
  const [name, setName] = useState(savedName);
  const [code, setCode] = useState(inviteCode);
  const [notice, setNotice] = useState<string | null>(loginNotice);
  // undefined：還在問伺服器；null：伺服器沒回應
  const [me, setMe] = useState<MeResponse | null | undefined>(undefined);

  useEffect(() => {
    // 提示讀過就把 ?login= 從網址拿掉，重新整理才不會又跳出來
    const url = new URL(location.href);
    if (url.searchParams.has("login")) {
      url.searchParams.delete("login");
      history.replaceState(null, "", url);
    }
    let alive = true;
    fetchMe().then((res) => {
      if (!alive) return;
      setMe(res);
      if (res?.account) setName(res.account.name);
    });
    return () => {
      alive = false;
    };
  }, []);
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
  if (mode.kind === "records" && me?.account) {
    const account = me.account;
    return (
      <RecordsPage
        subscription={account.subscription}
        fakeBilling={me.fakeBilling}
        onSubscriptionChange={(subscription) =>
          setMe({ ...me, account: { ...account, subscription } })
        }
        onExit={() => backToMenu()}
      />
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

      {me?.account ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          {me.account.avatarUrl && (
            <img
              src={me.account.avatarUrl}
              alt=""
              width={32}
              height={32}
              referrerPolicy="no-referrer"
              style={{ borderRadius: "50%" }}
            />
          )}
          <span style={{ flex: 1, minWidth: 0 }}>
            已登入：{me.account.name}
            {me.account.subscription && (
              <span style={{ marginLeft: 6, fontSize: 12, color: "#facc15" }}>
                {PLAN_NAMES[me.account.subscription.plan]}
              </span>
            )}
          </span>
          <button onClick={() => setMode({ kind: "records" })}>我的棋譜</button>
          <button
            onClick={async () => {
              if (await logout()) setMe({ ...me, account: null });
              else setNotice("登出失敗，請再試一次");
            }}
          >
            登出
          </button>
        </div>
      ) : (
        me?.providers.includes("google") && (
          <div style={{ marginBottom: 16 }}>
            <a
              href={loginUrl("google")}
              style={{
                display: "block",
                padding: "8px 12px",
                borderRadius: 6,
                background: "#fff",
                color: "#1f1f1f",
                textAlign: "center",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              使用 Google 帳號登入
            </a>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "#94a3b8" }}>
              不登入也能玩；登入後換電腦也是同一個帳號
            </p>
          </div>
        )
      )}

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
