import * as pc from "playcanvas";
import {box,surface} from "../campus-render-kit.js";
import {PLAYER_ORIGIN_Y} from "../player-dimensions.js";
export function createCampusBalloon(parent,{rider=false}={}){
 const root=new pc.Entity(rider?"Rider_CampusBalloon":"Parked_CampusBalloon");parent.addChild(root);
 root.setLocalPosition(0,rider?-PLAYER_ORIGIN_Y:0,0);root.enabled=false;
 const basket=surface("#ab7543"),red=surface("#e98568"),rope=surface("#665847"),gold=surface("#ffd78c");
 box(root,"basket-floor",[0,.58,0],[1.45,.14,1.45],basket);
 for(const x of [-.7,.7])box(root,"basket-side"+x,[x,.8,0],[.09,.55,1.45],basket);
 for(const z of [-.7,.7])box(root,"basket-end"+z,[0,.8,z],[1.45,.55,.09],basket);
 for(const x of [-.65,.65])for(const z of [-.65,.65])box(root,"suspension"+x+z,[x,2,z],[.035,2.5,.035],rope);
 box(root,"envelope",[0,6.5,0],[7,7,7],red,0,"sphere");
 box(root,"envelope-band",[0,6.5,0],[7.03,.35,7.03],gold,0,"sphere");
 return root;
}
