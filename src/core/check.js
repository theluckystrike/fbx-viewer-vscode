// Asset check report (Zovo Pro): rules for game and AR pipelines, applied to the facts the viewer collected from the
// loaded model (triangles, textures, scales, normals, material slots, bones). Pure functions: no vscode, no DOM.
// In the webview this file loads as a plain script and sets globalThis.FbxCore.check.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.FbxCore = root.FbxCore || {}; root.FbxCore.check = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DEFAULTS = { triangleBudget: 100000, maxTextureSize: 2048, maxBonesPerMesh: 64 };
  const fmtInt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '?');
  const pow2 = (n) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

  function limitsOf(o) {
    const x = o || {};
    return { triangleBudget: num(x.triangleBudget, DEFAULTS.triangleBudget), maxTextureSize: num(x.maxTextureSize, DEFAULTS.maxTextureSize), maxBonesPerMesh: num(x.maxBonesPerMesh, DEFAULTS.maxBonesPerMesh) };
  }

  /**
   * data: { file: { name, format }, totals: { triangles, vertices, meshes, materials, textures, bones, clips },
   *         meshes: [{ name, triangles, vertices, bones, skinned, scale: [x, y, z], flipped, materials: [..], unusedSlots: [..] }],
   *         textures: [{ name, width, height, status: 'loaded' | 'missing' | 'embedded' | 'unsupported', usedBy: [..] }] }
   * Returns { file, limits, rows: [{ area, item, check, value, limit, result: 'ok' | 'warn' | 'fail', note }], counts }.
   */
  function buildReport(data, limitsIn) {
    const L = limitsOf(limitsIn);
    const d = data || {};
    const t = d.totals || {};
    const meshes = Array.isArray(d.meshes) ? d.meshes : [];
    const textures = Array.isArray(d.textures) ? d.textures : [];
    const rows = [];
    const add = (area, item, check, value, limit, result, note) => rows.push({ area, item: String(item || ''), check, value: String(value), limit: String(limit), result, note: note || '' });

    // polygon budget
    const tris = Number(t.triangles) || 0;
    add('Polygons', d.file && d.file.name ? d.file.name : 'model', 'Triangle budget', fmtInt(tris), fmtInt(L.triangleBudget), tris > L.triangleBudget ? 'fail' : 'ok',
      tris > L.triangleBudget ? `${fmtInt(tris - L.triangleBudget)} triangles over the budget.` : `${Math.round((tris / L.triangleBudget) * 100)}% of the budget.`);
    const byTris = meshes.slice().sort((a, b) => (b.triangles || 0) - (a.triangles || 0));
    for (const m of byTris) {
      const share = tris ? Math.round(((m.triangles || 0) / tris) * 100) : 0;
      add('Polygons', m.name, 'Triangles in this mesh', fmtInt(m.triangles || 0), '', 'ok', `${share}% of the model.`);
    }

    // textures
    if (!textures.length) add('Textures', '(none)', 'Texture files', '0', '', 'ok', 'The model uses no texture files.');
    for (const x of textures) {
      const used = x.usedBy && x.usedBy.length ? ` Used by ${x.usedBy.join(', ')}.` : '';
      if (x.status === 'missing') { add('Textures', x.name, 'File found', 'missing', 'present', 'fail', `Not found next to the model or in a textures folder beside it.${used}`); continue; }
      if (x.status === 'unsupported') { add('Textures', x.name, 'File found', 'not shown', 'present', 'warn', `This image type is not drawn by the viewer.${used}`); continue; }
      const w = Number(x.width) || 0, h = Number(x.height) || 0;
      const big = Math.max(w, h) > L.maxTextureSize;
      add('Textures', x.name, 'Texture size', w && h ? `${w} × ${h}` : '?', `${L.maxTextureSize} px`, big ? 'warn' : 'ok',
        (big ? `Larger than ${L.maxTextureSize} px; many mobile and AR targets downscale it.` : (x.status === 'embedded' ? 'Embedded in the model file.' : 'Found next to the model.')) + used);
      if (w && h && (!pow2(w) || !pow2(h))) add('Textures', x.name, 'Power-of-two size', `${w} × ${h}`, 'power of two', 'warn', 'Some engines and older GPUs resize textures that are not a power of two, or skip mipmaps.');
    }

    // per mesh: scale, normals, material slots, bones
    for (const m of meshes) {
      const s = Array.isArray(m.scale) ? m.scale.map(Number) : [1, 1, 1];
      const abs = s.map(Math.abs);
      const max = Math.max(...abs), min = Math.min(...abs);
      const scaleText = s.map((v) => String(Number(v.toPrecision(4)))).join(', ');
      if (s.some((v) => v < 0)) add('Transforms', m.name, 'Mirrored scale', scaleText, 'positive', 'warn', 'A negative scale mirrors the mesh; some engines flip its faces or normals.');
      if (max > 0 && (max - min) / max > 0.01) add('Transforms', m.name, 'Uniform scale', scaleText, 'x = y = z', 'warn', 'Non-uniform scale stretches normals and breaks some physics and bone setups. Apply the scale before export.');
      const faces = Number(m.triangles) || 0, flipped = Number(m.flipped) || 0;
      if (faces && flipped) {
        const all = flipped >= faces * 0.95;
        add('Normals', m.name, 'Normals match the winding', `${fmtInt(flipped)} of ${fmtInt(faces)} flipped`, '0', 'warn', all ? 'The whole mesh looks inside out: its stored normals point against the face order.' : 'Some faces have stored normals that point against the face order (flipped normals).');
      }
      if (Array.isArray(m.unusedSlots) && m.unusedSlots.length) add('Materials', m.name, 'Unused material slots', m.unusedSlots.join(', '), 'none', 'warn', 'These materials are assigned to the mesh but no face uses them.');
      if (m.skinned || m.bones) {
        const nb = Number(m.bones) || 0;
        add('Bones', m.name, 'Bones per mesh', fmtInt(nb), fmtInt(L.maxBonesPerMesh), nb > L.maxBonesPerMesh ? 'fail' : 'ok', nb > L.maxBonesPerMesh ? 'More bones than many GPU skinning setups allow in one draw call. Split the mesh or reduce the bones.' : '');
      }
    }
    const counts = { ok: 0, warn: 0, fail: 0 };
    for (const r of rows) counts[r.result]++;
    return { file: d.file || {}, totals: t, limits: L, rows, counts };
  }

  const mdCell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const RESULT = { ok: 'OK', warn: 'Warning', fail: 'Fail' };

  function toMarkdown(rep) {
    const f = rep.file || {}, t = rep.totals || {}, L = rep.limits || DEFAULTS;
    const out = [];
    out.push(`# Asset check: ${mdCell(f.name || 'model')}`, '');
    out.push(`Format: ${mdCell(f.format || '?')}. Meshes ${fmtInt(t.meshes)}, triangles ${fmtInt(t.triangles)}, vertices ${fmtInt(t.vertices)}, materials ${fmtInt(t.materials)}, textures ${fmtInt(t.textures)}, bones ${fmtInt(t.bones)}, clips ${fmtInt(t.clips)}.`, '');
    out.push(`Limits: ${fmtInt(L.triangleBudget)} triangles, textures up to ${L.maxTextureSize} px, ${L.maxBonesPerMesh} bones per mesh.`, '');
    out.push(`Result: ${rep.counts.fail} fail, ${rep.counts.warn} warning${rep.counts.warn === 1 ? '' : 's'}, ${rep.counts.ok} OK.`, '');
    out.push('| Area | Item | Check | Value | Limit | Result | Note |', '| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of rep.rows) out.push(`| ${[r.area, r.item, r.check, r.value, r.limit, RESULT[r.result], r.note].map(mdCell).join(' | ')} |`);
    return out.join('\n') + '\n';
  }

  const csvCell = (s) => { const v = String(s == null ? '' : s); return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  function toCsv(rep) {
    const out = ['area,item,check,value,limit,result,note'];
    for (const r of rep.rows) out.push([r.area, r.item, r.check, r.value, r.limit, r.result, r.note].map(csvCell).join(','));
    return out.join('\n') + '\n';
  }

  return { DEFAULTS, limitsOf, buildReport, toMarkdown, toCsv, pow2 };
});
