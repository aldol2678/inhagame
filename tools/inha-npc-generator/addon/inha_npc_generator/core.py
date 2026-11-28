"""Local Blender NPC fitter. Mesh coordinates stay in the existing rig's rest space."""
import bpy, math, json, re
from mathutils import Vector as V
from mathutils.bvhtree import BVHTree
TEMPLATES={'botany':'INHA_NPC_Senior_Botany_v01','literature':'INHA_NPC_Lecturer_Literature_v01','architecture':'INHA_NPC_Professor_Architecture_v01'}
HAIR={
 'botany':{'NPC_Hair','Silver curl','Crown curl'},
 'literature':{'NPC_Hair','Wavy bob side','Bob end curl','Side-swept bangs','Warm hair streak'},
 'architecture':{'NPC_Hair','Short sideburn'}}
OLD_GLASSES={'Spectacle rim','Frame arm','Frame bridge','NPC_Accessory_FittedGlasses','NPC_Accessory_Spectacles'}
STABLE_PROPS={'NPC_Prop_DocumentFolder','NPC_Prop_TeachingTablet','NPC_Prop_TravelTumbler','NPC_Prop_TuckedBook'}
def base(n):
 return re.sub(r'\.\d{3}$','',n)
def rig():
 return bpy.context.scene.objects.get('Student_Rig')
def restore_face(o):
 # Make repeated previews idempotent. Custom basis is local to this file.
 key='inha_original_face_rest'
 if key not in o.data:
  o.data[key]=[a for v in o.data.vertices for a in v.co]
 pts=list(o.data[key])
 if len(pts)!=len(o.data.vertices)*3:raise ValueError('Face topology changed since first generation.')
 o.data.vertices.foreach_set('co',pts)
def edit_face(o,key):
 restore_face(o)
 if key=='original':return
 pupil=eye_centers(o)
 cx=(pupil[0].x+pupil[1].x)*.5
 for v in o.data.vertices:
  x,y,z=v.co
  if 1.355<z<1.466:
   w=math.sin(math.pi*(z-1.355)/.111)**2
   v.co.x=cx+(x-cx)*(1+{'round':.20,'narrow':-.18,'angular':.27}[key]*w)
   if key=='angular':v.co.z-=.009*w
 o.data.update()
def eye_centers(o):
 # Each fitted temple shares a symmetric optical axis rather than Blender's world X=0.
 mesh=o.data; ids=set()
 for p in mesh.polygons:
  m=mesh.materials[p.material_index]
  if m and m.name.startswith('Eye / pupil'):ids.update(p.vertices)
 pts=sorted((mesh.vertices[i].co.copy() for i in ids),key=lambda v:v.x)
 if len(pts)<12:raise ValueError('Template has no two eye-pupil meshes.')
 cuts=sorted([(pts[i+1].x-pts[i].x,i+1) for i in range(3,len(pts)-4)],reverse=True)
 k=cuts[0][1]
 return tuple(sum(x,V((0,0,0)))/len(x) for x in (pts[:k],pts[k:]))
def new_groom(r,head,hair,beard_style):
 from . import groom
 sc=bpy.context.scene
 original=sc.get('inha_groom_base')
 if not original:
  original=next((k for k,n in TEMPLATES.items() if n in bpy.data.filepath),
                'architecture' if 'Architecture' in bpy.data.filepath else 'literature')
  sc['inha_groom_base']=original
 actual=original if hair=='original' else hair
 family=set().union(*HAIR.values(),{'Subtle chin stubble','Jawline stubble','Trim chin stubble'})
 for o in list(sc.objects):
  if o.parent==r and base(o.name) in family:bpy.data.objects.remove(o,do_unlink=True)
 l,rt=eye_centers(head);cx=(l.x+rt.x)*.5
 result=groom.build_hair(r,head,cx,actual)
 result.update(groom.beard(head,cx,('stubble' if original=='architecture' else 'none') if beard_style=='original' else beard_style))
 return result
def material(name,hex,metal=0.):
 m=bpy.data.materials.get(name) or bpy.data.materials.new(name);m.use_nodes=True
 c=[int(hex[i:i+2],16)/255 for i in (0,2,4)]
 c=tuple(x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in c)+(1,)
 m.diffuse_color=c; b=m.node_tree.nodes.get('Principled BSDF')
 b.inputs['Base Color'].default_value=c;b.inputs['Metallic'].default_value=metal;b.inputs['Roughness'].default_value=.36
 return m
def glasses(r,style):
 s=bpy.context.scene;head=s.objects['NPC_HeadFace']
 for o in list(s.objects):
  if o.parent==r and base(o.name) in OLD_GLASSES:bpy.data.objects.remove(o,do_unlink=True)
 if style=='none':return {'style':'none'}
 L,R=eye_centers(head); O=(L+R)*.5; X=(R-L).normalized()
 Z=(V((0,0,1))-X*X.z).normalized();Y=Z.cross(X).normalized()
 def world(p):return O+X*p[0]+Y*p[1]+Z*p[2]
 def local(v):v=v-O;return V((v.dot(X),v.dot(Y),v.dot(Z)))
 M=head.data
 skin_polys=[tuple(p.vertices) for p in M.polygons if 'professor / skin' in M.materials[p.material_index].name]
 bvh=BVHTree.FromPolygons([local(v.co) for v in M.vertices],skin_polys)
 def ray_front(x,z):
  hit,*_=bvh.ray_cast(V((x,-.25,z)),V((0,1,0)),.33)
  return hit.y if hit is not None else None
 c=(R-L).length*.5
 radius=.00165 if style=='round' else .00235
 width=min(c-.006,.032 if style=='round' else .0345)
 hz=.0258 if style=='round' else .0205
 exponent=1 if style=='round' else .39
 def ring(t):
  ct=math.copysign(abs(math.cos(t))**exponent,math.cos(t));st=math.copysign(abs(math.sin(t))**exponent,math.sin(t))
  return ct,st
 def fitted_lens(t):
  x,z=ring(t);x=c+x*width;z*=hz
  # Wrap gently around the outer eye. Use the more forward of the two
  # skin surfaces so both frames stay geometrically mirrored.
  bases=[ray_front(sign*x,z) for sign in (-1,1)]
  clearance=radius+.0015
  y=min([-.0078+.0024*(x/c-1)]+[v-clearance for v in bases if v is not None])
  return x,y,z,bases
 front_out=fitted_lens(0)[1]
 front_in=fitted_lens(math.pi)[1]
 vertices=[];faces=[];materials=[]
 def tube(points,radii,material_id=0,closed=False):
  v=[V(p) for p in points]; first=len(vertices)
  for i,p in enumerate(v):
   previous=v[i-1] if i or closed else v[0]
   next=v[(i+1)%len(v)] if closed or i+1<len(v) else v[-1]
   d=(next-previous).normalized()
   axis=V((0,0,1)) if abs(d.z)<.83 else V((0,1,0))
   a=d.cross(axis).normalized(); b=d.cross(a)
   for j in range(8):
    phi=j*math.tau/8; vertices.append(p+radii[i]*(a*math.cos(phi)+b*math.sin(phi)))
  for i in range(len(v) if closed else len(v)-1):
   for j in range(8):
    q=first+8*i; nxt=first+8*((i+1)%len(v));faces.append((q+j,q+(j+1)%8,nxt+(j+1)%8,nxt+j));materials.append(material_id)
  if not closed:
   faces.extend([tuple(first+i for i in reversed(range(8))),tuple(first+8*(len(v)-1)+i for i in range(8))]);materials.extend([material_id,material_id])
 def curve(p):
  out=[]
  for i in range(len(p)-1):
   a,b,c0,d=[V(p[j]) for j in (max(0,i-1),i,i+1,min(len(p)-1,i+2))]
   for k in range(5):
    t=k/5
    out.append((2*b+(-a+c0)*t+(2*a-5*b+4*c0-d)*t*t+(-a+3*b-3*c0+d)*t**3)*.5)
  return out+[V(p[-1])]
 def wire(p,thick,mat=0):
  p=curve(p);tube(p,[thick]*len(p),mat)
 wrap_x=c+width
 # Read the outer ear support symmetrically from both sides, at the upper ear.
 def side_hit(side,y,z):
  hit,*_=bvh.ray_cast(V((side*.23,y,z)),V((-side,0,0)),.24)
  return abs(hit.x) if hit else None
 samples=[]
 z_ear=-.009
 for y in [i/1000 for i in range(79,162,4)]:
  a,b=side_hit(-1,y,z_ear),side_hit(1,y,z_ear)
  if a and b:samples.append(((a+b)*.5,y,a,b))
 if not samples:raise ValueError('Ear anchors not found.')
 _,y_ear,e1,e2=max(samples)
 earx=(e1+e2)*.5+.001
 # Bridge is centered on the eye midpoint. Two warm nose pads contact the
 # actual lateral nose surface; they are mirrored even if the nose mesh isn't.
 padz=-.012
 pad_x=min(.009,(c-width)*.83)
 pad_surfaces=[ray_front(side*pad_x,padz) for side in (-1,1)]
 pads_y=sum(y for y in pad_surfaces if y is not None)/max(1,len([y for y in pad_surfaces if y is not None]))-.0015
 innerx=c-width
 nose_bridge=ray_front(0,.008)
 bridge_y=min(-.005,nose_bridge-.002 if nose_bridge is not None else -.005)
 wire([(-innerx,front_in,0),(-innerx*.65,(front_in+bridge_y)*.5,.005),(0,bridge_y,.008),(innerx*.65,(front_in+bridge_y)*.5,.005),(innerx,front_in,0)],radius*.89)
 mirrored=[]
 for side in (-1,1):
  paths=[]
  for i in range(80):
   x,y,z,rays=fitted_lens(i*math.tau/80);paths.append((side*x,y,z))
  mirrored.append(paths)
  tube(paths,[radius]*len(paths),closed=True)
  wire([(side*wrap_x,front_out,.002),(side*(wrap_x+.006),front_out+.012,.004),(side*(max(wrap_x+.006,earx)+.001),.045,.002),(side*(earx+.004),y_ear-.021,z_ear+.002),(side*earx,y_ear,z_ear),(side*(earx-.003),y_ear+.021,z_ear-.013)],radius*.78)
  wire([(side*(innerx+.002),front_in+.001,-.004),(side*pad_x,(front_in+pads_y)*.5,-.008),(side*pad_x,pads_y-.0004,padz)],.0011)
  wire([(side*pad_x,pads_y,padz+.003),(side*(pad_x+.001),pads_y-.0003,padz),(side*(pad_x+.0025),pads_y,padz-.003)],.002,1)
 mirror_err=max(abs(a[0]+b[0])+abs(a[1]-b[1])+abs(a[2]-b[2]) for a,b in zip(*mirrored))
 assert mirror_err<1e-9
 gaps=[skin-y for x,y,z,rays in (fitted_lens(i*math.tau/80) for i in range(80)) for skin in rays if skin is not None]
 assert gaps and min(gaps)>=radius+.00149,min(gaps)
 mesh=bpy.data.meshes.new('Glasses: mirrored profile-fit');mesh.from_pydata([world(p) for p in vertices],[],faces);mesh.update()
 obj=bpy.data.objects.new('NPC_Accessory_FittedGlasses',mesh);s.collection.objects.link(obj)
 obj.parent=r
 mesh.materials.append(material('INHA fitted '+style,'795645' if style=='round' else '453A39',.40 if style=='round' else .12))
 mesh.materials.append(material('INHA nose pads','B59776',.08))
 for p,m in zip(mesh.polygons,materials):p.use_smooth=True;p.material_index=m
 obj.vertex_groups.new(name='Head').add(list(range(len(vertices))),1,'REPLACE')
 obj.modifiers.new('Head attachment','ARMATURE').object=r
 obj['npc_hideable']=True
 # Landmark report uses geometry-driven supports in separate facial axes.
 return {'style':style,'eyeCenters':[[*L],[*R]],'center':[*O],'centersFromFaceMidpoint_m':[-c,c],
         'lensCenterHeightDelta_m':0.,'lensRimMirroredCenterlineError_m':mirror_err,'minLensCenterlineClearance_m':min(gaps),'earCenterlineSignedXm':[-earx,earx],
         'earFaceHalfWidths_m':[e1,e2],'earSupportDepth_m':y_ear,'eyewearMeshNode':obj.name,
         'noseSupportSurfaceDepths_m':pad_surfaces,'vertices':len(vertices),'faces':len(faces)}
def bounds(r):
 bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
 zz=[]
 for o in bpy.context.scene.objects:
  if o.parent==r and o.type=='MESH':
   e=o.evaluated_get(dg);zz.extend((e.matrix_world@v.co).z for v in e.data.vertices)
 return min(zz),max(zz)
def update(config):
 s=bpy.context.scene;r=rig()
 if not r or 'NPC_HeadFace' not in s.objects:raise ValueError('패키지의 교수 .blend 템플릿을 먼저 열어 주세요.')
 head=s.objects['NPC_HeadFace'];edit_face(head,config['face']);hair_report=new_groom(r,head,config['hair'],config.get('beard','original'))
 style=glasses(r,config['glasses'])
 tracks=r.animation_data.nla_tracks
 for t in tracks:t.mute=t.name!='Carry_Book_Tuck'
 s.frame_set(1)
 lo,hi=bounds(r);r.scale*=config['height_m']/(hi-lo)
 lo,hi=bounds(r);r.location.z-=lo
 lo,hi=bounds(r)
 if abs(hi-lo-config['height_m'])>.0001 or abs(lo)>.0001:raise ValueError('Measured model height does not match the target.')
 return {'face':config['face'],'hair':config['hair'],'measuredHeight_m':hi-lo,'floor_m':lo,'rigScale':[*r.scale],'fitting':style,'groom':hair_report}
def export_base(path):
 s=bpy.context.scene;r=rig()
 bpy.ops.object.select_all(action='DESELECT')
 tracked=[(t,t.mute) for t in r.animation_data.nla_tracks]
 for t,_ in tracked:t.mute=False
 hidden=[]
 for o in s.objects:
  if o==r or o.parent and o.name not in STABLE_PROPS:
   if o.hide_get():hidden.append(o);o.hide_set(False)
   o.select_set(True)
 try:
  bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_yup=True,export_animations=True,export_cameras=False,export_lights=False,export_force_sampling=True,export_animation_mode='NLA_TRACKS')
 finally:
  for t,m in tracked:t.mute=m
  for o in hidden:o.hide_set(True)


def export(path, activities=()):
 """Write an all-or-nothing GLB; NPC activity sockets live in the GLB."""
 if not activities:
  return export_base(path)
 from pathlib import Path
 from tempfile import TemporaryDirectory
 from .activity import decorate
 path=Path(path)
 with TemporaryDirectory(prefix='.inha-rig-',dir=path.parent) as stage:
  base=Path(stage)/'base.glb';result=Path(stage)/'rigged.glb'
  export_base(base)
  decorate(base,result,activities)
  result.replace(path)
