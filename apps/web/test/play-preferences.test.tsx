import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayPreferencesPanel } from "../src/PlayPreferences.tsx";
import { DEFAULT_PLAY_PREFERENCES } from "../src/presets.ts";

test("settings offer all three presets with the chosen one pressed", () => {
  const html = renderToStaticMarkup(
    <PlayPreferencesPanel value={DEFAULT_PLAY_PREFERENCES} onChange={() => {}} />,
  );
  expect(html).toContain("Play screen preset");
  for (const preset of ["Reader", "Cockpit", "Chat"]) expect(html).toContain(preset);
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain("Visual Novel");
  expect(html).toContain("disabled");
});

test("settings expose the four dials and a chosen Cockpit setup", () => {
  const html = renderToStaticMarkup(
    <PlayPreferencesPanel
      value={{
        preset: "cockpit",
        textSize: "large",
        column: "wide",
        density: "compact",
        motion: "reduced",
      }}
      onChange={() => {}}
    />,
  );
  for (const label of ["Text size", "Column width", "Density", "Motion"]) expect(html).toContain(label);
  expect(html).toContain(">Cockpit</button>");
  expect(html).toContain(">Large</option>");
  expect(html).toContain(">Compact</option>");
  expect(html).toContain(">Reduced</option>");
  expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
});

test("the layout hints describe what each preset does", () => {
  const html = renderToStaticMarkup(
    <PlayPreferencesPanel value={{ ...DEFAULT_PLAY_PREFERENCES, preset: "chat" }} onChange={() => {}} />,
  );
  expect(html).toContain("true black");
  expect(html).toContain("chat bubble");
});
