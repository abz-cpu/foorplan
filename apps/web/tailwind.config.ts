import type { Config } from 'tailwindcss';

/**
 * L&D Energy design tokens (mirrors packages/ui/src/tokens.ts — keep in sync).
 * Palette codified from docs/floorplan-saas/design/*.dc.html.
 */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
    '../../packages/editor/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: '#0E3E36',
        'brand-ink': '#8FD6C2',
        action: '#0B7A5E',
        'action-hover': '#086349',
        'action-soft': '#E9F2EF',
        'action-soft-hover': '#DBEBE4',
        'action-soft-ink': '#0B6B52',
        surface: '#F4F7F6',
        canvas: '#FBFDFC',
        shell: '#F0F4F3',
        segment: '#E8EEEC',
        line: '#E4EAE8',
        'line-soft': '#EEF2F1',
        input: '#DCE4E1',
        ink: '#10201C',
        'ink-mid': '#33433E',
        'ink-soft': '#5E6F6A',
        'ink-faint': '#71827C',
        'ink-ghost': '#8A9A94',
        danger: '#B3372F',
        ai: '#6B4FBB',
        'ai-soft': '#F5F1FD',
        success: '#17A578',
      },
      fontFamily: {
        sans: ["'Instrument Sans'", 'system-ui', 'sans-serif'],
        mono: ["'IBM Plex Mono'", 'monospace'],
      },
      boxShadow: {
        segment: '0 1px 3px rgba(16,32,28,0.12)',
        card: '0 10px 28px rgba(16,32,28,0.10)',
        float: '0 8px 24px rgba(16,32,28,0.10)',
        toast: '0 10px 30px rgba(16,32,28,0.3)',
        cta: '0 1px 2px rgba(11,58,46,0.25), 0 4px 12px rgba(11,122,94,0.22)',
      },
    },
  },
  plugins: [],
} satisfies Config;
