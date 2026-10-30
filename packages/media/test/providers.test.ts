import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { portraitPrompt } from "../src/prompt.ts";
import { ComfyUIProvider } from "../src/providers/comfyui.ts";
import { PNG } from "./fixtures.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function workflows(withMap = true) {
  const dir = mkdtempSync(join(tmpdir(), "wyrd-comfy-"));
  dirs.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "portrait.json"),
    JSON.stringify({
      "3": { class_type: "KSampler", inputs: { seed: 1, steps: 20 } },
      "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512 } },
      "6": { class_type: "CLIPTextEncode", inputs: { text: "PROMPT" } },
      "7": { class_type: "CLIPTextEncode", inputs: { text: "NEGATIVE" } },
      "9": { class_type: "SaveImage", inputs: { filename_prefix: "wyrd" } },
    }),
  );
  if (withMap)
    writeFileSync(
      join(dir, "portrait.map.json"),
      JSON.stringify({
        prompt: "6.text",
        negative: "7.text",
        seed: "3.seed",
        width: "5.width",
        height: "5.height",
      }),
    );
  return dir;
}

/** A fake ComfyUI: queues the prompt, reports history on the second poll, serves the output image. */
function fakeComfy() {
  const calls: { method: string; url: URL; body?: unknown }[] = [];
  let polls = 0;
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", url, body });
    if (url.pathname === "/prompt") return Response.json({ prompt_id: "p1", number: 0 });
    if (url.pathname === "/history/p1") {
      polls++;
      return Response.json(
        polls < 2
          ? {}
          : {
              p1: {
                outputs: { "9": { images: [{ filename: "wyrd_0001.png", subfolder: "", type: "output" }] } },
              },
            },
      );
    }
    if (url.pathname === "/view") return new Response(PNG, { headers: { "content-type": "image/png" } });
    return new Response("not found", { status: 404 });
  };
  return { fetch, calls };
}

describe("the ComfyUI provider", () => {
  test("fills the mapped workflow fields, polls history and returns the output image", async () => {
    const comfy = fakeComfy();
    const provider = new ComfyUIProvider({
      url: "http://192.168.1.20:8188",
      workflowsDir: workflows(),
      fetch: comfy.fetch,
      pollMs: 0,
    });
    const out = await provider.generate(
      { mode: "t2i", prompt: "a caped figure", negativePrompt: "text", width: 640, height: 832, seed: 42 },
      new AbortController().signal,
    );
    expect(out.bytes).toEqual(PNG);
    expect(out.mime).toBe("image/png");
    expect(out.seed).toBe(42);
    const queued = comfy.calls.find((c) => c.url.pathname === "/prompt")!;
    expect(queued.method).toBe("POST");
    const wf = (queued.body as { prompt: Record<string, { inputs: Record<string, unknown> }> }).prompt;
    expect(wf["6"]!.inputs.text).toBe("a caped figure");
    expect(wf["7"]!.inputs.text).toBe("text");
    expect(wf["3"]!.inputs.seed).toBe(42);
    expect(wf["5"]!.inputs).toEqual({ width: 640, height: 832 });
    const view = comfy.calls.find((c) => c.url.pathname === "/view")!;
    expect(view.url.searchParams.get("filename")).toBe("wyrd_0001.png");
    expect(view.url.searchParams.get("type")).toBe("output");
  });

  test("a missing workflow says where to export it", async () => {
    const dir = workflows(false);
    const provider = new ComfyUIProvider({
      url: "http://pc:8188",
      workflowsDir: dir,
      fetch: fakeComfy().fetch,
    });
    await expect(
      provider.generate({ mode: "t2i", prompt: "x", width: 512, height: 512 }, new AbortController().signal),
    ).rejects.toThrow(`Export your ComfyUI portrait workflow to ${dir}`);
  });
});

describe("portrait prompts", () => {
  test("appearance facts lead, the world sets the style, and the negative prompt bans text", () => {
    const { prompt, negativePrompt } = portraitPrompt(
      { name: "Old Magda", kind: "npc", summary: "A fortune teller in the Bowery." },
      [
        { predicate: "appearance.hair", value: "white braids" },
        { predicate: "appearance.eyes", value: "one clouded eye" },
        { predicate: "occupation", value: "fortune teller" },
      ],
      { name: "Gotham", tone: "rain-soaked noir" },
    );
    expect(prompt.indexOf("white braids")).toBeLessThan(prompt.indexOf("rain-soaked noir"));
    expect(prompt).toContain("one clouded eye");
    expect(prompt).toContain("portrait");
    expect(prompt).not.toContain("Old Magda");
    expect(negativePrompt).toContain("text");
    expect(negativePrompt).toContain("watermark");
  });
});
