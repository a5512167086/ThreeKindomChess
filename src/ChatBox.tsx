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

// 與某一家的私聊視窗
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

  // 縮小：只留標題列；縮小期間收到的訊息顯示成未讀數
  const [collapsed, setCollapsed] = useState(false);
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
    <div
      style={{
        position: "absolute",
        bottom: 16,
        [corner]: 16,
        width: 260,
        height: collapsed ? "auto" : 220,
        zIndex: 1,
        display: "flex",
        flexDirection: "column",
        background: "rgba(15, 23, 42, 0.9)",
        border: `1px solid ${open ? accent : "#334155"}`,
        borderRadius: 8,
        color: "#e5e7eb",
        fontSize: 13,
        opacity: open ? 1 : 0.75,
      }}
    >
      {/* 標題列：點一下縮小 / 展開 */}
      <div
        onClick={toggle}
        title={collapsed ? "展開" : "縮小"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          borderBottom: collapsed ? "none" : "1px solid #334155",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <span style={{ color: accent, fontWeight: "bold", flex: 1 }}>
          {title}
          {unread > 0 && (
            <span
              style={{
                marginLeft: 6,
                padding: "0 6px",
                borderRadius: 8,
                background: "#dc2626",
                color: "#fff",
                fontSize: 11,
              }}
            >
              {unread}
            </span>
          )}
        </span>
        <span style={{ fontSize: 12, color: open ? "#4ade80" : "#94a3b8" }}>
          {open ? "● 已接通" : "○ 未接通"}
        </span>
        <span style={{ width: 12, textAlign: "center" }}>
          {collapsed ? "＋" : "－"}
        </span>
      </div>

      {!collapsed && (
        <>
          <div style={{ flex: 1, overflowY: "auto", padding: "6px 10px" }}>
            {lines.length === 0 && (
              <div style={{ opacity: 0.5 }}>{open ? "還沒有訊息" : closedHint}</div>
            )}
            {lines.map((l) => (
              <div
                key={l.key}
                style={{ textAlign: l.mine ? "right" : "left", marginBottom: 4 }}
              >
                <span style={{ color: l.color, fontWeight: "bold" }}>{l.name}</span>
                ：{l.text}
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <div
            style={{
              display: "flex",
              gap: 4,
              padding: 6,
              borderTop: "1px solid #334155",
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              // 中文輸入法選字時按 Enter 不送出
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
              }}
              disabled={!open}
              placeholder={open ? "輸入訊息…" : closedHint}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button onClick={send} disabled={!open || !draft.trim()}>
              送出
            </button>
          </div>
        </>
      )}
    </div>
  );
}
