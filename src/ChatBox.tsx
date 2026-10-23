import { useEffect, useRef, useState } from "react";

export type ChatLine = {
  key: string;
  mine: boolean;
  name: string;
  color: string;
  text: string;
};

type ChatBoxProps = {
  title: string;
  accent: string; // 對方的代表色
  corner: "left" | "right"; // 放在左下或右下
  open: boolean; // 聊天室是否接通
  closedHint: string; // 未接通時的說明
  lines: ChatLine[];
  onSend: (text: string) => void;
};

// 與某一家的密談便箋；收起時只剩一條書籤（接通的點、未讀數、展開箭頭）
export function ChatBox({
  title,
  accent,
  corner,
  open,
  closedHint,
  lines,
  onSend,
}: ChatBoxProps) {
  const [draft, setDraft] = useState("");

  // 還沒接通時先收起來；收起期間收到的訊息顯示成未讀數
  const [collapsed, setCollapsed] = useState(!open);
  const [seenCount, setSeenCount] = useState(0);
  const unread = collapsed ? Math.max(0, lines.length - seenCount) : 0;
  const toggle = () => {
    if (!collapsed) setSeenCount(lines.length);
    setCollapsed(!collapsed);
  };

  // 有新訊息或展開時捲到最下面
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [lines.length, collapsed]);

  const send = () => {
    const text = draft.trim();
    if (!open || !text) return;
    onSend(text);
    setDraft("");
  };

  return (
    <section className={`chat chat-${corner}${collapsed ? " is-collapsed" : ""}`}>
      <button
        className="chat-toggle"
        onClick={toggle}
        aria-expanded={!collapsed}
        title={collapsed ? "展開" : "收起"}
      >
        {collapsed && <span className={`chat-dot${open ? " on" : ""}`} />}
        <span className="chat-title" style={{ color: accent }}>
          {title}
        </span>
        {!collapsed && (
          <span className={`chat-state${open ? " on" : ""}`}>
            {open ? "已接通" : "未接通"}
          </span>
        )}
        {collapsed && !open && <span className="sr-only">（未接通）</span>}
        {unread > 0 && <span className="chat-badge">{unread}</span>}
        <svg className="chat-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d={collapsed ? "M2 9.5L7 4.5L12 9.5" : "M2 4.5L7 9.5L12 4.5"} stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>

      {!collapsed && (
        <div className="chat-body">
          <div className="chat-lines">
            {lines.length === 0 && <p className="hint">{open ? "還沒有訊息" : closedHint}</p>}
            {lines.map((l) => (
              <p key={l.key}>
                <span style={{ color: l.color, fontWeight: 600 }}>{l.mine ? "你" : l.name}</span>：
                {l.text}
              </p>
            ))}
            <div ref={endRef} />
          </div>

          <div className="chat-input">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              // 中文輸入法選字時按 Enter 不送出
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
              }}
              disabled={!open}
              placeholder={open ? "寫給對方的話" : "還不能密談"}
              aria-label={`${title}的訊息`}
            />
            <button onClick={send} disabled={!open || !draft.trim()}>
              送出
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
