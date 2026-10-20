// 個人資料：段位與積分、戰績、帳號與訂閱（要登入）

import { useEffect, useState } from "react";
import { type ProfileResponse, PLAN_NAMES } from "./protocol";
import { fetchProfile } from "./net";
import { POINTS_PER_DIVISION, rankOf } from "./rank";
import { SheetPage } from "./SheetPage";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("zh-TW", { dateStyle: "long" });

const percent = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}%` : "—";

export function ProfilePage({
  onExit,
  onRecords,
}: {
  onExit: () => void;
  onRecords: () => void; // 去我的棋譜（訂閱也在那裡）
}) {
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
      {profile && <ProfileBody profile={profile} onRecords={onRecords} />}
    </SheetPage>
  );
}

function ProfileBody({ profile, onRecords }: { profile: ProfileResponse; onRecords: () => void }) {
  const rank = rankOf(profile.rating);
  const { rated, all } = profile.stats;
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
        {profile.ratedGames === 0 && (
          <p className="note">還沒下過積分局。從大廳的「積分配對」開始，前十局升降得比較快。</p>
        )}
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
        <p className="note">
          所有存下來的對局 {all.games} 局（含開房、電腦補位）：勝 {all.wins}、和 {all.draws}
        </p>
      </section>

      <section className="sheet-section">
        <h2>訂閱</h2>
        {profile.subscription ? (
          <p>
            {PLAN_NAMES[profile.subscription.plan]}，到 {formatDate(profile.subscription.until)}
          </p>
        ) : (
          <p>
            還沒訂閱。免費帳號每天可以打開三局棋譜，
            <button className="sheet-link" onClick={onRecords}>
              到我的棋譜訂閱
            </button>
            後不限次數。
          </p>
        )}
      </section>
    </>
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
