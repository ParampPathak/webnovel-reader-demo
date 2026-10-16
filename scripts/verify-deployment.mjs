import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const origin = process.env.DEMO_URL || "https://reader.parampathak.com";
const git = (args) => execFileSync("git", args, { maxBuffer: 8 * 1024 * 1024 });
const files = git(["ls-tree", "-r", "--name-only", "HEAD", "public"])
  .toString()
  .trim()
  .split("\n");
const receipt = {
  origin,
  commit: git(["rev-parse", "HEAD"]).toString().trim(),
  assets: [],
};
// Verify the URLs users actually load, including their release cache keys.
const html = git(["show", "HEAD:public/index.html"]).toString();
const app = git(["show", "HEAD:public/app.js"]).toString();
const references = [
  ...Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g), (m) => m[1]),
  ...Array.from(app.matchAll(/from "([^"]+)"/g), (m) => m[1]),
];
for (const file of files) {
  if (file === "public/_headers") continue;
  const pathname =
    file === "public/index.html" ? "/" : file.slice("public".length);
  const reference = references.find(
    (value) =>
      new URL(value, origin).origin === new URL(origin).origin &&
      new URL(value, origin).pathname === pathname,
  );
  const assetUrl = new URL(reference || pathname, origin);
  assert.equal(assetUrl.origin, new URL(origin).origin);
  const response = await fetch(assetUrl);
  assert.equal(response.status, 200, pathname);
  const actual = Buffer.from(await response.arrayBuffer());
  const expected = git(["show", "HEAD:" + file]);
  assert(
    actual.equals(expected),
    "Deployed bytes differ from tested Git source: " + pathname,
  );
  receipt.assets.push({
    path: assetUrl.pathname + assetUrl.search,
    bytes: actual.length,
    sha256: createHash("sha256").update(actual).digest("hex"),
  });
  if (pathname === "/") {
    receipt.csp = response.headers.get("content-security-policy");
    receipt.server = response.headers.get("server");
    assert(receipt.csp.includes("connect-src 'self'"));
    assert(receipt.csp.includes("media-src 'self' blob:"));
    assert(response.headers.get("cache-control").includes("no-transform"));
  }
}
mkdirSync("test-results", { recursive: true });
writeFileSync(
  "test-results/deployed-assets.json",
  JSON.stringify(receipt, null, 2),
);
console.log(
  `Verified ${receipt.assets.length} exact deployed assets and isolation headers at ${origin}`,
);
