import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {WorldSceneAdapter} from './world-scene-adapter.mjs';
export async function createLegacyPort(editorDir,worldFile=null){
 if(!editorDir)throw new Error('E_LEGACY_SOURCE_REQUIRED');
 const file=n=>import(pathToFileURL(join(resolve(editorDir),n)).href);
 const [{WorldDocument,createEmptyWorld},{EditorCommands},{parseWorld,serializeWorld},{validateWorld}]=await Promise.all([
 file('world-document.js'),file('editor-commands.js'),file('world-serialization.js'),file('world-schema.js')
 ]);
 const world=new WorldDocument(worldFile?parseWorld(await readFile(resolve(worldFile),'utf8')):createEmptyWorld({worldId:'aldol.studio.local',name:'ALDOL Studio Session'}));
 const state={selectedEntityId:null,select(id){this.selectedEntityId=id;},clearSelection(){this.selectedEntityId=null;}};
 return new WorldSceneAdapter({world,commands:new EditorCommands(world,state),serializeWorld,parseWorld,validateWorld});
}
