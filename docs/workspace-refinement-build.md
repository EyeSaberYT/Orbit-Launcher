# Orbit workspace refinement

Scope correction: the user clarified that their criticism concerned the logo, not the main interface. The broad workspace restyle below is retired. Its stylesheet remains as an inactive historical file and is no longer linked by the app. The existing scenic introduction, glass surfaces, floating controls and compact metadata presentation have been restored. Preserve that main design in subsequent logo work. The transparent twin-star assets and genuine launcher states remain in place.

Restoration checks: the frontend source check passes for all 40 modules, and the transparent SVG/PNG and native icon checks pass. The local browser regression attempt timed out at Runtime.enable before page assertions could run; the restored presentation has not been visually verified in that attempt. Pre-restoration source copies are retained under .preview/before-logo-scope-restore/.

The dealt style is Accent ladder and the dealt shell is Open plane. Orbit retains its existing header navigation, native window controls and Settings overlay as approved product exceptions. The face is the existing Orbit green ladder, with the transparent twin-star symbol identifying the managed setup. The alpine landscape is retained as real product context, outside the interface accent budget. The oversized introduction, slogan footer and local caption shading are removed. Opaque reading surfaces, flat controls and consistent edges replace the competing glass treatments.

Play answers which instance is selected and whether it can launch. Library answers which installed setup to find or manage. Discover answers which compatible content to install. Friends answers whom to contact or join. Settings answers which launcher preference to change. Startup answers whether the launcher is still preparing. Existing data adapters and native operations remain in place, including instance and project detail routes.

At 1440px the canvas closes as 48 + 600 + 24 + 336 + 24 + 360 + 48 = 1440. The three operating blocks appear together beneath a compact Play title. Smaller widths place the launch block above a library/news pair, then stack when the pair cannot retain readable columns. Phone content has 16px margins. The source comment records the arithmetic.

The kit is retained in src/css/app-kit/app.css and src/vendor/app-kit/charts.js with its license. Its root tokens follow the approved brand. It stays isolated from the legacy component selectors to avoid resetting native launcher behavior; workspace.css maps those same semantic roles into the existing design system. No chart, usage strip, subscription, onboarding feature, package or replacement application was added.

Primary and secondary button hit boxes are at least 44px, with compact 32px surfaces drawn inside them. Navigation uses the green tint ladder. Existing custom instance icons are preserved. Light and dark modes use the same hierarchy. Segoe UI Variable remains device-local, with generic system fallback; there is no bundled or redistributed font and no acquired FontFace claim.

## Verify before publishing

scripts/fixtures/launcher-data.mjs is isolated browser-test content: Orbit Client uses Minecraft 1.21.11, Fabric, 12 mods and 5400 seconds played; Survival uses Minecraft 1.21.11, Vanilla, 0 mods and 3600 seconds; Create & explore uses Minecraft 1.20.1, Forge, 34 mods and 7200 seconds. Assertions check three installed instances, 46 mods and 16200 seconds, or 4 h 30 m. The 4096 MiB default setting displays as 4.0 GB default, not measured memory usage. No running or launching process is assumed initially.

scripts/fixtures/news-data.mjs supplies three isolated release-shaped posts, versions 0.5.11, 0.5.10 and 0.5.9 dated November 6, 5 and 4, 2026. Their summaries are test copy, not verified release notes. The production GitHub adapter remains unchanged and is not required to return three posts. Test captures show Sample data once per affected view. Neither fixture module is imported by production code.

## Checks and boundaries

The source check and transparent-asset checks run locally. The browser suite reads the real static source through Chromium's debugging pipe without starting a preview server. It exercises startup, slow-backend fallback, missing and empty responses, fixture assertions, zero-mod selection, preparing and running presentations, repeated recovery requests, keyboard menus, Escape and focus return, navigation, Settings tabs, stable progress updates and reduced motion. It also exercises Library search and list mode, the phone Discover filter disclosure, and signed-out Friends presentation. Discovery tab clicks are restricted to the actual type buttons, preventing the document's data-type attribute from triggering unintended navigation.

Responsive checks cover 1919x947, 1440x900, 1240x780, 960x640, 1024x768, 820x1180, 768x1024 and 390x844, including lower phone content. DOM checks cover one h1, interactive target sizes and horizontal overflow. Source fixtures remain outside production. Browser game and account operations use mocks; no real Minecraft installation, game process, friend conversation or native account connection was executed.

Native build and offline Cargo tests are blocked by unreachable crates.io and the absent cached locked anyhow 1.0.104 dependency. No Rust source, package versions or lockfiles were changed to bypass the environment. Native packaging and operating-system icon presentation remain unverified. System-font availability varies by platform and must not be represented as a bundled font guarantee.
