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

// Read only our uncompressed ZIP profile. Never extract paths onto a filesystem.
export function readStudioAssetZip(bytes) {
  const bad = () => { throw Error('E_ARCHIVE_INVALID'); };
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > 82*1024*1024) bad();
  const end = bytes.length - 22;
  if (bytes.readUInt32LE(end) !== 0x06054b50 || bytes.readUInt16LE(end+4) || bytes.readUInt16LE(end+6) || bytes.readUInt16LE(end+20)) bad();
  const count = bytes.readUInt16LE(end+10), dirSize = bytes.readUInt32LE(end+12), dirStart = bytes.readUInt32LE(end+16);
  if (!count || count > 501 || bytes.readUInt16LE(end+8) !== count || dirStart+dirSize !== end) bad();
  const files = new Map(); let cursor = dirStart, localEnd = 0;
  for (let i = 0; i < count; i++) {
    if (cursor+46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) bad();
    const nameLen=bytes.readUInt16LE(cursor+28), size=bytes.readUInt32LE(cursor+24), offset=bytes.readUInt32LE(cursor+42), crc=bytes.readUInt32LE(cursor+16);
    if (bytes.readUInt16LE(cursor+8) || bytes.readUInt16LE(cursor+10) || bytes.readUInt16LE(cursor+30) || bytes.readUInt16LE(cursor+32) || bytes.readUInt16LE(cursor+34) || bytes.readUInt32LE(cursor+20)!==size || cursor+46+nameLen>end) bad();
    const name=bytes.toString('utf8',cursor+46,cursor+46+nameLen);
    if (name!=='world.json' && !/^assets\/[a-f0-9]{64}\.(glb|png)$/.test(name)) throw Error('E_ARCHIVE_PATH');
    if (files.has(name)) throw Error('E_ARCHIVE_DUP');
    if (size > (name==='world.json'?1024*1024:20*1024*1024) || offset!==localEnd || offset+30+nameLen+size>dirStart || bytes.readUInt32LE(offset)!==0x04034b50) bad();
    if (bytes.readUInt16LE(offset+6) || bytes.readUInt16LE(offset+8) || bytes.readUInt32LE(offset+14)!==crc || bytes.readUInt32LE(offset+18)!==size || bytes.readUInt32LE(offset+22)!==size || bytes.readUInt16LE(offset+26)!==nameLen || bytes.readUInt16LE(offset+28) || bytes.toString('utf8',offset+30,offset+30+nameLen)!==name) bad();
    const data=bytes.subarray(offset+30+nameLen,offset+30+nameLen+size);
    if(crc32(data)!==crc) throw Error('E_ARCHIVE_CRC');
    files.set(name,data); localEnd=offset+30+nameLen+size; cursor+=46+nameLen;
  }
  if (cursor!==end || localEnd!==dirStart || !files.has('world.json')) bad();
  return files;
}
