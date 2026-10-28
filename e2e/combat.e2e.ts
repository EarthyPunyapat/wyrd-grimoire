import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const passcode = "a local browser test passcode";

async function brawl(page: Page) {
  await page.goto("/");
  await page.getByLabel("Passcode", { exact: true }).fill(passcode);
  await page.getByRole("button", { name: /Set passcode & enter|Unlock grimoire/ }).click();
  await expect(page.getByRole("heading", { name: "Your campaigns" })).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = await fetch("/api/campaigns/quick-start", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Wyrd": "1" },
      body: JSON.stringify({
        name: "Lantern Brawl",
        characterName: "Wren",
        archetype: "hunter",
        world: "tavern-brawl",
      }),
    });
    return ((await r.json()) as { id: string }).id;
  });
  await page.goto(`/#campaign=${id}`);
  await page.reload();
  await expect(page.getByRole("heading", { name: "The Crooked Lantern" })).toBeVisible();
}

const box = (page: Page) => page.getByLabel("What do you do?", { exact: true });
async function act(page: Page, text: string) {
  await box(page).fill(text);
  await box(page).press("Enter");
  await expect(box(page)).toBeEnabled({ timeout: 15000 });
}

test("a tavern brawl plays start to finish through the UI with free text", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") errors.push(e.text());
  });
  await brawl(page);
  await act(page, "I shoot Fen");
  await expect(page.locator(".mechanics").first()).toContainText("Initiative");
  const phone = info.project.name === "phone";
  const panel = () => (phone ? page.locator(".combat-strip") : page.getByRole("region", { name: "Combat" }));
  let usedCombo = false;
  for (let turn = 0; turn < 25; turn++) {
    if (!(await panel().isVisible())) break;
    if (!phone) {
      await expect(page.getByRole("img", { name: /of 3 AP/ })).toBeVisible();
      await expect(page.getByRole("list", { name: "Initiative order" })).toBeVisible();
    }
    const foes = await page.locator(".combatant.enemy:not(.out) .name").allTextContents();
    const foe = foes[0]?.replace(" · fleeing", "");
    if (!foe) {
      await act(page, "I defend");
      continue;
    }
    if (!usedCombo) {
      await act(page, `kick the table over, duck behind it, then shoot ${foe}`);
      await expect(page.locator(".prose").last()).toContainText(/table/i);
      usedCombo = true;
    } else await act(page, `I shoot ${foe}`);
  }
  expect(usedCombo).toBe(true);
  await expect(panel()).toBeHidden();
  await expect(page.locator(".prose").last()).toContainText(
    /fight is won|beaten|left for dead|overpowered|went down|robbed|got away|break off/i,
  );
  await expect(page.locator(".story")).not.toContainText(/tokens|\$\d|cost estimate/i);
  await page.screenshot({ path: info.outputPath("m4-brawl.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("the combat panel shows the battlefield, legal actions and a target card", async ({ page }, info) => {
  await brawl(page);
  await act(page, "I shoot Fen");
  if (info.project.name === "phone") {
    await expect(page.locator(".combat-strip")).toBeVisible();
    await page.getByRole("button", { name: "Combat ↗" }).click();
  }
  const panel = page.getByRole("region", { name: "Combat" }).first();
  await expect(panel.getByRole("group", { name: /Battlefield/ })).toBeVisible();
  await expect(panel.getByRole("group", { name: "Legal actions" })).toBeVisible();
  const strike = panel.getByRole("button", { name: /^Strike / }).first();
  if (await strike.isVisible()) {
    const label = (await strike.textContent()) ?? "";
    if ((await strike.getAttribute("aria-disabled")) === "false") {
      await strike.click();
      await expect(box(page)).toHaveValue(
        new RegExp(
          `I attack ${label
            .replace(/^Strike /, "")
            .replace(/\d AP$/, "")
            .trim()}`,
        ),
      );
    }
  }
  await page.screenshot({ path: info.outputPath("m4-combat-panel.png") });
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
});
