import { expect, type Page, test } from "@playwright/test";

const passcode = "a local browser test passcode";

async function openCampaign(page: Page) {
  await page.goto("/");
  await page.getByLabel("Passcode", { exact: true }).fill(passcode);
  await page.getByRole("button", { name: /Set passcode & enter|Unlock grimoire/ }).click();
  await expect(page.getByRole("heading", { name: "Your campaigns" })).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = await fetch("/api/campaigns/quick-start", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Wyrd": "1" },
      body: JSON.stringify({ name: "Save Points", characterName: "Wren", archetype: "cutpurse" }),
    });
    return ((await r.json()) as { id: string }).id;
  });
  await page.goto(`/#campaign=${id}`);
  await page.reload();
  await expect(page.getByRole("region", { name: "Story" })).toBeVisible();
}

const box = (page: Page) => page.getByLabel("What do you do?", { exact: true });
async function act(page: Page, text: string) {
  await box(page).fill(text);
  await box(page).press("Enter");
  await expect(box(page)).toBeEnabled({ timeout: 15000 });
}
const clock = async (page: Page) => {
  const bar = (await page.locator(".location-bar").textContent()) ?? "";
  return /(\d{2}:\d{2})/.exec(bar)?.[1];
};

test("a named save can be loaded to move the campaign back", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") errors.push(e.text());
  });
  const phone = info.project.name === "phone";
  await openCampaign(page);
  await act(page, "wait 10 minutes");
  const saved = await clock(page);

  const openTimeline = async () => {
    if (phone) await page.getByRole("button", { name: "Timeline", exact: true }).click();
    else await page.getByRole("tab", { name: "Timeline" }).click();
    return page.getByRole("region", { name: "Timeline" });
  };
  const closePanel = async () => {
    if (phone) await page.getByRole("button", { name: "Close panel" }).click();
  };

  let timeline = await openTimeline();
  await timeline.getByLabel("Save name").fill("Before the wait");
  await timeline.getByRole("button", { name: "Save here" }).click();
  await expect(timeline.getByText("Before the wait")).toBeVisible();

  await closePanel();
  await act(page, "wait 60 minutes");
  expect(await clock(page)).not.toBe(saved);

  timeline = await openTimeline();
  await expect(timeline).toContainText("2 turns");
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Before the wait");
    await dialog.accept();
  });
  await timeline.getByRole("button", { name: "Load save Before the wait" }).click();
  await expect(timeline).toContainText("1 turn");
  await expect(timeline).not.toContainText("wait 60 minutes");

  // The campaign itself moved back: the second turn is gone and the clock is where it was.
  await closePanel();
  await expect(page.locator(".player-input")).toHaveText([/wait 10 minutes/]);
  expect(await clock(page)).toBe(saved);
  expect(errors).toEqual([]);
});
