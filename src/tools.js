'use strict';
// The three Zovo Pro tools: Convert (GLB, glTF, OBJ, STL), Asset check report, Render export. Each asks
// pro.allowed() on every click, whatever the file, and calls pro.produced() only after its result exists (the converted
// file or PNG written, the report drawn in its panel), so Escape, Cancel or an error never uses the free try.
// Everything runs on this computer; files are written through VS Code's file system API.
const vscode = require('vscode');
const path = require('path');
const F = require('./core/formats');
const C = require('./core/check');
const { reportHtml } = require('./html');
const { VIEW_TYPE } = require('./editor');
const support = require('./support');

const PREFIX = 'fbxViewer';
const setting = (k, d) => vscode.workspace.getConfiguration(PREFIX).get(k, d);
const base = (uri) => path.posix.basename(uri.path);
const stem = (uri) => base(uri).replace(/\.[^.]+$/, '');
const sibling = (uri, name) => vscode.Uri.joinPath(uri, '..', name);
const shown = (uri) => (uri.scheme === 'file' ? uri.fsPath : uri.toString());

const FORMATS = [
  { id: 'glb', label: 'GLB', description: 'binary glTF 2.0: meshes, materials, textures and animation clips in one file', ext: 'glb', filter: 'GLB' },
  { id: 'gltf', label: 'glTF', description: 'glTF 2.0 JSON with the buffers and textures embedded, with animation clips', ext: 'gltf', filter: 'glTF' },
  { id: 'obj', label: 'OBJ', description: 'Wavefront OBJ with a .mtl material file (no bones or animation)', ext: 'obj', filter: 'OBJ' },
  { id: 'stl', label: 'STL', description: 'binary STL, triangles only, for 3D printing', ext: 'stl', filter: 'STL' },
];
const SIZES = [
  { label: 'Same as the view', w: 0, h: 0 },
  { label: '1920 × 1080', w: 1920, h: 1080 },
  { label: '2560 × 1440', w: 2560, h: 1440 },
  { label: '3840 × 2160', w: 3840, h: 2160 },
  { label: '1024 × 1024', w: 1024, h: 1024 },
  { label: '2048 × 2048', w: 2048, h: 2048 },
  { label: 'Custom size...', custom: true },
];

/** "1600x900", "1600 × 900" or "1600 900" -> { w, h }, or null. Sides 16 to 8192. */
function parseSize(s) {
  const m = /^\s*(\d{2,5})\s*(?:x|×|\*|,|\s)\s*(\d{2,5})\s*$/i.exec(String(s || ''));
  if (!m) return null;
  const w = Number(m[1]), h = Number(m[2]);
  return w >= 16 && h >= 16 && w <= 8192 && h <= 8192 ? { w, h } : null;
}

function createTools({ context, provider, pro, reach }) {
  let report = null; // the asset check panel

  /** The file a tool works on: the clicked or passed file, else the viewer in front. */
  function targetOf(uri) {
    if (uri && uri.scheme) return uri;
    // a click in the viewer's toolbar row: the viewer tab in front, then the viewer that was last in front
    try {
      const g = vscode.window.tabGroups && vscode.window.tabGroups.activeTabGroup;
      const input = g && g.activeTab && g.activeTab.input;
      if (input && input.viewType === VIEW_TYPE && input.uri) return input.uri;
    } catch (e) { /* older editor: fall back */ }
    if (provider.active) return provider.active.uri;
    return undefined;
  }
  /** The viewer for uri with its model drawn, or a message why not. */
  async function viewerFor(uri) {
    const f = await provider.openAndWait(uri);
    if (!f) { vscode.window.showErrorMessage(`${base(uri)} did not open in the FBX Viewer.`); return null; }
    if (!f.doc.rendered) {
      vscode.window.showErrorMessage(f.doc.failed === 'old' ? `${base(uri)} is an FBX file older than version 7.0, which the viewer cannot read. Export it again as FBX 7.4 or later first.` : `${base(uri)} could not be drawn, so the tool has nothing to work on. The note in the viewer says why.`);
      return null;
    }
    return f;
  }
  const noFile = () => { vscode.window.showInformationMessage('Open an FBX, DAE or 3DS model in the FBX Viewer first, or right-click one in the Explorer.'); };
  async function saveBytes(dest, data) { await vscode.workspace.fs.writeFile(dest, data instanceof Uint8Array ? data : new Uint8Array(data)); }

  // ---------- Convert ----------
  async function convert(uri, extra) {
    if (!(await pro.allowed('convert', extra))) return undefined;
    const target = targetOf(uri);
    if (!target) { noFile(); return undefined; }
    let fmt = extra && typeof extra.format === 'string' ? FORMATS.find((x) => x.id === extra.format) : null;
    if (!fmt) {
      const pick = await vscode.window.showQuickPick(FORMATS.map((x) => ({ label: x.label, description: x.description, fmt: x })), { ignoreFocusOut: true, title: `Convert ${base(target)}`, placeHolder: 'Save the model as' });
      if (!pick) return undefined;
      fmt = pick.fmt;
    }
    const f = await viewerFor(target);
    if (!f) return undefined;
    const res = await provider.request(f.panel, { type: 'export', format: fmt.id });
    if (!res.ok) { vscode.window.showErrorMessage(`Convert to ${fmt.label} failed: ${res.error}`); return undefined; }
    const dest = extra && extra.dest ? extra.dest : await vscode.window.showSaveDialog({ defaultUri: sibling(target, `${stem(target)}.${fmt.ext}`), filters: { [fmt.filter]: [fmt.ext] }, title: `Save ${base(target)} as ${fmt.label}`, saveLabel: 'Save' });
    if (!dest) return undefined;
    if (dest.toString() === target.toString()) { vscode.window.showErrorMessage('Choose another file name: the model itself is never overwritten.'); return undefined; }
    let data = res.data instanceof Uint8Array ? res.data : new Uint8Array(res.data || []);
    let mtlUri = null;
    if (fmt.id === 'obj' && res.mtl) {
      const mtlName = base(dest).replace(/\.[^.]+$/, '') + '.mtl';
      mtlUri = sibling(dest, mtlName);
      data = Buffer.concat([Buffer.from(`# Converted from ${base(target)} by FBX Viewer & DAE, 3DS Preview\nmtllib ${mtlName}\n`), Buffer.from(data)]);
      await saveBytes(mtlUri, res.mtl);
    }
    await saveBytes(dest, data);
    await pro.produced('convert');
    const msg = `Saved ${shown(dest)} (${F.fmtSize(data.length)}${mtlUri ? ` and ${base(mtlUri)}` : ''}). ${(res.notes || []).join(' ')}`.trim();
    provider.send(f.panel.webview, { type: 'hint', text: msg });
    return { dest, mtl: mtlUri, bytes: data.length, notes: res.notes || [] };
  }

  // ---------- Asset check report ----------
  function limits() {
    return C.limitsOf({ triangleBudget: setting('assetCheck.triangleBudget', 100000), maxTextureSize: setting('assetCheck.maxTextureSize', 2048), maxBonesPerMesh: setting('assetCheck.maxBonesPerMesh', 64) });
  }
  async function assetCheck(uri, extra) {
    if (!(await pro.allowed('assetCheck', extra))) return undefined;
    const target = targetOf(uri);
    if (!target) { noFile(); return undefined; }
    const f = await viewerFor(target);
    if (!f) return undefined;
    const res = await provider.request(f.panel, { type: 'check' });
    if (!res.ok) { vscode.window.showErrorMessage(`Asset check failed: ${res.error}`); return undefined; }
    const rep = C.buildReport(res.data, limits());
    if (report && !report.disposed) report.panel.dispose();
    const media = vscode.Uri.joinPath(context.extensionUri, 'media');
    const panel = vscode.window.createWebviewPanel(`${PREFIX}.assetCheck`, `Asset check: ${base(target)}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false }, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media], enableCommandUris: support.commandUris(PREFIX),
    });
    const r = { panel, disposed: false, counted: false, rep, uri: target };
    report = r;
    panel.onDidDispose(() => { r.disposed = true; });
    let resolveShown;
    const shownP = new Promise((res2) => { resolveShown = res2; });
    panel.webview.onDidReceiveMessage(async (m) => {
      if (!m || typeof m !== 'object' || r.disposed) return;
      if (m.type === 'ready') { panel.webview.postMessage({ type: 'show', rep, name: base(target) }); return; }
      if (m.type === 'shown') {
        if (!r.counted) { r.counted = true; await pro.produced('assetCheck'); }
        resolveShown(true);
        return;
      }
      if (m.type === 'save' && (m.as === 'md' || m.as === 'csv')) {
        const ext = m.as;
        const dest = await vscode.window.showSaveDialog({ defaultUri: sibling(target, `${stem(target)}.asset-check.${ext}`), filters: ext === 'md' ? { Markdown: ['md'] } : { CSV: ['csv'] }, title: `Save the asset check as ${ext === 'md' ? 'Markdown' : 'CSV'}` });
        if (!dest) return;
        await saveBytes(dest, Buffer.from(ext === 'md' ? C.toMarkdown(rep) : C.toCsv(rep), 'utf8'));
        panel.webview.postMessage({ type: 'saved', path: shown(dest) });
      }
    });
    panel.webview.html = reportHtml({
      cspSource: panel.webview.cspSource,
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'report.js')).toString(),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'viewer.css')).toString(),
      title: `Asset check: ${base(target)}`,
      showSupportLinks: setting('showSupportLinks', true) !== false,
    });
    await Promise.race([shownP, new Promise((res2) => setTimeout(res2, 15000))]);
    return { report: rep, panel };
  }

  // ---------- Render export ----------
  async function renderExport(uri, extra) {
    if (!(await pro.allowed('renderExport', extra))) return undefined;
    const target = targetOf(uri);
    if (!target) { noFile(); return undefined; }
    const f = await viewerFor(target);
    if (!f) return undefined;
    const o = extra && typeof extra === 'object' && !extra.scheme ? extra : {};
    let strip = o.strip;
    if (strip === undefined) {
      const clips = Number(f.doc.rendered.animations) || 0;
      if (clips) {
        const k = await vscode.window.showQuickPick([{ label: 'PNG image', description: 'the view as it is now', v: 0 }, { label: 'Animation frame strip', description: '8 frames of the playing clip in one PNG', v: 8 }], { ignoreFocusOut: true, title: `Render export: ${base(target)}`, placeHolder: 'What to render' });
        if (!k) return undefined;
        strip = k.v;
      } else strip = 0;
    }
    let size = o.width && o.height ? { w: o.width, h: o.height } : null;
    if (!size) {
      const items = (strip ? [{ label: '512 × 512', w: 512, h: 512 }, { label: '256 × 256', w: 256, h: 256 }, { label: '1024 × 1024', w: 1024, h: 1024 }, { label: 'Custom size...', custom: true }] : SIZES).map((x) => ({ ...x, description: x.custom ? 'width × height, up to 8192' : strip && !x.custom ? 'each frame' : '' }));
      const s = await vscode.window.showQuickPick(items, { ignoreFocusOut: true, title: `Render export: ${base(target)}`, placeHolder: strip ? 'Size of each frame' : 'Image size' });
      if (!s) return undefined;
      if (s.custom) {
        const v = await vscode.window.showInputBox({ ignoreFocusOut: true, title: 'Image size', prompt: 'Width × height in pixels, for example 1600x900', value: '1600x900', validateInput: (t) => (parseSize(t) ? null : 'Type two numbers from 16 to 8192, like 1600x900') });
        if (!v) return undefined;
        size = parseSize(v);
      } else size = { w: s.w, h: s.h };
    }
    let transparent = o.transparent;
    if (transparent === undefined) {
      const b = await vscode.window.showQuickPick([{ label: 'Transparent background', v: true }, { label: 'Background as shown', v: false }], { ignoreFocusOut: true, title: `Render export: ${base(target)}`, placeHolder: 'Background' });
      if (!b) return undefined;
      transparent = b.v;
    }
    const res = await provider.request(f.panel, { type: 'render', width: size.w, height: size.h, transparent: !!transparent, strip: strip || 0 });
    if (!res.ok) { vscode.window.showErrorMessage(`Render export failed: ${res.error}`); return undefined; }
    const name = strip ? `${stem(target)}.frames.png` : `${stem(target)}.render.png`;
    const dest = o.dest || await vscode.window.showSaveDialog({ defaultUri: sibling(target, name), filters: { 'PNG image': ['png'] }, title: 'Save the rendered image', saveLabel: 'Save' });
    if (!dest) return undefined;
    if (!/\.png$/i.test(dest.path) || dest.toString() === target.toString()) { vscode.window.showErrorMessage('Choose a file name that ends in .png. The model itself is never overwritten.'); return undefined; }
    const data = res.data instanceof Uint8Array ? res.data : new Uint8Array(res.data || []);
    await saveBytes(dest, data);
    await pro.produced('renderExport');
    provider.send(f.panel.webview, { type: 'hint', text: `Saved ${shown(dest)}: ${res.width} × ${res.height}${res.frames > 1 ? `, ${res.frames} frames of ${res.clip || 'the clip'}` : ''}${transparent ? ', transparent background' : ''}.` });
    return { dest, width: res.width, height: res.height, frames: res.frames, bytes: data.length };
  }

  return { convert, assetCheck, renderExport, get report() { return report; }, FORMATS };
}

module.exports = { createTools, parseSize, FORMATS };
