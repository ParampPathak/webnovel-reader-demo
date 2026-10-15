import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { books, excerpt } from "../public/data.js";
const walk = (root) =>
  readdirSync(root).flatMap((name) => {
    const p = `${root}/${name}`;
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
test("original sample content and recording are present", () => {
  assert.equal(books.length, 2);
  assert.equal(books[0].chapters[0].paragraphs[0], excerpt);
  const mp3 = readFileSync("dist/assets/signal-room.mp3");
  assert.equal(mp3.toString("ascii", 0, 3), "ID3");
  assert(mp3.length > 100000 && mp3.length < 300000);
});
test("source and exact static build contain no private endpoints or credentials", () => {
  for (const p of [...walk("public"), ...walk("dist")]) {
    assert(!/\.(env|pem|key|db|sqlite|epub|map)$/.test(p));
    if (!/\.(js|css|html|svg|json)$/.test(p)) continue;
    const text = readFileSync(p, "utf8");
    for (const pattern of [
      /\b192\.168\.\d+\.\d+\b/,
      /\b10\.\d+\.\d+\.\d+\b/,
      /\/home\//,
      /C:\\Users\\/,
      /-----BEGIN .*PRIVATE KEY/,
      /gh[pousr]_[\w]{20,}/,
      /AKIA[A-Z0-9]{16}/,
      /github_pat_[\w]{20,}/,
    ])
      assert(!pattern.test(text), p);
  }
  const app = readFileSync("dist/app.js", "utf8");
  assert(!/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(app));
  const headers = readFileSync("dist/_headers", "utf8");
  for (const policy of [
    "connect-src 'none'",
    "media-src 'self'",
    "frame-src 'none'",
    "script-src 'self'",
    "frame-ancestors 'none'",
    "no-transform",
  ])
    assert(headers.includes(policy));
});
test("navigation, local state, and sample-only importer stay explicit", () => {
  const html = readFileSync("dist/index.html", "utf8");
  for (const id of [
    "reset-confirm",
    "contents-open",
    "previous",
    "next",
    "font",
    "theme",
    "speed",
    "seek",
    "listen",
  ])
    assert(html.includes(`id="${id}"`));
  assert(!html.includes('type="url"'));
  assert(html.includes("No URL entry"));
  assert(html.includes("not individual words"));
  const app = readFileSync("dist/app.js", "utf8");
  assert.match(app, /key\s*=\s*["']reader-demo-v1["']/);
  assert(!app.includes("localStorage.clear"));
});
