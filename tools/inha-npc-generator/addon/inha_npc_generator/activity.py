import json,struct
import numpy as np
try:
 from scipy.spatial.transform import Rotation
except ImportError:  # Stock Blender bundles NumPy and mathutils, not SciPy.
 from mathutils import Euler, Matrix, Quaternion, Vector
 class Rotation:
  def __init__(self,q): self.q=q.normalized()
  @classmethod
  def from_quat(cls,q): return cls(Quaternion((q[3],q[0],q[1],q[2])))
  @classmethod
  def from_matrix(cls,m):
   u,_,v=np.linalg.svd(m);r=u@v
   if np.linalg.det(r)<0:u[:,-1]*=-1;r=u@v
   return cls(Matrix(r.tolist()).to_quaternion())
  @classmethod
  def identity(cls): return cls(Quaternion())
  @classmethod
  def from_rotvec(cls,v): return cls(Quaternion(Vector(v),float(np.linalg.norm(v))))
  @classmethod
  def from_euler(cls,order,angles,degrees=False):
   q=cls.identity()
   for axis,a in zip(order,np.atleast_1d(angles)):
    step=np.zeros(3);step['xyz'.index(axis)]=np.deg2rad(a) if degrees else a
    if np.linalg.norm(step)>1e-12:q=cls.from_rotvec(step)*q
   return q
  def inv(self): return Rotation(self.q.conjugated())
  def __mul__(self,other): return Rotation(self.q @ other.q)
  def as_quat(self): return np.array([self.q.x,self.q.y,self.q.z,self.q.w])
  def as_matrix(self): return np.array(self.q.to_matrix())
  def apply(self,v): return np.array(self.q @ Vector(v))

from pathlib import Path
CLIPS={'seat':'Campus_Seat','photo':'Campus_Photo','read':'Campus_Read','coffee':'Campus_Coffee',
 'phone':'Campus_Phone','snack':'Campus_Snack'}
ACTIVITIES=tuple(CLIPS)
ROSTER_RIGS={
 'INKYUNG-NPC-003':('read',),'INKYUNG-NPC-005':('phone',),'INKYUNG-NPC-006':('snack',),
 'INKYUNG-NPC-009':('photo',),'INKYUNG-NPC-010':('seat',),'INKYUNG-NPC-012':('read','coffee'),
}
SOCKETS={'seat':('Campus_Seat_Contact','Hips'),'photo':('Campus_Camera_Socket','Hand.R'),
 'read':('Campus_Book_Socket','Hand.R'),'coffee':('Campus_Cup_Socket','Hand.R'),
 'phone':('Campus_Phone_Socket','Hand.R'),'snack':('Campus_Snack_Socket','Hand.R')}

def read(p):
 d=Path(p).read_bytes();n=struct.unpack_from('<I',d,12)[0];return json.loads(d[20:20+n]),bytearray(d[28+n:])
def data(g,b,idx):
 a=g['accessors'][idx];v=g['bufferViews'][a['bufferView']];dims={'SCALAR':1,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
 dtype=np.dtype({5121:'u1',5123:'<u2',5126:'<f4'}[a['componentType']]); width=dtype.itemsize
 return np.ndarray((a['count'],dims),dtype=dtype,buffer=b,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',dims*width),width))
def poses(g,b,name,time):
 anim=next(a for a in g['animations'] if a['name']==name)
 pose={}
 for c in anim['channels']:
  s=anim['samplers'][c['sampler']];i=np.argmin(abs(data(g,b,s['input'])[:,0]-time)); p=c['target']
  pose.setdefault(p['node'],{})[p['path']]=data(g,b,s['output'])[i].copy()
 return pose
def xforms(g,pose):
 w={}
 def node(i,parent):
  n=g['nodes'][i];p=pose.get(i,{})
  m=np.eye(4);m[:3,:3]=Rotation.from_quat(p.get('rotation',n.get('rotation',[0,0,0,1]))).as_matrix()@np.diag(p.get('scale',n.get('scale',[1,1,1])))
  m[:3,3]=p.get('translation',n.get('translation',[0,0,0]));w[i]=parent@m
  for k in n.get('children',[]):node(k,w[i])
 for n in g['scenes'][0]['nodes']:node(n,np.eye(4))
 return w
def skin_points(g,b,n,w):
 skin=g['skins'][n['skin']]
 j=skin['joints']
 bind=data(g,b,skin['inverseBindMatrices']).reshape(-1,4,4).transpose(0,2,1)
 transforms=np.asarray([w[i] for i in j])@bind
 for p in g['meshes'][n['mesh']]['primitives']:
  a=p['attributes']
  if 'JOINTS_0' not in a:continue
  xyz=data(g,b,a['POSITION']); weights=data(g,b,a['WEIGHTS_0']); index=data(g,b,a['JOINTS_0'])
  if weights.dtype.kind!='f':weights=weights/np.iinfo(weights.dtype).max
  h=np.column_stack([xyz,np.ones(len(xyz))])
  yield ((transforms[index]@h[:,None,:,None])[...,0]*weights[:,:,None]).sum(axis=1)[:,:3]
def append_pose(g,b,name,pose):
 append_frames(g,b,name,[0.,1.],[pose,pose])
def append_frames(g,b,name,times,frames):
 def push(values,kind,bounds=False):
  q=np.asarray(values,dtype='<f4');offset=len(b); payload=q.tobytes();b.extend(payload)
  view=len(g['bufferViews']);g['bufferViews'].append(dict(buffer=0,byteOffset=offset,byteLength=len(payload)))
  a=dict(bufferView=view,componentType=5126,count=len(q),type=kind)
  if bounds:a.update(min=[float(q.min())],max=[float(q.max())])
  i=len(g['accessors']);g['accessors'].append(a);return i
 t=push(times,'SCALAR',True)
 clip=dict(name=name,samplers=[],channels=[])
 for i,trs in frames[0].items():
  for path,value in trs.items():
   values=np.stack([p[i][path] for p in frames])
   if path=='rotation':
    for k in range(1,len(values)):
     if values[k-1]@values[k]<0:values[k]*=-1
   o=push(values,'VEC4' if path=='rotation' else 'VEC3')
   clip['channels'].append(dict(sampler=len(clip['samplers']),target=dict(node=i,path=path)))
   clip['samplers'].append(dict(input=t,output=o,interpolation='LINEAR'))
 g['animations'].append(clip)
def add_marker(g,parent,name,p,rotation=None):
 n=dict(name=name,translation=np.asarray(p).tolist())
 if rotation is not None:n['rotation']=np.asarray(rotation).tolist()
 g['nodes'][parent].setdefault('children',[]).append(len(g['nodes']))
 g['nodes'].append(n)
def authored_joint(g,pose,w,index,direction):
 parent=next(i for i,n in enumerate(g['nodes']) if index in n.get('children',[]))
 current=w[index][:3,1];u=current/np.linalg.norm(current);v=np.asarray(direction,dtype=float);v/=np.linalg.norm(v)
 axis=np.cross(u,v);dot=np.clip(u@v,-1,1)
 q=Rotation.from_rotvec(axis/np.linalg.norm(axis)*np.arccos(dot)) if np.linalg.norm(axis)>1e-8 else Rotation.identity()
 rotation=Rotation.from_matrix(w[parent][:3,:3])
 world=rotation*Rotation.from_quat(pose[index]['rotation'])
 pose[index]['rotation']=(rotation.inv()*q*world).as_quat()
def write(p,g,b):
 g['buffers'][0]['byteLength']=len(b)
 j=json.dumps(g,separators=(',',':')).encode();j+=b' '*((-len(j))%4)
 p.write_bytes(struct.pack('<4sIIII',b'glTF',2,28+len(j)+len(b),len(j),0x4e4f534a)+j+struct.pack('<II',len(b),0x004e4942)+b)
# Generated-model coordinate system: +Y up, +Z forward. Design each wrist
# target from the prop surface and use a downward/outward elbow pole.
def aim_arm(g,pose,indices,side,wrist,hand_forward):
 upper,fore,hand=[indices[name+'.'+side] for name in ('UpperArm','Forearm','Hand')]
 w=xforms(g,pose)
 start=w[upper][:3,3]
 a=np.linalg.norm(w[fore][:3,3]-start)
 b=np.linalg.norm(w[hand][:3,3]-w[fore][:3,3])
 vec=np.asarray(wrist)-start
 d=np.linalg.norm(vec); axis=vec/d
 d=np.clip(d,abs(a-b)+.003,a+b-.003)
 pole=np.array([.65 if side=='R' else -.65,-1.,-.35])
 normal=pole-axis*(pole@axis);normal/=np.linalg.norm(normal)
 projection=(a*a-b*b+d*d)/(2*d)
 elbow=start+axis*projection+normal*np.sqrt(max(0,a*a-projection**2))
 authored_joint(g,pose,w,upper,elbow-start)
 w=xforms(g,pose)
 authored_joint(g,pose,w,fore,start+axis*d-w[fore][:3,3])
 w=xforms(g,pose)
 authored_joint(g,pose,w,hand,hand_forward)

def anchor_local(g,pose,hand,center,orientation):
 wrist=xforms(g,pose)[hand]
 return dict(translation=(np.linalg.inv(wrist)@[*center,1])[:3],
    rotation=(Rotation.from_matrix(wrist[:3,:3]).inv()*orientation).as_quat())

def lip_surface(g,b,by):
 neutral=poses(g,b,'Idle_Breathe',0)
 w=xforms(g,neutral); head=w[by['Head']]
 face=g['nodes'][by['NPC_HeadFace']]
 lips=[]
 for primitive,vertices in zip(g['meshes'][face['mesh']]['primitives'],skin_points(g,b,face,w)):
  if '/ lip' in g['materials'][primitive['material']]['name']:
   center=(abs(vertices[:,0]-head[0,3])<.039)&(vertices[:,2]>head[2,3]+.08)
   lips.extend(vertices[center])
 if len(lips)<8:raise ValueError('Cannot fit cup without a lip surface')
 mouth=np.median(lips,axis=0)
 return mouth,(np.linalg.inv(head)@[*mouth,1])[:3]

def author_hand_activity(g,b,by,clip,kind):
 hand=by['Hand.R']
 # Relative to the skeleton (not a fixed world-scale prop override).
 book_scale,cup_scale=.76,.88
 if kind=='read':
  times=[0.,1.25,2.5,3.75,5.]
  weights=[0.,.7,1.,.35,0.]
  socket_name='Campus_Book_Socket'
  # Reuse the forearm-authored carry animation; place the closed book between
  # torso and left forearm in that pose, rigidly attached to the forearm.
  tuck=poses(g,b,'Carry_Book_Walk',0)
  fore=by['Forearm.L']; world=xforms(g,tuck)
  base=world[fore][:3,3]
  center=[base[0]+.064,base[1]+.053,base[2]+.061]
  anchor=anchor_local(g,tuck,fore,center,Rotation.from_euler('yxz',[90,0,-90],degrees=True))
  i=len(g['nodes']);add_marker(g,fore,'Campus_Book_Tuck_Socket',anchor['translation'],anchor['rotation'])
  g['nodes'][i]['scale']=[.91]*3
  scale=book_scale
 else:
  times=[0.,.8,1.45,1.85,2.25,2.9,4.6]
  weights=[0.,0.,.77,1.,1.,0.,0.]
  socket_name='Campus_Cup_Socket'
  scale=cup_scale
  mouth,local=lip_surface(g,b,by)
  add_marker(g,by['Head'],'Campus_Cup_Mouth',local)
 socket=len(g['nodes']); frames=[]
 for weight in weights:
  pose=poses(g,b,'Idle_Breathe',0)
  world=xforms(g,pose)
  chest=world[by['Chest']][:3,3]
  if kind=='read':
   center=chest+[0.,-.064+weight*.012,.282]
   rotation=Rotation.from_euler('x',14+weight*4,degrees=True)
   for sign,side in ((1,'R'),(-1,'L')):
    # Palms sit on the lower outside edges, not through the page surface.
    palm=center+rotation.apply([sign*.136*scale,-.008*scale,.020])
    direction=np.array([-sign*.70,.18,.69])
    aim_arm(g,pose,by,side,palm-direction*.032,direction)
   below=Rotation.from_euler('x',17+weight*5,degrees=True)
   pose[by['Head']]['rotation']=(Rotation.from_quat(pose[by['Head']]['rotation'])*below).as_quat()
  else:
   rotation=Rotation.from_euler('x',-13*weight,degrees=True)
   # Grip-centered asset: drinking opening is offset left and above its origin.
   opening=np.array([-.043,.0825,.024])*scale
   rest=chest+[.215,-.185,.258]
   at_mouth=mouth+[.012,-.006,.024]-rotation.apply(opening)
   center=rest*(1-weight)+at_mouth*weight
   direction=np.array([-.69,.24+.27*weight,.65-.15*weight])
   aim_arm(g,pose,by,'R',center-direction*.034,direction)
  frames.append({**pose,socket:anchor_local(g,pose,hand,center,rotation)})
 add_marker(g,hand,socket_name,frames[0][socket]['translation'],frames[0][socket]['rotation'])
 g['nodes'][socket]['scale']=[scale]*3
 append_frames(g,b,clip,times,frames)

def author_phone_or_snack(g,b,by,clip,kind):
 hand=by['Hand.R']; socket=len(g['nodes'])
 neutral=poses(g,b,'Idle_Breathe',0); w=xforms(g,neutral); chest=w[by['Chest']][:3,3]
 is_phone=kind=='phone'; scale=.92 if is_phone else .87
 if not is_phone:
  mouth,local=lip_surface(g,b,by)
  add_marker(g,by['Head'],'Campus_Snack_Mouth',local);socket=len(g['nodes'])
 times=[0,.6,1.35,2.15,2.50,3.20,4.8] if is_phone else [0,.85,1.45,1.85,2.16,3.01,4.70]
 weights=[0,.35,1,.86,.94,.25,0] if is_phone else [0,0,.75,1,1,0,0]
 frames=[]
 for q in weights:
  pose=poses(g,b,'Idle_Breathe',0)
  if is_phone:
   center=chest+[.168-.033*q,-.200+.153*q,.26+.032*q]
   # The screen (+Z on the prop) faces back/up towards the eyes, not the player.
   rotation=Rotation.from_euler('yx',[180,28+q*24],degrees=True)
   grip=center+rotation.apply([-.031*scale,.015*scale,-.004])
   direction=np.array([-.68,.23+.12*q,.68])
   pose[by['Head']]['rotation']=(Rotation.from_quat(pose[by['Head']]['rotation'])*
     Rotation.from_euler('x',10+q*18,degrees=True)).as_quat()
  else:
   rotation=Rotation.from_euler('x',-20*q,degrees=True)
   bite=np.array([.002,.106,-.015])*scale
   rest=chest+[.208,-.205,.267]
   near_mouth=mouth+[.019,-.006,.025]-rotation.apply(bite)
   center=rest*(1-q)+near_mouth*q
   grip=center+rotation.apply([.016*scale,.018*scale,0])
   direction=np.array([-.69,.20+.29*q,.66-.12*q])
  aim_arm(g,pose,by,'R',grip-direction*.034,direction)
  frames.append({**pose,socket:anchor_local(g,pose,hand,center,rotation)})
 add_marker(g,hand,SOCKETS[kind][0],frames[0][socket]['translation'],frames[0][socket]['rotation'])
 g['nodes'][socket]['scale']=[scale]*3
 append_frames(g,b,clip,times,frames)

def check_activity(g,kind):
 clips={a['name'] for a in g['animations']}
 find=lambda name: next((i for i,n in enumerate(g['nodes']) if n['name']==name),-1)
 def attached(name,parent):
  i,j=find(name),find(parent)
  return i>=0 and j>=0 and i in g['nodes'][j].get('children',[])
 if CLIPS[kind] not in clips or not attached(*SOCKETS[kind]):
  raise ValueError('Missing clip/socket for '+kind)
 if kind=='read' and ('Carry_Book_Walk' not in clips or not attached('Campus_Book_Tuck_Socket','Forearm.L')):
  raise ValueError('Missing closed book carry motion')

def apply_activity(g,b,kind,reference=None):
 clip=CLIPS[kind]
 if any(a['name']==clip for a in g['animations']):
  check_activity(g,kind)
  return
 by={n['name']:i for i,n in enumerate(g['nodes'])}
 if kind in ('phone','snack'):
  author_phone_or_snack(g,b,by,clip,kind)
  check_activity(g,kind)
  return
 if kind in ('read','coffee'):
  author_hand_activity(g,b,by,clip,kind)
  check_activity(g,kind)
  return
 if kind=='seat':
  if reference:
   rg,rb=read(reference)
   orig=poses(rg,rb,'Bench_Sit_Stand',1.8)
   pose={by[rg['nodes'][i]['name']]:v for i,v in orig.items() if rg['nodes'][i]['name'] in by}
  else:
   named=json.loads(Path(__file__).with_name('seat_pose.json').read_text())
   pose={by[k]:v for k,v in named.items() if k in by}
  world=xforms(g,pose)
  hip=world[by['Hips']][:3,3].copy()
  n=g['nodes'][by['NPC_Trousers']]
  skin=np.concatenate(list(skin_points(g,b,n,world)))
  # Lowest clothed pelvis under the hip, rather than shin/foot vertices.
  pelvis=skin[(skin[:,2]<hip[2]+.10)&(skin[:,2]>hip[2]-.14)&(np.abs(skin[:,0]-hip[0])<.17)]
  assert len(pelvis)>8, 'posed contact mesh unavailable'
  contact=np.array([hip[0],pelvis[:,1].min(),hip[2]])
  add_marker(g,by['Hips'],'Campus_Seat_Contact',(np.linalg.inv(world[by['Hips']])@[*contact,1])[:3])
  # Preview readback of calibrated contact and shoes before attachment.
  shoes=np.concatenate(list(skin_points(g,b,g['nodes'][by['NPC_Shoes']],world)))
  print('Seat calibrated mesh vertices:',len(pelvis),'contact',contact.round(4),'shoes floor',shoes[:,1].min().round(4))
 else:
  pose=poses(g,b,'Idle_Breathe',0)
  for name,direction in [
    ('UpperArm.R',[.30,-.81,.50]),('Forearm.R',[-.46,.20,.86]),('Hand.R',[-.12,.12,.98]),
    ('UpperArm.L',[-.30,-.89,.33]),('Forearm.L',[.29,.08,.95])]:
   authored_joint(g,pose,xforms(g,pose),by[name],direction)
  world=xforms(g,pose);wrist=world[by['Hand.R']]
  hand=np.concatenate(list(skin_points(g,b,g['nodes'][by['NPC_Hand_R']],world)))
  middle=(hand.min(axis=0)+hand.max(axis=0))*.5
  grip=np.array([hand[:,0].min()-.011,middle[1],middle[2]+.014])
  pos=(np.linalg.inv(wrist)@[*grip,1])[:3]
  rot=Rotation.from_matrix(wrist[:3,:3]).inv().as_quat()
  add_marker(g,by['Hand.R'],'Campus_Camera_Socket',pos,rot)
  print('Photo socket:',grip.round(4),'right palm centre:',middle.round(4))
 append_pose(g,b,clip,pose)
 check_activity(g,kind)

def decorate(source,output,activities,reference=None):
 g,b=read(source)
 requested=set(activities)
 if requested-set(ACTIVITIES):raise ValueError('Unknown NPC activity')
 for kind in ACTIVITIES:
  if kind in requested:apply_activity(g,b,kind,reference)
 write(output,g,b)

def run(source,reference,output,kind):
 decorate(source,output,[kind],reference)
