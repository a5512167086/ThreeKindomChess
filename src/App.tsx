// 進站流程：封面 → 大廳（單機、建房、加入、自動配對、我的棋譜）→ 對局

import { useEffect, useState } from "react";
import type { MeResponse } from "./protocol";
import { fetchMe, logout, saveName, savedName, savedRoom } from "./net";
import { LocalGame } from "./LocalGame";
import { type OnlineAction, OnlineGame } from "./OnlineGame";
import { RecordsPage } from "./Records";
import { Lobby } from "./Lobby";

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

// 封面翻開過就記在這個分頁裡，登入回來或重新整理不用再翻一次
const COVER_KEY = "tkc.coverOpened";
const coverOpened = () => {
  try {
    return sessionStorage.getItem(COVER_KEY) === "1";
  } catch {
    return false;
  }
};
const rememberCoverOpened = () => {
  try {
    sessionStorage.setItem(COVER_KEY, "1");
  } catch {
    // 存不了就算了，只是下次要再翻一次封面
  }
};

export default function App() {
  const [opened, setOpened] = useState(coverOpened);
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

  return (
    <Lobby
      me={me}
      name={name}
      onNameChange={setName}
      code={code}
      onCodeChange={setCode}
      notice={notice}
      opened={opened}
      onOpen={() => {
        rememberCoverOpened();
        setOpened(true);
      }}
      onCreate={() => goOnline({ type: "create" })}
      onMatch={() => goOnline({ type: "match" })}
      onJoin={(focusCode) => {
        if (!code.trim()) {
          setNotice("先輸入朋友給的房號");
          focusCode();
          return;
        }
        goOnline({ type: "join", code: code.trim() });
      }}
      onLocal={() => {
        setNotice(null);
        setMode({ kind: "local" });
      }}
      onRecords={() => setMode({ kind: "records" })}
      onLogout={async () => {
        if (!me) return;
        if (await logout()) setMe({ ...me, account: null });
        else setNotice("登出失敗，請再試一次");
      }}
    />
  );
}
