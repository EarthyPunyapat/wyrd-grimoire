import { createHash } from "node:crypto";
import { type CompiledPack, stableStringify } from "@wyrd/core";

/** The content hash of a compiled pack: every field except the hash itself. */
export function packHash(pack: CompiledPack): string {
  return createHash("sha256")
    .update(stableStringify({ ...pack, hash: undefined }))
    .digest("hex");
}
