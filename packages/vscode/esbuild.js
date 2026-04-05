const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// Copy sqlite3 + its runtime deps into dist/native so they ship inside the VSIX
// (node_modules is git-ignored and vsce won't include it)
function copyNativeDeps() {
  const rootModules = path.resolve(__dirname, '../../node_modules');
  const nativeDir = path.resolve(__dirname, 'dist', 'native', 'node_modules');

  // Helper: recursive copy
  function copyDirSync(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, entry.name);
      const d = path.join(dest, entry.name);
      if (entry.isDirectory()) copyDirSync(s, d);
      else fs.copyFileSync(s, d);
    }
  }

  // Resolve package location — works with npm, yarn, AND pnpm
  function findPkg(name) {
    // 1. Direct node_modules (npm/yarn hoisted)
    const direct = path.join(rootModules, name);
    if (fs.existsSync(direct)) return direct;
    // 2. require.resolve fallback (pnpm symlinks, nested deps)
    try {
      const pkgJson = require.resolve(name + '/package.json', { paths: [__dirname, rootModules] });
      return path.dirname(pkgJson);
    } catch {}
    return null;
  }

  // Packages sqlite3 needs at runtime
  const packages = ['sqlite3', 'bindings', 'file-uri-to-path'];
  for (const pkg of packages) {
    const src = findPkg(pkg);
    if (src) {
      copyDirSync(src, path.join(nativeDir, pkg));
      console.log(`Copied ${pkg} to dist/native/`);
    } else {
      console.warn(`WARNING: ${pkg} not found — native module may fail at runtime`);
    }
  }

  // Also check for sqlite3's own node_modules (node-addon-api, @mapbox/node-pre-gyp)
  const sqlite3Mods = path.join(rootModules, 'sqlite3', 'node_modules');
  if (fs.existsSync(sqlite3Mods)) {
    copyDirSync(sqlite3Mods, path.join(nativeDir, 'sqlite3', 'node_modules'));
    console.log('Copied sqlite3 nested node_modules');
  }
}

copyNativeDeps();

esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode', 'sqlite3', 'bindings', 'file-uri-to-path', 'better-sqlite3', 'pg-native', 'oracledb', 'mysql2', 'mysql', 'mssql', 'mongodb', 'hdb-pool', '@sap/hana-client', 'react-native-sqlite-storage', 'sql.js', 'typeorm-aurora-data-api-driver'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: false,
  // Prepend module path setup so require('sqlite3') finds our dist/native copy
  banner: {
    js: `
      // Add dist/native/node_modules to module search path for sqlite3 native module
      const _mod = require('module');
      const _nativePath = require('path').join(__dirname, 'native', 'node_modules');
      if (!module.paths.includes(_nativePath)) { module.paths.unshift(_nativePath); }
    `,
  },
}).then(() => {
  console.log('Build successful!');
}).catch(() => process.exit(1));
