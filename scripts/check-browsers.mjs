import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
const origin = `http://127.0.0.1:${process.env.PORT || 4330}`;
const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  stdio: ["ignore", "pipe", "inherit"],
  windowsHide: true,
});
try {
  // Require this child to bind its port, not a response from an older server.
  await new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(
      () => reject(Error("Preview child did not report readiness")),
      10000,
    );
    const fail = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    server.once("error", fail);
    server.once("exit", (code) => fail(Error(`Preview child exited: ${code}`)));
    server.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      if (chunk.toString().includes(`Demo preview on ${origin}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (server.exitCode !== null) throw Error("Preview process exited");
    try {
      const response = await fetch(origin);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await setTimeout(300);
  }
  if (!ready) throw Error("Preview did not become ready");
  for (const script of ["tests/browser.cjs", "tests/accessibility.cjs"]) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script], {
        stdio: "inherit",
        windowsHide: true,
        env: { ...process.env, DEMO_URL: origin },
      });
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(Error(`${script} failed: ${code}`)),
      );
    });
  }
} finally {
  server.kill();
}
