# Blender script for samples/robot-arm.fbx (run: blender -b --factory-startup --python scripts/make-robot.py -- samples/robot-arm.fbx).
# A small robot arm on a base, 4 bones, skinned, with two actions: Wave and Turn.
import bpy, math, sys
out = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
scn.render.fps = 24
def mat(name, rgb):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF'); b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = 0.5
    return m
# base
bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.6, depth=0.25, location=(0, 0, 0.125))
base = bpy.context.object; base.name = 'Base'; base.data.name = 'BaseMesh'; base.data.materials.append(mat('BasePaint', (0.15, 0.17, 0.22)))
# arm: a segmented column
bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.14, depth=2.4, location=(0, 0, 1.45))
arm = bpy.context.object; arm.name = 'Arm'; arm.data.name = 'ArmMesh'
import bmesh
bm = bmesh.new(); bm.from_mesh(arm.data)
for i in range(1, 12):
    z = -1.2 + i * 0.2
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, z), plane_no=(0, 0, 1))
bm.to_mesh(arm.data); bm.free()
arm.data.materials.append(mat('ArmOrange', (0.95, 0.45, 0.08)))
bpy.ops.object.shade_smooth()
# head
bpy.ops.mesh.primitive_cube_add(size=0.42, location=(0, 0, 2.85))
head = bpy.context.object; head.name = 'Gripper'; head.data.name = 'GripperMesh'; head.data.materials.append(mat('GripperSteel', (0.7, 0.72, 0.75)))
# armature
bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0.25))
rig = bpy.context.object; rig.name = 'Rig'; rig.data.name = 'RigData'
eb = rig.data.edit_bones; b0 = eb[0]; b0.name = 'Shoulder'; b0.head = (0, 0, 0); b0.tail = (0, 0, 0.8)
prev = b0
for i, nm in enumerate(['Elbow', 'Wrist', 'Hand']):
    b = eb.new(nm); b.head = prev.tail; b.tail = (0, 0, prev.tail[2] + (0.8 if i < 2 else 0.5)); b.parent = prev; b.use_connect = True; prev = b
bpy.ops.object.mode_set(mode='OBJECT')
# skin the arm and parent the gripper to the hand bone
bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
bpy.ops.object.select_all(action='DESELECT'); head.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE'); rig.data.bones.active = rig.data.bones['Hand']; bpy.ops.object.mode_set(mode='OBJECT')
head.select_set(True); bpy.ops.object.parent_set(type='BONE')
# actions
def action(name, frames, keys):
    rig.animation_data_create(); a = bpy.data.actions.new(name); rig.animation_data.action = a
    for f, pose in keys:
        for bn, (x, z) in pose.items():
            pb = rig.pose.bones[bn]; pb.rotation_mode = 'XYZ'; pb.rotation_euler = (math.radians(x), 0, math.radians(z)); pb.keyframe_insert('rotation_euler', frame=f)
    a.use_fake_user = True
    return a
wave = action('Wave', 48, [(1, {'Shoulder': (0, 0), 'Elbow': (0, 0), 'Wrist': (0, 0)}), (13, {'Shoulder': (20, 0), 'Elbow': (35, 0), 'Wrist': (25, 0)}), (25, {'Shoulder': (-20, 0), 'Elbow': (-35, 0), 'Wrist': (-25, 0)}), (37, {'Shoulder': (20, 0), 'Elbow': (35, 0), 'Wrist': (25, 0)}), (48, {'Shoulder': (0, 0), 'Elbow': (0, 0), 'Wrist': (0, 0)})])
nod = action('Turn', 36, [(1, {'Shoulder': (0, 0), 'Elbow': (0, 0), 'Wrist': (0, 0)}), (18, {'Shoulder': (0, 90), 'Elbow': (15, 0), 'Wrist': (-30, 0)}), (36, {'Shoulder': (0, 0), 'Elbow': (0, 0), 'Wrist': (0, 0)})])
rig.animation_data.action = wave
scn.frame_start = 1; scn.frame_end = 48
bpy.ops.export_scene.fbx(filepath=out, use_selection=False, object_types={'MESH', 'ARMATURE'}, add_leaf_bones=False, bake_anim=True, bake_anim_use_all_actions=True, bake_anim_use_nla_strips=False, bake_anim_simplify_factor=1.0, path_mode='STRIP', embed_textures=False, axis_forward='-Z', axis_up='Y')
print('WROTE', out)
