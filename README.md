# L&D Energy — Floor Plan Studio

Cross-platform, offline-first 2D floor-plan drawing and property data tool for estate agents, EPC assessors, and interior designers.

**Architecture & roadmap:** see [`docs/floorplan-saas/PROJECT_PLAN.md`](docs/floorplan-saas/PROJECT_PLAN.md). The UI is built to the design drafts in [`docs/floorplan-saas/design/`](docs/floorplan-saas/design/).

## Workspace layout

| Path | Purpose |
|---|---|
| `apps/web` | Vite + React PWA (dashboard, editor) — later wrapped by Capacitor |
| `packages/core` | Pure-TS document model + geometry engine (no UI deps, unit-tested) |
| `packages/editor` | Konva canvas editor: renderer, tools, input layer |
| `packages/export` | Branded sheet builder + SVG / 300-DPI raster / vector-PDF backends |
| `packages/ui` | L&D Energy design tokens + shared components |
| `packages/data` | Repository layer: guest-mode IndexedDB now, PowerSync adapter later |
| `supabase/` | SQL migrations + RLS policies (not yet provisioned) |

## Development

```sh
pnpm install
pnpm dev        # web app on http://localhost:5173
pnpm test       # vitest (geometry core)
pnpm typecheck
pnpm build      # includes PWA service worker
```

## Current state

- ✅ Phase 0 — scaffold, design tokens, CI
- ✅ Phase 1 — properties dashboard, guest-mode local-first storage (IndexedDB)
- ✅ Phase 2 — canvas editor: walls, rooms, snapping, undo/redo, GIA
- ✅ Phase 3 — doors (swing arcs, slide-along-wall), windows, stairs, exact wall lengths, furniture symbol library, text labels, measure tool, photo-underlay tracing, room auto-detection from wall loops
- ✅ Phase 4 — heat-loss perimeter + footprint area (polygon union), floor summary, room-schedule CSV export
- ✅ Phase 5 — export modal: vector PDF, 300-DPI PNG/JPG, SVG · A4/A3 · scale bar + north arrow · RICS disclaimer · Draft→Ready→Exported workflow
- ✅ PWA — installable, offline-capable (service worker + manifest)
- ✅ Assistant — on-device room-naming and listing-description drafts (Claude API integration arrives with cloud sync)
- ⬜ Blocked on credentials/accounts: Supabase + PowerSync cloud sync & guest→account adoption, Stripe billing, Claude-powered assistant, Capacitor iOS/Android store builds

## History

Developed initially under `abz-cpu/x15-digital-craft-48` in a `studio/` directory; migrated here with full history via `git subtree split`.
