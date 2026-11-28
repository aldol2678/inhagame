"""Regenerate daily NPCs without writing any rig, clip, socket or prop bytes."""
import json,struct,math,hashlib,sys
from pathlib import Path
base=Path(sys.argv[1]).resolve()
rows=json.loads((Path(__file__).resolve().parent/'presets'/'roster.json').read_text())
Path('models').mkdir(exist_ok=True)
Path('qa').mkdir(exist_ok=True)
styles={
 'phone-walk':({'Varsity / night navy wool':'3d657e','Varsity / dark navy knit':'263f51','Hair / ink brown':'44302c','Hair / illuminated planes':'63443b','Hair / dark roots':'34232a'},1.12,.74,.98,'compact'),
 'phone-call':({'Varsity / night navy wool':'635070','Varsity / dark navy knit':'3d314a','Hair / ink brown':'282431','Hair / illuminated planes':'433549','Hair / dark roots':'232027'},.98,1.28,1.10,'lifted side sweep'),
 'bench-sit':({'Varsity / night navy wool':'40675d','Varsity / dark navy knit':'284b45','Hair / ink brown':'533a2a','Hair / illuminated planes':'77503c','Hair / dark roots':'3a2623'},1.05,1.01,1.29,'rounded rear')}
def read(p):
 d=p.read_bytes(); n,t=struct.unpack_from('<II',d,12); assert t==0x4e4f534a
 b,t=struct.unpack_from('<II',d,20+n);assert t==0x004e4942
 return json.loads(d[20:20+n]),d[28+n:28+n+b]
def ranges(g,samples,ac):
 a=g['accessors'][ac];v=g['bufferViews'][a['bufferView']];o=v.get('byteOffset',0)+a.get('byteOffset',0); st=v.get('byteStride',12)
 assert a['type']=='VEC3' and a['componentType']==5126 and not a.get('sparse')
 for i in range(a['count']):yield o+i*st,struct.unpack_from('<3f',samples,o+i*st)
def export(p,g,b):
 j=json.dumps(g,separators=(',',':')).encode();j+=b' '*((-len(j))%4)
 p.write_bytes(struct.pack('<4sIIII',b'glTF',2,28+len(j)+len(b),len(j),0x4e4f534a)+j+struct.pack('<II',len(b),0x004e4942)+b)
def lin(h):
 s=[int(h[i:i+2],16)/255 for i in (0,2,4)]
 return [a/12.92 if a<=.04045 else ((a+.055)/1.055)**2.4 for a in s]
for row in (r for r in rows if r['kind']=='daily'):
 id=row['id'];p=base/row['asset'];g,b=read(p); out=bytearray(b); palette,scaleX,scaleY,scaleZ,groom=styles[id]
 before_anim=json.dumps(g.get('animations'),sort_keys=True); before_skin=json.dumps(g.get('skins'),sort_keys=True)
 before_nodes=json.dumps(g.get('nodes'),sort_keys=True); writes=[]
 for mat in g['materials']:
  if mat['name'] in palette:mat['pbrMetallicRoughness']['baseColorFactor']=lin(palette[mat['name']])+[1]
 for mesh in g['meshes']:
  for prim in mesh['primitives']:
   if not g['materials'][prim['material']]['name'].startswith('Hair / '):continue
   for tag,s in [('POSITION',(scaleX,scaleY,scaleZ)),('NORMAL',(1/scaleX,1/scaleY,1/scaleZ))]:
    ai=prim['attributes'][tag];changed=[]
    for off,v in ranges(g,b,ai):
     c=(-.012,1.445,-.022) if tag=='POSITION' else (0,0,0)
     q=tuple((v[k]-c[k])*s[k]+c[k] for k in range(3))
     if tag=='NORMAL':
      length=math.sqrt(sum(x*x for x in q)) or 1
      q=tuple(x/length for x in q)
     struct.pack_into('<3f',out,off,*q);changed.append(q);writes.append((off,off+12))
    if tag=='POSITION':
     g['accessors'][ai]['min']=[min(x[k] for x in changed) for k in range(3)]
     g['accessors'][ai]['max']=[max(x[k] for x in changed) for k in range(3)]
 for anim in g['animations']:
  for sampler in anim['samplers']:
   for key in ['input','output']:
    v=g['bufferViews'][g['accessors'][sampler[key]]['bufferView']];lo=v.get('byteOffset',0);hi=lo+v['byteLength']
    # Buffer views can be interleaved; byte equality is the actual clip test.
    assert b[lo:hi]==out[lo:hi],(id,anim['name'],key)
 assert json.dumps(g.get('animations'),sort_keys=True)==before_anim
 assert json.dumps(g.get('skins'),sort_keys=True)==before_skin
 assert json.dumps(g.get('nodes'),sort_keys=True)==before_nodes
 assert writes
 dst=Path('models')/(id+'.glb');export(dst,g,out)
 (Path('qa')/(id+'.json')).write_text(json.dumps({'id':id,'preset':{'mode':'preserve-skin-and-animation','hair_shape':groom,'palette':palette},'source_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'unchangedAnimations':[a['name'] for a in g['animations']], 'unchangedSkin':True,'unchangedNodes':True},indent=2)+'\n')
 print(id,groom,'all source animations and joints byte-checked')
