import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
const manifest = JSON.parse(readFileSync("dist/asset-manifest.json"));
const hash = (b) => createHash("sha256").update(b).digest("hex");
const walk = (p) =>
  readdirSync(p).flatMap((n) =>
    statSync(p + "/" + n).isDirectory() ? walk(p + "/" + n) : [p + "/" + n],
  );
test("all application assets and both HTML entry points match exact content hashes", () => {
  for (const a of manifest.assets) {
    const b = readFileSync(
      a.path === "/" ? "dist/index.html" : "dist" + a.path,
    );
    assert.equal(hash(b), a.sha256);
    assert.equal(b.length, a.bytes);
    if (/\.(js|css)$/.test(a.path)) assert.match(a.path, /\.[a-f0-9]{12}\./);
  }
  const html =
    readFileSync("dist/index.html", "utf8") +
    readFileSync("dist/reader.html", "utf8");
  for (const ref of html.matchAll(/(?:src|href)="(\/assets\/[^"#]+)"/g))
    assert(manifest.assets.some((a) => a.path === ref[1]));
});
test("real app source is attributed, not replaced by a second pagination engine", () => {
  const p = JSON.parse(readFileSync("docs/frontend-provenance.json"));
  assert.equal(p.revision, "4ba14ec34e9c0bb786cba528e0acd9efb8edac6d");
  assert(p.files.some((f) => f.source === "static/reader.js"));
  const s = readFileSync("public/real/reader.js", "utf8");
  assert(s.includes("window.BrowserLibrary.api"));
  assert(s.includes("script-src 'none'"));
  assert(!s.includes("fetch("));
  assert(s.includes("wireReadingGestures"));
});
test("source and exact release contain no private endpoints, keys or remote runtime dependencies", () => {
  for (const p of walk("public").concat(walk("dist"))) {
    if (!/\.(html|css|js|json|svg)$/.test(p)) continue;
    const s = readFileSync(p, "utf8");
    assert(
      !/192\.168\.\d+\.\d+|\/home\/param|tail9ca7cf|-----BEGIN.*PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{20,}/.test(
        s,
      ),
      p,
    );
    if (p.endsWith(".html")) assert(!/<script[^>]+src=["']https?:/.test(s), p);
  }
  const s = readFileSync("public/sample-player.js", "utf8");
  assert.equal((s.match(/fetch\(/g) || []).length, 1);
  assert.match(s,/fetch\(["']\/assets\/signal-room\.mp3["']/);
  assert(!/fetch\(/.test(readFileSync("public/storage.js", "utf8")));
});
test("original licensed neural recording is unchanged", () => {
  assert.equal(
    hash(readFileSync("public/assets/signal-room.mp3")),
    "d70a277915e2a36294261bbfbcdd936c274e69f8a590ff0404f85de7e4e5d6ed",
  );
  assert(readFileSync("public/sample.js", "utf8").includes("At dusk, Mira"));
  assert(
    readFileSync("docs/licenses/kokoro-Apache-2.0.txt", "utf8").includes(
      "Apache License",
    ),
  );
});
