/**
 * Design manifest schema (docs/STORE_DIGITAL_TWIN.md §2). Every field is
 * optional so a partial manifest (freshly extracted, or hand-authored in
 * progress) still validates, callers merge/patch incrementally.
 */
import { z } from "zod";

const FreeForm = z.record(z.unknown());

export const DesignManifestBrandSchema = z.object({
  personality: z.array(z.string()).optional(),
  targetCustomer: z.string().optional(),
  marketPosition: z.string().optional(),
  tone: z.string().optional(),
});

export const DesignManifestColorSchema = z.object({
  primary: z.string().optional(),
  secondary: z.string().optional(),
  accent: z.string().optional(),
  surfaces: z.array(z.string()).optional(),
  text: z.array(z.string()).optional(),
  semantic: z
    .object({
      success: z.string().optional(),
      warning: z.string().optional(),
      error: z.string().optional(),
      info: z.string().optional(),
    })
    .optional(),
});

export const DesignManifestTypographySchema = z.object({
  families: z.array(z.string()).optional(),
  weights: z.array(z.number()).optional(),
  scale: z.array(z.number()).optional(),
  lineHeights: z.array(z.number()).optional(),
  letterSpacing: z.array(z.number()).optional(),
  headingStyle: z.string().optional(),
});

export const DesignManifestLayoutSchema = z.object({
  containerWidths: z.array(z.number()).optional(),
  grids: z.array(z.string()).optional(),
  gaps: z.array(z.number()).optional(),
  sectionSpacing: z.array(z.number()).optional(),
  density: z.string().optional(),
});

export const DesignManifestComponentsSchema = z.object({
  buttons: FreeForm.optional(),
  forms: FreeForm.optional(),
  cards: FreeForm.optional(),
  productCards: FreeForm.optional(),
  badges: FreeForm.optional(),
  accordions: FreeForm.optional(),
  drawers: FreeForm.optional(),
  navigation: FreeForm.optional(),
});

export const DesignManifestMediaSchema = z.object({
  aspectRatios: z.array(z.string()).optional(),
  cropBehavior: z.string().optional(),
  imageDirection: z.string().optional(),
  video: FreeForm.optional(),
});

export const DesignManifestMotionSchema = z.object({
  hover: z.string().optional(),
  transitions: z.string().optional(),
  reveals: z.string().optional(),
  reducedMotion: z.string().optional(),
});

export const DesignManifestCommerceSchema = z.object({
  pdpDirection: z.string().optional(),
  plpDirection: z.string().optional(),
  merchandising: z.string().optional(),
  ctaHierarchy: z.array(z.string()).optional(),
});

export const DesignManifestResponsiveSchema = z.object({
  mobile: FreeForm.optional(),
  tablet: FreeForm.optional(),
  desktop: FreeForm.optional(),
});

export const DesignManifestSchema = z.object({
  brand: DesignManifestBrandSchema.optional(),
  color: DesignManifestColorSchema.optional(),
  typography: DesignManifestTypographySchema.optional(),
  layout: DesignManifestLayoutSchema.optional(),
  components: DesignManifestComponentsSchema.optional(),
  media: DesignManifestMediaSchema.optional(),
  motion: DesignManifestMotionSchema.optional(),
  commerce: DesignManifestCommerceSchema.optional(),
  responsive: DesignManifestResponsiveSchema.optional(),
});

export type DesignManifest = z.infer<typeof DesignManifestSchema>;

/** Returns a fully-empty (but valid) manifest, useful as a merge base. */
export function emptyManifest(): DesignManifest {
  return {};
}
