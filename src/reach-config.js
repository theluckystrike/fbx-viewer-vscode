'use strict';
// REACH1: this listing's Pro tools for the viewer toolbar row and the Explorer entries (src/reach.js).
module.exports = {
  prefix: 'fbxViewer',
  triesKey: 'fbxViewer.proTrial',
  slot: '#toolbar',
  tools: [
    { id: 'convert', title: 'Convert to GLB, glTF, OBJ, STL', command: 'fbxViewer.convert' },
    { id: 'assetCheck', title: 'Asset check report', command: 'fbxViewer.assetCheck' },
    { id: 'renderExport', title: 'Render export', command: 'fbxViewer.renderExport' },
  ],
};
