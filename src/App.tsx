// 進站流程：封面 → 大廳（單機、建房、加入、積分配對、規則、個人資料、我的棋譜、設定、訂閱與客服）→ 對局

import { useEffect, useState } from "react";
import type { MeResponse } from "./protocol";
import { fetchMe, logout, saveName, savedName, savedRoom } from "./net";
import { LocalGame } from "./LocalGame";
import { type OnlineAction, OnlineGame } from "./OnlineGame";
import { RecordsPage } from "./Records";
import { ProfilePage } from "./Profile";
import { SettingsPage } from "./SettingsPage";
import { Lobby } from "./Lobby";
import { RulesPage } from "./RulesPage";
import { PricingPage } from "./PricingPage";
import { SUPPORT_EMAIL } from "./credits";

type Mode =
  | { kind: "menu" }
  | { kind: "local" }
  | { kind: "online"; action: OnlineAction }
  | { kind: "records" }
  | { kind: "profile" }
  | { kind: "rules" }
  | { kind: "pricing" }
  // then：取好暱稱後接著要做的事（例如點邀請連結進來，存好暱稱就進房）
  | { kind: "settings"; notice?: string; then?: OnlineAction };

const NAME_FIRST = "連線對戰前先取個暱稱，別人才知道你是誰";

// 邀請連結帶的房號：?room=ABCDE
const inviteCode = () =>
  new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "";

// 一進站要做的事：點邀請連結進來就進那個房間（沒暱稱先取一個）；
// 不然重新整理前在房間裡的話，直接連回去
function initialMode(): Mode {
  if (location.pathname === PRICING_PATH) return { kind: "pricing" };
  const invite = inviteCode();
  if (invite) {
    const join: OnlineAction = { type: "join", code: invite };
    return savedName() ? { kind: "online", action: join } : { kind: "settings", notice: NAME_FIRST, then: join };
  }
  if (savedRoom() && savedName()) return { kind: "online", action: { type: "resume" } };
  return { kind: "menu" };
}

// 登入沒成功時伺服器導回來會帶 ?login=原因
const LOGIN_NOTICES: Record<string, string> = {
  failed: "登入失敗，請再試一次",
  cancelled: "已取消登入",
  unavailable: "伺服器還沒設定好 Google 登入",
};
// 付款後伺服器導回來會帶 ?billing=結果
const BILLING_NOTICES: Record<string, string> = {
  paid: "付款成功，訂閱已生效",
  pending: "付款處理中，完成後訂閱會自動生效",
  failed: `付款沒有完成。如果已經扣款但訂閱沒生效，請來信 ${SUPPORT_EMAIL} 告訴我們`,
  cancelled: "已取消付款",
};
const NOTICE_PARAMS = { login: LOGIN_NOTICES, billing: BILLING_NOTICES };
const urlNotice = () => {
  const params = new URLSearchParams(location.search);
  for (const [key, notices] of Object.entries(NOTICE_PARAMS)) {
    const notice = notices[params.get(key) ?? ""];
    if (notice) return notice;
  }
  return null;
};

// 訂閱與客服頁有自己的網址，給金流審核或客服直接貼連結
const PRICING_PATH = "/pricing";

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
  const [notice, setNotice] = useState<string | null>(urlNotice);
  // undefined：還在問伺服器；null：伺服器沒回應
  const [me, setMe] = useState<MeResponse | null | undefined>(undefined);
  const [onlineRound, setOnlineRound] = useState(0); // 再配一局時換一個新的連線畫面

  const [mode, setMode] = useState<Mode>(initialMode);

  useEffect(() => {
    // ?login= / ?billing= / ?room= 讀過就從網址拿掉，重新整理才不會又跳提示、又進一次房
    const url = new URL(location.href);
    const keys = [...Object.keys(NOTICE_PARAMS), "room"].filter((key) => url.searchParams.has(key));
    if (keys.length) {
      for (const key of keys) url.searchParams.delete(key);
      history.replaceState(null, "", url);
    }
    let alive = true;
    fetchMe().then((res) => {
      if (!alive) return;
      setMe(res);
      const account = res?.account;
      if (!account) return;
      setName(account.name);
      // 點邀請連結進來時還沒有暱稱，但已經登入：用帳號的名字直接進房
      setMode((m) => {
        if (m.kind !== "settings" || !m.then) return m;
        saveName(account.name);
        return { kind: "online", action: m.then };
      });
    });
    return () => {
      alive = false;
    };
  }, []);

  const backToMenu = (message?: string) => {
    if (location.pathname === PRICING_PATH) history.replaceState(null, "", "/" + location.search);
    setNotice(message ?? null);
    setMode({ kind: "menu" });
    // 剛下完積分對局的話積分變了，重新問一次
    fetchMe().then((res) => res && setMe(res));
  };

  if (mode.kind === "local") return <LocalGame loggedIn={!!me?.account} onExit={() => backToMenu()} />;
  if (mode.kind === "online") {
    return (
      <OnlineGame
        name={name.trim()}
        action={mode.action}
        key={onlineRound}
        rating={me?.account?.rating ?? null}
        onExit={backToMenu}
        onRematch={() => {
          setOnlineRound((r) => r + 1);
          setMode({ kind: "online", action: { type: "match" } });
          // 積分變了，配對畫面上的段位要更新
          fetchMe().then((res) => res && setMe(res));
        }}
      />
    );
  }
  if (mode.kind === "records" && me?.account) {
    return (
      <RecordsPage onSubscribe={() => setMode({ kind: "profile" })} onExit={() => backToMenu()} />
    );
  }

  if (mode.kind === "profile" && me?.account) {
    const account = me.account;
    return (
      <ProfilePage
        subscription={account.subscription}
        payments={me.payments}
        fakeBilling={me.fakeBilling}
        onSubscriptionChange={(subscription) =>
          setMe({ ...me, account: { ...account, subscription } })
        }
        onExit={() => backToMenu()}
      />
    );
  }
  if (mode.kind === "rules") return <RulesPage onExit={() => backToMenu()} />;
  if (mode.kind === "pricing") return <PricingPage onExit={() => backToMenu()} />;
  if (mode.kind === "settings") {
    return (
      <SettingsPage
        name={name}
        loggedIn={!!me?.account}
        notice={mode.notice}
        onNameSaved={(saved) => {
          setName(saved);
          if (me?.account) setMe({ ...me, account: { ...me.account, name: saved } });
          // 是為了連線才來取暱稱的：存好就接著連線
          if (mode.then) {
            setNotice(null);
            setMode({ kind: "online", action: mode.then });
          }
        }}
        onExit={() => backToMenu()}
      />
    );
  }

  const trimmed = name.trim();
  const goOnline = (action: OnlineAction) => {
    // 沒暱稱就先帶去設定取一個，存好再連線
    if (!trimmed) {
      setMode({ kind: "settings", notice: NAME_FIRST, then: action });
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
      code={code}
      onCodeChange={setCode}
      notice={notice}
      opened={opened}
      onOpen={() => {
        rememberCoverOpened();
        setOpened(true);
      }}
      onCreate={() => goOnline({ type: "create" })}
      onMatch={() => {
        if (me?.account) goOnline({ type: "match" });
        else setNotice("積分配對要先登入，輸贏才有地方記分");
      }}
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
      onRules={() => setMode({ kind: "rules" })}
      onPricing={() => setMode({ kind: "pricing" })}
      onRecords={() => setMode({ kind: "records" })}
      onProfile={() => setMode({ kind: "profile" })}
      onSettings={() => setMode({ kind: "settings" })}
      onLogout={async () => {
        if (!me) return;
        if (await logout()) setMe({ ...me, account: null });
        else setNotice("登出失敗，請再試一次");
      }}
    />
  );
}
