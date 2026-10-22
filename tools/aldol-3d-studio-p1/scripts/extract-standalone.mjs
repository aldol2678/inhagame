#!/usr/bin/env node
// Standalone build from a pinned inhagame checkout; never mutates the original.
import {cp,copyFile,mkdir,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {dirname,resolve,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url));
const studio=resolve(here,'..'),repo=resolve(studio,'../..');
const arg=process.argv.indexOf('--output');
if(arg<0||!process.argv[arg+1])throw Error('E_OUTPUT_REQUIRED: use --output /fresh/aldol-3d-studio');
const dest=resolve(process.argv[arg+1]);
const inside=(outer,p)=>p===outer||p.startsWith(outer+'/');
if(inside(studio,dest)||inside(dest,studio))throw Error('E_OUTPUT_OVERLAPS_SOURCE');
try {await readdir(dest);throw Error('E_OUTPUT_ALREADY_EXISTS');}catch(e){if(e.message==='E_OUTPUT_ALREADY_EXISTS')throw e;if(e.code!=='ENOENT')throw e;}
await mkdir(dest,{recursive:true});
try{
  await cp(studio,dest,{recursive:true,filter:p=>!p.endsWith('/node_modules')&&!p.includes('/node_modules/')&&!p.endsWith('/test-results')&&!p.includes('/test-results/')});
  const compat=join(dest,'compat/inha-editor');
  await mkdir(compat,{recursive:true});
  const editorFiles=['world-document.js','editor-commands.js','world-serialization.js','world-schema.js','building-mass.js','path-spline.js','map-reference.js'];
  for(const file of editorFiles)await copyFile(join(repo,'apps/world/src/editor',file),join(compat,file));
  async function rewrite(path, edits){
    const full=join(dest,path);let data=await readFile(full,'utf8');
    for(const [from,to] of edits){if(!data.includes(from))throw Error('E_EXTRACTION_ANCHOR: '+path+' / '+from);data=data.replaceAll(from,to);}
    await writeFile(full,data);
  }
  await rewrite('bin/mcp-stdio.mjs',[
    ["import { createInterface } from 'node:readline';","import { createInterface } from 'node:readline';\nimport {fileURLToPath} from 'node:url';"],
    ["const editorDir = getFlag('--editor-dir') || process.env.INHA_WORLD_EDITOR_DIR;","const editorDir = getFlag('--editor-dir') || process.env.INHA_WORLD_EDITOR_DIR || fileURLToPath(new URL('../compat/inha-editor/', import.meta.url));"]
  ]);
  await rewrite('bin/dev-server.mjs',[
    ["import {createServer} from 'node:http';","import {createServer} from 'node:http';\nimport {fileURLToPath} from 'node:url';"],
    ["flag('--editor-dir')||process.env.INHA_WORLD_EDITOR_DIR","flag('--editor-dir')||process.env.INHA_WORLD_EDITOR_DIR||fileURLToPath(new URL('../compat/inha-editor/',import.meta.url))"],
    ["'../../../apps/world/tests/browser/node_modules/playcanvas'","'../node_modules/playcanvas'"]
  ]);
  await rewrite('tests/browser-glb-p21.mjs',[
    ["new URL('../../../apps/world/tests/browser/package.json',import.meta.url)","new URL('../package.json',import.meta.url)"],
    ["resolve('tools/aldol-3d-studio-p1')","resolve('.')"],
    ["resolve('apps/world/src/editor')","resolve('compat/inha-editor')"]
  ]);
  await rewrite('tests/browser-mobile-p12.mjs',[
    ["new URL('../../../apps/world/tests/browser/package.json', import.meta.url)","new URL('../package.json', import.meta.url)"],
    ["resolve('tools/aldol-3d-studio-p1')","resolve('.')"],
    ["resolve('apps/world/src/editor')","resolve('compat/inha-editor')"]
  ]);
  await rewrite('tests/browser-factory-p2.mjs',[
    ["resolve(process.cwd(),'apps/world/tests/browser/package.json')","resolve(process.cwd(),'package.json')"],
    ["resolve(process.cwd(),'tools/aldol-3d-studio-p1')","resolve(process.cwd(),'.')"]
  ]);
  await rewrite('tests/browser-p11.mjs',[
    ["resolve(repo,'apps/world/tests/browser/package.json')","resolve(repo,'package.json')"],
    ["resolve(repo,'tools/aldol-3d-studio-p1')","resolve(repo,'.')"]
  ]);
  // Campus runtime QA references game-only files. Keep game-to-Studio integration
  // checks in inhagame and exclude these two files from the standalone distribution.
  await rm(join(dest,'tests/browser-runtime-p12.mjs'));
  await rm(join(dest,'tests/runtime-fixture.mjs'));
  const packagePath=join(dest,'package.json');
  const pkg=JSON.parse(await readFile(packagePath,'utf8'));
  pkg.name='@aldol/3d-studio';
  pkg.private=true;
  pkg.description='ALDOL 3D Studio standalone source, local MCP, GLB editor, and motion clip data tools';
  pkg.dependencies={...pkg.dependencies,playcanvas:'2.22.4'};
  pkg.devDependencies={...pkg.devDependencies,playwright:'1.63.0'};
  pkg.scripts['test:real']='node scripts/run-bundled-real.mjs';
  pkg.scripts['test:glb']='node tests/browser-glb-p21.mjs';
  pkg.scripts['test:mobile']='node tests/browser-mobile-p12.mjs';
  pkg.scripts['test:browser']='node tests/browser-p11.mjs && node tests/browser-factory-p2.mjs && node tests/browser-glb-p21.mjs && node tests/browser-mobile-p12.mjs';
  delete pkg.scripts['test:runtime'];
  await writeFile(packagePath,JSON.stringify(pkg,null,2)+'\n');
  await writeFile(join(dest,'scripts/run-bundled-real.mjs'),"import {spawnSync} from 'node:child_process';\nimport {resolve} from 'node:path';\nconst env={...process.env,INHA_WORLD_EDITOR_DIR:resolve('compat/inha-editor')};\nfor(const suite of ['tests/real.test.mjs','tests/factory-real-p2.mjs']){\n  const result=spawnSync(process.execPath,['--test',suite],{stdio:'inherit',env});\n  if(result.status!==0)process.exit(result.status??1);\n}\n");;
  await writeFile(join(dest,'.gitignore'), 'node_modules/\ntest-results/\n.env*\n!.env.example\n.DS_Store\n');
  const licenseNote="# ALDOL 3D Studio\n\nStandalone extraction from `aldol2678/inhagame` branch `feat/aldol-3d-studio-motion-module-20261022` (source head `95722ba9949dc1e2fd2e49fb6270e8eca865137d`).\n\nThis distribution includes scene-editor source, local MCP stdio, static GLB renderer, in-memory motion clip tools and seven editor compatibility files. They are copied from the same source revision and were originally part of INHA WORLD. No production/game code was modified by this extraction. The old source and PRs remain preserved upstream.\n\n## Start (Node >= 20)\n\n```sh\nnpm install\nnpm run check\nnpm test\nnpm run test:real\nnpm run studio -- --allow-write\n# Browser/WebGL CI, where Chromium/Playwright can run:\nnpx playwright install chromium\nnpm run test:browser\n# Read-only MCP stdio (writes require --allow-write):\nnode bin/mcp-stdio.mjs\n```\n\nThe web server listens **only** on 127.0.0.1. A browser on an Android phone cannot reach this loopback without a separate authenticated remote deployment; no mobile ChatGPT plugin is configured. In-memory scenes and motions are not a persistence service. Export a Studio ZIP explicitly if you need to retain a scene.\n\n## Compatibility and limitations\n\n- PlayCanvas 2.22.4 is installed from npm instead of a hardcoded INHA WORLD workspace.\n- Compatibility editor files are vendored to `compat/inha-editor`, so the local Studio starts independently. The INHA WORLD adapter is still an upstream-derived compatibility layer, not a clean rewrite or independent schema.\n- P2.1 GLB renderer supports a bounded static triangle/embedded-PNG profile. Animated skins/GLB are **not** rendered or imported; motion tools manage JSON keyframe data only.\n- Full INHA WORLD campus runtime integration tests remain in the source repository; standalone Chromium Studio tests are retained.\n- License remains **UNLICENSED**, and this extraction does not grant an open-source license or permission for third parties to reuse code.\n- No public repository has been created by this extraction, and no branch has been merged or deployed.\n\nSources: [PR #440](https://github.com/aldol2678/inhagame/pull/440), [PR #441](https://github.com/aldol2678/inhagame/pull/441).\n";;
  await writeFile(join(dest,'README.md'),licenseNote);
  // Keep an exact provenance manifest for all extracted files.
  const fileEntries=[];
  async function enumerate(p,base=''){for(const d of await readdir(p,{withFileTypes:true})){
    const name=base?base+'/'+d.name:d.name,full=join(p,d.name);
    if(d.isDirectory())await enumerate(full,name);
    else if(d.isFile()&&name!=='EXTRACTION-MANIFEST.json'){
      const data=await readFile(full);
      fileEntries.push({path:name,sha256:createHash('sha256').update(data).digest('hex'),bytes:data.length});
    }
  }}
  await enumerate(dest);
  fileEntries.sort((a,b)=>a.path.localeCompare(b.path));
  const manifest={format:'aldol-3d-studio-extraction/1',sourceRepo:'aldol2678/inhagame',sourceRef:'feat/aldol-3d-studio-motion-module-20261022',sourceHead:'95722ba9949dc1e2fd2e49fb6270e8eca865137d',files:fileEntries};
  await writeFile(join(dest,'EXTRACTION-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({status:'exported',dest,fileCount:fileEntries.length,totalBytes:fileEntries.reduce((n,x)=>n+x.bytes,0),manifest:'EXTRACTION-MANIFEST.json'},null,2));
} catch(e){await rm(dest,{recursive:true,force:true});throw e;}
