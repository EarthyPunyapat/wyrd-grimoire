import { expect, test } from "@playwright/test";

test("source creation offers a revisable style sample and all review overrides", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Passcode", { exact: true }).fill("a local browser test passcode");
  await page.getByRole("button", { name: /Set passcode & enter|Unlock grimoire/ }).click();
  await page.getByRole("button", { name: "+ New campaign", exact: true }).click();
  await page.getByRole("button", { name: "Create new world", exact: true }).click();
  await page.getByLabel("Campaign name", { exact: true }).fill("Source Test");
  await page.getByRole("radio", { name: /Inside a source/ }).check();
  await page.getByLabel("Source title", { exact: true }).fill("Will-o'-the-wisp");
  await page
    .getByLabel("What kind of adventure or world do you want?")
    .fill("source workflow: a cosmic adventure with guiding lights");
  await page.getByRole("button", { name: "Preview example world →" }).click();
  await expect(page.getByLabel("Starting Level", { exact: true })).toHaveValue("9");
  await expect(page.getByLabel("Dice", { exact: true })).toHaveValue("d20");
  await expect(page.getByRole("textbox", { name: "Sample paragraph", exact: true })).toHaveValue(
    "A green light wakes in your palm.",
  );
  await page.getByLabel("Your own words").fill("More like a tense thriller");
  await page.getByRole("button", { name: "More like… Revise sample" }).click();
  await expect(page.getByRole("textbox", { name: "Sample paragraph", exact: true })).toHaveValue(
    /Rain needles/,
  );
  await page.getByLabel("Starting Level", { exact: true }).fill("12");
  await page.getByLabel("Dice", { exact: true }).selectOption("d100");
  await page.getByText("Subsystem toggles", { exact: true }).click();
  await page.getByLabel("Survival — hunger and thirst", { exact: true }).check();
  await page.getByRole("combobox", { name: "Encumbrance", exact: true }).selectOption("slots");
  await page.getByRole("button", { name: "Begin adventure →" }).click();
  await expect(page.getByRole("heading", { name: "Relay Nine" })).toBeVisible();
  const campaigns = await page.evaluate(async () => (await fetch("/api/campaigns")).json());
  const id = campaigns.find((c: { name: string }) => c.name === "Source Test").id;
  const data = await page.evaluate(
    async (campaignId) => ({
      settings: await (await fetch(`/api/campaigns/${campaignId}/settings`)).json(),
      view: await (await fetch(`/api/campaigns/${campaignId}/view`)).json(),
    }),
    id,
  );
  expect(data.settings.settings.style.playerWords).toBe("More like a tense thriller");
  expect(data.settings.settings.subsystems.survival).toBe(true);
  expect(data.settings.settings.subsystems.inventory).toBe("slots");
  expect(data.view.pc.level).toBe(12);
  expect(data.view.pc.abilities[0].name).toBe("Marshlight");
  expect(JSON.stringify(data.view)).not.toContain("relayStopped");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("textbox", { name: /Your own words/ }).fill("Even terser");
  await settings
    .getByRole("textbox", { name: "Sample paragraph", exact: true })
    .fill("A light. A door. A choice.");
  await settings.getByRole("button", { name: "Save settings" }).click();
  await expect(settings.getByText("Settings saved.")).toBeVisible();
  const profile = await page.evaluate(
    async (campaignId) =>
      (await (await fetch(`/api/campaigns/${campaignId}/settings`)).json()).settings.style,
    id,
  );
  expect(profile.playerWords).toBe("Even terser");
  expect(profile.sample).toBe("A light. A door. A choice.");
});
