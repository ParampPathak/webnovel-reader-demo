import { cp, mkdir, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const output = path.resolve("dist");
if (output !== path.join(process.cwd(), "dist"))
  throw Error("Invalid build target");
await rm(output, { recursive: true, force: true });
await cp("public", output, { recursive: true });
await mkdir("dist/vendor", { recursive: true });
await cp("node_modules/fflate/umd/index.js", "dist/vendor/fflate.js");
async function normalize(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await normalize(p);
    else if (e.name === '_headers' || /\.(js|css|html|json|svg)$/.test(p))
      await writeFile(p, (await readFile(p, "utf8")).replace(/\r\n/g, "\n"));
  }
}
await normalize("dist");
const replacements = new Map(),
  manifest = { algorithm: "sha256", assets: [] };
const hash = (b) => createHash("sha256").update(b).digest("hex");
const applicationLicense = (await readFile("LICENSE", "utf8")).replace(
  /\r\n/g,
  "\n",
);
const vendorLicense = (
  await readFile("docs/licenses/fflate-MIT.txt", "utf8")
).replace(/\r\n/g, "\n");
function rewrite(text) {
  for (const [a, b] of replacements) text = text.replaceAll(a, b);
  return text;
}
async function fingerprint(source) {
  const file = path.join("dist", source),
    raw = await readFile(file);
  const bytes = /\.(js|css)$/.test(source)
    ? Buffer.from(
        "/*\n" +
          (source === "vendor/fflate.js" ? vendorLicense : applicationLicense) +
          "\n*/\n" +
          rewrite(raw.toString()),
      )
    : raw;
  const sha256 = hash(bytes),
    target = `assets/${path.basename(source, path.extname(source))}.${sha256.slice(0, 12)}${path.extname(source)}`;
  await writeFile(path.join("dist", target), bytes);
  await rm(file);
  replacements.set("/" + source, "/" + target);
  manifest.assets.push({
    source,
    path: "/" + target,
    sha256,
    bytes: bytes.length,
  });
}
for (const asset of await readdir("dist/assets"))
  await fingerprint("assets/" + asset);
for (const source of [
  "vendor/fflate.js",
  "sample.js",
  "epub-worker.js",
  "epub.js",
  "storage.js",
  "real/pagination.js",
  "real/narration.js",
  "sample-player.js",
  "real/reader.js",
  "real/library.js",
  "browser-ui.js",
  "real/library.css",
  "real/immersive.css",
  "browser.css",
])
  await fingerprint(source);
for (const html of ["index.html", "reader.html"]) {
  const bytes = Buffer.from(rewrite(await readFile("dist/" + html, "utf8")));
  await writeFile("dist/" + html, bytes);
  manifest.assets.push({
    source: html,
    path: html === "index.html" ? "/" : "/reader.html",
    sha256: hash(bytes),
    bytes: bytes.length,
  });
}
for (const [source, target] of [
  ["LICENSE", "LICENSE.txt"],
  ["docs/licenses/fflate-MIT.txt", "fflate-LICENSE.txt"],
  ["docs/audio-provenance.md", "audio-provenance.txt"],
]) {
  const bytes = Buffer.from(
    (await readFile(source, "utf8")).replace(/\r\n/g, "\n"),
  );
  await writeFile("dist/" + target, bytes);
  manifest.assets.push({
    source,
    path: "/" + target,
    sha256: hash(bytes),
    bytes: bytes.length,
  });
}
await writeFile(
  "dist/asset-manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  "Browser-only Reader built with local vendor code and content-addressed assets.",
);
