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