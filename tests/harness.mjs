// 테스트 하네스: 정적 서버(서브패스 서빙) + 샌드박스 Chromium용 H.264→VP9 대체 shim
import http from 'http'; import fs from 'fs'; import path from 'path';
import { chromium } from 'playwright-core';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.md':'text/plain'};
export function serve(dir, base='/repo/'){
  const vend=path.join(dir,'vendor/mp4-muxer.esm.js');const real=fs.existsSync(vend)?vend:path.resolve('node_modules/mp4-muxer/build/mp4-muxer.mjs');
  const srv=http.createServer((req,res)=>{
    let u=decodeURIComponent(req.url.split('?')[0]);
    let f;
    if(u==='/__real/mp4-muxer.mjs') f=real;
    else if(u.startsWith(base)) { f=path.join(dir,u.slice(base.length)); if(f.endsWith('/')||!path.extname(f)) f=path.join(f,'index.html'); }
    else { res.writeHead(404); return res.end('nf'); }
    fs.readFile(f,(e,b)=>{ if(e){res.writeHead(404);return res.end('nf')} res.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'}); res.end(b)});
  });
  return new Promise(r=>srv.listen(0,'127.0.0.1',()=>r({srv,port:srv.address().port,base})));
}
const SHIM=`(()=>{const O=window.VideoEncoder;if(!O)return;window.__cfgs=[];window.__supportCalls=[];
const V='vp09.00.10.08';
class S{constructor(i){this.e=new O(i)}
configure(c){window.__cfgs.push(JSON.parse(JSON.stringify(c)));const {avc,...r}=c;this.e.configure({...r,codec:V})}
encode(f,o){this.e.encode(f,o)} flush(){return this.e.flush()} close(){this.e.close()} reset(){this.e.reset()}
get state(){return this.e.state} get encodeQueueSize(){return this.e.encodeQueueSize}
addEventListener(...a){return this.e.addEventListener(...a)} removeEventListener(...a){return this.e.removeEventListener(...a)}
static async isConfigSupported(c){window.__supportCalls.push(c.codec);const {avc,...r}=c;const x=await O.isConfigSupported({...r,codec:V});return {supported:x.supported,config:c}}}
window.VideoEncoder=S;})()`;
export async function launch(dir,{base='/repo/',shim=true}={}){
  const {srv,port}=await serve(dir,base);
  const browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',args:['--no-sandbox']});
  const ctx=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:900}});
  const page=await ctx.newPage();
  const logs=[];page.on('console',m=>logs.push(m.type()+': '+m.text()));page.on('pageerror',e=>logs.push('PAGEERROR: '+e.message));
  if(shim) await page.addInitScript(SHIM);
  // muxer 모듈(원본: esm.sh, 수정본: vendor/)을 로컬 실제 mp4-muxer로 대체하되 코덱만 vp9로 바꿔줌
  const wrapper=`import {Muxer as M,ArrayBufferTarget as A} from 'http://127.0.0.1:${port}/__real/mp4-muxer.mjs';export const ArrayBufferTarget=A;export class Muxer extends M{constructor(o){${shim?"o.video.codec='vp9';":""}super(o)}}`;
  await page.route(/esm\.sh\/mp4-muxer|vendor\/mp4-muxer/,r=>r.fulfill({status:200,contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body:wrapper}));
  const url=`http://127.0.0.1:${port}${base}`;
  return {browser,page,logs,url,close:async()=>{await browser.close();srv.close()}};
}
export function probe(file){
  const { execFileSync }=await_import_cp();
  const o=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','packet=pts_time,duration_time,dts_time','-show_entries','format=duration','-show_entries','stream=codec_name,width,height,nb_frames','-of','json',file]).toString());
  return o;
}
import cp from 'child_process'; function await_import_cp(){return cp}
