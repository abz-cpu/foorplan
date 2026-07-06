/**
 * L&D Energy design tokens, codified from the approved design drafts
 * (docs/floorplan-saas/design/*.dc.html).
 * The Tailwind theme in apps/web/tailwind.config.ts mirrors these values —
 * keep the two in sync when tokens change.
 */
import type { PropertyStatus } from '@floorplan/core';

export const colors = {
  brand: '#0E3E36',
  brandInk: '#8FD6C2',
  action: '#0B7A5E',
  actionHover: '#086349',
  actionSoft: '#E9F2EF',
  actionSoftHover: '#DBEBE4',
  actionSoftInk: '#0B6B52',
  surface: '#F4F7F6',
  surfaceCard: '#FFFFFF',
  surfaceCanvas: '#FBFDFC',
  border: '#E4EAE8',
  borderSoft: '#EEF2F1',
  borderInput: '#DCE4E1',
  ink: '#10201C',
  inkMid: '#33433E',
  inkSoft: '#5E6F6A',
  inkFaint: '#71827C',
  inkGhost: '#8A9A94',
  wall: '#1F312C',
  wallLight: '#4A5D57',
  dimension: '#7C9A90',
  danger: '#B3372F',
  ai: '#6B4FBB',
  aiSoft: '#F5F1FD',
  success: '#17A578',
} as const;

export interface StatusPillColors {
  bg: string;
  fg: string;
  dot: string;
  label: string;
}

export const statusPills: Record<PropertyStatus, StatusPillColors> = {
  draft: { bg: '#FFF3DE', fg: '#8A5A08', dot: '#E29A2B', label: 'Draft' },
  ready: { bg: '#E1F4EC', fg: '#0A6B4F', dot: '#17A578', label: 'Ready' },
  exported: { bg: '#E5ECFA', fg: '#2F55A4', dot: '#4C77D9', label: 'Exported' },
};

export const fonts = {
  sans: "'Instrument Sans', system-ui, sans-serif",
  mono: "'IBM Plex Mono', monospace",
} as const;
