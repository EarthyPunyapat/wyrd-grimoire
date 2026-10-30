/** The image adapter from spec 10. `openai-images` is reserved: its API is unverified and it stays off (D168). */
export type ImageRequest = {
  mode: "t2i" | "edit";
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  seed?: number;
  referenceAssetIds?: string[];
};
export type ImageResult = { bytes: Uint8Array; mime: string; seed?: number; meta: object };
export interface ImageProvider {
  id: "comfyui" | "openai-images";
  generate(req: ImageRequest, signal: AbortSignal): Promise<ImageResult>;
}
export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
