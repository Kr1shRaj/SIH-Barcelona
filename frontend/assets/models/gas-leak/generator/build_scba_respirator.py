import struct
import json
import math
import os

# helper to pack binary GLB — same pattern as build_safety_harness.py
def build_glb(meshes_data, materials):
    bin_chunks = bytearray()
    accessors = []
    buffer_views = []
    primitives = []

    for mesh in meshes_data:
        verts = mesh["vertices"]
        norms = mesh["normals"]
        idxs = mesh["indices"]

        # pack positions
        pos_offset = len(bin_chunks)
        for v in verts:
            bin_chunks += struct.pack("<fff", v[0], v[1], v[2])
        pos_length = len(bin_chunks) - pos_offset

        # pack normals
        norm_offset = len(bin_chunks)
        for n in norms:
            bin_chunks += struct.pack("<fff", n[0], n[1], n[2])
        norm_length = len(bin_chunks) - norm_offset

        # pack indices
        idx_offset = len(bin_chunks)
        for i in idxs:
            bin_chunks += struct.pack("<H", i)
        idx_length = len(bin_chunks) - idx_offset
        # pad to 4-byte boundary
        while len(bin_chunks) % 4 != 0:
            bin_chunks += b'\x00'

        bv_pos = len(buffer_views)
        buffer_views.append({"buffer": 0, "byteOffset": pos_offset, "byteLength": pos_length, "target": 34962})
        bv_norm = len(buffer_views)
        buffer_views.append({"buffer": 0, "byteOffset": norm_offset, "byteLength": norm_length, "target": 34962})
        bv_idx = len(buffer_views)
        buffer_views.append({"buffer": 0, "byteOffset": idx_offset, "byteLength": idx_length, "target": 34963})

        # compute bounding box
        xs = [v[0] for v in verts]
        ys = [v[1] for v in verts]
        zs = [v[2] for v in verts]

        acc_pos = len(accessors)
        accessors.append({
            "bufferView": bv_pos, "byteOffset": 0, "componentType": 5126,
            "count": len(verts), "type": "VEC3",
            "min": [min(xs), min(ys), min(zs)],
            "max": [max(xs), max(ys), max(zs)]
        })
        acc_norm = len(accessors)
        accessors.append({
            "bufferView": bv_norm, "byteOffset": 0, "componentType": 5126,
            "count": len(norms), "type": "VEC3"
        })
        acc_idx = len(accessors)
        accessors.append({
            "bufferView": bv_idx, "byteOffset": 0, "componentType": 5123,
            "count": len(idxs), "type": "SCALAR"
        })

        primitives.append({
            "attributes": {"POSITION": acc_pos, "NORMAL": acc_norm},
            "indices": acc_idx,
            "material": mesh["material_idx"]
        })

    gltf = {
        "asset": {"version": "2.0", "generator": "SafeAR Industrial Safety Asset Generator"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "SCBARespirator", "mesh": 0}],
        "meshes": [{"name": "SCBAMesh", "primitives": primitives}],
        "materials": materials,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(bin_chunks)}]
    }

    json_str = json.dumps(gltf, separators=(",", ":"))
    # pad json to 4-byte boundary
    while len(json_str) % 4 != 0:
        json_str += " "

    json_bytes = json_str.encode("utf-8")
    total_length = 12 + 8 + len(json_bytes) + 8 + len(bin_chunks)

    glb = bytearray()
    # header
    glb += struct.pack("<III", 0x46546C67, 2, total_length)
    # json chunk
    glb += struct.pack("<II", len(json_bytes), 0x4E4F534A)
    glb += json_bytes
    # bin chunk
    glb += struct.pack("<II", len(bin_chunks), 0x004E4942)
    glb += bin_chunks

    return bytes(glb)


# geometry builders

def make_cylinder(radius, height, segments, y_offset=0, z_offset=0, x_offset=0):
    """vertical cylinder centered on y axis"""
    verts = []
    norms = []
    idxs = []

    # top and bottom caps + wall
    for i in range(segments):
        a0 = 2 * math.pi * i / segments
        a1 = 2 * math.pi * ((i + 1) % segments) / segments
        c0, s0 = math.cos(a0), math.sin(a0)
        c1, s1 = math.cos(a1), math.sin(a1)

        x0, z0 = radius * c0 + x_offset, radius * s0 + z_offset
        x1, z1 = radius * c1 + x_offset, radius * s1 + z_offset
        yb = y_offset
        yt = y_offset + height

        # wall quad (2 triangles)
        base = len(verts)
        verts += [[x0, yb, z0], [x1, yb, z1], [x1, yt, z1], [x0, yt, z0]]
        norms += [[c0, 0, s0], [c1, 0, s1], [c1, 0, s1], [c0, 0, s0]]
        idxs += [base, base+1, base+2, base, base+2, base+3]

        # top cap triangle
        base = len(verts)
        verts += [[x_offset, yt, z_offset], [x0, yt, z0], [x1, yt, z1]]
        norms += [[0, 1, 0], [0, 1, 0], [0, 1, 0]]
        idxs += [base, base+1, base+2]

        # bottom cap triangle
        base = len(verts)
        verts += [[x_offset, yb, z_offset], [x1, yb, z1], [x0, yb, z0]]
        norms += [[0, -1, 0], [0, -1, 0], [0, -1, 0]]
        idxs += [base, base+1, base+2]

    return verts, norms, idxs


def make_box(w, h, d, x_off=0, y_off=0, z_off=0):
    """axis-aligned box"""
    hw, hh, hd = w/2, h/2, d/2
    cx, cy, cz = x_off, y_off + hh, z_off

    # 8 corners
    corners = [
        [cx-hw, cy-hh, cz-hd], [cx+hw, cy-hh, cz-hd],
        [cx+hw, cy+hh, cz-hd], [cx-hw, cy+hh, cz-hd],
        [cx-hw, cy-hh, cz+hd], [cx+hw, cy-hh, cz+hd],
        [cx+hw, cy+hh, cz+hd], [cx-hw, cy+hh, cz+hd],
    ]

    # 6 faces: front back left right top bottom
    faces = [
        ([4,5,6,7], [0,0,1]),   # front (+z)
        ([1,0,3,2], [0,0,-1]),  # back (-z)
        ([0,4,7,3], [-1,0,0]), # left (-x)
        ([5,1,2,6], [1,0,0]),  # right (+x)
        ([7,6,2,3], [0,1,0]),  # top (+y)
        ([0,1,5,4], [0,-1,0]), # bottom (-y)
    ]

    verts = []
    norms = []
    idxs = []
    for (fi, n) in faces:
        base = len(verts)
        for ci in fi:
            verts.append(corners[ci])
            norms.append(n)
        idxs += [base, base+1, base+2, base, base+2, base+3]

    return verts, norms, idxs


def make_sphere(radius, segments, rings, x_off=0, y_off=0, z_off=0):
    """UV sphere"""
    verts = []
    norms = []
    idxs = []

    for r in range(rings):
        phi0 = math.pi * r / rings
        phi1 = math.pi * (r + 1) / rings

        for s in range(segments):
            theta0 = 2 * math.pi * s / segments
            theta1 = 2 * math.pi * ((s + 1) % segments) / segments

            def pt(phi, theta):
                x = radius * math.sin(phi) * math.cos(theta) + x_off
                y = radius * math.cos(phi) + y_off
                z = radius * math.sin(phi) * math.sin(theta) + z_off
                nx = math.sin(phi) * math.cos(theta)
                ny = math.cos(phi)
                nz = math.sin(phi) * math.sin(theta)
                return [x, y, z], [nx, ny, nz]

            p0, n0 = pt(phi0, theta0)
            p1, n1 = pt(phi0, theta1)
            p2, n2 = pt(phi1, theta1)
            p3, n3 = pt(phi1, theta0)

            base = len(verts)
            verts += [p0, p1, p2, p3]
            norms += [n0, n1, n2, n3]
            idxs += [base, base+1, base+2, base, base+2, base+3]

    return verts, norms, idxs


def make_torus(major_r, minor_r, major_seg, minor_seg, x_off=0, y_off=0, z_off=0, rot_x=0):
    """torus ring, optionally rotated around x axis"""
    verts = []
    norms = []
    idxs = []

    for i in range(major_seg):
        a0 = 2 * math.pi * i / major_seg
        a1 = 2 * math.pi * ((i + 1) % major_seg) / major_seg

        for j in range(minor_seg):
            b0 = 2 * math.pi * j / minor_seg
            b1 = 2 * math.pi * ((j + 1) % minor_seg) / minor_seg

            def torus_pt(a, b):
                cx = (major_r + minor_r * math.cos(b)) * math.cos(a)
                cy = minor_r * math.sin(b)
                cz = (major_r + minor_r * math.cos(b)) * math.sin(a)
                nx = math.cos(b) * math.cos(a)
                ny = math.sin(b)
                nz = math.cos(b) * math.sin(a)
                # apply x rotation
                if rot_x != 0:
                    cos_r, sin_r = math.cos(rot_x), math.sin(rot_x)
                    cy2 = cy * cos_r - cz * sin_r
                    cz2 = cy * sin_r + cz * cos_r
                    ny2 = ny * cos_r - nz * sin_r
                    nz2 = ny * sin_r + nz * cos_r
                    cy, cz = cy2, cz2
                    ny, nz = ny2, nz2
                return [cx + x_off, cy + y_off, cz + z_off], [nx, ny, nz]

            p0, n0 = torus_pt(a0, b0)
            p1, n1 = torus_pt(a1, b0)
            p2, n2 = torus_pt(a1, b1)
            p3, n3 = torus_pt(a0, b1)

            base = len(verts)
            verts += [p0, p1, p2, p3]
            norms += [n0, n1, n2, n3]
            idxs += [base, base+1, base+2, base, base+2, base+3]

    return verts, norms, idxs


def merge_geometry(a, b):
    """merge two (verts, norms, idxs) tuples"""
    v, n, i = list(a[0]), list(a[1]), list(a[2])
    offset = len(v)
    v += b[0]
    n += b[1]
    i += [x + offset for x in b[2]]
    return v, n, i


def build_scba():
    """build a recognizable SCBA respirator with multiple material groups"""

    materials = [
        # 0: Yellow high-pressure cylinder
        {
            "name": "Mat_SCBA_Cylinder_Yellow",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.92, 0.70, 0.07, 1.0],
                "metallicFactor": 0.3,
                "roughnessFactor": 0.4
            }
        },
        # 1: Black backplate / harness frame
        {
            "name": "Mat_SCBA_Backplate_Black",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.08, 0.08, 0.10, 1.0],
                "metallicFactor": 0.05,
                "roughnessFactor": 0.85
            }
        },
        # 2: Steel fittings (valve, gauge, buckles)
        {
            "name": "Mat_SCBA_Steel_Fittings",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.78, 0.80, 0.83, 1.0],
                "metallicFactor": 0.92,
                "roughnessFactor": 0.15
            }
        },
        # 3: Black rubber face mask
        {
            "name": "Mat_SCBA_Mask_Rubber",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.05, 0.05, 0.07, 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.9
            }
        },
        # 4: Clear visor (slightly translucent look via lighter color)
        {
            "name": "Mat_SCBA_Visor_Clear",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.85, 0.90, 0.92, 0.7],
                "metallicFactor": 0.1,
                "roughnessFactor": 0.05
            },
            "alphaMode": "BLEND"
        },
        # 5: Yellow harness straps
        {
            "name": "Mat_SCBA_Strap_Yellow",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.85, 0.65, 0.05, 1.0],
                "metallicFactor": 0.05,
                "roughnessFactor": 0.7
            }
        },
        # 6: Red pressure gauge face
        {
            "name": "Mat_SCBA_Gauge_Red",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.85, 0.15, 0.10, 1.0],
                "metallicFactor": 0.1,
                "roughnessFactor": 0.3
            }
        },
    ]

    meshes = []

    # === COMPONENT 1: Main air cylinder (yellow) ===
    # tall vertical cylinder, the dominant visual element
    v, n, i = make_cylinder(0.055, 0.32, 16, y_offset=0.08, z_offset=0.03)
    # rounded top cap (half sphere)
    vs, ns, ids = make_sphere(0.055, 12, 6, y_off=0.40, z_off=0.03)
    # only keep top hemisphere (y > 0.40)
    top_v, top_n, top_i = [], [], []
    for idx in range(0, len(ids), 3):
        i0, i1, i2 = ids[idx], ids[idx+1], ids[idx+2]
        if vs[i0][1] >= 0.39 or vs[i1][1] >= 0.39 or vs[i2][1] >= 0.39:
            base = len(top_v)
            top_v += [vs[i0], vs[i1], vs[i2]]
            top_n += [ns[i0], ns[i1], ns[i2]]
            top_i += [base, base+1, base+2]
    v, n, i = merge_geometry((v, n, i), (top_v, top_n, top_i))
    meshes.append({"vertices": v, "normals": n, "indices": i, "material_idx": 0})

    # === COMPONENT 2: Backplate frame (black) ===
    # flat rectangular backplate behind cylinder
    v, n, i = make_box(0.14, 0.30, 0.025, z_off=-0.03, y_off=0.06)
    # bottom plate extension (sits on surface)
    v2, n2, i2 = make_box(0.15, 0.02, 0.10, y_off=0.04)
    v, n, i = merge_geometry((v, n, i), (v2, n2, i2))
    # top mounting bracket
    v2, n2, i2 = make_box(0.10, 0.025, 0.06, y_off=0.35, z_off=-0.01)
    v, n, i = merge_geometry((v, n, i), (v2, n2, i2))
    meshes.append({"vertices": v, "normals": n, "indices": i, "material_idx": 1})

    # === COMPONENT 3: Steel fittings — valve + regulator ===
    # top valve on cylinder
    v, n, i = make_cylinder(0.018, 0.04, 10, y_offset=0.44, z_offset=0.03)
    # valve wheel (small torus on top)
    vt, nt, it = make_torus(0.022, 0.005, 12, 6, y_off=0.485, z_off=0.03, rot_x=math.pi/2)
    v, n, i = merge_geometry((v, n, i), (vt, nt, it))
    # regulator connector (side of cylinder)
    vr, nr, ir = make_cylinder(0.012, 0.03, 8, y_offset=0.25, z_offset=0.09, x_offset=0.0)
    v, n, i = merge_geometry((v, n, i), (vr, nr, ir))
    # hose connector stub
    vh, nh, ih = make_cylinder(0.008, 0.05, 8, y_offset=0.22, z_offset=0.12)
    v, n, i = merge_geometry((v, n, i), (vh, nh, ih))
    # buckle clips on shoulder straps (left and right)
    for x_pos in [-0.06, 0.06]:
        vb, nb, ib = make_box(0.02, 0.015, 0.025, x_off=x_pos, y_off=0.18, z_off=-0.055)
        v, n, i = merge_geometry((v, n, i), (vb, nb, ib))
    meshes.append({"vertices": v, "normals": n, "indices": i, "material_idx": 2})

    # === COMPONENT 4: Face mask body (black rubber) ===
    # mask body — flattened half-sphere shape, front of assembly
    v, n, i = make_sphere(0.065, 10, 5, y_off=0.28, z_off=0.14)
    # only keep front hemisphere (z > 0.14)
    front_v, front_n, front_i = [], [], []
    for idx in range(0, len(i), 3):
        i0, i1, i2 = i[idx], i[idx+1], i[idx+2]
        if v[i0][2] >= 0.13 or v[i1][2] >= 0.13 or v[i2][2] >= 0.13:
            base = len(front_v)
            front_v += [v[i0], v[i1], v[i2]]
            front_n += [n[i0], n[i1], n[i2]]
            front_i += [base, base+1, base+2]
    # seal ring around mask edge
    vt, nt, it = make_torus(0.06, 0.008, 16, 6, y_off=0.28, z_off=0.14, rot_x=0)
    front_v2, front_n2, front_i2 = merge_geometry((front_v, front_n, front_i), (vt, nt, it))
    meshes.append({"vertices": front_v2, "normals": front_n2, "indices": front_i2, "material_idx": 3})

    # === COMPONENT 5: Clear visor (translucent) ===
    # slightly smaller sphere section for visor window
    v, n, i = make_sphere(0.050, 8, 4, y_off=0.30, z_off=0.17)
    visor_v, visor_n, visor_i = [], [], []
    for idx in range(0, len(i), 3):
        i0, i1, i2 = i[idx], i[idx+1], i[idx+2]
        if v[i0][2] >= 0.17 or v[i1][2] >= 0.17 or v[i2][2] >= 0.17:
            base = len(visor_v)
            visor_v += [v[i0], v[i1], v[i2]]
            visor_n += [n[i0], n[i1], n[i2]]
            visor_i += [base, base+1, base+2]
    meshes.append({"vertices": visor_v, "normals": visor_n, "indices": visor_i, "material_idx": 4})

    # === COMPONENT 6: Shoulder harness straps (yellow) ===
    # left strap
    v, n, i = make_box(0.025, 0.22, 0.008, x_off=-0.055, y_off=0.12, z_off=-0.04)
    # right strap
    v2, n2, i2 = make_box(0.025, 0.22, 0.008, x_off=0.055, y_off=0.12, z_off=-0.04)
    v, n, i = merge_geometry((v, n, i), (v2, n2, i2))
    # waist belt
    v2, n2, i2 = make_box(0.16, 0.03, 0.008, y_off=0.10, z_off=-0.055)
    v, n, i = merge_geometry((v, n, i), (v2, n2, i2))
    meshes.append({"vertices": v, "normals": n, "indices": i, "material_idx": 5})

    # === COMPONENT 7: Pressure gauge (red face) ===
    v, n, i = make_cylinder(0.015, 0.008, 10, y_offset=0.42, z_offset=0.08)
    # gauge face (small red disk)
    v2, n2, i2 = make_cylinder(0.013, 0.002, 10, y_offset=0.428, z_offset=0.08)
    v, n, i = merge_geometry((v, n, i), (v2, n2, i2))
    meshes.append({"vertices": v, "normals": n, "indices": i, "material_idx": 6})

    return build_glb(meshes, materials)


if __name__ == "__main__":
    glb_data = build_scba()
    target = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scba_respirator.glb")
    with open(target, "wb") as f:
        f.write(glb_data)

    size_kb = len(glb_data) / 1024
    print(f"SCBA RESPIRATOR BUILT. {len(glb_data)} bytes ({size_kb:.1f} KB). SAVED: {target}")
    print(f"Components: cylinder, backplate, valve+regulator, mask, visor, straps, gauge")
    print(f"Materials: 7 PBR (yellow cylinder, black backplate, steel fittings, rubber mask, clear visor, yellow straps, red gauge)")
