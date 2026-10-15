import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  stdio: "inherit",
  windowsHide: true,
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (server.exitCode !== null) throw Error("Preview process exited");
    try {
      const response = await fetch("http://127.0.0.1:4330");
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
