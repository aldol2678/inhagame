import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

// Pixel guard: catches the R1 palette overflow even when PNG dimensions and PLTE are valid.
function readIndexedPng(path) {
  const input=readFileSync(path);
  assert.equal(input.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  let width,height,depth,palette,data=[];
  for(let p=8;p<input.length;) {
    const n=input.readUInt32BE(p),type=input.toString('ascii',p+4,p+8);
    const bytes=input.subarray(p+8,p+8+n); p+=n+12;
    if(type==='IHDR') {
      width=bytes.readUInt32BE(0);height=bytes.readUInt32BE(4);depth=bytes[8];
      assert.ok(depth===4||depth===8);assert.equal(bytes[9],3);
    }
    if(type==='PLTE') palette=bytes;
    if(type==='IDAT') data.push(bytes);
    if(type==='IEND') break;
  }
  assert.ok(palette&&width&&height);
  const pixels=inflateSync(Buffer.concat(data)),stride=Math.ceil(width*depth/8),colors=[];
  let p=0,previous=new Uint8Array(stride);
  for(let y=0;y<height;y++) {
    const filter=pixels[p++],line=new Uint8Array(stride);
    for(let x=0;x<stride;x++) {
      const source=pixels[p++],left=x?line[x-1]:0,up=previous[x],upLeft=x?previous[x-1]:0;
      let predictor=0;
      if(filter===1) predictor=left;
      else if(filter===2) predictor=up;
      else if(filter===3) predictor=Math.floor((left+up)/2);
      else if(filter===4) {
        const k=left+up-upLeft,a=Math.abs(k-left),b=Math.abs(k-up),c=Math.abs(k-upLeft);
        predictor=a<=b&&a<=c?left:b<=c?up:upLeft;
      } else assert.equal(filter,0,'Unsupported PNG filter');
      line[x]=(source+predictor)&255;
    }
    for(let x=0;x<width;x++) {
      const bit=x*depth,idx=(line[Math.floor(bit/8)]>>(8-depth-bit%8))&((1<<depth)-1);
      colors.push([palette[idx*3],palette[idx*3+1],palette[idx*3+2]]);
    }
    previous=line;
  }
  return {width,height,at:(x,y)=>colors[y*width+x],colors};
}
test('PWA app icon stays bright white on sky blue background',()=>{
  for(const name of ['icon-192.png','icon-512.png','icon-maskable-512.png','apple-touch-icon.png']) {
    const {width,height,at,colors}=readIndexedPng(new URL('../campus/icons/'+name,import.meta.url));
    const center=at(Math.floor(width/2),Math.floor(height/2)),corner=at(2,2);
    assert.ok(center.every(v=>v>=225),name+': duck must be white, not black');
    assert.ok(corner[2]>180&&corner[0]>100&&corner[1]>160,name+': background must be blue');
    const dark=colors.filter(([r,g,b])=>r<85&&g<85&&b<85).length/colors.length;
    assert.ok(dark<.12,name+': unexpectedly dark pixels');
  }
});
