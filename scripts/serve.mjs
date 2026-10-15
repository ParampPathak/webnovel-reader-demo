import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
const root = path.resolve("dist");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".webp": "image/webp",
  ".png": "image/png",
};
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const file = path.resolve(
        root,
        "." +
          decodeURIComponent(
            url.pathname === "/" ? "/index.html" : url.pathname,
          ),
      );
      if (!file.startsWith(root + path.sep)) throw Error("Invalid path");
      const bytes = await readFile(file);
      const headers = {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
      };
      const rules = await readFile(path.join(root, "_headers"), "utf8");
      // Production is HTTPS. Only the workstation's HTTP preview omits upgrading.
      for (const line of rules.split("\n")) {
        const match = line.match(/^  ([^:]+): (.+)$/);
        if (match && match[1] !== "Cache-Control")
          headers[match[1]] = match[2].replace(
            "; upgrade-insecure-requests",
            "",
          );
      }
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const start = +range[1],
          end = range[2]
            ? Math.min(+range[2], bytes.length - 1)
            : bytes.length - 1;
        if (start > end) {
          res.writeHead(416, { "Content-Range": `bytes */${bytes.length}` });
          res.end();
          return;
        }
        res.writeHead(206, {
          ...headers,
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
          "Content-Length": end - start + 1,
        });
        res.end(bytes.subarray(start, end + 1));
      } else {
        res.writeHead(200, {
          ...headers,
          "Content-Length": bytes.length,
          "Accept-Ranges": "bytes",
        });
        res.end(bytes);
      }
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(4330, "127.0.0.1", () =>
    console.log("Demo preview on http://127.0.0.1:4330"),
  );
