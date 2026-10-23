// 三家的顏色、名稱與座標寫法（畫面各處共用）

import type { Pos, Side } from "./rules";

// 把 0..4 轉 A..E
export const rowLabel = (rowIdx: number) => String.fromCharCode(65 + rowIdx);
// 把 0..8 轉 1..9
export const colLabel = (colIdx: number) => (colIdx + 1).toString();

// 棋子樣式（依擁有者上色）
export const PANEL_COLORS: Record<
  Side,
  { fill: string; text: string; stroke: string }
> = {
  Center: { fill: "#fee2e2", text: "#b91c1c", stroke: "#fca5a5" }, // 紅
  Left: { fill: "#e5e7eb", text: "#111827", stroke: "#9ca3af" }, // 黑（灰底黑字）
  Right: { fill: "#dbeafe", text: "#1e3a8a", stroke: "#93c5fd" }, // 藍
};

// 紙底上的各方顏色（對局畫面的棋子、棋譜、狀態）：朱砂、墨、石青
export const SIDE_INK: Record<Side, string> = {
  Center: "#c23b22",
  Left: "#2a2a2a",
  Right: "#3a62a0",
};

export const PANEL_NAMES: Record<Side, string> = {
  Center: "紅",
  Left: "黑",
  Right: "藍",
};

export const sideName = (side: Side) => `${PANEL_NAMES[side]}方`;

// 位置寫法：面板顏色 + 座標，例如「藍C5」
export const squareName = (p: Pos) =>
  `${PANEL_NAMES[p.panel]}${rowLabel(p.row)}${colLabel(p.col)}`;
