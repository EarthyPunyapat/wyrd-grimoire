import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const passcode = "a local browser test passcode";

async function unlock(page: Page) {
  await page.goto("/");
  await page.getByLabel("Passcode", { exact: true }).fill(passcode);
  await page.getByRole("button", { name: /Set passcode & enter|Unlock grimoire/ }).click();
  await expect(page.getByRole("heading", { name: "Your campaigns" })).toBeVisible();
}
async function create(page: Page) {
  await unlock(page);
  await page.getByRole("button", { name: "+ New campaign", exact: true }).click();
  await expect(page.getByLabel("Campaign name", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Character name", { exact: false })).toHaveValue("");
  await expect(page.getByLabel("Background", { exact: true })).toHaveCount(0);
  await page.getByLabel("Campaign name", { exact: true }).fill("Silent Relay Test");
  await page.getByLabel("Character name", { exact: false }).fill("Wren");
  await page
    .getByLabel("What kind of adventure or world do you want?")
    .fill("A hard sci-fi mystery on a failing space station, human crew, no magic.");
  await page.getByRole("button", { name: "Preview example world →" }).click();
  await expect(page.getByRole("heading", { name: "The Silent Relay" })).toBeVisible();
  await expect(page.getByLabel("Background", { exact: true })).toContainText("Systems technician");
  await page.getByRole("button", { name: "Begin adventure →" }).click();
  await expect(page.getByRole("heading", { name: "Relay Nine" })).toBeVisible();
}

test("dialogue uses names and important references are emphasized safely", async ({ page }, info) => {
  await create(page);
  await page.getByLabel("What do you do?", { exact: true }).fill("readability check");
  await page.getByRole("button", { name: "Send ↑" }).click();
  await expect(page.locator(".speaker")).toHaveText(["Mina Vale", "Jules Park"]);
  // Known names are reference cards (M5); narrator-marked clues stay bold.
  await expect(page.locator(".prose p strong, .prose p .ref")).toHaveText([
    "Mina Vale",
    "Relay Nine",
    "the sealed hatch",
  ]);
  await page.locator(".prose p .ref", { hasText: "Mina Vale" }).first().click();
  await expect(page.getByRole("dialog", { name: "Mina Vale" })).toContainText("Open in Codex");
  await page.keyboard.press("Escape");
  await expect(page.locator("blockquote strong:not(.speaker)")).toHaveText(["the inspection desk"]);
  await expect(page.locator(".prose")).not.toContainText("A voice");
  await page.reload();
  await expect(page.locator(".speaker")).toHaveText(["Mina Vale", "Jules Park"]);
  await page.screenshot({ path: info.outputPath("m3-reading.png"), fullPage: true });
});

test("quick start, live turn, reroll, reload and character sheet", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error" || e.type() === "warning") errors.push(e.text());
  });
  await create(page);
  await page.getByRole("button", { name: "Look around", exact: true }).click();
  await expect(page.getByLabel("What do you do?", { exact: true })).toHaveValue("Look around");
  await page.getByLabel("What do you do?", { exact: true }).fill("sneak behind the barrels");
  await page.getByLabel("What do you do?", { exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "↻ Reroll narration" })).toBeEnabled();
  await expect(page.locator(".prose")).toContainText("offline narrator");
  const mechanics = await page.locator(".mechanics").textContent();
  await page.getByRole("button", { name: "↻ Reroll narration" }).click();
  await expect(page.getByLabel("What do you do?", { exact: true })).toBeEnabled();
  expect(await page.locator(".mechanics").textContent()).toBe(mechanics);
  await expect(page.locator(".story")).not.toContainText(/tokens|\$\d|cost estimate/i);
  await page.screenshot({ path: info.outputPath("m3.png"), fullPage: true });
  await page.reload();
  await expect(page.locator(".prose")).toContainText("offline narrator");
  if (info.project.name === "phone") {
    await page.getByRole("button", { name: "Sheet ↗" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Wren" })).toBeVisible();
    await page.getByRole("button", { name: "Close character sheet" }).click();
  } else
    await expect(
      page.getByRole("complementary", { name: "Character sheet" }).getByRole("heading", { name: "Wren" }),
    ).toBeVisible();
  const viewport = page.viewportSize()!;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  expect(errors).toEqual([]);
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("clarification choices are resolved and guard flags can regenerate", async ({ page }) => {
  await create(page);
  await page.getByLabel("What do you do?", { exact: true }).fill("ambiguous request");
  await page.getByRole("button", { name: "Send ↑" }).click();
  await expect(page.getByText("Where would you like to look?", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "1 Look around the room" }).click();
  await expect(page.locator(".prose")).toBeVisible();
  await page.getByLabel("What do you do?", { exact: true }).fill("force a canon flag");
  await page.getByRole("button", { name: "Send ↑" }).click();
  await expect(page.getByRole("heading", { name: "Canon needs a second look" })).toBeVisible();
  await page.getByRole("button", { name: "Keep canon & regenerate" }).click();
  await expect(page.getByLabel("What do you do?", { exact: true })).toBeEnabled();
});

test("model routes save, connection stays host-side, and usage is confined to settings", async ({ page }) => {
  await create(page);
  await page.getByLabel("What do you do?", { exact: true }).fill("look around");
  await page.getByRole("button", { name: "Send ↑" }).click();
  await expect(page.locator(".prose")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Routing preset").selectOption("fullyLocal");
  await dialog
    .getByRole("group", { name: "ChatGPT plan", exact: true })
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption("");
  await dialog
    .getByRole("group", { name: "Fast parsing", exact: true })
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption("");
  const local = dialog.getByRole("group", { name: "Local models", exact: true });
  await local.getByRole("combobox", { name: "Provider", exact: true }).selectOption("ollama");
  await local.getByRole("combobox", { name: "Model", exact: true }).fill("test-local-model");
  await dialog.getByRole("button", { name: "Save model settings" }).click();
  await expect(dialog.getByRole("status")).toContainText("Model settings saved");
  await dialog.getByRole("button", { name: "Connection", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Continue with ChatGPT" })).toBeDisabled();
  await expect(dialog.getByText("Offline preview is active.", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Usage", exact: true }).click();
  await expect(dialog.getByRole("table")).toContainText("offline");
  await dialog.getByLabel("Group by").selectOption("role");
  await expect(dialog.getByRole("table")).toContainText("parser");
  await expect(dialog.getByRole("table")).toContainText("guard");
  await dialog.getByRole("button", { name: "Close settings" }).click();
  await expect(page.locator(".story")).not.toContainText(/Tokens|API estimate|Plan calls/);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("group", { name: "Local models", exact: true })
      .getByRole("combobox", { name: "Model", exact: true }),
  ).toHaveValue("test-local-model");
});

test("story and settings fit narrow phones, tablets and desktop", async ({ page }) => {
  await create(page);
  for (const width of [320, 768, 1200]) {
    await page.setViewportSize({ width, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByLabel("What do you do?", { exact: true })).toBeVisible();
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Save model settings" })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
});
