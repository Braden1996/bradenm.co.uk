import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".xml", "application/xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".png", "image/png"],
  [".avif", "image/avif"],
  [".jpg", "image/jpeg"],
  [".woff2", "font/woff2"],
  [".mp4", "video/mp4"],
]);

function headerRules(source) {
  const rules = [];
  let current;
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (!line.startsWith(" ")) {
      const pattern = line
        .trim()
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
      current = { pattern: new RegExp(`^${pattern}$`), headers: new Map() };
      rules.push(current);
    } else {
      const colon = line.indexOf(":");
      if (current && colon > 0)
        current.headers.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
  }
  return rules;
}

/** Serve the built files with the delivery properties that affect browser measurements. */
export async function startPerformanceServer(port = 4175) {
  const root = path.resolve("dist");
  const rules = headerRules(await readFile(path.join(root, "_headers"), "utf8"));
  const server = createServer((request, response) => {
    const serve = async () => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end();
        return;
      }
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const relative = pathname.replace(/^\/+/, "");
      let filename = path.resolve(root, relative);
      if (!filename.startsWith(`${root}${path.sep}`) && filename !== root) {
        response.writeHead(403);
        response.end();
        return;
      }
      let status = 200;
      try {
        const info = await stat(filename);
        if (info.isDirectory()) filename = path.join(filename, "index.html");
        await stat(filename);
      } catch {
        filename = path.join(root, "404.html");
        status = 404;
      }
      for (const rule of rules) {
        if (rule.pattern.test(pathname)) {
          for (const [name, value] of rule.headers) response.setHeader(name, value);
        }
      }
      const extension = path.extname(filename);
      response.setHeader("Content-Type", contentTypes.get(extension) ?? "application/octet-stream");
      response.setHeader("Vary", "Accept-Encoding");
      let data = await readFile(filename);
      const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
      if (range && status === 200) {
        const first = range[1] ? Number(range[1]) : Math.max(0, data.length - Number(range[2]));
        const last =
          range[1] && range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
        if (first > last || first >= data.length) {
          response.writeHead(416, { "Content-Range": `bytes */${data.length}` });
          response.end();
          return;
        }
        response.setHeader("Content-Range", `bytes ${first}-${last}/${data.length}`);
        response.setHeader("Accept-Ranges", "bytes");
        data = data.subarray(first, last + 1);
        status = 206;
      } else if (
        /\b(gzip)\b/.test(request.headers["accept-encoding"] ?? "") &&
        /\.(html|css|js|json|svg|xml|txt)$/.test(filename)
      ) {
        data = gzipSync(data);
        response.setHeader("Content-Encoding", "gzip");
      }
      response.setHeader("Content-Length", data.length);
      response.writeHead(status);
      response.end(request.method === "HEAD" ? undefined : data);
    };
    serve().catch((error) => {
      console.error(error);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PERFORMANCE_PORT ?? 4175);
  await startPerformanceServer(port);
  console.log(`Performance preview: http://127.0.0.1:${port}`);
}
