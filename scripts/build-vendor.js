'use strict';
// Builds lib/three-bundle.js from scripts/vendor-entry.mjs (three.js and its add-ons, MIT). Only this vendor file is
// bundled: the extension code in src/ and media/ ships as plain files.
// One fix is applied to FBXLoader.js while bundling (PATCHES below): a vertex color or UV layer that says
// "IndexToDirect" but has no index array (files from FBX SDK 2017, for example) is read as "Direct" instead of
// stopping the whole file with "Cannot read properties of undefined (reading 'a')".
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const PATCHES = [
  ['const referenceType = ColorNode.ReferenceInformationType;', "const referenceType = ( ColorNode.ReferenceInformationType === 'IndexToDirect' && ! ColorNode.ColorIndex ) ? 'Direct' : ColorNode.ReferenceInformationType; // Zovo fix"],
  ['const referenceType = UVNode.ReferenceInformationType;', "const referenceType = ( UVNode.ReferenceInformationType === 'IndexToDirect' && ! UVNode.UVIndex ) ? 'Direct' : UVNode.ReferenceInformationType; // Zovo fix"],
];
const fbxFix = {
  name: 'fbx-fix',
  setup(b) {
    b.onLoad({ filter: /FBXLoader\.js$/ }, (args) => {
      let src = fs.readFileSync(args.path, 'utf8');
      for (const [from, to] of PATCHES) { if (!src.includes(from)) throw new Error('FBXLoader patch not found: ' + from); src = src.replace(from, to); }
      return { contents: src, loader: 'js' };
    });
  },
};
require('esbuild').build({
  entryPoints: [path.join(__dirname, 'vendor-entry.mjs')], outfile: path.join(root, 'lib', 'three-bundle.js'),
  bundle: true, minify: true, format: 'iife', platform: 'browser', target: 'chrome110', legalComments: 'none', logLevel: 'warning', plugins: [fbxFix],
  banner: { js: `/* three.js ${require(path.join(root, 'node_modules/three/package.json')).version} and add-ons, MIT License, Copyright 2010-2026 three.js authors; includes fflate (MIT); FBXLoader with one Zovo fix (see scripts/build-vendor.js). See lib/three-LICENSE.txt. */` },
}).then(() => console.log('lib/three-bundle.js', (fs.statSync(path.join(root, 'lib', 'three-bundle.js')).size / 1024).toFixed(0), 'KB'))
  .catch((e) => { console.error(e); process.exit(1); });
