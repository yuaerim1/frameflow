// 원본 앱에서 지적한 문제가 실제로 재현되는지 확인
import {launch} from './harness.mjs'; import {parseMp4} from './mp4parse.mjs';
const FX='/home/claude/work/fixtures/';
const h=await launch('/home/claude/work/orig/sprite-mp4',{base:'/repo/'}); const {page}=h;
await page.goto(h.url);
const names=()=>page.$$eval('.frame .name',e=>e.map(x=>x.textContent));
await page.setInputFiles('#files',['3.png','2.png','1.png'].map(n=>FX+n)); await page.waitForTimeout(400);
// B1 마지막 프레임 duration
const ins=await page.$$('.frame input'); for(const [i,v] of [[0,'60'],[1,'100'],[2,'33']]){await ins[i].fill(v);await ins[i].dispatchEvent('change')}
const [dl]=await Promise.all([page.waitForEvent('download'),page.click('#export')]); await dl.saveAs('/home/claude/work/test-out/orig1.mp4');
console.log('B1 입력 [60,100,33] → stts', parseMp4('/home/claude/work/test-out/orig1.mp4').video.durMs.map(x=>+x.toFixed(1)));
// B2 외부 파일을 행에 드롭
await page.evaluate(async()=>{const b=await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')).blob();const dt=new DataTransfer();dt.items.add(new File([b],'0-ext.png',{type:'image/png'}));const row=document.querySelectorAll('.frame')[2];row.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}))});
console.log('B2 외부 파일 행 드롭 후 순서(원래 1,2,3):',await names());
// B3 수동 정렬 후 추가 → 전체 재정렬
await page.click('#clear'); await page.setInputFiles('#files',['1.png','2.png','3.png'].map(n=>FX+n)); await page.waitForTimeout(300);
await page.click('.frame:nth-child(1) button'); // × 대신 첫 버튼=삭제라 사용 불가 → 드래그로 대체
await page.dragAndDrop('.frame:nth-child(1)','.frame:nth-child(2)').catch(()=>{});
const before=await names(); await page.setInputFiles('#files',[FX+'10.png']); await page.waitForTimeout(300);
console.log('B3 수동 순서',before,'→ 파일 추가 후',await names());
// B4 창 아무 곳 드롭 시 브라우저 기본동작 방지 여부
console.log('B4 페이지 dragover defaultPrevented(파일 드래그):',await page.evaluate(()=>{const dt=new DataTransfer();dt.items.add(new File(['x'],'a.png',{type:'image/png'}));const e=new DragEvent('dragover',{dataTransfer:dt,bubbles:true,cancelable:true});document.querySelector('h1').dispatchEvent(e);return e.defaultPrevented}));
// B5 4K 코덱 레벨
await page.click('#clear'); await page.setInputFiles('#files',[FX+'big4k.png']); await page.waitForTimeout(500);
const [d2]=await Promise.all([page.waitForEvent('download'),page.click('#export')]); await d2.saveAs('/home/claude/work/test-out/orig4k.mp4');
console.log('B5 3840x2160 구성:',JSON.stringify((await page.evaluate(()=>window.__cfgs.slice(-1)[0]))));
// B6 입력 값 처리
await page.click('#clear'); await page.setInputFiles('#files',[FX+'1.png']); await page.waitForTimeout(300);
const inp=await page.$('.frame input'); const r=[]; for(const v of ['','0']){await inp.fill(v);await inp.dispatchEvent('change');r.push([v,await inp.inputValue()])}
console.log('B6 빈값/0 입력 결과:',JSON.stringify(r));
// B7 로드 실패 안내
await page.setInputFiles('#files',[FX+'bad.png']); await page.waitForTimeout(300);
console.log('B7 손상 파일 추가 시 사용자 안내 요소:',await page.evaluate(()=>!!document.getElementById('notice')),'/ 프레임수',(await names()).length);
await h.close();
