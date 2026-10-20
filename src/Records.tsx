// 我的棋譜：列出自己下過的局、打開重播。
// 免費帳號每天能打開的局數有上限（同一天重看同一局不扣），訂閱中不限。

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Side } from "./rules";
import { TURN_ORDER, replay } from "./game";
import {
  type GameRecord,
  type GameSummary,
  type GamesResponse,
  type PaymentProvider,
  type Plan,
  type RatingChange,
  type ReplayQuota,
  type SubscriptionInfo,
  PAYMENT_NAMES,
  PLAN_NAMES,
  formatPrice,
} from "./protocol";
import { checkout, fakeCancel, fakeSubscribe, fetchGames, openGame } from "./net";
import { GameView } from "./GameView";
import { Panel } from "./OnlineGame";
import { PANEL_COLORS, sideName } from "./sides";
import { rankOf } from "./rank";

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-TW", { dateStyle: "medium", timeStyle: "short" });
const formatDate = (iso: string) => new Date(iso).toLocaleDateString("zh-TW");

function resultText(g: GameSummary): { text: string; color: string } {
  if (g.winner === g.mySide) return { text: "勝", color: "#4ade80" };
  if (g.winner) return { text: `負（${sideName(g.winner)}勝）`, color: "#f87171" };
  return { text: g.drawReason === "repetition" ? "和（長打）" : "和", color: "#e5e7eb" };
}

// 對手：「藍方 小明、黑方 電腦」
const opponents = (g: GameSummary) =>
  TURN_ORDER.filter((side) => side !== g.mySide).map((side) => {
    const seat = g.seats[side];
    return (
      <span key={side} style={{ color: PANEL_COLORS[side].stroke, marginRight: 8 }}>
        {sideName(side)} {seat.kind === "ai" ? "電腦" : seat.name}
      </span>
    );
  });

function quotaText(q: ReplayQuota) {
  if (q.subscribed) return "訂閱中：看棋譜不限次數";
  const left = Math.max(0, q.limit - q.usedToday);
  return `今天還能打開 ${left} / ${q.limit} 局（台灣時間午夜重置，今天看過的局重看不扣次數）`;
}

type Props = {
  subscription: SubscriptionInfo | null;
  payments: PaymentProvider[];
  fakeBilling: boolean;
  onSubscriptionChange: (s: SubscriptionInfo | null) => void;
  onExit: () => void;
};

export function RecordsPage({
  subscription,
  payments,
  fakeBilling,
  onSubscriptionChange,
  onExit,
}: Props) {
  // undefined：讀取中；null：讀取失敗
  const [data, setData] = useState<GamesResponse | null | undefined>(undefined);
  const [viewing, setViewing] = useState<GameRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setData(await fetchGames()), []);
  useEffect(() => {
    let alive = true;
    fetchGames().then((res) => alive && setData(res));
    return () => {
      alive = false;
    };
  }, []);

  if (viewing) return <ReplayView record={viewing} onBack={() => setViewing(null)} />;

  const open = async (g: GameSummary) => {
    setBusy(true);
    setNotice(null);
    const res = await openGame(g.id);
    setBusy(false);
    if (res.kind === "ok") {
      setData((d) =>
        d && {
          quota: res.quota,
          games: d.games.map((x) => (x.id === g.id ? { ...x, viewedToday: res.game.viewedToday } : x)),
        }
      );
      setViewing(res.game);
    } else if (res.kind === "quota") {
      setData((d) => d && { ...d, quota: res.quota });
      setNotice(`今天的 ${res.quota.limit} 次已經用完了，明天再來，或訂閱後不限次數。`);
    } else {
      setNotice("打不開這局，請再試一次");
    }
  };

  // 成功的話整頁會離開去付款頁，所以不用把 busy 改回來
  const pay = async (plan: Plan, provider: PaymentProvider) => {
    setBusy(true);
    setNotice(null);
    if (!(await checkout(plan, provider))) {
      setBusy(false);
      setNotice("打不開付款頁，請再試一次");
    }
  };

  const fakeChange = async (action: Plan | "cancel") => {
    setBusy(true);
    const next = action === "cancel" ? ((await fakeCancel()) ? null : undefined) : await fakeSubscribe(action);
    setBusy(false);
    if (next === undefined) {
      setNotice("訂閱狀態更新失敗，請再試一次");
      return;
    }
    setNotice(null);
    onSubscriptionChange(next);
    await load();
  };

  return (
    <Panel style={{ maxWidth: 640 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0, flex: 1 }}>我的棋譜</h2>
        <button onClick={onExit}>回大廳</button>
      </div>

      <SubscriptionBox
        subscription={subscription}
        payments={payments}
        fakeBilling={fakeBilling}
        busy={busy}
        onPay={pay}
        onFake={fakeChange}
      />

      {data && <p style={{ margin: "12px 0", color: "#cbd5e1" }}>{quotaText(data.quota)}</p>}
      {notice && <p style={{ margin: "12px 0", color: "#fbbf24" }}>{notice}</p>}

      {data === undefined && <p>讀取中…</p>}
      {data === null && <p>讀不到棋譜，請確認伺服器有在執行，或重新登入。</p>}
      {data && data.games.length === 0 && (
        <p style={{ color: "#94a3b8" }}>
          還沒有棋譜。登入後下完的連線對局會自動存在這裡（單機對電腦不會存）。
        </p>
      )}
      {data && data.games.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: "50vh", overflowY: "auto" }}>
          {data.games.map((g) => {
            const result = resultText(g);
            return (
              <li
                key={g.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 0",
                  borderTop: "1px solid #1e293b",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>
                    <span style={{ color: PANEL_COLORS[g.mySide].stroke }}>{sideName(g.mySide)}</span>
                    <span style={{ color: result.color, fontWeight: "bold", marginLeft: 8 }}>
                      {result.text}
                    </span>
                    {g.rating && <RatingDiff change={g.rating} />}
                    <span style={{ color: "#94a3b8", marginLeft: 8, fontSize: 13 }}>
                      {formatTime(g.finishedAt)}・{g.moveCount} 步
                    </span>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 2 }}>對手：{opponents(g)}</div>
                </div>
                <button disabled={busy} onClick={() => open(g)}>
                  {g.viewedToday || data.quota.subscribed ? "重播" : "重播（用 1 次）"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// 積分對局：這局加減多少分
function RatingDiff({ change }: { change: RatingChange }) {
  const diff = change.after - change.before;
  return (
    <span
      style={{ marginLeft: 8, fontSize: 13, color: diff >= 0 ? "#4ade80" : "#f87171" }}
      title={`積分 ${change.before} → ${change.after}（${rankOf(change.after).label}）`}
    >
      積分 {diff >= 0 ? `+${diff}` : diff}
    </span>
  );
}

const PLANS = Object.keys(PLAN_NAMES) as Plan[];

// 訂閱狀態與購買按鈕：每個金流一排（藍新收台幣、PayPal 收美金）。
// 不會自動續扣，訂閱中再買就從原本的到期日往後延
function SubscriptionBox({
  subscription,
  payments,
  fakeBilling,
  busy,
  onPay,
  onFake,
}: {
  subscription: SubscriptionInfo | null;
  payments: PaymentProvider[];
  fakeBilling: boolean;
  busy: boolean;
  onPay: (plan: Plan, provider: PaymentProvider) => void;
  onFake: (action: Plan | "cancel") => void;
}) {
  const box = {
    padding: 12,
    borderRadius: 8,
    border: "1px solid #334155",
    background: "#0b1324",
  } as const;
  const row = { display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" } as const;
  const label = { width: 150, fontSize: 13, color: "#94a3b8" } as const;

  return (
    <div style={box}>
      {subscription ? (
        <div>
          <strong style={{ color: "#facc15" }}>{PLAN_NAMES[subscription.plan]}</strong>
          ：訂閱到 {formatDate(subscription.until)}
          {payments.length > 0 && (
            <span style={{ fontSize: 13, color: "#94a3b8" }}>（不會自動扣款，再買一期會往後延）</span>
          )}
        </div>
      ) : (
        <div>訂閱後，看自己的棋譜不限次數</div>
      )}

      {payments.map((provider) => (
        <div key={provider} style={row}>
          <span style={label}>{PAYMENT_NAMES[provider]}</span>
          {PLANS.map((plan) => (
            <button
              key={plan}
              style={{ flex: 1 }}
              disabled={busy}
              onClick={() => onPay(plan, provider)}
            >
              {PLAN_NAMES[plan]} {formatPrice(provider, plan)}
            </button>
          ))}
        </div>
      ))}

      {fakeBilling && (
        <div style={row}>
          <span style={label}>開發用（不收費）</span>
          {PLANS.map((plan) => (
            <button key={plan} style={{ flex: 1 }} disabled={busy} onClick={() => onFake(plan)}>
              {PLAN_NAMES[plan]}
            </button>
          ))}
          {subscription && (
            <button disabled={busy} onClick={() => onFake("cancel")}>
              取消訂閱
            </button>
          )}
        </div>
      )}

      {!subscription && !payments.length && !fakeBilling && (
        <div style={{ marginTop: 8, fontSize: 13, color: "#94a3b8" }}>付款功能準備中</div>
      )}
    </div>
  );
}

// 重播一局：棋盤轉成自己的視角，用右上的棋譜或 ← → 一步一步看
function ReplayView({ record, onBack }: { record: GameRecord; onBack: () => void }) {
  const game = useMemo(
    () => replay(record.moves, { celestial: record.celestial, skyStart: record.skyStart }),
    [record]
  );
  const seatName = (side: Side) => {
    const seat = record.seats[side];
    const who = side === record.mySide ? "你" : seat.kind === "ai" ? "電腦" : seat.name;
    return `${sideName(side)}（${who}）`;
  };
  // 規則改過之後，舊棋譜可能在某一步變成不合法，只能播到那裡
  const incomplete = game.history.length < record.moves.length;

  return (
    <GameView
      game={game}
      clock={null}
      me={record.mySide}
      canPlay={false}
      turnNote=""
      seatName={seatName}
      onMove={() => {}}
      startAtOpening
      controls={
        <>
          <p className="note">
            {formatTime(record.finishedAt)} 的對局。用右上的符號或鍵盤 ← → 一步一步看
          </p>
          {incomplete && (
            <p className="note" style={{ color: "var(--vermilion)" }}>
              這局是舊版規則下的，只能重播前 {game.history.length} 步
            </p>
          )}
          <div className="row">
            <button onClick={onBack}>回棋譜列表</button>
          </div>
        </>
      }
    />
  );
}
