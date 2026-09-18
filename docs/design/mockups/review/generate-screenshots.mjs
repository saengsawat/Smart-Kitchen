import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const outputDir = join(here, 'assets');
const frame = pathToFileURL(join(here, 'capture-frame.html'));
const browserCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const screens = [
  ['01-home-dashboard', { screen: 'scr-home' }],
  ['02-inventory', { screen: 'scr-inventory' }],
  ['03-add-food', { screen: 'scr-add' }],
  ['04-barcode-match', { screen: 'scr-scan' }],
  ['05-recipes', { screen: 'scr-recipes' }],
  ['06-shopping', { screen: 'scr-shopping' }],
  ['07-assistant', { screen: 'scr-assistant' }],
  ['08-account-household', { screen: 'scr-account' }],
  ['09-allergies-preferences', { screen: 'scr-allergies' }],
  ['10-profile', { screen: 'scr-profile' }],
  ['11-manual-add', { screen: 'scr-manual' }],
  ['12-item-detail', { screen: 'scr-item' }],
  ['13-badge-legend', { screen: 'scr-legend' }],
  ['14-recipe-ready', { recipe: 'ok' }],
  ['15-recipe-unknown', { recipe: 'unk' }],
  ['16-recipe-blocked', { recipe: 'blocked' }],
  ['17-new-user-home', { screen: 'scr-home', state: 'new-user' }],
  ['18-camera-denied', { screen: 'scr-scan', state: 'camera-denied' }],
  ['19-barcode-no-match', { screen: 'scr-scan', state: 'scan-miss' }],
  ['20-recipes-empty', { screen: 'scr-recipes', state: 'recipes-empty' }],
  ['21-recipes-blocked-list', { screen: 'scr-recipes', state: 'recipes-blocked' }],
  ['22-shopping-offline', { screen: 'scr-shopping', state: 'offline' }],
];

mkdirSync(outputDir, { recursive: true });
const browserProfile = mkdtempSync(join(tmpdir(), 'kitchensmart-capture-'));
const browser = browserCandidates.find(candidate => {
  const check = spawnSync('powershell', ['-NoProfile', '-Command', `Test-Path -LiteralPath '${candidate.replaceAll("'", "''")}'`], { encoding: 'utf8' });
  return check.stdout.trim().toLowerCase() === 'true';
});
if (!browser) throw new Error('Microsoft Edge or Google Chrome was not found.');

for (const [name, query] of screens) {
  const url = new URL(frame);
  url.hash = new URLSearchParams(query).toString();
  const output = resolve(outputDir, `${name}.png`);
  const result = spawnSync(browser, [
    '--headless=new',
    '--hide-scrollbars',
    '--disable-gpu',
    '--allow-file-access-from-files',
    `--user-data-dir=${browserProfile}`,
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=2500',
    '--window-size=440,900',
    `--screenshot=${output}`,
    url.href,
  ], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Capture failed: ${name}`);
}

console.log(`Created ${screens.length} screenshots in ${outputDir}`);
