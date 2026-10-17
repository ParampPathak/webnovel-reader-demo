const target = new URL(process.env.DEMO_URL || "https://reader.parampathak.com");
const approvedHost = target.hostname === "reader.parampathak.com" ||
  /^[a-f0-9]{8}\.webnovel-reader-demo\.pages\.dev$/.test(target.hostname);
if (!approvedHost || target.protocol !== "https:" || target.port ||
    target.username || target.password || target.pathname !== "/" ||
    target.search || target.hash)
  throw Error("Release acceptance requires the public Reader or its exact Pages preview origin.");
console.log(`Verified public acceptance target: ${target.origin}`);
