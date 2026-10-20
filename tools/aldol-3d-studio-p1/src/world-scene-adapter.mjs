import { createHash } from 'node:crypto';
import { validateCommand, validateTransform, safeKey } from './command-schema.mjs';
const clone = x => structuredClone(x);
const CAPS = Object.freeze(['node.read','node.create','node.rename','node.transform','node.duplicate','node.delete','node.reparent','asset.inspect']);
/** Adapter is session-scoped; never expose EditorCommands.execute to untrusted MCP inputs. */
export class WorldSceneAdapter {
  constructor({world, commands, serializeWorld, parseWorld, validateWorld}) {
    if (!world?.snapshot || !commands?.addEntity || !serializeWorld || !parseWorld) throw new Error('E_ADAPTER_DEPENDENCIES');
    this.world=world; this.commands=commands; this.serializeWorld=serializeWorld; this.parseWorld=parseWorld; this.validateWorld=validateWorld;
    this.committedSerial=0;
    this.receipts=new Map();
    this.maxReceipts=500;
    this.canonicalHash = this._hash();
    this.revisionToken = 'scene:0:'+this.canonicalHash.slice(0,16);
  }
  _hash(){return createHash('sha256').update(this.serializeWorld(this.world.snapshot())).digest('hex');}
  _refresh() {
    // World editor may receive edits from its own UI, not only from this port.
    // During preview, keep the last committed token; reject writes until preview finishes.
    if(this.commands.transformDraft) return;
    const hash=this._hash();
    if(hash!==this.canonicalHash){this.committedSerial++;this.canonicalHash=hash;this.revisionToken=`scene:${this.committedSerial}:${hash.slice(0,16)}`;}
  }
  read(){
    this._refresh();
    const w=this.world.snapshot();
    return {
      sceneId:w.worldId,
      coordinateSystem:clone(w.coordinateSystem),
      nodes:w.entities.map(e=>({id:e.id,name:e.name,parentId:e.parentId,enabled:e.enabled,transform:clone(e.transform),tags:clone(e.tags),componentKeys:Object.keys(e.components ?? {}),renderAssetId:e.components?.['core.renderable']?.assetId??null,source:'inha-world'})),
      revisionToken:this.revisionToken,
      previewActive:Boolean(this.commands.transformDraft),
      capabilities:[...CAPS]
    };
  }
  validate() {
    try {
      const w=this.world.snapshot();
      if(this.validateWorld) return clone(this.validateWorld(w));
      this.world.assertValid();return {valid:true,diagnostics:[]};
    } catch (e){return {valid:false,diagnostics:[{severity:'ERROR',code:e.message}]};}
  }
  _response(status,commandId,diagnosticCode){return {status,commandId,revisionToken:this.revisionToken,...(diagnosticCode?{diagnosticCode}:{})};}
  _verifyCandidate(candidate){
    const world={...this.world.snapshot(),entities:this.world.listEntities().map(e=>e.id===candidate.id?candidate:e)};
    if(this.validateWorld){ const result=this.validateWorld(world);if(!result.valid)throw new Error(result.errors?.[0]?.code || 'E_WORLD_INVALID'); }
  }
  async dispatch(c){
    let key;
    try{ key=safeKey(c); }catch{return this._response('rejected',String(c?.commandId??''),'E_NOT_JSON_SAFE');}
    if(typeof c?.commandId === 'string' && this.receipts.has(c.commandId)) {
      const old=this.receipts.get(c.commandId);
      if(old.key===key) return clone(old.receipt);
      return this._response('rejected',c.commandId,'E_COMMAND_ID_REUSE');
    }
    const invalid=validateCommand(c);
    if(invalid)return this._response('rejected',String(c?.commandId??''),invalid);
    this._refresh();
    if(this.commands.transformDraft)return this._response('conflict',c.commandId,'E_PREVIEW_ACTIVE');
    if(c.expectedRevision!==this.revisionToken)return this._response('conflict',c.commandId,'E_REVISION_STALE');
    const p=c.payload;let applied=false;
    try {
      if(c.operation==='node.create'){
        if(this.world.hasEntity(p.id))throw new Error('E_DUP_ENTITY_ID');
        if(p.parentId && !this.world.hasEntity(p.parentId))throw new Error('E_PARENT_NOT_FOUND');
        this.commands.addEntity(p);applied=true;
      } else if(c.operation==='node.rename'){
        const e=this.world.getEntity(c.targetId);if(!e)throw new Error('E_ENTITY_NOT_FOUND');
        if(e.name!==p.name.trim()){this.commands.renameEntity(c.targetId,p.name);applied=true;}
      } else if(c.operation==='node.transform'){
        const e=this.world.getEntity(c.targetId);if(!e)throw new Error('E_ENTITY_NOT_FOUND');
        const normalized=clone(p.transform);const len=Math.hypot(...normalized.rotation);normalized.rotation=normalized.rotation.map(n=>n/len);
        const next={...e,transform:normalized};this._verifyCandidate(next);
        if(safeKey(e.transform)!==safeKey(normalized)){this.commands.setTransform(c.targetId,normalized);applied=true;}
      } else if(c.operation==='node.duplicate'){
        if(!this.world.hasEntity(c.targetId))throw new Error('E_ENTITY_NOT_FOUND');
        this.commands.duplicateEntity(c.targetId);applied=true;
      } else if(c.operation==='node.delete'){
        if(!this.world.hasEntity(c.targetId))throw new Error('E_ENTITY_NOT_FOUND');
        if(this.world.listEntities().some(e=>e.parentId===c.targetId))throw new Error('E_ENTITY_HAS_CHILDREN');
        this.commands.removeEntity(c.targetId);applied=true;
      } else if(c.operation==='node.reparent'){
        const e=this.world.getEntity(c.targetId);if(!e)throw new Error('E_ENTITY_NOT_FOUND');
        const next={...e,parentId:p.parentId};this._verifyCandidate(next);
        if(e.parentId!==p.parentId){this.commands.replaceEntity(c.targetId,next,'Reparent Entity');applied=true;}
      }
      this._refresh();
      const receipt=this._response(applied?'applied':'unchanged',c.commandId);
      this.receipts.set(c.commandId,{key,receipt:clone(receipt)});
      if(this.receipts.size>this.maxReceipts)this.receipts.delete(this.receipts.keys().next().value);
      return receipt;
    }catch(e){this._refresh();return this._response('rejected',c.commandId, e.message?.split(':')[0] || 'E_COMMAND_FAILED');}
  }
  async undo(expectedRevision){return this._history('undo',expectedRevision);}
  async redo(expectedRevision){return this._history('redo',expectedRevision);}
  _history(kind,expectedRevision){
    this._refresh();
    if(this.commands.transformDraft)return this._response('conflict',kind,'E_PREVIEW_ACTIVE');
    if(expectedRevision!==this.revisionToken)return this._response('conflict',kind,'E_REVISION_STALE');
    try{const ok=this.commands[kind]();this._refresh();return this._response(ok?'applied':'unchanged',kind);}catch(e){return this._response('rejected',kind,e.message?.split(':')[0]);}
  }
  beginPreview(id,mode='translate'){
    if(this.commands.transformDraft)throw new Error('E_PREVIEW_ACTIVE');
    this._refresh();return this.commands.beginTransform(id,mode);
  }
  updatePreview(transform){
    if(validateTransform(transform))throw new Error('E_TRANSFORM_INVALID');
    if(!this.commands.transformDraft)throw new Error('E_PREVIEW_NOT_ACTIVE');
    this.commands.previewTransform(transform);return this.read();
  }
  commitPreview(transform){
    if(transform && validateTransform(transform))throw new Error('E_TRANSFORM_INVALID');
    const changed=this.commands.commitTransform(transform ?? null);
    this._refresh();return this._response(changed?'applied':'unchanged','preview.commit');
  }
  cancelPreview(){
    const changed=this.commands.cancelTransform();
    this._refresh();return this._response(changed?'applied':'unchanged','preview.cancel');
  }
  exportWorld(){
    if(this.commands.transformDraft)throw new Error('E_PREVIEW_ACTIVE');
    const w=this.world.snapshot();
    // Serializer is the only permitted world export. No native Studio data is mixed in.
    const data=this.serializeWorld(w);
    this.parseWorld(data);
    return data;
  }
}
