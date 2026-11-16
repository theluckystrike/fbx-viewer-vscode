'use strict';
// FBX Viewer & DAE, 3DS Preview by Zovo: opens .fbx (binary and ASCII 7.x), Collada .dae and 3D Studio .3ds models in a
// 3D view. No network, no telemetry. Activation shows nothing: no message, no popup. The viewer opens only for files
// the user opens, and it never reopens a tab in another editor by itself.
const vscode = require('vscode');
const { FbxEditorProvider, VIEW_TYPE } = require('./editor');
const { createTools } = require('./tools');
const { createPro } = require('./pro');
const { createRatingPrompt } = require('./rate');
const support = require('./support');
const { createReach } = require('./reach');
const reachConfig = require('./reach-config');

const PREFIX = 'fbxViewer';
const EXT_ID = 'zovo.zovo-fbx-viewer';
const setting = (k, d) => vscode.workspace.getConfiguration(PREFIX).get(k, d);

function activate(context) {
  const sub = (d) => context.subscriptions.push(d);
  let rating = { success() {}, failure() {} };
  try { rating = createRatingPrompt({ vscode, context, extensionId: EXT_ID, section: PREFIX, name: 'FBX Viewer' }); } catch (e) { /* rating is optional */ }
  support.registerSupport({ vscode, context, prefix: PREFIX, selfId: EXT_ID });
  const pro = createPro({ vscode, context });
  const reach = createReach({ vscode, ...reachConfig, maximum: pro.TRIAL_USES, context, licensed: () => !!pro.licensed, shown: () => setting('showProTools', true) !== false });
  reach.registerCtx();
  sub(pro.onDidChange(() => reach.refresh()));

  const provider = new FbxEditorProvider(context, {
    reach: () => reach,
    onSuccess: (doc) => rating.success(doc.uri),
    onFailure: () => rating.failure(),
  });
  sub(vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true }));
  sub(provider);
  const tools = createTools({ context, provider, pro, reach });

  const reg = (id, fn) => sub(vscode.commands.registerCommand(id, async (...a) => {
    try { return await fn(...a); } catch (e) { vscode.window.showErrorMessage(String((e && e.message) || e)); return undefined; }
  }));
  const target = (uri) => (uri && uri.scheme ? uri : undefined);
  const extra = (x) => (x && typeof x === 'object' && !x.scheme && !Array.isArray(x) ? x : {});
  const sample = (name) => vscode.Uri.joinPath(context.extensionUri, 'samples', name);
  reg(`${PREFIX}.openWith`, (uri) => {
    const u = uri && uri.scheme ? uri : (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
    if (!u) { vscode.window.showInformationMessage('Select an .fbx, .dae or .3ds file first.'); return undefined; }
    return vscode.commands.executeCommand('vscode.openWith', u, VIEW_TYPE);
  });
  reg(`${PREFIX}.openSample`, () => vscode.commands.executeCommand('vscode.openWith', sample('robot-arm.fbx'), VIEW_TYPE));
  reg(`${PREFIX}.openWalkthrough`, () => vscode.commands.executeCommand('workbench.action.openWalkthrough', `${EXT_ID}#${PREFIX}.start`, false));
  reg(`${PREFIX}.convert`, reach.wrap((uri, x) => tools.convert(target(uri), extra(x))));
  reg(`${PREFIX}.assetCheck`, reach.wrap((uri, x) => tools.assetCheck(target(uri), extra(x))));
  reg(`${PREFIX}.renderExport`, reach.wrap((uri, x) => tools.renderExport(target(uri), extra(x))));
  sub(vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration(`${PREFIX}.showProTools`)) reach.refresh(); }));
  sub(vscode.window.registerUriHandler({ handleUri: (uri) => pro.handleUri(uri) }));
  return { provider, tools, pro, reach };
}

function deactivate() {}

module.exports = { activate, deactivate };
