'use strict';

/**
 * FindAnything - Native Prebuild Stager
 * --------------------------------------
 * better-sqlite3 is a native Node module whose binary must match BOTH the
 * target OS and Electron's Node ABI. When cross-building (e.g. building
 * the Windows installer from Linux, or macOS DMGs from CI), the locally
 * compiled .node file is wrong for the target.
 *
 * This script downloads the official prebuilt binaries published by the
 * better-sqlite3 project for Electron v133 (Electron 35) and stages them
 * into node_modules before electron-builder packs the app.
 *
 * Usage:
 *   node build/stage-prebuilds.js <platform> <arch>
 *   platform: win32 | darwin | linux
 *   arch:     x64 | arm64
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const BS3_VERSION = require('../node_modules/better-sqlite3/package.json').version;
const ELECTRON_ABI = 'v133'; // Electron 35.x

function main() {
  const platform = process.argv[2] || process.platform;
  const arch = process.argv[3] || os.arch();

  if (platform === process.platform && arch === os.arch()) {
    console.log(`Native build matches host (${platform}-${arch}); no staging needed.`);
    return;
  }

  const url =
    `https://github.com/WiseLibs/better-sqlite3/releases/download/` +
    `v${BS3_VERSION}/better-sqlite3-v${BS3_VERSION}-electron-${ELECTRON_ABI}-${platform}-${arch}.tar.gz`;

  console.log(`Staging better-sqlite3 prebuild for ${platform}-${arch}`);
  console.log(`  ${url}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bs3-prebuild-'));
  const tarball = path.join(tmp, 'prebuild.tar.gz');

  execSync(`curl -sfL -o "${tarball}" "${url}"`, { stdio: 'inherit' });
  execSync(`tar xzf "${tarball}" -C "${tmp}"`, { stdio: 'inherit' });

  const staged = path.join(tmp, 'build', 'Release', 'better_sqlite3.node');
  const destDir = path.join(
    __dirname, '..', 'node_modules', 'better-sqlite3', 'build', 'Release'
  );
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(staged, path.join(destDir, 'better_sqlite3.node'));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('  staged OK ->', destDir);
}

main();
