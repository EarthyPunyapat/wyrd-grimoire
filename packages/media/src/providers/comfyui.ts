import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultTuning } from "@wyrd/core";
import type { Fetch, ImageProvider, ImageRequest, ImageResult } from "./types.ts";

type Workflow = Record<string, { inputs: Record<string, unknown> }>;
/** Which workflow node field receives each value: "<node id>.<input name>". */
type FieldMap = Partial<Record<"prompt" | "negative" | "seed" | "width" | "height", string>>;

/**
 * ComfyUI on the owner's main PC (spec 10). The owner exports their working workflow in API format as
 * `portrait.json` with a `portrait.map.json` naming the fields to fill; the routes follow ComfyUI's own
 * API example: POST /prompt, GET /history/{id}, GET /view.
 */
export class ComfyUIProvider implements ImageProvider {
  readonly id = "comfyui" as const;
  constructor(
    private readonly o: {
      url: string;
      workflowsDir: string;
      fetch?: Fetch;
      pollMs?: number;
      timeoutMs?: number;
    },
  ) {}

  async generate(req: ImageRequest, signal: AbortSignal): Promise<ImageResult> {
    const fetch = this.o.fetch ?? globalThis.fetch;
    const { workflow, map } = this.load();
    const seed = req.seed ?? Math.floor(Math.random() * 2 ** 31);
    const values: Record<keyof FieldMap, unknown> = {
      prompt: req.prompt,
      negative: req.negativePrompt ?? "",
      seed,
      width: req.width,
      height: req.height,
    };
    for (const [key, target] of Object.entries(map) as [keyof FieldMap, string][]) {
      const [node, field] = target.split(".");
      const inputs = node && field ? workflow[node]?.inputs : undefined;
      if (!inputs) throw new Error(`portrait.map.json points ${key} at a missing node field ${target}`);
      inputs[field!] = values[key];
    }
    const base = this.o.url.replace(/\/$/, "");
    const queued = await fetch(`${base}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: "wyrd-grimoire" }),
      signal,
    });
    const { prompt_id: id } = (await queued.json()) as { prompt_id?: string };
    if (!queued.ok || !id) throw new Error("ComfyUI refused the workflow");
    const deadline = Date.now() + (this.o.timeoutMs ?? defaultTuning.media.generateTimeoutMs);
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      const history = (await (await fetch(`${base}/history/${id}`, { signal })).json()) as Record<
        string,
        { outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }> }
      >;
      const image = Object.values(history[id]?.outputs ?? {}).flatMap((o) => o.images ?? [])[0];
      if (image) {
        const view = new URLSearchParams({
          filename: image.filename,
          subfolder: image.subfolder,
          type: image.type,
        });
        const res = await fetch(`${base}/view?${view}`, { signal });
        if (!res.ok) throw new Error("ComfyUI could not return the image");
        return {
          bytes: new Uint8Array(await res.arrayBuffer()),
          mime: res.headers.get("content-type") ?? "image/png",
          seed,
          meta: { promptId: id, filename: image.filename },
        };
      }
      await Bun.sleep(this.o.pollMs ?? defaultTuning.media.pollMs);
    }
    throw new Error("ComfyUI took too long to generate the image");
  }

  private load(): { workflow: Workflow; map: FieldMap } {
    const wf = join(this.o.workflowsDir, "portrait.json");
    const mapFile = join(this.o.workflowsDir, "portrait.map.json");
    if (!existsSync(wf) || !existsSync(mapFile))
      throw new Error(`Export your ComfyUI portrait workflow to ${this.o.workflowsDir}`);
    return {
      workflow: JSON.parse(readFileSync(wf, "utf8")) as Workflow,
      map: JSON.parse(readFileSync(mapFile, "utf8")) as FieldMap,
    };
  }
}
