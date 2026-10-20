// 玩家自己的偏好設定：存在這台電腦的瀏覽器裡（換電腦要重設），改了馬上套用到所有畫面

import { useSyncExternalStore } from "react";

export type Settings = {
  showTargets: boolean; // 選子後標出可以走的位置（綠點、可吃的圈）
  showLastMove: boolean; // 標出上一步（起點、終點與箭頭）
  showTerritory: boolean; // 三家的地盤塗上淡淡的己方顏色
  arrowLeftIsNext: boolean; // 鍵盤 ← 是下一步（棋譜由右往左讀）；false 時 ← 是上一步
};

export const DEFAULT_SETTINGS: Settings = {
  showTargets: true,
  showLastMove: true,
  showTerritory: true,
  arrowLeftIsNext: true,
};

const KEY = "tkc.settings";

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    const merged = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      if (typeof saved[k] === "boolean") merged[k] = saved[k];
    }
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current = load();
const listeners = new Set<() => void>();

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // 存不了就只在這次開著的時候有效
  }
  listeners.forEach((l) => l());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useSettings = (): Settings => useSyncExternalStore(subscribe, () => current);
