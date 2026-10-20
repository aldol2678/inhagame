import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
export const sha = b => createHash('sha256').update(b).digest('hex');
function crc(bytes) { let c=0xffffffff; for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;} return (c^0xffffffff)>>>0; }
const chunk=(type,data)=>{const t=Buffer.from(type),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([head,t,data,tail]);};
export function png(){
 const head=Buffer.alloc(13);head.writeUInt32BE(2);head.writeUInt32BE(2,4);head[8]=8;head[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(Buffer.from([0,255,50,20,255,20,255,80,255,0,30,70,255,255,255,240,30,255]))),chunk('IEND',Buffer.alloc(0))]);
}
export function packGlb(doc,bin){
 const text=Buffer.from(JSON.stringify(doc)),json=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]),data=Buffer.concat([bin,Buffer.alloc((4-bin.length%4)%4)]);
 const h=Buffer.alloc(20),b=Buffer.alloc(8);h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(28+json.length+data.length,8);h.writeUInt32LE(json.length,12);h.writeUInt32LE(0x4e4f534a,16);b.writeUInt32LE(data.length);b.writeUInt32LE(0x004e4942,4);return Buffer.concat([h,json,b,data]);
}
export function geometryFixture(edit = () => {}) {
 const A=[-2,0,2],B=[2,0,2],C=[2,0,-2],D=[-2,0,-2],P=[0,3,0];
 const triangles=[[A,B,P],[B,C,P],[C,D,P],[D,A,P],[A,D,C],[A,C,B]],pos=[],norm=[],uv=[],indices=[];
 for(const tri of triangles){const u=tri[1].map((v,i)=>v-tri[0][i]),v=tri[2].map((v,i)=>v-tri[0][i]);const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...n);for(const p of tri){indices.push(indices.length);pos.push(...p);norm.push(...n.map(x=>x/len));}uv.push(0,0,1,0,.5,1);}
 const blocks=[Buffer.from(new Float32Array(pos).buffer),Buffer.from(new Float32Array(norm).buffer),Buffer.from(new Float32Array(uv).buffer),Buffer.from(new Uint16Array(indices).buffer),png()];
 let off=0;const views=blocks.map(b=>{const v={buffer:0,byteOffset:off,byteLength:b.length};off+=b.length;return v;});const bin=Buffer.concat(blocks);
 const primitive=material=>({attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,material});
 const doc={asset:{version:'2.0',generator:'ALDOL P2.1 deterministic original geometry fixture'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Pyramid assembly',children:[1,2]},{name:'Textured pyramid',mesh:0},{name:'Coral child',translation:[4,0,-1],scale:[.6,.6,.6],rotation:[0,.3826834324,0,.9238795325],children:[3]},{name:'Coral pyramid',mesh:1}],buffers:[{byteLength:bin.length}],bufferViews:views,accessors:[{bufferView:0,componentType:5126,count:18,type:'VEC3',min:[-2,0,-2],max:[2,3,2]},{bufferView:1,componentType:5126,count:18,type:'VEC3'},{bufferView:2,componentType:5126,count:18,type:'VEC2'},{bufferView:3,componentType:5123,count:18,type:'SCALAR'}],meshes:[{primitives:[primitive(0)]},{primitives:[primitive(1)]}],images:[{bufferView:4,mimeType:'image/png'}],textures:[{source:0}],materials:[{name:'Embedded checker',doubleSided:true,pbrMetallicRoughness:{baseColorTexture:{index:0},metallicFactor:0,roughnessFactor:1}},{name:'Coral material',doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[1,.12,.04,1],metallicFactor:0,roughnessFactor:.8}}]};
 edit(doc,bin);const bytes=packGlb(doc,bin),digest=sha(bytes);
 return {doc,bin,bytes,digest,file:'pyramids.glb',contentsBase64:bytes.toString('base64'),manifest:{project_id:'p21_fixture',assets:[{id:'pyramids',file:'assets/pyramids.glb',byte_size:bytes.length,sha256:digest,status:'PASS'}]}};
}
