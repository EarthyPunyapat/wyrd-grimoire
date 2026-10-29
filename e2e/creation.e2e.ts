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

test("the form wizard walks every step, with a suggestion, into the sheet editor", async ({ page }) => {
  await world(page, "Wizard Test");
  await page.getByRole("button", { name: /Build step by step/ }).click();
  const wizard = page.getByRole("region", { name: "Build your character step by step" });
  await expect(wizard.getByText("STEP 1 OF 6")).toBeVisible();
  const before = await wizard.getByLabel("Name", { exact: true }).inputValue();
  await wizard.getByRole("button", { name: "Suggest a name" }).click();
  await expect(wizard.getByLabel("Name", { exact: true })).not.toHaveValue(before);
  const steps = ["Attributes", "Skills", "Talents and gear", "Looks and backstory", "Hooks"];
  for (const [i, next] of steps.entries()) {
    await wizard.getByRole("button", { name: `Next: ${next} →` }).click();
    await expect(wizard.getByText(`STEP ${i + 2} OF 6 · ${next.toUpperCase()}`)).toBeVisible();
  }
  await wizard.getByRole("button", { name: "Suggest a hook" }).click();
  await expect(wizard.getByLabel("Hook name")).toHaveCount(1);
  await wizard.getByRole("button", { name: "Review the whole sheet →" }).click();
  await expect(page.getByRole("region", { name: "Build your character" })).toBeVisible();
  await page.getByRole("button", { name: "Begin adventure →" }).click();
  await expect(page.getByRole("heading", { name: "Relay Nine" })).toBeVisible();
});

test("session zero builds the character from answers with a live sheet beside the chat", async ({
  page,
}, info) => {
  await world(page, "Interview Test");
  await page.getByRole("button", { name: /Talk it through/ }).click();
  const chat = page.getByRole("region", { name: "Session zero" });
  const sheet = page.getByRole("complementary", { name: "Your character so far" });
  const answers = [
    "A tired engineer who keeps the reactor running.",
    "Born on the station.",
    "Fixing things nobody else can.",
    "To find out why the relay went dark.",
    "My sister, Juno Reyes.",
    "Director Hale, who blames me.",
    "I owe the Quartermaster.",
    "A burn scar across my left hand.",
  ];
  for (const answer of answers) {
    await expect(chat.getByLabel("Your answer")).toBeEnabled();
    await chat.getByLabel("Your answer").fill(answer);
    await chat.getByRole("button", { name: "Answer" }).click();
  }
  await expect(sheet).toContainText("Juno Reyes");
  await expect(sheet).toContainText("Director Hale");
  await expect(chat).toContainText("Look over the sheet");
  await page.screenshot({ path: info.outputPath("m6-session-zero.png"), fullPage: true });
  if (info.project.name !== "phone") {
    const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(accessibility.violations).toEqual([]);
  }
  await chat.getByRole("button", { name: "Review the sheet →" }).click();
  const editor = page.getByRole("region", { name: "Build your character" });
  await expect(editor.getByLabel("Hook name").first()).toHaveValue("Juno Reyes");
  await page.getByRole("button", { name: "Begin adventure →" }).click();
  await expect(page.getByRole("heading", { name: "Relay Nine" })).toBeVisible();
});

test("XP from a closed chapter is spent in the Party tab", async ({ page }, info) => {
  test.skip(info.project.name === "phone", "The desktop panel covers the same screen");
  await world(page, "Growth Test");
  await page.getByRole("button", { name: "Begin adventure →" }).click();
  await expect(page.getByRole("heading", { name: "Relay Nine" })).toBeVisible();
  await page.getByLabel("What do you do?", { exact: true }).fill("look around");
  await page.getByLabel("What do you do?", { exact: true }).press("Enter");
  await expect(page.getByLabel("What do you do?", { exact: true })).toBeEnabled({ timeout: 15000 });
  await page.getByRole("tab", { name: "Journal" }).click();
  await page.getByRole("button", { name: /End session/ }).click();
  await page.getByRole("tab", { name: "Party" }).click();
  const party = page.getByRole("region", { name: "Party" });
  await expect(party.getByText("2 XP", { exact: true })).toBeVisible();
  // Every trained skill here is past 50% (3+ XP a step), so learn a new field skill for 2.
  await party.getByLabel("Specialisation").fill("station history");
  await party.getByRole("button", { name: "Learn (2 XP)" }).click();
  await expect(party.getByText("0 XP", { exact: true })).toBeVisible();
  await expect(party.getByText(/\(Station.History\)/i)).toBeVisible();
  await page.screenshot({ path: info.outputPath("m6-party.png") });
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
});
