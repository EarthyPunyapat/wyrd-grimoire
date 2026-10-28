/**
 * Local, deterministic text embeddings (spec 07 "Embeddings come from the embeddings role"): a
 * hashed bag of word unigrams and bigrams, signed, L2-normalised. It needs no model, so retrieval
 * works offline and in tests; a configured embeddings model can replace it (vectors are a cache).
 */
export const EMBEDDING_MODEL = "hash-512@1";
const DIMS = 512;

const STOP = new Set(
  "a an and are as at be but by for from had has have he her his i in is it its me my not of on or our she so that the their them they this to was we were what when who will with you your".split(
    " ",
  ),
);

function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter((w) => !STOP.has(w)).map(stem);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function embed(text: string): Float32Array {
  const v = new Float32Array(DIMS);
  const t = tokens(text);
  const features = [...t, ...t.slice(1).map((w, i) => `${t[i]}_${w}`)];
  for (const f of features) {
    const h = hash(f);
    v[h % DIMS]! += h & 0x80000000 ? -1 : 1;
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIMS; i++) v[i]! /= norm;
  return v;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}
