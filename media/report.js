// Asset check report panel (Zovo Pro). Draws the report the extension host sends; Save buttons ask the host to write
// Markdown or CSV. Plain script, no network. All text goes in with textContent.
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('report');
  const RESULT = { ok: 'OK', warn: 'Warning', fail: 'Fail' };
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-US') : '?');
  function show(rep, name) {
    root.textContent = '';
    const head = h('div', 'rhead');
    head.append(h('h1', '', `Asset check: ${name}`));
    const save = h('span', 'actions');
    for (const [as, label] of [['md', 'Save as Markdown'], ['csv', 'Save as CSV']]) {
      const b = h('button', '', label); b.type = 'button'; b.dataset.as = as;
      b.addEventListener('click', () => vscode.postMessage({ type: 'save', as }));
      save.append(b);
    }
    head.append(save);
    root.append(head);
    const t = rep.totals || {}, L = rep.limits || {};
    root.append(h('p', 'facts', `${rep.file.format || ''}. Meshes ${n(t.meshes)}, triangles ${n(t.triangles)}, vertices ${n(t.vertices)}, materials ${n(t.materials)}, textures ${n(t.textures)}, bones ${n(t.bones)}, clips ${n(t.clips)}.`));
    root.append(h('p', 'limits muted', `Limits: ${n(L.triangleBudget)} triangles, textures up to ${L.maxTextureSize} px, ${L.maxBonesPerMesh} bones per mesh (settings fbxViewer.assetCheck.*).`));
    const sum = h('p', 'summary');
    sum.append(h('span', 'pill fail', `${rep.counts.fail} fail`), h('span', 'pill warn', `${rep.counts.warn} warning${rep.counts.warn === 1 ? '' : 's'}`), h('span', 'pill ok', `${rep.counts.ok} OK`));
    root.append(sum);
    const table = h('table', 'rtable');
    const tr = h('tr');
    for (const c of ['Area', 'Item', 'Check', 'Value', 'Limit', 'Result', 'Note']) tr.append(h('th', '', c));
    const thead = h('thead'); thead.append(tr); table.append(thead);
    const tb = h('tbody');
    for (const r of rep.rows) {
      const row = h('tr', 'r-' + r.result);
      row.dataset.result = r.result;
      for (const v of [r.area, r.item, r.check, r.value, r.limit]) row.append(h('td', '', v));
      row.append(h('td', 'res', RESULT[r.result] || r.result));
      row.append(h('td', 'note', r.note));
      tb.append(row);
    }
    table.append(tb);
    root.append(table);
    root.append(h('p', 'saved muted', ''));
    requestAnimationFrame(() => vscode.postMessage({ type: 'shown', rows: rep.rows.length }));
  }
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'show' && m.rep) show(m.rep, m.name || '');
    if (m.type === 'saved') { const s = root.querySelector('.saved'); if (s) s.textContent = `Saved ${m.path}`; }
  });
  vscode.postMessage({ type: 'ready' });
})();
