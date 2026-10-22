const $p=id=>document.getElementById(id);
let videoURL=null,videoFile=null,busy=false, extracted=[], selectedIndex=-1;
const video=$p('sourceVideo'),status=$p('pngStatus');
function setStatus(s){status.textContent=s;}
function loadVideo(file){
 if(busy)return;
 if(!file||!(file.type.startsWith('video/')||/\.(mp4|webm|mov|m4v|ogg)$/i.test(file.name))){setStatus('지원되는 영상 파일을 선택하세요.');return;}
 if(videoURL)URL.revokeObjectURL(videoURL);
 videoFile=file;videoURL=URL.createObjectURL(file);
 video.src=videoURL;video.load();resetPreview();$p('pngPreview').disabled=false;
 setStatus('영상 정보를 읽는 중…');
}
video.addEventListener('loadedmetadata',()=>{
 const d=video.duration;
 if(!Number.isFinite(d)||d<=0){setStatus('영상 길이를 읽을 수 없습니다. 다른 영상을 선택해 주세요.');return;}
 $p('pngStart').value=0;$p('pngEnd').value=Math.round(d*1000);$p('pngPreview').disabled=false;refreshInfo();setStatus('추출 준비 완료');
});
video.addEventListener('error',()=>{setStatus('브라우저에서 영상을 재생할 수 없습니다. MP4(H.264) 또는 WEBM 영상으로 변환 후 시도하세요.');$p('pngPreview').disabled=false;});
function timestamps(){
 const full=Math.round(video.duration*1000),start=Number($p('pngStart').value),end=Number($p('pngEnd').value),step=Number($p('pngInterval').value);
 if(![start,end,step].every(Number.isSafeInteger)||start<0||end>full||end<=start||step<1)throw Error('시작/종료/간격을 올바른 정수 ms로 입력하세요.');
 const n=Math.ceil((end-start)/step);
 if(n+1>2000)throw Error('추출 이미지가 2,000장을 초과합니다. 간격을 늘려주세요.');
 const out=[];for(let i=0;i<n;i++)out.push(start+i*step);
 if(out[out.length-1]!==end)out.push(end);
 return out;
}
function refreshInfo(){try{$p('pngInfo').textContent=video.readyState?('총 '+timestamps().length+'장 · '+Math.round(video.duration*1000)+'ms'):'';}catch(e){$p('pngInfo').textContent=e.message;}}
for(const id of ['pngInterval','pngStart','pngEnd'])$p(id).addEventListener('input',()=>{resetPreview();refreshInfo();});
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

function resetPreview(){
 for(const f of extracted)URL.revokeObjectURL(f.url);
 extracted=[];selectedIndex=-1;
 $p('pngReview').hidden=true;$p('pngThumbs').replaceChildren();$p('pngExport').disabled=true;
}
function renderReview(){
 const scroll=$p('pngGrid'),top=scroll.scrollTop;
 $p('pngReview').hidden=false;
 const thumbs=$p('pngThumbs');thumbs.replaceChildren();
 extracted.forEach((f,i)=>{
  const card=document.createElement('div');card.className='png-thumb'+(f.excluded?' excluded':'');
  const imageBox=document.createElement('div');imageBox.className='png-thumb-image';
  const im=document.createElement('img');im.src=f.url;im.alt=f.ms+'ms 프레임';im.loading='lazy';
  const toggle=document.createElement('button');toggle.type='button';toggle.className='png-thumb-toggle';
  toggle.textContent=f.excluded?'↺':'×';toggle.title=f.excluded?'프레임 다시 포함':'ZIP에서 프레임 제외';
  toggle.setAttribute('aria-label',f.ms+'ms '+(f.excluded?'복원':'제외'));
  toggle.onclick=()=>{f.excluded=!f.excluded;renderReview();};
  const label=document.createElement('span');label.className='png-thumb-label';label.textContent=f.ms+'ms';
  imageBox.append(im,toggle);card.append(imageBox,label);thumbs.append(card);
 });
 scroll.scrollTop=top;
 const included=extracted.filter(f=>!f.excluded).length;
 $p('pngCount').textContent=included+' / '+extracted.length+'장 포함';
 $p('pngExport').disabled=included===0;
}
$p('pngRestore').onclick=()=>{extracted.forEach(f=>f.excluded=false);renderReview();};
$p('pngPreview').onclick=async()=>{
 if(busy)return;
 if(!videoFile){setStatus('먼저 영상을 업로드해 주세요.');return;}
 busy=true;$p('pngPreview').disabled=true;$p('pngExport').disabled=true;
 $p('pngProgress').hidden=false;$p('pngProgress').value=0;
 try{
  if(video.readyState<2){
   setStatus('영상 프레임을 불러오는 중…');
   await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{cleanup();reject(Error('영상 로딩 시간이 초과되었습니다. 코덱을 확인해 주세요.'));},15000);const cleanup=()=>{clearTimeout(timeout);video.removeEventListener('loadeddata',ok);video.removeEventListener('error',fail);};const ok=()=>{cleanup();resolve();};const fail=()=>{cleanup();reject(Error('영상 디코딩에 실패했습니다.'));};video.addEventListener('loadeddata',ok,{once:true});video.addEventListener('error',fail,{once:true});if(video.readyState>=2)ok();});
  }
  if(!Number.isFinite(video.duration)||video.duration<=0)throw Error('영상 길이를 확인할 수 없습니다.');
  const times=timestamps();resetPreview();video.pause();
  const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
  if(!canvas.width||!canvas.height)throw Error('영상 해상도를 확인할 수 없습니다.');
  const ctx=canvas.getContext('2d');
  for(let i=0;i<times.length;i++){
   await seek(times[i]/1000);
   ctx.drawImage(video,0,0,canvas.width,canvas.height);
   const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('PNG 생성 실패')),'image/png'));
   extracted.push({ms:times[i],blob,url:URL.createObjectURL(blob),excluded:false});
   $p('pngProgress').value=Math.round((i+1)/times.length*100);
   setStatus('미리보기 생성 중… '+(i+1)+' / '+times.length);
  }
  renderReview();setStatus('미리보기 완료 · 각 이미지의 ×로 제외한 뒤 ZIP을 다운로드하세요.');
 }catch(e){resetPreview();setStatus('오류: '+e.message);}
 finally{busy=false;$p('pngPreview').disabled=false;}
};
$p('pngExport').onclick=async()=>{
 if(busy||!extracted.length)return;
 const kept=extracted.filter(f=>!f.excluded);if(!kept.length)return;
 busy=true;$p('pngExport').disabled=true;
 try{
  setStatus('ZIP 생성 중…');
  const files=[];
  for(let i=0;i<kept.length;i++)files.push({name:String(i+1).padStart(4,'0')+'_'+String(kept[i].ms).padStart(7,'0')+'ms.png',data:new Uint8Array(await kept[i].blob.arrayBuffer())});
  const zip=zipFiles(files),url=URL.createObjectURL(zip),a=document.createElement('a');
  a.href=url;a.download=(videoFile.name.replace(/\.[^.]+$/,'')||'frames')+'_png.zip';document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);setStatus('ZIP 완료 · '+files.length+'장');
 }catch(e){setStatus('오류: '+e.message);}
 finally{busy=false;$p('pngExport').disabled=extracted.every(f=>f.excluded);}
};
