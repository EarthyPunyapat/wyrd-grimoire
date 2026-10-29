import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const passcode = "a local browser test passcode";

async function unlock(page: Page) {
  await page.goto("/");
  await page.getByLabel("Passcode", { exact: true }).fill(passcode);
  await page.getByRole("button", { name: /Set passcode & enter|Unlock grimoire/ }).click();
  await expect(page.getByRole("heading", { name: "Your campaigns" })).toBeVisible();
}

async function quickStart(page: Page, name: string, world: string) {
  await unlock(page);
  const id = await page.evaluate(
    async ({ name, world }) => {
      const response = await fetch("/api/campaigns/quick-start", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Wyrd": "1" },
        body: JSON.stringify({ name, characterName: "Wren", archetype: "cutpurse", world }),
      });
      return ((await response.json()) as { id: string }).id;
    },
    { name, world },
  );
  await page.goto(`/#campaign=${id}`);
  await expect(page.getByRole("button", { name: /Campaign settings/ })).toBeVisible();
}

async function begin(page: Page) {
  await unlock(page);
  await page.getByRole("button", { name: "+ New campaign", exact: true }).click();
  await page.getByLabel("Campaign name", { exact: true }).fill("World Test");
  await page
    .getByLabel("What kind of adventure or world do you want?")
    .fill("A cold frontier with a buried secret.");
  await page.getByRole("button", { name: "Preview example world →" }).click();
  await page.getByRole("button", { name: "Begin adventure →" }).click();
  await expect(page.getByRole("heading", { name: "Relay Nine" })).toBeVisible();
}

const open = async (page: Page, name: string, phone: boolean) => {
  if (phone) await page.getByRole("button", { name, exact: true }).click();
  else await page.getByRole("tab", { name }).click();
};

test("a codex fact can be pinned and the pin count follows", async ({ page }, info) => {
  test.skip(info.project.name === "phone", "The phone opens the codex from a reference card");
  await quickStart(page, "Pin Test", "ashford-ferry");
  // Knowledge of the people in the room arrives after the first turn.
  const box = page.getByLabel("What do you do?", { exact: true });
  await box.fill("look around the room");
  await box.press("Enter");
  await expect(box).toBeEnabled({ timeout: 15000 });
  await open(page, "Codex", false);
  const codex = page.getByRole("complementary").getByRole("region", { name: "Codex" });
  await expect(codex.getByText("0 of 20 facts pinned.")).toBeVisible();
  const pin = codex.getByRole("button", { name: /^Pin / }).first();
  await pin.click();
  await expect(codex.getByText("1 of 20 facts pinned.")).toBeVisible();
  await expect(codex.getByRole("button", { name: /^Unpin / })).toBeVisible();
});

test("map, travel, journal and codex: the world beyond the opening site", async ({ page }, info) => {
  const phone = info.project.name === "phone";
  await begin(page);
  await open(page, "Map", phone);
  const map = page.getByRole(phone ? "dialog" : "complementary").getByRole("region", { name: "Map" });
  await expect(map.getByRole("img", { name: /Map of/ })).toBeVisible();
  await map.getByRole("button", { name: /Greywater Market/ }).click();
  await expect(page.getByLabel("What do you do?", { exact: true })).toHaveValue(
    "I travel to Greywater Market",
  );
  await page.getByLabel("What do you do?", { exact: true }).press("Enter");
  await expect(page.getByLabel("What do you do?", { exact: true })).toBeEnabled({ timeout: 15000 });
  await expect(page.locator(".location-bar")).toContainText(/Greywater|road/);
  await page.screenshot({ path: info.outputPath("m5-after-travel.png") });
  if (!phone) {
    await open(page, "Codex", phone);
    const codex = page.getByRole("complementary").getByRole("region", { name: "Codex" });
    await expect(codex).toContainText("Greywater Market");
    await expect(codex).not.toContainText("nearly bankrupt");
    await page.screenshot({ path: info.outputPath("m5-codex.png") });
    await open(page, "Journal", phone);
    await expect(page.getByRole("complementary").getByRole("region", { name: "Journal" })).toContainText(
      "Quests",
    );
    const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(accessibility.violations).toEqual([]);
  }
});
