import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const origin = process.env.DEMO_URL || "https://reader.parampathak.com";
const manifestBytes = await readFile("dist/asset-manifest.json");
const manifest = JSON.parse(manifestBytes);
const receipt = {
  origin,
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  assets: [],
};
for (const entry of manifest.assets) {
  const response = await fetch(new URL(entry.path, origin));
  assert.equal(response.status, 200, entry.path);
  const actual = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(actual).digest("hex");
  assert.equal(
    sha256,
    entry.sha256,
    "Deployed bytes differ from tested build: " + entry.path,
  );
  assert.equal(actual.length, entry.bytes, entry.path);
  receipt.assets.push({ path: entry.path, bytes: actual.length, sha256 });
  if (entry.path === "/") {
    receipt.csp = response.headers.get("content-security-policy");
    receipt.server = response.headers.get("server");
    assert(receipt.csp.includes("connect-src 'self'"));
    assert(receipt.csp.includes("media-src 'self' blob:"));
    assert(response.headers.get("cache-control").includes("no-transform"));
    assert(response.headers.get("cache-control").includes("no-cache"));
  } else assert(response.headers.get("cache-control").includes("immutable"));
}
const manifestResponse = await fetch(new URL("/asset-manifest.json", origin));
assert.equal(manifestResponse.status, 200);
assert(
  Buffer.from(await manifestResponse.arrayBuffer()).equals(manifestBytes),
  "Release manifest mismatch",
);
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/deployed-assets.json",
  JSON.stringify(receipt, null, 2),
);
console.log(
  `Verified ${receipt.assets.length} exact fingerprinted assets, manifest and headers at ${origin}`,
);
