const clone=x=>structuredClone(x);
export const initial=()=>({schemaVersion:'0.1.0',worldId:'test.world',name:'Scene',coordinateSystem:{handedness:'right',upAxis:'Y',unit:'meter'},assets:[],entities:[],metadata:{}});
const transform=()=>({position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]});
export function validateWorld(world){
  const errors=[];
  const ids=new Set(world.entities.map(x=>x.id));
  for(const e of world.entities){
    if(e.parentId && !ids.has(e.parentId))errors.push({code:'E_PARENT_NOT_FOUND'});
    if(e.transform.scale.some(v=>!Number.isFinite(v)||v<=0))errors.push({code:'E_SCALE_INVALID'});
    if(new Set(world.entities.map(x=>x.id)).size!==world.entities.length)errors.push({code:'E_DUP_ENTITY_ID'});
    const seen=new Set([e.id]);let p=e.parentId;
    while(p){if(seen.has(p)){errors.push({code:'E_PARENT_CYCLE'});break;}seen.add(p);p=world.entities.find(x=>x.id===p)?.parentId;}
  }
  return {valid:errors.length===0,errors,diagnostics:errors};
}
export function makeMock(){
  const world={data:initial(),revision:0,dirty:false,snapshot(){return clone(this.data);},listEntities(){return clone(this.data.entities);},getEntity(id){const e=this.data.entities.find(e=>e.id===id);return e?clone(e):null;},hasEntity(id){return !!this.getEntity(id);},_touch(){this.revision++;this.dirty=true;},assertValid(){const x=validateWorld(this.data);if(!x.valid)throw Error(x.errors[0].code);},
    addEntity(e){if(this.hasEntity(e.id))throw Error('E_DUP_ENTITY_ID');const next={name:e.id,kind:'prop',parentId:null,enabled:true,transform:transform(),tags:[],components:{},metadata:{},...clone(e)};const data={...this.data,entities:[...this.data.entities,next]};const v=validateWorld(data);if(!v.valid)throw Error(v.errors[0].code);this.data=data;this._touch();return next;},
    replaceEntity(id,e){const data={...this.data,entities:this.data.entities.map(x=>x.id===id?clone(e):x)};const v=validateWorld(data);if(!v.valid)throw Error(v.errors[0].code);this.data=data;this._touch();},
    removeEntity(id){if(this.data.entities.some(x=>x.parentId===id))throw Error('E_ENTITY_HAS_CHILDREN');this.data.entities=this.data.entities.filter(x=>x.id!==id);this._touch();}
  };
  const state={selectedEntityId:null,select(id){this.selectedEntityId=id;},clearSelection(){this.selectedEntityId=null;}};
  const commands={world,state,undoStack:[],redoStack:[],transformDraft:null,_record(redo,undo){this.undoStack.push({redo,undo});this.redoStack=[];},_do(redo,undo){redo();this._record(redo,undo);},addEntity(e){const entity=clone(e);this._do(()=>world.addEntity(entity),()=>world.removeEntity(entity.id));state.select(entity.id);return entity;},
    removeEntity(id){const e=world.getEntity(id);this._do(()=>world.removeEntity(id),()=>world.addEntity(e));},
    replaceEntity(id,e){const before=world.getEntity(id),after=clone(e);this._do(()=>world.replaceEntity(id,after),()=>world.replaceEntity(id,before));return true;},
    renameEntity(id,name){this.replaceEntity(id,{...world.getEntity(id),name});},
    setTransform(id,t){this.replaceEntity(id,{...world.getEntity(id),transform:t});},
    duplicateEntity(id){const src=world.getEntity(id);const copyId=id+'.copy';if(world.hasEntity(copyId))throw Error('E_DUP_ENTITY_ID');return this.addEntity({...src,id:copyId,name:src.name+' Copy'});},
    undo(){const cmd=this.undoStack.at(-1);if(!cmd)return false;cmd.undo();this.undoStack.pop();this.redoStack.push(cmd);return true;},
    redo(){const cmd=this.redoStack.at(-1);if(!cmd)return false;cmd.redo();this.redoStack.pop();this.undoStack.push(cmd);return true;},
    beginTransform(id,mode){this.transformDraft={id,mode,before:world.getEntity(id).transform};return clone(this.transformDraft.before);},
    previewTransform(t){const draft=this.transformDraft;if(!draft)throw Error('E_TRANSFORM_NOT_ACTIVE');world.replaceEntity(draft.id,{...world.getEntity(draft.id),transform:clone(t)});},
    commitTransform(t=null){const draft=this.transformDraft;if(!draft)return false;if(t)this.previewTransform(t);this.transformDraft=null;const after=world.getEntity(draft.id).transform;const before=draft.before;if(JSON.stringify(after)===JSON.stringify(before))return false;this._record(()=>world.replaceEntity(draft.id,{...world.getEntity(draft.id),transform:clone(after)}),()=>world.replaceEntity(draft.id,{...world.getEntity(draft.id),transform:clone(before)}));return true;},
    cancelTransform(){const draft=this.transformDraft;if(!draft)return false;this.transformDraft=null;world.replaceEntity(draft.id,{...world.getEntity(draft.id),transform:draft.before});return true;}
  };
  const serializeWorld = w=>JSON.stringify(w);
  const parseWorld = x=>JSON.parse(x);
  return {world,commands,serializeWorld,parseWorld,validateWorld};
}
