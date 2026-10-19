// 資料表定義（Drizzle）。改了這裡之後要跑 yarn db:generate 產生遷移檔。
//
// 帳號（users）和登入方式（identities）分開：同一個帳號之後可以綁 Google、
// Steam 等好幾種登入方式。

import {
  boolean,
  date,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { DrawReason, MoveMsg, Plan, RecordSeat } from "../src/protocol";
import type { Side } from "../src/rules";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: createdAt(),
});

export const identities = pgTable(
  "identities",
  {
    provider: text("provider").notNull(), // "google"，之後可以加 "steam"
    providerUserId: text("provider_user_id").notNull(), // 該登入方式給的固定編號（Google 是 sub）
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerUserId] })]
);

// 登入憑證：瀏覽器的 cookie 裡放原始 token，這裡只存它的雜湊
export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// ---- 棋譜 ----

// 一局結束後的完整紀錄；只有至少一位登入玩家參加的對局才會存
export const games = pgTable("games", {
  id: uuid("id").primaryKey().defaultRandom(),
  celestial: boolean("celestial").notNull(), // 有沒有星象（重播要用同一套規則）
  moves: jsonb("moves").$type<MoveMsg[]>().notNull(),
  seats: jsonb("seats").$type<Record<Side, RecordSeat>>().notNull(), // 開局時三家各是誰
  winner: text("winner").$type<Side>(),
  drawReason: text("draw_reason").$type<DrawReason>(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
});

// 哪些帳號下過這一局、坐哪一家（電腦和訪客不會有這筆）
export const gamePlayers = pgTable(
  "game_players",
  {
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    side: text("side").$type<Side>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.userId] }),
    index("game_players_user_idx").on(t.userId),
  ]
);

// 免費帳號每天看棋譜的紀錄：同一天重看同一局只算一次
export const replayViews = pgTable(
  "replay_views",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(), // 台灣時間的日期
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day, t.gameId] })]
);

// ---- 訂閱 ----

// 每個帳號最多一筆；currentPeriodEnd 之前都算訂閱中
export const subscriptions = pgTable("subscriptions", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  plan: text("plan").$type<Plan>().notNull(),
  provider: text("provider").notNull(), // 目前只有 "fake"（開發用），之後接金流再加
  providerRef: text("provider_ref"), // 金流那邊的訂閱編號
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
