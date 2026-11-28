import json,struct,sys
import numpy as np
from scipy.spatial.transform import Rotation
from pathlib import Path
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
 def push(values,kind,bounds=False):
  q=np.asarray(values,dtype='<f4');offset=len(b); payload=q.tobytes();b.extend(payload)
  view=len(g['bufferViews']);g['bufferViews'].append(dict(buffer=0,byteOffset=offset,byteLength=len(payload)))
  a=dict(bufferView=view,componentType=5126,count=len(q),type=kind)
  if bounds:a.update(min=[float(q.min())],max=[float(q.max())])
  i=len(g['accessors']);g['accessors'].append(a);return i
 t=push([0.,1.],'SCALAR',True)
 clip=dict(name=name,samplers=[],channels=[])
 for i,trs in pose.items():
  for path,value in trs.items():
   o=push([value,value],'VEC4' if path=='rotation' else 'VEC3')
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
def run(source,reference,output,kind):
 g,b=read(source)
 clip={'seat':'Campus_Seat','photo':'Campus_Photo'}[kind]
 if any(a['name']==clip for a in g['animations']):raise ValueError('Start with the original generated model')
 by={n['name']:i for i,n in enumerate(g['nodes'])}
 if kind=='seat':
  rg,rb=read(reference)
  orig=poses(rg,rb,'Bench_Sit_Stand',1.8)
  pose={by[rg['nodes'][i]['name']]:v for i,v in orig.items()}
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
 append_pose(g,b,clip,pose);write(output,g,b)
if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser(description='Add campus bench or photography to a compatible generated humanoid GLB.')
 p.add_argument('kind',choices=['seat','photo'])
 p.add_argument('input',type=Path);p.add_argument('reference',type=Path);p.add_argument('output',type=Path)
 a=p.parse_args()
 if a.input.resolve()==a.output.resolve():p.error('Use a different output path.')
 run(a.input,a.reference,a.output,a.kind)
