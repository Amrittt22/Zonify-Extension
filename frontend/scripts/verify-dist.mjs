/**
 * Verifies that a built extension is actually shippable.
 *
 * The build is generated, so nothing stops a manifest path, an icon or a
 * permission from drifting. This runs after `npm run build` (and inside
 * `npm run package`) and fails loudly instead of shipping a broken zip.
 *
 * Usage: npm run verify:dist
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const problems = [];
const note = (message) => problems.push(message);

if (!existsSync(join(dist, 'manifest.json'))) {
  console.error('dist/manifest.json is missing — run `npm run build` first.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));

// --- structure ------------------------------------------------------------
if (manifest.manifest_version !== 3) {
  note(`manifest_version is ${manifest.manifest_version}, expected 3`);
}
if (manifest.version !== pkg.version) {
  note(`version ${manifest.version} does not match package.json ${pkg.version}`);
}
if (!manifest.name) note('name is missing');
if (!manifest.description) note('description is missing');
if (!manifest.action?.default_popup) note('action.default_popup is missing');
if (!manifest.background?.service_worker) note('background.service_worker is missing');
if (!manifest.options_page && !manifest.options_ui) note('no options page declared');

// --- least privilege ------------------------------------------------------
const required = ['storage', 'alarms', 'notifications', 'declarativeNetRequest'];
for (const permission of required) {
  if (!manifest.permissions?.includes(permission)) {
    note(`permissions is missing "${permission}"`);
  }
}

const hostPermissions = manifest.host_permissions ?? [];
if (hostPermissions.length !== 1 || hostPermissions[0] !== '<all_urls>') {
  note(`host_permissions is ${JSON.stringify(hostPermissions)} — blocking rules match <all_urls>`);
}

// Permissions Zonify deliberately does not use; adding one should be a decision.
const forbidden = ['tabs', 'history', 'cookies', 'webRequest', 'webRequestBlocking', 'activeTab'];
for (const permission of forbidden) {
  if (manifest.permissions?.includes(permission)) {
    note(`permissions should not include "${permission}"`);
  }
}

// --- every manifest reference resolves inside dist/ -----------------------
const referenced = new Set();
const addRef = (path) => {
  if (typeof path === 'string' && path !== '' && !path.includes('*')) referenced.add(path);
};

addRef(manifest.action?.default_popup);
addRef(manifest.background?.service_worker);
addRef(manifest.options_page ?? manifest.options_ui?.page);
for (const icon of Object.values(manifest.icons ?? {})) addRef(icon);
for (const entry of manifest.web_accessible_resources ?? []) {
  for (const resource of entry.resources ?? []) addRef(resource);
}

if (referenced.size === 0) note('manifest references no files at all — suspicious');

for (const relative of referenced) {
  const full = join(dist, relative);
  if (!existsSync(full)) {
    note(`manifest references "${relative}", which is not in dist/`);
  } else if (statSync(full).size === 0) {
    note(`"${relative}" is empty`);
  }
}

// --- icons ----------------------------------------------------------------
for (const size of ['16', '32', '48', '128']) {
  if (!manifest.icons?.[size]) note(`icons.${size} is missing`);
}

// --- the redirect target must be web-accessible ---------------------------
if (!existsSync(join(dist, 'src/blocked/blocked.html'))) {
  note('the blocked page is missing from dist/ (DNR redirect target)');
}

// --- privacy policy ships with the extension ------------------------------
if (!existsSync(join(dist, 'privacy.html'))) {
  note('privacy.html is missing from dist/ (privacy policy)');
} else if (statSync(join(dist, 'privacy.html')).size < 1000) {
  note('privacy.html is suspiciously small');
}

if (problems.length > 0) {
  console.error(`dist/ verification failed (${problems.length} problem${problems.length === 1 ? '' : 's'}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `dist/ ok — ${manifest.name} ${manifest.version} · MV3 · ${referenced.size} manifest references · ` +
    `permissions: ${(manifest.permissions ?? []).join(', ')}`,
);
