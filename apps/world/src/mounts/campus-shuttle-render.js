import * as pc from "playcanvas";
import {box,surface} from "../campus-render-kit.js";
import {PLAYER_ORIGIN_Y} from "../player-dimensions.js";
export function createCampusShuttle(parent,{rider=false}={}){
 const root=new pc.Entity(rider?"Rider_CampusShuttle":"Parked_CampusShuttle");parent.addChild(root);
 root.setLocalPosition(0,rider?-PLAYER_ORIGIN_Y:0,0);root.enabled=false;
 const blue=surface("#347ac1"),glass=surface("#a5c9df"),black=surface("#202833");
 box(root,"body",[0,.65,0],[1.3,.8,2.6],blue);box(root,"roof",[0,2,0],[1.35,.08,2.65],blue);
 for(const x of [-.62,.62])for(const z of [-1.15,1.15])box(root,"post"+x+z,[x,1.4,z],[.05,1.1,.05],blue);
 box(root,"windshield",[0,1.35,1.2],[1.15,.8,.05],glass);
 for(const x of [-.72,.72])for(const z of [-.85,.85]){
 const w=box(root,"wheel"+x+z,[x,.24,z],[.44,.17,.44],black,0,"cylinder");w.setLocalEulerAngles(0,0,90);}
 return root;
}
export function createShuttleStations(parent,stations){
 for(const a of stations)box(parent,"shuttle-stop-"+a.id,[a.platform.x,.04,a.platform.z],[1.1,.07,1.1],surface("#347ac1"));
}
