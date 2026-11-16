'use strict';
// Extension tests with the vscode stub: listing, activation, the custom editor's messages (model bytes, the image files
// next to the model, rendered and failed), the three Pro tools with 1 free try each (the 2nd use opens the Pro panel,
// on the same file or another one, and after a reload), README, walkthrough and support links, webview CSP.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadExtension, tmpDir, cleanup } = require('./support/vscode-stub');
const { editorHtml, reportHtml } = require('../src/html');

const ROOT = path.join(__dirname, '..');
const SAMPLES = path.join(ROOT, 'samples');
const FIX = path.join(__dirname, 'fixtures');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = f(); if (v) return v; await tick(10); } return f(); };
test.after(() => cleanup());

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const STATS = { meshes: 3, skinned: 1, vertices: 400, triangles: 516, materials: 3, textures: 0, bones: 4, nodes: 12, animations: 2 };
/** A webview stand-in that answers like viewer.js: rendered after init (failed for refused files), and the Pro jobs. */
function fakePanel(behaviour = {}) {
  let onMsg;
  const posted = [];
  const panel = {
    posted, viewColumn: 1, active: true, jobs: [],
    webview: {
      options: {}, html: '', cspSource: 'vscode-resource:', asWebviewUri: (u) => u,
      postMessage: async (m) => { posted.push(m); setTimeout(() => answer(m), 0); return true; },
      onDidReceiveMessage: (f) => { onMsg = f; return { dispose() {} }; },
    },
    onDidChangeViewState: () => ({ dispose() {} }), onDidDispose: () => ({ dispose() {} }), reveal() {},
    send: (m) => onMsg(m),
  };
  function answer(m) {
    if (m.type === 'init') {
      if (behaviour.fail) panel.send({ type: 'failed', reason: behaviour.fail });
      else if (m.plan && m.plan.load) panel.send({ type: 'rendered', stats: { ...STATS, animations: behaviour.clips === undefined ? 2 : behaviour.clips } });
      return;
    }
    if (!['export', 'check', 'render'].includes(m.type)) return;
    panel.jobs.push(m);
    if (behaviour.error) { panel.send({ type: m.type + 'Result', req: m.req, ok: false, error: behaviour.error }); return; }
    if (m.type === 'export') panel.send({ type: 'exportResult', req: m.req, ok: true, data: new Uint8Array(Buffer.from(`${m.format} bytes`)), mtl: m.format === 'obj' ? new Uint8Array(Buffer.from('newmtl Wood\n')) : null, notes: [`${m.format} note.`] });
    if (m.type === 'check') panel.send({ type: 'checkResult', req: m.req, ok: true, data: { file: { name: 'x', format: 'FBX binary 7.4' }, totals: { triangles: 516, meshes: 1 }, meshes: [{ name: 'Arm', triangles: 516, scale: [1, 1, 1], skinned: true, bones: 4 }], textures: [{ name: 'gone.png', status: 'missing', usedBy: ['Paint'] }] } });
    if (m.type === 'render') panel.send({ type: 'renderResult', req: m.req, ok: true, data: new Uint8Array(PNG), width: m.width || 800, height: m.height || 600, frames: m.strip || 1, clip: 'Wave' });
  }
  return panel;
}

const activated = [];
function activate(folder, state, behaviour) {
  const s = loadExtension();
  if (folder) s.vscode.workspace.workspaceFolders = [{ uri: s.vscode.Uri.file(folder), name: 'ws' }];
  if (state) for (const [k, v] of state) s.state.set(k, v);
  s.api = s.ext.activate(s.context);
  activated.push(s);
  // the asset check panel answers "show" with "shown" like the real panel does after drawing
  s.log.onPost = (panel, m) => { if (m.type === 'show' && m.rep) panel.send({ type: 'shown' }); };
  s.opened = [];
  s.behaviour = behaviour || {};
  s.commands.set('vscode.openWith', async (uri, viewType) => {
    s.opened.push([uri.fsPath, viewType]);
    if (viewType !== 'fbxViewer.editor') return undefined;
    const prov = s.api.provider;
    for (const d of prov.docs) if (d.uri.toString() === uri.toString() && d.panels.size) { prov.active = d; prov.activePanel = [...d.panels][0]; return undefined; }
    const e = await openEditor(s, uri.fsPath, s.behaviour);
    prov.active = e.doc; prov.activePanel = e.panel;
    return undefined;
  });
  return s;
}
test.after(() => { for (const s of activated) s.api.provider.dispose(); });

async function openEditor(s, file, behaviour) {
  const prov = s.api.provider;
  const doc = prov.openCustomDocument(s.vscode.Uri.file(file));
  const panel = fakePanel(behaviour);
  await prov.resolveCustomEditor(doc, panel);
  await panel.send({ type: 'ready' });
  const init = panel.posted.find((m) => m.type === 'init');
  await until(() => doc.rendered || doc.failed || (init && !init.plan.load), 2000);
  return { prov, doc, panel, init };
}
function ws() {
  const dir = tmpDir('fbx-ws-');
  for (const f of fs.readdirSync(SAMPLES)) fs.copyFileSync(path.join(SAMPLES, f), path.join(dir, f));
  for (const f of fs.readdirSync(FIX)) fs.copyFileSync(path.join(FIX, f), path.join(dir, f));
  fs.mkdirSync(path.join(dir, 'textures'));
  fs.writeFileSync(path.join(dir, 'textures', 'box_albedo.png'), PNG);
  fs.writeFileSync(path.join(dir, 'textures', 'crate.png'), PNG); // same name as the top-level file: the top-level one wins
  fs.copyFileSync(path.join(SAMPLES, 'desk.3ds'), path.join(dir, 'DESK2.3DS'));
  return dir;
}
const U = (s, dir, f) => s.vscode.Uri.file(path.join(dir, f));
const proPanels = (s, title) => s.log.info.filter((m) => m.text === `${title} is part of Zovo Pro.`);

// ---------- package.json and listing ----------
test('listing: display name with the phrase first, 30 characters or less, description starts with the phrase, 5 keywords, engines', () => {
  assert.equal(pkg.displayName, 'FBX Viewer & DAE, 3DS Preview');
  assert.ok(pkg.displayName.length <= 30);
  assert.match(pkg.description, /^FBX viewer/);
  assert.deepEqual(pkg.keywords, ['fbx', 'collada', '3d viewer', '3d model', 'game assets']);
  assert.equal(pkg.engines.vscode, '^1.75.0');
  assert.equal(pkg.publisher, 'zovo');
  assert.equal(pkg.name, 'zovo-fbx-viewer');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.repository.url, 'https://github.com/theluckystrike/fbx-viewer-vscode');
  assert.deepEqual(pkg.activationEvents, ['onUri']);
  assert.equal(pkg.main, './src/extension.js');
  const icon = fs.readFileSync(path.join(ROOT, 'icon.png'));
  assert.deepEqual([icon.readUInt32BE(16), icon.readUInt32BE(20)], [128, 128]);
});
test('editors: .fbx, .dae and .3ds by default; none of the model viewer patterns (.stl .obj .ply .glb .gltf .3mf)', () => {
  const ed = pkg.contributes.customEditors;
  assert.equal(ed.length, 1);
  assert.equal(ed[0].priority, 'default');
  assert.deepEqual(ed[0].selector.map((s) => s.filenamePattern), ['*.fbx', '*.dae', '*.3ds']);
  const raw = JSON.stringify(pkg.contributes);
  for (const e of ['stl', 'obj', 'ply', 'glb', 'gltf', '3mf']) assert.ok(!new RegExp(`\\*\\.${e}"`).test(raw), e);
  assert.ok(!pkg.contributes.languages && !pkg.contributes.grammars && !pkg.contributes.themes);
});
test('menus: one backslash before the dot in the final package.json; the right-click regex matches upper case; no title on menu items', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
  assert.ok(raw.includes('/\\\\.(fbx|dae|3ds)$/i'));
  assert.ok(!raw.includes('\\\\\\\\.'));
  const items = Object.values(pkg.contributes.menus).flat();
  assert.ok(items.every((m) => !('title' in m)));
  const ctx = pkg.contributes.menus['explorer/context'].find((m) => m.command === 'fbxViewer.zovoPro.convert');
  const re = new RegExp(/resourceFilename =~ \/(.*)\/i/.exec(ctx.when)[1], 'i');
  for (const f of ['ROBOT.FBX', 'a.fbx', 'duck.dae', 'TEST.DAE', 'desk.3ds', 'FELS.3DS']) assert.ok(re.test(f), f);
  for (const f of ['a.obj', 'a.stl', 'a.fbx.txt', 'a.glb']) assert.ok(!re.test(f), f);
  const wrappers = pkg.contributes.commands.filter((c) => /\.zovoPro\./.test(c.command));
  assert.equal(wrappers.length, 3);
  assert.ok(wrappers.every((c) => c.title.startsWith('Zovo Pro: ')));
  for (const w of wrappers) assert.ok(pkg.contributes.menus.commandPalette.some((m) => m.command === w.command && m.when === 'false'));
});
test('every contributed command is registered, and every registered fbxViewer command is contributed', () => {
  const s = activate();
  const contributed = pkg.contributes.commands.map((c) => c.command);
  for (const c of contributed) assert.ok(s.commands.has(c), c);
  for (const c of s.commands.keys()) if (c.startsWith('fbxViewer.')) assert.ok(contributed.includes(c), c);
});
test('activation shows nothing: no message, no panel, no editor, no status text', () => {
  const s = activate();
  assert.equal(s.log.info.length + s.log.warn.length + s.log.error.length, 0);
  assert.equal(s.log.panel, undefined);
  assert.equal(s.opened.length, 0);
  assert.equal(s.log.status.length, 0);
});

// ---------- the viewer ----------
test('viewer: robot-arm.fbx gets its bytes, the folder images and the settings; rating success once after it rendered', async () => {
  const dir = ws();
  const s = activate(dir);
  let ok = 0;
  s.api.provider.hooks.onSuccess = () => { ok++; };
  const e = await openEditor(s, path.join(dir, 'robot-arm.fbx'));
  assert.equal(e.init.ext, 'fbx');
  assert.equal(e.init.plan.load, true);
  assert.equal(e.init.bytes.length, fs.statSync(path.join(SAMPLES, 'robot-arm.fbx')).size);
  assert.ok(e.init.bytes instanceof Uint8Array && !Buffer.isBuffer(e.init.bytes)); // a Buffer would reach the webview as { type, data }
  assert.deepEqual([...e.init.images].sort(), ['box_albedo.png', 'crate.png', 'lantern-glass.png']);
  assert.equal(e.init.background, 'theme');
  assert.equal(e.init.upAxis, 'auto');
  assert.ok(e.doc.rendered);
  await e.panel.send({ type: 'rendered', stats: STATS });
  assert.equal(ok, 1);
  assert.match(e.panel.webview.html, /three-bundle\.js/);
  assert.ok(e.panel.webview.options.localResourceRoots.every((r) => /(media|lib|core)$/.test(r.fsPath)));
});
test('viewer: image bytes for the names the model uses, from the folder or its textures/ subfolder; unknown names are skipped', async () => {
  const dir = ws();
  const s = activate(dir);
  const e = await openEditor(s, path.join(dir, 'missing-texture.fbx'));
  await e.panel.send({ type: 'needImages', req: 'w1', names: ['BOX_ALBEDO.PNG', 'crate.png', 'nothing.png', 42] });
  const r = await until(() => e.panel.posted.find((m) => m.type === 'images' && m.req === 'w1'));
  assert.deepEqual(r.images.map((i) => i.name), ['box_albedo.png', 'crate.png']);
  assert.equal(r.images[1].data.length, fs.statSync(path.join(dir, 'crate.png')).size);
});
test('viewer: a file over the size limit is not read and gets a message', async () => {
  const dir = ws();
  const s = activate(dir);
  s.config.maxFileMB = 0.001;
  const e = await openEditor(s, path.join(dir, 'robot-arm.fbx'));
  assert.equal(e.init.plan.load, false);
  assert.equal(e.init.bytes, undefined);
  assert.match(e.init.plan.message, /The file was not read\./);
});
test('viewer: a refused file (old FBX) counts as a failure for the rating, and copy goes to the clipboard', async () => {
  const dir = ws();
  const s = activate(dir);
  let bad = 0;
  s.api.provider.hooks.onFailure = () => { bad++; };
  const e = await openEditor(s, path.join(dir, 'old-ascii-61.fbx'), { fail: 'old' });
  assert.equal(e.doc.failed, 'old');
  assert.equal(bad, 1);
  await e.panel.send({ type: 'copy', text: 'Format\tFBX ASCII 6.1' });
  assert.equal(s.log.clipboard, 'Format\tFBX ASCII 6.1');
});
test('webview HTML: strict CSP, nonce scripts, no remote URLs, no connect, worker or frame sources', () => {
  for (const html of [editorHtml({ cspSource: 'vscode-resource:', scripts: ['a.js', 'b.js'], styleUri: 's.css', title: 'x<y', nonce: 'N' }), reportHtml({ cspSource: 'vscode-resource:', scriptUri: 'r.js', styleUri: 's.css', title: 't', nonce: 'N' })]) {
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
    assert.match(csp, /^default-src 'none'; /);
    assert.match(csp, /script-src 'nonce-N'(;|$)/);
    assert.doesNotMatch(csp, /connect-src|worker-src|frame-src|unsafe-eval|https?:/);
    assert.equal((html.match(/<script /g) || []).length, (html.match(/<script nonce="N"/g) || []).length);
    assert.doesNotMatch(html.replace(/https:\/\/marketplace\.visualstudio\.com[^"]*/g, ''), /https?:\/\//);
  }
});
test('no source or media file opens a network connection or uses eval', () => {
  const files = ['media/viewer.js', 'media/report.js', ...fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js')).map((f) => 'src/' + f), ...fs.readdirSync(path.join(ROOT, 'src/core')).map((f) => 'src/core/' + f)];
  for (const f of files) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(t, /\bfetch\(|XMLHttpRequest|new WebSocket|require\(['"](https?|net|http2|tls)['"]\)|\beval\(/, f);
  }
});
test('vendored three.js: the MIT license ships next to it and the version is the one in the notices', () => {
  const head = fs.readFileSync(path.join(ROOT, 'lib/three-bundle.js'), 'utf8').slice(0, 300);
  const ver = /three\.js (\d+\.\d+\.\d+)/.exec(head)[1];
  assert.equal(ver, pkg.devDependencies.three);
  assert.match(fs.readFileSync(path.join(ROOT, 'lib/three-LICENSE.txt'), 'utf8'), /The MIT License/);
  const notices = fs.readFileSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8');
  assert.ok(notices.includes(`three.js ${ver}`));
  assert.match(notices, /fflate/);
});

// ---------- Pro tools ----------
test('Pro Convert: GLB written next to the model after the save, then the try counts once', async () => {
  const dir = ws();
  const s = activate(dir);
  const a = U(s, dir, 'robot-arm.fbx');
  s.ui.quick.push((items) => items.find((i) => i.label === 'GLB'));
  s.ui.save.push(U(s, dir, 'out/robot-arm.glb'));
  const r = await s.api.tools.convert(a);
  assert.equal(fs.readFileSync(path.join(dir, 'out/robot-arm.glb'), 'utf8'), 'glb bytes');
  assert.deepEqual(r.notes, ['glb note.']);
  assert.equal(s.api.pro.left('convert'), 0);
  assert.ok(s.log.status.some((t) => /free try 1 of 1 of "Convert to GLB, glTF, OBJ, STL"/.test(t)));
  assert.deepEqual(s.log.lastPick.items.map((i) => i.label), ['GLB', 'glTF', 'OBJ', 'STL']);
  assert.equal(s.log.lastPick.opts.ignoreFocusOut, true);
});
test('Pro Convert: OBJ gets its .mtl next to it and a mtllib line', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.save.push(U(s, dir, 'crate-out.obj'));
  await s.api.tools.convert(U(s, dir, 'crate.fbx'), { format: 'obj' });
  assert.match(fs.readFileSync(path.join(dir, 'crate-out.obj'), 'utf8'), /^# Converted from crate\.fbx by FBX Viewer & DAE, 3DS Preview\nmtllib crate-out\.mtl\nobj bytes$/);
  assert.equal(fs.readFileSync(path.join(dir, 'crate-out.mtl'), 'utf8'), 'newmtl Wood\n');
});
test('Pro Convert A then B: used on file A, the click on file B opens the Pro panel and nothing is asked or written', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.save.push(U(s, dir, 'a.stl'));
  await s.api.tools.convert(U(s, dir, 'robot-arm.fbx'), { format: 'stl' });
  assert.equal(s.api.pro.left('convert'), 0);
  const e = await openEditor(s, path.join(dir, 'lantern.dae'));
  const r = await s.api.tools.convert(U(s, dir, 'lantern.dae'));
  assert.equal(r, undefined);
  assert.equal(proPanels(s, 'Convert to GLB, glTF, OBJ, STL').length, 1);
  assert.equal(e.panel.jobs.length, 0);
  await s.api.tools.convert(U(s, dir, 'robot-arm.fbx'), { format: 'stl' });
  assert.equal(proPanels(s, 'Convert to GLB, glTF, OBJ, STL').length, 2);
});
test('Pro Convert: Escape in the format pick, a cancelled save or an export error uses no try', async () => {
  const dir = ws();
  const s = activate(dir);
  assert.equal(await s.api.tools.convert(U(s, dir, 'robot-arm.fbx')), undefined); // no pick
  assert.equal(await s.api.tools.convert(U(s, dir, 'robot-arm.fbx'), { format: 'glb' }), undefined); // no save target
  s.behaviour.error = 'boom';
  await s.api.tools.convert(U(s, dir, 'crate.fbx'), { format: 'glb' });
  assert.ok(s.log.error.some((m) => /Convert to GLB failed: boom/.test(m.text)));
  assert.equal(s.api.pro.left('convert'), 1);
});
test('Pro tools on a file the viewer refused (FBX 6.1) say why and use no try', async () => {
  const dir = ws();
  const s = activate(dir, null, { fail: 'old' });
  assert.equal(await s.api.tools.assetCheck(U(s, dir, 'old-ascii-61.fbx')), undefined);
  assert.ok(s.log.error.some((m) => /older than version 7\.0/.test(m.text)));
  assert.equal(s.api.pro.left('assetCheck'), 1);
});
test('Pro Asset check: the report panel shows, the try counts after it showed, Markdown and CSV are saved', async () => {
  const dir = ws();
  const s = activate(dir);
  const r = await s.api.tools.assetCheck(U(s, dir, 'robot-arm.fbx'));
  assert.equal(r.report.counts.fail, 1);
  assert.ok(r.report.rows.some((x) => x.item === 'gone.png' && x.result === 'fail'));
  await until(() => s.api.pro.left('assetCheck') === 0);
  const p = s.api.tools.report.panel;
  assert.match(p.webview.html, /media[\\/]report\.js/);
  s.ui.save.push(U(s, dir, 'check.md'));
  await p.send({ type: 'save', as: 'md' });
  assert.match(fs.readFileSync(path.join(dir, 'check.md'), 'utf8'), /^# Asset check: x\n/);
  s.ui.save.push(U(s, dir, 'check.csv'));
  await p.send({ type: 'save', as: 'csv' });
  assert.equal(fs.readFileSync(path.join(dir, 'check.csv'), 'utf8').split('\n')[0], 'area,item,check,value,limit,result,note');
  assert.equal(s.api.pro.left('assetCheck'), 0);
});
test('Pro Asset check A then B: after one report, the check of another file opens the Pro panel, no new report', async () => {
  const dir = ws();
  const s = activate(dir);
  await s.api.tools.assetCheck(U(s, dir, 'robot-arm.fbx'));
  await until(() => s.api.pro.left('assetCheck') === 0);
  const first = s.api.tools.report;
  assert.equal(await s.api.tools.assetCheck(U(s, dir, 'desk.3ds')), undefined);
  assert.equal(proPanels(s, 'Asset check report').length, 1);
  assert.equal(s.api.tools.report, first);
});
test('Pro Render export: PNG at a picked size with a transparent background; try counted after the PNG was written', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.quick.push((items) => items.find((i) => i.label === 'PNG image'));
  s.ui.quick.push((items) => items.find((i) => i.label === '1920 × 1080'));
  s.ui.quick.push((items) => items.find((i) => i.label === 'Transparent background'));
  s.ui.save.push(U(s, dir, 'shot.png'));
  const r = await s.api.tools.renderExport(U(s, dir, 'robot-arm.fbx'));
  assert.deepEqual([r.width, r.height], [1920, 1080]);
  const f = s.api.provider.panelFor(U(s, dir, 'robot-arm.fbx'));
  assert.deepEqual(f.panel.jobs[0], { type: 'render', width: 1920, height: 1080, transparent: true, strip: 0, req: f.panel.jobs[0].req });
  assert.deepEqual(fs.readFileSync(path.join(dir, 'shot.png')), PNG);
  assert.equal(s.api.pro.left('renderExport'), 0);
});
test('Pro Render export: a frame strip with a custom frame size; a model without clips skips the strip question', async () => {
  const dir = ws();
  const s = activate(dir, null, { clips: 0 });
  s.ui.quick.push((items) => { assert.equal(items[0].label, 'Same as the view'); return items.find((i) => i.custom); });
  s.ui.input.push('640 x 480');
  s.ui.quick.push((items) => items[1]);
  s.ui.save.push(U(s, dir, 'desk.png'));
  const r = await s.api.tools.renderExport(U(s, dir, 'desk.3ds'));
  assert.deepEqual([r.width, r.height, r.frames], [640, 480, 1]);
  const s2 = activate(dir);
  s2.ui.save.push(U(s2, dir, 'strip.png'));
  const r2 = await s2.api.tools.renderExport(U(s2, dir, 'robot-arm.fbx'), { strip: 8, width: 256, height: 256, transparent: false });
  assert.equal(r2.frames, 8);
  const { parseSize } = require('../src/tools'); // after activate(): the stub serves the vscode module
  assert.deepEqual(parseSize('1600x900'), { w: 1600, h: 900 });
  assert.deepEqual(parseSize('100 × 50'), { w: 100, h: 50 });
  assert.equal(parseSize('9000x10'), null);
});
test('Pro Render export A then B: used on the robot, the render of another file opens the Pro panel', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.save.push(U(s, dir, 'a.png'));
  await s.api.tools.renderExport(U(s, dir, 'robot-arm.fbx'), { strip: 0, width: 800, height: 600, transparent: true });
  assert.equal(await s.api.tools.renderExport(U(s, dir, 'crate.fbx'), { strip: 0, width: 800, height: 600, transparent: true }), undefined);
  assert.equal(proPanels(s, 'Render export').length, 1);
  assert.ok(!fs.existsSync(path.join(dir, 'crate.render.png')));
});
test('a window reload keeps the counts: after a reload every used tool opens the Pro panel', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.save.push(U(s, dir, 'a.glb'));
  await s.api.tools.convert(U(s, dir, 'robot-arm.fbx'), { format: 'glb' });
  await s.api.tools.assetCheck(U(s, dir, 'robot-arm.fbx'));
  await until(() => s.api.pro.left('assetCheck') === 0);
  const s2 = activate(dir, s.state);
  assert.deepEqual(s2.api.pro.tries(), { convert: 0, assetCheck: 0, renderExport: 1 });
  assert.equal(await s2.api.tools.convert(U(s2, dir, 'crate.fbx'), { format: 'glb' }), undefined);
  assert.equal(await s2.api.tools.assetCheck(U(s2, dir, 'crate.fbx')), undefined);
  assert.equal(proPanels(s2, 'Convert to GLB, glTF, OBJ, STL').length, 1);
  assert.equal(proPanels(s2, 'Asset check report').length, 1);
  assert.match(s2.api.provider.hooks.reach().rowHtml(), /0 tries left/);
});
test('the Pro panel names the other tools with their tries and no URL is opened when it is cancelled', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.save.push(U(s, dir, 'a.png'));
  await s.api.tools.renderExport(U(s, dir, 'robot-arm.fbx'), { strip: 0, width: 400, height: 300, transparent: false });
  await s.api.tools.renderExport(U(s, dir, 'robot-arm.fbx'), { strip: 0, width: 400, height: 300, transparent: false });
  const p = proPanels(s, 'Render export')[0];
  assert.ok(p && p.opts.modal);
  assert.match(p.opts.detail, /You used the free try of Render export on this computer\./);
  assert.match(p.opts.detail, /Convert to GLB, glTF, OBJ, STL: 0 of 1 free try used/);
  assert.match(p.opts.detail, /Asset check report: 0 of 1 free try used/);
  assert.equal(s.log.external.length, 0);
});
test('toolbar and Explorer entries run the tools: a toolbar link works on the viewer in front, the Explorer entry on the clicked file', async () => {
  const dir = ws();
  const s = activate(dir);
  await openEditor(s, path.join(dir, 'crate.fbx'));
  s.api.provider.active = [...s.api.provider.docs].find((d) => d.name === 'crate.fbx');
  s.api.provider.activePanel = [...s.api.provider.active.panels][0];
  s.ui.quick.push((items) => items.find((i) => i.label === 'STL'));
  s.ui.save.push(U(s, dir, 'tb.stl'));
  await s.commands.get('fbxViewer.convert')({ surface: 'toolbar' });
  assert.equal(fs.readFileSync(path.join(dir, 'tb.stl'), 'utf8'), 'stl bytes');
  await s.commands.get('fbxViewer.zovoPro.assetCheck')(U(s, dir, 'DESK2.3DS'), [U(s, dir, 'DESK2.3DS')]);
  await until(() => s.api.pro.left('assetCheck') === 0);
  assert.match(s.api.tools.report.panel.title, /DESK2\.3DS/);
});
test('the toolbar row lists the 3 Pro tools with 1 free try each; one constant; the proinfo tries key matches', () => {
  const s = activate();
  const reachCfg = require('../src/reach-config');
  assert.deepEqual(reachCfg.tools.map((t) => t.id), ['convert', 'assetCheck', 'renderExport']);
  const pro = require('../src/pro');
  assert.equal(pro.TRIAL_USES, 1);
  const cfg = require('../src/license/config');
  assert.equal(cfg.listing, 'fbx');
  assert.equal(cfg.pro_info.triesKey, pro.TRIAL_KEY);
  assert.equal(reachCfg.triesKey, pro.TRIAL_KEY);
  assert.equal(cfg.pro_info.triesMax, undefined);
  assert.deepEqual(cfg.pro_info.tools.map((t) => t.id), ['convert', 'assetCheck', 'renderExport']);
  assert.deepEqual(cfg.pro_info.tools.map((t) => t.title), Object.values(pro.FEATURES).map((f) => f.title));
  const row = s.api.provider.hooks.reach().rowHtml();
  assert.equal((row.match(/<small>1 free try<\/small>/g) || []).length, 3);
  assert.match(row, /Get Zovo Pro/);
});

// ---------- README and text ----------
test('README: first screen has the main use, a screenshot of this product, the free list and the price; by Zovo; no rival names', () => {
  const md = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const first = md.split('\n').slice(0, 32).join('\n');
  assert.match(first, /^# FBX Viewer & DAE, 3DS Preview/);
  assert.match(first, /\(images\/screenshot\.png\)/);
  assert.match(first, /Zovo Pro: USD 19 once/);
  assert.match(md, /by Zovo/i);
  for (const f of ['README.md', 'CHANGELOG.md', 'package.json', 'walkthrough/inspect.md', 'walkthrough/animate.md', 'walkthrough/related.md']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /vscode-3dviewer|slevesque|mesh-viewer|kiui|FiLL|tatsy|3d-preview|Autodesk FBX Review|Blender (add-on|addon)/i, f);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'images', 'screenshot.png')));
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8'), /^images\/?(\*\*|\*\.png|screenshot)?\s*$/m);
});
test('support links name this listing and related Zovo tools; walkthrough cross-sells listings that exist', () => {
  const support = require('../src/support');
  assert.equal(support.SELF_ID, 'zovo.zovo-fbx-viewer');
  assert.ok(support.RELATED.length >= 3 && !support.RELATED.includes(support.SELF_ID));
  assert.equal(support.PRO.getPro, 'fbxViewer.getPro');
  const steps = pkg.contributes.walkthroughs[0].steps;
  const links = steps.flatMap((st) => [...st.description.matchAll(/command:extension\.open\?%5B%22([^%]+)%22%5D/g)].map((m) => m[1]));
  assert.deepEqual(links, ['zovo.3d-model-viewer', 'zovo.zovo-texture-viewer', 'zovo.zovo-usd-viewer']);
  for (const st of steps) if (st.media.markdown) assert.ok(fs.existsSync(path.join(ROOT, st.media.markdown)), st.media.markdown);
});
test('a toolbar click works on the viewer tab in front, even when another viewer was the last one marked active', async () => {
  const dir = ws();
  const s = activate(dir);
  await openEditor(s, path.join(dir, 'robot-arm.fbx'));
  const crate = await openEditor(s, path.join(dir, 'crate.fbx'));
  s.api.provider.active = [...s.api.provider.docs].find((d) => d.name === 'robot-arm.fbx');
  s.api.provider.activePanel = [...s.api.provider.active.panels][0];
  s.vscode.window.tabGroups = { activeTabGroup: { activeTab: { input: { viewType: 'fbxViewer.editor', uri: crate.doc.uri } } } };
  s.ui.quick.push((items) => items.find((i) => i.label === 'STL'));
  s.ui.save.push(U(s, dir, 'front.stl'));
  await s.commands.get('fbxViewer.convert')({ surface: 'toolbar' }, undefined);
  assert.equal(crate.panel.jobs.length, 1);
  assert.ok(s.opened.some(([f]) => f.endsWith('crate.fbx')));
});
