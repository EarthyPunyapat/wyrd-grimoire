/**
 * Captures the landing page's screenshots from the real web app (site/img/).
 *
 *   bun run build && bun scripts/site-screenshots.ts
 *
 * A throwaway offline server plays one scripted turn through the actual UI: the GM's prose and tool
 * calls are written here (FakeProvider), everything else — rolls, cards, map, inventory — is the engine.
 * Nothing touches WYRD_HOME or the network.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { createApp } from "../apps/server/src/app.ts";
import { EXAMPLE_WORLD } from "../apps/server/src/example-world.ts";
import { webAssets } from "../apps/server/src/web.ts";
import { type ChatProvider, FakeProvider, offlineProvider, RoleRouter } from "../packages/llm/src/index.ts";

const OUT = resolve("site/img");
const PORT = Number(process.env.SHOTS_PORT ?? 4797);
const passcode = "a local screenshot passcode";

const tools = (r: { messages: { role: string }[] }) => r.messages.filter((m) => m.role === "tool").length;
const said = (r: { messages: { role: string; content: string }[] }, text: string) =>
  r.messages.some((m) => m.role === "user" && m.content.includes(text));

const gm = new FakeProvider([
  {
    role: "worldGen",
    match: (r) => r.tools?.[0]?.name === "propose_lore",
    reply: {
      toolCall: { name: "propose_lore", args: { facts: ["Relay Nine's night shift logs every door."] } },
    },
  },
  {
    role: "worldGen",
    match: (r) => r.tools?.[0]?.name === "propose_world",
    reply: { toolCall: { name: "propose_world", args: EXAMPLE_WORLD } },
  },
  {
    role: "gm",
    match: (r) => said(r, "look for somewhere to buy supplies"),
    reply: (r) =>
      tools(r) === 0
        ? {
            toolCall: {
              name: "open_shop",
              args: {
                name: "Dock Four Commissary",
                kind: "station commissary",
                merchant: { name: "Quartermaster Ide" },
                stock: [
                  { name: "Ration Bar", description: "Dense, dull, keeps you going.", price: 2, qty: 12 },
                  { name: "Spare Fuse", description: "Fits most relay panels.", price: 5, qty: 4 },
                  { name: "Hand Lamp", description: "A clip-on work light.", price: 8, qty: 3 },
                  {
                    name: "Sealant Foam",
                    description: "Patches a hull crack for an hour.",
                    price: 12,
                    qty: 2,
                  },
                ],
              },
            },
          }
        : {
            text: "Quartermaster Ide rolls the commissary shutter up with one hand and doesn't stop chewing.",
          },
  },
  {
    role: "gm",
    match: (r) => said(r, "ask Mina about the sealed hatch"),
    reply: (r) => {
      const n = tools(r);
      if (n === 0)
        return {
          toolCall: {
            name: "roll",
            args: {
              skill: "core:mechanics",
              difficulty: "easy",
              goal: "read the hatch lock's history from across the lounge",
            },
          },
        };
      if (n === 1)
        return {
          toolCall: {
            name: "grant_ability",
            args: {
              ability: {
                id: "signal-ghost",
                name: "Signal Ghost",
                description:
                  "You hear the station's systems the way other people hear a crowd: who is lying, what just failed, which door was opened.",
                level: 1,
                rank: 2,
                cost: "Focus, once per scene",
              },
            },
          },
        };
      if (n === 2)
        return {
          toolCall: {
            name: "offer_choices",
            args: {
              choices: [
                { label: "Open the hatch log", description: "See who was really down there." },
                { label: "Find Jules in relay control" },
                { label: "Promise Mina you'll keep it quiet" },
              ],
            },
          },
        };
      return {
        text: [
          "Mina doesn't look up from the inspection desk. Her stylus keeps moving, but the form under it stopped making sense three lines ago.",
          "",
          '<say who="Mina Vale">It was sealed on my shift. That\'s all the log is going to say.</say>',
          "",
          "You wait. The arrival lounge hums around you, a vending unit ticking as it cools, and somewhere behind the bulkhead **the sealed hatch** knocks once, like something settling. Mina's hand stops.",
          "",
          '<say who="Mina Vale">Yesterday I signed a maintenance visit nobody scheduled. I didn\'t ask who. I should have asked who.</say>',
          "",
          "Something in your head answers before you do: a thin, steady tone from the hatch's lock, and under it the faint double pulse of a door that was opened from the inside.",
        ].join("\n"),
      };
    },
  },
]);

const offline = offlineProvider();
const provider: ChatProvider = {
  id: "offline",
  kind: "fake",
  listModels: () => offline.listModels(),
  generate: (request) =>
    request.role === "gm" ||
    (request.role === "worldGen" &&
      ["propose_lore", "propose_world"].includes(request.tools?.[0]?.name ?? ""))
      ? gm.generate(request)
      : offline.generate(request),
};

const home = mkdtempSync(join(tmpdir(), "wyrd-shots-"));
let instance: ReturnType<typeof createApp> | undefined;
const router = new RoleRouter({
  usage: { record: (r) => instance?.store.recordUsage(r) },
  providers: { offline: provider },
  routing: Object.fromEntries(
    ["parser", "narrator", "guard", "worldGen", "gm"].map((role) => [
      role,
      { provider: "offline", model: "offline", fallbacks: [] },
    ]),
  ),
});
instance = createApp({ home, offline: true, router, seed: process.env.SHOTS_SEED ?? "site-shots-7" });
instance.app.use("/*", webAssets(resolve("apps/web/dist")));
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  fetch: (req, s) => instance!.app.fetch(req, { remoteAddress: s.requestIP(req)?.address ?? "unknown" }),
});

async function shot(
  page: Page,
  name: string,
  clip?: { x: number; y: number; width: number; height: number },
) {
  await page.waitForTimeout(400);
  await page.screenshot({
    path: join(OUT, `${name}.jpg`),
    type: "jpeg",
    quality: 82,
    ...(clip ? { clip } : {}),
  });
  console.log(`  ${name}.jpg`);
}

/** A close crop around elements, so a feature image stays readable at half the page width. */
async function crop(page: Page, name: string, selectors: string[], pad = 24) {
  await page.waitForTimeout(400);
  const boxes = (await Promise.all(selectors.map((sel) => page.locator(sel).first().boundingBox()))).filter(
    (b): b is NonNullable<typeof b> => b !== null,
  );
  const view = page.viewportSize()!;
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const right = Math.min(view.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
  const bottom = Math.min(view.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
  await shot(page, name, { x, y, width: right - x, height: bottom - y });
}

async function say(page: Page, text: string) {
  const box = page.getByLabel("What do you do?", { exact: true });
  await box.fill(text);
  await box.press("Enter");
  await page.waitForFunction(() => !document.querySelector("#action-input")?.hasAttribute("disabled"), null, {
    timeout: 30000,
  });
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.getByLabel("Passcode", { exact: true }).fill(passcode);
  await page.getByRole("button", { name: /Set passcode & enter/ }).click();
  await page.getByRole("button", { name: "+ New campaign", exact: true }).click();
  await page.getByLabel("Campaign name", { exact: true }).fill("The Silent Relay");
  await page.getByLabel("Character name", { exact: false }).fill("Alex Chen");
  await page
    .getByLabel("What kind of adventure or world do you want?")
    .fill("A hard sci-fi mystery on a failing space station, with a human crew and no magic.");
  await page.getByRole("button", { name: "Preview example world →" }).click();
  await page.getByRole("button", { name: "Begin adventure →" }).click();
  await page.getByRole("heading", { name: "Relay Nine" }).waitFor();

  console.log("Capturing to site/img/:");
  await say(page, "I ask Mina about the sealed hatch, quietly.");
  const passage = page.locator(".passage").last();
  if (!((await passage.locator(".roll-notes, .mechanics").first().textContent()) ?? "").match(/success/i))
    throw new Error("the demo roll failed; try another SHOTS_SEED");
  await passage.evaluate((el) => {
    // Scroll only the story column so the status strip stays in frame.
    const column = el.closest(".story-scroll") as HTMLElement | null;
    window.scrollTo(0, 0);
    if (column) column.scrollTop += el.getBoundingClientRect().top - column.getBoundingClientRect().top - 24;
  });
  await shot(page, "play");
  await crop(
    page,
    "turn",
    [
      ".passage .player-input",
      ".passage .gm-choices",
      ".passage .margin-notes .roll-notes, .passage .margin-notes",
    ],
    20,
  );

  await page.getByRole("button", { name: /Abilities/ }).click();
  await crop(
    page,
    "abilities",
    [".abilities-panel", ".hotbar button[aria-expanded]", ".hotbar button:has-text('Time skip')"],
    28,
  );
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Map", exact: true }).click();
  await crop(page, "map", [".map-here", ".map-canvas", ".map-side"], 20);
  await page.getByRole("button", { name: "Close status screen" }).click();

  await say(page, "I look for somewhere to buy supplies before I go down.");
  const browse = page.getByRole("button", { name: /Browse wares/ }).first();
  await browse.waitFor({ timeout: 15000 }).catch(async () => {
    await page.screenshot({ path: join(OUT, "debug.jpg"), type: "jpeg" });
    console.log(((await page.locator(".passage").last().textContent()) ?? "").slice(0, 800));
    throw new Error("no vendor");
  });
  await browse.click();
  await crop(page, "vendor", [".shop-dialog"], 12);
  await page.getByRole("button", { name: "Close shop" }).click();

  await page.setViewportSize({ width: 412, height: 860 });
  await page
    .locator(".passage")
    .first()
    .evaluate((el) => {
      const column = el.closest(".story-scroll") as HTMLElement | null;
      window.scrollTo(0, 0);
      if (column)
        column.scrollTop += el.getBoundingClientRect().top - column.getBoundingClientRect().top - 12;
    });
  await shot(page, "phone");

  // The 3.0 roadmap graphic, re-encoded as WebP so the page stays light.
  const source = process.env.ROADMAP_PNG;
  if (source) {
    const png = readFileSync(source).toString("base64");
    const webp = await page.evaluate(async (data) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")!.drawImage(img, 0, 0);
      return canvas.toDataURL("image/webp", 0.86).split(",")[1]!;
    }, png);
    writeFileSync(join(OUT, "roadmap-3.0.webp"), Buffer.from(webp, "base64"));
    console.log("  roadmap-3.0.webp");
  }
} finally {
  await browser.close();
  await server.stop(true);
  await instance.idle();
  instance.close();
  rmSync(home, { recursive: true, force: true });
}
