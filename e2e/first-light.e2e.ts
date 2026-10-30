import { expect, type Page, test } from "@playwright/test";

const passcode = "a local browser test passcode";

async function begin(page: Page) {
  await page.goto("/");
  await page.getByLabel("Passcode", { exact: true }).fill(passcode);
  await page.getByRole("button", { name: /Set passcode & enter|Unlock grimoire/ }).click();
  await page.getByRole("button", { name: "+ New campaign", exact: true }).click();
  await page.getByLabel("Campaign name", { exact: true }).fill("Pictures Test");
  await page
    .getByLabel("What kind of adventure or world do you want?")
    .fill("A cold frontier with a buried secret.");
  await page.getByRole("button", { name: "Preview example world →" }).click();
  await page.getByRole("button", { name: "Begin adventure →" }).click();
  await expect(page.getByRole("heading", { name: "Relay Nine" })).toBeVisible();
}

test("pictures arrive after play: the place banner, portraits, and a picker for an uncertain match", async ({
  page,
}) => {
  await begin(page);
  const box = page.getByLabel("What do you do?", { exact: true });
  await box.fill("look around");
  await box.press("Enter");
  await expect(box).toBeEnabled({ timeout: 15000 });

  // The worker runs in the background after turns and view loads; a reload shows what it found.
  await expect
    .poll(
      async () => {
        await page.reload();
        await page.getByLabel("What do you do?", { exact: true }).waitFor();
        return page.locator(".place-banner img").count();
      },
      { timeout: 20000 },
    )
    .toBe(1);
  await expect(page.locator(".place-banner img")).toHaveAttribute("src", /^\/api\/media\/[0-9a-f]{64}$/);

  await page.getByRole("button", { name: "Character", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Character" });
  await expect(sheet.locator("img.entity-portrait")).toBeVisible();
  await sheet.getByRole("button", { name: "Close status screen" }).click();

  // Greywater Market has no page of its own: the Codex offers the wiki's two candidates.
  await expect
    .poll(
      async () => {
        await page.reload();
        await page.getByRole("button", { name: "Codex", exact: true }).click();
        const n = await page.getByRole("group", { name: "Choose a picture for Greywater Market" }).count();
        await page.getByRole("button", { name: "Close status screen" }).click();
        return n;
      },
      { timeout: 30000 },
    )
    .toBe(1);
  await page.getByRole("button", { name: "Codex", exact: true }).click();
  const picker = page.getByRole("group", { name: "Choose a picture for Greywater Market" });
  await picker.getByRole("button", { name: /Use Grey Water/ }).click();
  await expect(picker).toHaveCount(0);
  const entry = page.locator('[id^="codex-"]', { hasText: "Greywater Market" }).first();
  await expect(entry.locator("img.entity-portrait")).toBeVisible();
});
