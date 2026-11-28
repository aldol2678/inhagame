"""Topology-conscious stylized grooming for the existing professor head."""
import bpy,math
from math import cos,sin,pi,tau,sqrt,exp
from mathutils import Vector as V
from mathutils.bvhtree import BVHTree
def ss(a,b,x):
 t=max(0,min(1,(x-a)/(b-a))); return t*t*(3-2*t)
def interp(a,b,t):return a+(b-a)*t
def linear(h):
 q=[int(h[i:i+2],16)/255 for i in (0,2,4)]
 return [a/12.92 if a<=.04045 else ((a+.055)/1.055)**2.4 for a in q]
def hair_color(name,col):
 key='INHA groom / '+name
 m=bpy.data.materials.get(key) or bpy.data.materials.new(key);m.use_nodes=True
 nodes=m.node_tree.nodes;nodes.clear()
 out=nodes.new('ShaderNodeOutputMaterial');bs=nodes.new('ShaderNodeBsdfPrincipled');vc=nodes.new('ShaderNodeVertexColor');vc.layer_name='HairColor'
 m.node_tree.links.new(vc.outputs['Color'],bs.inputs['Base Color']);m.node_tree.links.new(bs.outputs[0],out.inputs['Surface'])
 bs.inputs['Roughness'].default_value=.79;bs.inputs['Specular IOR Level'].default_value=.22;m.diffuse_color=(*col,1)
 return m
def build_hair(r,head,cx,style):
 s=bpy.context.scene
 b=head.data
 skin=[p.vertices[:] for p in b.polygons if 'professor / skin' in b.materials[p.material_index].name]
 hull=BVHTree.FromPolygons([v.co for v in b.vertices],skin)
 O=V((cx,.012,1.527));n=112;k=34
 rgb=linear({'architecture':'423A38','botany':'A5A3AD','literature':'644535'}[style])
 vertices=[];tones=[];faces=[]
 # Texture and volume flow along sculpted bands in a single scalp surface.
 def vertex(a,f):
  front=max(0,-sin(a));back=max(0,sin(a));side=abs(cos(a))
  if style=='architecture':
   edge=1.85+.51*back-.70*front**5-.22*side**9+.075*front*sin(2*a+.42)
   lift=.004+.010*front**2+.003*sin(a+.8)
   phase=10*(a+1.57)+3.9*f+.75*sin(2*a)
   wave=.0025*cos(phase)+.00065*sin(2*phase)
  elif style=='botany':
   edge=1.83+.58*back-.61*front**5-.18*side**8+.09*cos(6*a+.3)+.045*sin(10*a)
   lift=.010+.003*front+.004*sin(2*a)
   phase=8*a+9.4*f+1.4*sin(3*a-7*f)
   wave=.0045*cos(phase)+.002*cos(phase-7.4*f)+.0008*cos(3*phase)
  else:
   edge=2.03+.63*back-.87*front**6-.17*side**8+.10*front*sin(2*a-.2)+.028*sin(7*a)
   lift=.014+.005*back+.003*cos(a)
   phase=9*a+3.5*f+1.5*sin(2*a)+.72*f*sin(3*a)
   wave=.004*cos(phase)+.0017*sin(phase*2)
  t=f*edge
  vec=V((.100*sin(t)*cos(a),.110*sin(t)*sin(a),.097*cos(t)))
  D=vec.normalized()
  hit,*_=hull.ray_cast(O,D,.21)
  # Fit the upper silhouette to the actual head. Use the ellipsoid on
  # lower side/rear so ear faces cannot make the edge bulge.
  measured=(hit-O).length if hit is not None else vec.length
  m=ss(.55,.88,f) if side>.77 else 0
  # The mesh has flat planes and disconnected ears; blend ray measurements
  # with a scalp envelope, then fade to a thin hairline.
  base=max(vec.length*(.92+.06*back),min(vec.length*1.07,measured))
  base=interp(base,vec.length*.93,m*.85)
  fvol=ss(0,.18,f)*(1-ss(.73,1.,f))
  delta=interp(.0012,.005+lift+wave*fvol,1-ss(.76,1.,f))
  # Taper almost flush on the boundary and inset the underside rim.
  col=(.82+.20*min(1,(1-f)/.32)+.10*fvol*cos(phase+.3)+.065*front)
  if style=='architecture':col-=.10*ss(.69,1.,f)
  pos=O+D*(base+delta)
  if style=='literature':
   bob=ss(.50,1.,f)*(1-ss(.38,.73,front))
   pos.z-=.037*bob*(.70*back+.54*side)
   pos.y+=.013*back*bob
  return pos,tuple(min(1,c*col) for c in rgb)+(1,)
 pole,_=vertex(0,0);vertices.append(pole);tones.append(tuple(rgb)+(1,))
 for j in range(1,k+1):
  for i in range(n):
   a=i*tau/n;v,c=vertex(a,j/k);vertices.append(v);tones.append(c)
 for i in range(n):faces.append((0,1+i,1+(i+1)%n))
 for j in range(k-1):
  for i in range(n):
   a=1+j*n+i;b=1+j*n+(i+1)%n;faces.append((a,a+n,b+n,b))
 for i in range(n):
  v,col=vertex(i*tau/n,1.);vertices.append(v.lerp(O,.036));tones.append(col)
 a=1+(k-1)*n
 for i in range(n):faces.append((a+i,a+n+i,a+n+(i+1)%n,a+(i+1)%n))
 me=bpy.data.meshes.new('Continuous scalp with directional relief');me.from_pydata(vertices,[],faces);me.update()
 me.materials.append(hair_color(style,rgb))
 c=me.color_attributes.new(name='HairColor',type='FLOAT_COLOR',domain='POINT')
 for q,col in zip(c.data,tones):q.color=col
 for p in me.polygons:p.use_smooth=True
 o=bpy.data.objects.new('NPC_Hair',me);s.collection.objects.link(o);o.parent=r
 o.vertex_groups.new(name='Head').add(list(range(len(me.vertices))),1,'REPLACE')
 o.modifiers.new('Follows original head rig','ARMATURE').object=r
 return {'style':style,'connectedMeshes':1,'hairVertices':len(vertices),'hairFaces':len(faces)}
def beard(head,cx,key):
 # No overlay mesh: bake pigment on the surface of the existing skin.
 mesh=head.data
 ids=[i for i,m in enumerate(mesh.materials) if m and m.name.startswith('professor / skin')]
 if not ids:raise ValueError('Missing original head skin material.')
 index=ids[0];src=mesh.materials[index]
 prior=[i for i,m in enumerate(mesh.materials) if m and m.name.startswith('INHA chin pigment')]
 for p in mesh.polygons:
  if p.material_index in prior:p.material_index=index
 if key=='none':return {'beard':'none','extraGeometry':0}
 import tempfile,zlib,struct,os
 sz=256; tag='INHA chin pigment / '+head.name
 skin=src.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value
 tint=linear('493832' if key=='short' else '51433D')
 rows=bytearray()
 def rgb_byte(x):
  c=12.92*x if x<=.0031308 else 1.055*x**(1/2.4)-.055
  return round(max(0,min(1,c))*255)
 # UV x: +/- 13cm around the eyes; UV z: 1.325..1.535. Cheek line rises
 # into the sides while center ends just below the lower lip.
 for j in reversed(range(sz)):
  rows.append(0)
  z=1.325+.210*(j+.5)/sz
  for i in range(sz):
   x=.260*((i+.5)/sz-.5);a=abs(x)
   top=1.401+.061*min(1,(a/.100)**2.2)
   if key=='short':top+=.009
   edge=.090+.007*ss(1.40,1.45,z)
   w=(1-ss(top-.009,top+.007,z))*(1-ss(edge-.008,edge+.006,a))
   w*=ss(1.328,1.345,z)
   # Subtle directional coarse grain. Geometry and lip/eye materials unchanged.
   h=((i*92821)^(j*68917)^(i*j*4127))%997/996
   stri=.85+.12*sin(i*.63+j*.15)+.12*cos(i*.29-j*.52)
   strength=w*(.47 if key=='short' else .29)*(.50+.59*h)*stri
   vals=[interp(skin[k],tint[k],max(0,min(1,strength))) for k in range(3)]
   rows.extend(rgb_byte(x) for x in vals)
 def chunk(t,d):return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d))
 png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',sz,sz,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')
 prior_img=bpy.data.images.get(tag)
 with tempfile.NamedTemporaryFile(suffix='.png') as tmp:
  tmp.write(png);tmp.flush()
  img=bpy.data.images.load(tmp.name,check_existing=False);img.pack()
 if prior_img:bpy.data.images.remove(prior_img,do_unlink=True)
 img.name=tag
 img.colorspace_settings.name='sRGB'
 m=bpy.data.materials.get(tag) or bpy.data.materials.new(tag)
 m.use_nodes=True; ns=m.node_tree.nodes;ns.clear();out=ns.new('ShaderNodeOutputMaterial');bs=ns.new('ShaderNodeBsdfPrincipled')
 tex=ns.new('ShaderNodeTexImage');tex.image=img;tex.extension='EXTEND';tex.interpolation='Linear'
 uv=ns.new('ShaderNodeUVMap');uv.uv_map='BeardUV';link=m.node_tree.links
 link.new(uv.outputs['UV'],tex.inputs['Vector']);link.new(tex.outputs['Color'],bs.inputs['Base Color']);link.new(bs.outputs[0],out.inputs['Surface'])
 bs.inputs['Roughness'].default_value=.80;m.diffuse_color=(*skin[:3],1)
 ind=mesh.materials.find(m.name)
 if ind<0:mesh.materials.append(m);ind=len(mesh.materials)-1
 layer=mesh.uv_layers.get('BeardUV') or mesh.uv_layers.new(name='BeardUV')
 for poly in mesh.polygons:
  if poly.material_index!=index:continue
  if not (1.335<poly.center.z<1.49 and poly.center.y<.022):continue
  poly.material_index=ind
  for j in poly.loop_indices:
   v=mesh.vertices[mesh.loops[j].vertex_index].co
   layer.uv[j].vector=((v.x-cx)/.260+.5,(v.z-1.325)/.210)
 mesh.update()
 return {'beard':key,'extraGeometry':0,'texture':sz,'texturedFaces':sum(p.material_index==ind for p in mesh.polygons)}
