# Stronger Orbit star shimmer

The shared star sheen now repeats every 3200ms instead of 4800ms. Its minimum alpha is 0.55 instead of 0.76, and its fully bright center spans 45–55% instead of 48–52% of the mask. Each cycle has 480ms of rest, an 1100ms eased sweep and 1620ms of rest. Both off-artwork endpoints have the same alpha floor, avoiding a reset flash. Geometry, artwork files, the stationary wordmark and 2px header gap are unchanged. No new header surface or dependency was added.

## Product, style and scope

The dealt style is Accent ladder and its shell is Open plane. Brand preservation takes precedence: Orbit retains its existing scenic floating header, green controls, glass panels, density, spacing, typography and routes. The kit copy records the approved green reference ladder and sheet dimensions without being linked into the launcher. Both kit copies retain their original first-line licenses; charts.js is byte-identical and app.css differs only in its first root token block.

The face and signature are the existing white twin stars with a more visible traveling sheen. The only repeating decorative-motion exception is the user-requested sheen. Existing startup arcs continue to indicate real startup work independently. The main screen's large heading, glass, gradients, shadows, scenic color share and existing mixed spacing remain protected scope exceptions. No analytics layout, chart, KPI or new screen was introduced.

Play asks which instance is selected and whether it can launch. Library asks which setup to find or manage. Discover asks which compatible content to install. Friends asks whom to contact or join. Settings asks which launcher preference to change. Startup asks whether the launcher is still preparing. The shell asks which launcher this is and where to go. Existing grid arithmetic remains in src/css/home.css: 52 + 551.59 + 20 + 380.41 + 24 + 360 + 52 = 1440px.

## Inventory and assumptions

- Players use short launcher sessions, mainly on desktop; selecting and launching an instance remains the primary job.
- Instance objects retain IDs, names, game versions, loaders, tags, optional custom artwork and installed flags.
- Mod counts are integers; play time is stored in seconds; memory is stored in MiB and formatted by the existing helper.
- Selected identity, readiness, metadata and launch/stop/retry controls remain derived from existing native state.
- Request failure remains distinct from a successful empty response; unknown values do not become zeros.
- Account identity and running processes remain real native-adapter values, never fixture defaults.
- News retains real titles, publication timestamps, safe release URLs, optional imagery and cache/error state.
- Default Orbit artwork alone receives the sheen; custom instance icons retain priority and remain unaffected.
- Existing 36px/42px header, 38px managed-row and 56px selected/startup artwork placements are preserved.
- The requested improvement means a clearer luminance sweep, not a new identity or a contrast-compliance repair.

## Verify before publishing:

- scripts/fixtures/launcher-data.mjs remains isolated test data. Orbit Client, Survival and Create & explore have 12/0/34 mods and 5400/3600/7200 seconds played. Assertions reconcile 3 installed instances, 46 mods and 16200 seconds, equivalent to 4 h 30 m. Default memory is 4096 MiB, displayed as 4.0 GB default. Production does not import these fixtures.
- scripts/fixtures/news-data.mjs contains three release-shaped test posts for versions 0.5.11, 0.5.10 and 0.5.9 dated November 6, 5 and 4, 2026. They are not verified production announcements. Fixture views retain their existing Sample data notice, once per affected view.
- src/css/shell.css retains device-local Segoe UI Variable with system-ui and sans-serif fallbacks. Browser font readiness was loaded and checks for weights 400/500/600/650/700 succeeded on this machine. There are zero registered custom FontFaces; no bundled font or redistribution license is claimed.
- The existing white identity on pale sky still has its documented contrast limitation. This motion-only change does not fix or certify it, and the rejected dark header remains absent.

## Verification

npm run check passes all 40 frontend modules. There is no separate project lint or TypeScript-check script. The browser-test script passes Node syntax checking. The asset checker verifies unchanged canonical/runtime geometry, PNG alpha and antialiasing, provenance hashes, native PNGs and six ICO frames. Kit integrity checks pass. Hash comparison confirms all 20 protected files outside the intentionally changed motion stylesheet remain unchanged from this run's baseline, including layout, logo styling, scenery, native behavior and package files.

The existing browser regression script completes successfully outside the filesystem sandbox; Chromium stalls inside it. It reads fixture console assertions and checks startup, empty/zero/ready/unavailable/recovery, preparing/running, selection, repeated retry, routes, menus, focus return, news states, Library filtering/layout switching, Discover and Friends phone views, Settings and reduced motion. Checked desktop, tablet and phone views retain one h1, 44px targets, readable metadata and no horizontal overflow. Existing shell-label checks exceed 4.5:1 in both themes; they exclude the documented white identity contrast limitation.

Additional browser checks seek the actual animation at rest, during the sweep and at its endpoint on desktop and phone in both themes. They verify shared 3200ms timing, the stronger alpha stops, changing sheen position with fixed artwork bounds, immediate removal on a mid-cycle reduced-motion change and resumption without remounting. Rest and shine captures were inspected at phone size, with the light-theme desktop shine also inspected. The phone pair shows a clear change from muted white to a bright moving band without shifting the surrounding interface. Existing static artwork remains the fallback when masking is unsupported; an unsupported-mask browser was not available for direct testing.

The native build was attempted through CARGO_NET_OFFLINE=true and npm run build -- --no-bundle. It remains blocked by the unavailable cached locked anyhow 1.0.104 dependency. No lockfile or dependency version was changed. Actual installation, game processes, account operations, native packaging and operating-system icon presentation were not tested. No preview server was started during this Build.
