// File checks for FBX, Collada (.dae) and 3D Studio (.3ds), shared by the extension host, the webview and the tests.
// No vscode import and no DOM: in the webview this file loads as a plain script and sets globalThis.FbxCore.formats.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.FbxCore = root.FbxCore || {}; root.FbxCore.formats = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MB = 1024 * 1024;
  const EXTS = { fbx: 'fbx', dae: 'dae', '3ds': '3ds' };
  const LABEL = { 'fbx-binary': 'FBX binary', 'fbx-ascii': 'FBX ASCII', dae: 'Collada (DAE)', '3ds': '3D Studio (3DS)' };
  const BINARY_MAGIC = 'Kaydara FBX Binary  \0';

  function extOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return m ? EXTS[m[1].toLowerCase()] || null : null;
  }

  function ascii(b, from, n) {
    let s = '';
    const end = Math.min(b.length, from + n);
    for (let i = from; i < end; i++) s += String.fromCharCode(b[i]);
    return s;
  }

  function fmtSize(n) {
    if (!Number.isFinite(n) || n < 0) return '?';
    if (n < 1024) return `${n} B`;
    if (n < MB) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * MB) return `${(n / MB).toFixed(1)} MB`;
    return `${(n / (1024 * MB)).toFixed(1)} GB`;
  }

  /** "7.4" from 7400. */
  function versionText(v) { return `${Math.floor(v / 1000)}.${Math.floor((v % 1000) / 100)}`; }

  const OLD_HINT = 'This viewer reads FBX 7.0 and later (files saved since about 2011). To view this model, open it in the 3D program that made it, or in any program that imports FBX 6, and export it again as FBX 7.4 or later (binary or ASCII), or as glTF.';

  /**
   * Looks at the bytes before a loader runs, so a wrong, old or broken file gets a plain message, never a blank view.
   * Returns { ok, kind, label, version?, versionText?, creator?, old?, reason? }.
   */
  function sniff(bytes, ext) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (b.length === 0) return { ok: false, kind: 'empty', reason: 'This file is empty.' };
    const head = ascii(b, 0, 4096);
    if (ext === 'fbx') {
      if (head.startsWith(BINARY_MAGIC)) {
        if (b.length < 27) return { ok: false, kind: 'fbx-binary', reason: 'This FBX file is cut off: it ends inside its header.' };
        const v = b[23] | (b[24] << 8) | (b[25] << 16) | (b[26] << 24);
        const r = { kind: 'fbx-binary', label: LABEL['fbx-binary'], version: v, versionText: versionText(v), creator: binaryCreator(b) };
        if (v < 7000) return { ...r, ok: false, old: true, reason: `This is a binary FBX ${versionText(v)} file (FBX version ${v}). ${OLD_HINT}` };
        if (b.length < 200) return { ...r, ok: false, reason: 'This FBX file is cut off: it is too short to hold a model.' };
        return { ...r, ok: true };
      }
      if (head.startsWith('Kaydara FBX Binary')) return { ok: false, kind: 'fbx-binary', reason: 'This FBX file has a damaged binary header.' };
      let nul = 0;
      for (let i = 0; i < Math.min(b.length, 4096); i++) if (b[i] === 0) nul++;
      const text = head.replace(/^\uFEFF|^\xEF\xBB\xBF/, '');
      const vm = /FBXVersion:\s*(\d+)/.exec(ascii(b, 0, 65536));
      const looks = /^\s*;\s*FBX\s+\d/.test(text) || /^\s*(FBXHeaderExtension|; FBX)/m.test(text) || !!vm;
      if (nul > 0 || !looks) return { ok: false, kind: 'unknown', reason: 'This does not look like an FBX file: it has neither the binary FBX header nor the "; FBX" text header.' };
      const hv = /^\s*;\s*FBX\s+(\d+)\.(\d+)/.exec(text);
      const v = vm ? Number(vm[1]) : hv ? Number(hv[1]) * 1000 + Number(hv[2]) * 100 : 0;
      const cm = /Creator:\s*"([^"\r\n]{0,120})"/.exec(ascii(b, 0, 65536));
      const r = { kind: 'fbx-ascii', label: LABEL['fbx-ascii'], version: v, versionText: v ? versionText(v) : '?', creator: cm ? cm[1] : '' };
      if (!v) return { ...r, ok: false, reason: 'This FBX text file has no FBXVersion line, so its version is unknown.' };
      if (v < 7000) return { ...r, ok: false, old: true, reason: `This is an ASCII FBX ${versionText(v)} file (FBX version ${v}). ${OLD_HINT}` };
      return { ...r, ok: true };
    }
    if (ext === 'dae') {
      const t = head.replace(/^\uFEFF|^\xEF\xBB\xBF/, '');
      if (t.startsWith('PK')) return { ok: false, kind: 'zip', reason: 'This file is a ZIP package (a zipped Collada .zae). Unzip it and open the .dae inside.' };
      if (/^\s*<\?xml|^\s*</.test(t)) {
        const big = ascii(b, 0, 65536);
        if (!/<COLLADA[\s>]/.test(big)) return { ok: false, kind: 'xml', reason: 'This XML file is not a Collada document: it has no <COLLADA> element.' };
        const vm = /<COLLADA[^>]*\bversion="([\d.]+)"/.exec(big);
        const tool = /<authoring_tool>([^<]{0,120})<\/authoring_tool>/.exec(big);
        return { ok: true, kind: 'dae', label: LABEL.dae, versionText: vm ? vm[1] : '?', creator: tool ? tool[1].trim() : '' };
      }
      return { ok: false, kind: 'unknown', reason: 'This is not a Collada file: Collada files are XML text and this one is not.' };
    }
    if (ext === '3ds') {
      if (b.length < 6 || b[0] !== 0x4d || b[1] !== 0x4d) return { ok: false, kind: 'unknown', reason: 'This is not a 3DS file: it does not start with the 3DS main chunk (4D 4D).' };
      const len = (b[2] | (b[3] << 8) | (b[4] << 16) | (b[5] << 24)) >>> 0;
      if (len > b.length) return { ok: false, kind: '3ds', reason: `This 3DS file is cut off: its header says ${fmtSize(len)} and the file has ${fmtSize(b.length)}.` };
      let ver = 0;
      if (b.length >= 16 && b[6] === 0x02 && b[7] === 0x00) ver = b[12] | (b[13] << 8);
      return { ok: true, kind: '3ds', label: LABEL['3ds'], versionText: ver ? String(ver) : '?' };
    }
    return { ok: false, kind: 'unknown', reason: 'Unknown file type.' };
  }

  /** The Creator text of a binary FBX (a plain string property right after the "Creator" node name). */
  function binaryCreator(b) {
    const s = ascii(b, 0, Math.min(b.length, 8192));
    const i = s.indexOf('Creator');
    if (i < 0) return '';
    const j = s.indexOf('S', i + 7);
    if (j < 0 || j > i + 20) return '';
    const len = (b[j + 1] | (b[j + 2] << 8) | (b[j + 3] << 16) | (b[j + 4] << 24)) >>> 0;
    if (!len || len > 200) return '';
    return s.slice(j + 5, j + 5 + len).replace(/[^\x20-\x7e]/g, '');
  }

  // The FBX loader of three.js decides "is this ASCII?" by sampling a few characters of the text at fixed positions.
  // A text FBX whose comment lines happen to hold those characters is refused as "Unknown format". A leading comment
  // line that the parser skips fixes that; this finds the shortest one.
  const PROBE = ['K', 'a', 'y', 'd', 'a', 'r', 'a', '\\', 'F', 'B', 'X', '\\', 'B', 'i', 'n', 'a', 'r', 'y', '\\', '\\'];
  function loaderSaysAscii(text) {
    let t = text; let cursor = 0;
    for (let i = 0; i < PROBE.length; i++) {
      const c = t[0];
      t = t.slice(cursor + 1);
      cursor++;
      if (c === PROBE[i]) return false;
    }
    return true;
  }
  function asciiPrefix(text) {
    if (loaderSaysAscii(text)) return '';
    for (let n = 1; n < 40; n++) {
      const p = ';' + ' '.repeat(n - 1) + '\n';
      if (loaderSaysAscii(p + text)) return p;
    }
    return '';
  }

  /** Lower-case base names of files a model refers to: "C:\\art\\Wood.PNG" and "textures/wood.png" -> "wood.png". */
  function baseName(ref) {
    let s = String(ref || '');
    try { s = decodeURIComponent(s); } catch (e) { /* keep as is */ }
    s = s.replace(/[?#].*$/, '');
    const parts = s.split(/[\\/]+/);
    return (parts[parts.length - 1] || '').trim();
  }

  const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp|tga)$/i;

  /**
   * Which image files of the folder this model names (search of the raw bytes for each candidate name, case
   * insensitive). files: lower-case base names. Returns the names found.
   */
  function referencedImages(bytes, files) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const want = (files || []).filter((f) => IMAGE_EXT.test(f));
    if (!want.length) return [];
    const text = ascii(b, 0, Math.min(b.length, 256 * MB)).toLowerCase();
    return want.filter((f) => text.indexOf(f.toLowerCase()) >= 0);
  }

  /** Files over the limit get a clear message and are never read. */
  function sizePlan(size, maxFileMB) {
    const limitMB = Number.isFinite(maxFileMB) && maxFileMB > 0 ? Math.min(maxFileMB, 2048) : 512;
    if (size > limitMB * MB) {
      return { load: false, limitMB, message: `This file is ${fmtSize(size)}. The viewer opens files up to ${fmtSize(limitMB * MB)} so VS Code stays responsive (setting fbxViewer.maxFileMB). The file was not read.` };
    }
    return { load: true, limitMB };
  }

  return { MB, EXTS, LABEL, extOf, fmtSize, versionText, sniff, binaryCreator, loaderSaysAscii, asciiPrefix, baseName, referencedImages, sizePlan, IMAGE_EXT, OLD_HINT };
});
