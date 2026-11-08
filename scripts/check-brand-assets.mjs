// Checks real export files, including alpha and icon bounds. No dependencies.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path));
const brand = 'src/assets/brand/orbit-pixel-star/';
for (const line of read(brand+'SHA256SUMS.txt').toString().trim().split(/\r?\n/)) {
  const [, expected, file] = line.match(/^([a-f0-9]{64})\s+(.+)$/);
  assert.equal(createHash('sha256').update(read(brand+file)).digest('hex'), expected, `Asset provenance hash: ${file}`);
}
const paths = svg => [...svg.matchAll(/<path d="([^"]+)"/g)].map(match => match[1]);
const mark = read(brand+'mark.svg').toString();
assert.equal(paths(mark).length,2,'Exactly two star silhouettes, without a slash');
assert.deepEqual(paths(mark), paths(read(brand+'mark-inverse.svg').toString()));
assert.deepEqual(paths(mark), paths(read(brand+'app-icon.svg').toString()));
assert.ok(!/<rect|crispEdges|<filter|<linearGradient|965be8|slash/i.test(mark));
assert.ok(mark.includes('fill="#fff"'),'Interface vector foreground stays white');
assert.deepEqual(read('src/assets/logo.svg'), read(brand+'mark.svg'));
assert.deepEqual(read('src/assets/logo-inverse.svg'), read(brand+'mark-inverse.svg'));
assert.deepEqual(read('src/assets/logo.png'), read(brand+'mark.png'));
assert.deepEqual(read('src-tauri/icons/source/orbit-icon.svg'),read(brand+'app-icon.svg'));
assert.deepEqual(read('src-tauri/icons/source/orbit-icon.png'),read(brand+'app-icon.png'));
assert.deepEqual(read('src-tauri/icons/source/orbit-logo-master.png'),read(brand+'mark.png'));

function png(buffer) {
  assert.equal(buffer.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
  const width=buffer.readUInt32BE(16),height=buffer.readUInt32BE(20);
  assert.equal(buffer[24],8);assert.equal(buffer[25],6);
  const chunks=[];
  for(let p=8;p<buffer.length;){const n=buffer.readUInt32BE(p);if(buffer.toString('ascii',p+4,p+8)==='IDAT')chunks.push(buffer.subarray(p+8,p+8+n));p+=n+12;}
  const raw=inflateSync(Buffer.concat(chunks)),stride=width*4;
  let prev=Buffer.alloc(stride),offset=0,transparent=0,opaque=0,edges=0,white=0,purple=0;
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){
    const filter=raw[offset++],row=Buffer.alloc(stride);assert.ok(filter<=4);
    for(let x=0;x<stride;x++){const a=x>=4?row[x-4]:0,b=prev[x],c=x>=4?prev[x-4]:0;row[x]=(raw[offset++]+(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c)))&255;}
    for(let x=3;x<stride;x+=4){const alpha=row[x];if(!alpha)transparent++;else if(alpha===255){opaque++;if(row[x-3]===255&&row[x-2]===255&&row[x-1]===255)white++;if(row[x-3]===150&&row[x-2]===91&&row[x-1]===232)purple++;}else edges++;}
    prev=row;
  }
  return {width,height,transparent,opaque,edges,white,purple};
}
const master=png(read('src/assets/logo.png'));
assert.equal(master.width,1024);assert.equal(master.height,1024);
assert.ok(master.transparent>900000&&master.opaque>0&&master.edges>0,'Transparent field and antialiased star edges');
assert.ok(master.white>0&&master.white===master.opaque&&master.purple===0,'Opaque foreground is white with no purple slash');
for(const [file,size] of [['32x32.png',32],['128x128.png',128],['128x128@2x.png',256]]){
  const icon=png(read('src-tauri/icons/'+file));assert.equal(icon.width,size);assert.equal(icon.height,size);assert.ok(icon.opaque&&icon.edges);
}
const ico=read('src-tauri/icons/icon.ico');
assert.equal(ico.readUInt16LE(0),0);assert.equal(ico.readUInt16LE(2),1);
const count=ico.readUInt16LE(4),frames=[];
for(let i=0;i<count;i++){
  const p=6+i*16,width=ico[p]||256,height=ico[p+1]||256,length=ico.readUInt32LE(p+8),offset=ico.readUInt32LE(p+12);
  assert.equal(width,height);assert.ok(offset>=6+count*16&&offset+length<=ico.length);frames.push(width);
}
assert.deepEqual(frames,[16,24,32,48,64,256]);
console.log('Transparent SVG/PNG masters agree; alpha and antialiasing verified. Native PNGs and six ICO frames valid.');
