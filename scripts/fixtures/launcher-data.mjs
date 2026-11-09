// Isolated browser-test data. Never imported by the production launcher.
export const representativeSettings = { theme: 'dark', defaultMemoryMax: 4096, checkUpdatesOnStart: false };
export const representativeInstances = [
  { id: 'orbit', name: 'Orbit Client', gameVersion: '1.21.11', loader: 'fabric', tags: ['orbit-client'], installed: true, modCount: 12, playTimeSecs: 5400 },
  { id: 'survival', name: 'Survival', gameVersion: '1.21.11', loader: 'vanilla', installed: true, modCount: 0, playTimeSecs: 3600 },
  { id: 'creative', name: 'Create & explore', gameVersion: '1.20.1', loader: 'forge', installed: true, modCount: 34, playTimeSecs: 7200 },
];
export function assertRepresentativeData(rows, settings) {
  console.assert(rows.filter(row => row.installed).length === 3, '3 installed instances');
  console.assert(rows.reduce((sum, row) => sum + row.modCount, 0) === 46, '46 mods in total');
  console.assert(rows.reduce((sum, row) => sum + row.playTimeSecs, 0) === 16200, '16200 seconds played');
  console.assert((settings.defaultMemoryMax / 1024).toFixed(1) === '4.0', '4096 MiB displays as 4.0 GB default');
}
assertRepresentativeData(representativeInstances, representativeSettings);
