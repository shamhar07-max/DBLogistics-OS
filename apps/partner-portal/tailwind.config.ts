import type { Config } from 'tailwindcss';
import preset from '@dbl/design-tokens/tailwind-preset';
export default { presets: [preset as Config], content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'] } satisfies Config;
