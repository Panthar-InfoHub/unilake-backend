export const MAX_VARIANTS_BEFORE_PAYMENT = 3;
export const MAX_VARIANTS_AFTER_PAYMENT = 8;

// Per-page generation tunables. Bounds are safe ranges for the Lightning LoRA
// (which is trained for CFG=1 and 2–6 steps). Going outside these can produce
// degraded output — enforced in Zod, not in the worker.
export const DEFAULT_STEPS = 3;
export const MIN_STEPS = 1;
export const MAX_STEPS = 8;

export const DEFAULT_CFG = 1.0;
export const MIN_CFG = 1.0;
export const MAX_CFG = 3.0;

// Bubble geometry is stored as normalized 0–1 fractions of the artwork, never
// pixels. Frontend derives them by division, so a rectangle dragged flush to an
// edge can land on 1.0000000000000002 — this tolerance keeps that valid.
export const BUBBLE_BOUND_EPSILON = 0.0001;

// Bubble.fontSize is likewise a fraction — of the artwork's HEIGHT.
// Rendered size = fontSize * artworkHeight. Default 0.02 ≈ 31px on a
// 1536px-tall page. MAX_FONT_SIZE of 0.25 is already absurdly large (~384px).
export const DEFAULT_FONT_SIZE = 0.02;
export const MIN_FONT_SIZE = 0.005;
export const MAX_FONT_SIZE = 0.25;