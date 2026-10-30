import { expect, type Page, test } from "@playwright/test";

const passcode = "a local browser test passcode";

async function unlock(page: Page) {
  await page.goto("/");
  await page.getByLabel("Passcode", { exact: true }).fill(passcode);
  await page.getByRole("button", { name: /Set passcode & enter|Unlock grimoire/ }).click();
  await expect(page.getByRole("heading", { name: "Your campaigns" })).toBeVisible();
}

async function begin(page: Page, name: string) {
  await unlock(page);
  await page.getByRole("button", { name: "+ New campaign", exact: true }).click();
  await page.getByLabel("Campaign name", { exact: true }).fill(name);
  await page
    .getByLabel("What kind of adventure or world do you want?")
    .fill("A cold frontier with a buried secret.");
  await page.getByRole("button", { name: "Preview example world →" }).click();
  await page.getByRole("button", { name: "Begin adventure →" }).click();
  await expect(page.getByRole("heading", { name: "Relay Nine" })).toBeVisible();
}

async function say(page: Page, text: string) {
  const box = page.getByLabel("What do you do?", { exact: true });
  await box.fill(text);
  await box.press("Enter");
  await expect(box).toBeEnabled({ timeout: 15000 });
}

test("clicking a GM choice plays it as a turn, not as a stale clarification", async ({ page }) => {
  await begin(page, "Choice Test");
  await say(page, "choice workflow");
  const choice = page.locator(".gm-choices button", { hasText: "Wait by the stove" });
  await expect(choice).toBeVisible();
  await choice.click();
  await expect(page.getByLabel("What do you do?", { exact: true })).toBeEnabled({ timeout: 15000 });
  await expect(page.getByText("no longer current")).toHaveCount(0);
  await expect(page.locator(".player-input", { hasText: "Wait by the stove" })).toBeVisible();
});
