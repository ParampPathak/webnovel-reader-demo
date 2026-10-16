const { webkit, chromium } = require("@playwright/test");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const assert = require("node:assert/strict"),
  fs = require("node:fs");
const origin = process.env.DEMO_URL || "http://127.0.0.1:4330";
const results = [],
  requests = new Set(),
  browserAssets = new Map(),
  providerReports = [],
  errors = [];
fs.mkdirSync("test-results", { recursive: true });
const shot = async (p, name) => {
  await p.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
  });
  return p.screenshot({
    path: "test-results/demo-" + name + ".png",
    fullPage: false,
  });
};
const record = (name) => {
  results.push(name);
  console.log("PASS", name);
};
async function run(engine, name) {
  const browser = await engine.launch();
  try {
    for (const width of [320, 390, 430, 844, 1440]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 844 ? 390 : 844 },
        hasTouch: true,
        isMobile: width < 900,
      });
      const p = await context.newPage();
      const assetChecks = [];
      p.on("response", (response) => {
        const url = new URL(response.url());
        if (!["/app.js", "/style.css", "/data.js"].includes(url.pathname))
          return;
        assetChecks.push(
          response
            .body()
            .then((actual) => {
              const expected =
                new URL(origin).hostname === "127.0.0.1"
                  ? fs.readFileSync("dist" + url.pathname)
                  : execFileSync("git", ["show", "HEAD:public" + url.pathname]);
              assert(
                actual.equals(expected),
                "Browser received stale asset: " + url.pathname,
              );
              browserAssets.set(name + url.pathname + url.search, {
                engine: name,
                url: url.origin + url.pathname + url.search,
                sha256: createHash("sha256").update(actual).digest("hex"),
              });
            })
            .catch((error) => errors.push(error.message)),
        );
      });
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("console", (x) => {
        if (x.type() === "error") errors.push(x.text());
      });
      p.on("requestfailed", (r) =>
        console.error("REQUEST FAILED", r.url(), r.failure()?.errorText),
      );
      await context.route("**/*", (route) => {
        const request = route.request();
        const u = new URL(request.url());
        requests.add(u.origin);
        // Existing custom-domain hosting security, not an application API.
        // Keep all unknown origins blocked and record accepted reports explicitly.
        const contentType = request.headers()["content-type"] || "";
        if (
          new URL(origin).hostname === "reader.parampathak.com" &&
          u.origin === "https://csp-reporting.cloudflare.com" &&
          request.method() === "POST" &&
          /^(application\/csp-report|application\/reports\+json)(;|$)/.test(
            contentType,
          )
        ) {
          providerReports.push({
            origin: u.origin,
            method: request.method(),
            contentType,
          });
          return route.continue();
        }
        if (u.origin !== new URL(origin).origin) {
          errors.push("Unexpected network origin");
          return route.abort();
        }
        return route.continue();
      });
      try {
        await p.goto(origin);
      } catch (error) {
        await p
          .screenshot({ path: "test-results/load-failure.png" })
          .catch(() => {});
        console.error("Navigation errors:", errors);
        throw error;
      }
      await p.locator(".book-card").first().waitFor();
      assert.equal(await p.locator(".book-card").count(), 2);
      assert(
        await p
          .locator("img")
          .evaluateAll((imgs) =>
            imgs.every((i) => i.complete && i.naturalWidth),
          ),
      );
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      assert.equal(await p.locator("#mini").isVisible(), false);
      if (width === 1440) await shot(p, name + "-library");
      await p
        .getByRole("button", { name: "Open The Signal Room", exact: true })
        .click();
      assert.equal(await p.locator("html").getAttribute("data-theme"), "black");
      assert(await p.locator("#audio").evaluate((a) => a.paused));
      const before = await p.locator("#page-status").textContent();
      await p.getByRole("button", { name: "Next page", exact: true }).click();
      assert.notEqual(await p.locator("#page-status").textContent(), before);
      await p
        .getByRole("button", { name: "Previous page", exact: true })
        .click();
      assert.equal(await p.locator("#page-status").textContent(), before);
      if (name === "webkit") {
        const b = await p.locator("#reading-area").boundingBox(),
          x = Math.round(b.x + b.width * 0.65),
          y = Math.round(b.y + b.height * 0.45),
          session = p._connection.toImpl(p).delegate._pageProxySession;
        await p.evaluate(() => {
          window.trusted = [];
          document
            .querySelector("#reading-area")
            .addEventListener("touchstart", (e) =>
              window.trusted.push(e.isTrusted),
            );
        });
        await session.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ id: 1, x, y }],
        });
        for (let i = 1; i <= 6; i++)
          await session.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ id: 1, x: Math.round(x - (100 * i) / 6), y }],
          });
        await session.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [{ id: 1, x: x - 100, y }],
        });
        await p.waitForTimeout(150);
        assert.notEqual(await p.locator("#page-status").textContent(), before);
        assert.deepEqual(await p.evaluate(() => window.trusted), [true]);
      } else {
        await p.locator("#reading-area").focus();
        await p.keyboard.press("ArrowRight");
      }
      const saved = await p.locator("#page-status").textContent();
      await p.reload();
      await p
        .getByRole("button", { name: "Open The Signal Room", exact: true })
        .click();
      assert.equal(await p.locator("#page-status").textContent(), saved);
      await p
        .getByRole("button", { name: "Reading appearance", exact: true })
        .click();
      await p.locator("#theme").selectOption("light");
      await p.locator("#font").fill("24");
      await p.locator("#spacing").selectOption("2");
      await p
        .getByRole("button", { name: "Close appearance", exact: true })
        .click();
      assert.equal(await p.locator("html").getAttribute("data-theme"), "light");
      assert.equal(await p.locator("#font").inputValue(), "24");
      await p.reload();
      await p
        .getByRole("button", { name: "Open The Signal Room", exact: true })
        .click();
      assert.equal(await p.locator("html").getAttribute("data-theme"), "light");
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await p.locator("#contents-open").click();
      await p.locator("#chapter-list button").nth(1).click();
      assert.match(
        await p.locator("#page-status").textContent(),
        /Chapter 2\/3 · Page 1\//,
      );
      await p.locator("#previous").click();
      assert.match(
        await p.locator("#page-status").textContent(),
        /Chapter 1\/3/,
      );
      await p.locator("#next").click();
      assert.match(
        await p.locator("#page-status").textContent(),
        /Chapter 2\/3 · Page 1\//,
      );
      await p.setViewportSize({
        width: width === 390 ? 844 : 390,
        height: width === 390 ? 390 : 844,
      });
      await p.waitForTimeout(160);
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      record(
        `${name} ${width}px: library, page navigation, trusted input, progress reload, typography, theme, chapter boundary and resize`,
      );
      if (width === 390) {
        await p.setViewportSize({ width: 390, height: 844 });
        await p.waitForTimeout(150);
        await p.locator("#contents-open").click();
        await p.locator("#chapter-list button").first().click();
        await p.locator("#theme-cycle").click(); // light -> black
        await p.locator("#listen").click();
        await p.waitForFunction(
          () =>
            !document.querySelector("audio").paused &&
            document.querySelector("audio").currentTime > 0,
        );
        assert(await p.locator("#mini").isVisible());
        assert.equal(
          await p.locator("#listen").getAttribute("aria-pressed"),
          "true",
        );
        assert.equal(await p.locator("audio").count(), 1);
        await p.locator("#forward").click();
        assert(await p.locator("audio").evaluate((a) => a.currentTime > 14));
        await p.locator("#rewind").click();
        assert(await p.locator("audio").evaluate((a) => a.currentTime < 5));
        await p.locator("#mini-title").click();
        await p.locator("#speed").selectOption("2");
        assert.equal(
          await p.locator("audio").evaluate((a) => a.playbackRate),
          2,
        );
        await p.locator("#seek").fill("40");
        assert(
          await p
            .locator("audio")
            .evaluate((a) => a.currentTime > 8 && a.currentTime < 12),
        );
        assert(
          await p
            .locator("#audio-excerpt")
            .evaluate((e) => e.classList.contains("active")),
        );
        await shot(p, name + "-player");
        await p
          .getByRole("button", { name: "Close audio controls", exact: true })
          .click();
        await p.locator("#contents-open").click();
        assert(await p.locator("audio").evaluate((a) => !a.paused));
        await p
          .getByRole("button", { name: "Close contents", exact: true })
          .click();
        await p.locator("#listen").click();
        assert(await p.locator("audio").evaluate((a) => a.paused));
        assert(!(await p.locator("#mini").isVisible()));
        const pos = await p.locator("audio").evaluate((a) => a.currentTime);
        await p.locator("#listen").click();
        await p.waitForTimeout(100);
        assert(
          await p.locator("audio").evaluate(
            // Native MP3 decoders can quantize the resume clock by a frame.
            (a, pos) => a.currentTime >= pos - 0.08 && a.currentTime < pos + 2,
            pos,
          ),
        );
        await p.locator("#listen").click();
        await p.locator("#listen").click();
        await p.locator("#listen").click();
        assert(!(await p.locator("#mini").isVisible()));
        assert.equal(await p.locator("audio").count(), 1);
        await shot(p, name + "-reader");
        await p.locator("#library-back").click();
        await p.locator("#import-open").click();
        await p.locator("#discover").click();
        assert.equal(await p.locator("#import-chapters input").count(), 3);
        await p.locator("#import-chapters input").nth(2).check();
        await shot(p, name + "-importer");
        await p.locator("#import-selected").click();
        assert.match(
          await p.locator("#page-status").textContent(),
          /Chapter 3\/3/,
        );
        await p.locator("#library-back").click();
        await p
          .getByRole("button", {
            name: "Open A Map of Small Things",
            exact: true,
          })
          .click();
        assert.match(await p.locator("#reader-title").textContent(), /Map/);
        await p.locator("#library-back").click();
        await p.locator("#reset-open").click();
        await Promise.all([
          p.waitForEvent("load"),
          p.locator("#reset-confirm").click(),
        ]);
        await p.locator(".book-card").first().waitFor();
        assert.equal(
          await p.locator(".book-progress").first().textContent(),
          "Not started",
        );
        record(
          `${name}: native audio, pause/resume, headphones ON/OFF, seek ±15s, 2x, excerpt highlight, no duplicates/autoplay, Contents during playback, import preview and reset`,
        );
      }
      await Promise.all(assetChecks);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
(async () => {
  if (!process.env.BROWSER_ENGINE || process.env.BROWSER_ENGINE === "webkit")
    await run(webkit, "webkit");
  if (
    !process.env.WEBKIT_ONLY &&
    (!process.env.BROWSER_ENGINE || process.env.BROWSER_ENGINE === "chromium")
  )
    await run(chromium, "chromium");
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    "test-results/browser-results.json",
    JSON.stringify(
      {
        url: origin,
        passed: results,
        requests: [...requests],
        providerReports,
        browserAssets: [...browserAssets.values()],
        errors,
      },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
