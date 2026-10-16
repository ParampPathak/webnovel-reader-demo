import { cp, mkdir, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
// Replace only generated output, never source or browser state.
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
// Canonical text bytes make Windows and hosted builds identical.
async function normalize(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await normalize(file);
    else if (/\.(html|js|css|svg|json)$/.test(file))
      await writeFile(
        file,
        (await readFile(file, "utf8")).replace(/\r\n/g, "\n"),
      );
  }
}
await normalize("dist");
const manifest = { algorithm: "sha256", assets: [] };
const replacements = new Map();
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fingerprint(source, contents) {
  const original = path.join("dist", source);
  const bytes =
    contents === undefined ? await readFile(original) : Buffer.from(contents);
  const sha256 = digest(bytes);
  const ext = path.extname(source),
    stem = path.basename(source, ext);
  const target = `assets/${stem}.${sha256.slice(0, 12)}${ext}`;
  await writeFile(path.join("dist", target), bytes);
  await rm(original);
  replacements.set("/" + source, "/" + target);
  manifest.assets.push({
    source,
    path: "/" + target,
    sha256,
    bytes: bytes.length,
  });
  return "/" + target;
}
function rewrite(text) {
  for (const [source, target] of replacements)
    text = text.replaceAll(source, target);
  return text;
}
for (const name of await readdir("dist/assets"))
  await fingerprint("assets/" + name);
const dataPath = await fingerprint(
  "data.js",
  rewrite(await readFile("dist/data.js", "utf8")),
);
let app = await readFile("dist/app.js", "utf8");
app = app.replace(
  /\.\/data\.js(?:\?v=[^"']+)?/,
  "./" + path.basename(dataPath),
);
await fingerprint("app.js", rewrite(app));
await fingerprint("style.css");
const html = rewrite(
  (await readFile("dist/index.html", "utf8")).replace(
    /(\/(?:app\.js|style\.css))\?v=[^"]+/g,
    "$1",
  ),
);
await writeFile("dist/index.html", html);
manifest.assets.push({
  source: "index.html",
  path: "/",
  sha256: digest(html),
  bytes: Buffer.byteLength(html),
});
await writeFile(
  "dist/asset-manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  "Static demo built with content-addressed assets. No network or backend build step.",
);
