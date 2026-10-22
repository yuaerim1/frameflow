# 테스트용 이미지 생성 (Pillow 필요): python3 make-fixtures.py <출력 디렉터리>
import sys, os
from PIL import Image, ImageDraw
d = sys.argv[1]; os.makedirs(d + '/many', exist_ok=True)
for n, c in {1:(255,0,0),2:(0,255,0),3:(0,0,255),10:(255,255,0),11:(255,0,255)}.items():
    im = Image.new('RGB',(160,90),c); ImageDraw.Draw(im).text((10,10),str(n),fill=(0,0,0)); im.save(f'{d}/{n}.png')
im = Image.new('RGBA',(160,90),(0,0,0,0)); ImageDraw.Draw(im).ellipse((30,10,130,80),fill=(255,0,0,255)); im.save(f'{d}/t.png')
Image.new('RGB',(161,91),(0,128,255)).save(f'{d}/odd.jpg',quality=90)
open(f'{d}/bad.png','wb').write(b'not an image'); open(f'{d}/note.txt','w').write('hi')
im = Image.new('RGB',(3840,2160),(10,200,10)); ImageDraw.Draw(im).rectangle((100,100,1000,800),fill=(200,10,10)); im.save(f'{d}/big4k.png')
Image.new('RGB',(1920,1080),(20,20,220)).save(f'{d}/hd.png'); Image.new('RGB',(100,300),(250,120,0)).save(f'{d}/tall.png')
Image.new('RGB',(4096,2160),(1,2,3)).save(f'{d}/over4k.png')
for i in range(1,201): Image.new('RGB',(640,360),((i*37)%256,(i*91)%256,(i*53)%256)).save(f'{d}/many/f{i}.png')
