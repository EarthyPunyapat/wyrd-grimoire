import { readdirSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { decodeSharePage, type SharedChat } from "../../packages/llm/src/import/chatgpt-share.ts";

export type ReplayInput = { input: string; reference: string };
const supported = (name: string) => [".html", ".htm", ".json"].includes(extname(name).toLowerCase());

/** Explicit names are relative to the private transcript directory; symlinks are never followed. */
export function listTranscripts(dir: string, selected?: string[]): string[] {
  let available: string[];
  try {
    available = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && supported(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    throw new Error("Transcript directory is unavailable. Set --input to the host's chatgpt-rpg directory.");
  }
  if (selected?.some((name) => basename(name) !== name || !available.includes(name)))
    throw new Error("Select existing regular .html, .htm or .json files inside the transcript directory.");
  const files = selected?.length ? available.filter((name) => selected.includes(name)) : available;
  if (!files.length) throw new Error("No supported transcripts found (.html, .htm or SharedChat .json).");
  return files;
}

export function readTranscript(path: string): SharedChat {
  try {
    const raw = readFileSync(path, "utf8");
    const chat = extname(path).toLowerCase() === ".json" ? JSON.parse(raw) : decodeSharePage(raw);
    if (
      !chat ||
      typeof chat.title !== "string" ||
      !Array.isArray(chat.turns) ||
      !chat.turns.every(
        (t: unknown) =>
          t &&
          typeof t === "object" &&
          "role" in t &&
          "text" in t &&
          (t.role === "user" || t.role === "assistant") &&
          typeof t.text === "string" &&
          t.text.trim(),
      ) ||
      !chat.turns.some((t: { role: string }) => t.role === "user")
    )
      throw new Error("Invalid SharedChat");
    return chat as SharedChat;
  } catch {
    // JSON errors and filesystem errors may contain private text or filenames.
    throw new Error("Could not read transcript; use a saved share HTML page or SharedChat JSON.");
  }
}

/** Opening assistant messages are reference context only, never injected into a Wyrd prompt. */
export function pairTurns(chat: SharedChat): ReplayInput[] {
  const pairs: ReplayInput[] = [];
  for (const turn of chat.turns) {
    if (turn.role === "user") pairs.push({ input: turn.text, reference: "" });
    else {
      const pair = pairs.at(-1);
      if (pair) pair.reference += `${pair.reference ? "\n\n" : ""}${turn.text}`;
    }
  }
  return pairs;
}
