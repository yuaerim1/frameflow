const $p=id=>document.getElementById(id);
let videoURL=null,videoFile=null,busy=false;
const video=$p('sourceVideo'),status=$p('pngStatus');
function setStatus(s){status.textContent=s;}
function loadVideo(file){
 if(busy)return;
 if(!file||!(file.type.startsWith('video/')||/\.(mp4|webm|mov|m4v|ogg)$/i.test(file.name))){setStatus('지원되는 영상 파일을 선택하세요.');return;}
 if(videoURL)URL.revokeObjectURL(videoURL);
 videoFile=file;videoURL=URL.createObjectURL(file);
 video.src=videoURL;video.load();$p('pngExport').disabled=true;
 setStatus('영상 정보를 읽는 중…');
}
video.addEventListener('loadedmetadata',()=>{
 const d=video.duration;
 if(!Number.isFinite(d)||d<=0){setStatus('영상 길이를 읽을 수 없습니다.');return;}
 $p('pngExport').disabled=false;refreshInfo();setStatus('추출 준비 완료');
});
video.addEventListener('error',()=>setStatus('브라우저에서 영상을 재생할 수 없습니다. 다른 형식으로 변환 후 시도하세요.'));
function timestamps(){
 const ms=Math.round(video.duration*1000),step=Number($p('pngInterval').value);
 if(!Number.isSafeInteger(step)||step<1)throw Error('추출 간격은 1ms 이상의 정수여야 합니다.');
 const n=Math.ceil(ms/step);
 if(n>2000)throw Error('추출 이미지가 2,000장을 초과합니다. 간격을 늘려주세요.');
 const out=[];for(let i=0;i<n;i++)out.push(i*step);
 if(!out.length||out[out.length-1]!==ms)out.push(ms);
 return out;
}
function refreshInfo(){try{$p('pngInfo').textContent=video.readyState?('총 '+timestamps().length+'장 · '+Math.round(video.duration*1000)+'ms'):'';}catch(e){$p('pngInfo').textContent=e.message;}}
$p('pngInterval').addEventListener('input',refreshInfo);
$p('videoPick').onclick=()=>$p('videoFiles').click();
$p('videoFiles').onchange=e=>{loadVideo(e.target.files[0]);e.target.value='';};
const drop=$p('videoDrop');
drop.addEventListener('click',e=>{if(e.target===drop||e.target.tagName==='STRONG'||e.target.tagName==='P')$p('videoFiles').click();});
drop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$p('videoFiles').click();}});
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('over');});
drop.addEventListener('dragleave',()=>drop.classList.remove('over'));
drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('over');loadVideo(e.dataTransfer.files[0]);});
function seek(t){
 return new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{cleanup();reject(Error('영상 프레임 탐색 시간이 초과되었습니다.'));},15000);
  const cleanup=()=>{clearTimeout(timeout);video.removeEventListener('seeked',done);video.removeEventListener('error',fail);};
  const done=()=>{cleanup();requestAnimationFrame(()=>requestAnimationFrame(resolve));};
  const fail=()=>{cleanup();reject(Error('영상 프레임 탐색 실패'));};
  video.addEventListener('seeked',done,{once:true});video.addEventListener('error',fail,{once:true});
  video.currentTime=Math.max(0,Math.min(t,Math.max(0,video.duration-0.000001)));
  if(!video.seeking&&Math.abs(video.currentTime-t)<0.000001)done();
 });
}
const table=(()=>{let a=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;a.push(c>>>0);}return a;})();
function crc(bytes){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function zipFiles(files){
 const enc=new TextEncoder(),chunks=[],central=[];let offset=0;
 const u16=(v)=>[v&255,(v>>>8)&255],u32=(v)=>[v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255];
 for(const f of files){
  const name=enc.encode(f.name),data=f.data,check=crc(data),size=data.length;
  const local=new Uint8Array([...u32(0x04034b50),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(check),...u32(size),...u32(size),...u16(name.length),...u16(0),...name]);
  chunks.push(local,data);
  central.push(new Uint8Array([...u32(0x02014b50),...u16(20),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(check),...u32(size),...u32(size),...u16(name.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset),...name]));
  offset+=local.length+size;
 }
 const centerSize=central.reduce((s,c)=>s+c.length,0);
 const end=new Uint8Array([...u32(0x06054b50),...u16(0),...u16(0),...u16(files.length),...u16(files.length),...u32(centerSize),...u32(offset),...u16(0)]);
 return new Blob([...chunks,...central,end],{type:'application/zip'});
}
$p('pngExport').onclick=async()=>{
 if(busy||!videoFile)return;
 busy=true;$p('pngExport').disabled=true;$p('pngProgress').hidden=false;$p('pngProgress').value=0;
 try{
  video.pause();const times=timestamps(),files=[];
  const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
  if(!canvas.width||!canvas.height)throw Error('영상 해상도를 확인할 수 없습니다.');
  const ctx=canvas.getContext('2d');
  for(let i=0;i<times.length;i++){
   const t=times[i];
   await seek(t/1000);
   ctx.drawImage(video,0,0,canvas.width,canvas.height);
   const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('PNG 생성 실패')),'image/png'));
   files.push({name:String(i+1).padStart(4,'0')+'_'+String(t).padStart(7,'0')+'ms.png',data:new Uint8Array(await blob.arrayBuffer())});
   $p('pngProgress').value=Math.round((i+1)/times.length*90);
   setStatus('PNG 추출 중… '+(i+1)+' / '+times.length);
  }
  setStatus('ZIP 생성 중…');
  const zip=zipFiles(files),url=URL.createObjectURL(zip),a=document.createElement('a');
  a.href=url;a.download=(videoFile.name.replace(/\.[^.]+$/,'')||'frames')+'_png.zip';document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  $p('pngProgress').value=100;setStatus('완료 · '+files.length+'장');
 }catch(e){setStatus('오류: '+e.message);}
 finally{busy=false;$p('pngExport').disabled=!videoFile;}
};
