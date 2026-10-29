/**
 * Parses a model's tool-call arguments. Some models (deepseek-flash, seen in a real world call) emit a
 * complete JSON object followed by stray characters such as an extra "}". The first complete value is
 * kept and the junk after it is ignored; text that never completes a value still throws.
 */
export function parseToolArgs(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    const end = endOfFirstValue(text);
    if (end === -1) throw error;
    return JSON.parse(text.slice(0, end));
  }
}

/** Index just past the first top-level object or array, or -1 if it never closes. */
function endOfFirstValue(text: string): number {
  const start = text.search(/[{[]/);
  if (start === -1) return -1;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}
