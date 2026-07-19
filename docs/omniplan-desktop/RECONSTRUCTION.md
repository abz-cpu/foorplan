# OmniPlan desktop — reconstruction spec

Everything below was recovered by static analysis of the shipped Windows
installer `OmniPlan_0.1.0_x64setup.exe` (4.8 MB). The goal is to let us rebuild
the **desktop packaging** of Floor Plan Studio, which is not currently in this
repo. OmniPlan is the Tauri wrapper around the same Vite + React web app that
lives in `apps/web`.

> Provenance note: values marked **(exact)** were read directly from the binary
> (PE resources, embedded strings, embedded config). Values marked **(assumed)**
> are sensible defaults you must confirm — they weren't recoverable because the
> `tauri.conf.json` window block and identifier are stored compressed/normalised.

---

## 1. What the installer is

| Property | Value | Source |
|---|---|---|
| Product name | **OmniPlan** | PE version resource **(exact)** |
| File description | OmniPlan | PE version resource **(exact)** |
| Version | **0.1.0** | PE version + filename **(exact)** |
| Company name | `co` (looks like a truncated / mis-set field — should be "L&D Energy") | PE version resource **(exact)** |
| Tagline | "professional floor plan software" | embedded config **(exact)** |
| Installer type | NSIS 3 (Unicode), per Tauri's `nsis` bundle | 7-Zip header **(exact)** |
| Target | Windows x64 (PE32+), needs **WebView2 runtime** | PE header + `wry` strings **(exact)** |
| Payload | single `omniplan.exe` (16.4 MB) + NSIS plugins | archive listing **(exact)** |
| Build machine | `C:\Users\hvssm\...` (dev "hvssm") | embedded cargo paths **(exact)** |

The installer is a standard Tauri NSIS bundle: an NSIS stub plus
`nsis_tauri_utils.dll`, `modern-wizard.bmp` / `modern-header.bmp` wizard images,
and the compiled `omniplan.exe`. The whole frontend (HTML/CSS/JS/fonts) is
embedded inside `omniplan.exe`, brotli-compressed, and served by Tauri's asset
protocol at runtime.

---

## 2. Tech stack (exact)

**Backend / shell**
- **Tauri `2.11.4`**, **wry `0.55.1`**, **webview2-com `0.38.2`** — WebView2 (Edge Chromium) on Windows.
- Rust, built in release. Native crates seen: `rfd 0.16` (file dialogs), `rustls` + `minisign-verify 0.2.5` (signed updater), `cfb 0.7`, `semver 1.0.28`.

**Tauri plugins (exact, with versions where recovered)**
- `tauri-plugin-dialog` **2.7.1** — native open/save/message dialogs
- `tauri-plugin-fs` — read/write project files (scoped to app dirs)
- `tauri-plugin-updater` — GitHub-hosted signed auto-update
- `tauri-plugin-autostart` — "Launch app at login"
- `tauri-plugin-window-state` **2.4.1** — remembers window geometry (`window-state.json`)
- `tauri-plugin-single-instance` **2.4.2** — one running instance
- Core plugins in use: `window`, `webview`, `menu`, `tray` (system tray — "Close to system tray"), `image`, `path`, `event`, `app`, `process` (restart), `resources`.

**Frontend** (Vite build embedded in the binary)
- **React** (`assets/react-*.js`, `react.production.min`) + Vite code-splitting.
- **three.js** (`assets/three-*.js`, `ThreeDView-*.js` — WebGLRenderer/BufferGeometry) for the 3D view.
- 2D editor: repo uses **Konva** (`packages/editor`); the shipped bundle is consistent with that.
- Export stack, each its own lazy chunk: **PDF** (`pdf-*.js`, a jsPDF/pdf-lib-style engine — PDFDocument/PDFRef/flate strings), **DOCX** (`docx-*.js` — `Packer`, "List Paragraph"), **XLSX** (SheetJS-style).
- **Tailwind CSS** (`--tw-*` vars) with a custom token palette: `--surface`/`--surface-2`/`--surface-3`, `--content`/`--content-muted`, `--accent`/`--accent-strong`, `--border`, plus a `brand-gold` brand colour and a `dark` theme.
- **Inter** typeface bundled via `@fontsource/inter` (latin, latin-ext, cyrillic, greek subsets, weights 400–700, woff + woff2 — stored uncompressed).

**Frontend chunk map (exact filenames from the binary)**

| Chunk | Purpose |
|---|---|
| `assets/index-*.js` (5 chunks) | app entry + vendor/runtime split |
| `assets/react-jMWJP5AT.js` | React runtime |
| `assets/three-DAYizq1g.js` | three.js |
| `assets/ThreeDView-1r58F1pY.js` | 3D view (lazy) |
| `assets/PhotoPlanView-CyAk3vzc.js` | photo-plan view (lazy) |
| `assets/pdf-IG16A0Hy.js` | PDF export (lazy) |
| `assets/docx-DH9gyd7R.js` | Word / .docx export (lazy) |
| `assets/core-DxBnVPgq.js` | shared core |
| `assets/tauriFile-Cf-xSSzW.js` | Tauri file-system bridge |
| `assets/window-DRf8Jcmu.js` | window controls |
| `assets/index-DT7fq2YH.css` | Tailwind stylesheet (~35 KB) |

---

## 3. Auto-updater (exact)

- Endpoint: `https://github.com/Hvssmuh/OmniPlan-Releases/releases/latest/download/latest.json`
- Signature scheme: **minisign** (Tauri updater default).
- Public key (`untrusted comment: minisign public key: EB8D4E1D620F0D96`):
  ```
  RWSWDQ9iHU6N65PIFFGfkcBOEeMaoY0W33dEXnW+OLL/PnitSKeWfRrz
  ```
- Releases are published to a **separate public repo** `Hvssmuh/OmniPlan-Releases`, not the source repo.
- UI wiring seen: "Check for updates", "Check for updates automatically", "An update is ready", "Download & Install", "Restart & Install".

The private signing key is **not** in the installer (only the public key is). To
keep the existing update channel working you need the original
`TAURI_SIGNING_PRIVATE_KEY`; otherwise generate a new keypair
(`pnpm tauri signer generate`) and ship the new public key in `tauri.conf.json`.

See `reference/latest.json.example` for the manifest shape.

---

## 4. Application feature inventory (from embedded UI strings)

OmniPlan is a **UK property / EPC floor-plan tool** aimed at Domestic Energy
Assessors (DEA/RdSAP), estate agents and interior designers. Recovered UI labels
group into:

**Drawing & editing**
- Tools: Add Walls, Draw room, Add Room, Add Door, Add Window, Add Stairs, Add Text, Add Symbol, Add Annotation, Add Floor; Move/Select (Move tool), Pan (hand), Nudge, Snap to wall, Show grid.
- Walls: Set Wall Thickness / Default Wall Thickness, Set Wall Thermal Class, Make Wall Curved/Straight, Split Wall (split here / in half), Interior/Exterior walls, Party wall (PW), Internal partition.
- Rooms: Rename/Change Room Type, Set Room Colour, Edit Room Description, "Include in area" / "Net internal area", room dimension ordering, automatic dimensions.
- Openings: doors & windows with hinge side (Left/Right, In/Out), Edit/Delete Opening.
- Curves: Make curve / Make straight; corner-by-corner room shapes with "remove last corner".

**Multi-floor & views**
- Floors: Lowest/Lower Ground, Ground, First … Seventh Floor, Room in Roof, Loft Room, split-level variants; Add/Rename/Delete Floor.
- Views: 2D plan, **3D view** (three.js), **Photo Plan**, **EPC View**, Plan summary.

**Room / property taxonomy (RdSAP-flavoured)**
- Property types: Detached, Semi-Detached, Mid/End-Terrace, Enclosed Mid/End-Terrace, Flat/Apartment, etc.
- Rooms: Bedroom 1–6, Master/Main Bedroom, En-suite (Bathroom/Shower), Family Bathroom, Kitchen / Diner / Breakfast Room, Living/Drawing/Sitting/Reception Room, Utility/Laundry, Boot Room, Entrance Hall/Vestibule/Porch, Plant Room, Garage (single/double), etc.

**Symbol library (fixtures)**
- Sanitary: basins (corner/oval/pedestal/square/small-corner), bidets, toilets (Back-to-Wall, Separate WC), showers (Quadrant/Pentangle/Corner), bath.
- Kitchen: Hob & Oven, Fitted Kitchen units.
- Storage: wardrobes (single/double/sliding/bifold), fireplaces (inset).
- Heating/energy: radiators (Single/Double/Column/Alternative), Electric Heater, Air Source HP (heat pump), Room Stat, Electric Meter, Low-energy Light.
- Safety: Smoke Detector, CO Detector, Fire Extinguisher, Fire Blanket, Fire Exit.

**Export & branding**
- Formats: PDF, image (PNG/JPG), Word — "Export (PDF / image / Word)".
- Layouts: "Simple Floor Plan PDF", "Estate Agent Layout PDF", **Property Particulars (.docx)**.
- Options: Paper size, Auto-fit to Paper, All floors on one page, DRAFT watermark, logo (PNG/JPEG/SVG) + logo position, company/branding fields ("Edit Branding").

**Accounts / integrations**
- Account system: Sign in/out, Create account, Display name, Company name (Supabase-backed per repo).
- Integrations (Beta) referencing UK EPC/agency software: Elmhurst (RdSAP GO), Quidos (iQ-Energy), ECMK (SMART SURVEY), Expert Agent, Encore Live.

**Native/desktop-only behaviours**
- Native file open/save of **`.omniplan`** project files (JSON) via the fs + dialog plugins ("OmniPlan File", Save/Save As, Recent files, New from template).
- System tray + "Close to system tray", "Launch app at login", Check for updates, Keyboard Shortcuts (customisable, reset to defaults), Dark mode.

**Native project file:** extension **`.omniplan`**, JSON payload. (The web/PWA build
persists to IndexedDB via `packages/data`; the desktop build additionally
reads/writes `.omniplan` files on disk — that's the main delta to implement.)

---

## 5. How to rebuild the desktop app

The web app already exists (`apps/web`). Adding Tauri means adding a
`src-tauri/` project that bundles the Vite `dist/`. Suggested location:
`apps/web/src-tauri/` (keeps the desktop shell next to the frontend it wraps),
or a new `apps/desktop/` workspace package.

1. Install the CLI: `pnpm add -D @tauri-apps/cli` and the JS API
   `pnpm add @tauri-apps/api @tauri-apps/plugin-fs @tauri-apps/plugin-dialog
   @tauri-apps/plugin-updater @tauri-apps/plugin-autostart
   @tauri-apps/plugin-window-state` in `apps/web`.
2. Scaffold: `pnpm tauri init` (or copy the files in `reference/`), pointing
   `frontendDist` at the web build output and `devUrl` at the Vite dev server.
3. Drop in the recovered `reference/tauri.conf.json`, `reference/Cargo.toml`,
   `reference/src/main.rs`, `reference/build.rs`, `reference/capabilities/default.json`.
4. Generate icons from `reference/icons/icon-256.png`:
   `pnpm tauri icon docs/omniplan-desktop/reference/icons/icon-256.png`.
5. Updater signing: `pnpm tauri signer generate -w ~/.tauri/omniplan.key`, put
   the public key in `tauri.conf.json → plugins.updater.pubkey`, and set
   `TAURI_SIGNING_PRIVATE_KEY` (+ password) in CI. Reuse the original key only if
   you still have it (needed to keep the current `EB8D4E1D620F0D96` channel).
6. Build: `pnpm tauri build` → produces `OmniPlan_<version>_x64-setup.exe` under
   `src-tauri/target/release/bundle/nsis/`.
7. Release: the workflow in `reference/release.yml` builds, signs, and publishes
   `latest.json` + the setup exe to the `OmniPlan-Releases` repo.

### Things to confirm (couldn't be read from the binary)
- **Bundle identifier** — not recoverable. The Android app uses
  `uk.co.ldenergy.floorplanstudio`; suggest `uk.co.ldenergy.omniplan`.
- **Window size / title / decorations** — the window block is normalised in the
  compiled config. `reference/tauri.conf.json` uses sensible defaults
  (1280×800, min 900×600, resizable, maximized-on-launch is common for editors).
- **CSP** — not recoverable; the reference config ships a reasonable one.
- **Company field** — set it to "L&D Energy" (the shipped installer has `co`).

---

## 6. Extracted assets in this folder

```
reference/
  tauri.conf.json          reconstructed Tauri 2 config
  Cargo.toml               Rust crate + plugin dependency set (exact versions)
  build.rs                 tauri-build hook
  src/main.rs              app entry: plugins wired up (single-instance, window-state, tray, updater…)
  capabilities/default.json  permission set matching the plugins observed
  latest.json.example      updater manifest shape
  release.yml              GitHub Actions build+sign+publish workflow
  icons/                   the app's own icons carved from the PE (.rsrc), 16–256px
```

All reference files are freshly authored from the recovered facts above (standard
Tauri scaffolding), not copied out of the binary. The `icons/` PNGs are the
product's own icon extracted from the executable's resource section.
