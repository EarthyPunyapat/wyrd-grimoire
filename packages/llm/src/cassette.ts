import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stableStringify } from "@wyrd/core";
import type { ChatProvider, GenerateEvent, GenerateRequest, ModelInfo } from "./types.ts";

export type CassetteMode = "record" | "replay" | "auto";

type Cassette = { key: string; request: unknown; events: GenerateEvent[] };

/**
 * Record/replay (spec 15): run a real provider once with recording on; responses are stored keyed
 * by a hash of the normalised request, and replayed offline afterwards. `secrets` are scrubbed
 * from what is written (requests never carry API keys, but prompts could quote one by accident).
 */
export class CassetteProvider implements ChatProvider {
  readonly kind;
  readonly id;

  constructor(
    private readonly inner: ChatProvider | null,
    private readonly opts: { dir: string; mode: CassetteMode; secrets?: string[]; id?: string },
  ) {
    this.id = opts.id ?? inner?.id ?? "cassette";
    this.kind = inner?.kind ?? "fake";
  }

  static normalise(req: GenerateRequest): unknown {
    const { signal: _signal, ...rest } = req;
    return rest;
  }

  static keyOf(req: GenerateRequest): string {
    return createHash("sha256")
      .update(stableStringify(CassetteProvider.normalise(req)))
      .digest("hex");
  }

  private path(req: GenerateRequest, key: string): string {
    return join(this.opts.dir, `${req.role}-${key.slice(0, 20)}.json`);
  }

  private scrub(value: string): string {
    let out = value;
    for (const s of this.opts.secrets ?? []) if (s) out = out.split(s).join("[REDACTED]");
    return out;
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.inner ? this.inner.listModels() : [];
  }

  async *generate(req: GenerateRequest): AsyncIterable<GenerateEvent> {
    const key = CassetteProvider.keyOf(req);
    const file = this.path(req, key);
    const replay = this.opts.mode === "replay" || (this.opts.mode === "auto" && existsSync(file));
    if (replay) {
      if (!existsSync(file)) {
        yield {
          type: "error",
          code: "bad_request",
          retryable: false,
          message: `No cassette for ${req.role} request ${key.slice(0, 12)}`,
        };
        return;
      }
      const cassette = JSON.parse(readFileSync(file, "utf8")) as Cassette;
      yield* cassette.events;
      return;
    }
    if (!this.inner) {
      yield {
        type: "error",
        code: "bad_request",
        retryable: false,
        message: "Recording needs a real provider",
      };
      return;
    }
    const events: GenerateEvent[] = [];
    for await (const e of this.inner.generate(req)) {
      events.push(e);
      yield e;
    }
    // Errors aren't recorded: a replay should reproduce a working session.
    if (events.some((e) => e.type === "error")) return;
    mkdirSync(this.opts.dir, { recursive: true });
    const body = this.scrub(
      JSON.stringify({ key, request: CassetteProvider.normalise(req), events }, null, 2),
    );
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, body);
    renameSync(tmp, file);
  }
}
