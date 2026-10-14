import { inferCampusMaterialProfile } from './campus-material-profile.js';

// The pinned PlayCanvas 2.22.4 StandardMaterial converts diffuse uniforms with
// Color.linear(): pow(channel, 2.2), then stores float32. Vertex colors are
// already linear in its diffuse shader; never quantize them to normalized bytes
// or apply the transfer function twice.
export function walkwayLinearColor(hex) {
  if(!/^#[0-9a-f]{6}$/.test(hex))throw new TypeError('Expected canonical walkway color');
  return [1,3,5].map(i=>Math.fround(Math.pow(parseInt(hex.slice(i,i+2),16)/255,2.2))).concat(1);
}

export function groupWalkwayPavingByProfile(source) {
  const result=new Map();
  for(const [color,g] of source){
    const profile=inferCampusMaterialProfile(color);
    if(!['concrete','brick','metal'].includes(profile))throw new Error('Unreviewed walkway material profile');
    if(g.positions.length!==g.normals.length||g.positions.length%3)throw new Error('Invalid walkway geometry');
    let target=result.get(profile);
    if(!target){target={profile,referenceColor:color,positions:[],normals:[],indices:[],colors:[]};result.set(profile,target);}
    const offset=target.positions.length/3,linear=walkwayLinearColor(color);
    target.positions.push(...g.positions);target.normals.push(...g.normals);
    for(const index of g.indices){
      if(!Number.isInteger(index)||index<0||index>=g.positions.length/3)throw new Error('Invalid walkway index');
      target.indices.push(offset+index);
    }
    for(let i=0;i<g.positions.length/3;i++)target.colors.push(...linear);
  }
  return [...result.values()];
}
