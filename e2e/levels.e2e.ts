import { expect, test } from "@playwright/test";

test("Levels: ability hotbar, explicit milestone acceptance, sheet and reload", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Passcode", { exact: true }).fill("a local browser test passcode");
  await page.getByRole("button", { name: /Set passcode & enter|Unlock grimoire/ }).click();
  await expect(page.getByRole("heading", { name: "Your campaigns" })).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = await fetch("/api/campaigns/quick-start", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Wyrd": "1" },
      body: JSON.stringify({
        name: "Level workflow",
        characterName: "Wren",
        archetype: "hunter",
        world: "tavern-brawl",
        resolution: "d20",
      }),
    });
    if (!r.ok) throw new Error(await r.text());
    return (await r.json()).id as string;
  });
  await page.goto(`/#campaign=${id}`);
  await page.reload();
  await expect(page.locator(".status-strip")).toContainText("Level 1");
  const input = page.getByLabel("What do you do?", { exact: true });
  await input.fill("level workflow");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "Accept level-up", exact: true })).toBeEnabled();
  await expect(page.locator(".status-strip")).toContainText("Level 1");
  await expect(page.locator(".hotbar")).toContainText("Marshfire");
  await page.getByRole("button", { name: "Accept level-up", exact: true }).click();
  await expect(page.locator(".status-strip")).toContainText("Level 2");
  await page.getByRole("button", { name: /Abilities/ }).click();
  await page
    .getByRole("dialog", { name: "Abilities" })
    .getByRole("button", { name: /Marshfire/ })
    .click();
  await expect(input).toHaveValue("Use Marshfire: ");
  await page.getByRole("button", { name: "Character", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Character" });
  await expect(sheet).toContainText("Rank 3");
  await expect(sheet).toContainText("Once per scene");
  await expect(sheet).toContainText("Power rating");
  await page.screenshot({ path: info.outputPath("levels-sheet.png"), fullPage: true });
  await sheet.getByRole("button", { name: "Close status screen" }).click();
  await page.reload();
  await expect(page.locator(".status-strip")).toContainText("Level 2");
  await expect(page.getByRole("button", { name: "Accept level-up", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
