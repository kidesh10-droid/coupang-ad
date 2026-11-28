# ERP 페이지 만들기: scripts/erp_src.html + 광고 장부(ad/index.html)의 공용 CSS·엑셀 내보내기 → erp/index.html
import re, os, sys
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ad = open(os.path.join(R, 'ad/index.html'), encoding='utf-8').read()
src = open(os.path.join(R, 'scripts/erp_src.html'), encoding='utf-8').read()
css = ad[ad.index('<style>') + 7: ad.index('</style>')]
x = ad[ad.index('const xNum='): ad.index('const BRW=')]
x = re.sub(r"const xFile=name=>`\$\{\(CH=='nv'\?'네이버':'쿠팡'\)\}광고_", "const xFile=name=>`ERP_", x)
assert 'const xFile=name=>`ERP_' in x, 'xFile not replaced'
x = x.replace("wb.creator='광고 장부'", "wb.creator='디앤디컴 ERP'")
import shutil, time
V = sys.argv[1] if len(sys.argv) > 1 else str(int(time.time()))
shutil.copy(os.path.join(R, 'scripts/erp_ecp.js'), os.path.join(R, 'erp/ecp.js'))
out = src.replace('__V__', V).replace('/*@@CSS@@*/', css).replace('/*@@XEXPORT@@*/', x)
os.makedirs(os.path.join(R, 'erp'), exist_ok=True)
open(os.path.join(R, 'erp/index.html'), 'w', encoding='utf-8').write(out)
print('erp/index.html', len(out))
# 행사 기록 페이지
ev = open(os.path.join(R, 'scripts/ev_src.html'), encoding='utf-8').read()
xe = x.replace('const xFile=name=>`ERP_', 'const xFile=name=>`행사_').replace("wb.creator='디앤디컴 ERP'", "wb.creator='디앤디컴 행사 기록'")
os.makedirs(os.path.join(R, 'event'), exist_ok=True)
open(os.path.join(R, 'event/index.html'), 'w', encoding='utf-8').write(ev.replace('/*@@CSS@@*/', css).replace('/*@@XEXPORT@@*/', xe))
print('event/index.html')
# 소싱 페이지
sp = open(os.path.join(R, 'scripts/src_src.html'), encoding='utf-8').read()
xs = x.replace('const xFile=name=>`ERP_', 'const xFile=name=>`').replace("wb.creator='디앤디컴 ERP'", "wb.creator='디앤디컴 소싱'")
os.makedirs(os.path.join(R, 'sourcing'), exist_ok=True)
shutil.copy(os.path.join(R, 'scripts/src_parse.js'), os.path.join(R, 'sourcing/src_parse.js'))
open(os.path.join(R, 'sourcing/index.html'), 'w', encoding='utf-8').write(sp.replace('__V__', V).replace('/*@@CSS@@*/', css).replace('/*@@XEXPORT@@*/', xs))
print('sourcing/index.html')
