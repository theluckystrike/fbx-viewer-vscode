# Third-party notices

## three.js 0.187.0 (lib/three-bundle.js)

The 3D view, the FBX, Collada, 3DS and TGA loaders and the GLB, glTF, OBJ and STL exporters are three.js 0.187.0 and its add-ons (examples/jsm) by the three.js authors (https://github.com/mrdoob/three.js), from the npm package `three`, bundled into one file with esbuild (scripts/vendor-entry.mjs, scripts/build-vendor.js). License: MIT. The full license text is in lib/three-LICENSE.txt.

One change to FBXLoader.js is made while bundling (scripts/build-vendor.js): a vertex color or UV layer marked IndexToDirect that has no index array is read as Direct, so such files open instead of failing. Everything else is unchanged.

The bundle includes fflate (https://github.com/101arrowz/fflate) by Arjun Barrett, which three.js ships in examples/jsm/libs for compressed FBX arrays. License: MIT.

## Code from other Zovo extensions

The 3D view code (orbit, fit, grid, wireframe, normals, bounds, scene tree, model facts and the animation bar) is adapted from the Zovo 3D Model Viewer (STL, OBJ, glTF), MIT License, by the same author.

## Sample files

samples/robot-arm.fbx was made for this extension in Blender (scripts/make-robot.py). samples/crate.fbx, crate.png, lantern.dae, lantern-glass.png and desk.3ds, and the test files, are written by scripts/make-samples.mjs. They are part of this extension under its MIT License.
