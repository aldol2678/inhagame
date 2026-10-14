// Paving-only representation change. No triangle, material or owner reordering.
const COLORS=new Set(['#758b89','#b9b4a6','#c5c4bc','#a37765','#777f80']);
const numericArray=a=>Array.isArray(a)||(ArrayBuffer.isView(a)&&typeof a.length==='number');
export function indexWalkwayPavingGroup(group){
 if(!group||Object.keys(group).sort().join(',')!=='indices,normals,positions')throw new TypeError('Expected only positions, normals and indices');
 const {positions,normals,indices}=group;
 if(![positions,normals,indices].every(numericArray)||!positions.length||positions.length%3||positions.length!==normals.length||!indices.length||indices.length%3)throw new TypeError('Malformed paving geometry');
 const vertices=positions.length/3;
 for(const values of [positions,normals])for(const value of values)if(!Number.isFinite(value)||!Number.isFinite(Math.fround(value)))throw new TypeError('Paving attributes must be finite float32 values');
 for(const index of indices)if(!Number.isInteger(index)||index<0||index>=vertices)throw new RangeError('Invalid paving index');
 const result={positions:[],normals:[],indices:[]},seen=new Map(),remap=new Array(vertices),view=new DataView(new ArrayBuffer(4));
 const bits=value=>{view.setFloat32(0,value,true);return view.getUint32(0,true).toString(16);};
 for(let vertex=0;vertex<vertices;vertex++){
  const offset=vertex*3,tuple=[Math.fround(positions[offset]),Math.fround(positions[offset+1]),Math.fround(positions[offset+2]),Math.fround(normals[offset]),Math.fround(normals[offset+1]),Math.fround(normals[offset+2])];
  const key=tuple.map(bits).join(':');let indexed=seen.get(key);
  if(indexed===undefined){indexed=result.positions.length/3;seen.set(key,indexed);result.positions.push(tuple[0],tuple[1],tuple[2]);result.normals.push(tuple[3],tuple[4],tuple[5]);}
  remap[vertex]=indexed;
 }
 for(const index of indices)result.indices.push(remap[index]);
 return result;
}
export function indexWalkwayPavingGroups(source){
 if(!(source instanceof Map)||source.size!==COLORS.size||[...source.keys()].some(color=>!COLORS.has(color)))throw new TypeError('Exactly five reviewed paving colors required');
 return new Map([...source].map(([color,group])=>[color,indexWalkwayPavingGroup(group)]));
}
