// 我的棋譜：列出自己下過的局、打開復盤。
// 免費帳號每天能打開的局數有上限（同一天重看同一局不扣），訂閱中不限；訂閱在個人資料。

import { useEffect, useMemo, useState } from "react";
import type { Side } from "./rules";
import { TURN_ORDER, replay } from "./game";
import { type GameRecord, type GameSummary, type GamesResponse, type ReplayQuota } from "./protocol";
import { fetchGames, openGame } from "./net";
import { GameView } from "./GameView";
import { SheetPage } from "./SheetPage";
import { SIDE_INK, sideName } from "./sides";
import { rankOf } from "./rank";

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-TW", { dateStyle: "medium", timeStyle: "short" });

// 列表上的時間：「10月19日 21:30」，不是今年的才寫年份
const formatListTime = (iso: string) => {
  const date = new Date(iso);
  return date.toLocaleString("zh-TW", {
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
};

// 結果印上的字，和第一行的說明：「黑方勝・積分局」「長打判和・開房」
function resultOf(g: GameSummary): { seal: "勝" | "負" | "和"; detail: string } {
  const kind = g.local ? "單機" : g.rating ? "積分局" : "開房";
  if (g.winner === g.mySide) return { seal: "勝", detail: kind };
  if (g.winner) return { seal: "負", detail: `${sideName(g.winner)}勝・${kind}` };
  return { seal: "和", detail: `${g.drawReason === "repetition" ? "長打判和" : "和局"}・${kind}` };
}

// 對手：「藍方 小明、黑方 電腦」
const opponents = (g: GameSummary) =>
  TURN_ORDER.filter((side) => side !== g.mySide)
    .map((side) => {
      const seat = g.seats[side];
      return `${sideName(side)} ${seat.kind === "ai" ? "電腦" : seat.name}`;
    })
    .join("、");

type Props = {
  onSubscribe: () => void; // 去個人資料訂閱
  onExit: () => void;
};

export function RecordsPage({ onSubscribe, onExit }: Props) {
  // undefined：讀取中；null：讀取失敗
  const [data, setData] = useState<GamesResponse | null | undefined>(undefined);
  const [viewing, setViewing] = useState<GameRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <SheetPage title="我的棋譜" onExit={onExit}>
      {data === undefined && <p className="note">讀取中…</p>}
      {data === null && <p>讀不到棋譜，請確認伺服器有在執行，或重新登入。</p>}
      {data && <QuotaSection quota={data.quota} onSubscribe={onSubscribe} />}
      {data && (
        <section className="sheet-section">
          <div className="section-head">
            <h2>對局</h2>
            {data.games.length > 0 && <span className="note">共 {data.games.length} 局，最新的在上面</span>}
          </div>
          {notice && (
            <p className="note" role="alert" style={{ color: "var(--vermilion)" }}>
              {notice}
            </p>
          )}
          {data.games.length === 0 ? (
            <p className="note">還沒有棋譜。登入後下完的對局（連線和單機）會自動存在這裡。</p>
          ) : (
            <ul className="records">
              {data.games.map((g) => (
                <RecordRow
                  key={g.id}
                  game={g}
                  free={g.viewedToday || data.quota.subscribed}
                  busy={busy}
                  onOpen={() => open(g)}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </SheetPage>
  );
}

// 今天還能看幾局：大字數字＋格子（實心是還能看的）
function QuotaSection({ quota, onSubscribe }: { quota: ReplayQuota; onSubscribe: () => void }) {
  if (quota.subscribed) {
    return (
      <section className="sheet-section">
        <h2>今天還能看</h2>
        <p>訂閱中，看棋譜不限次數</p>
      </section>
    );
  }
  const left = Math.max(0, quota.limit - quota.usedToday);
  return (
    <section className="sheet-section">
      <h2>今天還能看</h2>
      <div className="quota">
        <p className="quota-count">
          <b>{left}</b> / {quota.limit} 局
        </p>
        <span className="quota-pips" aria-hidden>
          {Array.from({ length: quota.limit }, (_, i) => (
            <span key={i} className={i < quota.limit - left ? "used" : ""} />
          ))}
        </span>
      </div>
      <p className="note">台灣時間午夜重置；今天看過的局再看不扣次數</p>
      <p>
        <button className="sheet-link" onClick={onSubscribe}>
          訂閱後不限次數
        </button>
      </p>
    </section>
  );
}

// 一局：左邊結果印，中間我方/結果/積分、對手、時間，右邊復盤
function RecordRow({
  game,
  free,
  busy,
  onOpen,
}: {
  game: GameSummary;
  free: boolean; // 今天看過或訂閱中，不扣次數
  busy: boolean;
  onOpen: () => void;
}) {
  const { seal, detail } = resultOf(game);
  const diff = game.rating && game.rating.after - game.rating.before;
  return (
    <li className="record">
      <span className={`record-seal ${seal === "勝" ? "win" : seal === "負" ? "loss" : "draw"}`}>{seal}</span>
      <div className="record-info">
        <p className="record-head">
          <span className="record-side" style={{ color: SIDE_INK[game.mySide] }}>
            {sideName(game.mySide)}
          </span>
          <span className="note">{detail}</span>
          {game.rating && diff !== null && (
            <span
              className="record-rating"
              style={{ color: diff >= 0 ? "var(--green)" : "var(--vermilion)" }}
              title={`積分 ${game.rating.before} → ${game.rating.after}（${rankOf(game.rating.after).label}）`}
            >
              積分 {diff >= 0 ? `+${diff}` : `−${-diff}`}
            </span>
          )}
        </p>
        <p className="record-opponents">對手：{opponents(game)}</p>
        <p className="note">
          {formatListTime(game.finishedAt)}・{game.moveCount} 步
        </p>
      </div>
      <button className="sheet-button" disabled={busy} onClick={onOpen}>
        {free ? "復盤" : "復盤（用 1 次）"}
      </button>
    </li>
  );
}

// 復盤一局：棋盤轉成自己的視角，用右上的棋譜或 ← → 一步一步看
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
              這局是舊版規則下的，只能復盤前 {game.history.length} 步
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
