import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const passcode = "a local browser test passcode";

async function unlock(page: Page) {
  await page.goto("/");
  await page.getByLabel("Passcode", { exact: true }).fill(passcode);
  await page.getByRole("button", { name: /Set passcode & enter|Unlock grimoire/ }).click();
  await expect(page.getByRole("heading", { name: "Your campaigns" })).toBeVisible();
}

async function market(page: Page) {
  await unlock(page);
  const id = await page.evaluate(async () => {
    const response = await fetch("/api/campaigns/quick-start", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Wyrd": "1" },
      body: JSON.stringify({ name: "Status Screen", characterName: "Wren", archetype: "sellsword" }),
    });
    return ((await response.json()) as { id: string }).id;
  });
  await page.goto(`/#campaign=${id}`);
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
}

const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

test("C, I, Q, J and M open their tab and Esc returns to the story", async ({ page }, info) => {
  test.skip(info.project.name === "phone", "keyboard shortcuts are the desktop path; tabs work by tap");
  await market(page);
  await blur(page);
  for (const [key, name] of [
    ["c", "Character"],
    ["i", "Inventory"],
    ["q", "Quests"],
    ["j", "Journal"],
    ["m", "Map"],
  ] as const) {
    await page.keyboard.press(key);
    const dialog = page.getByRole("dialog", { name });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("tab", { name: new RegExp(name) })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await blur(page);
  }
});

test("tabs change with the arrow keys and touch", async ({ page }) => {
  await market(page);
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Inventory" });
  await expect(dialog).toBeVisible();
  const panel = dialog.getByRole("tabpanel");
  await expect(panel.getByRole("heading", { name: "Equipped" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Carried" })).toBeVisible();

  await dialog.getByRole("tab", { name: /Inventory/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog", { name: "Quests" })).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
});

test("an item opens the story card; equip and move are instant and use sends a turn", async ({ page }) => {
  await market(page);
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Inventory" });
  const panel = dialog.getByRole("tabpanel");
  await expect(panel.getByRole("heading", { name: "Equipped" })).toBeVisible();

  // The paper doll's main hand opens the same card the story uses.
  await panel.getByRole("button", { name: "Main hand: Arming Sword" }).click();
  const card = panel.locator(".gm-card.item-card");
  await expect(card).toContainText("Arming Sword");
  await expect(card).toContainText("Weapon · main hand");

  // Stowing is instant: the dialog stays open and the item moves to the bag.
  await panel.getByRole("button", { name: "Move to bag" }).click();
  await expect(panel.getByRole("button", { name: "Main hand: empty" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Arming Sword, Weapon, carried" })).toBeVisible();

  // And wielding it again is instant too.
  await panel.getByRole("button", { name: "Arming Sword, Weapon, carried" }).click();
  await panel.getByRole("button", { name: "Wield in main hand" }).click();
  await expect(panel.getByRole("button", { name: "Main hand: Arming Sword" })).toBeVisible();

  // Sorting is a local, immediate reorder.
  await panel.getByRole("button", { name: /^Sort: / }).click();
  await expect(panel.getByText(/^Sorted by /)).toBeVisible();

  // Use is a story turn: the status screen closes and the passage resolves.
  await panel.getByRole("button", { name: "Main hand: Arming Sword" }).click();
  await panel.getByRole("button", { name: "Use", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "↻ Reroll narration" })).toBeEnabled({
    timeout: 20000,
  });
});

test("the status screen stays above WCAG AA on desktop and phone", async ({ page }) => {
  await market(page);
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Inventory" })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
});
