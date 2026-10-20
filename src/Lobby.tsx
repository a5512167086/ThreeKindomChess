// 大廳：一本奏摺。封面翻開後往右收，停在右邊；內頁由右往左直書，一欄一件事。

import { type RefObject, useRef } from "react";
import { type MeResponse, PLAN_NAMES } from "./protocol";
import { loginUrl } from "./net";
import { rankOf } from "./rank";
import "./lobby.css";

type Props = {
  me: MeResponse | null | undefined; // undefined：還在問伺服器；null：伺服器沒回應
  name: string;
  code: string;
  onCodeChange: (code: string) => void;
  notice: string | null;
  opened: boolean; // 封面翻開了沒
  onOpen: () => void;
  onCreate: () => void;
  onMatch: () => void;
  onJoin: (focusCode: () => void) => void; // 沒填房號時會叫它把游標移到房號
  onLocal: () => void;
  onRules: () => void;
  onRecords: () => void;
  onProfile: () => void;
  onSettings: () => void;
  onLogout: () => void;
};

export function Lobby(props: Props) {
  const { opened } = props;
  const codeRef = useRef<HTMLInputElement>(null);

  return (
    <div className={`memorial${opened ? " is-open" : ""}`}>
      {/* 內頁：DOM 順序就是閱讀順序（由右往左） */}
      <main className="pages" inert={!opened}>
        <section className="fold intro">
          <p>
            三家同盤對弈的象棋。
            <br />
            二十八宿每輪推進一宿，四象輪轉，改變棋子走法。
          </p>
        </section>

        <AccountFold {...props} />

        <section className="fold">
          <button className="action" onClick={props.onRules}>
            <span className="action-label">規則</span>
            <span className="action-desc">走法、天象與勝負</span>
          </button>
        </section>

        <MatchFold {...props} />

        <section className="fold">
          <button className="action" onClick={props.onCreate}>
            <span className="action-label">建立房間</span>
            <span className="action-desc">開一間新房，把房號傳給朋友</span>
          </button>
        </section>

        <JoinFold {...props} codeRef={codeRef} />

        <section className="fold">
          <button className="action" onClick={props.onLocal}>
            <span className="action-label">單機</span>
            <span className="action-desc">和兩個電腦對弈</span>
          </button>
        </section>

        <section className="fold">
          <button className="action" onClick={props.onSettings}>
            <span className="action-label">設定</span>
            <span className="action-desc">
              {props.name.trim() ? `暱稱：${props.name.trim()}` : "取個暱稱、調整對弈輔助"}
            </span>
          </button>
        </section>

        {props.notice && (
          <p className="notice" role="status">
            {props.notice}
          </p>
        )}
      </main>

      {/* 封面：翻開後就是右邊那一欄 */}
      <aside className="cover">
        <div className="slip">
          <h1 className="slip-title">三垣</h1>
          <p className="slip-sub">三人象棋</p>
        </div>
        <button
          className="seal"
          onClick={props.onOpen}
          tabIndex={opened ? -1 : 0}
          aria-hidden={opened}
        >
          開始遊戲
        </button>
      </aside>
    </div>
  );
}

// 帳號：沒登入就是登入按鈕；登入後是「個人資料」，底下小字是我的棋譜和登出
function AccountFold({ me, onProfile, onRecords, onLogout }: Props) {
  if (me?.account) {
    const plan = me.account.subscription && PLAN_NAMES[me.account.subscription.plan];
    return (
      <section className="fold">
        <div className="account">
          <button className="action" onClick={onProfile}>
            <span className="action-label">個人資料</span>
            <span className="action-desc">
              已登入：{me.account.name}
              {plan && `（${plan}）`}
            </span>
          </button>
          <div className="account-links">
            <button className="action-small" onClick={onRecords}>
              我的棋譜
            </button>
            <button className="action-small" onClick={onLogout}>
              登出
            </button>
          </div>
        </div>
      </section>
    );
  }
  // 伺服器沒開或沒設定登入方式就不顯示
  if (!me?.providers.includes("google")) return null;
  return (
    <section className="fold">
      <a className="action" href={loginUrl("google")}>
        <span className="action-label">帳號登入</span>
        <span className="action-desc">用 Google 帳號，不登入也能玩</span>
      </a>
    </section>
  );
}

// 積分配對：登入後寫自己的段位；沒登入提醒要先登入
function MatchFold({ me, onMatch }: Props) {
  const account = me?.account;
  const rank = account && rankOf(account.rating);
  return (
    <section className="fold">
      <button className="action" onClick={onMatch}>
        <span className="action-label">積分配對</span>
        <span className="action-desc">
          {rank ? (
            <>
              {rank.label}
              {"　"}
              <span className="upright">{account.rating}</span>分
              {rank.toNext !== null && (
                <>
                  ，再<span className="upright">{rank.toNext}</span>分升段
                </>
              )}
            </>
          ) : (
            "配到段位相近的對手，要先登入"
          )}
        </span>
      </button>
    </section>
  );
}

// 加入房間：直的房號輸入框（暱稱在設定裡改）
function JoinFold({
  code,
  onCodeChange,
  onJoin,
  codeRef,
}: Props & { codeRef: RefObject<HTMLInputElement | null> }) {
  const join = () => onJoin(() => codeRef.current?.focus());
  return (
    <section className="fold join">
      <div className="join-row">
        <button className="action" onClick={join}>
          <span className="action-label">加入房間</span>
        </button>
        <input
          ref={codeRef}
          className="code-input"
          value={code}
          onChange={(e) => onCodeChange(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") join();
          }}
          placeholder="輸入房號"
          aria-label="房號"
          maxLength={8}
          autoComplete="off"
        />
      </div>
    </section>
  );
}
