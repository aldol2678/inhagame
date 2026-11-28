import bpy,sys,json,os,math,hashlib
from pathlib import Path
D=Path.cwd()
source=Path(os.environ.get('INHA_GENERATOR_DIR',Path(__file__).resolve().parent)).resolve()
sys.path.insert(0,str(source/'addon'))
from inha_npc_generator import core,groom
from inha_npc_generator.activity import ROSTER_RIGS, check_activity, decorate, read
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils import Color
rows=json.loads((source/'presets'/'roster.json').read_text())
a=[s for s in rows if s['kind']!='daily']
shard,total=map(int,sys.argv[sys.argv.index('--')+1:])
assert 0 <= shard < total
(D/'models').mkdir(exist_ok=True)
(D/'qa').mkdir(exist_ok=True)
styles={
 'coat':('#364959','#51878c','#d2d4c2'),
 'jacket':('#425f83','#9a5c49','#e3c58c'),
 'cardigan':('#4e735c','#8d5667','#dfc08a'),
 'apron':('#637f6f','#6d5843','#d9bb87'),
 'hoodie':('#665e82','#3d6578','#dfbf77'),
 'shirt':('#aaa18c','#788d9d','#7d4438'),
 'sweater':('#8b5f4d','#655e81','#96ada4')}
skins=['e9c7ae','d1ab8d','aa8068','e9d0bf']; hairs=['242129','35252c','473126','5a4038','2a2630','49362c','302b37','634130','777076']
def tint(m,h):
 b=m.node_tree.nodes.get('Principled BSDF') if m.use_nodes else None
 c=(*groom.linear(h.lstrip('#')),1);m.diffuse_color=c
 if b is not None:b.inputs['Base Color'].default_value=c
def accessory(r,name,color):
 if name not in ('apron','badge','backpack','messenger','scarf'):return
 mat=core.material('Campus / '+name,color.lstrip('#'))
 defs={
  'apron':[('Apron',(.0,-.145,1.06),(.24,.028,.37)),('Pocket',(.0,-.165,1.03),(.15,.018,.092))],
  'badge':[('Badge',(-.088,-.135,1.265),(.054,.018,.037))],
  'backpack':[('Backpack',(0,.129,1.15),(.235,.125,.31)),('Backpack seam',(0,.196,1.145),(.13,.019,.20))],
  'messenger':[('Messenger pouch',(.17,.105,.96),(.155,.125,.19))],
  'scarf':[('Scarf collar',(0,-.022,1.412),(.21,.22,.066)),('Scarf end',(.053,-.133,1.30),(.064,.028,.19))]
 }
 for n,pos,width in defs[name]:
  bpy.ops.mesh.primitive_cube_add(size=1,location=pos);o=bpy.context.object;o.name='NPC_Wearable_'+n
  o.dimensions=width;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
  bpy.ops.object.modifier_add(type='BEVEL');o.modifiers[-1].width=.008;o.modifiers[-1].segments=2
  bpy.ops.object.modifier_apply(modifier=o.modifiers[-1].name)
  o.data.materials.append(mat);o.parent=r
  o.vertex_groups.new(name='Spine2').add(list(range(len(o.data.vertices))),1,'REPLACE')
  mod=o.modifiers.new('Spine','ARMATURE');mod.object=r
for i,rec in enumerate(a):
 if i%total!=shard:continue
 npc=rec['id'];stem=npc.replace('-','_');dst=D/'models'/f'{stem}.glb';spec_path=D/'qa'/f'{stem}.json'
 if dst.exists() and spec_path.exists():
  kinds=ROSTER_RIGS.get(npc,())
  if kinds:
   g,_=read(dst)
   try:
    for kind in kinds:check_activity(g,kind)
   except ValueError:
    tmp=dst.with_suffix('.resume.glb')
    decorate(dst,tmp,kinds)
    tmp.replace(dst)
   spec=json.loads(spec_path.read_text());spec['activityRigs']=list(kinds)
   spec_path.write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
  continue
 seed=int.from_bytes(hashlib.sha256(npc.encode()).digest()[:8],'big')
 style=rec['style'];p=style.get('profile',{})
 female=style.get('presentation')=='female'
 clothing=style.get('outfit_style') or ['hoodie','jacket','shirt','cardigan'][i%4]
 primary=style.get('accessory','badge' if rec['kind']=='service' else '')
 if rec['kind']=='event' and not style:
  primary=['badge','','glasses','messenger','headphones','scarf','backpack','badge','glasses'][i%9]
 outfits=styles.get(clothing,styles['jacket'])
 base='literature' if clothing in ('cardigan','sweater') or female and clothing in ('hoodie','shirt') else 'botany' if clothing in ('coat','shirt') or primary=='apron' else 'architecture'
 hair_map={'short':'architecture','sidepart':'architecture','curly':'botany','bob':'literature','long':'literature','medium':'literature','bun':'literature','ponytail':'literature'}
 old_hair=style.get('hair_style','')
 hair=hair_map.get(old_hair,['architecture','botany','literature'][seed%3])
 face=['round','narrow','angular','original'][(seed>>8)%4]
 height=(153+(i*7)%33) if female else (161+(i*7)%31)
 if rec['kind']!='campus':height=(154 if female else 163)+(seed%25)
 glasses=('round' if (seed>>7)%2 else 'rect') if primary=='glasses' or (i%8==0 and rec['kind']!='event') else 'none'
 beard='none' if female or rec['kind']=='campus' or (seed>>5)%3 else 'stubble'
 bpy.ops.wm.open_mainfile(filepath=str(source/'templates'/f'{core.TEMPLATES[base]}.blend'))
 r=core.rig();assert r
 chest=next((b.name for b in r.data.bones if b.name.lower() in ('spine2','chest','spine_02','upperchest')),None)
 skin=style.get('skin_color_override',skins[style.get('skin_tone',i%4)])
 coat=style.get('outfit_color',outfits[0]);accent=style.get('accent_color',outfits[2]);hp=style.get('hair_color',hairs[(seed>>11)%len(hairs)])
 for m in bpy.data.materials:
  key=m.name.lower()
  if key.startswith('professor / skin'):tint(m,skin)
  elif key.startswith('eye / dark coffee') and style.get('eye_color_override'):tint(m,style['eye_color_override'])
  elif key.startswith('professor / lip') and style.get('mouth_color_override'):tint(m,style['mouth_color_override'])
  elif key.startswith('professor / top'):tint(m,coat)
  elif 'professor / lapel' in key or 'architecture / rim' in key:tint(m,accent)
  elif 'professor / pants' in key:tint(m,['292d3b','3a4350','424738','594b42'][(seed>>9)%4])
  elif key.startswith('professor / shirt'):tint(m,outfits[2])
 res=core.update(dict(face=face,hair=hair,beard=beard,glasses=glasses,height_m=height/100,templates=source/'templates'))
 # Recolor vertex-painted groom without modifying its directional detail.
 hair_obj=bpy.context.scene.objects['NPC_Hair']
 rgb=groom.linear(hp.lstrip('#')); old=groom.linear({'architecture':'423A38','botany':'A5A3AD','literature':'644535'}[hair])
 for datum in hair_obj.data.color_attributes['HairColor'].data:
  c=datum.color;tone=sum(c[k]/max(old[k],.005) for k in range(3))/3
  datum.color=tuple(min(1,x*tone) for x in rgb)+(1,)
 for m in list(hair_obj.data.materials):m.diffuse_color=(*rgb,1)
 width=.92+((seed>>17)%17)*.01;r.scale.x*=width
 if primary in ('apron','badge','backpack','messenger','scarf'):
  accessory(r,primary,accent)
  for o in bpy.context.scene.objects:
   if o.name.startswith('NPC_Wearable_') and chest and chest!='Spine2':o.vertex_groups[0].name=chest
 # Legacy chalk will not be shown on an ordinary NPC.
 chalk=bpy.context.scene.objects.get('NPC_Prop_Chalk')
 if chalk:bpy.data.objects.remove(chalk,do_unlink=True)
 core.export(dst,ROSTER_RIGS.get(npc,()))
 res['activityRigs']=list(ROSTER_RIGS.get(npc,()))
 res.update(id=npc,template=base,preset={'skin':skin,'hair_color':hp,'outfit':clothing,'outfit_color':coat,'accent':accent,'accessory':primary,'original_hair_style':old_hair,'body_width':width,'height_cm':height,'glasses':glasses,'beard':beard})
 spec_path.write_text(json.dumps(res,ensure_ascii=False,indent=2)+'\n')
 print('GENERATED',npc,flush=True)
