const { webkit, chromium } = require("@playwright/test");
const fs = require("node:fs"),
  assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const origin = process.env.DEMO_URL || "http://127.0.0.1:4330";
const manifest = JSON.parse(
  fs.readFileSync("dist/asset-manifest.json", "utf8"),
);
const expected = new Map(
  manifest.assets
    .filter((a) => /\.(js|css)$/.test(a.path))
    .map((a) => [a.path, a]),
);
const results = [];
(async () => {
  for (const [name, engine] of [
    ["webkit", webkit],
    ["chromium", chromium],
  ]) {
    if (process.env.BROWSER_ENGINE && process.env.BROWSER_ENGINE !== name)
      continue;
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage(),
        checks = [],
        errors = [],
        seen = new Set(),
        requests = [],
        revalidated = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        const url = new URL(r.url());
        if (url.protocol === "blob:") return;
        const report =
          url.origin === "https://csp-reporting.cloudflare.com" &&
          r.method() === "POST" &&
          /^(application\/csp-report|application\/reports\+json)(;|$)/.test(
            r.headers()["content-type"] || "",
          );
        requests.push({
          origin: url.origin,
          path: url.pathname,
          providerReport: report,
        });
        if (url.origin !== new URL(origin).origin && !report)
          errors.push("Unexpected origin: " + url.origin);
      });
      page.on("response", (r) => {
        const url = new URL(r.url()),
          entry = expected.get(url.pathname);
        if (!entry) return;
        if (r.status() === 304) {
          // A 304 reuses this context's previously byte-verified response.
          if (!seen.has(url.pathname))
            errors.push("304 without a verified cached body: " + url.pathname);
          revalidated.push(url.pathname);
          return;
        }
        if (r.status() !== 200) {
          errors.push(
            "Unexpected asset status " + r.status() + ": " + url.pathname,
          );
          return;
        }
        checks.push(
          r
            .body()
            .then((bytes) => {
              assert.equal(
                createHash("sha256").update(bytes).digest("hex"),
                entry.sha256,
                "Cached browser bytes: " + url.pathname,
              );
              seen.add(url.pathname);
            })
            .catch((e) => errors.push(e.message)),
        );
      });
      // Seed a legacy URL in the same real browser cache, without executing it.
      // The new document must never reference that unversioned path.
      await page.goto(origin + "/app.js");
      for (const phase of [
        "fresh document with existing legacy cache",
        "warm reload",
        "hard reload",
      ]) {
        if (phase.startsWith("fresh")) await page.goto(origin);
        else if (phase === "warm reload") await page.reload();
        else {
          const wk = name === "webkit";
          const session = wk
            ? page._connection.toImpl(page).delegate._session
            : await context.newCDPSession(page);
          const command = wk
            ? "Network.setResourceCachingDisabled"
            : "Network.setCacheDisabled";
          await session.send(
            command,
            wk ? { disabled: true } : { cacheDisabled: true },
          );
          await page.reload();
          await session.send(
            command,
            wk ? { disabled: false } : { cacheDisabled: false },
          );
        }
        await page
          .getByRole("button", { name: "Open The Signal Room", exact: true })
          .click();
        const src = await page
          .locator('script[type="module"]')
          .getAttribute("src");
        assert.equal(
          src,
          manifest.assets.find((a) => a.source === "app.js").path,
        );
        await page.locator("#listen").click();
        await page.waitForFunction(() => {
          const a = document.querySelector("audio");
          return !a.paused && a.currentTime > 0 && a.duration > 20;
        });
        await page.locator("#listen").click();
        assert(!(await page.locator("#mini").isVisible()));
        results.push(
          `${name}: ${phase}, exact fingerprinted browser assets and real audio`,
        );
      }
      await Promise.all(checks);
      assert.deepEqual(errors, []);
      assert.equal(seen.size, 3);
      results.push({ engine: name, observedRequests: requests, revalidated });
    } finally {
      await browser.close();
    }
  }
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync(
    "test-results/cache-results.json",
    JSON.stringify({ origin, results }, null, 2),
  );
  console.log(
    "PASS browser cache/reload/audio:",
    results.filter((x) => typeof x === "string").join("; "),
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
