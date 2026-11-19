# ad/index.html(쿠팡 장부)로 naver/index.html(네이버 장부)을 만든다. 구조·기능은 같고 이름·색·저장소만 다름.
import pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
s = (root / 'ad' / 'index.html').read_text(encoding='utf-8')
s = s.replace('<html lang="ko">', '<html lang="ko" data-ch="nv">', 1)
s = s.replace('쿠팡', '네이버')
# 링크 미리보기: 네이버용 이미지·주소, 아이콘 색
s = s.replace('dnd-coupang.pages.dev/og.jpg', 'dnd-coupang.pages.dev/og-nv.jpg').replace('content="https://dnd-coupang.pages.dev/ad/"', 'content="https://dnd-coupang.pages.dev/naver/"').replace('%231d3f8f', '%230b6b3a')
(root / 'naver').mkdir(exist_ok=True)
(root / 'naver' / 'index.html').write_text(s, encoding='utf-8')
print('naver/index.html', len(s))
