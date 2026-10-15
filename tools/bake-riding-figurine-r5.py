"""Bake the approved private R5's translations; no geometry reduction or art changes.
Usage: python tools/bake-riding-figurine-r5.py INPUT.glb OUTPUT.glb
Keep both paths outside the repository. Only the pinned approved source is admitted.
"""
import hashlib, json, pathlib, struct, sys
source = pathlib.Path(sys.argv[1]).read_bytes()
assert hashlib.sha256(source).hexdigest() == '187b5ef18edb12f3b26c95f77a290d6fc2e0a3a386320d544ffcd17de5dd1b1b'
jlen = struct.unpack_from('<I', source, 12)[0]
doc = json.loads(source[20:20+jlen])
binary = bytearray(source[28+jlen:])
seen = set()
for node in doc['nodes']:
    assert not any(key in node for key in ('rotation', 'scale', 'matrix', 'children'))
    translation = node.pop('translation', [0, 0, 0])
    for primitive in doc['meshes'][node['mesh']]['primitives']:
        index = primitive['attributes']['POSITION']
        assert index not in seen
        seen.add(index)
        accessor = doc['accessors'][index]
        view = doc['bufferViews'][accessor['bufferView']]
        assert accessor['componentType'] == 5126 and accessor['type'] == 'VEC3'
        stride = view.get('byteStride', 12)
        offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        low, high = [float('inf')]*3, [-float('inf')]*3
        for i in range(accessor['count']):
            position = offset + i * stride
            xyz = struct.unpack_from('<3f', binary, position)
            expected = [xyz[k] + translation[k] for k in range(3)]
            struct.pack_into('<3f', binary, position, *expected)
            actual = struct.unpack_from('<3f', binary, position)
            assert max(abs(actual[k]-expected[k]) for k in range(3)) < 1e-7
            for k in range(3):
                low[k], high[k] = min(low[k], actual[k]), max(high[k], actual[k])
        accessor['min'], accessor['max'] = low, high
encoded = json.dumps(doc, separators=(',', ':'), ensure_ascii=False).encode()
encoded += b' ' * ((-len(encoded)) % 4)
output = (struct.pack('<III', 0x46546c67, 2, 28+len(encoded)+len(binary))
          + struct.pack('<II', len(encoded), 0x4e4f534a) + encoded
          + struct.pack('<II', len(binary), 0x004e4942) + binary)
assert hashlib.sha256(output).hexdigest() == '52f2746b48eeffb02e35e468a7fef65a847543c9be3f7cf8b22c9e192e6a77c6'
pathlib.Path(sys.argv[2]).write_bytes(output)
print('PASS: pinned delivery; world-space vertex difference < 1e-7 metres')
