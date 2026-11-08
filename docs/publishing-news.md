# Publishing Orbit news

The Play screen reads public GitHub Releases from
[EyeSaberYT/Orbit-Launcher](https://github.com/EyeSaberYT/Orbit-Launcher/releases).
There is no Minecraft news source, server to maintain, or embedded GitHub token.
The repository is configured once in `src/js/news.js` as `NEWS_REPOSITORY`.

## Post an announcement without shipping an app

1. Open [New release](https://github.com/EyeSaberYT/Orbit-Launcher/releases/new).
2. Create a unique tag starting with `news-`, for example `news-2026-11-07`.
   Target the default branch. Use an announcement title as the release title.
3. Write a short opening paragraph followed by the full announcement in Markdown.
   The launcher uses a plain-text excerpt and links to the complete post on GitHub.
4. Optional: upload a PNG, JPEG or WebP called `news-cover.png`, `news-cover.jpg`
   or `news-cover.webp` as a release asset. A GitHub-hosted Markdown image also works.
   Without an image, the post uses a text layout with no empty artwork slot.
5. Check **Set as a pre-release** and leave **Set as the latest release** off.
   This keeps a news-only post out of the signed app updater's latest-release feed.
   The launcher recognizes `news-` tags as announcements even with that checkbox set.
6. Publish the release. Drafts stay out of the feed. Refresh the news panel to check it.

The existing build workflow only runs for `v*` tags, so a `news-` tag does not
trigger an installer build. Do not change the version numbers or updater manifest
for an announcement.

## App release notes

Published stable app releases appear automatically too. Edit their release title
and description on GitHub to write the update story. Ordinary beta/pre-release
builds are omitted. The title falls back to the tag when no title was entered.

The three newest posts are shown by publication time. GitHub is checked at most
once per 15 minutes per installation unless someone presses Refresh. Previously
loaded posts remain available offline and show when they were saved. Empty,
unavailable and loading feeds have their own states. A private repository cannot
be read anonymously; keep the news source public rather than putting a token in
the frontend.
