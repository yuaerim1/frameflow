# 테스트
- 필요: Node 18+, `npm i playwright-core mp4-muxer@5.2.2`(이 폴더에서), Chrome/Chromium, ffmpeg/ffprobe, Python+Pillow.
- `python3 make-fixtures.py <dir>` 로 이미지 생성 후 `e2e.mjs`/`harness.mjs` 상단의 경로(`/home/claude/work/fixtures/`, Chrome 경로)를 환경에 맞게 수정.
- 실행: `node e2e.mjs <sprite-mp4 경로> /서브경로/`
- 주의: 테스트 환경의 Chromium에는 H.264 인코더가 없어 `harness.mjs`가 VideoEncoder를 VP9로 대체합니다. 타임스탬프·MP4 박스·UI는 검증되지만 H.264 인코딩 자체는 검증하지 못합니다. H.264가 가능한 실제 Chrome에서는 shim 없이(`launch(dir,{shim:false})`) 실행하세요.
