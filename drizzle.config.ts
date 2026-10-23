import { defineConfig } from "drizzle-kit";

// yarn db:generate：依 server/schema.ts 產生 SQL 遷移檔（伺服器啟動時會自動套用）
export default defineConfig({
  dialect: "postgresql",
  schema: "./server/schema.ts",
  out: "./server/migrations",
});
