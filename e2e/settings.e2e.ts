import { expect, type Page, test } from "@playwright/test";

const passcode = "a local browser test passcode";

async function campaign(page: Page) {
  await page.goto("/");
  const status = (await page.evaluate(async () => (await fetch("/api/auth/status")).json())) as {
    setupRequired: boolean;
  };
  await page.getByLabel("Passcode", { exact: true }).fill(passcode);
  await page
    .getByRole("button", {
      name: status.setupRequired ? /Set passcode & enter/ : /Unlock grimoire/,
    })
    .click();
  await expect(page.getByRole("heading", { name: "Your campaigns" })).toBeVisible();
  const id = await page.evaluate(async () => {
    const response = await fetch("/api/campaigns/quick-start", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Wyrd": "1" },
      body: JSON.stringify({ name: "Settings Flow", characterName: "Wren", archetype: "cutpurse" }),
    });
    return ((await response.json()) as { id: string }).id;
  });
  await page.goto(`/#campaign=${id}`);
  await expect(page.getByRole("button", { name: /Campaign settings/ })).toBeVisible();
  return id;
}

test("campaign settings show locks, apply a preset and keep a custom label", async ({ page }) => {
  const id = await campaign(page);
  await page.getByRole("button", { name: /Campaign settings/ }).click();
  const dialog = page.getByRole("dialog", { name: "Campaign settings" });
  const presets = dialog.getByRole("group", { name: "Campaign preset" });
  await expect(presets.getByRole("button", { name: "Standard", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Structural choices are greyed out with the reason the engine gives.
  await expect(dialog.getByLabel("Dice")).toBeDisabled();
  await expect(dialog.getByText(/The dice system is chosen at creation and locked/)).toBeVisible();
  await expect(dialog.getByLabel("Character growth")).toBeDisabled();
  await expect(dialog.getByLabel("Hardcore")).toBeDisabled();

  await presets.getByRole("button", { name: "Story", exact: true }).click();
  await dialog.getByRole("button", { name: "Save settings" }).click();
  await expect(dialog.getByText("Settings saved.")).toBeVisible();
  await expect(presets.getByRole("button", { name: "Story", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Changing a toggle keeps the base preset in the label.
  await dialog.getByLabel("Ammunition counting").check();
  await dialog.getByRole("button", { name: "Save settings" }).click();
  await expect(dialog.getByText("Custom (from Story)")).toBeVisible();

  // The API refuses a locked change even if the UI is bypassed.
  const refused = await page.evaluate(async (campaignId) => {
    const response = await fetch(`/api/campaigns/${campaignId}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Wyrd": "1" },
      body: JSON.stringify({ structural: { resolution: "d20" } }),
    });
    return { status: response.status, body: (await response.json()) as { path: string; reason: string } };
  }, id);
  expect(refused.status).toBe(409);
  expect(refused.body.path).toBe("structural.resolution");
  expect(refused.body.reason).toContain("chosen at creation and locked");
});
