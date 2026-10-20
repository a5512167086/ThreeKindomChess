// 內頁的外框：左上回大廳、右邊直書標題、左邊內容

import type { ReactNode } from "react";
import "./pages.css";

export function SheetPage({
  title,
  onExit,
  children,
}: {
  title: string;
  onExit: () => void;
  children: ReactNode;
}) {
  return (
    <div className="sheet">
      <button className="sheet-back" onClick={onExit}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <path d="M10 3L5 8L10 13" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
        回大廳
      </button>
      <div className="sheet-inner">
        <h1 className="sheet-title">{title}</h1>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
