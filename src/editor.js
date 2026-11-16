'use strict';
// The custom editor for .fbx, .dae and .3ds files. The extension host reads the model and the image files next to it
// through VS Code's file system API (so remote folders work the same) and hands the bytes to the webview, which draws
// the model with three.js. No network, no telemetry. It never reopens a tab in another editor by itself.
const vscode = require('vscode');
const path = require('path');
const F = require('./core/formats');
const { editorHtml } = require('./html');
const support = require('./support');

const VIEW_TYPE = 'fbxViewer.editor';
const PREFIX = 'fbxViewer';
const setting = (k, d) => vscode.workspace.getConfiguration(PREFIX).get(k, d);
const MAX_IMAGE_BYTES = 256 * F.MB; // texture bytes handed to one viewer
const MAX_SUBFOLDERS = 40;
// A plain Uint8Array view: a Node Buffer would go through Buffer.toJSON in postMessage and arrive as { type, data }.
const plain = (b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

/** Image files in the model's folder and in its direct subfolders (textures/, Textures/, maps/ ...): lower-case name -> uri. */
async function imageIndex(folder) {
  const out = new Map();
  const add = (dir, entries) => { for (const [name, type] of entries) if (type === vscode.FileType.File && F.IMAGE_EXT.test(name) && !out.has(name.toLowerCase())) out.set(name.toLowerCase(), { name, uri: vscode.Uri.joinPath(dir, name) }); };
  let top = [];
  try { top = await vscode.workspace.fs.readDirectory(folder); } catch (e) { return out; }
  add(folder, top);
  const subs = top.filter(([n, t]) => t === vscode.FileType.Directory && !n.startsWith('.') && n !== 'node_modules').slice(0, MAX_SUBFOLDERS);
  for (const [n] of subs) {
    const dir = vscode.Uri.joinPath(folder, n);
    try { add(dir, await vscode.workspace.fs.readDirectory(dir)); } catch (e) { /* unreadable folder */ }
  }
  return out;
}

class FbxEditorProvider {
  constructor(context, hooks = {}) {
    this.context = context;
    this.hooks = hooks;
    this.docs = new Set();
    this.active = null;
    this.activePanel = null;
    this.pending = new Map();
    this.reqN = 0;
    this._success = new WeakSet();
  }
  dispose() { this.docs.clear(); for (const p of this.pending.values()) p.resolve({ ok: false, error: 'The viewer was closed.' }); this.pending.clear(); }

  openCustomDocument(uri) {
    const doc = { uri, name: path.posix.basename(uri.path), ext: F.extOf(uri.path), panels: new Set(), rendered: null, failed: null, images: null, dispose: () => { this.docs.delete(doc); if (this.active === doc) this.active = null; } };
    this.docs.add(doc);
    return doc;
  }

  settings() {
    return { background: setting('background', 'theme'), upAxis: setting('upAxis', 'auto'), maxFileMB: setting('maxFileMB', 512) };
  }

  async resolveCustomEditor(doc, panel) {
    doc.panels.add(panel);
    const ext = this.context.extensionUri;
    const media = vscode.Uri.joinPath(ext, 'media');
    const lib = vscode.Uri.joinPath(ext, 'lib');
    const core = vscode.Uri.joinPath(ext, 'src', 'core');
    const reach = this.hooks.reach ? this.hooks.reach() : null;
    panel.webview.options = {
      enableScripts: true, localResourceRoots: [media, lib, core],
      enableCommandUris: (reach ? reach.commandIds() : []).concat(support.commandUris(PREFIX)),
    };
    const u = (base, f) => panel.webview.asWebviewUri(vscode.Uri.joinPath(base, f)).toString();
    panel.webview.html = editorHtml({
      cspSource: panel.webview.cspSource,
      scripts: [u(lib, 'three-bundle.js'), u(core, 'formats.js'), u(core, 'stats.js'), u(media, 'viewer.js')],
      styleUri: u(media, 'viewer.css'),
      title: doc.name,
      head: reach ? (n) => reach.headHtml(n) : undefined,
      showSupportLinks: setting('showSupportLinks', true) !== false,
    });
    if (reach) reach.attach(panel.webview, panel);
    const setActive = () => { if (panel.active) { this.active = doc; this.activePanel = panel; } };
    setActive();
    panel.onDidChangeViewState(setActive);
    panel.onDidDispose(() => { doc.panels.delete(panel); panel.disposed = true; if (this.activePanel === panel) { this.activePanel = null; if (this.active === doc) this.active = null; } });
    panel.webview.onDidReceiveMessage(async (m) => {
      if (reach && reach.onMessage(m)) return;
      if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
      try { await this.onMessage(doc, panel, m); } catch (e) { this.send(panel.webview, { type: 'hint', text: String((e && e.message) || e) }); }
    });
  }

  send(webview, msg) { try { const r = webview.postMessage(msg); if (r && r.then) r.then(undefined, () => false); } catch (e) { /* disposed */ } }

  async init(doc, panel) {
    const s = this.settings();
    let size = 0;
    try { size = (await vscode.workspace.fs.stat(doc.uri)).size; } catch (e) { /* reported below */ }
    const plan = F.sizePlan(size, s.maxFileMB);
    const base = { type: 'init', name: doc.name, ext: doc.ext, size, sizeText: F.fmtSize(size), plan, background: s.background, upAxis: s.upAxis };
    if (!plan.load) { this.send(panel.webview, base); return; }
    let bytes;
    try { bytes = await vscode.workspace.fs.readFile(doc.uri); } catch (e) {
      this.send(panel.webview, { ...base, plan: { load: false, message: `The file could not be read: ${(e && e.message) || e}` } });
      if (this.hooks.onFailure) this.hooks.onFailure(doc);
      return;
    }
    doc.images = await imageIndex(vscode.Uri.joinPath(doc.uri, '..'));
    this.send(panel.webview, { ...base, bytes: plain(bytes), images: [...doc.images.values()].map((x) => x.name) });
  }

  async sendImages(doc, panel, m) {
    const names = Array.isArray(m.names) ? m.names.filter((x) => typeof x === 'string').slice(0, 500) : [];
    const images = [];
    let total = 0;
    for (const n of names) {
      const hit = doc.images && doc.images.get(n.toLowerCase());
      if (!hit) continue;
      try {
        const st = await vscode.workspace.fs.stat(hit.uri);
        if (total + st.size > MAX_IMAGE_BYTES) break;
        const data = await vscode.workspace.fs.readFile(hit.uri);
        total += data.length;
        images.push({ name: hit.name, data: plain(data) });
      } catch (e) { /* unreadable: listed as missing */ }
    }
    this.send(panel.webview, { type: 'images', req: m.req, images });
  }

  async onMessage(doc, panel, m) {
    switch (m.type) {
      case 'ready': await this.init(doc, panel); return;
      case 'needImages': await this.sendImages(doc, panel, m); return;
      case 'rendered':
        doc.rendered = m.stats && typeof m.stats === 'object' ? m.stats : {};
        doc.failed = null;
        if (!this._success.has(doc)) { this._success.add(doc); if (this.hooks.onSuccess) this.hooks.onSuccess(doc); }
        return;
      case 'failed':
        doc.failed = String(m.reason || 'error');
        if (this.hooks.onFailure) this.hooks.onFailure(doc);
        return;
      case 'copy':
        if (typeof m.text === 'string') { await vscode.env.clipboard.writeText(m.text.slice(0, 100000)); this.send(panel.webview, { type: 'copied' }); }
        return;
      default:
        if (/Result$/.test(m.type) && typeof m.req === 'string' && this.pending.has(m.req)) {
          const p = this.pending.get(m.req);
          this.pending.delete(m.req);
          p.resolve(m);
        }
    }
  }

  /** Asks the viewer of panel to do a job (export, check, render); resolves with its answer. */
  request(panel, msg, ms = 120000) {
    const req = 'h' + (++this.reqN);
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.pending.delete(req); resolve({ ok: false, error: 'The viewer did not answer in time.' }); }, ms);
      this.pending.set(req, { resolve: (v) => { clearTimeout(t); resolve(v); } });
      this.send(panel.webview, { ...msg, req });
    });
  }

  /** The viewer showing uri (the active one first), or null. */
  panelFor(uri) {
    const key = uri.toString();
    if (this.active && this.active.uri.toString() === key && this.activePanel && !this.activePanel.disposed) return { doc: this.active, panel: this.activePanel };
    for (const d of this.docs) if (d.uri.toString() === key) for (const p of d.panels) if (!p.disposed) return { doc: d, panel: p };
    return null;
  }

  /** Opens uri in this viewer (or shows its tab) and waits until the model is drawn or failed. */
  async openAndWait(uri, ms = 60000) {
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const f = this.panelFor(uri);
      if (f && (f.doc.rendered || f.doc.failed)) return f;
      await new Promise((r) => setTimeout(r, 100));
    }
    return this.panelFor(uri);
  }
}

module.exports = { FbxEditorProvider, VIEW_TYPE, imageIndex };
