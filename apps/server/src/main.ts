import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { wyrdHome } from "../../cli/src/providers.ts";
import { createApp } from "./app.ts";
import { webAssets } from "./web.ts";

const offline = process.argv.includes("--offline");
const instance = createApp({
  home: wyrdHome(),
  offline,
});
const webRoot = resolve(import.meta.dir, "../../web/dist");
if (!existsSync(webRoot)) throw new Error("Build the web client first: bun run build");
instance.app.use("/*", webAssets(webRoot));
const port = Number(process.env.WYRD_PORT ?? 4777);
const server = Bun.serve({
  hostname: process.env.WYRD_HOST ?? "0.0.0.0",
  port,
  idleTimeout: 120,
  fetch: (req, server) =>
    instance.app.fetch(req, { remoteAddress: server.requestIP(req)?.address ?? "unknown" }),
});
console.log(`Wyrd Grimoire${offline ? " (offline preview)" : ""}: http://localhost:${server.port}`);
const shutdown = async () => {
  await server.stop();
  await instance.idle();
  instance.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
