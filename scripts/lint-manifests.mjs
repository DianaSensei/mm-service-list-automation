// Validates the manifest TEMPLATES checked into each plugin's folder
// (manifest.plugin.json / manifest.service.json) — not the filled-in ones
// release.yml generates at tag time. Catches the class of mistake that only
// otherwise surfaces as a rejected install in the app days later: a typo'd
// `kind`, a `service.bin` that doesn't match the folder's sidecar name, a
// method list that's empty (silently means "no service permission" to
// validateManifest() on the app side), or a manifest.json that doesn't even
// parse.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PLUGINS_DIR = 'plugins';
let failed = false;

function fail(msg) {
  console.error(`✗ ${msg}`);
  failed = true;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    fail(`${path}: invalid JSON (${e.message})`);
    return null;
  }
}

const KEBAB = /^[a-z0-9][a-z0-9-]*$/;

for (const id of readdirSync(PLUGINS_DIR)) {
  const dir = join(PLUGINS_DIR, id);

  const pluginManifest = readJson(join(dir, 'manifest.plugin.json'));
  if (pluginManifest) {
    if (pluginManifest.kind !== 'plugin') fail(`${id}: manifest.plugin.json kind must be "plugin"`);
    if (pluginManifest.id !== id) fail(`${id}: manifest.plugin.json id "${pluginManifest.id}" != folder name`);
    for (const field of ['sdk', 'label', 'description', 'icon', 'route', 'permissions']) {
      if (pluginManifest[field] === undefined) fail(`${id}: manifest.plugin.json missing "${field}"`);
    }
    if (!KEBAB.test(id)) fail(`${id}: folder name is not kebab-case`);
  }

  const servicePath = join(dir, 'manifest.service.json');
  try {
    readFileSync(servicePath);
  } catch {
    continue; // Tier-A-only plugin, no sidecar — nothing more to check
  }
  const serviceManifest = readJson(servicePath);
  if (serviceManifest) {
    if (serviceManifest.kind !== 'service') fail(`${id}: manifest.service.json kind must be "service"`);
    if (!serviceManifest.bin) fail(`${id}: manifest.service.json missing "bin"`);
    const cargoToml = readFileSync(join(dir, 'sidecar', 'Cargo.toml'), 'utf-8');
    const binNameMatch = cargoToml.match(/\[\[bin\]\][^[]*name\s*=\s*"([^"]+)"/);
    if (binNameMatch && binNameMatch[1] !== serviceManifest.bin) {
      fail(`${id}: manifest.service.json's bin "${serviceManifest.bin}" != Cargo.toml's [[bin]] name "${binNameMatch[1]}"`);
    }
    if (pluginManifest && !Array.isArray(pluginManifest.service?.methods)) {
      fail(`${id}: manifest.plugin.json's service.methods must be an array`);
    } else if (pluginManifest && pluginManifest.service.methods.length === 0) {
      fail(`${id}: manifest.plugin.json's service.methods is empty`);
    }
  }
}

if (failed) {
  console.error('\nManifest lint failed.');
  process.exit(1);
}
console.log('Manifest lint passed.');
