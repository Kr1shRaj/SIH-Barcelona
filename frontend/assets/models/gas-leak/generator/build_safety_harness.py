import struct
import json
import math
import os

# Helper to pack binary GLB
def build_glb(meshes_data):
    """
    meshes_data is a list of dicts:
    {
        "name": str,
        "material_idx": int,
        "vertices": list of [x, y, z],
        "normals": list of [nx, ny, nz],
        "indices": list of int
    }
    """
    bin_chunks = bytearray()
    accessors = []
    buffer_views = []
    primitives_by_mat = {}

    materials = [
        # 0: Safety Lime Webbing (High-vis polyester)
        {
            "name": "Mat_SafetyWebbing_Lime",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.52, 0.80, 0.09, 1.0],
                "metallicFactor": 0.05,
                "roughnessFactor": 0.65
            }
        },
        # 1: Safety Orange Webbing (High-vis leg/accent webbing)
        {
            "name": "Mat_SafetyWebbing_Orange",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.97, 0.45, 0.09, 1.0],
                "metallicFactor": 0.05,
                "roughnessFactor": 0.65
            }
        },
        # 2: Industrial Black (Ballistic nylon pad / waist support)
        {
            "name": "Mat_Industrial_Black",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.12, 0.16, 0.23, 1.0],
                "metallicFactor": 0.1,
                "roughnessFactor": 0.8
            }
        },
        # 3: Forged Steel (D-Rings, buckles, snap hooks)
        {
            "name": "Mat_Forged_Steel",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.89, 0.91, 0.94, 1.0],
                "metallicFactor": 0.92,
                "roughnessFactor": 0.18
            }
        },
        # 4: Reflective Silver Stripe
        {
            "name": "Mat_Reflective_Silver",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.96, 0.98, 1.0, 1.0],
                "metallicFactor": 0.4,
                "roughnessFactor": 0.15
            }
        }
    ]

    all_primitives = []

    for mesh in meshes_data:
        v_data = bytearray()
        n_data = bytearray()
        i_data = bytearray()

        min_pos = [float('inf')]*3
        max_pos = [float('-inf')]*3

        for v in mesh["vertices"]:
            v_data.extend(struct.pack('<3f', *v))
            for i in range(3):
                min_pos[i] = min(min_pos[i], v[i])
                max_pos[i] = max(max_pos[i], v[i])

        for n in mesh["normals"]:
            n_data.extend(struct.pack('<3f', *n))

        for idx in mesh["indices"]:
            i_data.extend(struct.pack('<H', idx))

        # align to 4 bytes
        while len(v_data) % 4 != 0: v_data.append(0)
        while len(n_data) % 4 != 0: n_data.append(0)
        while len(i_data) % 4 != 0: i_data.append(0)

        # BufferView & Accessor for Position
        pos_offset = len(bin_chunks)
        bin_chunks.extend(v_data)
        buffer_views.append({
            "buffer": 0,
            "byteOffset": pos_offset,
            "byteLength": len(v_data),
            "target": 34962 # ARRAY_BUFFER
        })
        pos_acc_idx = len(accessors)
        accessors.append({
            "bufferView": len(buffer_views) - 1,
            "byteOffset": 0,
            "componentType": 5126, # FLOAT
            "count": len(mesh["vertices"]),
            "type": "VEC3",
            "min": min_pos,
            "max": max_pos
        })

        # BufferView & Accessor for Normal
        norm_offset = len(bin_chunks)
        bin_chunks.extend(n_data)
        buffer_views.append({
            "buffer": 0,
            "byteOffset": norm_offset,
            "byteLength": len(n_data),
            "target": 34962
        })
        norm_acc_idx = len(accessors)
        accessors.append({
            "bufferView": len(buffer_views) - 1,
            "byteOffset": 0,
            "componentType": 5126,
            "count": len(mesh["normals"]),
            "type": "VEC3"
        })

        # BufferView & Accessor for Indices
        idx_offset = len(bin_chunks)
        bin_chunks.extend(i_data)
        buffer_views.append({
            "buffer": 0,
            "byteOffset": idx_offset,
            "byteLength": len(i_data),
            "target": 34963 # ELEMENT_ARRAY_BUFFER
        })
        idx_acc_idx = len(accessors)
        accessors.append({
            "bufferView": len(buffer_views) - 1,
            "byteOffset": 0,
            "componentType": 5123, # UNSIGNED_SHORT
            "count": len(mesh["indices"]),
            "type": "SCALAR"
        })

        all_primitives.append({
            "attributes": {
                "POSITION": pos_acc_idx,
                "NORMAL": norm_acc_idx
            },
            "indices": idx_acc_idx,
            "material": mesh["material_idx"]
        })

    gltf_json = {
        "asset": {
            "version": "2.0",
            "generator": "SafeAR Industrial Safety Asset Generator"
        },
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{
            "name": "FullBodySafetyHarness",
            "mesh": 0
        }],
        "meshes": [{
            "name": "SafetyHarnessMesh",
            "primitives": all_primitives
        }],
        "materials": materials,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{
            "byteLength": len(bin_chunks)
        }]
    }

    json_str = json.dumps(gltf_json, separators=(',', ':'))
    json_bytes = json_str.encode('utf-8')
    while len(json_bytes) % 4 != 0:
        json_bytes += b' '

    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_chunks)
    glb = bytearray()
    # Header
    glb.extend(struct.pack('<4sII', b'glTF', 2, total_len))
    # Chunk 0 (JSON)
    glb.extend(struct.pack('<II', len(json_bytes), 0x4E4F534A))
    glb.extend(json_bytes)
    # Chunk 1 (BIN)
    glb.extend(struct.pack('<II', len(bin_chunks), 0x004E4942))
    glb.extend(bin_chunks)

    return glb


# Geometry Generators
def add_box(vertices, normals, indices, dx, dy, dz, cx=0, cy=0, cz=0, rot_x=0, rot_y=0, rot_z=0):
    base_idx = len(vertices)
    hx, hy, hz = dx/2, dy/2, dz/2

    corners = [
        # Front (+Z)
        (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz),
        # Back (-Z)
        (hx, -hy, -hz), (-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz),
        # Top (+Y)
        (-hx, hy, hz), (hx, hy, hz), (hx, hy, -hz), (-hx, hy, -hz),
        # Bottom (-Y)
        (-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz), (-hx, -hy, hz),
        # Right (+X)
        (hx, -hy, hz), (hx, -hy, -hz), (hx, hy, -hz), (hx, hy, hz),
        # Left (-X)
        (-hx, -hy, -hz), (-hx, -hy, hz), (-hx, hy, hz), (-hx, hy, -hz)
    ]

    face_normals = [
        (0, 0, 1), (0, 0, 1), (0, 0, 1), (0, 0, 1),
        (0, 0, -1), (0, 0, -1), (0, 0, -1), (0, 0, -1),
        (0, 1, 0), (0, 1, 0), (0, 1, 0), (0, 1, 0),
        (0, -1, 0), (0, -1, 0), (0, -1, 0), (0, -1, 0),
        (1, 0, 0), (1, 0, 0), (1, 0, 0), (1, 0, 0),
        (-1, 0, 0), (-1, 0, 0), (-1, 0, 0), (-1, 0, 0)
    ]

    # Apply rotations then translation
    cos_x, sin_x = math.cos(rot_x), math.sin(rot_x)
    cos_y, sin_y = math.cos(rot_y), math.sin(rot_y)
    cos_z, sin_z = math.cos(rot_z), math.sin(rot_z)

    def transform(x, y, z):
        # rot x
        y1 = y * cos_x - z * sin_x
        z1 = y * sin_x + z * cos_x
        # rot y
        x2 = x * cos_y + z1 * sin_y
        z2 = -x * sin_y + z1 * cos_y
        # rot z
        x3 = x2 * cos_z - y1 * sin_z
        y3 = x2 * sin_z + y1 * cos_z
        z3 = z2
        return (x3 + cx, y3 + cy, z3 + cz)

    def rot_normal(nx, ny, nz):
        y1 = ny * cos_x - nz * sin_x
        z1 = ny * sin_x + nz * cos_x
        x2 = nx * cos_y + z1 * sin_y
        z2 = -nx * sin_y + z1 * cos_y
        x3 = x2 * cos_z - y1 * sin_z
        y3 = x2 * sin_z + y1 * cos_z
        z3 = z2
        return (x3, y3, z3)

    for c in corners:
        vertices.append(transform(*c))

    for fn in face_normals:
        normals.append(rot_normal(*fn))

    for f in range(6):
        b = base_idx + f * 4
        indices.extend([b, b+1, b+2, b, b+2, b+3])


def add_torus(vertices, normals, indices, major_r, minor_r, cx=0, cy=0, cz=0, seg_major=16, seg_minor=8, rot_x=0, rot_y=0, rot_z=0):
    base_idx = len(vertices)
    cos_x, sin_x = math.cos(rot_x), math.sin(rot_x)
    cos_y, sin_y = math.cos(rot_y), math.sin(rot_y)
    cos_z, sin_z = math.cos(rot_z), math.sin(rot_z)

    def transform(x, y, z):
        y1 = y * cos_x - z * sin_x
        z1 = y * sin_x + z * cos_x
        x2 = x * cos_y + z1 * sin_y
        z2 = -x * sin_y + z1 * cos_y
        x3 = x2 * cos_z - y1 * sin_z
        y3 = x2 * sin_z + y1 * cos_z
        z3 = z2
        return (x3 + cx, y3 + cy, z3 + cz)

    def rot_normal(nx, ny, nz):
        y1 = ny * cos_x - nz * sin_x
        z1 = ny * sin_x + nz * cos_x
        x2 = nx * cos_y + z1 * sin_y
        z2 = -nx * sin_y + z1 * cos_y
        x3 = x2 * cos_z - y1 * sin_z
        y3 = x2 * sin_z + y1 * cos_z
        z3 = z2
        return (x3, y3, z3)

    for i in range(seg_major):
        theta = 2.0 * math.pi * i / seg_major
        cos_t, sin_t = math.cos(theta), math.sin(theta)

        for j in range(seg_minor):
            phi = 2.0 * math.pi * j / seg_minor
            cos_p, sin_p = math.cos(phi), math.sin(phi)

            x = (major_r + minor_r * cos_p) * cos_t
            y = (major_r + minor_r * cos_p) * sin_t
            z = minor_r * sin_p

            nx = cos_p * cos_t
            ny = cos_p * sin_t
            nz = sin_p

            vertices.append(transform(x, y, z))
            normals.append(rot_normal(nx, ny, nz))

    for i in range(seg_major):
        next_i = (i + 1) % seg_major
        for j in range(seg_minor):
            next_j = (j + 1) % seg_minor
            p1 = base_idx + i * seg_minor + j
            p2 = base_idx + next_i * seg_minor + j
            p3 = base_idx + next_i * seg_minor + next_j
            p4 = base_idx + i * seg_minor + next_j
            indices.extend([p1, p2, p3, p1, p3, p4])


def generate_industrial_safety_harness():
    meshes = []

    # 1. High-Vis Lime Shoulder Webbing & Straps (Mat 0)
    lime_v, lime_n, lime_i = [], [], []

    # Front Left Shoulder Strap (down to waist)
    add_box(lime_v, lime_n, lime_i, 0.045, 0.28, 0.008, cx=-0.11, cy=0.34, cz=0.07, rot_z=-0.04)
    # Front Right Shoulder Strap (down to waist)
    add_box(lime_v, lime_n, lime_i, 0.045, 0.28, 0.008, cx=0.11, cy=0.34, cz=0.07, rot_z=0.04)

    # Over-Shoulder Arch Left
    add_box(lime_v, lime_n, lime_i, 0.045, 0.008, 0.14, cx=-0.11, cy=0.48, cz=0.0)
    # Over-Shoulder Arch Right
    add_box(lime_v, lime_n, lime_i, 0.045, 0.008, 0.14, cx=0.11, cy=0.48, cz=0.0)

    # Back Crossing Strap Left-to-Right (X-Back)
    add_box(lime_v, lime_n, lime_i, 0.042, 0.32, 0.008, cx=0.0, cy=0.34, cz=-0.07, rot_z=0.42)
    # Back Crossing Strap Right-to-Left (X-Back)
    add_box(lime_v, lime_n, lime_i, 0.042, 0.32, 0.008, cx=0.0, cy=0.34, cz=-0.075, rot_z=-0.42)

    # Chest Cross-Strap
    add_box(lime_v, lime_n, lime_i, 0.22, 0.035, 0.007, cx=0.0, cy=0.36, cz=0.072)

    # Sub-pelvic support strap under hips
    add_box(lime_v, lime_n, lime_i, 0.26, 0.04, 0.01, cx=0.0, cy=0.12, cz=-0.04)

    meshes.append({
        "name": "Webbing_Lime",
        "material_idx": 0,
        "vertices": lime_v,
        "normals": lime_n,
        "indices": lime_i
    })

    # 2. Safety Orange Leg & Thigh Webbing (Mat 1)
    org_v, org_n, org_i = [], [], []

    # Left Leg Thigh Loop (Front, Back, Outer, Inner)
    add_box(org_v, org_n, org_i, 0.11, 0.042, 0.008, cx=-0.09, cy=0.08, cz=0.06)
    add_box(org_v, org_n, org_i, 0.11, 0.042, 0.008, cx=-0.09, cy=0.08, cz=-0.06)
    add_box(org_v, org_n, org_i, 0.008, 0.042, 0.12, cx=-0.145, cy=0.08, cz=0.0)
    add_box(org_v, org_n, org_i, 0.008, 0.042, 0.12, cx=-0.035, cy=0.08, cz=0.0)

    # Right Leg Thigh Loop
    add_box(org_v, org_n, org_i, 0.11, 0.042, 0.008, cx=0.09, cy=0.08, cz=0.06)
    add_box(org_v, org_n, org_i, 0.11, 0.042, 0.008, cx=0.09, cy=0.08, cz=-0.06)
    add_box(org_v, org_n, org_i, 0.008, 0.042, 0.12, cx=0.145, cy=0.08, cz=0.0)
    add_box(org_v, org_n, org_i, 0.008, 0.042, 0.12, cx=0.035, cy=0.08, cz=0.0)

    # Vertical Connecting Straps (Waist to Leg Loops)
    add_box(org_v, org_n, org_i, 0.035, 0.12, 0.008, cx=-0.10, cy=0.14, cz=0.065)
    add_box(org_v, org_n, org_i, 0.035, 0.12, 0.008, cx=0.10, cy=0.14, cz=0.065)

    # Attached Shock Absorber Lanyard Ribbon
    add_box(org_v, org_n, org_i, 0.035, 0.22, 0.008, cx=0.0, cy=0.26, cz=-0.12, rot_x=-0.1)

    meshes.append({
        "name": "Webbing_Orange",
        "material_idx": 1,
        "vertices": org_v,
        "normals": org_n,
        "indices": org_i
    })

    # 3. Industrial Black Heavy Belt & Back Dorsal Pad (Mat 2)
    blk_v, blk_n, blk_i = [], [], []

    # Waist Support Belt (Front, Back, Sides)
    add_box(blk_v, blk_n, blk_i, 0.28, 0.055, 0.012, cx=0.0, cy=0.20, cz=0.075)
    add_box(blk_v, blk_n, blk_i, 0.28, 0.065, 0.014, cx=0.0, cy=0.20, cz=-0.078)
    add_box(blk_v, blk_n, blk_i, 0.012, 0.055, 0.15, cx=-0.14, cy=0.20, cz=0.0)
    add_box(blk_v, blk_n, blk_i, 0.012, 0.055, 0.15, cx=0.14, cy=0.20, cz=0.0)

    # Dorsal Back Pad (Diamond / Hex pad holding dorsal D-ring)
    add_box(blk_v, blk_n, blk_i, 0.12, 0.12, 0.015, cx=0.0, cy=0.37, cz=-0.082, rot_z=0.785)

    # Lanyard Tear Shock Pack (Attached to dorsal D-ring)
    add_box(blk_v, blk_n, blk_i, 0.06, 0.14, 0.045, cx=0.0, cy=0.34, cz=-0.11)

    meshes.append({
        "name": "Industrial_Black",
        "material_idx": 2,
        "vertices": blk_v,
        "normals": blk_n,
        "indices": blk_i
    })

    # 4. Forged Steel Hardware, D-Rings, Buckles & Snap Hook (Mat 3)
    stl_v, stl_n, stl_i = [], [], []

    # Dorsal Fall Arrest D-Ring (Torus on back angled for lifeline)
    add_torus(stl_v, stl_n, stl_i, major_r=0.038, minor_r=0.007, cx=0.0, cy=0.39, cz=-0.09, rot_x=math.pi*0.35)

    # Left & Right Work Positioning D-Rings on Waist Belt
    add_torus(stl_v, stl_n, stl_i, major_r=0.028, minor_r=0.005, cx=-0.15, cy=0.20, cz=0.0, rot_y=math.pi/2)
    add_torus(stl_v, stl_n, stl_i, major_r=0.028, minor_r=0.005, cx=0.15, cy=0.20, cz=0.0, rot_y=math.pi/2)

    # Chest Buckle (Quick connect male & female plates)
    add_box(stl_v, stl_n, stl_i, 0.045, 0.04, 0.012, cx=0.0, cy=0.36, cz=0.078)

    # Waist Belt Main Buckle
    add_box(stl_v, stl_n, stl_i, 0.055, 0.06, 0.014, cx=0.0, cy=0.20, cz=0.084)

    # Left & Right Leg Buckles
    add_box(stl_v, stl_n, stl_i, 0.04, 0.04, 0.012, cx=-0.09, cy=0.08, cz=0.066)
    add_box(stl_v, stl_n, stl_i, 0.04, 0.04, 0.012, cx=0.09, cy=0.08, cz=0.066)

    # Forged Scaffold Snap Hook at End of Lanyard
    # Hook body (curved ring)
    add_torus(stl_v, stl_n, stl_i, major_r=0.032, minor_r=0.006, cx=0.0, cy=0.13, cz=-0.13, rot_y=math.pi/2)
    # Hook spine & latch
    add_box(stl_v, stl_n, stl_i, 0.015, 0.07, 0.02, cx=0.0, cy=0.14, cz=-0.11)

    meshes.append({
        "name": "Forged_Steel",
        "material_idx": 3,
        "vertices": stl_v,
        "normals": stl_n,
        "indices": stl_i
    })

    # 5. Silver Retro-Reflective Safety Stripes (Mat 4)
    ref_v, ref_n, ref_i = [], [], []

    # Front Left Reflective Stripe
    add_box(ref_v, ref_n, ref_i, 0.022, 0.22, 0.001, cx=-0.11, cy=0.34, cz=0.075, rot_z=-0.04)
    # Front Right Reflective Stripe
    add_box(ref_v, ref_n, ref_i, 0.022, 0.22, 0.001, cx=0.11, cy=0.34, cz=0.075, rot_z=0.04)
    # Chest Reflective Stripe
    add_box(ref_v, ref_n, ref_i, 0.18, 0.015, 0.001, cx=0.0, cy=0.36, cz=0.076)

    meshes.append({
        "name": "Reflective_Stripes",
        "material_idx": 4,
        "vertices": ref_v,
        "normals": ref_n,
        "indices": ref_i
    })

    return meshes


if __name__ == "__main__":
    meshes = generate_industrial_safety_harness()
    glb_data = build_glb(meshes)
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "safety_harness.glb")
    with open(out_path, "wb") as f:
        f.write(glb_data)
    print(f"Generated {out_path} ({len(glb_data)} bytes)")
