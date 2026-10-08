#!/usr/bin/env python3
"""Deterministic project-authored Annyongi reconstruction. No source pixels embedded.
Design references and permissions: docs/implementation/annyongi-3d-redesign-01/DISCOVERY.md
Y-up, +Z front, coordinates in player-root space. Python stdlib only.
"""
import json, math, struct, pathlib, hashlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'apps/world/assets/annyongi-flight-v1.glb'
GENERATOR='INHAGAME Annyongi procedural flight reconstruction v2.4'
COLORS={'blue':'d3edfb','cream':'fffde4','pink':'f6bec8','mouth':'bf6280','ink':'211f1f','white':'ffffff','curl':'9fc7dc'}
def color(key):
 h=COLORS[key];s=[int(h[i:i+2],16)/255 for i in (0,2,4)]
 return [v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in s]+[1.]
def add(a,b):return [x+y for x,y in zip(a,b)]
def sub(a,b):return [x-y for x,y in zip(a,b)]
def mul(a,s):return [x*s for x in a]
def unit(v):return mul(v,1/max(1e-12,math.sqrt(sum(x*x for x in v))))
def cross(a,b):return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
class Shape:
 def __init__(self):self.p=[];self.n=[];self.c=[];self.i=[]
 def vertex(self,p,n,c):self.p+=p;self.n+=n;self.c+=color(c);return len(self.p)//3-1
 def tri(self,a,b,c):self.i += [a,b,c]
 def ellipsoid(self,center,radii,c,segments=20,rings=12,angle=0):
  segments=max(8,round(segments*.8));rings=max(6,round(rings*.8))
  start=len(self.p)//3
  bottom=self.vertex(add(center,[0,-radii[1],0]),[0,-1,0],c);rows=[]
  for j in range(1,rings):
   lat=-math.pi/2+j*math.pi/rings;row=[]
   for k in range(segments):
    ang=k*2*math.pi/segments;v=[math.cos(lat)*math.cos(ang),math.sin(lat),math.cos(lat)*math.sin(ang)]
    row.append(self.vertex(add(center,[v[i]*radii[i] for i in range(3)]),unit([v[i]/radii[i] for i in range(3)]),c))
   rows.append(row)
  top=self.vertex(add(center,[0,radii[1],0]),[0,1,0],c)
  for k in range(segments):
   l=(k+1)%segments;self.tri(bottom,rows[0][k],rows[0][l]);self.tri(rows[-1][k],top,rows[-1][l])
  for a,b in zip(rows,rows[1:]):
   for k in range(segments):
    l=(k+1)%segments;self.tri(a[k],b[k],a[l]);self.tri(a[l],b[k],b[l])
  if angle:
   a=math.radians(angle)
   for i in range(start,len(self.p)//3):
    x=self.p[i*3]-center[0];y=self.p[i*3+1]-center[1]
    self.p[i*3]=center[0]+x*math.cos(a)-y*math.sin(a);self.p[i*3+1]=center[1]+x*math.sin(a)+y*math.cos(a)
    x=self.n[i*3];y=self.n[i*3+1];self.n[i*3]=x*math.cos(a)-y*math.sin(a);self.n[i*3+1]=x*math.sin(a)+y*math.cos(a)
 def tube(self,points,radii,c,sides=8):
  sides=6 if sides==8 else sides
  rows=[]
  for j,p in enumerate(points):
   tangent=unit(sub(points[min(j+1,len(points)-1)],points[max(0,j-1)]))
   u=unit(cross(tangent,[0,0,1] if abs(tangent[2])<.9 else [0,1,0]));v=cross(tangent,u)
   row=[]
   for k in range(sides):
    a=k*2*math.pi/sides;n=add(mul(u,math.cos(a)),mul(v,math.sin(a)))
    row.append(self.vertex(add(p,mul(n,radii[j] if isinstance(radii,list) else radii)),n,c))
   rows.append(row)
  for a,b in zip(rows,rows[1:]):
   for k in range(sides):
    l=(k+1)%sides;self.tri(a[k],a[l],b[k]);self.tri(a[l],b[l],b[k])
  for row,p,n,reverse in [(rows[0],points[0],unit(sub(points[0],points[1])),True),(rows[-1],points[-1],unit(sub(points[-1],points[-2])),False)]:
   center=self.vertex(p,n,c)
   for k in range(sides):
    a,b=row[k],row[(k+1)%sides];self.tri(center,b,a) if reverse else self.tri(center,a,b)
 def patch(self,outline,c,zfunc):
  # Convex facial patch, projected to the head surface; fan normals face +Z.
  x=sum(p[0] for p in outline)/len(outline);y=sum(p[1] for p in outline)/len(outline)
  center=self.vertex([x,y,zfunc(x,y)],[0,0,1],c)
  row=[self.vertex([x,y,zfunc(x,y)],[0,0,1],c) for x,y in outline]
  for k in range(len(row)):self.tri(center,row[k],row[(k+1)%len(row)])
def curve(points,steps=8):
 out=[]
 for i in range(len(points)-1):
  p0=points[max(0,i-1)];p1=points[i];p2=points[i+1];p3=points[min(i+2,len(points)-1)]
  for k in range(steps):
   t=k/steps
   out.append([.5*((2*p1[d])+(-p0[d]+p2[d])*t+(2*p0[d]-5*p1[d]+4*p2[d]-p3[d])*t*t+(-p0[d]+3*p1[d]-3*p2[d]+p3[d])*t*t*t) for d in range(3)])
 return out+[points[-1]]
parts={}
def part(name):s=Shape();parts[name]=s;return s
# Base silhouette, compact standing pose, large spherical head and rounded hands/feet.
part('Body').ellipsoid([0,-.53,-.03],[.37,.47,.34],'blue',24,14)
part('Head').ellipsoid([0,.32,.12],[.69,.63,.52],'blue',40,24)
for sign,label in [(-1,'L'),(1,'R')]:
 part('Ear_'+label).ellipsoid([sign*.59,.79,.09],[.16,.063,.065],'blue',16,8,sign*25)
 horn=part('Horn_'+label)
 horn.tube(curve([[sign*.40,.80,.08],[sign*.47,1.02,.07],[sign*.49,1.26,.09]],5),.064,'cream',10)
 horn.ellipsoid([sign*.49,1.26,.09],[.065,.065,.065],'cream',10,6)
 horn.tube(curve([[sign*.46,1.04,.07],[sign*.59,1.08,.07],[sign*.62,1.18,.09]],4),.058,'cream',10)
 horn.ellipsoid([sign*.62,1.18,.09],[.058,.06,.058],'cream',10,6)
 # A curved upper arm narrows at the wrist and opens into a soft mitten palm.
 # The small thumb is part of Arm_L/R, not a new joint or animation contract.
 arm=part('Arm_'+label)
 arm.tube([[sign*x,y,z] for x,y,z in [(.40,-.22,.10),(.42,-.26,.13),
  (.44,-.34,.16),(.455,-.43,.185),(.465,-.53,.20),(.475,-.60,.21),
  (.48,-.66,.215),(.48,-.72,.22),(.47,-.765,.22),(.46,-.78,.22)]],
  [.025,.079,.086,.082,.073,.078,.102,.099,.061,.012],'blue',12)
 arm.ellipsoid([sign*.397,-.686,.282],[.049,.067,.052],'blue',10,6,sign*-18)

 leg=part('Leg_'+label);leg.ellipsoid([sign*.20,-.96,.01],[.125,.19,.14],'blue',16,10)
 leg.ellipsoid([sign*.23,-1.065,.11],[.19,.10,.22],'blue',20,8)
# Surface projected details avoid floating face stickers or a long snout.
def face(x,y,offset=.009):return .12+.52*math.sqrt(max(.01,1-(x/.69)**2-((y-.32)/.63)**2))+offset
for sign,label in [(-1,'L'),(1,'R')]:
 x=sign*.255;y=.43
 part('Eye_'+label).ellipsoid([x,y,face(x,y)],[.038,.043,.022],'ink',16,10)
 cheek=part('Cheek_'+label);x=sign*.46;y=.22
 cheek.patch([[x+.105*math.cos(k*math.tau/32),y+.11*math.sin(k*math.tau/32)] for k in range(32)],'pink',face)
# Open smile with two ivory teeth, pink tongue, m-shaped nose: official basic/front expression.
outline=[[-.20,.27],[-.11,.265],[0,.315],[.11,.265],[.20,.27],[.17,.09],[.10,.015],[0,-.015],[-.10,.015],[-.17,.09]]
outline=[p[:2] for p in curve([[x,y,0] for x,y in outline+[outline[0]]],4)[:-1]][::-1];mouth=part('Mouth');mouth.patch(outline,'mouth',lambda x,y:face(x,y,.012))
pts=[[x,y,face(x,y,.018)] for x,y in outline+[outline[0]]];mouth.tube(pts,.014,'ink',8)
tongue=part('Tongue');tongue.patch([[-.11,.045],[-.06,.072],[0,.08],[.06,.072],[.11,.045],[.075,.01],[0,-.003],[-.075,.01]][::-1],'pink',lambda x,y:face(x,y,.022))
for sign,label in [(-1,'L'),(1,'R')]:
 x=sign*.135
 part('Fang_'+label).patch([[x-.035,.26],[x-.023,.20],[x,.183],[x+.023,.20],[x+.035,.26]],'cream',lambda x,y:face(x,y,.028))
nose=part('Nose');points=curve([[-.115,.34,0],[-.09,.405,0],[-.04,.41,0],[0,.36,0],[.04,.41,0],[.09,.405,0],[.115,.34,0]],4)
nose.tube([[x,y,face(x,y,.022)] for x,y,_ in points],.016,'ink',8)
forelock=part('Forelock');forelock.ellipsoid([-.03,.88,.18],[.15,.12,.15],'blue',20,12)
pts=[]
for k in range(33):
 t=k/32;angle=-math.pi/2+t*math.pi*3;radius=.115*(1-t)+.012;x=radius*math.cos(angle);y=.77+radius*math.sin(angle)
 pts.append([x,y,face(x,y,.017)])
forelock.tube(pts,.014,'ink',6)
# Cream belly and three subtle transverse bands visible in official front/side views.
def belly_surface(x,y):return -.03+.34*math.sqrt(max(.01,1-(x/.37)**2-((y+.53)/.47)**2))+.012
belly=part('Belly')
outline=curve([[-.20,-.42,0],[-.215,-.54,0],[-.19,-.72,0],[-.13,-.80,0],[0,-.83,0],[.13,-.80,0],[.19,-.72,0],[.215,-.54,0],[.20,-.42,0],[-.20,-.42,0]],4)[:-1]
# Subdivide the curved patch so its triangles do not cut under the body surface.
def belly_vertex(x,y):
 z=belly_surface(x,y)
 return belly.vertex([x,y,z],unit([x/(.37*.37),(y+.53)/(.47*.47),(z+.03)/(.34*.34)]),'cream')
center=belly_vertex(0,-.61);rows=[]
for j in range(1,7):
 r=j/6;rows.append([belly_vertex(x*r,-.61+(y+.61)*r) for x,y,_ in outline])
for k in range(len(outline)):belly.tri(center,rows[0][k],rows[0][(k+1)%len(outline)])
for a,b in zip(rows,rows[1:]):
 for k in range(len(outline)):
  l=(k+1)%len(outline);belly.tri(a[k],b[k],a[l]);belly.tri(a[l],b[k],b[l])
bands=part('BellyBands')
for y,width in [(-.51,.207),(-.63,.201),(-.74,.173)]:
 bands.tube([[x,y,belly_surface(x,y)+.004] for x in [-width+2*width*k/20 for k in range(21)]],.008,'ink',6)
# One continuous, scalloped cloud surface with a spiral, in both directions.
# Same contour family on the small identity wing and airborne extension.
def cloud_wing(shape,sign,origin,scale,extended=False):
 controls=[[.02,-.08,0],[.09,.13,0],[.28,.24,0],[.50,.22,0],
  [.73,.28,0],[.95,.43,0],[1.02,.38,0],[.99,.19,0],
  [1.07,.10,0],[1.02,-.04,0],[.88,-.17,0],[.66,-.20,0],
  [.42,-.18,0],[.15,-.17,0],[.02,-.08,0]]
 if extended:
  # Broad, shallow scallops replace the narrow three-finger outer edge.
  # Identity CloudWing, vertex ordering, spiral and animation pivot stay intact.
  controls=[[.02,-.08,0],[.12,.19,0],[.36,.41,0],[.59,.34,0],
   [.80,.48,0],[1.01,.43,0],[1.08,.29,0],[1.22,.24,0],
   [1.24,.08,0],[1.12,-.04,0],[1.08,-.20,0],[.91,-.29,0],
   [.68,-.27,0],[.36,-.24,0],[.02,-.08,0]]
 outline=curve(controls,3)[:-1]
 center=[.58,.08];count=len(outline);rows=[];start=len(shape.p)//3
 def point(x,y,z):return add(origin,[sign*x*scale,y*scale,z*scale])
 # Elliptical cross-section closes to a smooth rim; same winding for both sides.
 front=shape.vertex(point(*center,.13),[0,0,1],'cream')
 for j in range(1,7):
  angle=math.pi*j/7;r=math.sin(angle);z=.13*math.cos(angle);row=[]
  for x,y,_ in outline:
   row.append(shape.vertex(point(center[0]+(x-center[0])*r,center[1]+(y-center[1])*r,z),[0,0,1],'cream'))
  rows.append(row)
 back=shape.vertex(point(*center,-.13),[0,0,-1],'cream')
 def tri(a,b,c):shape.tri(a,c,b) if sign>0 else shape.tri(a,b,c)
 for k in range(count):
  l=(k+1)%count;tri(front,rows[0][k],rows[0][l]);tri(back,rows[-1][l],rows[-1][k])
 for a,b in zip(rows,rows[1:]):
  for k in range(count):
   l=(k+1)%count;tri(a[k],b[k],a[l]);tri(a[l],b[k],b[l])
 # Area-weighted normals for the sculpted cloud surface.
 normals=[[0,0,0] for _ in range(len(shape.p)//3)]
 for k in range(0,len(shape.i),3):
  a,b,c=shape.i[k:k+3];pa,pb,pc=[shape.p[i*3:i*3+3] for i in (a,b,c)]
  n=cross(sub(pb,pa),sub(pc,pa))
  for i in (a,b,c):normals[i]=add(normals[i],n)
 for i in range(start,len(normals)):shape.n[i*3:i*3+3]=unit(normals[i])
 for side in [-1,1]:
  pts=[]
  for k in range(24):
   t=k/23;r=.21*(1-t)+.015;angle=-math.pi*.60-t*math.tau*1.08
   pts.append(point(.40+r*math.cos(angle),.08+r*math.sin(angle),side*.139))
  shape.tube(pts,.012*scale,'ink',6)
for sign,label in [(-1,'L'),(1,'R')]:
 # The identity cloud runs back along the shoulder, not out as a frontal plate.
 # Rotate its contour 62 degrees around Y, mirror the rotation, and thin depth.
 # Keep the hand below/in front of it; the expanded animated wing is untouched.
 small=part('CloudWing_'+label)
 cloud_wing(small,sign,[0,0,0],.43)
 angle=sign*math.radians(62);co=math.cos(angle);si=math.sin(angle)
 for i in range(len(small.p)//3):
  x,y,z=small.p[i*3:i*3+3];z*=.68
  small.p[i*3:i*3+3]=[sign*.40+co*x+si*z,y-.24,.12-si*x+co*z]
  nx,ny,nz=small.n[i*3:i*3+3];nz/=.68
  small.n[i*3:i*3+3]=unit([co*nx+si*nz,ny,-si*nx+co*nz])
 cloud_wing(part('FlightWing_'+label),sign,[0,0,0],1.0,extended=True)
# Back-view tail: a fuller curl leaving the rump, with depth visible from the side.
tail=part('Tail');pts=curve([[0,-.74,-.28],[-.38,-.59,-.62],[-.48,-.24,-.83],[-.27,-.04,-.91],[.11,-.04,-.90],[.48,-.18,-.76],[.71,-.44,-.60],[.79,-.67,-.46]],5)
radii=[.17*(1-i/(len(pts)-1))+.075 for i in range(len(pts))];tail.tube(pts,radii,'blue',12)
# Preserve the exact original attachment ring/cap while gathering the rest of
# the standing curl close to the rump. Same 36 rings, indices and target order.
attachment_p=tail.p[:36];attachment_n=tail.n[:36]
cap_index=len(pts)*12*3
cap_p=tail.p[cap_index:cap_index+3];cap_n=tail.n[cap_index:cap_index+3]
# Keep the curl below the rider's feet as it crosses behind the body; the old
# high central arc intersected the rider on ground/hover despite head clearance.
pts=curve([[0,-.74,-.28],[-.24,-.69,-.48],[-.35,-.53,-.61],[-.22,-.39,-.66],[.07,-.37,-.64],[.34,-.44,-.58],[.49,-.59,-.48],[.53,-.74,-.41]],5)
tail=part('Tail');tail.tube(pts,radii,'blue',12)
tail.p[:36]=attachment_p;tail.n[:36]=attachment_n
tail.p[cap_index:cap_index+3]=cap_p;tail.n[cap_index:cap_index+3]=cap_n
end=pts[-1];tip=part('TailCloud')
# Three rounded cloud lobes fan out from a common root, not thin dangling digits.
def tail_cloud(shape,end,scale=1):
 for dx,dy,angle in [(-.08,-.055,-40),(0,-.12,0),(.09,-.04,45)]:
  shape.ellipsoid(add(end,[dx*scale,dy*scale,.015]),[.085*scale,.12*scale,.075*scale],'cream',12,8,angle)
tail_cloud(tip,end)
# Three topology-identical targets deform the tail itself, including its cloud tip.
# Body-space curves deliberately compensate for the strong full-body flight pitch.
# The root ring never moves, so every blend stays attached to the rump.
tail_targets={name:[] for name in ['Tail','TailCloud']}
root=[0,-.74,-.28]
for target_index,controls in enumerate([
 [root,[-.20,-.95,-.43],[-.25,-1.10,-.61],[-.18,-1.24,-.80],[0,-1.36,-.96],[.19,-1.43,-1.09],[.32,-1.40,-1.17],[.38,-1.31,-1.16]],
 [root,[-.08,-1.04,-.44],[-.16,-1.32,-.67],[-.18,-1.66,-.94],[-.10,-2.02,-1.15],[.03,-2.35,-1.29],[.11,-2.63,-1.39],[.08,-2.85,-1.50]],
 [root,[-.14,-.96,-.51],[-.20,-1.05,-.84],[-.18,-1.12,-1.20],[-.08,-1.23,-1.56],[.07,-1.41,-1.91],[.20,-1.64,-2.18],[.25,-1.85,-2.35]]
]):
 points=curve(controls,5);target=Shape();target.tube(points,radii,'blue',12)
 cloud=Shape()
 tail_cloud(cloud,points[-1],[1.15,1.5,1.35][target_index])
 # Identical attachment ring for all targets, avoiding a moving seam at the body.
 target.p[:36]=parts['Tail'].p[:36];target.n[:36]=parts['Tail'].n[:36]
 target.p[cap_index:cap_index+3]=cap_p;target.n[cap_index:cap_index+3]=cap_n
 for name,shape in [('Tail',target),('TailCloud',cloud)]:tail_targets[name].append(shape)
# Keep the face level while the body pitches; every face detail follows one pivot.
head_names=[n for n in parts if n=='Head' or n.split('_')[0] in ['Ear','Horn','Eye','Cheek','Fang'] or n in ['Mouth','Tongue','Nose','Forelock']]
head_origin=[0,-.05,.05]
for name in head_names:
 shape=parts[name]
 shape.p=[v-head_origin[i%3] for i,v in enumerate(shape.p)]

# Write a semantic hierarchy with one vertex-color material, no texture.
g={'asset':{'version':'2.0','generator':GENERATOR,'copyright':'Annyongi character design: Inha University. New geometry: INHAGAME project. Noncommercial review candidate; university design approval pending.'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'name':'Annyongi_Root','children':[]}],'meshes':[],'materials':[{'name':'Annyongi_VertexPalette','pbrMetallicRoughness':{'baseColorFactor':[1,1,1,1],'metallicFactor':0,'roughnessFactor':.9}}],'accessors':[],'bufferViews':[],'buffers':[{}]}
binbuf=bytearray()
def accessor(data,fmt,typ,component,target):
 while len(binbuf)%4:binbuf.append(0)
 raw=struct.pack('<'+fmt*len(data),*data);offset=len(binbuf);binbuf.extend(raw)
 view=len(g['bufferViews']);g['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(raw),'target':target})
 size={'SCALAR':1,'VEC3':3,'VEC4':4}[typ];a={'bufferView':view,'componentType':component,'count':len(data)//size,'type':typ}
 if typ=='VEC3':a.update(min=[min(data[k::3]) for k in range(3)],max=[max(data[k::3]) for k in range(3)])
 g['accessors'].append(a);return len(g['accessors'])-1
for name,s in parts.items():
 p=accessor(s.p,'f','VEC3',5126,34962);n=accessor(s.n,'f','VEC3',5126,34962);c=accessor(s.c,'f','VEC4',5126,34962);idx=accessor(s.i,'H','SCALAR',5123,34963)
 g['nodes'][0]['children'].append(len(g['nodes']));g['nodes'].append({'name':name,'mesh':len(g['meshes'])});g['meshes'].append({'name':name,'primitives':[{'attributes':{'POSITION':p,'NORMAL':n,'COLOR_0':c},'indices':idx,'material':0}]})
 # glTF morph positions and normals are deltas from the curled base.
 if name in tail_targets:
  mesh=g['meshes'][-1];mesh['weights']=[0,0,0];mesh['extras']={'targetNames':['TailAscend','TailForward','TailGlide']}
  mesh['primitives'][0]['targets']=[]
  for target in tail_targets[name]:
   mesh['primitives'][0]['targets'].append({key:accessor([a-b for a,b in zip(values,base)],'f','VEC3',5126,34962) for key,values,base in [('POSITION',target.p,s.p),('NORMAL',target.n,s.n)]})
for name,pos in [('DragonWing_L',[-.38,-.20,-.26]),('DragonWing_R',[.38,-.20,-.26]),('RiderAnchor',[0,-.08,-.80])]:
 g['nodes'][0]['children'].append(len(g['nodes']));g['nodes'].append({'name':name,'translation':pos,'extras':{'purpose':'invisible compatibility pivot' if name.startswith('Dragon') else 'rider feet; +Z forward'}})
# The legacy pivots drive the cloud extensions; small CloudWing identity stays fixed.
for label in ['L','R']:
 idx=next(i for i,n in enumerate(g['nodes']) if n['name']=='FlightWing_'+label)
 pivot=next(n for n in g['nodes'] if n['name']=='DragonWing_'+label)
 pivot['children']=[idx];pivot['extras']={'purpose':'animated flight fan; compatibility name retained'}
 g['nodes'][0]['children'].remove(idx)
head_children=[i for i,n in enumerate(g['nodes']) if n['name'] in head_names]
g['nodes'][0]['children']=[i for i in g['nodes'][0]['children'] if i not in head_children]
g['nodes'][0]['children'].append(len(g['nodes']))
g['nodes'].append({'name':'FlightHeadPivot','translation':head_origin,'children':head_children,'extras':{'purpose':'face counter-pitch during full-body flight'}})
g['buffers'][0]['byteLength']=len(binbuf)
js=json.dumps(g,ensure_ascii=True,separators=(',',':')).encode();js+=b' '*((-len(js))%4);binbuf+=b'\0'*((-len(binbuf))%4)
result=struct.pack('<III',0x46546c67,2,28+len(js)+len(binbuf))+struct.pack('<I4s',len(js),b'JSON')+js+struct.pack('<I4s',len(binbuf),b'BIN\0')+binbuf
OUT.write_bytes(result)
print(json.dumps({'bytes':len(result),'triangles':sum(len(s.i)//3 for s in parts.values()),'materials':1,'textures':0,'meshes':len(parts),'sha256':hashlib.sha256(result).hexdigest()}))
