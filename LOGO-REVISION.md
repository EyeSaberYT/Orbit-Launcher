# Pixel-star logo integration

The logo revision is installed in the existing header, selected Orbit Client artwork and Orbit Client chooser row. Runtime artwork uses a shared SVG for sharp edges at the existing sizes. PNG and Windows ICO assets are regenerated through `npm run icons` from the same canonical SVG. The flat black backing makes the white symbol readable in both themes. Logo-only shadows, filters and animation are removed. The wordmark, mountain background, panel geometry, navigation and backend actions remain in place.

## Direction and scope

The dealt style was Accent ladder with an Open plane shell. The selected face uses the existing sage brand hue, while the product signature is the approved monochrome pixel constellation. The user's explicit logo-only scope takes precedence over replacing the launcher with an analytics layout. The existing floating navigation, glass surfaces, large Minecraft heading and play action therefore remain. No charts, new screens, marketing content, production fixture records or dependencies were added.

The Play screen's question remains: which instance is selected, and can I play it? The selected name and readiness state answer it beside Play Minecraft. Other destination modules and their questions are unchanged.

The supplied kit is copied into `src/css/app-kit/app.css` and `src/vendor/app-kit/charts.js`, with the original first-line license notices and a copy of the license. The CSS root contains the approved brand tokens. These files are not loaded into this logo-only revision because their resets and shell selectors would replace protected launcher styling. No production file links to `.taste` or `.preview`.

## Asset consistency

- Canonical app symbol: `src/assets/brand/orbit-pixel-star/app-icon.svg`.
- Runtime copy: `src/assets/logo.svg`; icon source copy: `src-tauri/icons/source/orbit-icon.svg`.
- The 1024px source PNG and master PNG now contain the same pixel-star design.
- The previous cube generation prompt is retired to the ignored preview folder.
- Existing custom instance icons remain unchanged.
- The SVG contains no font, gradient, filter or animation dependency.

## Checks

- `npm run icons`: passes and writes the configured icon outputs. Its SVG renderer warns about the machine's unrelated `mstmc.ttf` font; this mark contains no text.
- `npm run check`: all 35 frontend modules pass syntax and relative-import checks.
- `node --check scripts/gen-icons.mjs` and `node --check src/vendor/app-kit/charts.js`: pass.
- Asset checks: seven RGBA PNGs have the expected dimensions; runtime and source SVG hashes match the canonical artwork; launcher PNG matches the 128px app export; ICO contains six resolutions. The 128px and 32px outputs were visually reviewed.
- Background SHA256 remains `b6f8b17e215a4330a79146f0571e7152c3377bc3b2479fab23a436e292829155`.
- Preview-only fixture reconciliation passes: three instances, 46 mods, 16200 seconds played and 4096 MiB default memory.
- Native build attempted offline and online without bundling. Offline fails because locked `anyhow` 1.0.104 is not cached; online fails because this environment cannot reach crates.io. No Cargo lockfile or backend code was changed to bypass that environmental failure.
- A bounded headless-browser check from local files timed out. No new preview server was started. Runtime navigation, menus, launch states, error states, mobile/tablet layout, reduced motion, full-page contrast and font rendering must be exercised in TasteCode Preview; this Build does not claim they passed.

## Existing audit exceptions

This revision deliberately does not globally resize the existing interface. Some existing controls have boxes below 44px and some labels are below 11px. Existing glass surfaces, gradients, large heading and user-selected custom imagery also fall outside the generic analytics sheet. These are retained under the explicit preservation requirement, not introduced by the logo. A wider accessibility or interface restyle would be a separate change.

The permitted stack is now `Segoe UI Variable, system-ui, sans-serif`, with generic monospace for code. No proprietary font is copied or bundled, and no unavailable family is claimed as acquired or loaded. The local FontFace and tabular-digit browser checks remain unverified.

## Preview data

Verify before publishing: `.preview/fixture.js` contains synthetic Orbit Client, Survival and Create & explore records, a Player account, the `play.example.test` address, default memory and test playtime. They are browser-check fixtures only and are not referenced by the production entry point. Production instance and account data continue to come from the existing backend store.
