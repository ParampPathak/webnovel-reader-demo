import { cp, mkdir, rm } from "node:fs/promises";
// Replace only generated output, never source or browser state.
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
console.log("Static demo built. No network or backend build step.");
