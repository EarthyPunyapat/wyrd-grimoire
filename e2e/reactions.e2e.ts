import { expect, test } from "@playwright/test";

test("an assault has named target and bystander dialogue that survives reload", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Passcode", { exact: true }).fill("a local browser test passcode");
  await page.getByRole("button", { name: /Set passcode & enter|Unlock grimoire/ }).click();
  await expect(page.getByRole("heading", { name: "Your campaigns" })).toBeVisible();
  const id = await page.evaluate(async () => {
    const response = await fetch("/api/campaigns/quick-start", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Wyrd": "1" },
      body: JSON.stringify({
        name: "Public assault regression",
        characterName: "Wren",
        archetype: "hunter",
        world: "tavern-brawl",
      }),
    });
    if (!response.ok) throw new Error(`Campaign creation failed: ${response.status}`);
    return ((await response.json()) as { id: string }).id;
  });
  await page.goto(`/#campaign=${id}`);
  await page.reload();
  const input = page.getByLabel("What do you do?", { exact: true });
  await input.fill("I punch Mags");
  await input.press("Enter");
  await expect(input).toBeEnabled({ timeout: 15000 });
  const last = page.locator(".prose").last();
  await expect(last.locator(".speaker").filter({ hasText: /^Mags$/ })).toBeVisible();
  await expect(last.locator(".speaker").filter({ hasText: /^Orla Tamsey$/ })).toBeVisible();
  await expect(last).not.toContainText("Unknown speaker");
  await page.reload();
  await expect(
    page
      .locator(".prose")
      .last()
      .locator(".speaker")
      .filter({ hasText: /^Orla Tamsey$/ }),
  ).toBeVisible();
});
