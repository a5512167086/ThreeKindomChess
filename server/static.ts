// 正式上線時由遊戲伺服器直接送出打包好的網頁（yarn build 產生的 dist/）。
// 開發時網頁由 Vite 送，dist 不存在就不處理。
//
// 找不到檔案的 GET 一律回 index.html，例如 /?room=ABCDE 這種邀請連結

import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
};

export function createStaticHandler(root: string) {
  const index = join(root, "index.html");
  if (!existsSync(index)) return null;

  const isFile = (path: string) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  };

  return (req: IncomingMessage, res: ServerResponse): boolean => {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    // 擋掉 ../ 跑出 dist 的路徑
    const file = normalize(join(root, pathname));
    const inside = file.startsWith(root + sep);
    const target = inside && isFile(file) ? file : index;

    res.writeHead(200, {
      "Content-Type": TYPES[extname(target)] ?? "application/octet-stream",
      // assets/ 裡的檔名有雜湊，內容不會變，可以快取很久；index.html 每次都要重新問
      "Cache-Control": target.includes(`${sep}assets${sep}`)
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(target).pipe(res);
    return true;
  };
}
