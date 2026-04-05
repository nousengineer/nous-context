const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// Copy sqlite3 native module into local node_modules for VSIX packaging
function copySqlite3() {
  const rootModules = path.resolve(__dirname, '../../node_modules');
  const localModules = path.resolve(__dirname, 'node_modules');
  const src = path.join(rootModules, 'sqlite3');
  const dest = path.join(localModules, 'sqlite3');

  if (!fs.existsSync(src)) {
    console.warn('WARNING: sqlite3 not found at', src);
    return;
  }

  // Create local node_modules/sqlite3 with native binding
  fs.mkdirSync(path.join(dest, 'lib'), { recursive: true });

  // Copy package.json, main js files
  for (const file of ['package.json', 'lib/sqlite3.js', 'lib/sqlite3-binding.js', 'lib/trace.js']) {
    const s = path.join(src, file);
    const d = path.join(dest, file);
    if (fs.existsSync(s)) {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
    }
  }

  // Copy native binary
  const bindingDir = path.join(dest, 'build', 'Release');
  fs.mkdirSync(bindingDir, { recursive: true });
  const nodeBin = path.join(src, 'build', 'Release', 'node_sqlite3.node');
  if (fs.existsSync(nodeBin)) {
    fs.copyFileSync(nodeBin, path.join(bindingDir, 'node_sqlite3.node'));
    console.log('Copied sqlite3 native binding');
  }

  // Copy napi-rs binding if it exists
  const bindings = path.join(src, 'lib', 'binding');
  if (fs.existsSync(bindings)) {
    copyDirSync(bindings, path.join(dest, 'lib', 'binding'));
    console.log('Copied sqlite3 binding directory');
  }

  // Copy sqlite3's own deps (node-addon-api, @mapbox/node-pre-gyp may be needed at runtime)
  const sqlite3Modules = path.join(src, 'node_modules');
  if (fs.existsSync(sqlite3Modules)) {
    copyDirSync(sqlite3Modules, path.join(dest, 'node_modules'));
    console.log('Copied sqlite3 node_modules');
  }

  // Copy 'bindings' package (required by sqlite3-binding.js)
  const bindingsPkg = path.join(rootModules, 'bindings');
  if (fs.existsSync(bindingsPkg)) {
    const bindingsDest = path.join(localModules, 'bindings');
    copyDirSync(bindingsPkg, bindingsDest);
    console.log('Copied bindings package');
  }

  // Copy 'file-uri-to-path' (dependency of bindings)
  const furiPkg = path.join(rootModules, 'file-uri-to-path');
  if (fs.existsSync(furiPkg)) {
    copyDirSync(furiPkg, path.join(localModules, 'file-uri-to-path'));
    console.log('Copied file-uri-to-path package');
  }
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

copySqlite3();

esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode', 'sqlite3', 'better-sqlite3', 'pg-native', 'oracledb', 'mysql2', 'mysql', 'mssql', 'mongodb', 'hdb-pool', '@sap/hana-client', 'react-native-sqlite-storage', 'sql.js', 'typeorm-aurora-data-api-driver'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: false,
}).then(() => {
  console.log('Build successful!');
}).catch(() => process.exit(1));
