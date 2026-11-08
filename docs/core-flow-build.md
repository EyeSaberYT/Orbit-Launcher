# Core play-flow repairs

This pass fixes the sign-in → instance → install → launch path. Visual design, logo, shimmer, typography, routes and instance icons are unchanged; brand assets still pass `scripts/check-brand-assets.mjs`.

## Backend (Rust)

- **Java selection**: versions that ask for Java 8 (≤1.16, LaunchWrapper Forge) now need exactly Java 8 (`java::suits`). Before, an installed Java 17/21 was chosen and LaunchWrapper crashed. If no Java 8 is present, Mojang's `jre-legacy` is downloaded. A Java chosen explicitly by the player is still used when it is new enough. Windows ARM64 now uses Mojang's `windows-arm64` runtime instead of the 32-bit x86 one.
- **Microsoft sign-in**: XSTS failures are parsed from their real body (`XErr`). Players now see the specific reason: no Xbox profile, banned, parental controls, region, adult verification or child account. Previously every failure showed a generic message. A missing profile is now told apart from not owning the game when the entitlement service answers. A failed entitlement check is "unknown", not "owned".
- **Mod loaders**: a modded instance without a loader build no longer launches as vanilla. Launch installs the missing loader first: the chosen build, or else the newest stable build. "Reinstall" in instance settings now deletes the profile and installs it again, so a damaged Forge or NeoForge install can be repaired.
- **Launch arguments**: `-Xms` is clamped so it never exceeds `-Xmx`. `${quickPlayPath}` points to `<game>/quickPlay/log.json`. The legacy `${auth_session}` value is `token:<token>:<uuid>`. Placeholder substitution keeps non-ASCII text intact.
- **Instance summary**: `installed` now requires the client jar as well as the version profile. Previously a profile alone, which can exist without any game files, counted as installed. Each summary also includes the instance's own `memoryMax`.

## Frontend

- Home shows "Ready to install" / "Install & play" for instances whose files aren't on disk, and each instance's own memory.
- A failed account load shows "Retry accounts" instead of "Sign in", and Play doesn't start a new device-code sign-in.
- Settings shows the load error and a retry, instead of loading forever.
- A failed long task (launch, install, import, Java) clears its stuck progress footer.
- The project page shows a version-request failure with a retry, instead of "0 versions / no downloadable files".
- The new-instance dialog clears stale errors and offers a retry when the version list fails to load.
- "Reinstall loader" forces a fresh install.
- Friends chat keeps redrawing after reaching the 200-message cap.
- Dialogs are named by their heading (`aria-labelledby`/`aria-describedby`); Settings is labelled "Settings".
- "Browse releases" is a real link that can be reached by keyboard.

## Verification

- `npm run check`: 40 modules OK.
- `cargo test`: 136 passed (new tests cover Java suitability, XSTS parsing, UTF-8 substitution and heap clamping).
- `node scripts/check-repair.mjs`: full browser suite passes. New assertions cover install state, instance memory, account and settings load failures (including layout audits at phone, tablet and desktop), clearing progress after a failed task, dialog names and focus return after Escape. These are browser tests against an isolated fixture backend. They don't install or launch Minecraft.

Real Microsoft sign-in, game downloads and game processes were not exercised in this pass.
