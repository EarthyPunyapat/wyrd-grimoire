import { expect, type Page, test } from "@playwright/test";

const passcode = "a local browser test passcode";

async function unlock(page: Page) {
  await page.goto("/");
  await page.getByLabel("Passcode", { exact: true }).fill(passcode);
  await page.getByRole("button", { name: /Set passcode & enter|Unlock grimoire/ }).click();
  await expect(page.getByRole("heading", { name: "Your campaigns" })).toBeVisible();
}

/** An authored quick-start world: it has a market and a starting kit, unlike a generated pack. */
async function market(page: Page) {
  await unlock(page);
  const id = await page.evaluate(async () => {
    const response = await fetch("/api/campaigns/quick-start", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Wyrd": "1" },
      body: JSON.stringify({ name: "Purse Test", characterName: "Wren", archetype: "cutpurse" }),
    });
    return ((await response.json()) as { id: string }).id;
  });
  await page.goto(`/#campaign=${id}`);
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
}

const coins = (panel: ReturnType<Page["getByRole"]>) =>
  panel.locator(".stat-label", { hasText: "Coins" }).locator("strong");

test("inventory shows coins, gear and a working shop", async ({ page }, info) => {
  const phone = info.project.name === "phone";
  await market(page);
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  const panel = page.getByRole("dialog").getByRole("region", {
    name: "Inventory",
  });
  await expect(panel.getByRole("heading", { name: "Equipped" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Carried" })).toBeVisible();
  await expect(coins(panel)).toHaveText("50");
  // The bag never trades (D163) and no menu tab does either: the vendor is at this place (D166).
  await expect(panel.getByRole("button", { name: /^Buy · / })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /^Sell / })).toHaveCount(0);
  await expect(page.getByRole("dialog").getByRole("tab", { name: /Market/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Close status screen" }).click();
  await page.getByRole("button", { name: /Browse wares/ }).click();
  const stall = page.getByRole("dialog", { name: "The River Market" });
  const buy = stall.getByRole("button", { name: /^Buy · / }).first();
  await expect(buy).toBeEnabled();
  await buy.click();
  await expect(stall.getByText("Bought.")).toBeVisible();
  await expect(stall.locator(".stat-label strong")).not.toHaveText("50");
  page.once("dialog", (d) => void d.accept());
  await stall
    .getByRole("button", { name: /^Sell one / })
    .first()
    .click();
  await expect(stall.getByText("Sold.")).toBeVisible();
});

test("a generated campaign has no merchant and does not crash on an empty pack", async ({ page }, info) => {
  await unlock(page);
  await page.getByRole("button", { name: "+ New campaign", exact: true }).click();
  await page.getByLabel("Campaign name", { exact: true }).fill("Empty Pack Test");
  await page
    .getByLabel("What kind of adventure or world do you want?")
    .fill("A cold frontier with a buried secret.");
  await page.getByRole("button", { name: "Preview example world →" }).click();
  await page.getByRole("button", { name: "Begin adventure →" }).click();
  await expect(page.getByRole("heading", { name: "Relay Nine" })).toBeVisible();
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  const panel = page.getByRole("dialog").getByRole("region", { name: "Inventory" });
  // No vendor here: nothing to browse.
  await expect(page.getByRole("button", { name: /Browse wares/ })).toHaveCount(0);
  await expect(panel.getByText("Nothing but what you stand in.")).toBeVisible();
  await expect(coins(panel)).toHaveText(/\d+/);
});
