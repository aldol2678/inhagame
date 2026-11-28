import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

GEN=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(GEN/'addon'/'inha_npc_generator'))
import patch_existing as patch

ASSETS=GEN.parents[1]/'apps/world/assets/npcs/refresh-72'
SOURCE=ASSETS/'INKYUNG_NPC_012.glb'

def snapshot(path):
    b=path.read_bytes()
    size=struct.unpack_from('<I',b,12)[0]
    return json.loads(b[20:20+size]),b[28+size:]

class ExistingPatchTests(unittest.TestCase):
    def test_add_one_activity_and_keep_original_geometry_and_clips(self):
        before=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
        with tempfile.TemporaryDirectory() as temp:
            target=Path(temp)/'new.glb'
            result=patch.add_to_copy(SOURCE,target,('coffee','phone'))
            self.assertEqual(result,{'added':['phone'],'kept':['read','coffee']})
            self.assertEqual(patch.inspect(target),('read','coffee','phone'))
            a,old_bin=snapshot(SOURCE)
            b,new_bin=snapshot(target)
            self.assertTrue(new_bin.startswith(old_bin))
            self.assertEqual(b['animations'][:len(a['animations'])],a['animations'])
            for key in ['meshes','materials','skins']:
                self.assertEqual(b[key],a[key],key)
            self.assertEqual(hashlib.sha256(SOURCE.read_bytes()).hexdigest(),before)

    def test_duplicate_only_is_noop_without_extra_output(self):
        with tempfile.TemporaryDirectory() as temp:
            target=Path(temp)/'duplicate.glb'
            self.assertEqual(patch.add_to_copy(SOURCE,target,['read','read','coffee']),
                             {'added':[],'kept':['read','coffee']})
            self.assertFalse(target.exists())

    def test_source_and_existing_target_are_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            target=Path(temp)/'occupied.glb'
            target.write_bytes(b'important')
            with self.assertRaises(FileExistsError):
                patch.add_to_copy(SOURCE,target,['photo'])
            with self.assertRaises(FileExistsError):
                patch.add_to_copy(SOURCE,SOURCE,['photo'])
            self.assertEqual(target.read_bytes(),b'important')

    def test_non_npc_and_invalid_selection_leave_no_output(self):
        with tempfile.TemporaryDirectory() as temp:
            target=Path(temp)/'new.glb'
            for source,activities in [(ASSETS.parents[1]/'life-props-v1/smartphone.glb',['phone']),
                                      (SOURCE,['absent']),(SOURCE,[])]:
                with self.assertRaises(ValueError):
                    patch.add_to_copy(source,target,activities)
                self.assertFalse(target.exists())

if __name__=='__main__':
    unittest.main()
