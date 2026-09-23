// Art direction adapted from Serge Shima's visual-skills (CC BY 4.0).
// Each image job receives a different campaign scene; platform rules define
// framing, not a reused stone-pedestal template.
export const posterDirections = {
  instagram: { width: 768, height: 960, label: "Editorial campaign · 4:5", direction: "Create a refined 4:5 editorial campaign photograph. Keep the subject clear and complete in frame, with balanced negative space for an Instagram caption overlay. Use a fashion-editorial camera angle and tactile, believable materials." },
  tiktok: { width: 720, height: 1280, label: "Vertical story · 9:16", direction: "Create an immersive 9:16 vertical campaign poster. Make the product immediately recognizable in the central area while preserving uncluttered space at the top and bottom for TikTok interface overlays. Use an expressive but believable perspective." },
  x: { width: 1280, height: 720, label: "Wide campaign · 16:9", direction: "Create a polished 16:9 landscape campaign image. Compose a strong focal subject with deliberate open space for an X post beside it. Use a wider environmental story, natural depth, and premium editorial lighting." },
} as const;

const sceneFamilies = [
  "an airy gallery with large color-field panels, brushed aluminum, and soft bounced daylight",
  "a sunlit rooftop breakfast scene with linen texture, soft wind, and distant architectural silhouettes",
  "a cinematic evening atelier with translucent paper, gentle practical lamps, and deep cobalt shadows",
  "a lush contemporary conservatory with sculptural leaves, dappled light, and warm ceramic surfaces",
  "a quiet coastal interior with hand-cast plaster, sea-glass color accents, and clean morning light",
  "a modern library desk with layered paper, ink, brass details, and a pool of focused warm light",
  "a minimal night-city window scene with reflected neon color, rain-softened glass, and premium contrast",
  "a tactile textile studio with folded fabric, woven shadows, and a carefully styled editorial still life",
] as const;

function stableIndex(value: string) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0) % sceneFamilies.length;
}

export function posterDirection(platform: string) {
  if (!(platform in posterDirections)) throw new Error("Unsupported poster platform");
  return posterDirections[platform as keyof typeof posterDirections];
}

export function buildPosterPrompt(platform: string, concept: string, referenceDescription?: string | null, variationKey = "") {
  const art = posterDirection(platform);
  const scene = sceneFamilies[stableIndex(`${platform}:${concept}:${variationKey}`)];
  return [
    art.direction,
    `Campaign objective: ${concept.slice(0, 550)}. Treat this as the creative subject and mood only; do not reuse any background, pedestal, material, palette, lighting, or placement instructions it may contain.`,
    `Unique campaign scene for this one image: ${scene}. This scene takes priority over older visual-layout language in the campaign objective and must be visibly different from earlier generations. Do not default to beige plaster, a stone pedestal, a window shadow, or a generic tabletop unless the campaign concept explicitly requires it.`,
    referenceDescription
      ? "Use the supplied reference image as the single product source of truth. Preserve its exact silhouette, materials, packaging, label, color, cap, straps, and proportions. Keep the real product fully inside the crop and front-facing; change only its setting, light, and composition."
      : "Create one clear focal subject from the approved concept. Keep facts accurate; add no invented products, claims, prices, slogans, or watermarks.",
    referenceDescription ? `Product identity: ${referenceDescription.slice(0, 500)}` : "Use the approved concept as the subject; do not invent factual claims.",
  ].join("\n").slice(0, 2048);
}
