import * as pc from "playcanvas";
import {box,surface} from "../campus-render-kit.js";
import {PLAYER_ORIGIN_Y} from "../player-dimensions.js";
import {INKYUNG_DOCK} from "./duck-boat-motion.js";
export function createDuckBoat(parent,{rider=false}={}) {
 const root=new pc.Entity(rider?"Rider_DuckBoat":"Parked_DuckBoat");parent.addChild(root);
 root.setLocalPosition(0,rider?-PLAYER_ORIGIN_Y:0,0);root.enabled=false;
 const white=surface("#fff7d6"),yellow=surface("#ffc447"),black=surface("#252c30");
 box(root,"hull",[0,.08,0],[1.4,.3,1.8],white,0,"sphere");
 box(root,"deck",[0,.24,0],[1.05,.07,1.1],yellow);
 box(root,"neck",[0,.63,.7],[.35,1,.35],white,0,"capsule");
 box(root,"duck-head",[0,1.2,.75],[.55,.5,.55],white,0,"sphere");
 box(root,"beak",[0,1.12,1.02],[.35,.12,.32],yellow);
 for(const x of [-.28,.28])box(root,"eye"+x,[x,1.25,.87],[.05,.07,.09],black,0,"sphere");
 for(const x of [-.3,.3])box(root,"seat"+x,[x,.3,-.15],[.4,.08,.5],yellow);
 return root;
}
export function createInkyungDockMarker(parent) {
 const root=new pc.Entity("INKYUNG_DOCK");parent.addChild(root);
 root.setLocalPosition(INKYUNG_DOCK.shore.x,.04,INKYUNG_DOCK.shore.z);
 box(root,"dock-marker",[0,0,0],[1.5,.06,1.2],surface("#9c7549"));
 return root;
}
