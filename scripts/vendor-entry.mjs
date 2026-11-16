// Entry for lib/three-bundle.js: three.js r187 and the example add-ons the viewer uses, unchanged, as one browser file.
// Build: node scripts/build-vendor.js (needs the devDependencies three and esbuild). The result is committed.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { TDSLoader } from 'three/addons/loaders/TDSLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { VertexNormalsHelper } from 'three/addons/helpers/VertexNormalsHelper.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

globalThis.ZV = { THREE, OrbitControls, FBXLoader, ColladaLoader, TDSLoader, TGALoader, GLTFExporter, OBJExporter, STLExporter, VertexNormalsHelper, RoomEnvironment, SkeletonUtils, REVISION: THREE.REVISION };
