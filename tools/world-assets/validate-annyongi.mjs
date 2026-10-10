import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import validator from 'gltf-validator';
const reports=[];
for(const path of ['apps/world/assets/annyongi-flight-v1.glb','apps/world/.generated/assets-optimized/annyongi-flight-v1.glb']) {
 const bytes=await readFile(path);
 const report=await validator.validateBytes(new Uint8Array(bytes),{uri:path});
 reports.push({path,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,...report});
 assert.equal(report.issues.numErrors,0,JSON.stringify(report.issues));
 assert.equal(report.issues.numWarnings,0,JSON.stringify(report.issues));
}
await mkdir('test-results/annyongi',{recursive:true});
await writeFile('test-results/annyongi/glb-validation.json',JSON.stringify(reports,null,2));
console.log('Khronos canonical + optimized: 0 errors, 0 warnings');
