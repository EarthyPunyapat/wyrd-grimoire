import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function unlock(page: Page) {
  await page.goto("/");
  await page.getByLabel("Passcode", { exact: true }).fill("a local browser test passcode");
  await page.getByRole("button", { name: /Set passcode & enter|Unlock grimoire/ }).click();
  await expect(page.getByRole("heading", { name: "Your next chapter" })).toBeVisible();
}
test("save Ari's campaign as a card, choose a world, and begin with the same character", async ({
  page,
}, info) => {
  await unlock(page);
  const id = await page.evaluate(async () => {
    const post = async (path: string, body: unknown) => {
      const r = await fetch(`/api${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Wyrd": "1" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    };
    const p = await post("/world-drafts", {
      name: "Card origin",
      pitch: "You wander between distant stars.",
    });
    return (
      await post("/campaigns", {
        draftId: p.id,
        ancestry: p.origins[0].id,
        archetype: p.backgrounds[0].id,
        import: {
          pc: {
            name: "Ethan",
            level: "infinite",
            backstory: "A wandering sovereign",
            abilities: [{ name: "Light", description: "Shapes light", rank: 10 }],
          },
          companions: [{ name: "Ari", summary: "A loyal friend", voice: "Warm and precise", level: 20 }],
        },
      })
    ).id;
  });
  await page.goto(`/#campaign=${id}`);
  await page.reload();
  await page.locator(".status-strip").getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Save character as card", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Character card saved" })).toBeVisible();
  await page.getByRole("button", { name: "Close status screen" }).click();
  await page.getByRole("button", { name: "Wyrd Grimoire home" }).click();
  await page.getByRole("button", { name: "+ New campaign", exact: true }).click();
  await page
    .getByRole("button", { name: /Play Ethan/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Choose Space opera", exact: true }).click();
  await page.screenshot({ path: info.outputPath("chooser.png"), fullPage: true });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations).toEqual([]);
  await page.getByRole("button", { name: "Begin with these", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Relay Nine", exact: true })).toBeVisible();
  await expect(page.locator(".play-layout")).toContainText("Ethan");
  await expect(page.locator(".play-layout")).toContainText("∞");
  await page.getByRole("button", { name: "Character", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Ari");
});
test("vary a pitch and delete a duplicated setup", async ({ page }, info) => {
  await unlock(page);
  await page.getByRole("button", { name: "+ New campaign", exact: true }).click();
  const starter = page.getByRole("article", { name: "Space opera", exact: true });
  await starter.getByRole("button", { name: "Duplicate", exact: true }).click();
  const copy = page.getByRole("article", { name: "Space opera copy", exact: true });
  await expect(copy).toBeVisible();
  await copy.getByRole("button", { name: "Choose Space opera copy", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const pitch = page.getByLabel("What kind of adventure or world do you want?");
  const before = await pitch.inputValue();
  await page.getByRole("button", { name: "Vary it", exact: true }).click();
  await expect(pitch).not.toHaveValue(before);
  await page.getByRole("button", { name: "Choose character and world", exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await copy.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(copy).toBeHidden();
  await page.screenshot({ path: info.outputPath("chooser-managed.png"), fullPage: true });
});
test("Begin with these without a card uses the world's suggested character", async ({ page }) => {
  await unlock(page);
  await page.getByRole("button", { name: "+ New campaign", exact: true }).click();
  await page.getByRole("button", { name: "Choose Cosmic god-game", exact: true }).click();
  await page.getByRole("button", { name: "Begin with these", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Relay Nine", exact: true })).toBeVisible();
  await expect(page.locator(".play-layout")).toContainText("Alex Chen");
  await expect(page.locator(".play-layout")).toContainText("∞");
});

test("review an editable adaptation without changing the saved card", async ({ page }, info) => {
  await unlock(page);
  const title = `Adapted sovereign ${info.project.name}`;
  const card = await page.evaluate(async (title) => {
    const r = await fetch("/api/character-cards", {
      method: "POST",
      headers: { "X-Wyrd": "1", "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        origin: "created",
        pc: {
          name: "Ethan",
          level: "infinite",
          backstory: "A wandering sovereign",
          abilities: [{ name: "Light", description: "Shapes light", rank: 10 }],
        },
        companions: [{ name: "Ari", summary: "Right hand", voice: "Warm and precise", level: 20 }],
      }),
    });
    return r.json();
  }, title);
  await page.getByRole("button", { name: "+ New campaign", exact: true }).click();
  await page.getByRole("button", { name: `Play ${title}`, exact: true }).click();
  await page.getByRole("button", { name: "Choose Space opera", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Preview example world →" }).click();
  await page.getByRole("radio", { name: "Let the GM adapt", exact: true }).check();
  await expect(page.getByLabel("Arrival Level", { exact: true })).toHaveValue("5");
  await page.getByLabel("Arrival Level", { exact: true }).fill("7");
  await page.getByLabel("Ability 1 name", { exact: true }).fill("Edited starlight");
  await page.getByRole("button", { name: "Close new campaign", exact: true }).click();
  await page.getByRole("button", { name: "Continue Space opera", exact: true }).click();
  await expect(page.getByLabel("Arrival Level", { exact: true })).toHaveValue("7");
  await expect(page.getByLabel("Ability 1 name", { exact: true })).toHaveValue("Edited starlight");
  await page.screenshot({ path: info.outputPath("card-adaptation.png"), fullPage: true });
  await page.getByRole("button", { name: "Begin adventure →" }).click();
  await expect(page.getByRole("heading", { name: "Relay Nine", exact: true })).toBeVisible();
  const data = await page.evaluate(async (id) => {
    const original = await (await fetch(`/api/character-cards/${id}`)).json();
    const campaigns = await (await fetch("/api/campaigns")).json();
    const currentId = location.hash.split("=")[1];
    const view = await (await fetch(`/api/campaigns/${currentId}/view`)).json();
    return { original, view, campaigns };
  }, card.id);
  expect(data.original.pc.level).toBe("infinite");
  expect(data.original.pc.abilities[0].name).toBe("Light");
  expect(data.view.pc.level).toBe(7);
  expect(data.view.pc.abilities[0].name).toBe("Edited starlight");
  expect(data.view.companions[0]).toMatchObject({ name: "Ari", loyal: true });
});

test("save creation snapshots and reuse a saved generated world", async ({ page }, info) => {
  await unlock(page);
  const name = `Library world ${info.project.name}`;
  const pc = `Library hero ${info.project.name}`;
  await page.getByRole("button", { name: "+ New campaign", exact: true }).click();
  await page.getByRole("button", { name: "Create new world", exact: true }).click();
  await page.getByLabel("Campaign name", { exact: true }).fill(name);
  await page.getByLabel("Character name", { exact: false }).fill(pc);
  await page
    .getByLabel("What kind of adventure or world do you want?")
    .fill("You explore a city built inside a broken star.");
  await page.getByRole("button", { name: "Preview example world →" }).click();
  await page.getByRole("button", { name: "Save as world setup", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "World setup saved" })).toBeVisible();
  await page.getByRole("button", { name: "Save character as card", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Character card saved" })).toBeVisible();
  await page.getByRole("button", { name: "Begin adventure →" }).click();
  await expect(page.getByRole("heading", { name: "Relay Nine", exact: true })).toBeVisible();
  const originalId = await page.evaluate(() => location.hash.split("=")[1]);
  await page.locator(".status-strip").getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Save this world", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "World saved" })).toBeVisible();
  await page.getByLabel("Card to update", { exact: true }).selectOption({ label: pc });
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Update card from this campaign", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Character card updated" })).toBeVisible();
  await page.getByRole("button", { name: "Close status screen" }).click();
  await page.getByRole("button", { name: "Wyrd Grimoire home" }).click();
  await page.getByRole("button", { name: "+ New campaign", exact: true }).click();
  await expect(page.getByRole("button", { name: `Play ${pc}`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Choose ${name}`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Choose saved world ${name}`, exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("region", { name: "Review your world", exact: true })).toContainText(
    "The Silent Relay",
  );
  await page.getByLabel("Character name", { exact: false }).fill("New explorer");
  await page.getByRole("button", { name: "Begin adventure →" }).click();
  await expect(page.getByRole("heading", { name: "Relay Nine", exact: true })).toBeVisible();
  const newId = await page.evaluate(() => location.hash.split("=")[1]);
  expect(newId).not.toBe(originalId);
  await expect(page.locator(".play-layout")).toContainText("New explorer");
});
