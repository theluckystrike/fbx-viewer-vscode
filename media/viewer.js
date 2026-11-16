// FBX Viewer & DAE, 3DS Preview: the 3D view in the webview (three.js from lib/three-bundle.js). Plain script, no
// network: the model and its textures come from the extension host as bytes, textures become blob: URLs.
// The viewer code is adapted from the Zovo 3D Model Viewer (STL, OBJ, glTF). All DOM text goes in with textContent.
(function () {
  'use strict';
  const { THREE, OrbitControls, FBXLoader, ColladaLoader, TDSLoader, TGALoader, GLTFExporter, OBJExporter, STLExporter, VertexNormalsHelper, RoomEnvironment } = window.ZV;
  const F = window.FbxCore.formats;
  const S = window.FbxCore.stats;
  const vscode = acquireVsCodeApi();
  const MAX_NORMALS = 250000;
  const MAX_TREE = 3000;
  const BACKGROUNDS = { dark: 0x1e1f22, light: 0xf2f2f2 };
  const PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12O4e+cOAAUAAo0BzWKSxAAAAABJRU5ErkJggg==';
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat()) if (c != null) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return e;
  }

  // ---------- layout ----------
  const app = document.getElementById('app');
  app.textContent = '';
  const ui = {};
  const state = { grid: true, axes: false, wireframe: false, normals: false, bounds: false, skeleton: false, playing: true, loop: true, speed: 1, loaded: false };
  const btn = (label, title, on, extra = {}) => h('button', { type: 'button', title, onclick: on, ...extra, text: label });
  const toggle = (label, title, key) => { const b = btn(label, title, () => setToggle(key, !state[key]), { 'aria-pressed': 'false', 'data-toggle': key }); ui['t_' + key] = b; return b; };
  ui.fit = btn('Fit', 'Fit the model in view (F)', () => fitView(), { id: 'fit' });
  ui.bg = h('select', { id: 'bg', 'aria-label': 'Background', title: 'Background' },
    h('option', { value: 'theme', text: 'Background: theme' }), h('option', { value: 'dark', text: 'Background: dark' }), h('option', { value: 'light', text: 'Background: light' }));
  ui.up = h('select', { id: 'up', 'aria-label': 'Up axis', title: 'Which model axis points up' }, h('option', { value: 'y', text: 'Y up' }), h('option', { value: 'z', text: 'Z up' }));
  ui.panelBtn = btn('Panel', 'Show or hide the model panel (P)', () => { ui.side.hidden = !ui.side.hidden; ui.panelBtn.setAttribute('aria-pressed', String(!ui.side.hidden)); resize(); }, { 'aria-pressed': 'true', id: 'panelBtn' });
  ui.toolbar = h('div', { class: 'toolbar', id: 'toolbar', role: 'toolbar', 'aria-label': 'Viewer' },
    ui.fit, h('span', { class: 'sep' }),
    toggle('Grid', 'Ground grid (G)', 'grid'), toggle('Axes', 'Axes: X red, Y green, Z blue (A)', 'axes'), toggle('Wireframe', 'Wireframe (W)', 'wireframe'),
    toggle('Normals', 'Vertex normals (N)', 'normals'), toggle('Bounds', 'Bounding box (B)', 'bounds'), toggle('Skeleton', 'Bones (K)', 'skeleton'),
    h('span', { class: 'sep' }), ui.bg, ui.up, h('span', { class: 'sep' }), ui.panelBtn);

  ui.clip = h('select', { id: 'clip', 'aria-label': 'Animation clip', title: 'Animation clip' });
  ui.play = btn('Pause', 'Play or pause (Space)', () => setPlaying(!state.playing), { id: 'play' });
  ui.time = h('input', { id: 'time', type: 'range', min: '0', max: '1', step: '0.001', value: '0', 'aria-label': 'Animation time' });
  ui.timeText = h('span', { class: 'timetext', id: 'timeText', text: '0.00 s' });
  ui.speed = h('select', { id: 'speed', 'aria-label': 'Speed', title: 'Playback speed' }, ...[0.25, 0.5, 1, 1.5, 2].map((v) => h('option', { value: String(v), text: `${v}×` })));
  ui.speed.value = '1';
  ui.loop = h('input', { id: 'loop', type: 'checkbox', 'aria-label': 'Loop' });
  ui.loop.checked = true;
  ui.anim = h('div', { class: 'animbar', id: 'animbar', hidden: true }, h('span', { class: 'label', text: 'Clip' }), ui.clip, ui.play, ui.time, ui.timeText, ui.speed, h('label', { class: 'chk' }, ui.loop, ' Loop'));

  ui.stage = h('div', { class: 'stage', id: 'stage' });
  ui.notice = h('div', { class: 'notice', id: 'notice', role: 'alert', hidden: true });
  ui.stage.append(ui.notice);
  ui.stats = h('div', { class: 'stats', id: 'stats' });
  ui.tree = h('div', { class: 'tree', id: 'tree', role: 'tree', 'aria-label': 'Scene tree' });
  ui.mats = h('div', { class: 'list', id: 'materials' });
  ui.texs = h('div', { class: 'list', id: 'textures' });
  ui.copy = h('button', { type: 'button', class: 'link', title: 'Copy the model facts as tab-separated text', text: 'Copy', onclick: () => copyStats() });
  ui.side = h('aside', { class: 'side', id: 'side' },
    h('section', {}, h('h2', {}, 'Model ', ui.copy), ui.stats),
    h('section', {}, h('h2', { text: 'Scene' }), ui.tree),
    h('section', {}, h('h2', { text: 'Materials' }), ui.mats),
    h('section', {}, h('h2', { text: 'Textures' }), ui.texs));
  ui.status = h('div', { class: 'status' }, ui.hint = h('span', { class: 'hint', id: 'hint' }), h('span', { class: 'grow' }), ui.timing = h('span', { class: 'timing', id: 'timing' }));
  app.append(ui.toolbar, ui.anim, h('div', { class: 'main' }, ui.stage, ui.side), ui.status);
  const supportLine = document.getElementById('zovo-support');
  if (supportLine) { supportLine.classList.remove('zovo-support-fixed'); ui.status.append(supportLine); }
  document.body.dataset.state = 'loading';

  function setHint(t) { ui.hint.textContent = t || ''; }
  function showNotice(text, kind) { ui.notice.hidden = !text; ui.notice.textContent = text || ''; ui.notice.className = 'notice' + (kind ? ' ' + kind : ''); }
  function setControlsEnabled(on) { for (const el of ui.toolbar.querySelectorAll('button, select')) if (el !== ui.panelBtn && !el.closest('.zovo-reach1')) el.disabled = !on; }
  setControlsEnabled(false);

  // ---------- three.js ----------
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
  } catch (e) {
    showNotice('WebGL is not available in this VS Code window, so the model cannot be drawn. ' + (e && e.message ? e.message : ''), 'error');
    document.body.dataset.state = 'error';
    vscode.postMessage({ type: 'failed', reason: 'webgl' });
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  ui.stage.prepend(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', '3D view');
  renderer.domElement.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); showNotice('The graphics context was lost (the GPU may be busy or out of memory). Close and reopen the file.', 'error'); });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = true;
  controls.addEventListener('change', () => invalidate());
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444450, 1.2));
  const headlight = new THREE.DirectionalLight(0xffffff, 1.6);
  headlight.position.set(0.5, 1, 1);
  camera.add(headlight);
  scene.add(camera);
  const root = new THREE.Group();
  root.name = 'root';
  scene.add(root);
  const helpers = new THREE.Group();
  helpers.userData.helper = true;
  scene.add(helpers);
  let model = null, mixer = null, clips = [], action = null, gridHelper = null, axesHelper = null, boxHelper = null, normalsGroup = null, skeletonHelper = null;
  let radius = 1, stats = null, box = new THREE.Box3(), init = null, sniffed = null;
  let dirty = true, lastTs = 0, firstFrame = true;
  const texRecords = new Map(); // lower-case name -> { name, status, width, height }
  const urlToName = new Map();
  function invalidate() { dirty = true; }

  function resize() {
    const r = ui.stage.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width)), hgt = Math.max(1, Math.floor(r.height));
    renderer.setSize(w, hgt, false);
    renderer.domElement.style.width = w + 'px';
    renderer.domElement.style.height = hgt + 'px';
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
    invalidate();
  }
  new ResizeObserver(() => { if (!rendering) resize(); }).observe(ui.stage);

  function frame(ts) {
    requestAnimationFrame(frame);
    if (rendering) return;
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 0;
    lastTs = ts;
    const moved = controls.update();
    if (mixer && state.playing && action) {
      mixer.update(dt * state.speed);
      syncTime();
      if (normalsGroup && normalsGroup.visible) normalsGroup.children.forEach((n) => n.update());
      if (boxHelper) boxHelper.box.copy(visibleBox(root));
      dirty = true;
    }
    if (!dirty && !moved) return;
    dirty = false;
    renderer.render(scene, camera);
    if (firstFrame && state.loaded) {
      firstFrame = false;
      vscode.postMessage({ type: 'rendered', stats: { ...stats }, format: sniffed && sniffed.label });
    }
  }

  // ---------- background ----------
  function themeColor() {
    const v = getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim();
    try { return new THREE.Color(v || '#1e1e1e'); } catch (e) { return new THREE.Color(0x1e1e1e); }
  }
  function applyBackground() {
    const mode = ui.bg.value;
    const c = mode === 'theme' ? themeColor() : new THREE.Color(BACKGROUNDS[mode]);
    scene.background = c;
    const light = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722 > 0.5;
    document.body.dataset.bg = light ? 'light' : 'dark';
    if (gridHelper) {
      const [a, b] = light ? [0x9a9a9a, 0xcfcfcf] : [0x5a5a5a, 0x353535];
      const col = gridHelper.geometry.attributes.color;
      const ca = new THREE.Color(a), cb = new THREE.Color(b);
      for (let i = 0; i < col.count; i++) { const cc = gridHelper.userData.center.has(i) ? ca : cb; col.setXYZ(i, cc.r, cc.g, cc.b); }
      col.needsUpdate = true;
    }
    invalidate();
  }
  ui.bg.addEventListener('change', applyBackground);
  new MutationObserver(() => { if (ui.bg.value === 'theme') applyBackground(); }).observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });

  // ---------- messages ----------
  const waiting = new Map();
  let reqN = 0;
  function ask(msg) { const req = 'w' + (++reqN); return new Promise((res) => { waiting.set(req, res); vscode.postMessage({ ...msg, req }); }); }
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || typeof m !== 'object') return;
    if (m.req && waiting.has(m.req) && /^(images)$/.test(m.type)) { const f = waiting.get(m.req); waiting.delete(m.req); f(m); return; }
    if (m.type === 'init') start(m);
    else if (m.type === 'hint') setHint(m.text);
    else if (m.type === 'copied') setHint('Model facts copied to the clipboard.');
    else if (m.type === 'export' || m.type === 'check' || m.type === 'render') work(m);
  });
  // The Pro jobs the extension host asks for (it counts the free try, not this page).
  async function runJob(m) {
    try {
      if (!state.loaded) throw new Error(sniffed && !sniffed.ok ? sniffed.reason : 'The model is not loaded.');
      if (m.type === 'export') return { ok: true, ...(await exportModel(m.format)) };
      if (m.type === 'check') return { ok: true, ...checkData() };
      if (m.type === 'render') return { ok: true, ...(await renderImage(m)) };
      throw new Error('Unknown job.');
    } catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
  }
  async function work(m) { vscode.postMessage({ type: m.type + 'Result', req: m.req, ...(await runJob(m)) }); }

  // ---------- textures ----------
  const blobUrls = new Map(); // lower-case name -> blob URL
  function recordTexture(name, status) {
    const key = name.toLowerCase();
    const r = texRecords.get(key) || { name, status, width: 0, height: 0, usedBy: [] };
    if (status === 'loaded' || r.status !== 'loaded') r.status = status;
    texRecords.set(key, r);
    return r;
  }
  async function tgaToBlobUrl(bytes) {
    const d = new TGALoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const c = document.createElement('canvas');
    c.width = d.width; c.height = d.height;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(d.width, d.height);
    // TGALoader already puts the rows top first (it reads the origin flag), as a canvas wants them
    img.data.set(d.data.subarray(0, d.width * d.height * 4));
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return URL.createObjectURL(blob);
  }
  async function loadFolderImages(bytes) {
    const names = (init.images || []).map((n) => String(n));
    const want = F.referencedImages(bytes, names.map((n) => n.toLowerCase()));
    if (!want.length) return;
    const res = await ask({ type: 'needImages', names: want });
    for (const im of res.images || []) {
      const lower = String(im.name).toLowerCase();
      const ext = lower.split('.').pop();
      const data = asBytes(im.data);
      try {
        const url = ext === 'tga' ? await tgaToBlobUrl(data) : URL.createObjectURL(new Blob([data], { type: MIME[ext] || 'application/octet-stream' }));
        blobUrls.set(lower, url);
        urlToName.set(url, im.name);
      } catch (e) { recordTexture(im.name, 'unsupported'); }
    }
  }
  function makeManager() {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      if (/^(data|blob):/i.test(url)) return url;
      let name = F.baseName(url);
      if (/\.tga\.png$/i.test(name)) name = name.slice(0, -4); // Collada TGA, renamed so the image loader takes it
      const key = name.toLowerCase();
      const hit = blobUrls.get(key);
      if (hit) { recordTexture(name, 'loaded'); return hit; }
      if (!/\.(png|jpe?g|gif|bmp|webp|tga)$/i.test(name)) { recordTexture(name || url, 'unsupported'); urlToName.set(PLACEHOLDER, '(missing)'); return PLACEHOLDER; }
      recordTexture(name, 'missing');
      return PLACEHOLDER;
    });
    const texLoader = new THREE.TextureLoader(manager);
    manager.addHandler(/\.tga$/i, { path: '', setPath(p) { this.path = p || ''; return this; }, load(url, onLoad, onProgress, onError) { return texLoader.load(url, onLoad, onProgress, onError); } });
    let pending = 0, idle = null;
    manager.onStart = () => { pending = 1; };
    manager.onLoad = () => { pending = 0; if (idle) idle(); };
    manager.onError = (url) => { const n = urlToName.get(url) || F.baseName(url); if (n && !/^(data|blob):/.test(n)) recordTexture(n, 'missing'); };
    manager.whenIdle = (ms) => new Promise((res) => { if (!pending) { setTimeout(res, 50); return; } idle = res; setTimeout(res, ms); });
    return manager;
  }

  // ---------- loading ----------
  // bytes from the extension host: a Uint8Array, or { type: 'Buffer', data: [...] } if a Node Buffer was sent as JSON
  const asBytes = (x) => (x instanceof Uint8Array ? x : x instanceof ArrayBuffer ? new Uint8Array(x) : x && Array.isArray(x.data) ? new Uint8Array(x.data) : new Uint8Array(0));
  const ab = (u8) => (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? u8.buffer : u8.slice().buffer);
  async function parse(bytes, manager) {
    const ext = init.ext;
    if (ext === 'fbx') {
      let buf = ab(bytes);
      if (sniffed.kind === 'fbx-ascii') {
        const text = new TextDecoder().decode(bytes);
        const p = F.asciiPrefix(text);
        if (p) buf = new TextEncoder().encode(p + text).buffer;
      }
      const g = new FBXLoader(manager).parse(buf, '');
      return { object: g, animations: g.animations || [] };
    }
    if (ext === 'dae') {
      let text = new TextDecoder().decode(bytes);
      text = text.replace(/(<(init_from|ref)>[^<]*?\.tga)(\s*<\/\2>)/gi, '$1.png$3');
      const c = new ColladaLoader(manager).parse(text, '');
      if (!c || !c.scene) throw new Error('The Collada file has no visual scene to draw.');
      const anims = c.scene.animations && c.scene.animations.length ? c.scene.animations : [];
      return { object: c.scene, animations: anims };
    }
    if (ext === '3ds') {
      const g = new TDSLoader(manager).parse(ab(bytes), '');
      return { object: g, animations: [] };
    }
    throw new Error('Unknown file type.');
  }

  function factsRows() {
    const rows = [['Format', sniffed ? `${sniffed.label || '?'}${sniffed.versionText && sniffed.versionText !== '?' ? ' ' + sniffed.versionText : ''}` : '?']];
    if (sniffed && sniffed.creator) rows.push(['Made with', sniffed.creator]);
    if (init) rows.push(['File size', init.sizeText]);
    return rows;
  }

  async function start(m) {
    init = m;
    ui.bg.value = ['theme', 'dark', 'light'].includes(m.background) ? m.background : 'theme';
    applyBackground();
    ui.up.value = m.upAxis === 'y' || m.upAxis === 'z' ? m.upAxis : (m.ext === '3ds' ? 'z' : 'y');
    ui.timing.textContent = `${m.name} · ${m.sizeText}`;
    if (!m.plan || !m.plan.load) { showNotice(m.plan ? m.plan.message : 'The file could not be read.', 'big'); document.body.dataset.state = 'big'; renderStats(); return; }
    const t0 = performance.now();
    try {
      const bytes = asBytes(m.bytes);
      sniffed = F.sniff(bytes, m.ext);
      if (!sniffed.ok) {
        showNotice(sniffed.reason, sniffed.old ? 'old' : 'error');
        document.body.dataset.state = sniffed.old ? 'old' : 'error';
        document.body.dataset.kind = sniffed.kind || '';
        renderStats();
        setHint(sniffed.old ? 'Older FBX file: see the note in the view.' : '');
        vscode.postMessage({ type: 'failed', reason: sniffed.old ? 'old' : 'format' });
        return;
      }
      showNotice(`Building the model (${F.fmtSize(bytes.length)})...`, 'info');
      await loadFolderImages(bytes);
      await new Promise((r) => setTimeout(r, 0));
      const manager = makeManager();
      const res = await parse(bytes, manager);
      model = res.object;
      if (!model.name) model.name = m.name;
      clips = res.animations || [];
      root.add(model);
      applyUp();
      stats = S.sceneStats(model, clips);
      if (!stats.meshes) throw new Error('The file was read but has no meshes to draw.');
      fitView();
      buildGrid();
      buildTree();
      setupAnimations();
      buildSkeleton();
      renderStats();
      showNotice('');
      setControlsEnabled(true);
      if (!stats.bones) ui.t_skeleton.disabled = true;
      syncToggles();
      state.loaded = true;
      document.body.dataset.state = 'ready';
      document.body.dataset.kind = sniffed.kind;
      const t1 = performance.now();
      ui.timing.textContent = `${m.name} · ${m.sizeText} · built ${((t1 - t0) / 1000).toFixed(2)} s`;
      setHint('Drag to orbit, right-drag or Shift-drag to pan, scroll to zoom.');
      invalidate();
      await manager.whenIdle(10000);
      collectTextures();
      renderLists();
      invalidate();
      const missing = [...texRecords.values()].filter((r) => r.status === 'missing').map((r) => r.name);
      if (missing.length) setHint(`Missing texture${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}. Put the file${missing.length === 1 ? '' : 's'} next to the model or in a textures folder beside it.`);
    } catch (e) {
      const msg = e && e.message ? e.message.replace(/^THREE\.\w+: /, '') : String(e);
      showNotice(`The model could not be read: ${msg}`, 'error');
      document.body.dataset.state = 'error';
      ui.timing.textContent = `${m.name} · ${m.sizeText}`;
      renderStats();
      vscode.postMessage({ type: 'failed', reason: 'parse' });
    }
  }

  function collectTextures() {
    if (!model) return;
    let embedded = 0;
    eachMaterial((mat) => {
      for (const k of Object.keys(mat)) {
        const t = mat[k];
        if (!t || !t.isTexture || !t.image) continue;
        const src = t.image.currentSrc || t.image.src || '';
        let name = urlToName.get(src);
        if (!name && src === PLACEHOLDER) continue;
        if (!name && /^(blob|data):/.test(src)) { name = t.name || `embedded image ${++embedded}`; urlToName.set(src, name); recordTexture(name, 'embedded'); }
        if (!name) continue;
        const r = texRecords.get(name.toLowerCase());
        if (!r) continue;
        r.width = t.image.naturalWidth || t.image.width || r.width;
        r.height = t.image.naturalHeight || t.image.height || r.height;
        const label = mat.name || '(unnamed material)';
        if (!r.usedBy.includes(label)) r.usedBy.push(label);
      }
    });
  }

  // ---------- view ----------
  function applyUp() { root.rotation.set(ui.up.value === 'z' ? -Math.PI / 2 : 0, 0, 0); root.updateMatrixWorld(true); }
  ui.up.addEventListener('change', () => { applyUp(); fitView(); buildGrid(); refreshBounds(); invalidate(); });
  function visibleBox(obj) {
    const b = new THREE.Box3();
    obj.updateMatrixWorld(true);
    obj.traverseVisible((o) => { if (o.isMesh && o.geometry && !o.userData.helper) b.expandByObject(o, false); });
    return b;
  }
  function fitView(target) {
    const b = visibleBox(target || root);
    if (b.isEmpty()) return;
    if (!target) box = b.clone();
    const center = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3());
    const r = Math.max(size.length() / 2, 1e-6);
    if (!target) radius = r;
    const dist = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
    const dir = new THREE.Vector3(0.9, 0.65, 1.2).normalize();
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.near = Math.max(r / 500, dist / 10000);
    camera.far = dist + r * 50;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.maxDistance = dist * 20;
    controls.update();
    invalidate();
  }
  function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x))); const f = x / p; return (f < 2 ? 1 : f < 5 ? 2 : 5) * p; }
  function buildGrid() {
    if (gridHelper) { helpers.remove(gridHelper); gridHelper.geometry.dispose(); }
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z, 1e-6);
    const cell = niceStep(span / 8);
    const n = 2 * Math.ceil(span * 1.5 / cell / 2) + 2;
    gridHelper = new THREE.GridHelper(n * cell, n);
    const c = box.getCenter(new THREE.Vector3());
    gridHelper.position.set(Math.round(c.x / cell) * cell, box.min.y, Math.round(c.z / cell) * cell);
    gridHelper.userData.cell = cell;
    gridHelper.userData.helper = true;
    const center = new Set();
    const pos = gridHelper.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) if ((Math.abs(pos.getX(i)) < 1e-9 && Math.abs(pos.getX(i ^ 1)) < 1e-9) || (Math.abs(pos.getZ(i)) < 1e-9 && Math.abs(pos.getZ(i ^ 1)) < 1e-9)) center.add(i);
    gridHelper.userData.center = center;
    gridHelper.visible = state.grid;
    helpers.add(gridHelper);
    if (axesHelper) { helpers.remove(axesHelper); axesHelper.dispose(); }
    axesHelper = new THREE.AxesHelper(radius * 0.6);
    axesHelper.userData.helper = true;
    axesHelper.material.depthTest = false;
    axesHelper.renderOrder = 998;
    axesHelper.visible = state.axes;
    axesHelper.position.copy(c).setY(box.min.y);
    helpers.add(axesHelper);
    applyBackground();
  }
  function refreshBounds() {
    if (boxHelper) { helpers.remove(boxHelper); boxHelper.geometry.dispose(); boxHelper = null; }
    if (!state.bounds || !model) return;
    const b = visibleBox(root);
    if (b.isEmpty()) return;
    boxHelper = new THREE.Box3Helper(b, 0xffb000);
    boxHelper.userData.helper = true;
    helpers.add(boxHelper);
    const local = modelBox();
    setHint(`Bounding box ${S.fmtDims(local.min, local.max, 'units')}`);
  }
  function modelBox() {
    const b = new THREE.Box3();
    if (!model) return b;
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    model.updateMatrixWorld(true);
    model.traverseVisible((o) => {
      if (!o.isMesh || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      b.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)));
    });
    return b;
  }
  function eachMaterial(fn) { if (model) model.traverse((o) => { if ((o.isMesh || o.isLine) && o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => fn(mm, o)); }); }
  function setToggle(key, on) {
    state[key] = on;
    if (key === 'grid' && gridHelper) gridHelper.visible = on;
    if (key === 'axes' && axesHelper) axesHelper.visible = on;
    if (key === 'wireframe') eachMaterial((mm) => { mm.wireframe = on; mm.needsUpdate = true; });
    if (key === 'bounds') { refreshBounds(); if (!on) setHint(''); }
    if (key === 'normals') buildNormals();
    if (key === 'skeleton' && skeletonHelper) { skeletonHelper.visible = on; setHint(on ? `${S.fmtInt(stats.bones)} bones shown.` : ''); }
    syncToggles();
    invalidate();
  }
  function syncToggles() { for (const k of ['grid', 'axes', 'wireframe', 'normals', 'bounds', 'skeleton']) if (ui['t_' + k]) ui['t_' + k].setAttribute('aria-pressed', String(!!state[k])); }
  function buildNormals() {
    if (normalsGroup) { normalsGroup.children.forEach((n) => n.dispose && n.dispose()); scene.remove(normalsGroup); normalsGroup = null; }
    if (!state.normals || !model) return;
    if (stats.vertices > MAX_NORMALS) { state.normals = false; setHint(`Normals are drawn for models up to ${S.fmtInt(MAX_NORMALS)} vertices. This one has ${S.fmtInt(stats.vertices)}.`); return; }
    normalsGroup = new THREE.Group();
    normalsGroup.userData.helper = true;
    model.traverseVisible((o) => { if (o.isMesh && o.geometry && o.geometry.attributes.normal) normalsGroup.add(new VertexNormalsHelper(o, radius * 0.04, 0x33ccff)); });
    scene.add(normalsGroup);
    setHint(normalsGroup.children.length ? 'Vertex normals shown in cyan.' : 'This model has no vertex normals.');
  }
  function buildSkeleton() {
    if (!model || !stats.bones) return;
    skeletonHelper = new THREE.SkeletonHelper(model);
    skeletonHelper.userData.helper = true;
    skeletonHelper.material.depthTest = false;
    if (skeletonHelper.setColors) skeletonHelper.setColors(new THREE.Color(0x33e0ff), new THREE.Color(0xffffff));
    skeletonHelper.renderOrder = 997;
    skeletonHelper.visible = state.skeleton;
    helpers.add(skeletonHelper);
  }

  // ---------- animation ----------
  function setupAnimations() {
    if (!clips.length) { ui.anim.hidden = true; return; }
    mixer = new THREE.AnimationMixer(model);
    ui.clip.textContent = '';
    clips.forEach((c, i) => ui.clip.append(h('option', { value: String(i), text: `${c.name || 'Clip ' + (i + 1)} (${c.duration.toFixed(2)} s)` })));
    ui.anim.hidden = false;
    playClip(0);
    resize();
  }
  function applyLoop() {
    if (!action) return;
    action.setLoop(state.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !state.loop;
  }
  function playClip(i) {
    if (!mixer) return;
    mixer.stopAllAction();
    const clip = clips[i];
    action = mixer.clipAction(clip);
    applyLoop();
    action.reset().play();
    ui.time.max = String(Math.max(clip.duration, 0.001));
    setPlaying(true);
  }
  function setPlaying(on) {
    state.playing = on && !!action;
    if (action) { if (state.playing && !state.loop && action.time >= action.getClip().duration - 1e-4) action.reset(); action.paused = !state.playing; action.enabled = true; }
    ui.play.textContent = state.playing ? 'Pause' : 'Play';
    invalidate();
  }
  function syncTime() {
    if (!action) return;
    const d = Math.max(action.getClip().duration, 0.001);
    const t = state.loop ? action.time % d : Math.min(action.time, d);
    ui.time.value = String(t);
    ui.timeText.textContent = `${t.toFixed(2)} s`;
    if (!state.loop && action.time >= d - 1e-4 && state.playing) { state.playing = false; ui.play.textContent = 'Play'; }
  }
  ui.clip.addEventListener('change', () => playClip(Number(ui.clip.value)));
  ui.speed.addEventListener('change', () => { state.speed = Number(ui.speed.value) || 1; setHint(`Speed ${state.speed}×.`); });
  ui.loop.addEventListener('change', () => { state.loop = ui.loop.checked; applyLoop(); setHint(state.loop ? 'The clip loops.' : 'The clip plays once and stops on the last frame.'); });
  function seek(t) {
    if (!action) return;
    action.paused = false;
    action.enabled = true;
    action.time = t;
    mixer.update(0);
    action.paused = !state.playing;
    syncTime();
    if (normalsGroup) normalsGroup.children.forEach((n) => n.update());
    invalidate();
  }
  ui.time.addEventListener('input', () => { setPlaying(false); seek(Number(ui.time.value)); });

  // ---------- panels ----------
  function renderStats() {
    ui.stats.textContent = '';
    const rows = factsRows();
    if (stats) {
      for (const r of S.statsRows(stats)) rows.push(r);
      const lb = modelBox();
      if (!lb.isEmpty()) rows.push(['Size', S.fmtDims(lb.min, lb.max, 'units')]);
      if (gridHelper) rows.push(['Grid cell', `${S.round(gridHelper.userData.cell)} units`]);
    }
    for (const [k, v] of rows) ui.stats.append(h('div', { class: 'row' }, h('span', { class: 'k', text: k }), h('span', { class: 'v', text: v })));
    ui.copy.disabled = !rows.length;
  }
  function copyStats() {
    const text = [...ui.stats.querySelectorAll('.row')].map((r) => r.children[0].textContent + '\t' + r.children[1].textContent).join('\n');
    vscode.postMessage({ type: 'copy', text });
  }
  function buildTree() {
    ui.tree.textContent = '';
    let count = 0, hidden = 0;
    const walk = (o, depth) => {
      if (o.userData.helper) return;
      if (count >= MAX_TREE) { hidden++; o.children.forEach((c) => walk(c, depth + 1)); return; }
      count++;
      const kind = o.isSkinnedMesh ? 'skinned mesh' : o.isMesh ? 'mesh' : o.isBone ? 'bone' : o.isLight ? 'light' : o.isCamera ? 'camera' : o.isLine ? 'line' : 'group';
      const meta = o.isMesh && o.geometry && o.geometry.attributes.position ? `${S.fmtInt(S.triCount(o.geometry, o))} tris` : '';
      const cb = h('input', { type: 'checkbox', 'aria-label': 'Visible' });
      cb.checked = o.visible;
      cb.addEventListener('change', () => { o.visible = cb.checked; refreshBounds(); if (state.normals) buildNormals(); invalidate(); });
      const name = h('button', { type: 'button', class: 'node-name', title: 'Frame this node', text: o.name || `(${kind})` });
      name.addEventListener('click', () => fitView(o));
      const row = h('div', { class: 'node', role: 'treeitem', 'data-kind': kind, 'data-depth': depth }, h('span', { class: 'indent' }), cb, name, h('span', { class: 'kind', text: meta || kind }));
      row.firstChild.style.width = `${depth * 12}px`;
      ui.tree.append(row);
      o.children.forEach((c) => walk(c, depth + 1));
    };
    walk(model, 0);
    if (hidden) ui.tree.append(h('div', { class: 'more', text: `and ${S.fmtInt(hidden)} more nodes (the first ${S.fmtInt(MAX_TREE)} are listed)` }));
  }
  const MAP_KEYS = { map: 'color', normalMap: 'normal', bumpMap: 'bump', specularMap: 'specular', emissiveMap: 'emissive', alphaMap: 'alpha', aoMap: 'AO', roughnessMap: 'roughness', metalnessMap: 'metalness', lightMap: 'light', displacementMap: 'displacement' };
  function renderLists() {
    ui.mats.textContent = '';
    const seen = new Set();
    eachMaterial((mm) => {
      if (seen.has(mm)) return;
      seen.add(mm);
      const maps = Object.entries(MAP_KEYS).filter(([k]) => mm[k] && mm[k].isTexture).map(([k, label]) => {
        const src = mm[k].image ? (mm[k].image.currentSrc || mm[k].image.src || '') : '';
        const n = urlToName.get(src);
        return `${label}: ${n || (src === PLACEHOLDER ? 'missing' : mm[k].name || 'image')}`;
      });
      const col = mm.color ? '#' + mm.color.getHexString() : '';
      ui.mats.append(h('div', { class: 'item' }, col ? h('span', { class: 'swatch', title: col }) : null, h('span', { class: 'name', text: mm.name || '(unnamed)' }), h('span', { class: 'meta', text: maps.join(', ') || mm.type.replace(/Material$/, '') })));
      if (col) ui.mats.lastChild.firstChild.style.background = col;
    });
    if (!seen.size) ui.mats.append(h('div', { class: 'muted', text: 'No materials.' }));
    ui.texs.textContent = '';
    const recs = [...texRecords.values()].sort((a, b) => (a.status === 'missing' ? 0 : 1) - (b.status === 'missing' ? 0 : 1) || a.name.localeCompare(b.name));
    for (const r of recs) {
      const meta = r.status === 'missing' ? 'missing' : r.status === 'unsupported' ? 'not shown' : `${r.width || '?'} × ${r.height || '?'}${r.status === 'embedded' ? ', embedded' : ''}`;
      ui.texs.append(h('div', { class: 'item tex-' + r.status, 'data-status': r.status }, h('span', { class: 'name', text: r.name }), h('span', { class: 'meta', text: meta })));
    }
    if (!recs.length) ui.texs.append(h('div', { class: 'muted', text: 'This model uses no texture files.' }));
  }

  // ---------- Pro: convert ----------
  function toBytes(x) {
    if (x instanceof ArrayBuffer) return new Uint8Array(x);
    if (x instanceof DataView) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    if (typeof x === 'string') return new TextEncoder().encode(x);
    return new TextEncoder().encode(JSON.stringify(x, null, 1));
  }
  function mtlFor() {
    const out = ['# Materials written by FBX Viewer & DAE, 3DS Preview'];
    const seen = new Set();
    eachMaterial((mm) => {
      const n = (mm.name || 'material').replace(/\s+/g, '_');
      if (seen.has(n)) return;
      seen.add(n);
      out.push('', `newmtl ${n}`);
      if (mm.color) out.push(`Kd ${mm.color.r.toFixed(4)} ${mm.color.g.toFixed(4)} ${mm.color.b.toFixed(4)}`);
      if (mm.opacity !== undefined && mm.opacity < 1) out.push(`d ${mm.opacity.toFixed(4)}`);
      if (mm.map && mm.map.image) { const name = urlToName.get(mm.map.image.currentSrc || mm.map.image.src || ''); if (name && !/^embedded image/.test(name)) out.push(`map_Kd ${name}`); }
    });
    return out.join('\n') + '\n';
  }
  async function exportModel(format) {
    const notes = [];
    let data, mtl = null;
    const wasWire = state.wireframe;
    if (wasWire) setToggle('wireframe', false);
    try {
      if (format === 'glb' || format === 'gltf') {
        const res = await new GLTFExporter().parseAsync(model, { binary: format === 'glb', animations: clips, onlyVisible: false, embedImages: true, maxTextureSize: 4096 });
        data = toBytes(res);
        if (clips.length) notes.push(`${clips.length} animation clip${clips.length === 1 ? '' : 's'} included.`);
      } else if (format === 'obj') {
        const text = new OBJExporter().parse(model);
        mtl = mtlFor();
        data = toBytes(text);
        notes.push('OBJ holds the meshes in their rest pose with UVs and normals; materials go to a .mtl file next to it.');
        if (clips.length || stats.bones) notes.push('OBJ has no bones or animation.');
      } else if (format === 'stl') {
        data = toBytes(new STLExporter().parse(model, { binary: true }));
        notes.push('STL holds triangles only, in the pose shown now; no colors, textures or animation.');
      } else throw new Error('Unknown format ' + format);
    } finally { if (wasWire) setToggle('wireframe', true); }
    return { data, mtl: mtl ? toBytes(mtl) : null, notes, triangles: stats.triangles, vertices: stats.vertices, clips: clips.length };
  }

  // ---------- Pro: asset check ----------
  function flippedCount(mesh) {
    const g = mesh.geometry;
    const pos = g.attributes.position, nor = g.attributes.normal;
    if (!pos || !nor) return 0;
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    const step = Math.max(1, Math.floor(n / 3 / 200000));
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3(), vn = new THREE.Vector3(), t = new THREE.Vector3();
    let flipped = 0;
    for (let f = 0; f * 3 + 2 < n; f += step) {
      const i0 = idx ? idx.getX(f * 3) : f * 3, i1 = idx ? idx.getX(f * 3 + 1) : f * 3 + 1, i2 = idx ? idx.getX(f * 3 + 2) : f * 3 + 2;
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
      fn.subVectors(c, b).cross(t.subVectors(a, b));
      if (fn.lengthSq() < 1e-30) continue;
      vn.fromBufferAttribute(nor, i0).add(t.fromBufferAttribute(nor, i1)).add(t.fromBufferAttribute(nor, i2));
      if (fn.dot(vn) < 0) flipped += step;
    }
    return flipped;
  }
  function checkData() {
    const meshes = [];
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      if (!o.isMesh || !o.geometry || o.userData.helper) return;
      const ws = new THREE.Vector3(); const q = new THREE.Quaternion(); const p = new THREE.Vector3();
      new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(o.matrixWorld).decompose(p, q, ws);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      let unusedSlots = [];
      if (mats.length > 1) {
        const used = new Set((o.geometry.groups || []).filter((gr) => gr.count > 0).map((gr) => gr.materialIndex));
        unusedSlots = mats.map((mm, i) => (used.has(i) ? null : (mm && mm.name) || `slot ${i}`)).filter(Boolean);
      }
      meshes.push({ name: o.name || '(unnamed mesh)', triangles: S.triCount(o.geometry, o), vertices: o.geometry.attributes.position ? o.geometry.attributes.position.count : 0,
        skinned: !!o.isSkinnedMesh, bones: o.isSkinnedMesh && o.skeleton ? o.skeleton.bones.length : 0, scale: [ws.x, ws.y, ws.z], flipped: flippedCount(o),
        materials: mats.map((mm) => (mm && mm.name) || '(unnamed)'), unusedSlots });
    });
    collectTextures();
    const textures = [...texRecords.values()].map((r) => ({ name: r.name, status: r.status, width: r.width, height: r.height, usedBy: r.usedBy.slice() }));
    return { data: { file: { name: init.name, format: factsRows()[0][1], size: init.sizeText }, totals: { meshes: stats.meshes, triangles: stats.triangles, vertices: stats.vertices, materials: stats.materials, textures: textures.length, bones: stats.bones, clips: clips.length }, meshes, textures } };
  }

  // ---------- Pro: render export ----------
  let rendering = false;
  function canvasBytes(canvas) {
    const url = canvas.toDataURL('image/png');
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function renderImage(m) {
    const gl = renderer.getContext();
    const maxDim = Math.min(8192, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 4096, ...(gl.getParameter(gl.MAX_VIEWPORT_DIMS) || [4096]));
    const view = ui.stage.getBoundingClientRect();
    let w = Math.round(Number(m.width) || view.width), hh = Math.round(Number(m.height) || view.height);
    const frames = m.strip && action ? Math.max(2, Math.min(24, Number(m.strip) || 8)) : 0;
    const cols = frames ? Math.min(frames, 4) : 1, rows = frames ? Math.ceil(frames / cols) : 1;
    const fit = Math.min(1, maxDim / w, maxDim / hh, frames ? 8192 / (w * cols) : 1, frames ? 8192 / (hh * rows) : 1);
    if (fit < 1) { w = Math.floor(w * fit); hh = Math.floor(hh * fit); }
    if (w < 16 || hh < 16) throw new Error('The image size is too small.');
    rendering = true;
    const keep = { bg: scene.background, pr: renderer.getPixelRatio(), aspect: camera.aspect, time: action ? action.time : 0, paused: action ? action.paused : true };
    try {
      renderer.setPixelRatio(1);
      renderer.setSize(w, hh, false);
      camera.aspect = w / hh;
      camera.updateProjectionMatrix();
      if (m.transparent) { scene.background = null; renderer.setClearColor(0x000000, 0); }
      if (!frames) {
        renderer.render(scene, camera);
        return { data: canvasBytes(renderer.domElement), width: w, height: hh, frames: 1 };
      }
      const sheet = document.createElement('canvas');
      sheet.width = w * cols; sheet.height = hh * rows;
      const ctx = sheet.getContext('2d');
      if (!m.transparent && scene.background && scene.background.isColor) { ctx.fillStyle = '#' + scene.background.getHexString(); ctx.fillRect(0, 0, sheet.width, sheet.height); }
      const d = action.getClip().duration;
      const times = [];
      for (let i = 0; i < frames; i++) {
        const t = d * i / (frames - 1 || 1) * (state.loop ? (frames - 1) / frames : 1);
        times.push(t);
        action.paused = false; action.enabled = true; action.time = t; mixer.update(0);
        renderer.render(scene, camera);
        ctx.drawImage(renderer.domElement, (i % cols) * w, Math.floor(i / cols) * hh);
      }
      return { data: canvasBytes(sheet), width: sheet.width, height: sheet.height, frames, cell: [w, hh], times: times.map((t) => Number(t.toFixed(3))), clip: action.getClip().name };
    } finally {
      scene.background = keep.bg;
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(keep.pr);
      if (action) { action.paused = false; action.time = keep.time; mixer.update(0); action.paused = keep.paused; }
      rendering = false;
      resize();
      applyBackground();
    }
  }

  // ---------- keys ----------
  window.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
    if (e.metaKey || e.ctrlKey || e.altKey || !state.loaded) return;
    const k = e.key.toLowerCase();
    const map = { g: 'grid', a: 'axes', w: 'wireframe', n: 'normals', b: 'bounds', k: 'skeleton' };
    if (map[k]) { if (map[k] !== 'skeleton' || stats.bones) setToggle(map[k], !state[map[k]]); e.preventDefault(); }
    else if (k === 'f') { fitView(); e.preventDefault(); }
    else if (k === 'p') { ui.panelBtn.click(); e.preventDefault(); }
    else if (k === ' ' && action) { setPlaying(!state.playing); e.preventDefault(); }
  });

  // ---------- self-check (read-only) for tests: share of drawn pixels that differ from the background ----------
  function coverage() {
    renderer.render(scene, camera);
    const g = renderer.getContext();
    const w = g.drawingBufferWidth, hh = g.drawingBufferHeight;
    const px = new Uint8Array(w * hh * 4);
    g.readPixels(0, 0, w, hh, g.RGBA, g.UNSIGNED_BYTE, px);
    const hex = scene.background && scene.background.isColor ? scene.background.getHex() : 0;
    const br = (hex >> 16) & 255, bgc = (hex >> 8) & 255, bb = hex & 255;
    let hit = 0, n = 0, hash = 0;
    for (let y = 0; y < hh; y += 4) for (let x = 0; x < w; x += 4) {
      const i = (y * w + x) * 4; n++;
      if (Math.abs(px[i] - br) + Math.abs(px[i + 1] - bgc) + Math.abs(px[i + 2] - bb) > 30) hit++;
      hash = (hash * 31 + px[i] + px[i + 1] * 7 + px[i + 2] * 13) | 0;
    }
    return { frac: n ? hit / n : 0, hash, w, h: hh };
  }
  window.fbxViewerProbe = () => ({
    state: document.body.dataset.state, loaded: state.loaded, pixels: state.loaded ? coverage() : null, toggles: { ...state }, stats, kind: sniffed && sniffed.kind,
    clip: action ? action.getClip().name : null, clips: clips.map((c) => c.name), time: action ? action.time : null, speed: state.speed, loop: state.loop,
    skeletonShown: !!(skeletonHelper && skeletonHelper.visible), textures: [...texRecords.values()].map((r) => ({ ...r })), background: ui.bg.value, up: ui.up.value,
  });
  // self-check for tests: runs the same job code and hands the result back to the caller only (nothing is saved or counted)
  window.fbxViewerRun = (m) => runJob(m || {});
  window.fbxViewerSeek = (t) => { setPlaying(false); seek(t); return action ? action.time : null; };

  resize();
  requestAnimationFrame(frame);
  vscode.postMessage({ type: 'ready' });
})();
