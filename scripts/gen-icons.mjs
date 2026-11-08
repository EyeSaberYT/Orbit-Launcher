// Generates the Orbit Launcher icon set from the canonical white twin-star SVG.
// The editable master is src/assets/brand/orbit-pixel-star/app-icon.svg.
// Run with: npm run icons. No page styles or launcher state are changed.
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconDir = join(root, 'src-tauri', 'icons');
const source = join(root, 'src', 'assets', 'brand', 'orbit-pixel-star', 'app-icon.svg');

// `tauri icon` writes every platform's sizes; only the ones tauri.conf.json lists are kept.
const scratchRoot = resolve(tmpdir());
const out = mkdtempSync(join(scratchRoot, 'orbit-icons-'));
try {
  execFileSync(process.execPath, [join(root, 'scripts', 'run-tauri.mjs'), 'icon', source, '-o', out], { stdio: 'inherit' });
  for (const name of ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.png', 'icon.ico']) {
    copyFileSync(join(out, name), join(iconDir, name));
  }
  // Interface logos always use the transparent master. Native backing must never
  // leak back into the launcher when someone regenerates packaged icons.
  copyFileSync(join(dirname(source), 'mark.png'), join(root, 'src', 'assets', 'logo.png'));
  copyFileSync(join(dirname(source), 'mark.svg'), join(root, 'src', 'assets', 'logo.svg'));
  copyFileSync(join(dirname(source), 'mark-inverse.svg'), join(root, 'src', 'assets', 'logo-inverse.svg'));
  copyFileSync(source, join(iconDir, 'source', 'orbit-icon.svg'));
  copyFileSync(join(dirname(source), 'app-icon.png'), join(iconDir, 'source', 'orbit-icon.png'));
  copyFileSync(join(dirname(source), 'mark.png'), join(iconDir, 'source', 'orbit-logo-master.png'));
  console.log('Icons written to', iconDir);
} finally {
  if (dirname(resolve(out)) !== scratchRoot || !basename(out).startsWith('orbit-icons-')) {
    throw new Error('Refusing to remove an icon output directory outside the temporary root.');
  }
  rmSync(out, { recursive: true, force: true });
}
