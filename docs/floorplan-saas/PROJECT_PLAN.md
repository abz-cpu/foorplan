# L&D Energy — Floor Plan Studio · Project Plan

A cross-platform (web + iOS + Android), offline-first 2D/3D floor-plan drawing and property-data SaaS for UK estate agents, EPC (RdSAP) assessors, and interior designers — a modern, touch-first competitor to PlanUp and zPlan.

**Status:** Approved architecture & roadmap — MVP built and audited in this dedicated repository. Phases 0–5 (scaffold, guest-mode dashboard, canvas editor, architectural elements incl. doors/windows/stairs/furniture/photo-underlay/room auto-detection, EPC measurements, and multi-format exports) are complete, plus PWA offline support and an on-device Assistant (room naming + description drafts). Phases 6–7 are now **code-complete but credential-blocked** — see `README.md` for the up-to-date checklist and exactly what each one still needs to go live:

- **Cloud sync (Phase 1/7)**: built as a **direct Supabase-client repository adapter** (`packages/data/src/supabase.ts` + `supabase/migrations/0002_app_functions.sql`), not the PowerSync offline-first engine described in §1 below — PowerSync needs a live project (schema, sync rules, connector auth) to build and verify against, which doesn't exist yet, so building it blind would have been unverifiable. What's shipped is real cloud sync when online, auth (email + Google + Apple), and guest→account data import; true offline-first background sync via PowerSync remains a follow-up once that infrastructure is provisioned.
- **AI Assistant (Phase 7)**: `supabase/functions/assistant` proxies to the Claude API, matching the on-device heuristic's exact input/output shape; the client calls it when cloud is configured and signed in, and silently falls back to the on-device draft otherwise.
- **Billing (Phase 7)**: `supabase/functions/stripe-checkout` / `stripe-portal` / `stripe-webhook` implement Checkout, the Billing Portal, and subscription-status sync per Stripe's documented API.
- **Mobile packaging (Phase 6)**: Capacitor wired up for both platforms (`apps/web/capacitor.config.ts`, `ios/`, `android/`), native gesture guards in place (iOS swipe-back disabled, Android back button routed through the app), brand icons/splash generated for both. The Android debug build was verified for real — `gradle assembleDebug` succeeds and installs. The iOS project only builds on macOS/Xcode, which wasn't available to verify here.

None of this needed real credentials to build correctly, but all of it needs them to run: a provisioned Supabase project with the migrations applied, `ANTHROPIC_API_KEY`, a Stripe test-mode account + webhook secret, and (for Xcode) a macOS build machine.

**Founding constraints:** solo founder building with AI tooling · all platforms launch together from one codebase · 3D is a post-MVP fast-follow · Guest Mode (no-account local use) is mandatory for App Store approval.

---

## Design Reference (v1 UI spec)

Three Claude Design screens, versioned in [`design/`](./design/) — open them in a browser to interact:

- **[`Dashboard.dc.html`](./design/Dashboard.dc.html) — My Properties**: top nav (Properties / Templates / Reports, New Property CTA, account menu with Agency team & Billing); property cards with live floor-plan SVG thumbnails; status workflow **Draft → Ready → Exported** with filter tabs + counts; search by address/postcode; grid/list toggle; per-property actions (Open in Editor, AI description, Export); empty state; toasts.
- **[`Editor.dc.html`](./design/Editor.dc.html) — Floor Plan Editor**: top bar (back, title + status pill, undo/redo, zoom %/fit, "Autosaved to Cloud", Export CTA); floating left tool palette **Select(V), Wall(W), Room(R), Door(D), Window(N), Stairs(S), Measure(M), Text(T)** with keyboard shortcuts and active-tool hint; dot/line grid; walls, double-line windows, doors with swing arcs, stairs, dimension lines; floor switcher (Ground/First/+), scale chip (1:50), snap indicator. Right panel, two tabs: **Properties** (room name, room-type select, width/length/area/wall-length readouts, ceiling height, per-room "include in GIA" checkbox — stairs excluded by default, GIA total footer) and **AI Assistant** (auto-name rooms from layout; generate listing/EPC description copy).
- **[`Export Modal.dc.html`](./design/Export%20Modal.dc.html)**: format (PDF vector / PNG 300 DPI), paper A4/A3, portrait/landscape, toggles for measurements and the RICS-style "not to scale" disclaimer, live sheet preview with branded header (address, floor, GIA, logo), file metadata, progress → success states.

**Design system to codify in `packages/ui`**: deep-green brand palette (`#0E3E36` brand, `#0B7A5E` primary action, `#F4F7F6` surface, status pill colours for Draft/Ready/Exported), Instrument Sans (UI) + IBM Plex Mono (measurements), 8–14px radii, pill badges, segmented controls.

**Deltas the plan resolves against the design**: the export modal shows PDF/PNG only — JPG and SVG (a core requirement) are added behind a "more formats" affordance; the design mocks rooms as rectangles — the real engine stays wall-graph-based with auto room detection, rendering to the same visual language; Templates and Reports nav items are post-MVP stubs.

---

## 1. Tech Stack

**One React + TypeScript codebase, packaged natively with Capacitor, backed by Supabase + PowerSync.**

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language across editor, geometry engine, backend functions; best AI-tooling support; reuses existing React/TS skills |
| App framework | React 18 + Vite (PWA) | Already shipped on the agency site; fastest iteration loop |
| Mobile packaging | **Capacitor** (iOS + Android) | The app *is* a canvas editor — Canvas2D/WebGL runs GPU-composited at native speed inside WKWebView/Android WebView. One rendering target, one debugging surface |
| 2D canvas | **Konva (react-konva)** over a pure-TS core model | See §4 |
| 3D (fast-follow) | Three.js + react-three-fiber | Mature on web and inside Capacitor; reads the same document model |
| Backend | **Supabase** (Postgres, Auth, Storage, RLS, Edge Functions) | Managed Postgres with row-level security for multi-tenancy; `supabase-js` already familiar; generous free tier |
| Offline sync | **PowerSync** | Purpose-built offline-first layer for Postgres: on-device SQLite (native via Capacitor plugin; wa-sqlite/OPFS on web). App always reads/writes local; sync is background. Open-source & self-hostable → low vendor risk |
| UI kit | Tailwind + shadcn/ui (touch-sized variants) | Fast to build modern UI — themed to the L&D Energy design tokens |
| AI features | Claude API via Supabase Edge Functions | Powers the AI Assistant (auto-name rooms, listing/EPC description drafts). Server-side only — no API keys in the client; requires connectivity, so the UI degrades gracefully offline |
| Payments | Stripe (web checkout) | Purchases happen on the web under Apple's multiplatform-services rule (3.1.3(b)) to avoid the 30% IAP cut. **The mobile app must NOT be a hard login wall** — it ships with a functional Guest Mode (draw and export locally without an account); an empty login-shell app triggers automatic App Store rejection |
| Hosting | Cloudflare Pages (web app + marketing) | Existing deployment target |
| Monorepo | pnpm workspaces + Turborepo | Shares the core engine between web, mobile, and tests |

### Why not the alternatives

- **React Native / Expo**: RN's strengths (native scroll/navigation feel) barely matter for a canvas editor, while its weak leg — `react-native-web` — would degrade the desktop-web editor (keyboard shortcuts, context menus, precise mouse work). RN Skia on web ships a ~5 MB WASM runtime; Three.js on RN is painful. Two ecosystems to debug instead of one.
- **Flutter**: Best-in-class raw canvas, but Dart is a second language, its web builds are canvas-rendered blobs (slow first load, weak accessibility), the hiring pool is smaller, and AI-assisted development is markedly stronger in the TS ecosystem. Wrong trade for a solo founder.
- **Firebase instead of Supabase**: Firestore's offline cache is not a true sync engine (no relational queries, poor conflict control), NoSQL modelling fights the relational shape of orgs/properties/plans, and there's no RLS-grade multi-tenancy.

### Monorepo layout (new dedicated repo)

```
floorplan-studio/
├── apps/
│   ├── web/            # Vite PWA shell — routes: dashboard, editor, auth, billing
│   └── mobile/         # Capacitor iOS/Android projects wrapping the same built app
├── packages/
│   ├── core/           # Document model + geometry engine — pure TS, zero UI deps
│   ├── editor/         # React + react-konva canvas editor (renderer + input layer)
│   ├── ui/             # Design tokens (L&D Energy theme) + shared shadcn/ui components
│   └── data/           # Repository layer: PowerSync schema, queries, guest→account adoption
├── supabase/           # Migrations, RLS policies, edge functions (ai-assistant, stripe-webhooks)
├── docs/
├── pnpm-workspace.yaml
└── turbo.json
```

### Offline & conflict model

- Local-first **from day one** (retrofitting sync is the classic failure mode): every read/write hits on-device SQLite; PowerSync replicates to Postgres when online.
- Each floor's plan is a versioned JSON document (walls, openings, symbols, labels) + relational metadata (property, address, owner, org). Single-editor-per-plan is the real-world workflow, so **last-write-wins at document level + full revision history** (nothing is ever silently lost). The document model is designed so Yjs CRDTs can be layered on later for live collaboration.

### Data model sketch

```sql
-- Multi-tenancy (all tables RLS-scoped by org membership; PowerSync sync rules follow the same boundary)
orgs            (id, name, created_at)
org_members     (org_id, user_id, role)          -- owner | admin | member

-- Core domain
properties      (id, org_id, created_by, address_line1, address_line2, postcode,
                 status,                          -- draft | ready | exported
                 beds, property_meta, created_at, updated_at)
plans           (id, property_id, name, scale, unit_system, created_at, updated_at)
floors          (id, plan_id, name, sort_order, default_ceiling_height_m)

-- The drawing itself: LWW head + immutable history
floor_documents (floor_id PK, doc jsonb, version, updated_at, updated_by)
floor_revisions (id, floor_id, doc jsonb, version, created_at, created_by)

-- Commercial
subscriptions   (org_id, stripe_customer_id, plan_tier, status, current_period_end)
```

Guest Mode: rows are created in local SQLite with no `org_id`; signing up runs an **adoption migration** that assigns the user's new org to all local rows and lets PowerSync upload them. This flow is designed in from Phase 1, not retrofitted at store-submission time.

---

## 2. MVP Feature Roadmap (what converts a PlanUp/zPlan user)

**Editor (the product lives or dies here)**
- Wall drawing: tap/click-drag, orthogonal + angle snapping, grid snap, live dimension labels, **numeric length entry** (mm/cm/m/ft-in) to fix a wall's exact length
- Auto room detection from closed wall loops → auto-named rooms with live area
- Doors (with swing direction), windows, openings — attached to walls, slide along them
- Stairs + furniture/fixture symbol library (drag, drop, rotate, mirror)
- Multi-floor plans; text labels; unlimited undo/redo; pinch-zoom/pan; stylus (Apple Pencil) support
- **Photo underlay tracing**: photograph a hand sketch or old plan on-site and trace over it — a killer on-site workflow

**Measurements & EPC data (assessor lock-in)**
- Per-room area + perimeter; total floor area & Gross Internal Area (m²/ft²)
- **Heat-loss perimeter per storey**, room heights per floor/building part, extension zoning — the RdSAP inputs assessors currently compute by hand
- Room schedule / measurement table view; CSV export of all measurement data

**Output (agent/designer lock-in)**
- Client-side (works offline) export to **JPG, PNG, SVG, PDF** — vector PDF/300-DPI PNG per the export-modal design: A4/A3, portrait/landscape, measurements toggle, RICS-style disclaimer toggle, branded sheet header (address, floor, GIA, logo)

**AI Assistant (differentiator — neither PlanUp nor zPlan has this)**
- Auto-name rooms from the drawn layout; one-click **listing/EPC description drafts** from plan data (rooms, areas, floors) ready for Rightmove or the EPC report — per the editor's AI tab and dashboard AI action. Online-only, clearly badged, graceful offline fallback

**Platform**
- Full editor works offline on all three platforms; autosave; visible sync status; property/plan dashboard; shareable read-only plan links
- **Guest Mode / local-only free tier**: open the app and draw a plan immediately, no account required — plans persist on-device; signing up unlocks cloud sync, sharing, and branded exports. (Required for App Store approval, and doubles as the lowest-friction onboarding funnel)

**Explicitly post-MVP**: 3D view (fast-follow), CRM/EPC-software integrations (Alto, Reapit, Elmhurst), live collaboration, AI photo→plan.

---

## 3. Development Phases (solo founder + AI, ~20 weeks to closed beta)

- **Phase 0 — Foundations (wk 1)**: New repo, monorepo scaffold (`packages/core`, `packages/editor`, `packages/ui`, `apps/web`, `apps/mobile`, `supabase/`), CI, Supabase project, **design tokens codified from the L&D Energy draft** (palette, type, radii, pills, segmented controls).
- **Phase 1 — Auth, data & offline spine (wk 1–3)**: Supabase auth (email + Google + Apple), orgs/RLS, property & plan CRUD, **PowerSync local-first storage wired in from the start**, dashboard built to `Dashboard.dc.html` (status workflow Draft→Ready→Exported, filter tabs, search, grid/list, thumbnails from plan data), sync-status UI ("Autosaved to Cloud"). Design for **Guest Mode from the start**: the app is fully usable with no account (plans live in local SQLite only), and signing up adopts existing local plans into the synced account — this must be in the data model now, not retrofitted at store-submission time.
- **Phase 2 — 2D canvas engine core (wk 3–8)**: Pure-TS document model + geometry engine in `packages/core` (wall graph, snapping, shoelace area, room detection, command-pattern undo/redo — fully unit-tested, zero UI deps); Konva renderer; unified mouse/touch/stylus input layer; pan/zoom. Editor chrome per `Editor.dc.html`: floating tool palette with the design's keyboard shortcuts (V/W/R/D/N/S/M/T), active-tool hint, zoom controls, snap & scale chips, dot/line grid options.
  - **Geometry: build on proven libraries, don't hand-roll.** "Auto room detection from closed wall loops" is minimal-cycle finding in an imperfect planar graph — too math-heavy to write from scratch for an MVP. Evaluate and adopt existing computational-geometry libraries first: **JSTS** (JavaScript Topology Suite — its noding + `Polygonizer` does exactly this), **polygon-clipping** (Martinez boolean ops), **@flatten-js/core** (planar sets/faces), Clipper2. Our code owns the wall graph and snapping tolerances; the library owns polygonization and boolean ops.
  - **Input layer: aggressively disable native WebView gestures.** Strict requirement: `touch-action: none` on the canvas element, `overscroll-behavior: none` (no pull-to-refresh/rubber-banding), viewport `user-scalable=no` + iOS `gesturestart` prevention (no page pinch-zoom or double-tap zoom), `-webkit-user-select: none` / `-webkit-touch-callout: none` (no selection callouts), and swipe-back navigation disabled in Capacitor (`allowsBackForwardNavigationGestures = false` on WKWebView; handle Android back button explicitly). Otherwise the browser's native swipe-to-go-back and pinch-to-zoom fight the canvas controls — this must be in place before any gesture work, and verified on real iOS/Android devices.
- **Phase 3 — Architectural elements (wk 8–12)**: Doors (swing arcs) / windows (double-line) / openings, stairs, symbol library, dimension labels + numeric entry, multi-floor with the design's floor switcher, photo underlay. Right-hand Properties panel per the design: room name/type, dimension readouts, ceiling height, per-room GIA inclusion.
- **Phase 4 — Measurement & EPC engine (wk 12–14)**: GIA with per-room include/exclude (stairs out by default, live total in the panel footer), heat-loss perimeter, room heights, room schedule view, CSV export.
- **Phase 5 — Exports (wk 14–16)**: Export modal per `Export Modal.dc.html` — vector PDF (pdf-lib) and 300-DPI PNG first (A4/A3, orientation, measurements + disclaimer toggles, branded header, live preview), plus JPG and SVG (serialised from the document model) behind a "more formats" control — all client-side.
- **Phase 6 — Mobile packaging (wk 16–18)**: Capacitor iOS/Android builds, touch polish, WebView perf testing on mid-range Android, TestFlight + Play internal track. **Guest Mode is a store-submission blocker**: the app must be fully usable without an account (draw + local save + basic export), with sign-up as an upgrade path — a hard login wall on an app that sells outside IAP is an automatic Apple rejection.
- **Phase 7 — AI assistant, commercial layer & beta (wk 18–20)**: AI features from the design (auto-name rooms, listing/EPC description generation) via Claude API behind a Supabase Edge Function; Stripe billing; share links; onboarding; closed beta with 10–20 real assessors/agents.
- **Post-MVP**: 3D view (Three.js extrusion of the same model) → Templates & Reports sections from the dashboard nav → integrations → collaboration (Yjs).

---

## 4. Canvas / Graphics Approach

**Konva (react-konva) as the renderer, on top of a framework-agnostic pure-TypeScript document model.**

- The **document model and geometry engine live in `packages/core`** with zero rendering dependencies: wall graph, snapping, room detection (loop finding), area (shoelace), perimeters, serialisation, undo/redo commands. This is the company's real IP, it's fully unit-testable, and it makes the renderer swappable.
- **Konva** gives a retained-mode scene graph, built-in hit detection, dragging, transforms, layers, and `toDataURL` export — exactly the editor plumbing you'd otherwise hand-build — and renders to Canvas2D, which is GPU-composited and smooth in browsers and Capacitor WebViews alike.
- **Why not the others**: *Fabric.js* — aging imperative API, weak React/TS fit. *PixiJS* — WebGL speed you don't need (floor plans are hundreds of nodes, not 100k sprites) at the cost of building all editor tooling yourself; it remains the escape hatch if profiling ever demands it, swappable thanks to the core/renderer split. *Native SVG/DOM* — simplest, but pan/zoom and hit-testing degrade on large plans and touch gestures are all hand-rolled; SVG remains the **export** format, generated from the model, not the render layer.

---

## Key Risks & Mitigations

- **Canvas editor complexity underestimated** → build the core model test-first (Phase 2 gets the most calendar time); ship wall-drawing vertical slice early.
- **Sync conflicts corrupt plans** → LWW + immutable revision history; single-editor workflow assumption documented.
- **Apple App Store rejection** → Guest Mode makes the app functional standalone with no account (hard login walls that bypass IAP are auto-rejected); Apple sign-in offered alongside Google; no links to external purchase from within the iOS app.
- **Old-Android WebView performance** → test on a mid-range device from Phase 2, not Phase 6.
- **PowerSync dependency** → open-source and self-hostable; data access goes through a thin repository layer so the sync engine is replaceable.

---

## Next Steps

Everything below is code-complete and waiting on credentials/infra, not on further engineering:

1. **Provision a Supabase project**: apply `supabase/migrations/*.sql` in order, set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in the web app's environment. Cloud sync, auth, and guest→account import activate immediately — guest mode is unaffected either way.
2. **Set `ANTHROPIC_API_KEY`** (and optionally `ANTHROPIC_MODEL`) as a secret on that Supabase project, then deploy `supabase/functions/assistant`. The Assistant tab upgrades from on-device drafts to Claude automatically for signed-in users.
3. **Set up Stripe**: create a product/price, set `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID` / `STRIPE_WEBHOOK_SECRET`, deploy `supabase/functions/stripe-checkout` / `stripe-portal` / `stripe-webhook`, and point a Stripe webhook endpoint at the deployed `stripe-webhook` URL.
4. **True offline-first sync**: once the above is live and stable, evaluate migrating from the direct-Supabase adapter to PowerSync for background sync + conflict resolution — the repository-layer split (`packages/data`) makes this swappable without touching UI code.
5. **Finish mobile packaging**: build `ios/` in Xcode on a Mac (App icons/splash/gesture guards are already wired — this is verification, not new work), then TestFlight + Play internal track for both stores. Guest Mode already satisfies Apple's no-hard-login-wall requirement.
5. Post-MVP: 3D view, JSTS-based room detection for non-axis-aligned layouts (current detector handles the common orthogonal case), Templates/Reports sections, live collaboration.
