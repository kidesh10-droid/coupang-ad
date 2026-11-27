// 모든 페이지 공통: 오른쪽 마우스·드래그 복사·페이지 저장/소스보기 단축키 막기, 다른 사이트에 끼워 넣기(iframe)·검색 노출 막기.
// 입력칸(검색·메모·붙여넣기 칸)에서는 복사·붙여넣기가 그대로 됩니다. 파일 끌어다 놓기·Ctrl+V 이미지 붙여넣기도 그대로.
const GUARD = `<style id="no-copy">body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}input,textarea,select,[contenteditable],[contenteditable] *{-webkit-user-select:text;user-select:text}img{-webkit-user-drag:none}</style>
<script>(function(){var ok=function(t){return!!(t&&t.closest&&t.closest('input,textarea,select,[contenteditable]'))};
var stop=function(e){e.preventDefault();e.stopPropagation();return false};
document.addEventListener('contextmenu',stop,true);
document.addEventListener('dragstart',function(e){if(!ok(e.target))stop(e)},true);
document.addEventListener('selectstart',function(e){if(!ok(e.target))stop(e)},true);
['copy','cut'].forEach(function(n){document.addEventListener(n,function(e){if(!ok(e.target))stop(e)},true)});
document.addEventListener('keydown',function(e){var k=(e.key||'').toLowerCase(),c=e.ctrlKey||e.metaKey;
 if(e.key==='F12'||(c&&(k==='s'||k==='u'))||(c&&e.shiftKey&&(k==='i'||k==='j'||k==='c'))||(c&&(k==='a'||k==='c'||k==='x')&&!ok(e.target)))stop(e)},true);
})();</script>`;

export async function onRequest(ctx) {
  const res = await ctx.next();
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return res;
  const r = new Response(res.body, res);
  r.headers.set('X-Frame-Options', 'SAMEORIGIN');
  r.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return new HTMLRewriter().on('head', { element(e) { e.append(GUARD, { html: true }) } }).transform(r);
}
