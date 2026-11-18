# Changelog

What changed in each Orbit Launcher release. The release build copies the section for its
version onto the GitHub release page (and the Discord announcement), so write it for players:
what they will notice, then what was fixed. A release without a section here does not build.

## v0.6.7

- **Automatic FPS boost.** When you start an instance, the launcher adds the free mods that make Minecraft
  run much faster: Sodium (or Embeddium on Forge), Lithium, FerriteCore, ModernFix, Entity Culling,
  More Culling, ImmediatelyFast and Dynamic FPS. Only versions made for that exact Minecraft version and
  loader are used, so it works from old versions to the newest on Fabric, Quilt, Forge and NeoForge.
  Modpacks and instances that already have their own performance mods (Sodium, OptiFine and the like) are
  left exactly as they are, and a mod you delete is never added back. Turn it off in Settings > General.
- **Uses your fast graphics card.** On laptops with two graphics cards, Minecraft now runs on the
  high-performance one instead of the power-saving one.
- **Borderless fullscreen** for Minecraft (Settings > General): fills the screen, and Alt+Tab switches away instantly.
- **Java tuned for games:** memory clean-up that causes fewer stutters.
- **Security fix:** a hostile server can no longer crash the game through a bug in Java 17, 21 and 25
  on newer Intel and AMD processors (CVE-2026-114938). Java 8 isn't affected.
- **Safer downloads:** mods from Modrinth are only downloaded from Modrinth's own servers and must match
  Modrinth's SHA-512 checksum. The zip and SQLite libraries are updated with their security fixes, and links
  in the Microsoft sign-in window open in your browser.
- **Christmas advent calendar** on the Play page: open a door each day from December 1st to 24th to
  claim that day's limited-edition Orbit Client cosmetic (Orbit Client 1.1.8 or newer). Each door can
  only be opened on its own day. In November it counts down to the first door.
- **Orbit Updates:** a new tab with every Orbit announcement and the launcher and Orbit Client release
  notes, each opening in full inside the launcher.
- **First-time setup** for new players: pick your look, bring your instances over from Prism Launcher,
  the Modrinth App, CurseForge or the Minecraft Launcher, and sign in.
- **A new look:** an animated splash screen, frosted glass on every panel, smoother page changes and
  loading animations, and snowfall with pixel-art ice spikes in December. An Animations setting turns the
  motion off.
- **Easier Microsoft sign-in.** Signing in now opens Microsoft's own sign-in page in a launcher window.
  It closes by itself once you're signed in, and there's no code to type in anymore. Closing the
  window (or pressing Cancel) stops the sign-in.

## v0.6.6

**Security fix for friends. Please update.**

- **Fixed: someone on your network could log into Minecraft servers as you.** The friends feature
  signed in to Orbit's server over plain HTTP and signed whatever "challenge" it received with
  Mojang. Someone on the same Wi-Fi, or anyone who could fake the server, could hand over a real
  server's login value and join that server (for example Hypixel) under your name. The launcher now
  mixes a random number of its own into what it signs, so the value can't match any other server.
- **Friends now use HTTPS** (`orbit-social.minearcade.org`). Friend lists, messages and your friends
  sign-in can no longer be read or changed by anyone between you and the server.

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
