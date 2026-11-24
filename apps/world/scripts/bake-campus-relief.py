"""Bake local, playable relief from an OSM map extract and public Terrarium DEM.
Usage: python scripts/bake-campus-relief.py campus-osm.json tile-cache-dir
Requires Pillow, NumPy and SciPy. No map or tile requests are made by the game.
"""
import hashlib
import io
import json
import math
from pathlib import Path
import subprocess
import sys
import urllib.request

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt

world = Path(__file__).resolve().parents[1]
osm, cache = Path(sys.argv[1]), Path(sys.argv[2])
cache.mkdir(parents=True, exist_ok=True)
source = json.loads(osm.read_bytes())['elements']
masks = json.loads(subprocess.check_output(['node', 'scripts/campus-relief-masks.mjs'], cwd=world))
nodes = {e['id']: (e['lat'],e['lon']) for e in source if e['type']=='node'}
ways = {e['id']: e for e in source if e['type']=='way'}
east = 111320*math.cos(math.radians(37.44770))/2
north = 111195/2
def ring(way):
    return [((lon-126.65319)*east,(lat-37.44770)*north-90) for lat,lon in (nodes[n] for n in way['nodes'])]
def coords(points):
    return [(p['x'],p['z']) for p in points]
# Half-unit raster masks come from the game geometry and the exchange snapshot.
res = .5
b = masks['bounds']
x0,z0 = math.floor(b['minX'])-6, math.floor(b['minZ'])-6
nx,nz = (math.ceil((b[k]-origin+6)/res) for k,origin in [('maxX',x0),('maxZ',z0)])
def px(p):
    return (round((p[0]-x0)/res),round((p[1]-z0)/res))
def poly(draw, points, fill):
    if len(points)>=3: draw.polygon([px(p) for p in points],fill=fill)
def path(draw, points, width):
    if len(points)>=2: draw.line([px(p) for p in points],fill=0,width=math.ceil(width/res),joint='curve')
open_land = Image.new('L',(nx,nz))
draw = ImageDraw.Draw(open_land)
poly(draw,ring(ways[472447787]),255)
for points in masks['polygons']: poly(draw,coords(points),0)
for lane in masks['paths']: path(draw,coords(lane['points']),lane['width']+1)
for p in masks['points']:
    x,z = px((p['x'],p['z'])); r=p['radius']/res
    draw.ellipse((x-r,z-r,x+r,z+r),fill=0)
for way in ways.values():
    tags=way.get('tags',{})
    if tags.get('natural')=='water' or 'building' in tags or tags.get('leisure')=='pitch': poly(draw,ring(way),0)
    elif 'highway' in tags: path(draw,ring(way),2 if tags['highway'] in ('footway','path','steps') else 4)
safe = np.array(open_land)>0
tiles = {}
def dem(x,z):
    lon=126.65319+x/east
    lat=math.radians(37.44770+(z+90)/north)
    n=256*2**14
    u=(lon+180)/360*n-.5
    v=(1-math.asinh(math.tan(lat))/math.pi)*n/2-.5
    def pixel(ix,iy):
        tx,ty=ix//256,iy//256
        if (tx,ty) not in tiles:
            file=cache/f'14-{tx}-{ty}.png'
            if not file.exists():
                with urllib.request.urlopen(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/{tx}/{ty}.png',timeout=30) as src:
                    file.write_bytes(src.read())
            rgb=np.asarray(Image.open(io.BytesIO(file.read_bytes())).convert('RGB'),dtype=float)
            tiles[tx,ty]=rgb[:,:,0]*256+rgb[:,:,1]+rgb[:,:,2]/256-32768
        return tiles[tx,ty][iy%256,ix%256]
    ix,iy=math.floor(u),math.floor(v)
    a,b=u-ix,v-iy
    return sum(pixel(ix+i,iy+j)*wx*wy for i,wx in enumerate((1-a,a)) for j,wy in enumerate((1-b,b)))
spacing=3
patches=[]
greens=[w for w in ways.values() if w.get('tags',{}).get('leisure')=='park' or w.get('tags',{}).get('natural')=='wood' or w.get('tags',{}).get('landuse')=='forest']
lawns={218215618,218220046,218221011,258995412}
for way in [*sorted(greens,key=lambda w:w['id']),ways[472447787]]:
    campus=way['id']==472447787
    outline=ring(way)
    shape=Image.new('L',(nx,nz))
    poly(ImageDraw.Draw(shape),outline,255)
    if campus:
        for green in greens: poly(ImageDraw.Draw(shape),ring(green),0)
    allowed=np.array(shape).astype(bool)&safe
    ys,xs=np.nonzero(allowed)
    if xs.size<80: continue
    pad=2
    left=max(0,int(xs.min())-pad); right=min(nx,int(xs.max())+pad+1)
    top=max(0,int(ys.min())-pad); bottom=min(nz,int(ys.max())+pad+1)
    dist=distance_transform_edt(allowed[top:bottom,left:right])*res
    imin=math.ceil((x0+left*res)/spacing); imax=math.floor((x0+(right-1)*res)/spacing)
    jmin=math.ceil((z0+top*res)/spacing); jmax=math.floor((z0+(bottom-1)*res)/spacing)
    # A green patch is tied to its lowest surrounding coarse DEM samples. A
    # conservative compression and slope cap keep road/podium datums usable.
    bx=[p[0] for p in outline]; bz=[p[1] for p in outline]
    edge_samples=[dem(x,z) for x in (min(bx),(min(bx)+max(bx))/2,max(bx)) for z in (min(bz),(min(bz)+max(bz))/2,max(bz))]
    base=float(np.percentile(edge_samples,15))
    rows=[]
    for j in range(jmin,jmax+1):
        samples={}
        for i in range(imin,imax+1):
            x,z=i*spacing,j*spacing
            col,row=px((x,z))
            clearance=dist[row-top,col-left]-math.sqrt(2)*spacing-.75
            if clearance<=0: continue
            if campus:
                # Nearby terrain, not the lowest point of the entire campus,
                # sets the relief in the open space between mapped features.
                local=min(dem(x+dx,z+dz) for dx,dz in [(0,18),(0,-18),(18,0),(-18,0)])
                relief=min(1.20,max(0,dem(x,z)-local)*.21)
            elif way['id'] in lawns:
                # The field-trip panoramas show gently graded formal lawns.
                relief=min(.45,max(0,dem(x,z)-base)*.12)
            else:
                relief=min(1.65,max(0,dem(x,z)-base)*.30)
            value=round(100*min(relief,clearance*(.075 if way['id'] in lawns else .12)))
            if value>=3: samples[i]=value
        if samples:
            first,last=min(samples),max(samples)
            rows.append([j,first,*[samples.get(k,0) for k in range(first,last+1)]])
    if rows: patches.append(dict(way=way['id'],rows=rows))
output=world/'src/campus-relief-grid.js'
with output.open('w') as f:
    f.write('// Generated by scripts/bake-campus-relief.py. Heights are hundredths of a world unit, relative to adjacent level routes.\n')
    f.write('// © OpenStreetMap contributors (ODbL); Mapzen Terrain Tiles / global terrain source attribution in docs/implementation/campus-relief.md.\n')
    f.write(f'export const RELIEF_SPACING={spacing};\nexport const RELIEF_PATCHES=[\n')
    for q in patches: f.write('  '+json.dumps(q,separators=(',',':'))+',\n')
    f.write('];\n')
print('OSM snapshot',hashlib.sha256(osm.read_bytes()).hexdigest())
print('Tiles',[(k,hashlib.sha256((cache/f"14-{k[0]}-{k[1]}.png").read_bytes()).hexdigest()) for k in sorted(tiles)])
print('Patches',[(q['way'],max(max(r[2:]) for r in q['rows'])) for q in patches])
