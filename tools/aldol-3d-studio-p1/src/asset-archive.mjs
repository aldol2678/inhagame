// Dependency-free ZIP store writer. Original bytes remain unchanged; filenames are
// UTF-8 ASCII-safe, fixed paths from verified hashes, not supplied ZIP entries.
const table=Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc32=b=>{let c=0xffffffff;for(const v of b)c=table[(c^v)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
export function makeStudioAssetZip(worldText,records){
  const input=[{name:'world.json',bytes:Buffer.from(worldText,'utf8')}];
  for(const r of records){
    if(!r?.uri||!/^assets\/[a-f0-9]{64}\.(glb|png)$/.test(r.uri)||!Buffer.isBuffer(r.bytes))throw Error('E_ARCHIVE_PATH');
    input.push({name:r.uri,bytes:r.bytes});
  }
  const names=new Set(),parts=[],directory=[];let offset=0;
  for(const {name,bytes} of input){
    if(names.has(name))throw Error('E_ARCHIVE_DUP');names.add(name);
    const filename=Buffer.from(name,'utf8');const crc=crc32(bytes);
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(filename.length,26);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
    parts.push(local,filename,bytes);directory.push(central,filename);offset+=local.length+filename.length+bytes.length;
  }
  if(input.length>65535||offset>=0xffffffff)throw Error('E_ARCHIVE_TOO_LARGE');
  const dir=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(input.length,8);end.writeUInt16LE(input.length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...parts,dir,end]);
}
