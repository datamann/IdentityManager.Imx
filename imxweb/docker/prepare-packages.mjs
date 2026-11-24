import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Run in the Docker build stage's working directory, before installing packages.
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const archiveNames = readdirSync('imx-modules').filter((name) => name.endsWith('.tgz'));
const bundledPackages = new Map();

for (const archiveName of archiveNames) {
  const archivePath = path.join('imx-modules', archiveName);
  const packageJson = execFileSync('tar', ['-xOf', archivePath, 'package/package.json'], { encoding: 'utf8' });
  const bundledManifest = JSON.parse(packageJson);

  if (!Object.hasOwn(manifest.optionalDependencies, bundledManifest.name)) {
    throw new Error(`Unexpected bundled package ${bundledManifest.name} in ${archiveName}`);
  }
  if (bundledPackages.has(bundledManifest.name)) {
    throw new Error(`Multiple archives provide ${bundledManifest.name}`);
  }

  bundledPackages.set(bundledManifest.name, `file:imx-modules/${archiveName}`);
}

for (const packageName of Object.keys(manifest.optionalDependencies)) {
  const archiveReference = bundledPackages.get(packageName);
  if (!archiveReference) {
    throw new Error(`Missing archive for ${packageName} in imx-modules`);
  }
  manifest.optionalDependencies[packageName] = archiveReference;
}

writeFileSync('package.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Using ${bundledPackages.size} bundled packages from imx-modules.`);
