# L&D Energy — Floor Plan Studio

Cross-platform, offline-first 2D floor-plan drawing and property data tool for estate agents, EPC assessors, and interior designers.

**Architecture & roadmap:** see [`../docs/floorplan-saas/PROJECT_PLAN.md`](../docs/floorplan-saas/PROJECT_PLAN.md). The UI is built to the design drafts in [`../docs/floorplan-saas/design/`](../docs/floorplan-saas/design/).

> This monorepo temporarily lives inside the agency-site repository under `studio/` (the GitHub integration could not create the planned dedicated repo). It is fully self-contained and can be extracted with history via `git filter-repo --path studio/` when the dedicated repo exists.

## Workspace layout

| Path | Purpose |
|---|---|
| `apps/web` | Vite + React PWA shell (dashboard, editor) — later wrapped by Capacitor |
| `packages/core` | Pure-TS document model + geometry engine (no UI deps, unit-tested) |
| `packages/editor` | Konva canvas editor: renderer, tools, input layer |
| `packages/ui` | L&D Energy design tokens + shared components |
| `packages/data` | Repository layer: guest-mode IndexedDB now, PowerSync adapter later |
| `supabase/` | SQL migrations + RLS policies (not yet provisioned) |

## Development

```sh
pnpm install
pnpm dev        # web app on http://localhost:5173
pnpm test       # vitest (geometry core)
pnpm typecheck
pnpm build
```

## Current state

- ✅ Phase 0 — scaffold, design tokens, CI
- ✅ Phase 1 — properties dashboard, guest-mode local-first storage (IndexedDB)
- ✅ Phase 2 (slice) — canvas editor: walls, rooms, snapping, undo/redo, GIA
- ✅ Phase 3 (slice) — doors (swing arcs, slide-along-wall), windows (double-line), stairs (treads), exact wall-length entry
- ✅ Phase 4 (slice) — heat-loss perimeter + footprint area (polygon union), floor summary, room-schedule CSV export
- ✅ Phase 5 — export modal: vector PDF, 300-DPI PNG/JPG, SVG · A4/A3 · portrait/landscape · measurements + RICS disclaimer toggles · Draft→Ready→Exported status workflow
- ⬜ Room auto-detection (JSTS), photo underlay, furniture symbols, measure/text tools, AI assistant, Supabase + PowerSync sync, Capacitor packaging — see the project plan
