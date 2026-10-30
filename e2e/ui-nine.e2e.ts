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
  await page.getByRole("button", { name: "Create new world", exact: true }).click();
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

test("training picks a skill from a list; research continues one topic and can be abandoned", async ({
  page,
}) => {
  await begin(page, "Research Test");
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  const journal = page.getByRole("dialog").getByRole("region", { name: "Journal" });
  const skill = journal.getByLabel("Train a skill");
  await expect(skill).toBeVisible();
  expect(await skill.evaluate((el) => el.tagName)).toBe("SELECT");
  expect(await skill.locator("option").count()).toBeGreaterThan(3);

  const topic = journal.getByLabel("New topic");
  await topic.fill("Kryptonite");
  await journal.getByRole("button", { name: "Begin research" }).click();
  await expect(journal.locator(".research-row")).toHaveCount(1);
  await topic.fill("kryptonite");
  await expect(journal.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
  await journal.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(journal.locator(".research-row")).toHaveCount(1);
  await expect(journal.locator(".research-row .pips")).toHaveAttribute("aria-label", /^2 of /);

  page.once("dialog", (d) => void d.accept());
  await journal.getByRole("button", { name: "Abandon research into Kryptonite" }).click();
  await expect(journal.locator(".research-row")).toHaveCount(0);
  await expect(journal.getByText("No research under way.")).toBeVisible();
});

test("a vendor is a person at a place: the GM opens one here and the wares open as a pop-up", async ({
  page,
}) => {
  await begin(page, "Vendor Test");
  // No vendor at the start of this world: nothing to browse, and no shop tab anywhere.
  await expect(page.getByRole("button", { name: /Browse wares/ })).toHaveCount(0);
  await say(page, "vendor workflow");
  const card = page.locator(".shop-card");
  await expect(card).toContainText("Relay Commissary");
  await expect(card).toContainText("Quartermaster Ide");
  await expect(page.locator(".shop-here")).toContainText("Relay Commissary");
  await card.getByRole("button", { name: /Browse wares/ }).click();
  const shop = page.getByRole("dialog", { name: "Relay Commissary" });
  await expect(shop).toContainText("sold by Quartermaster Ide");
  await expect(shop).toContainText("Ration Bar");
  await shop.getByRole("button", { name: /^Buy · 2c/ }).click();
  await expect(shop.getByText("Bought.")).toBeVisible();
  await shop.getByRole("button", { name: "Close shop" }).click();
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("region", { name: "Inventory" })).toContainText(
    "Ration Bar",
  );
});
