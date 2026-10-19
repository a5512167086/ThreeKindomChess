// 資料庫連線：有 DATABASE_URL 就連那個 PostgreSQL（例如 Neon），
// 沒有的話用 PGlite 在本機資料夾跑一個 PostgreSQL，開發時不用另外架。
// 兩種都會在啟動時自動套用 server/migrations 裡的遷移檔。

import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import * as schema from "./schema";

const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url));

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type DbOptions = {
  url?: string; // PostgreSQL 連線字串
  pgliteDir?: string; // 沒有 url 時 PGlite 的資料夾；"memory://" 表示只放記憶體
};

export async function openDb({ url, pgliteDir = ".data/pglite" }: DbOptions = {}): Promise<{
  db: Db;
  label: string;
}> {
  if (url) {
    const db = drizzlePostgres(url, { schema });
    await migratePostgres(db, { migrationsFolder });
    return { db, label: `PostgreSQL（${new URL(url).host}）` };
  }
  if (!pgliteDir.startsWith("memory://")) mkdirSync(pgliteDir, { recursive: true });
  const db = drizzlePglite({ connection: { dataDir: pgliteDir }, schema });
  await migratePglite(db, { migrationsFolder });
  return { db, label: `本機 PGlite（${pgliteDir}）` };
}
