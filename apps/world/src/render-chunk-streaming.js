import { VIEW_DISTANCE_PRESETS } from './view-distance.js';
export const ChunkState=Object.freeze({UNLOADED:'UNLOADED',VISTA:'VISTA',NEAR:'NEAR',ACTIVE:'ACTIVE'});
// P0 tuning in logical units, tested with 18 units/s flight and 250 ms evaluation.
// User camera orbit is capped at 36; silhouette/base geometry has separate residency.
export const STREAMING_POLICY=VIEW_DISTANCE_PRESETS.NORMAL;
export function desiredChunkState(distance,previous,policy=STREAMING_POLICY) {
  if(distance>(previous===ChunkState.UNLOADED?policy.load:policy.unload))return ChunkState.UNLOADED;
  if(distance<=(previous===ChunkState.ACTIVE?policy.detailExit:policy.detailEnter))return ChunkState.ACTIVE;
  if(distance<=([ChunkState.ACTIVE,ChunkState.NEAR].includes(previous)?policy.nearExit:policy.nearEnter))return ChunkState.NEAR;
  return ChunkState.VISTA;
}

// Renderer adapter is injected: deterministic policy and lifecycle tests need no GPU.
export class RenderChunkStreaming {
  constructor(registry,renderer,{intervalMs=250,policy=STREAMING_POLICY}={}) {
    this.registry=registry;this.renderer=renderer;this.intervalMs=intervalMs;this.policy=policy;this.elapsedMs=intervalMs;
    this.runtime=new Map(registry.chunks.map(c=>[c.id,{state:ChunkState.UNLOADED,handle:null}]));
    this.metrics={evaluations:0,transitions:0,chunkBuilds:0,chunkDestroys:0};
    this.pending=[];this.policyDirty=false;
    this.renderer.setViewPolicy?.(policy);
  }
  setPolicy(policy) {
    if(this.policy===policy)return;
    this.policy=policy;
    this.renderer.setViewPolicy?.(policy);
    // Keep live handles. Reconcile only differences, at most one chunk per frame.
    this.policyDirty=true;this.pending=[];this.elapsedMs=this.intervalMs;
  }
  update(dt,position) {
    this.elapsedMs+=dt*1000;
    if(this.elapsedMs>=this.intervalMs&&!this.pending.length){
      this.elapsedMs=0;this.metrics.evaluations++;
      this.pending=[...this.registry.chunks].sort((a,b)=>this.registry.distance(position,a)-this.registry.distance(position,b));
    }
    // Normal motion uses the same queue as settings; no full-campus rebuild path.
    const limit=this.policyDirty?1:this.registry.chunks.length;
    for(let i=0;i<limit&&this.pending.length;i++){
      const chunk=this.pending.shift();
      const current=this.runtime.get(chunk.id),desired=desiredChunkState(this.registry.distance(position,chunk),current.state,this.policy);
      if(desired===current.state)continue;
      this.metrics.transitions++;
      if(desired===ChunkState.UNLOADED){this.renderer.destroy(current.handle);current.handle=null;this.metrics.chunkDestroys++;}
      else {
        if(!current.handle){current.handle=this.renderer.create(chunk);this.metrics.chunkBuilds++;}
        this.renderer.setState(current.handle,desired);
      }
      current.state=desired;
    }
    if(!this.pending.length)this.policyDirty=false;
    this.renderer.update?.(dt);
  }
  snapshot() { return Object.fromEntries([...this.runtime].map(([id,r])=>[id,r.state])); }
  getMetrics() {
    const counts=Object.fromEntries(Object.values(ChunkState).map(s=>[s,0]));
    for(const r of this.runtime.values())counts[r.state]++;
    return {...this.metrics,counts,...this.renderer.getMetrics?.()};
  }
}
