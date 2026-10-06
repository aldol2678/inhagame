import { MATCHING_TREE as T } from './matching-tree-layout.js';
export const MATCHING_TREE_COLORS=Object.freeze({trunk:'#776750',leaves:'#65894b',shade:'#5c8144'});
const xyz=p=>[p.x,p.y,p.z];

export function fillMatchingTree(batch){
 const color=MATCHING_TREE_COLORS.trunk;
 batch.tube(color,xyz(T.at(0,0,0)),xyz(T.at(0,0,.30)),.17,8);
 // A faceted natural branch, not a separate bench. Its central top is shared
 // with both anchors; lower bevels meet the stump and curved side branches.
 const profile=[[-.13,T.seatTopY],[.13,T.seatTopY],[.19,.36],[.14,.29],[-.12,.27],[-.20,.33]];
 const end=u=>profile.map(([v,y])=>xyz(T.at(u,v,y))),left=end(-.55),right=end(.55);
 for(let i=0;i<profile.length;i++){
  const j=(i+1)%profile.length;batch.quad(color,left[i],left[j],right[j],right[i]);
  batch.triangle(color,xyz(T.at(-.55,0,.35)),left[j],left[i]);
  batch.triangle(color,xyz(T.at(.55,0,.35)),right[i],right[j]);
 }
 for(const branch of T.branches)for(let i=1;i<branch.length;i++){
  const a=branch[i-1],b=branch[i];batch.tube(color,xyz(T.at(a.u,a.v,a.y)),xyz(T.at(b.u,b.v,b.y)),(a.radius+b.radius)/2,6);
 }
 for(const [i,c]of T.crowns.entries())batch.crown(i%2?MATCHING_TREE_COLORS.shade:MATCHING_TREE_COLORS.leaves,xyz(T.at(c.u,c.v,c.y)),c.size);
 return batch;
}
