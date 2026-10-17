const { webkit, chromium } = require("@playwright/test"),
  fs = require("fs"),
  assert = require("node:assert/strict"),
  { createHash } = require("crypto");
const origin = process.env.DEMO_URL || "http://127.0.0.1:34341",
  manifest = JSON.parse(fs.readFileSync("dist/asset-manifest.json")),
  expected = new Map(
    manifest.assets
      .filter((a) => /\.(js|css)$/.test(a.path))
      .map((a) => [a.path, a]),
  ),
  results = [];
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
        }),
        p = await context.newPage(),
        seen = new Set(),
        checks = [],
        errors = [],
        requests = [];
      p.on("pageerror", (e) => errors.push(e.message));
      context.on("request", (r) => {
        const u = new URL(r.url());
        if (u.protocol === "blob:") return;
        const report =
          u.origin === "https://csp-reporting.cloudflare.com" &&
          r.method() === "POST" &&
          /application\/(csp-report|reports\+json)/.test(
            r.headers()["content-type"] || "",
          ) &&
          new URL(origin).hostname === "reader.parampathak.com";
        requests.push({
          origin: u.origin,
          path: u.pathname,
          providerReport: report,
        });
        if (
          !report &&
          (u.origin !== new URL(origin).origin ||
            r.method() !== "GET" ||
            u.pathname.startsWith("/api/"))
        )
          errors.push("Unexpected network operation");
      });
      p.on("response", (r) => {
        const path = new URL(r.url()).pathname,
          a = expected.get(path);
        if (!a) return;
        if (r.status() === 304) {
          if (!seen.has(path)) errors.push("Unverified cached 304");
          return;
        }
        checks.push(
          r
            .body()
            .then((b) => {
              assert.equal(
                createHash("sha256").update(b).digest("hex"),
                a.sha256,
                path,
              );
              seen.add(path);
            })
            .catch((e) => errors.push(e.message)),
        );
      });
      await p.goto(origin);
      await p.locator(".book-title").click();
      for (const phase of ["fresh", "warm reload", "hard reload"]) {
        if (phase === "warm reload") await p.reload();
        if (phase === "hard reload") {
          const wk = name === "webkit",
            session = wk
              ? p._connection.toImpl(p).delegate._session
              : await context.newCDPSession(p);
          await session.send(
            wk
              ? "Network.setResourceCachingDisabled"
              : "Network.setCacheDisabled",
            wk ? { disabled: true } : { cacheDisabled: true },
          );
          await p.reload();
        }
        await p.waitForFunction(() => window.ReaderNarration?.page().ready);
        assert(
          await p.locator("audio").evaluate((a) => a.paused && !a.currentSrc),
        );
        if (await p.locator("#revealChrome").isVisible())
          await p.locator("#revealChrome").click();
        await p.locator("#dockListen").click();
        await p.waitForFunction(
          () =>
            !document.querySelector("audio").paused &&
            document.querySelector("audio").currentTime > 0,
        );
        await p.locator("#dockListen").click();
        assert(!(await p.locator("#readerMini").isVisible()));
        results.push(
          `${name}: ${phase}, exact browser assets, no autoplay, native neural playback`,
        );
      }
      await Promise.all(checks);
      assert.deepEqual(errors, []);
      assert.equal(
        seen.size,
        expected.size - 1,
        "All main-thread assets verified; extraction worker is exercised by import suite",
      );
      results.push({ engine: name, requests });
      await context.close();
    } finally {
      await browser.close();
    }
  }
  fs.writeFileSync(
    "test-results/cache-results.json",
    JSON.stringify({ origin, results }, null, 2),
  );
  console.log(
    "PASS",
    results.filter((r) => typeof r === "string"),
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
