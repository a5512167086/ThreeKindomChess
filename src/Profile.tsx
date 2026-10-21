// 個人資料：段位與積分、戰績、訂閱（要登入）

import { useEffect, useState } from "react";
import {
  type PaymentProvider,
  type Plan,
  type ProfileResponse,
  type SubscriptionInfo,
  PLAN_NAMES,
  formatPrice,
} from "./protocol";
import { checkout, fakeCancel, fakeSubscribe, fetchProfile } from "./net";
import { POINTS_PER_DIVISION, rankOf } from "./rank";
import { SheetPage } from "./SheetPage";
import { SUPPORT_EMAIL } from "./credits";

const PLANS = Object.keys(PLAN_NAMES) as Plan[];

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("zh-TW", { dateStyle: "long" });

const percent = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}%` : "—";

type Billing = {
  subscription: SubscriptionInfo | null;
  payments: PaymentProvider[];
  fakeBilling: boolean;
  onSubscriptionChange: (s: SubscriptionInfo | null) => void;
};

export function ProfilePage({ onExit, ...billing }: Billing & { onExit: () => void }) {
  // undefined：讀取中；null：讀取失敗
  const [profile, setProfile] = useState<ProfileResponse | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetchProfile().then((p) => alive && setProfile(p));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <SheetPage title="個人資料" onExit={onExit}>
      {profile === undefined && <p className="note">讀取中…</p>}
      {profile === null && <p>讀不到個人資料，請確認伺服器有在執行，或重新登入。</p>}
      {profile && <ProfileBody profile={profile} />}
      {profile && <SubscriptionSection {...billing} />}
    </SheetPage>
  );
}

function ProfileBody({ profile }: { profile: ProfileResponse }) {
  const rank = rankOf(profile.rating);
  const { rated } = profile.stats;
  const into = profile.rating % POINTS_PER_DIVISION;

  return (
    <>
      <section className="sheet-section">
        <div className="profile-who">
          {profile.avatarUrl && <img src={profile.avatarUrl} alt="" referrerPolicy="no-referrer" />}
          <div>
            <p className="profile-name">{profile.name}</p>
            <p className="note">{formatDate(profile.joinedAt)}加入</p>
          </div>
        </div>
      </section>

      <section className="sheet-section">
        <h2>段位</h2>
        <div className="rank">
          <span className="rank-seal" aria-hidden>
            {rank.tier}
          </span>
          <span className="rank-division" aria-hidden>
            {rank.division}
          </span>
          <span className="sr-only">{rank.label}</span>
          <div className="rank-points">
            <p>
              <b>{profile.rating}</b> 分
            </p>
            {rank.toNext === null ? (
              <p className="note">已是最高段位</p>
            ) : (
              <>
                <div
                  className="progress"
                  role="progressbar"
                  aria-label="升段進度"
                  aria-valuemin={0}
                  aria-valuemax={POINTS_PER_DIVISION}
                  aria-valuenow={into}
                >
                  <span style={{ width: `${into}%` }} />
                </div>
                <p className="note">
                  再 {rank.toNext} 分升{rankOf(profile.rating + rank.toNext).label}
                </p>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="sheet-section">
        <h2>戰績</h2>
        <p className="note">積分局 {rated.games} 局，第一名率 {percent(rated.places[0], rated.games)}</p>
        <dl className="stats">
          <Stat label="積分局" value={rated.games} />
          <Stat label="第一名" value={rated.places[0]} />
          <Stat label="第二名" value={rated.places[1]} />
          <Stat label="第三名" value={rated.places[2]} />
        </dl>
      </section>

    </>
  );
}

// 訂閱：狀態與購買按鈕，每個金流一排（藍新收台幣、PayPal 收美金）。
// 不會自動續扣，訂閱中再買就從原本的到期日往後延
function SubscriptionSection({ subscription, payments, fakeBilling, onSubscriptionChange }: Billing) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 成功的話整頁會離開去付款頁，所以不用把 busy 改回來
  const pay = async (plan: Plan, provider: PaymentProvider) => {
    setBusy(true);
    setError(null);
    if (!(await checkout(plan, provider))) {
      setBusy(false);
      setError("打不開付款頁，請再試一次");
    }
  };

  const fakeChange = async (action: Plan | "cancel") => {
    setBusy(true);
    setError(null);
    const next = action === "cancel" ? ((await fakeCancel()) ? null : undefined) : await fakeSubscribe(action);
    setBusy(false);
    if (next === undefined) setError("訂閱狀態更新失敗，請再試一次");
    else onSubscriptionChange(next);
  };

  return (
    <section className="sheet-section">
      <h2>訂閱</h2>
      {subscription ? (
        <p>
          {PLAN_NAMES[subscription.plan]}，到 {formatDate(subscription.until)}
        </p>
      ) : (
        <p>還沒訂閱。免費帳號每天可以打開三局棋譜，訂閱後不限次數。</p>
      )}

      {payments.map((provider) => (
        <div key={provider} className="plan-row">
          {PLANS.map((plan) => (
            <button key={plan} className="sheet-button" disabled={busy} onClick={() => pay(plan, provider)}>
              {PLAN_NAMES[plan]} {formatPrice(provider, plan)}
            </button>
          ))}
        </div>
      ))}

      {fakeBilling && (
        <div className="plan-row">
          <span className="note plan-provider">開發用（不收費）</span>
          {PLANS.map((plan) => (
            <button key={plan} className="sheet-button" disabled={busy} onClick={() => fakeChange(plan)}>
              {PLAN_NAMES[plan]}
            </button>
          ))}
          {subscription && (
            <button className="sheet-button" disabled={busy} onClick={() => fakeChange("cancel")}>
              取消訂閱
            </button>
          )}
        </div>
      )}

      {!subscription && !payments.length && !fakeBilling && <p className="note">付款功能準備中</p>}
      {payments.length > 0 && (
        <p className="note">
          任何關於訂閱的問題請來信{" "}
          <a className="sheet-link" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
        </p>
      )}
      {error && (
        <p className="note" role="alert" style={{ color: "var(--vermilion)" }}>
          {error}
        </p>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
