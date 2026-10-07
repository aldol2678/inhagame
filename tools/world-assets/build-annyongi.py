#!/usr/bin/env python3
"""Deterministic project-authored Annyongi reconstruction. No source pixels embedded.
Design references and permissions: docs/implementation/annyongi-3d-redesign-01/DISCOVERY.md
Y-up, +Z front, coordinates in player-root space. Python stdlib only.
"""
import json, math, struct, pathlib, hashlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'apps/world/assets/annyongi-flight-v1.glb'
GENERATOR='INHAGAME Annyongi procedural flight reconstruction v2'
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
 part('Ear_'+label).ellipsoid([sign*.59,.83,.09],[.17,.07,.065],'blue',16,8,sign*35)
 horn=part('Horn_'+label)
 horn.tube(curve([[sign*.40,.80,.08],[sign*.47,1.02,.07],[sign*.49,1.26,.09]],5),.052,'cream',10)
 horn.ellipsoid([sign*.49,1.26,.09],[.053,.055,.053],'cream',10,6)
 horn.tube(curve([[sign*.46,1.04,.07],[sign*.59,1.08,.07],[sign*.62,1.18,.09]],4),.048,'cream',10)
 horn.ellipsoid([sign*.62,1.18,.09],[.048,.05,.048],'cream',10,6)
 arm=part('Arm_'+label);arm.ellipsoid([sign*.42,-.48,.13],[.13,.32,.13],'blue',16,10)

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
forelock=part('Forelock');forelock.ellipsoid([-.03,.91,.23],[.15,.13,.15],'blue',20,12)
pts=[]
for k in range(33):
 t=k/32;angle=-math.pi/2+t*math.pi*3;radius=.115*(1-t)+.012;x=radius*math.cos(angle);y=.77+radius*math.sin(angle)
 pts.append([x,y,face(x,y,.017)])
forelock.tube(pts,.020,'curl',6)
# Cream belly and three subtle transverse bands visible in official front/side views.
belly=part('Belly');belly.ellipsoid([0,-.61,.269],[.23,.25,.045],'cream',24,12)
bands=part('BellyBands')
for y in [-.49,-.61,-.73]:
 width=.225*math.sqrt(max(0,1-((y+.61)/.25)**2))
 points=[]
 for k in range(21):
  x=-width+2*width*k/20;z=.269+.045*math.sqrt(max(0,1-(x/.23)**2-((y+.61)/.25)**2))+.004
  points.append([x,y,z])
 bands.tube(points,.010,'ink',6)
# Compact cloud wings; fixed identity detail, separate from legacy EMPTY wing pivots.
for sign,label in [(-1,'L'),(1,'R')]:
 wing=part('CloudWing_'+label)
 wing.ellipsoid([sign*.46,-.22,-.13],[.27,.20,.09],'cream',20,10)
 wing.ellipsoid([sign*.64,-.08,-.14],[.20,.09,.075],'cream',16,8)
 wing.ellipsoid([sign*.66,-.24,-.14],[.16,.075,.075],'cream',16,8)
 wing.ellipsoid([sign*.57,-.38,-.14],[.16,.10,.07],'cream',16,8)
 # Small raised curl on the outward/front side of each cloud.
 pts=[]
 for k in range(22):
  t=k/21;r=.095*(1-t)+.008;a=-math.pi/2+t*math.tau*1.2
  pts.append([sign*(.49+r*math.cos(a)),-.20+r*math.sin(a),-.027])
 wing.tube(pts,.012,'ink',6)
# Rounded flight fans extend the cloud motif; local coordinates hinge at the shoulder.
# Each side is one mesh. Broad overlapping lobes, no sharp membranes or claws.
for sign,label in [(-1,'L'),(1,'R')]:
 wing=part('FlightWing_'+label)
 wing.ellipsoid([sign*.48,.08,0],[.57,.23,.13],'cream',20,10,sign*18)
 for x,y,rx,ry,angle in [(.89,.38,.61,.18,32),(.97,.09,.53,.16,15),(.78,-.16,.42,.15,-5)]:
  wing.ellipsoid([sign*x,y,-.015],[rx,ry,.105],'cream',20,10,sign*angle)
 pts=curve([[sign*.17,.08,.13],[sign*.50,.17,.13],[sign*.86,.35,.11],[sign*1.22,.57,.07]],6)
 wing.tube(pts,.018,'curl',6)
# Back-view tail: a large curl leaving the rump and sweeping across the back.
tail=part('Tail');pts=curve([[0,-.74,-.28],[-.38,-.59,-.44],[-.48,-.24,-.53],[-.27,-.04,-.56],[.11,-.04,-.60],[.48,-.18,-.57],[.71,-.44,-.49],[.79,-.67,-.38]],5)
radii=[.16*(1-i/(len(pts)-1))+.048 for i in range(len(pts))];tail.tube(pts,radii,'blue',12)
end=pts[-1];tip=part('TailCloud')
for dx,dy in [(-.06,-.10),(0,-.16),(.08,-.09)]:tip.ellipsoid(add(end,[dx,dy,.015]),[.06,.105,.05],'cream',12,8)
# Preserve the curled identity but keep it below and inside the flight fan silhouette.
for name in ['Tail','TailCloud']:
 shape=parts[name]
 for i in range(0,len(shape.p),3):
  shape.p[i]*=.82;shape.p[i+1]=shape.p[i+1]*.82-.20;shape.p[i+2]*=.9
 # Nonuniform position scaling requires inverse-transpose normals.
 for i in range(0,len(shape.n),3):shape.n[i:i+3]=unit([shape.n[i]/.82,shape.n[i+1]/.82,shape.n[i+2]/.9])
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
for name,pos in [('DragonWing_L',[-.38,-.20,-.26]),('DragonWing_R',[.38,-.20,-.26]),('RiderAnchor',[0,-.08,-.74])]:
 g['nodes'][0]['children'].append(len(g['nodes']));g['nodes'].append({'name':name,'translation':pos,'extras':{'purpose':'invisible compatibility pivot' if name.startswith('Dragon') else 'rider feet; +Z forward'}})
# The legacy pivots now drive actual flight fans; small CloudWing nodes remain fixed.
for label in ['L','R']:
 idx=next(i for i,n in enumerate(g['nodes']) if n['name']=='FlightWing_'+label)
 pivot=next(n for n in g['nodes'] if n['name']=='DragonWing_'+label)
 pivot['children']=[idx];pivot['extras']={'purpose':'animated flight fan; compatibility name retained'}
 g['nodes'][0]['children'].remove(idx)
g['buffers'][0]['byteLength']=len(binbuf)
js=json.dumps(g,ensure_ascii=True,separators=(',',':')).encode();js+=b' '*((-len(js))%4);binbuf+=b'\0'*((-len(binbuf))%4)
result=struct.pack('<III',0x46546c67,2,28+len(js)+len(binbuf))+struct.pack('<I4s',len(js),b'JSON')+js+struct.pack('<I4s',len(binbuf),b'BIN\0')+binbuf
OUT.write_bytes(result)
print(json.dumps({'bytes':len(result),'triangles':sum(len(s.i)//3 for s in parts.values()),'materials':1,'textures':0,'meshes':len(parts),'sha256':hashlib.sha256(result).hexdigest()}))
