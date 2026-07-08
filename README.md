# L&D Energy — Floor Plan Studio

Cross-platform, offline-first 2D floor-plan drawing and property data tool for estate agents, EPC assessors, and interior designers.

**Architecture & roadmap:** see [`docs/floorplan-saas/PROJECT_PLAN.md`](docs/floorplan-saas/PROJECT_PLAN.md). The UI is built to the design drafts in [`docs/floorplan-saas/design/`](docs/floorplan-saas/design/).

## Workspace layout

| Path | Purpose |
|---|---|
| `apps/web` | Vite + React PWA (dashboard, editor), wrapped natively by Capacitor in `apps/web/ios` and `apps/web/android` |
| `packages/core` | Pure-TS document model + geometry engine (no UI deps, unit-tested) |
| `packages/editor` | Konva canvas editor: renderer, tools, input layer |
| `packages/export` | Branded sheet builder + SVG / 300-DPI raster / vector-PDF backends |
| `packages/ui` | L&D Energy design tokens + shared components |
| `packages/data` | Repository layer: guest-mode IndexedDB + a direct-Supabase cloud adapter, same interface |
| `supabase/` | SQL migrations, RLS policies, and Edge Functions (assistant, Stripe) — not yet provisioned live |

## Development

```sh
pnpm install
pnpm dev        # web app on http://localhost:5173
pnpm test       # vitest (geometry core)
pnpm typecheck
pnpm build      # includes PWA service worker
```

## Enabling cloud features (optional)

The app runs fully offline with no setup — guest mode is the default and requires nothing below.

1. Create a Supabase project and apply `supabase/migrations/*.sql` in order (via the SQL editor or `supabase db push`).
2. Copy `apps/web/.env.example` to `apps/web/.env` and fill in `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
3. Deploy the edge functions in `supabase/functions/` (`supabase functions deploy assistant` etc.) and set their secrets: `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_MODEL`) for the assistant, `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID` / `STRIPE_WEBHOOK_SECRET` for billing.
4. Point a Stripe webhook endpoint at the deployed `stripe-webhook` function URL.

Any subset of these can be skipped — each feature (cloud sync, Claude-powered assistant, billing) degrades independently to its offline/on-device default when its own credentials aren't set.

## Current state

- ✅ Phase 0 — scaffold, design tokens, CI
- ✅ Phase 1 — properties dashboard, guest-mode local-first storage (IndexedDB)
- ✅ Phase 2 — canvas editor: walls, rooms, snapping, undo/redo, GIA
- ✅ Phase 3 — doors (swing arcs, slide-along-wall), windows, stairs, exact wall lengths, furniture symbol library, text labels, measure tool, photo-underlay tracing, room auto-detection from wall loops
- ✅ Phase 4 — heat-loss perimeter + footprint area (polygon union), floor summary, room-schedule CSV export
- ✅ Phase 5 — export modal: vector PDF, 300-DPI PNG/JPG, SVG · A4/A3 · scale bar + north arrow · RICS disclaimer · Draft→Ready→Exported workflow
- ✅ PWA — installable, offline-capable (service worker + manifest)
- ✅ Assistant — on-device room-naming and listing-description drafts, upgrading to Claude automatically once cloud is configured
- ✅ Cloud sync — direct-Supabase repository adapter, auth (email + Google + Apple), guest→account data import (`packages/data/src/supabase.ts`, `supabase/migrations/`)
- ✅ Claude-powered assistant — `supabase/functions/assistant` edge function, same shape as the on-device heuristic
- ✅ Stripe billing — Checkout, Billing Portal, and webhook sync scaffolded (`supabase/functions/stripe-*`)
- ✅ Capacitor packaging — iOS + Android projects generated, native gesture guards, brand icons/splash; Android debug build verified with `gradle assembleDebug` (iOS needs Xcode on macOS to build)
- ✅ Editor UX pass — multi-select/marquee/batch delete, right-click contextual action menu, fixed occluded-shape clicks (nested rooms/stairs) and the delete-property overlay bug, floor-tab delete, dashboard thumbnail toggle
- ✅ Display preferences — Tweaks panel (grid style: dots/lines/none, dimension labels, room-area labels, furniture layer) and a Technical/Presentation plan-mode toggle with zonal room shading by type
- ✅ Wall intelligence — auto-classified internal vs external wall thickness, rectilinear (L-shaped/staggered) room auto-detection, rotatable North compass reflected in the exported sheet, "Copy Perimeter to Next Floor" for matching storeys
- ✅ Faster drawing — live keyboard "laser measure" wall entry (arrow key + exact length + Enter) and a furniture wall-alignment anchor that snaps placed/dragged symbols flush against the nearest wall, rotated to face it
- ✅ Onboarding — a "Try a demo plan" starter flat on the empty dashboard and a first-visit welcome guide in the editor
- ⬜ Blocked on credentials/infra to actually run: a provisioned Supabase project (apply the migrations), `ANTHROPIC_API_KEY`, a Stripe test-mode account, and a macOS machine for the iOS build — see `docs/floorplan-saas/PROJECT_PLAN.md#next-steps`
- ⬜ True offline-first sync (PowerSync) remains a deliberate follow-up once the direct-Supabase adapter above is live — see the Status note in `docs/floorplan-saas/PROJECT_PLAN.md`

## History

Developed initially under `abz-cpu/x15-digital-craft-48` in a `studio/` directory; migrated here with full history via `git subtree split`.
