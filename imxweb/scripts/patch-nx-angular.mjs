import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Nx 24.0.6 still imports an internal Architect path which Angular 22.3 no
// longer exports. Use the equivalent public entry point until Nx fixes it.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nxRoot = path.join(root, 'node_modules/nx');
const { version } = JSON.parse(readFileSync(path.join(nxRoot, 'package.json'), 'utf8'));
if (version !== '24.0.6') {
  throw new Error('Review the Angular Architect compatibility patch before changing Nx versions.');
}
const adapterPath = path.join(nxRoot, 'dist/src/adapter/ngcli-adapter.js');
const source = readFileSync(adapterPath, 'utf8');
const internalEntry = "'@angular-devkit/architect/node/index.js'";
const publicEntry = "'@angular-devkit/architect/node'";
if (source.includes(internalEntry)) {
  if (source.split(internalEntry).length !== 2) {
    throw new Error('Unexpected Nx adapter contents; compatibility patch was not applied.');
  }
  writeFileSync(adapterPath, source.replace(internalEntry, publicEntry));
  console.log('Applied Nx 24.0.6 / Angular 22.3 public Architect entry point patch.');
} else if (!source.includes(publicEntry)) {
  throw new Error('Nx adapter does not match the expected patched or original contents.');
}
