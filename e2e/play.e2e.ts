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
  await page.getByLabel("What do you do?", { exact: true }).press("Enter");
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
  // Spec 13: the mechanics log sits under each passage, not above the prose.
  expect(
    await page.evaluate(() => {
      const passage = document.querySelector(".passage");
      const prose = passage?.querySelector(".prose");
      const mechanics = passage?.querySelector(".mechanics");
      if (!prose || !mechanics) return null;
      return (prose.compareDocumentPosition(mechanics) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    }),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("m3.png"), fullPage: true });
  await page.reload();
  await expect(page.locator(".prose")).toContainText("offline narrator");
  await page.getByRole("button", { name: "Character", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Wren" })).toBeVisible();
  await page.getByRole("button", { name: "Close status screen" }).click();
  const viewport = page.viewportSize()!;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  expect(errors).toEqual([]);
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("J, M, I and C open their panels without stealing typed keys", async ({ page }, info) => {
  test.skip(
    info.project.name === "phone",
    "keyboard shortcuts are the desktop path; the phone bar covers these",
  );
  await create(page);
  await page.locator(".location-bar span").first().click();
  // Reader opens every menu full screen over the story (D150); Escape returns to the story.
  for (const [key, name] of [
    ["j", "Journal"],
    ["m", "Map"],
    ["i", "Inventory"],
  ] as const) {
    await page.keyboard.press(key);
    await expect(page.getByRole("dialog", { name })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }

  // A key typed into the composer is text, not a shortcut.
  const box = page.getByLabel("What do you do?", { exact: true });
  await box.fill("");
  await box.press("j");
  await expect(box).toHaveValue("j");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("c");
  await expect(page.getByRole("dialog", { name: "Character" })).toBeVisible();
});

test("browser back reaches the campaign list and the skip link stays in the story", async ({ page }) => {
  await create(page);
  await expect(page).toHaveURL(/#campaign=/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Your campaigns" })).toBeVisible();
  await page.goForward();
  await expect(page.locator(".play-layout")).toBeVisible();

  // The in-page skip link changes the hash; it must not be mistaken for leaving the campaign.
  await page.getByRole("link", { name: "Skip to story" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  await expect(page.locator(".play-layout")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".play-layout")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Your campaigns" })).toBeVisible();
});

test("clarification choices are resolved and guard flags can regenerate", async ({ page }) => {
  await create(page);
  await page.getByLabel("What do you do?", { exact: true }).fill("ambiguous request");
  await page.getByLabel("What do you do?", { exact: true }).press("Enter");
  await expect(page.getByText("Where would you like to look?", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "1 Look around the room" }).click();
  await expect(page.locator(".prose")).toBeVisible();
  await page.getByLabel("What do you do?", { exact: true }).fill("force a canon flag");
  await page.getByLabel("What do you do?", { exact: true }).press("Enter");
  // The canon check is folded into the margin; it says it needs a look and opens on click.
  await expect(page.locator(".canon-check.needs-look")).toBeVisible();
  await page.locator(".canon-check.needs-look summary").click();
  await expect(page.getByRole("heading", { name: "Canon needs a second look" })).toBeVisible();
  await page.getByRole("button", { name: "Keep canon & regenerate" }).click();
  await expect(page.getByLabel("What do you do?", { exact: true })).toBeEnabled();
});

test("model routes save, connection stays host-side, and usage is confined to settings", async ({ page }) => {
  await create(page);
  await page.getByLabel("What do you do?", { exact: true }).fill("look around");
  await page.getByLabel("What do you do?", { exact: true }).press("Enter");
  await expect(page.locator(".prose")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Routing preset").selectOption("fullyLocal");
  await dialog
    .getByRole("group", { name: "ChatGPT plan (prose)", exact: true })
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption("");
  await dialog
    .getByRole("group", { name: "Fast model (parsing and checks)", exact: true })
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption("");
  const local = dialog.getByRole("group", { name: "Local models", exact: true });
  await local.getByRole("combobox", { name: "Provider", exact: true }).selectOption("ollama");
  // Once a provider lists its models the field is a real dropdown, so pick from that list.
  await local.getByRole("combobox", { name: "Model", exact: true }).selectOption("offline");
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
  ).toHaveValue("offline");
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
