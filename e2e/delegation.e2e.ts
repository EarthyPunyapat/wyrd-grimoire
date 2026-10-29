import { expect, test } from "@playwright/test";

test("loyal Ari delegates, speaks and reports; her voice persists without an approval meter", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
        name: "Delegation",
        characterName: "Ethan",
        archetype: "hunter",
        resolution: "d20",
      }),
    });
    if (!made.ok) throw new Error(await made.text());
    const { id } = (await made.json()) as { id: string };
    const seeded = await fetch(`/api/testing/${id}/ari`, { method: "POST", headers });
    if (!seeded.ok) throw new Error(await seeded.text());
    return id;
  });
  await page.goto(`/#campaign=${id}`);
  await page.reload();
  await page.getByRole("button", { name: "Delegate to Ari", exact: true }).click();
  const input = page.getByLabel("What do you do?", { exact: true });
  await expect(input).toHaveValue("Delegate to Ari: ");
  await input.fill("delegation workflow");
  await input.press("Enter");
  await expect(page.locator(".gm-card")).toContainText("Delegation report");
  await expect(page.locator(".gm-card")).toContainText("Completed.");
  await expect(page.locator(".speaker")).toHaveText("Ari");
  await page.getByRole("button", { name: "Party", exact: true }).click();
  const party = page.getByRole("dialog");
  await party.getByRole("button", { name: "Ari", exact: true }).click();
  await expect(party.getByRole("meter")).toHaveCount(0);
  await expect(party).toContainText("Loyal");
  await party.getByRole("textbox", { name: "Voice profile", exact: true }).fill("Warm, precise, and wry.");
  await party.getByRole("button", { name: "Save voice profile", exact: true }).click();
  await expect(party).toContainText("Voice: Warm, precise, and wry.");
  await page.screenshot({ path: info.outputPath("ari-party.png"), fullPage: true });
  await party.getByRole("button", { name: "Close panel" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Delegate to Ari", exact: true })).toBeVisible();
  await expect(page.locator(".gm-card")).toContainText("Completed.");
  expect(errors).toEqual([]);
});
