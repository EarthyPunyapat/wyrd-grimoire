import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const passcode = "a local browser test passcode";

async function campaign(page: Page) {
  await page.goto("/");
  const status = (await page.evaluate(async () => (await fetch("/api/auth/status")).json())) as {
    setupRequired: boolean;
  };
  await page.getByLabel("Passcode", { exact: true }).fill(passcode);
  await page
    .getByRole("button", { name: status.setupRequired ? /Set passcode & enter/ : /Unlock grimoire/ })
    .click();
  await expect(page.getByRole("heading", { name: "Your campaigns" })).toBeVisible();
  const id = await page.evaluate(async () => {
    const response = await fetch("/api/campaigns/quick-start", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Wyrd": "1" },
      body: JSON.stringify({ name: "Preset Flow", characterName: "Wren", archetype: "cutpurse" }),
    });
    return ((await response.json()) as { id: string }).id;
  });
  await page.goto(`/#campaign=${id}`);
  await expect(page.getByLabel("What do you do?", { exact: true })).toBeVisible();
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Make yourself at home" });
  await expect(dialog.getByRole("group", { name: "Play screen preset" })).toBeVisible();
  return dialog;
}

test("Cockpit and Chat switch mid-campaign on the same play components", async ({ page }, info) => {
  await campaign(page);
  await page.getByLabel("What do you do?", { exact: true }).fill("look around the inn");
  await page.getByLabel("What do you do?", { exact: true }).press("Enter");
  await expect(page.locator(".passage-main .prose")).toBeVisible();

  let dialog = await openSettings(page);
  await dialog.getByRole("button", { name: "Cockpit", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Cockpit", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("html")).toHaveAttribute("data-preset", "cockpit");
  await expect(page.locator("main.play-layout")).toHaveAttribute("data-preset", "cockpit");

  // The right-hand log is real: the watch list and the passage notes sit beside the reading column.
  await expect(page.locator(".passage-main .prose")).toBeVisible();
  await expect(page.locator(".margin-notes").last()).toBeVisible();
  await expect(page.locator(".watch-list").last()).toBeVisible();
  const watch = page.locator(".watch-list").last();
  await expect(watch.getByRole("heading", { name: "Watch" })).toBeVisible();
  await expect(watch).toContainText("Nothing watched");
  if (info.project.name === "desktop") {
    const prose = (await page.locator(".passage-main").last().boundingBox())!;
    const rail = (await page.locator(".margin-notes").last().boundingBox())!;
    expect(rail.x).toBeGreaterThan(prose.x + prose.width - 2);
  }
  // The settings dialog is modal; close it before pointing at the chrome underneath.
  await page.getByRole("button", { name: "Close settings" }).click();
  // 1px accent line for the selected menu item.
  const sheet = page.locator(".strip-menus button").filter({ hasText: "Character" }).first();
  await sheet.hover();
  expect(await sheet.evaluate((node) => getComputedStyle(node).borderBottomWidth)).toBe("1px");
  await page.screenshot({ path: info.outputPath("cockpit.png"), fullPage: true });
  dialog = await openSettings(page);

  // Chat is the true-black, rounded preset with a bubble composer.
  await dialog.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-preset", "chat");
  expect(
    await page.locator("main.play-layout").evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toBe("rgb(0, 0, 0)");
  const bubble = page.locator(".input-row");
  expect(await bubble.evaluate((node) => getComputedStyle(node).borderRadius)).toContain("999px");
  const note = page.locator(".margin-notes .gm-card, .margin-notes .roll-notes").first();
  if (await note.count()) {
    expect(await note.evaluate((node) => getComputedStyle(node).borderRadius)).toContain("14px");
  }
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.screenshot({ path: info.outputPath("chat.png"), fullPage: true });
  dialog = await openSettings(page);

  // Back to Reader, then reload: the last choice is remembered.
  await dialog.getByRole("button", { name: "Reader", exact: true }).click();
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-preset", "reader");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-preset", "reader");
});

test("the dials scale the story, column, density and motion and persist", async ({ page }, info) => {
  await campaign(page);
  await page.getByLabel("What do you do?", { exact: true }).fill("look around");
  await page.getByLabel("What do you do?", { exact: true }).press("Enter");
  await expect(page.locator(".passage-main .prose")).toBeVisible();
  const before = await page
    .locator(".prose")
    .last()
    .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  const measureBefore = (await page.locator(".story-inner").boundingBox())!.width;

  const dialog = await openSettings(page);
  await dialog.getByLabel("Text size").selectOption("large");
  await dialog.getByLabel("Column width").selectOption("wide");
  await dialog.getByLabel("Density").selectOption("compact");
  await dialog.getByLabel("Motion").selectOption("none");
  await expect(page.locator("html")).toHaveAttribute("data-text-size", "large");
  await expect(page.locator("html")).toHaveAttribute("data-column", "wide");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "none");

  const after = await page
    .locator(".prose")
    .last()
    .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  expect(after).toBeGreaterThan(before);
  if (info.project.name === "desktop") {
    const measureAfter = (await page.locator(".story-inner").boundingBox())!.width;
    expect(measureAfter).toBeGreaterThan(measureBefore);
  }
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-text-size", "large");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "none");

  // Both layouts keep every control reachable and pass WCAG AA on the same data.
  for (const preset of ["cockpit", "chat"]) {
    await page.evaluate((next) => {
      const raw = localStorage.getItem("wyrd-play-preferences");
      const value = raw ? JSON.parse(raw) : {};
      localStorage.setItem("wyrd-play-preferences", JSON.stringify({ ...value, preset: next }));
    }, preset);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-preset", preset);
    const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(accessibility.violations, preset).toEqual([]);
  }
});
