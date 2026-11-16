'use strict';
// Webview HTML for the 3D viewer and the asset check report. No vscode import, so tests can check the CSP: no remote
// origin, no connect-src, scripts only with the page nonce. Model and texture bytes come from the extension host;
// textures are shown through blob: URLs made in the webview.
const crypto = require('crypto');
const { footerHtml, FOOTER_CSS } = require('./support');

const PREFIX = 'fbxViewer';
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function csp(cspSource, n) {
  return ["default-src 'none'", `style-src ${cspSource} 'nonce-${n}'`, `script-src 'nonce-${n}'`, `img-src ${cspSource} data: blob:`, `font-src ${cspSource}`].join('; ');
}

/** p: { cspSource, scripts: [uri], styleUri, title, showSupportLinks, head?(nonce), nonce? } */
function editorHtml(p) {
  const n = p.nonce || crypto.randomBytes(18).toString('base64url');
  // The viewer script moves this line into its status bar.
  const footer = footerHtml(PREFIX, p.showSupportLinks !== false, 'zovo-support-fixed');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp(p.cspSource, n)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${attr(p.styleUri)}">
${footer ? `<style nonce="${n}">${FOOTER_CSS}</style>` : ''}
${typeof p.head === 'function' ? p.head(n) : ''}
<title>${attr(p.title)}</title>
</head>
<body>
<div id="app"><p class="loading">Opening the model...</p></div>
${footer}
${(p.scripts || []).map((s) => `<script nonce="${n}" src="${attr(s)}"></script>`).join('\n')}
</body>
</html>`;
}

/** The asset check report panel. p: { cspSource, scriptUri, styleUri, title, showSupportLinks, nonce? } */
function reportHtml(p) {
  const n = p.nonce || crypto.randomBytes(18).toString('base64url');
  const footer = footerHtml(PREFIX, p.showSupportLinks !== false, '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp(p.cspSource, n)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${attr(p.styleUri)}">
${footer ? `<style nonce="${n}">${FOOTER_CSS}</style>` : ''}
<title>${attr(p.title)}</title>
</head>
<body class="report">
<div id="report" role="main"><p class="muted">Checking...</p></div>
<div id="footer">${footer}</div>
<script nonce="${n}" src="${attr(p.scriptUri)}"></script>
</body>
</html>`;
}

module.exports = { editorHtml, reportHtml, csp };
