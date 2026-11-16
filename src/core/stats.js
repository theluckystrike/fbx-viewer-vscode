// Model statistics from a three.js object tree (copied from the Zovo 3D Model Viewer and extended with bones, skinned
// meshes and clips). Works on any object with traverse(), so it runs in node tests too. In the webview this file
// loads as a plain script and sets globalThis.FbxCore.stats.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.FbxCore = root.FbxCore || {}; root.FbxCore.stats = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function triCount(geo, obj) {
    const pos = geo && geo.attributes && geo.attributes.position;
    if (!pos) return 0;
    if (obj && (obj.isPoints || obj.isLine)) return 0;
    const n = geo.index ? geo.index.count : pos.count;
    const dr = geo.drawRange && Number.isFinite(geo.drawRange.count) ? Math.min(geo.drawRange.count, n) : n;
    return Math.floor(dr / 3);
  }

  /** { meshes, skinned, vertices, triangles, materials, textures, bones, nodes, animations, lines, hasUVs, hasColors } */
  function sceneStats(root, animations) {
    const mats = new Set();
    const texs = new Set();
    const bones = new Set();
    const s = { meshes: 0, skinned: 0, vertices: 0, triangles: 0, lines: 0, materials: 0, textures: 0, bones: 0, nodes: 0, animations: (animations || []).length, hasColors: false, hasUVs: false };
    root.traverse((o) => {
      s.nodes++;
      if (o.isBone) bones.add(o);
      if (o.isSkinnedMesh && o.skeleton) for (const b of o.skeleton.bones) bones.add(b);
      if (o.isLine || o.isLineSegments) { s.lines++; return; }
      if (!o.geometry || !o.isMesh) return;
      const geo = o.geometry;
      const pos = geo.attributes && geo.attributes.position;
      if (!pos) return;
      s.meshes++;
      if (o.isSkinnedMesh) s.skinned++;
      s.vertices += pos.count;
      s.triangles += triCount(geo, o);
      if (geo.attributes.color) s.hasColors = true;
      if (geo.attributes.uv) s.hasUVs = true;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) {
        if (!m) continue;
        mats.add(m);
        for (const k of Object.keys(m)) { const v = m[k]; if (v && v.isTexture) texs.add(v); }
      }
    });
    s.materials = mats.size;
    s.textures = texs.size;
    s.bones = bones.size;
    return s;
  }

  function round(n) {
    if (!Number.isFinite(n)) return '?';
    const a = Math.abs(n);
    if (a === 0) return '0';
    if (a >= 1000) return n.toFixed(0);
    return String(Number(n.toPrecision(4)));
  }

  function fmtInt(n) { return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '?'; }

  /** "12.5 × 4 × 3.2 units" from a min/max box */
  function fmtDims(min, max, unit) {
    if (!min || !max || !Number.isFinite(min.x) || !Number.isFinite(max.x)) return 'empty';
    return `${round(max.x - min.x)} × ${round(max.y - min.y)} × ${round(max.z - min.z)} ${unit || 'units'}`;
  }

  /** Rows for the Model panel and for "Copy", one [name, value] each. */
  function statsRows(s) {
    const rows = [];
    const add = (k, v) => rows.push([k, String(v)]);
    add('Meshes', fmtInt(s.meshes));
    if (s.skinned) add('Skinned meshes', fmtInt(s.skinned));
    add('Vertices', fmtInt(s.vertices));
    add('Triangles', fmtInt(s.triangles));
    add('Materials', fmtInt(s.materials));
    add('Textures', fmtInt(s.textures));
    add('Bones', fmtInt(s.bones));
    add('Clips', fmtInt(s.animations));
    add('Nodes', fmtInt(s.nodes));
    return rows;
  }

  return { sceneStats, triCount, fmtDims, fmtInt, round, statsRows };
});
