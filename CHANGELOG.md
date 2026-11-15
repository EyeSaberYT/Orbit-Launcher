# Changelog

What changed in each Orbit Launcher release. The release build copies the section for its
version onto the GitHub release page (and the Discord announcement), so write it for players:
what they will notice, then what was fixed. A release without a section here does not build.

## v0.6.5

**Orbit Launcher has a new home: [MineArcadeStudio/Orbit-Launcher](https://github.com/MineArcadeStudio/Orbit-Launcher).**

- Updates now come straight from the new repository. Older versions keep updating too:
  GitHub forwards the old address, so nothing needs reinstalling.
- Every link in the launcher points at the new place: Settings > Updates, the news on the
  home page, "All updates", and the "Get Orbit Launcher" button on your Discord profile.
- Orbit Client updates are checked at its new home, [MineArcadeStudio/OrbitClient](https://github.com/MineArcadeStudio/OrbitClient).

## v0.6.4

- Discord Rich Presence shows the new Orbit image on your profile while the launcher is open.

## v0.6.3

- Fixed: while a game was running, the top bar hid the instance's name and your account name
  and left a row of bare icons. Both names now stay, shortening with "…" when the window is
  narrow. The Online chip makes room first, and the tabs and window buttons never shrink.

## v0.6.2

- **Orbit Client updates itself.** While the launcher is open it checks for a new Orbit Client
  at startup, every 30 minutes and when your connection comes back, and puts the newest jar in
  every instance that has it. Running instances are left until they close, and a jar you
  removed or turned off stays that way.

## v0.6.1

- Minecraft 1.13.2 and older install with Legacy Fabric, so Orbit Client's cosmetics work there.
- Old instances with Orbit Client launch on Java 17, which it needs.
- Fabric API is no longer added where Orbit Client doesn't use it (the cosmetics-only versions).
- New **Performance mods** button on Fabric and Quilt instances (Content tab): Sodium, Lithium,
  FerriteCore, Entity Culling and ImmediatelyFast, only in versions made for the instance's
  Minecraft version.
- The Discord presence's "Join Discord" button opens the current invite.

## v0.6.0

- **New look:** the alpine glass design with the white twin-star logo, and Orbit news on the
  home page.
- Playing works more reliably: the exact Java 8 for old versions, Java on Windows ARM, the mod
  loader installed before launch, a real Reinstall, and fixes for memory and Quick Play settings.
- Clearer sign-in errors for Xbox and game-ownership problems, and honest install, account and
  settings states.
- Visual fixes: long pages stay inside their panel, the window buttons stay on screen, the
  running-game chip keeps Stop and Logs, better contrast in the light theme, and layouts that
  fit small windows.
