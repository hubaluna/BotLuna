from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import base64
root=Path(__file__).resolve().parents[1]
im=Image.new('RGB',(1600,1140),'#f7f4ee');d=ImageDraw.Draw(im)
f='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';fb='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
def tx(x,y,text,size=30,color='#242424',bold=False): d.text((x,y),text,font=ImageFont.truetype(fb if bold else f,size),fill=color)
tx(80,55,'FORMULOVE',37,bold=True);d.line((80,126,1520,126),fill='#d4d0c8',width=2)
tx(80,160,'Як обрати розмір',66,bold=True)
tx(80,252,'ПРИКЛАД СІТКИ · НЕ ЗАМІРИ ТОВАРУ',27,color='#b32835',bold=True)
shirt=[(235,415),(360,365),(390,378),(425,385),(460,378),(490,365),(615,415),(690,555),(602,602),(553,515),(553,850),(297,850),(297,515),(248,602),(160,555),(235,415)]
d.line(shirt,fill='#282828',width=9,joint='curve');d.arc((368,345,485,410),0,180,fill='#282828',width=7)
def arrow(a,b,label,offset=(0,0)):
 d.line((a,b),fill='#b32835',width=5)
 import math
 ang=math.atan2(b[1]-a[1],b[0]-a[0])
 for point,theta in [(a,ang),(b,ang+math.pi)]:
  for side in [-.55,.55]:d.line((point,(point[0]+22*math.cos(theta+side),point[1]+22*math.sin(theta+side))),fill='#b32835',width=5)
 tx((a[0]+b[0])/2+offset[0],(a[1]+b[1])/2+offset[1],label,37,color='#b32835',bold=True)
arrow((314,566),(536,566),'A',(-14,-52));arrow((732,399),(732,850),'B',(17,-20));arrow((553,408),(650,557),'C',(30,-20))
tx(85,905,'A — ширина під проймами',27);tx(85,948,'B — довжина від плеча',27);tx(85,991,'C — довжина рукава',27)
tx(860,368,'Розмір',27,bold=True)
for x,t in [(1100,'A, см'),(1255,'B, см'),(1410,'C, см')]:tx(x,368,t,25,bold=True)
for index,size in enumerate(['S','M','L','XL','XXL']):
 y=435+index*85;d.line((855,y-12,1510,y-12),fill='#d4d0c8',width=2);tx(880,y,size,30,bold=True)
 for x in [1122,1277,1432]:tx(x,y,'—',30,color='#99928a')
tx(860,903,'Розкладіть річ на рівній поверхні.',25)
tx(860,947,'Порівняйте з одягом, який вам пасує.',25)
tx(80,1077,'Точні заміри конкретної моделі погодимо до оплати.',28,color='#716b63')
output=root/'public/guides/size-guide-v1.jpg';im.save(output,quality=92,subsampling=0)
(root/'media-source/size-guide.jpg.b64').write_text(base64.b64encode(output.read_bytes()).decode()+'\n')
print('Size guide:',output.stat().st_size,'bytes')
