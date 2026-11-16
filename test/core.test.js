'use strict';
// Core tests: file checks (FBX binary and ASCII 7.x, FBX 6.1 notes, Collada, 3DS, broken files), the ASCII prefix
// that keeps three.js from refusing a text FBX, texture names, the asset check rules, and the real loaders from the
// vendored three.js bundle on our samples (meshes, triangles, bones, clips, materials).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const F = require('../src/core/formats');
const C = require('../src/core/check');
const S = require('../src/core/stats');

const ROOT = path.join(__dirname, '..');
const rd = (rel) => fs.readFileSync(path.join(ROOT, rel));
const u8 = (b) => new Uint8Array(b.buffer, b.byteOffset, b.length);

// three.js in node: the bundle only needs a document for texture images (never decoded here)
globalThis.document = globalThis.document || { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {} }) };
require('../lib/three-bundle.js');
const { THREE, FBXLoader, TDSLoader } = globalThis.ZV;
const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
function manager(seen) { const m = new THREE.LoadingManager(); m.setURLModifier((u) => { seen.push(u); return 'data:image/png;base64,AA=='; }); return m; }
function facts(g) {
  const s = S.sceneStats(g, g.animations);
  const mats = new Set();
  g.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m.name)); });
  return { ...s, matNames: [...mats].sort(), clips: (g.animations || []).map((a) => `${a.name}:${a.duration.toFixed(2)}`) };
}

test('sniff: binary FBX 7.4 from Blender, with the version and the creator', () => {
  const r = F.sniff(u8(rd('samples/robot-arm.fbx')), 'fbx');
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'fbx-binary');
  assert.equal(r.version, 7400);
  assert.equal(r.versionText, '7.4');
  assert.match(r.creator, /Blender/);
});
test('sniff: ASCII FBX 7.4 sample', () => {
  const r = F.sniff(u8(rd('samples/crate.fbx')), 'fbx');
  assert.deepEqual([r.ok, r.kind, r.version, r.creator], [true, 'fbx-ascii', 7400, 'Zovo sample script']);
});
test('sniff: FBX 6.1 (ASCII and binary) is refused with a clear note and a way out, never a blank view', () => {
  for (const [f, kind] of [['test/fixtures/old-ascii-61.fbx', 'ASCII'], ['test/fixtures/old-binary-61.fbx', 'binary']]) {
    const r = F.sniff(u8(rd(f)), 'fbx');
    assert.equal(r.ok, false, f);
    assert.equal(r.old, true, f);
    assert.equal(r.version, 6100, f);
    assert.match(r.reason, new RegExp(`^This is an? ${kind} FBX 6\\.1 file \\(FBX version 6100\\)\\.`), f);
    assert.match(r.reason, /reads FBX 7\.0 and later/);
    assert.match(r.reason, /export it again as FBX 7\.4 or later/);
  }
});
test('sniff: broken, empty, cut and wrong files get plain reasons', () => {
  assert.match(F.sniff(u8(rd('test/fixtures/broken.fbx')), 'fbx').reason, /does not look like an FBX file/);
  assert.equal(F.sniff(new Uint8Array(0), 'dae').reason, 'This file is empty.');
  assert.match(F.sniff(u8(rd('test/fixtures/not-collada.dae')), 'dae').reason, /not a Collada document/);
  assert.match(F.sniff(u8(rd('test/fixtures/cut.3ds')), '3ds').reason, /cut off/);
  assert.match(F.sniff(Buffer.from('PK\x03\x04rest'), 'dae').reason, /ZIP package/);
  assert.match(F.sniff(Buffer.from('hello world'), '3ds').reason, /not a 3DS file/);
  assert.match(F.sniff(Buffer.concat([Buffer.from('Kaydara FBX Binary  \0\x1a\0', 'latin1'), Buffer.from([0xe8, 0x1c, 0, 0])]), 'fbx').reason, /cut off/);
  const dae = F.sniff(u8(rd('samples/lantern.dae')), 'dae');
  assert.deepEqual([dae.ok, dae.versionText, dae.creator], [true, '1.4.1', 'Zovo sample script']);
  assert.equal(F.sniff(u8(rd('samples/desk.3ds')), '3ds').versionText, '3');
});
test('extOf, baseName, sizePlan and fmtSize', () => {
  assert.equal(F.extOf('A/B/Robot.FBX'), 'fbx');
  assert.equal(F.extOf('x.3DS'), '3ds');
  assert.equal(F.extOf('x.obj'), null);
  assert.equal(F.baseName('C:\\Users\\artist\\textures\\Wood.PNG'), 'Wood.PNG');
  assert.equal(F.baseName('textures/wood%20dark.png?x=1'), 'wood dark.png');
  assert.equal(F.sizePlan(10, 512).load, true);
  const big = F.sizePlan(600 * F.MB, 512);
  assert.equal(big.load, false);
  assert.match(big.message, /up to 512\.0 MB/);
  assert.equal(F.fmtSize(1536), '1.5 KB');
});
test('the three.js text check refuses some valid ASCII FBX files; the prefix fixes it and the file then parses', () => {
  const text = rd('test/fixtures/missing-texture.fbx').toString('latin1');
  assert.equal(F.loaderSaysAscii(text), false);
  assert.throws(() => new FBXLoader(manager([])).parse(ab(rd('test/fixtures/missing-texture.fbx')), ''), /Unknown format/);
  const p = F.asciiPrefix(text);
  assert.ok(p.startsWith(';') && p.endsWith('\n'));
  assert.equal(F.loaderSaysAscii(p + text), true);
  const seen = [];
  const g = new FBXLoader(manager(seen)).parse(new TextEncoder().encode(p + text).buffer, '');
  assert.equal(facts(g).triangles, 12);
  assert.deepEqual(seen, ['box_albedo.png']);
  assert.equal(F.asciiPrefix(rd('samples/crate.fbx').toString('latin1')), '');
});
test('referencedImages finds the texture files a model names, case-insensitive (3DS 8.3 names)', () => {
  const files = ['crate.png', 'lantern-glass.png', 'other.jpg', 'notes.txt'];
  assert.deepEqual(F.referencedImages(rd('samples/crate.fbx'), files), ['crate.png']);
  assert.deepEqual(F.referencedImages(rd('samples/desk.3ds'), files), ['crate.png']);
  assert.deepEqual(F.referencedImages(rd('samples/lantern.dae'), files), ['lantern-glass.png']);
  assert.deepEqual(F.referencedImages(rd('samples/robot-arm.fbx'), files), []);
});

test('loader: robot-arm.fbx (binary 7.4): 3 meshes, 516 triangles, 4 bones, clips Wave and Turn', () => {
  const g = new FBXLoader(manager([])).parse(ab(rd('samples/robot-arm.fbx')), '');
  const f = facts(g);
  assert.equal(f.meshes, 3);
  assert.equal(f.skinned, 1);
  assert.equal(f.triangles, 516);
  assert.equal(f.bones, 4);
  assert.deepEqual(f.clips, ['Rig|Wave:1.96', 'Rig|Turn:1.46']);
  assert.deepEqual(f.matNames, ['ArmOrange', 'BasePaint', 'GripperSteel']);
  assert.deepEqual(S.statsRows(f).map((r) => r[0]), ['Meshes', 'Skinned meshes', 'Vertices', 'Triangles', 'Materials', 'Textures', 'Bones', 'Clips', 'Nodes']);
});
test('loader: crate.fbx (ASCII 7.4): 1 mesh, 12 triangles, the crate.png texture, clip Spin of 2 s', () => {
  const seen = [];
  const f = facts(new FBXLoader(manager(seen)).parse(ab(rd('samples/crate.fbx')), ''));
  assert.deepEqual([f.meshes, f.triangles, f.textures, f.bones], [1, 12, 1, 0]);
  assert.deepEqual(f.clips, ['Spin:2.00']);
  assert.deepEqual(seen, ['crate.png']);
});
test('loader: desk.3ds: 3 meshes, 96 triangles, 3 materials, the top asks for CRATE.PNG', () => {
  const seen = [];
  const f = facts(new TDSLoader(manager(seen)).parse(ab(rd('samples/desk.3ds')), ''));
  assert.deepEqual([f.meshes, f.triangles, f.materials], [3, 96, 3]);
  assert.deepEqual(f.matNames, ['DESKTOP', 'LAMPRED', 'STEEL']);
  assert.deepEqual(seen, ['CRATE.PNG']);
});

// ---------- asset check ----------
const DATA = {
  file: { name: 'hero.fbx', format: 'FBX binary 7.4' },
  totals: { meshes: 2, triangles: 150000, vertices: 90000, materials: 3, textures: 3, bones: 80, clips: 2 },
  meshes: [
    { name: 'Body', triangles: 120000, vertices: 70000, skinned: true, bones: 80, scale: [1, 1, 1], flipped: 0, unusedSlots: [] },
    { name: 'Shield', triangles: 30000, vertices: 20000, skinned: false, bones: 0, scale: [1, 2, 1], flipped: 30000, unusedSlots: ['OldMetal'] },
    { name: 'Mirror', triangles: 10, vertices: 8, scale: [-1, 1, 1], flipped: 3, unusedSlots: [] },
  ],
  textures: [
    { name: 'body_albedo.png', status: 'loaded', width: 4096, height: 4096, usedBy: ['Skin'] },
    { name: 'shield.png', status: 'loaded', width: 1000, height: 512, usedBy: ['Metal'] },
    { name: 'eyes.tga', status: 'missing', width: 0, height: 0, usedBy: ['Eyes'] },
  ],
};
test('asset check: budget, texture size and power of two, missing file, scale, mirrored, flipped normals, unused slots, bones', () => {
  const rep = C.buildReport(DATA, { triangleBudget: 100000, maxTextureSize: 2048, maxBonesPerMesh: 64 });
  const find = (check, item) => rep.rows.find((r) => r.check === check && (!item || r.item === item));
  assert.equal(find('Triangle budget').result, 'fail');
  assert.equal(find('Triangle budget').note, '50,000 triangles over the budget.');
  assert.equal(find('Triangles in this mesh', 'Body').note, '80% of the model.');
  assert.equal(find('Texture size', 'body_albedo.png').result, 'warn');
  assert.equal(find('Power-of-two size', 'shield.png').result, 'warn');
  assert.equal(find('Power-of-two size', 'body_albedo.png'), undefined);
  assert.equal(find('File found', 'eyes.tga').result, 'fail');
  assert.match(find('File found', 'eyes.tga').note, /Used by Eyes\./);
  assert.equal(find('Uniform scale', 'Shield').value, '1, 2, 1');
  assert.equal(find('Uniform scale', 'Body'), undefined);
  assert.equal(find('Mirrored scale', 'Mirror').result, 'warn');
  assert.match(find('Normals match the winding', 'Shield').note, /inside out/);
  assert.match(find('Normals match the winding', 'Mirror').note, /Some faces/);
  assert.equal(find('Unused material slots', 'Shield').value, 'OldMetal');
  assert.equal(find('Bones per mesh', 'Body').result, 'fail');
  assert.equal(find('Bones per mesh', 'Shield'), undefined);
  assert.deepEqual(rep.counts, { ok: 4, warn: 7, fail: 3 });
});
test('asset check: a clean small model passes; Markdown and CSV hold every row', () => {
  const rep = C.buildReport({ file: { name: 'crate.fbx', format: 'FBX ASCII 7.4' }, totals: { triangles: 12, meshes: 1 }, meshes: [{ name: 'Crate', triangles: 12, scale: [1, 1, 1] }], textures: [{ name: 'crate.png', status: 'loaded', width: 128, height: 128 }] }, {});
  assert.equal(rep.counts.fail + rep.counts.warn, 0);
  assert.deepEqual(rep.limits, C.DEFAULTS);
  const md = C.toMarkdown(rep);
  assert.match(md, /^# Asset check: crate\.fbx\n/);
  assert.match(md, /Result: 0 fail, 0 warnings, 3 OK\./);
  assert.equal(md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Area') && !l.startsWith('| ---')).length, rep.rows.length);
  const rep2 = C.buildReport(DATA, {});
  const csv = C.toCsv(rep2).trim().split('\n');
  assert.equal(csv[0], 'area,item,check,value,limit,result,note');
  assert.equal(csv.length, rep2.rows.length + 1);
  assert.ok(csv.some((l) => l.startsWith('Transforms,Shield,Uniform scale,"1, 2, 1",x = y = z,warn,')));
  assert.ok(C.toMarkdown(C.buildReport({ meshes: [{ name: 'a|b', triangles: 1 }] }, {})).includes('a\\|b'));
});
test('loader fix: UV and vertex color layers marked IndexToDirect without an index array (FBX SDK 2017 files) still open', () => {
  let t = rd('samples/crate.fbx').toString('latin1');
  t = t.replace(/\t\t\tUVIndex: \*\d+ \{\n\t\t\t\ta: [^\n]*\n\t\t\t\} \n/, '');
  assert.ok(!/UVIndex/.test(t));
  const colors = Array.from({ length: 24 }, () => '1,0.5,0.25,1').join(',');
  t = t.replace('\t\tLayerElementMaterial: 0 {', `\t\tLayerElementColor: 0 {\n\t\t\tVersion: 101\n\t\t\tName: "VertexColors"\n\t\t\tMappingInformationType: "ByPolygonVertex"\n\t\t\tReferenceInformationType: "IndexToDirect"\n\t\t\tColors: *96 {\n\t\t\t\ta: ${colors}\n\t\t\t} \n\t\t}\n\t\tLayerElementMaterial: 0 {`);
  t = t.replace('\t\t\t\tType: "LayerElementUV"', '\t\t\t\tType: "LayerElementUV"\n\t\t\t\tTypedIndex: 0\n\t\t\t}\n\t\t\tLayerElement:  {\n\t\t\t\tType: "LayerElementColor"');
  const g = new FBXLoader(manager([])).parse(new TextEncoder().encode(t).buffer, '');
  let geo = null;
  g.traverse((o) => { if (o.isMesh) geo = o.geometry; });
  assert.equal(S.triCount(geo), 12);
  assert.ok(geo.attributes.uv && geo.attributes.color);
  assert.ok(Array.from(geo.attributes.uv.array).every(Number.isFinite));
  assert.ok(/Zovo fix/.test(require('fs').readFileSync(path.join(ROOT, 'scripts/build-vendor.js'), 'utf8')));
});
