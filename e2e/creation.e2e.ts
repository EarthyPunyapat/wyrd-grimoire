import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const passcode = "a local browser test passcode";

async function world(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel("Passcode", { exact: true }).fill(passcode);
  await page.getByRole("button", { name: /Set passcode & enter|Unlock grimoire/ }).click();
  await page.getByRole("button", { name: "+ New campaign", exact: true }).click();
  await page.getByLabel("Campaign name", { exact: true }).fill(name);
  await page
    .getByLabel("What kind of adventure or world do you want?")
    .fill("A station mystery in the dark.");
  await page.getByRole("button", { name: "Preview example world →" }).click();
}

test("the sheet editor shows broken rules live and starts the edited character", async ({ page }, info) => {
  await world(page, "Editor Test");
  await page.getByRole("button", { name: "Customise character" }).click();
  const editor = page.getByRole("region", { name: "Build your character" });
  await expect(editor.getByText("This character is ready.")).toBeVisible();

  await editor.getByLabel("Name", { exact: true }).fill("Ines Varga");
  // Spend past the budget: the editor names the rule and blocks the start.
  for (let i = 0; i < 3; i++) {
    const raise = editor.getByRole("button", { name: /Raise / }).first();
    if (await raise.isEnabled()) await raise.click();
  }
  await expect(editor.getByRole("list", { name: "Rules to fix" })).toContainText("attribute points spent");
  await expect(page.getByRole("button", { name: "Begin adventure →" })).toBeDisabled();
  for (let i = 0; i < 3; i++)
    await editor
      .getByRole("button", { name: /Lower / })
      .first()
      .click();
  await expect(editor.getByText(/This character is ready|points unspent/).first()).toBeVisible();

  await editor.getByLabel("Backstory").fill("A reactor tech who stayed behind.");
  await editor.getByRole("button", { name: "Add a hook" }).click();
  await editor.getByLabel("Hook name").fill("Director Hale");
  await page.screenshot({ path: info.outputPath("m6-sheet-editor.png"), fullPage: true });
  if (info.project.name !== "phone") {
    const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(accessibility.violations).toEqual([]);
  }
  await expect(page.getByRole("button", { name: "Begin adventure →" })).toBeEnabled();
  await page.getByRole("button", { name: "Begin adventure →" }).click();
  await expect(page.getByRole("heading", { name: "Relay Nine" })).toBeVisible();
  const campaigns = await page.evaluate(async () => (await fetch("/api/campaigns")).json());
  expect(campaigns.map((c: { characterName: string }) => c.characterName)).toContain("Ines Varga");
});
