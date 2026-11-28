"""blender -b -t 4 --python-exit-code 5 --python generate.py -- --base botany --glasses round --height 158"""
import sys, argparse, json
from pathlib import Path
import bpy
D=Path(__file__).resolve().parent
sys.path.insert(0,str(D/'addon'))
from inha_npc_generator import core
p=argparse.ArgumentParser()
p.add_argument('--base',choices=core.TEMPLATES,required=True)
p.add_argument('--face',choices=('original','round','narrow','angular'),default='original')
p.add_argument('--hair',choices=('original',*core.TEMPLATES),default='original')
p.add_argument('--beard',choices=('original','none','stubble','short'),default='original')
p.add_argument('--glasses',choices=('none','round','rect'),default='round')
p.add_argument('--height',type=float,required=True)
p.add_argument('--name',required=True)
p.add_argument('--preview',action='store_true')
p.add_argument('--output-dir',type=Path,default=Path.cwd()/'inha-npc-output')
a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
if not 140<=a.height<=200 or not a.name.replace('_','').isalnum():p.error('safe name and height 140–200 cm required')
out=a.output_dir.resolve();out.mkdir(parents=True,exist_ok=True)
f=out/f'{a.name}.glb';b=f.with_suffix('.blend')
if f.exists() or b.exists():raise ValueError('Output already exists; pick a new name.')
bpy.ops.wm.open_mainfile(filepath=str(D/'templates'/f'{core.TEMPLATES[a.base]}.blend'))
r=core.update(dict(face=a.face,hair=a.hair,beard=a.beard,glasses=a.glasses,height_m=a.height/100.,templates=D/'templates'))
core.export(f)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(b))
(out/f'{a.name}.json').write_text(json.dumps(r,indent=2))
if a.preview:
 from mathutils import Vector as V
 s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=20;s.cycles.use_denoising=False;s.render.resolution_x=520;s.render.resolution_y=520;s.render.resolution_percentage=100
 scale=r['rigScale'][0]; s.camera.data.type='ORTHO';s.camera.data.ortho_scale=.52*scale
 s.objects['NPC_Prop_Chalk'].hide_render=True
 for tag,(x,y) in [('front',(0,-4.8)),('34',(3.1,-4.0)),('side',(4.8,-.65))]:
  target=V((-.012*scale,0,1.52*scale));s.camera.location=(x,y,target.z+.025)
  s.camera.rotation_euler=(target-s.camera.location).to_track_quat('-Z','Y').to_euler()
  s.render.filepath=str(out/f'{a.name}-{tag}.png');bpy.ops.render.render(write_still=True)
