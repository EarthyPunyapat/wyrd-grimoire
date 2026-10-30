/**
 * A portrait prompt from canon (spec 10 Prompts): appearance facts first, then a portrait composition,
 * then the world's tone as the style. Names stay out so a source character isn't drawn as a copy of
 * someone's art, and only the public facts the caller passes are used.
 */
export function portraitPrompt(
  entity: { name: string; kind: string; summary: string },
  facts: { predicate: string; value: string }[],
  world: { name: string; tone: string; theme?: string },
): { prompt: string; negativePrompt: string } {
  const looks = facts.filter((f) => f.predicate.startsWith("appearance")).map((f) => f.value);
  const role = facts.find((f) => f.predicate === "occupation")?.value;
  const subject =
    entity.kind === "location" || entity.kind === "site"
      ? "establishing view of a place"
      : "head and shoulders portrait";
  const prompt = [
    looks.join(", "),
    role,
    subject,
    entity.summary.replaceAll(entity.name, "").trim(),
    `${world.tone} style`,
    world.theme,
    "painterly, dramatic lighting, detailed",
  ]
    .filter((part): part is string => Boolean(part && part.length))
    .join(". ");
  return { prompt, negativePrompt: "text, letters, watermark, logo, signature, frame, blurry, extra limbs" };
}
