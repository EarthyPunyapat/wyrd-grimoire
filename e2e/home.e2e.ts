import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const passcode = "a local browser test passcode";

async function unlocked(page: Page) {
  await page.goto("/");
  await page.getByLabel("Passcode", { exact: true }).fill(passcode);
  await page.getByRole("button", { name: /Set passcode & enter|Unlock grimoire/ }).click();
  await expect(page.getByRole("heading", { name: /Your next chapter/ })).toBeVisible();
}

async function previewWorld(page: Page, name: string) {
  await page.getByRole("button", { name: "+ New campaign", exact: true }).click();
  await page.getByLabel("Campaign name", { exact: true }).fill(name);
  await page
    .getByLabel("What kind of adventure or world do you want?")
    .fill("A station mystery in the dark, told quietly.");
  await page.getByRole("button", { name: "Preview example world →" }).click();
}

test("a campaign is renamed, archived and restored from the home page", async ({ page }, info) => {
  const tag = info.project.name === "phone" ? "Phone" : "Desktop";
  const original = `Home Management ${tag}`;
  const renamed = `Renamed Chronicle ${tag}`;
  await unlocked(page);
  await previewWorld(page, original);
  await page.getByRole("button", { name: "Begin adventure →" }).click();
  await expect(page.getByRole("heading", { name: "Relay Nine" })).toBeVisible();
  await page.getByRole("button", { name: "Wyrd Grimoire home" }).click();

  await page.getByRole("button", { name: `Rename ${original}` }).click();
  await page.getByLabel(new RegExp(`New name for ${original}`)).fill(renamed);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: new RegExp(renamed) }).first()).toBeVisible();

  await page.getByRole("button", { name: `Archive ${renamed}` }).click();
  await expect(page.getByText(renamed, { exact: true })).toBeHidden();
  await page.locator("details.codex-archive summary").click();
  await expect(page.getByText(renamed, { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("u5-home-archive.png"), fullPage: true });
  if (info.project.name !== "phone") {
    const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(accessibility.violations).toEqual([]);
  }
  await page.getByRole("button", { name: `Restore ${renamed}` }).click();
  await expect(page.getByRole("button", { name: new RegExp(renamed) }).first()).toBeVisible();
  // Leave the shared test server tidy for the other project.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: `Delete ${renamed}` }).click();
  await expect(page.getByText(renamed, { exact: true })).toBeHidden();
});

test("an unfinished creation waits in the draft library and resumes on demand", async ({ page }, info) => {
  const name = `Draft Library ${info.project.name === "phone" ? "Phone" : "Desktop"}`;
  await unlocked(page);
  await previewWorld(page, name);
  await expect(page.getByRole("region", { name: "Review your world" })).toBeVisible();
  await page.getByRole("button", { name: "Close new campaign" }).click();
  await expect(page.getByRole("heading", { name: "Unfinished stories" })).toBeVisible();
  await expect(page.getByText(name, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: `Continue ${name}` }).click();
  await expect(page.getByRole("region", { name: "Review your world" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Begin adventure →" })).toBeEnabled();
  await page.screenshot({ path: info.outputPath("u5-home-draft-resume.png"), fullPage: true });
  await page.getByRole("button", { name: "Close new campaign" }).click();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: `Discard ${name}` }).click();
  await expect(page.getByText(name, { exact: true })).toBeHidden();
});

test("the source choice reveals the source fields and clears them again", async ({ page }) => {
  await unlocked(page);
  await page.getByRole("button", { name: "+ New campaign", exact: true }).click();
  await expect(page.getByLabel("Source title", { exact: true })).toBeHidden();
  await page.getByRole("radio", { name: /Inside a source/ }).check();
  await expect(page.getByLabel("Source title", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Source wiki", { exact: true })).toHaveValue("en.wikipedia.org");
  await page.getByRole("radio", { name: /An original world/ }).check();
  await expect(page.getByLabel("Source title", { exact: true })).toBeHidden();
});

test("a failed model revision says what happened and offers model settings", async ({ page }, info) => {
  await unlocked(page);
  await previewWorld(page, "Style Failure Test");
  await expect(page.getByRole("region", { name: "Review your world" })).toBeVisible();
  await page
    .getByLabel("Your own words — More like…")
    .fill("More like a quieter voice; make the provider fail");
  await page.getByRole("button", { name: "More like… Revise sample" }).click();
  const alert = page.getByRole("alert");
  await expect(alert.getByRole("heading", { name: "The storyteller couldn't finish" })).toBeVisible();
  await expect(alert).toContainText("could not be revised");
  await expect(alert.getByRole("button", { name: "Check model settings" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("u5-home-model-error.png"), fullPage: true });
  if (info.project.name !== "phone") {
    const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(accessibility.violations).toEqual([]);
  }
  await alert.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("alert")).toBeHidden();
});
