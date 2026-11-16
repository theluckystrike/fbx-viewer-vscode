// Writes the small sample models and test fixtures of this listing (our own work, MIT like the code):
//   samples/crate.fbx (FBX 7.4 ASCII, a textured crate with a "Spin" clip) + samples/crate.png
//   samples/lantern.dae (Collada 1.4.1, a lantern with a "Swing" clip and a glass texture) + samples/lantern-glass.png
//   samples/desk.3ds (3D Studio, a desk with a lamp, two materials, the top uses CRATE.PNG in 8.3 upper case)
//   test/fixtures/*: an FBX 6.1 ASCII and a 6.1 binary header, broken and empty files, a crate with a missing texture.
// samples/robot-arm.fbx (binary FBX 7.4 with a skeleton and two clips) comes from Blender: scripts/make-robot.py.
// usage: node scripts/make-samples.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const S = path.join(ROOT, 'samples');
const F = path.join(ROOT, 'test', 'fixtures');
fs.mkdirSync(S, { recursive: true });
fs.mkdirSync(F, { recursive: true });

// ---------- PNG ----------
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
}
function png(w, h, px) { // px(x, y) -> [r, g, b]
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const [r, g, b] = px(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
// crate: planks with dark gaps and a frame
fs.writeFileSync(path.join(S, 'crate.png'), png(128, 128, (x, y) => {
  const frame = x < 10 || x > 117 || y < 10 || y > 117;
  const gap = !frame && (y % 27) < 2;
  const grain = 18 * Math.sin(x * 0.21 + Math.sin(y * 0.09) * 3) + 8 * Math.sin(x * 1.3);
  if (gap) return [70, 45, 25];
  const base = frame ? [150, 98, 52] : [196, 142, 86];
  return base.map((c) => clamp(c + grain * (frame ? 0.5 : 1)));
}));
// lantern glass: warm radial glow
fs.writeFileSync(path.join(S, 'lantern-glass.png'), png(64, 64, (x, y) => {
  const d = Math.hypot(x - 32, y - 36) / 40;
  return [clamp(255 - d * 40), clamp(214 - d * 120), clamp(120 - d * 100)];
}));

// ---------- geometry helpers ----------
function box(sx, sy, sz, cx = 0, cy = 0, cz = 0) {
  // 6 faces x 4 corners, outward normals, UVs per face
  const F6 = [[[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]];
  const pos = [], nrm = [], uv = [], quads = [];
  for (const [n, u, v] of F6) {
    const b = pos.length / 3;
    for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(cx + (n[0] + a * u[0] + c * v[0]) * sx / 2, cy + (n[1] + a * u[1] + c * v[1]) * sy / 2, cz + (n[2] + a * u[2] + c * v[2]) * sz / 2);
      nrm.push(...n); uv.push((a + 1) / 2, (c + 1) / 2);
    }
    quads.push([b, b + 1, b + 2, b + 3]);
  }
  return { pos, nrm, uv, quads };
}
const fmt = (a) => a.map((v) => (Number.isInteger(v) ? String(v) : Number(v.toFixed(6)).toString())).join(',');

// ---------- FBX 7.4 ASCII ----------
function fbxAscii({ version = 7400, name, texture, textureRel, clip, note = '; Sample model by Zovo, MIT License' }) {
  const g = box(1, 1, 1, 0, 0.5, 0);
  const pvi = []; const nr = []; const uvi = [];
  for (const q of g.quads) { q.forEach((i, k) => { pvi.push(k === 3 ? -(i + 1) : i); nr.push(g.nrm[i * 3], g.nrm[i * 3 + 1], g.nrm[i * 3 + 2]); uvi.push(i); }); }
  const KT = 46186158000; // FBX time units per second
  const lines = [];
  const L = (s) => lines.push(s);
  L(`; FBX ${Math.floor(version / 1000)}.${(version / 100) % 10}.0 project file`);
  L(note);
  L('; ----------------------------------------------------');
  L('');
  L('FBXHeaderExtension:  {');
  L('\tFBXHeaderVersion: 1003');
  L(`\tFBXVersion: ${version}`);
  L('\tCreator: "Zovo sample script"');
  L('}');
  L('GlobalSettings:  {');
  L('\tVersion: 1000');
  L('\tProperties70:  {');
  L('\t\tP: "UpAxis", "int", "Integer", "",1');
  L('\t\tP: "UpAxisSign", "int", "Integer", "",1');
  L('\t\tP: "FrontAxis", "int", "Integer", "",2');
  L('\t\tP: "FrontAxisSign", "int", "Integer", "",1');
  L('\t\tP: "CoordAxis", "int", "Integer", "",0');
  L('\t\tP: "CoordAxisSign", "int", "Integer", "",1');
  L('\t\tP: "UnitScaleFactor", "double", "Number", "",1');
  L('\t}');
  L('}');
  L('Objects:  {');
  L(`\tGeometry: 1000, "Geometry::${name}Mesh", "Mesh" {`);
  L(`\t\tVertices: *${g.pos.length} {`); L(`\t\t\ta: ${fmt(g.pos)}`); L('\t\t} ');
  L(`\t\tPolygonVertexIndex: *${pvi.length} {`); L(`\t\t\ta: ${pvi.join(',')}`); L('\t\t} ');
  L('\t\tGeometryVersion: 124');
  L('\t\tLayerElementNormal: 0 {');
  L('\t\t\tVersion: 102'); L('\t\t\tName: ""'); L('\t\t\tMappingInformationType: "ByPolygonVertex"'); L('\t\t\tReferenceInformationType: "Direct"');
  L(`\t\t\tNormals: *${nr.length} {`); L(`\t\t\t\ta: ${fmt(nr)}`); L('\t\t\t} ');
  L('\t\t}');
  L('\t\tLayerElementUV: 0 {');
  L('\t\t\tVersion: 101'); L('\t\t\tName: "UVMap"'); L('\t\t\tMappingInformationType: "ByPolygonVertex"'); L('\t\t\tReferenceInformationType: "IndexToDirect"');
  L(`\t\t\tUV: *${g.uv.length} {`); L(`\t\t\t\ta: ${fmt(g.uv)}`); L('\t\t\t} ');
  L(`\t\t\tUVIndex: *${uvi.length} {`); L(`\t\t\t\ta: ${uvi.join(',')}`); L('\t\t\t} ');
  L('\t\t}');
  L('\t\tLayerElementMaterial: 0 {');
  L('\t\t\tVersion: 101'); L('\t\t\tName: ""'); L('\t\t\tMappingInformationType: "AllSame"'); L('\t\t\tReferenceInformationType: "IndexToDirect"');
  L('\t\t\tMaterials: *1 {'); L('\t\t\t\ta: 0'); L('\t\t\t} ');
  L('\t\t}');
  L('\t\tLayer: 0 {');
  L('\t\t\tVersion: 100');
  for (const t of ['LayerElementNormal', 'LayerElementMaterial', 'LayerElementUV']) { L('\t\t\tLayerElement:  {'); L(`\t\t\t\tType: "${t}"`); L('\t\t\t\tTypedIndex: 0'); L('\t\t\t}'); }
  L('\t\t}');
  L('\t}');
  L(`\tModel: 2000, "Model::${name}", "Mesh" {`);
  L('\t\tVersion: 232');
  L('\t\tProperties70:  {');
  L('\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",0,0,0');
  L('\t\t\tP: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0');
  L('\t\t\tP: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1');
  L('\t\t}');
  L('\t\tShading: T');
  L('\t\tCulling: "CullingOff"');
  L('\t}');
  L(`\tMaterial: 3000, "Material::${name}Wood", "" {`);
  L('\t\tVersion: 102'); L('\t\tShadingModel: "phong"'); L('\t\tMultiLayer: 0');
  L('\t\tProperties70:  {');
  L('\t\t\tP: "DiffuseColor", "Color", "", "A",0.9,0.8,0.7');
  L('\t\t\tP: "Shininess", "double", "Number", "",12');
  L('\t\t}');
  L('\t}');
  if (texture) {
    L(`\tTexture: 4000, "Texture::${name}Diffuse", "" {`);
    L('\t\tType: "TextureVideoClip"'); L('\t\tVersion: 202'); L(`\t\tTextureName: "Texture::${name}Diffuse"`);
    L(`\t\tFileName: "${texture}"`); L(`\t\tRelativeFilename: "${textureRel || texture}"`);
    L('\t}');
    L(`\tVideo: 5000, "Video::${name}Diffuse", "Clip" {`);
    L('\t\tType: "Clip"'); L(`\t\tFileName: "${texture}"`); L(`\t\tRelativeFilename: "${textureRel || texture}"`);
    L('\t}');
  }
  if (clip) {
    const keys = [0, 0.5, 1, 1.5, 2];
    L(`\tAnimationStack: 6000, "AnimStack::${clip}", "" {`);
    L('\t\tProperties70:  {'); L(`\t\t\tP: "LocalStop", "KTime", "Time", "",${2 * KT}`); L(`\t\t\tP: "ReferenceStop", "KTime", "Time", "",${2 * KT}`); L('\t\t}');
    L('\t}');
    L(`\tAnimationLayer: 6100, "AnimLayer::BaseLayer", "" {`); L('\t}');
    L(`\tAnimationCurveNode: 6200, "AnimCurveNode::R", "" {`);
    L('\t\tProperties70:  {'); L('\t\t\tP: "d|X", "Number", "", "A",0'); L('\t\t\tP: "d|Y", "Number", "", "A",0'); L('\t\t\tP: "d|Z", "Number", "", "A",0'); L('\t\t}');
    L('\t}');
    const curve = (id, vals) => {
      L(`\tAnimationCurve: ${id}, "AnimCurve::", "" {`);
      L('\t\tDefault: 0'); L('\t\tKeyVer: 4009');
      L(`\t\tKeyTime: *${keys.length} {`); L(`\t\t\ta: ${keys.map((t) => Math.round(t * KT)).join(',')}`); L('\t\t} ');
      L(`\t\tKeyValueFloat: *${keys.length} {`); L(`\t\t\ta: ${vals.join(',')}`); L('\t\t} ');
      L('\t\tKeyAttrFlags: *1 {'); L('\t\t\ta: 24840'); L('\t\t} ');
      L('\t\tKeyAttrDataFloat: *4 {'); L('\t\t\ta: 0,0,218434821,0'); L('\t\t} ');
      L(`\t\tKeyAttrRefCount: *1 {`); L(`\t\t\ta: ${keys.length}`); L('\t\t} ');
      L('\t}');
    };
    curve(6301, [0, 0, 0, 0, 0]);
    curve(6302, [0, 90, 180, 270, 360]);
    curve(6303, [0, 0, 0, 0, 0]);
  }
  L('}');
  L('Connections:  {');
  L('\tC: "OO",2000,0');
  L('\tC: "OO",1000,2000');
  L('\tC: "OO",3000,2000');
  if (texture) { L('\tC: "OP",4000,3000, "DiffuseColor"'); L('\tC: "OO",5000,4000'); }
  if (clip) {
    L('\tC: "OO",6100,6000'); L('\tC: "OO",6200,6100'); L('\tC: "OP",6200,2000, "Lcl Rotation"');
    L('\tC: "OP",6301,6200, "d|X"'); L('\tC: "OP",6302,6200, "d|Y"'); L('\tC: "OP",6303,6200, "d|Z"');
  }
  L('}');
  return lines.join('\n') + '\n';
}
fs.writeFileSync(path.join(S, 'crate.fbx'), fbxAscii({ name: 'Crate', texture: 'crate.png', clip: 'Spin' }));
// a crate whose texture was on the artist's computer: listed by name as missing
fs.writeFileSync(path.join(F, 'missing-texture.fbx'), fbxAscii({ name: 'Box', texture: 'C:\\\\Users\\\\artist\\\\textures\\\\box_albedo.png', textureRel: 'textures\\\\box_albedo.png', note: '; Written by the Zovo FBX Viewer sample script' }));
// FBX 6.1 (older than 7.0): ASCII header and a binary header
fs.writeFileSync(path.join(F, 'old-ascii-61.fbx'), '; FBX 6.1.0 project file\n; Copyright (C) 1997-2008 Autodesk Inc. and/or its licensors.\n; All rights reserved.\n; ----------------------------------------------------\n\nFBXHeaderExtension:  {\n\tFBXHeaderVersion: 1003\n\tFBXVersion: 6100\n\tCreator: "FBX SDK/FBX Plugins version 2010.2"\n}\nCreator: "FBX SDK/FBX Plugins version 2010.2"\n\nDefinitions:  {\n\tVersion: 100\n\tCount: 1\n}\nObjects:  {\n\tModel: "Model::Cube", "Mesh" {\n\t\tVersion: 232\n\t\tVertices: -1,-1,-1,1,-1,-1,1,1,-1\n\t\tPolygonVertexIndex: 0,1,-3\n\t}\n}\n');
{
  const head = Buffer.from('Kaydara FBX Binary  \0\x1a\0', 'latin1');
  const ver = Buffer.alloc(4); ver.writeUInt32LE(6100);
  fs.writeFileSync(path.join(F, 'old-binary-61.fbx'), Buffer.concat([head, ver, Buffer.alloc(160)]));
}
fs.writeFileSync(path.join(F, 'broken.fbx'), Buffer.from('This is not a 3D model, only a text file with an .fbx name.\n'));
fs.writeFileSync(path.join(F, 'empty.dae'), Buffer.alloc(0));
fs.writeFileSync(path.join(F, 'not-collada.dae'), '<?xml version="1.0"?>\n<note><to>Someone</to><body>An XML file with a .dae name</body></note>\n');

// ---------- Collada 1.4.1 ----------
function daeMesh(id, g) {
  const tris = [];
  for (const q of g.quads) tris.push([q[0], q[1], q[2]], [q[0], q[2], q[3]]);
  return `    <geometry id="${id}" name="${id}">
      <mesh>
        <source id="${id}-pos"><float_array id="${id}-pos-a" count="${g.pos.length}">${g.pos.map((v) => +v.toFixed(5)).join(' ')}</float_array>
          <technique_common><accessor source="#${id}-pos-a" count="${g.pos.length / 3}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
        <source id="${id}-nrm"><float_array id="${id}-nrm-a" count="${g.nrm.length}">${g.nrm.join(' ')}</float_array>
          <technique_common><accessor source="#${id}-nrm-a" count="${g.nrm.length / 3}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
        <source id="${id}-uv"><float_array id="${id}-uv-a" count="${g.uv.length}">${g.uv.join(' ')}</float_array>
          <technique_common><accessor source="#${id}-uv-a" count="${g.uv.length / 2}" stride="2"><param name="S" type="float"/><param name="T" type="float"/></accessor></technique_common></source>
        <vertices id="${id}-v"><input semantic="POSITION" source="#${id}-pos"/></vertices>
        <triangles material="mat" count="${tris.length}">
          <input semantic="VERTEX" source="#${id}-v" offset="0"/><input semantic="NORMAL" source="#${id}-nrm" offset="0"/><input semantic="TEXCOORD" source="#${id}-uv" offset="0" set="0"/>
          <p>${tris.flat().join(' ')}</p>
        </triangles>
      </mesh>
    </geometry>`;
}
function mat4RotZ(deg, ty) { // column-major rotation about Z with a translation in Y, written row by row
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0, 0, s, c, 0, ty, 0, 0, 1, 0, 0, 0, 0, 1].map((v) => +v.toFixed(6));
}
{
  const frame = box(0.6, 0.08, 0.6, 0, 0, 0);
  const glass = box(0.42, 0.7, 0.42, 0, -0.43, 0);
  const cap = box(0.5, 0.12, 0.5, 0, -0.84, 0);
  const times = [0, 0.75, 1.5, 2.25, 3];
  const angles = [0, 18, 0, -18, 0];
  const out = times.map((t, i) => mat4RotZ(angles[i], 1.6).join(' ')).join('  ');
  const dae = `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><contributor><authoring_tool>Zovo sample script</authoring_tool></contributor><created>2026-11-15T00:00:00</created><modified>2026-11-15T00:00:00</modified><unit name="meter" meter="1"/><up_axis>Y_UP</up_axis></asset>
  <library_images><image id="glass-img" name="glass-img"><init_from>lantern-glass.png</init_from></image></library_images>
  <library_effects>
    <effect id="metal-fx"><profile_COMMON><technique sid="common"><phong><diffuse><color>0.12 0.13 0.15 1</color></diffuse><specular><color>0.6 0.6 0.6 1</color></specular><shininess><float>30</float></shininess></phong></technique></profile_COMMON></effect>
    <effect id="glass-fx"><profile_COMMON>
      <newparam sid="glass-surface"><surface type="2D"><init_from>glass-img</init_from></surface></newparam>
      <newparam sid="glass-sampler"><sampler2D><source>glass-surface</source></sampler2D></newparam>
      <technique sid="common"><lambert><emission><color>0.25 0.18 0.05 1</color></emission><diffuse><texture texture="glass-sampler" texcoord="UVMap"/></diffuse></lambert></technique></profile_COMMON></effect>
  </library_effects>
  <library_materials>
    <material id="metal" name="LanternMetal"><instance_effect url="#metal-fx"/></material>
    <material id="glass" name="LanternGlass"><instance_effect url="#glass-fx"/></material>
  </library_materials>
  <library_geometries>
${daeMesh('frame-mesh', frame)}
${daeMesh('glass-mesh', glass)}
${daeMesh('cap-mesh', cap)}
  </library_geometries>
  <library_animations>
    <animation id="lantern-swing" name="Swing">
      <source id="swing-in"><float_array id="swing-in-a" count="${times.length}">${times.join(' ')}</float_array><technique_common><accessor source="#swing-in-a" count="${times.length}" stride="1"><param name="TIME" type="float"/></accessor></technique_common></source>
      <source id="swing-out"><float_array id="swing-out-a" count="${times.length * 16}">${out}</float_array><technique_common><accessor source="#swing-out-a" count="${times.length}" stride="16"><param name="TRANSFORM" type="float4x4"/></accessor></technique_common></source>
      <source id="swing-interp"><Name_array id="swing-interp-a" count="${times.length}">${times.map(() => 'LINEAR').join(' ')}</Name_array><technique_common><accessor source="#swing-interp-a" count="${times.length}" stride="1"><param name="INTERPOLATION" type="name"/></accessor></technique_common></source>
      <sampler id="swing-sampler"><input semantic="INPUT" source="#swing-in"/><input semantic="OUTPUT" source="#swing-out"/><input semantic="INTERPOLATION" source="#swing-interp"/></sampler>
      <channel source="#swing-sampler" target="Lantern/transform"/>
    </animation>
  </library_animations>
  <library_visual_scenes>
    <visual_scene id="scene" name="Scene">
      <node id="Lantern" name="Lantern" type="NODE">
        <matrix sid="transform">${mat4RotZ(0, 1.6).join(' ')}</matrix>
        <node id="Frame" name="Frame" type="NODE"><instance_geometry url="#frame-mesh"><bind_material><technique_common><instance_material symbol="mat" target="#metal"/></technique_common></bind_material></instance_geometry></node>
        <node id="Glass" name="Glass" type="NODE"><instance_geometry url="#glass-mesh"><bind_material><technique_common><instance_material symbol="mat" target="#glass"><bind_vertex_input semantic="UVMap" input_semantic="TEXCOORD" input_set="0"/></instance_material></technique_common></bind_material></instance_geometry></node>
        <node id="Cap" name="Cap" type="NODE"><instance_geometry url="#cap-mesh"><bind_material><technique_common><instance_material symbol="mat" target="#metal"/></technique_common></bind_material></instance_geometry></node>
      </node>
      <node id="Post" name="Post" type="NODE"><instance_geometry url="#frame-mesh"><bind_material><technique_common><instance_material symbol="mat" target="#metal"/></technique_common></bind_material></instance_geometry></node>
    </visual_scene>
  </library_visual_scenes>
  <scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>
`;
  fs.writeFileSync(path.join(S, 'lantern.dae'), dae);
}

// ---------- 3DS ----------
function ch(id, ...parts) {
  const body = Buffer.concat(parts);
  const h = Buffer.alloc(6); h.writeUInt16LE(id, 0); h.writeUInt32LE(6 + body.length, 2);
  return Buffer.concat([h, body]);
}
const cstr = (s) => Buffer.from(s + '\0', 'latin1');
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const f32s = (a) => { const b = Buffer.alloc(a.length * 4); a.forEach((v, i) => b.writeFloatLE(v, i * 4)); return b; };
function tdsObject(name, g, mat) {
  // 3DS is Z up: swap Y and Z of our Y-up boxes
  const v = []; for (let i = 0; i < g.pos.length; i += 3) v.push(g.pos[i], -g.pos[i + 2], g.pos[i + 1]);
  const faces = []; for (const q of g.quads) faces.push([q[0], q[1], q[2]], [q[0], q[2], q[3]]);
  const fb = Buffer.concat(faces.map((f) => Buffer.concat([u16(f[0]), u16(f[1]), u16(f[2]), u16(7)])));
  const matChunk = ch(0x4130, cstr(mat), u16(faces.length), Buffer.concat(faces.map((_, i) => u16(i))));
  return ch(0x4000, cstr(name), ch(0x4100,
    ch(0x4110, u16(v.length / 3), f32s(v)),
    ch(0x4140, u16(g.uv.length / 2), f32s(g.uv)),
    ch(0x4120, u16(faces.length), fb, matChunk),
    ch(0x4160, f32s([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]))));
}
function tdsMaterial(name, rgb, map) {
  return ch(0xafff, ch(0xa000, cstr(name)), ch(0xa020, ch(0x0011, Buffer.from(rgb))), ...(map ? [ch(0xa200, ch(0x0030, u16(100)), ch(0xa300, cstr(map)))] : []));
}
{
  const top = box(2.4, 0.08, 1.2, 0, 1.0, 0);
  const legs = [[-1.1, -0.5], [1.1, -0.5], [-1.1, 0.5], [1.1, 0.5]].map(([x, z]) => box(0.08, 1.0, 0.08, x, 0.5, z));
  const legGeo = { pos: [], nrm: [], uv: [], quads: [] };
  for (const l of legs) { const b = legGeo.pos.length / 3; legGeo.pos.push(...l.pos); legGeo.nrm.push(...l.nrm); legGeo.uv.push(...l.uv); legGeo.quads.push(...l.quads.map((q) => q.map((i) => i + b))); }
  const lampBase = box(0.3, 0.05, 0.3, 0.8, 1.065, -0.2);
  const lampPole = box(0.05, 0.6, 0.05, 0.8, 1.39, -0.2);
  const lampHead = box(0.34, 0.16, 0.22, 0.8, 1.72, -0.12);
  const lamp = { pos: [], nrm: [], uv: [], quads: [] };
  for (const l of [lampBase, lampPole, lampHead]) { const b = lamp.pos.length / 3; lamp.pos.push(...l.pos); lamp.nrm.push(...l.nrm); lamp.uv.push(...l.uv); lamp.quads.push(...l.quads.map((q) => q.map((i) => i + b))); }
  const file = ch(0x4d4d, ch(0x0002, u32(3)), ch(0x3d3d, ch(0x3d3e, u32(3)),
    tdsMaterial('DESKTOP', [205, 160, 110], 'CRATE.PNG'),
    tdsMaterial('STEEL', [60, 64, 72]),
    tdsMaterial('LAMPRED', [200, 40, 40]),
    ch(0x0100, f32s([1])),
    tdsObject('Top', top, 'DESKTOP'), tdsObject('Legs', legGeo, 'STEEL'), tdsObject('Lamp', lamp, 'LAMPRED')));
  fs.writeFileSync(path.join(S, 'desk.3ds'), file);
  fs.writeFileSync(path.join(F, 'cut.3ds'), file.subarray(0, Math.floor(file.length * 0.4)));
}
for (const f of fs.readdirSync(S).sort()) console.log('samples/' + f, fs.statSync(path.join(S, f)).size);
for (const f of fs.readdirSync(F).sort()) console.log('test/fixtures/' + f, fs.statSync(path.join(F, f)).size);
