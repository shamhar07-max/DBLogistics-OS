export const MODES = ['ocean', 'air', 'road', 'warehouse', 'customs'] as const;
export type Mode = (typeof MODES)[number];
/** Sector environments — set as <html data-env="…">; tokens.css re-tints accent/primary. */
export const ENVIRONMENTS = ['owner', 'commercial', 'operations', 'ocean', 'air', 'transport', 'warehouse', 'customs', 'finance'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];
export const envAttr = (e: Environment) => (['ocean', 'air', 'transport', 'warehouse', 'customs'].includes(e) ? e : undefined);
export const MOTION = { fast: 160, base: 320, slow: 640, hero: 1200, ease: [0.22, 1, 0.36, 1] as const };
