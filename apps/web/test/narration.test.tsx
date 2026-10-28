import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Narration } from "../src/Narration.tsx";

const render = (text: string) =>
  renderToStaticMarkup(
    <Narration
      text={text}
      speakers={{ pc: "Wren", "npc:mina": "Mina Vale", "npc:jules": "Jules Park" }}
      names={["Mina Vale", "Jules Park", "Relay Nine", "Mina", "Wren"]}
    />,
  );

test("dialogue resolves IDs and supplied names, including speakers absent from the current room", () => {
  expect(render('<say who="npc:jules">Stay here.</say>')).toContain('class="speaker">Jules Park</strong>');
  expect(render('<say who="Mina Vale">Follow me.</say>')).toContain('class="speaker">Mina Vale</strong>');
  expect(render("<say who='mina vale'>Follow me.</say>")).toContain('class="speaker">Mina Vale</strong>');
  expect(render('<say who="Captain Imani">Welcome.</say>')).toContain(
    'class="speaker">Captain Imani</strong>',
  );
  expect(render('<say who="pc">Hello.</say>')).toContain('class="speaker">Wren</strong>');
});
test("known names and locations plus explicit important phrases use emphasis without duplicate nesting", () => {
  const html = render(
    "Mina Vale waits at Relay Nine. **The sealed hatch** matters. **Mina Vale** replies. Mina does not mean minaret.",
  );
  expect(html).toContain("<strong>Mina Vale</strong> waits at <strong>Relay Nine</strong>");
  expect(html).toContain("<strong>The sealed hatch</strong>");
  expect(html).not.toContain("**");
  expect(html).not.toContain("<strong><strong>");
  expect(html).toContain("<strong>Mina</strong> does not mean minaret.");
});
test("HTML stays inert, emphasis works within dialogue, and unmatched formatting stays readable", () => {
  const html = render(
    '<say who="Mina Vale">Check **the hatch**.</say>\n\n<img src=x onerror=alert(1)> **unfinished',
  );
  expect(html).toContain("“Check <strong>the hatch</strong>.”");
  expect(html).toContain("&lt;img");
  expect(html).not.toContain("<img");
  expect(html).toContain("**unfinished");
});
