import { expect, test } from "@playwright/test";

test("Cockpit watches an off-scene companion, reports a daily skip, and edits the persistent watch list", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem("wyrd-play-preferences", JSON.stringify({ preset: "cockpit" })),
  );
  await page.goto("/");
  await page.getByLabel("Passcode", { exact: true }).fill("a local browser test passcode");
  await page.getByRole("button", { name: /Set passcode & enter|Unlock grimoire/ }).click();
  await expect(page.getByRole("heading", { name: "Your campaigns" })).toBeVisible();
  const id = await page.evaluate(async () => {
    const headers = { "Content-Type": "application/json", "X-Wyrd": "1" };
    const made = await fetch("/api/campaigns/quick-start", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "God-game",
        characterName: "Ethan",
        archetype: "hunter",
        resolution: "d20",
      }),
    });
    const { id } = (await made.json()) as { id: string };
    const seeded = await fetch(`/api/testing/${id}/ari`, { method: "POST", headers });
    if (!seeded.ok) throw new Error(await seeded.text());
    return id;
  });
  await page.goto(`/#campaign=${id}`);
  await page.reload();
  const input = page.getByLabel("What do you do?", { exact: true });
  await input.fill("skip workflow");
  await input.press("Enter");
  await expect(page.locator(".gm-card").filter({ hasText: "Watch: Ari" })).toContainText(
    "No notable changes",
  );
  await expect(page.locator(".gm-card").filter({ hasText: "Time skip" })).toContainText("2 days");
  const rail = page.getByRole("region", { name: "Watch list", exact: true });
  await expect(rail).toContainText("Ari");
  await expect(rail).not.toContainText("Ethan");
  await expect(page.locator("html")).toHaveAttribute("data-preset", "cockpit");
  await page.getByRole("button", { name: "Codex", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Codex", exact: true });
  await dialog.getByRole("button", { name: "Unwatch Ari", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Watch Ari", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close status screen" }).click();
  await expect(rail).toContainText("Nothing watched");
  await page.reload();
  await expect(rail).toContainText("Nothing watched");
  await page.getByRole("button", { name: "Codex", exact: true }).click();
  await dialog.getByRole("button", { name: "Watch Ari", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Unwatch Ari", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close status screen" }).click();
  await expect(rail).toContainText("Ari");
  await page.screenshot({ path: info.outputPath("cockpit-watch.png"), fullPage: true });
  expect(errors).toEqual([]);
});
