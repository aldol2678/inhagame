"""Non-destructive activity additions to supported, already exported INHA GLBs."""
import struct
from pathlib import Path
from tempfile import TemporaryDirectory
from shutil import copyfileobj

if __package__:
    from . import activity
else:
    import activity


def _open_inha(source):
    source=Path(source)
    if source.suffix.lower()!='.glb' or not source.is_file():
        raise ValueError('기존 INHA NPC GLB 파일을 선택하세요.')
    with source.open('rb') as f:
        header=f.read(20)
        if len(header)!=20:
            raise ValueError('GLB 헤더가 없거나 파일이 잘렸어요.')
        magic,version,total,json_len,json_type=struct.unpack('<4sIIII',header)
        if (magic,version,json_type)!=(b'glTF',2,0x4e4f534a) or total!=source.stat().st_size or not 0<json_len<=total-28 or json_len%4:
            raise ValueError('지원되는 GLB 2.0 파일이 아니에요.')
        f.seek(json_len,1)
        bin_len,bin_type=struct.unpack('<II',f.read(8))
        if bin_type!=0x004e4942 or total!=28+json_len+bin_len or bin_len%4:
            raise ValueError('GLB 바이너리 데이터가 손상됐거나 지원하지 않는 청크가 있어요.')
    g,b=activity.read(source)
    clips={a.get('name') for a in g.get('animations',())}
    required={'Head','Chest','Hips','UpperArm.L','UpperArm.R','Forearm.L','Forearm.R','Hand.L','Hand.R'}
    joints={i for skin in g.get('skins',()) for i in skin.get('joints',())}
    names={node.get('name') for i,node in enumerate(g.get('nodes',())) if i in joints}
    buffers=g.get('buffers',[])
    if (not required<=names or not {'Idle_Breathe','Walk_In_Place'}<=clips or len(buffers)!=1
        or 'uri' in buffers[0] or not 0<=len(b)-buffers[0].get('byteLength',-4)<=3):
        raise ValueError('이 도구는 INHA NPC 생성기로 내보낸 호환 모델만 지원해요.')
    present=tuple(kind for kind in activity.ACTIVITIES if activity.CLIPS[kind] in clips)
    for kind in present:
        activity.check_activity(g,kind)
    return g,b,present


def inspect(source):
    """Return the validated presets already included in this file, in UI order."""
    return _open_inha(source)[2]


def add_to_copy(source,target,activities):
    """Keep existing clips/data; write no file for a duplicate-only request."""
    target=Path(target)
    requested=set(activities)
    if not requested or requested-set(activity.ACTIVITIES):
        raise ValueError('추가할 동작을 하나 이상 선택하세요.')
    if target.suffix.lower()!='.glb' or not target.parent.is_dir():
        raise ValueError('저장할 폴더에 새 GLB 파일 이름을 지정하세요.')
    if target.exists() or target.is_symlink():
        raise FileExistsError('원본이나 이미 있는 파일은 덮어쓰지 않아요.')
    g,b,kept=_open_inha(source)
    added=[kind for kind in activity.ACTIVITIES if kind in requested and kind not in kept]
    for kind in added:
        activity.apply_activity(g,b,kind)
    if added:
        with TemporaryDirectory(prefix='.inha-rig-',dir=target.parent) as tmp:
            staged=Path(tmp)/'validated.glb'
            activity.write(staged,g,b)
            assert set(inspect(staged))==set(kept)|set(added)
            # Exclusive create preserves even a destination created since the initial check.
            with staged.open('rb') as src, target.open('xb') as dst:
                try:
                    copyfileobj(src,dst)
                    dst.flush()
                except OSError:
                    dst.close()
                    target.unlink()
                    raise
    return {'added':added,'kept':list(kept)}
