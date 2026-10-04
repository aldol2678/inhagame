import * as pc from 'playcanvas';
import { buildCampusFacilities } from './facility-blockout.js';
import { buildMainHallBlockout } from './main-hall-blockout.js';
import { buildCampusGrounds, buildCampusTrees } from './campus-grounds.js';
import { buildGateBlockout } from './gate-blockout.js';
import { buildCentralBlockout } from './central-blockout.js';
import { WORLD_BOUNDS } from './campus-layout.js';
import { buildPondShore } from './roadview-details.js';
import { buildCampusRoads, buildBackStreetDetails } from './campus-road-blockout.js';
import { buildLibraryGardenBase, buildLibraryGardenDetail } from './library-garden-geometry.js';
import { buildCampusTerrain } from './campus-terrain.js';
import { buildStadiumStands } from './stadium-stands-geometry.js';
import { buildLibraryRoute } from './library-route-geometry.js';
import { buildCampusHelicopter } from './mounts/campus-helicopter-render.js';

const count=root=>1+root.children.reduce((sum,c)=>sum+count(c),0);
export class CampusChunkRenderer {
  constructor(app,parent,registry,environmentSignals={}) {
    this.parent=parent;this.metrics={entitiesCreated:0,entitiesDestroyed:0,nearBuilds:0,detailBuilds:0,baseBuilds:1};
    this.fades=new Map();
    // Small campus P0: persistent terrain/roads/silhouettes avoid holes and invisible walls.
    const base=new pc.Entity('CampusBase');parent.addChild(base);this.base=base;
    buildCampusTerrain(base,WORLD_BOUNDS);
    buildCampusGrounds(base);buildCampusRoads(base);buildGateBlockout(base);this.pondWeather=buildCentralBlockout(base,app,environmentSignals);buildPondShore(base);
    buildLibraryGardenBase(base);
    buildStadiumStands(base);
    buildCampusHelicopter(base);
    buildLibraryRoute(base);
    for(const chunk of registry.chunks){buildCampusFacilities(base,chunk.facilities,'BASE');buildMainHallBlockout(base,chunk.buildings,'BASE');}
    this.metrics.entitiesCreated+=count(base);
  }
  create(chunk) {
    const root=new pc.Entity(chunk.id);this.parent.addChild(root);this.metrics.entitiesCreated++;
    return {chunk,root,near:null,detail:null};
  }
  setViewPolicy(policy) { this.base.enabled=policy.preserveCampus; }
  #layer(handle,tier) {
    const root=new pc.Entity(`${handle.chunk.id}_${tier}`);handle.root.addChild(root);
    buildCampusFacilities(root,handle.chunk.facilities,tier);
    buildMainHallBlockout(root,handle.chunk.buildings,tier);
    buildBackStreetDetails(root,handle.chunk.streetscape,tier);
    if(tier==='DETAIL')buildLibraryGardenDetail(root,handle.chunk.streetscape);
    if(tier==='NEAR')buildCampusTrees(root,handle.chunk.trees);
    // Local material copies fade details without touching shared BASE materials.
    // Dither remains in the opaque/depth-writing pass, avoiding glass sort changes.
    const copies=new Map();
    for(const component of root.findComponents('render'))for(const mi of component.meshInstances){
      if(!copies.has(mi.material)){
        const material=mi.material.clone();
        material.opacityDither=pc.DITHER_BAYER8;material.opacityShadowDither=pc.DITHER_BAYER8;
        material.alphaDither=0;material.update();copies.set(mi.material,material);
      }
      mi.material=copies.get(mi.material);
    }
    this.fades.set(root,{value:0,target:0,materials:[...copies.values()]});
    root.enabled=false;
    root.on('destroy',()=>{this.fades.delete(root);for(const material of copies.values())material.destroy();});
    this.metrics.entitiesCreated+=count(root);this.metrics[tier==='NEAR'?'nearBuilds':'detailBuilds']++;
    return root;
  }
  setState(handle,state) {
    const near=state==='NEAR'||state==='ACTIVE',detail=state==='ACTIVE';
    // Lazily build each layer once per residency; toggle it on later transitions.
    if(near&&!handle.near)handle.near=this.#layer(handle,'NEAR');
    if(detail&&!handle.detail)handle.detail=this.#layer(handle,'DETAIL');
    for(const [root,visible] of [[handle.near,near],[handle.detail,detail]])if(root){
      this.fades.get(root).target=visible?1:0;
      if(visible)root.enabled=true;
    }
  }
  update(dt) {
    for(const [root,fade] of this.fades){
      if(fade.value===fade.target)continue;
      const delta=Math.max(0,dt)/.25;
      fade.value=fade.target>fade.value?Math.min(fade.target,fade.value+delta):Math.max(fade.target,fade.value-delta);
      for(const material of fade.materials){material.alphaDither=fade.value;material.update();}
      root.enabled=fade.value>0;
    }
  }
  destroy(handle) { this.metrics.entitiesDestroyed+=count(handle.root);handle.root.destroy(); }
  getMetrics() { return {...this.metrics}; }
  getPondWeatherStatus() { return this.pondWeather?.status?.() ?? null; }
}
