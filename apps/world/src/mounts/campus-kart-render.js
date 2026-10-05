import * as pc from "playcanvas";
import { box, surface } from "../campus-render-kit.js";
import { PLAYER_ORIGIN_Y } from "../player-dimensions.js";
export function createCampusKart(parent,{rider=false}={}) {
  const root=new pc.Entity(rider?"Rider_CampusKart":"Parked_CampusKart");parent.addChild(root);
  root.setLocalPosition(0,rider?-PLAYER_ORIGIN_Y:0,0);root.enabled=false;
  const teal=surface("#2d9c95"),rubber=surface("#20272a"),seat=surface("#eee4c7"),metal=surface("#b9c5cd");
  box(root,"chassis",[0,.26,0],[1.22,.2,2.0],teal);
  box(root,"hood",[0,.5,.8],[1.22,.35,.5],teal);
  for(const x of [-.67,.67])for(const z of [-.68,.68]){
    const w=box(root,"wheel_"+x+"_"+z,[x,.22,z],[.42,.18,.42],rubber,0,"cylinder");w.setLocalEulerAngles(0,0,90);
  }
  for(const x of [-.42,.42])for(const z of [.35,-.45]){
    box(root,"seat_"+x+"_"+z,[x,.4,z],[.44,.12,.45],seat);
    box(root,"back_"+x+"_"+z,[x,.68,z-.24],[.44,.48,.1],seat);
  }
  for(const x of [-.55,.55])for(const z of [-.8,.65])box(root,"post_"+x+"_"+z,[x,1.2,z],[.045,1.6,.045],metal);
  box(root,"roof",[0,2,0],[1.45,.07,2.1],teal);
  box(root,"steering",[-.42,.9,.65],[.3,.035,.2],rubber);
  return root;
}
