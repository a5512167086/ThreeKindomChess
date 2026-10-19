// 資料表定義（Drizzle）。改了這裡之後要跑 yarn db:generate 產生遷移檔。
//
// 帳號（users）和登入方式（identities）分開：同一個帳號之後可以綁 Google、
// Steam 等好幾種登入方式。

import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

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
