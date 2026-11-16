# FBX Viewer & DAE, 3DS Preview 0.1.0 (zovo.zovo-fbx-viewer)

New listing, staged only. NICHE7 row 3, built by lane NEWB14.

- vsix: out/NEWB14-dist/zovo.zovo-fbx-viewer/zovo.zovo-fbx-viewer-0.1.0.vsix
- sha256: 53ffc56ab98d9fd09733c84848d87690174d37469b0db07d906e61215a0be038 (549,628 bytes, 42 files)
- Product repo: factory/products/fbx-viewer-vscode, local commits only (no remote).
- Unit tests: 244 of 244 pass with `npm test` (scripts/test.js); `node --test` in the repo root runs 246 of 246.
- Real-app gate: VS Code 1.142.0 on port 9453 through buildslot, run r1 on this exact vsix: 99 PASS, 0 FAIL (out/NEWB14-data/fbx/fbx-gate-r1.json and .tsv, screenshots in out/NEWB14-data/fbx/shots/fbx-r1-*.png).

## What it is

- Display name: FBX Viewer & DAE, 3DS Preview (29 characters). The description starts with "FBX viewer". Keywords: fbx, collada, 3d viewer, 3d model, game assets. Engines ^1.75.0.
- Free core: a custom editor (priority default) for *.fbx, *.dae and *.3ds. None of these is claimed by the Zovo 3D Model Viewer, which keeps .stl .obj .ply .glb .gltf .3mf. Orbit, pan, zoom and Fit. Grid, axes, wireframe, normals, bounds and skeleton toggles. Theme, dark or light background, and Y or Z up. A clip bar with the clip list, play and pause, timeline, speed and loop. A panel with the model facts, the scene tree with bones, the materials, and the textures (missing files listed by name). Textures load from the model folder and its direct subfolders, TGA included. An FBX file older than 7.0 gets a note with its version and how to export it again.
- Zovo Pro tools (1 free try each; module 2026-11-15.conv2, listing tag "fbx", tries key fbxViewer.proTrial, TRIAL_USES = 1 in src/pro.js):
  - Convert to GLB, glTF, OBJ (with .mtl) or STL, one file at a time.
  - Asset check report: triangle budget, texture sizes, missing files, power of two, non-uniform or mirrored scale, flipped normals, unused material slots, bones per mesh. Saved as Markdown or CSV.
  - Render export: a PNG at a picked size up to 8192 px, with an optional transparent background, or an 8-frame animation strip.
- Not built from the row: converting a whole folder at once, a turntable GIF, and the side-by-side compare (row tool 4).
- Nothing pops up on open. The webview CSP is default-src 'none' with nonce scripts and no connect-src. The model and texture bytes come from the extension host. The extension makes no network calls.
- Vendored: three.js 0.187.0 with its add-ons, MIT, in lib/three-bundle.js (with fflate, MIT). One fix is applied to FBXLoader while bundling (scripts/build-vendor.js): a UV or vertex color layer marked IndexToDirect that has no index array is read as Direct. Before the fix, the real assimp box.fbx (FBX SDK 2017) failed with "Cannot read properties of undefined (reading 'a')".

## Samples

- Shipped (ours, MIT): samples/robot-arm.fbx (binary FBX 7.4 from Blender 5.2, made by scripts/make-robot.py: 3 meshes, 4 bones, clips Wave and Turn), crate.fbx (ASCII FBX 7.4) with crate.png, lantern.dae with lantern-glass.png, and desk.3ds. All come from scripts/make-samples.mjs except the robot.
- Test fixtures (ours, not in the vsix): an FBX 6.1 ASCII file and a 6.1 binary header, broken.fbx, empty.dae, not-collada.dae, cut.3ds, and missing-texture.fbx. The last one has a path from another computer and a header that the three.js ASCII check refuses.
- Gate only (not shipped, in newb14-work/fbx/dl, 1.8 MB, never executed), from https://github.com/assimp/assimp (raw.githubusercontent.com/assimp/assimp/master/test/models/...). The repo license is BSD-3-Clause; the Collada folder is under the SCEA Shared Source License (its licence.md):
  - FBX/spider.fbx, box.fbx, animation_with_skeleton.fbx, huesitos.fbx, box_orphant_embedded_texture.fbx (ASCII 7.5), boxWithCompressedCTypeArray.FBX (7.5)
  - Collada/duck.dae with duckCM.tga, library_animation_clips.dae, teapot_instancenodes.DAE
  - 3DS/test1.3ds, fels.3ds, RotatingCube.3DS, cube_with_diffuse_texture.3DS with test.png

## Gate coverage (r1)

- Robot arm: the format, creator, triangles, bones, clips and meshes match a binary FBX reader written for the gate. The canvas draws (pixel probe). The tree has 4 bones. Clips play, pause, seek, play at 2× and play once with loop off. Skeleton, wireframe, normals, bounds, grid, the light background, orbit, zoom and Fit all change the drawing.
- Webview engine checks (the same job code, not counted as tool uses): glTF export (3 meshes, skin, 2 clips), STL (516 triangles), OBJ (516 faces) and an 8-frame transparent strip in which every frame differs.
- Our crate, lantern and desk files: triangles and textures, with sizes read from the PNG headers. The Collada clip shows in the clip bar, and 3DS opens Z up with CRATE.PNG matched.
- Fixtures: the refused ASCII FBX opens; the missing texture is listed by name; both FBX 6.1 files show the version note; four broken files show plain messages.
- 13 real files open by default and draw. Triangle and bone counts match the gate's own readers. The spider's 4 missing JPGs are listed. The duck's TGA loads at 512 × 512. TEST.PNG matches test.png. The test1.3ds JPG maps are listed as missing. Upper-case extensions (.FBX, .DAE, .3DS) open by default.
- Explorer right-click on RotatingCube.3DS shows "Open in FBX Viewer" and the 3 "Zovo Pro: ..." entries. The sample command opens the bundled robot.
- Pro: Convert from the toolbar row writes robot-arm.glb (glTF 2.0, 3 meshes, 1 skin, 2 clips, 3 materials, 516 triangles); the 2nd use on crate.fbx shows the Pro panel. The asset check comes from an Explorer right-click on spider.fbx: the report fails each missing texture, and Markdown and CSV are saved; the 2nd use on desk.3ds shows the panel. Render export from the toolbar row writes a 1920 × 1080 RGBA PNG with a transparent background; the 2nd use on lantern.dae shows the panel. The info tab (palette) lists the 3 tools with "no free tries left". After a VS Code restart, the row shows "0 tries left" 3 times and Convert opens the panel.
- At the end: no error toasts, no notification from the extension, no CSP violation, no webview network request, no extension-host socket, no webview console error, and no URL opened.

## Known limits

- FBX older than 7.0 is not drawn; it gets a note.
- Convert works on one file at a time. OBJ and STL hold no animation, and STL takes the pose shown at the time.
- Embedded TGA textures inside a binary FBX are not decoded. TGA files next to the model are.
- The size is shown in model units; the FBX unit scale is not read.
- "Unused material slots" covers slots on a mesh that no face uses. Materials defined in the file but never assigned are not listed, because the loaders drop them.
