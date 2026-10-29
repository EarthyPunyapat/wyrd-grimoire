import { expect, test } from "bun:test";
import { condenseChats, decodeSharePage, parseShareUrl } from "../src/import/chatgpt-share.ts";

/** Encodes a value the way ChatGPT share pages do: one flat array, objects keyed by "_<index of key>". */
function encode(root: unknown): unknown[] {
  const arr: unknown[] = [];
  const put = (v: unknown): number => {
    const at = arr.length;
    arr.push(null);
    if (Array.isArray(v)) arr[at] = v.map(put);
    else if (v && typeof v === "object") {
      const o: Record<string, number> = {};
      for (const [k, val] of Object.entries(v)) {
        const keyAt = arr.length;
        arr.push(k);
        o[`_${keyAt}`] = put(val);
      }
      arr[at] = o;
    } else arr[at] = v;
    return at;
  };
  put(root);
  return arr;
}
const message = (role: string, text: string, type = "text") => ({
  message: { author: { role }, content: { content_type: type, parts: [text] } },
});
const page = (root: unknown) =>
  `<html><script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify(JSON.stringify(encode(root)))});</script></html>`;

test("decodes a share page into its title and turns, skipping hidden reasoning", () => {
  const html = page({
    loaderData: {
      share: {
        title: "Green Lantern: First Light",
        linear_conversation: [
          message("user", "I pick up the ring."),
          message("assistant", "Thinking it over", "thoughts"),
          message("assistant", "The ring pulses green."),
          message("tool", "11", "execution_output"),
        ],
      },
    },
  });
  expect(decodeSharePage(html)).toEqual({
    title: "Green Lantern: First Light",
    turns: [
      { role: "user", text: "I pick up the ring." },
      { role: "assistant", text: "The ring pulses green." },
    ],
  });
});

test("only real chatgpt.com share links are accepted", () => {
  expect(parseShareUrl("https://chatgpt.com/share/6ae2f007-c2bc-83ec-a136-51fcc6381dce")).toBe(
    "https://chatgpt.com/share/6ae2f007-c2bc-83ec-a136-51fcc6381dce",
  );
  expect(parseShareUrl("https://evil.example/share/6ae2f007-c2bc-83ec-a136-51fcc6381dce")).toBeNull();
  expect(parseShareUrl("https://chatgpt.com/c/abc")).toBeNull();
});

test("condensing keeps the player's long recaps and the latest scenes, within the budget", () => {
  const recap = `Continue my campaign. ${"Ethan is the Absolute Sovereign. ".repeat(60)}`;
  const chats = [
    {
      title: "Old",
      turns: [
        { role: "user" as const, text: "short move" },
        { role: "user" as const, text: recap },
        { role: "assistant" as const, text: "old scene" },
      ],
    },
    { title: "New", turns: [{ role: "assistant" as const, text: "latest scene ".repeat(10) }] },
  ];
  const text = condenseChats(chats, 3000);
  expect(text).toContain("Absolute Sovereign");
  expect(text).toContain("latest scene");
  expect(text).not.toContain("short move");
  expect(text.length).toBeLessThanOrEqual(3000);
});
