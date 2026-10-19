// HTTP 小工具：回 JSON、轉址、讀請求內容、檢查是不是從自己的網站送來的

import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BODY_BYTES = 16 * 1024;

export function json(res: ServerResponse, status: number, body: unknown, cookies: string[] = []) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Set-Cookie": cookies,
  });
  res.end(JSON.stringify(body));
}

export function redirect(res: ServerResponse, location: string, cookies: string[] = []) {
  res.writeHead(302, { Location: location, "Set-Cookie": cookies, "Cache-Control": "no-store" });
  res.end();
}

// 會改資料的請求（POST）只接受自己網站送來的，避免別的網站借用玩家的登入 cookie
export const fromOwnSite = (req: IncomingMessage, publicOrigin: string) => {
  const origin = req.headers.origin;
  return !origin || origin === publicOrigin;
};

// 讀 JSON 內容；太大或格式不對回傳 null
export async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}
