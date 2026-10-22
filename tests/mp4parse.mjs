// 최소 MP4 박스 파서: 비디오 트랙의 mdhd timescale / stts / ctts / elst / stss / avcC 정보를 읽어 프레임별 duration(ms)을 계산
import fs from 'fs';
export function parseMp4(file){
  const b=fs.readFileSync(file); const dv=new DataView(b.buffer,b.byteOffset,b.length);
  const out={tracks:[]};
  function walk(s,e,path,ctx){
    while(s+8<=e){
      let size=dv.getUint32(s),type=b.toString('latin1',s+4,s+8),hdr=8;
      if(size===1){size=Number(dv.getBigUint64(s+8));hdr=16} else if(size===0) size=e-s;
      const bs=s+hdr,be=s+size;
      if(['moov','trak','mdia','minf','stbl','edts'].includes(type)){ if(type==='trak'){ctx={}; out.tracks.push(ctx)} walk(bs,be,path+'/'+type,ctx) }
      else if(type==='ftyp'){out.ftyp=b.toString('latin1',bs,bs+4)}
      else if(type==='mvhd'){const v=b[bs];out.mvTimescale=dv.getUint32(bs+(v?20:12))}
      else if(type==='mdhd'){const v=b[bs];ctx.timescale=dv.getUint32(bs+(v?20:12));ctx.mdDuration=v?Number(dv.getBigUint64(bs+24)):dv.getUint32(bs+16)}
      else if(type==='hdlr'){ctx.handler=b.toString('latin1',bs+8,bs+12)}
      else if(type==='stts'){const n=dv.getUint32(bs+4);ctx.stts=[];for(let i=0;i<n;i++)ctx.stts.push([dv.getUint32(bs+8+i*8),dv.getUint32(bs+12+i*8)])}
      else if(type==='ctts'){const n=dv.getUint32(bs+4);ctx.ctts=[];for(let i=0;i<n;i++)ctx.ctts.push([dv.getUint32(bs+8+i*8),dv.getInt32(bs+12+i*8)])}
      else if(type==='stss'){const n=dv.getUint32(bs+4);ctx.stss=[];for(let i=0;i<n;i++)ctx.stss.push(dv.getUint32(bs+8+i*4))}
      else if(type==='elst'){const n=dv.getUint32(bs+4);ctx.elst=[];const v=b[bs];for(let i=0;i<n;i++){const o=bs+8+i*(v?20:12);ctx.elst.push(v?[Number(dv.getBigUint64(o)),Number(dv.getBigInt64(o+8))]:[dv.getUint32(o),dv.getInt32(o+4)])}}
      else if(type==='stsd'){ctx.stsdCodec=b.toString('latin1',bs+12,bs+16)}
      s=be;
    }
  }
  walk(0,b.length,'',null);
  for(const t of out.tracks){ if(t.stts){ t.durMs=[]; for(const [c,d] of t.stts) for(let i=0;i<c;i++) t.durMs.push(d/t.timescale*1000); t.ptsMs=[];let a=0;for(const d of t.durMs){t.ptsMs.push(a);a+=d} t.totalMs=a } }
  out.video=out.tracks.find(t=>t.handler==='vide'); return out;
}
if(process.argv[1]&&process.argv[1].endsWith('mp4parse.mjs')&&process.argv[2]){const o=parseMp4(process.argv[2]);const v=o.video;console.log({ftyp:o.ftyp,codec:v.stsdCodec,timescale:v.timescale,durMs:v.durMs.map(x=>+x.toFixed(3)),ptsMs:v.ptsMs.map(x=>+x.toFixed(3)),total:v.totalMs,elst:v.elst,stss:v.stss,ctts:v.ctts})}
