/* 소싱 엑셀(알리바바 디자인 추천 양식) 읽기 — 화면 업로드·초기 자료 공용 */
(function (G) {
'use strict';
const T = v => v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
const N = v => { if (typeof v == 'number') return v; const s = T(v).replace(/[,원개\s]/g, ''); return s && isFinite(+s) ? +s : null };
const CFGK = { '수수료': 'fee', '광고비': 'ad', '배송비': 'ship', '배송비(원)': 'ship', '마진': 'margin', '관세·운송 등 부대비': 'extra', '부대비': 'extra' };
const SRCP = {
  T, N,
  /* 필요 최소 판매가 = (공장가 × (1+부대비) + 배송비) ÷ (1 − 수수료 − 광고비 − 마진) */
  need(c, cfg) { const d = 1 - cfg.fee - cfg.ad - cfg.margin; return c == null || d <= 0 ? null : (c * (1 + cfg.extra) + cfg.ship) / d },
  /* A: 시트 행 배열, links: {r:{c:url}}, imgs: {r:dataURL 또는 경로} */
  sheet(A, links, imgs, title) {
    links = links || {}; imgs = imgs || {};
    const hi = A.findIndex(r => (r || []).map(T).includes('품목') && (r || []).map(T).includes('상품')); if (hi < 0) return null;
    const H = A[hi].map(T), col = re => H.findIndex(h => re.test(h.replace(/\s+/g, '')));
    const C = { cat: col(/^품목$/), name: col(/^상품$/), design: col(/디자인/), sup: col(/^업체/), yr: col(/업력|평점/), sold: col(/판매실적/), pmin: col(/공장가최저/), pmax: col(/공장가최고/), moq: col(/^MOQ/i), plan: col(/계획판매가/), verdict: col(/판정/), link: col(/상품링크|링크/), pic: col(/사진/) };
    const cfg = { fee: .108, ad: .34, ship: 4150, margin: .1, extra: .3 };
    A.slice(0, hi).forEach(r => { r = r || []; for (let i = 0; i < r.length; i++) { const k = CFGK[T(r[i])]; if (!k) continue; let v = N(r[i + 1]); if (v == null) v = N(r[i + 2]); if (v != null) cfg[k] = v } });
    const head = T((A[0] || [])[0]);
    let band = '', cat = null; const cats = [], items = [];
    for (let ri = hi + 1; ri < A.length; ri++) { const r = A[ri] || [], a = T(r[0]);
      if (/^[①②③④⑤⑥⑦⑧⑨]/.test(a) && !T(r[C.name])) { band = a; continue }
      if (/^■/.test(a)) { const m = a.match(/^■\s*(.+?)\s*—\s*계획\s*판매가\s*([\d,]+)\s*원/), q = a.match(/[“"]([^”"]+)[”"]/);
        cat = { band, name: m ? m[1] : a.replace(/^■\s*/, '').split('—')[0].trim(), plan: m ? N(m[2]) : null, cq: q ? q[1] : '', cu: (links[ri] && Object.values(links[ri])[0]) || '' }; cats.push(cat); continue }
      const name = T(r[C.name]); if (!name) continue;
      const catName = T(r[C.cat]) || (cat && cat.name) || '';
      let c = cat && cat.name == catName ? cat : cats.find(x => x.name == catName); if (!c) { c = { band, name: catName, plan: N(r[C.plan]), cq: catName, cu: '' }; cats.push(c) }
      const sup = T(r[C.sup]), yr = T(r[C.yr]);
      items.push({ band: c.band, cat: c.name, plan: N(r[C.plan]) ?? c.plan, cq: c.cq, cu: c.cu, name, design: T(r[C.design]), sup: sup.replace(/\s*✔\s*Verified/i, '').trim(), ver: /verified/i.test(sup),
        yr, sold: C.sold >= 0 ? T(r[C.sold]) : '', pmin: N(r[C.pmin]), pmax: N(r[C.pmax]), moq: T(r[C.moq]), url: (links[ri] && (links[ri][C.link] || links[ri][C.name])) || '', img: imgs[ri] || '' }) }
    if (!items.length) return null;
    return { title: title || head, note: T((A[1] || [])[0]), cfg, items }
  },
  /* 브라우저: File(xlsx) → 배치 목록. XLSX(SheetJS), JSZip 필요 */
  async file(f, XLSX, JSZip) {
    const buf = await f.arrayBuffer(), wb = XLSX.read(buf, { type: 'array', cellDates: true }), out = [];
    let zip = null; try { zip = JSZip ? await JSZip.loadAsync(buf) : null } catch (e) { }
    for (let si = 0; si < wb.SheetNames.length; si++) { const sn = wb.SheetNames[si], ws = wb.Sheets[sn];
      const A = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true });
      const rg = XLSX.utils.decode_range(ws['!ref'] || 'A1'), links = {};
      for (const k of Object.keys(ws)) { if (k[0] == '!') continue; const c = ws[k]; if (c && c.l && c.l.Target) { const a = XLSX.utils.decode_cell(k), r = a.r - rg.s.r; (links[r] = links[r] || {})[a.c - rg.s.c] = c.l.Target } }
      const imgs = zip ? await SRCP.zipImgs(zip, si + 1, rg.s.r) : {};
      const b = SRCP.sheet(A, links, imgs, ''); if (b) out.push(b) }
    return out },
  /* xlsx 안 그림 → {행: dataURL} */
  async zipImgs(zip, sheetNo, r0) { const o = {};
    try { const rel = await zip.file(`xl/worksheets/_rels/sheet${sheetNo}.xml.rels`)?.async('string'); if (!rel) return o;
      const dm = rel.match(/Target="([^"]*drawings\/drawing\d+\.xml)"/); if (!dm) return o; const dp = 'xl/' + dm[1].replace(/^(\.\.\/|\/xl\/)/, '');
      const dx = await zip.file(dp).async('string'), dr = await zip.file(dp.replace('drawings/', 'drawings/_rels/') + '.rels').async('string'), rid = {};
      dr.replace(/<Relationship[^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"|<Relationship[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g, (_, t1, i1, i2, t2) => { rid[i1 || i2] = 'xl/' + (t1 || t2).replace(/^(\.\.\/|\/xl\/)/, '') });
      const anc = [...dx.matchAll(/<(?:xdr:)?(?:oneCellAnchor|twoCellAnchor)[\s\S]*?<\/(?:xdr:)?(?:oneCellAnchor|twoCellAnchor)>/g)];
      for (const m of anc) { const row = m[0].match(/<(?:xdr:)?row>(\d+)</), emb = m[0].match(/r:embed="([^"]+)"/); if (!row || !emb || !rid[emb[1]]) continue;
        const p = rid[emb[1]], fz = zip.file(p); if (!fz) continue; const ext = p.split('.').pop().toLowerCase();
        o[+row[1] - r0] = `data:image/${ext == 'jpg' ? 'jpeg' : ext};base64,` + await fz.async('base64') } } catch (e) { }
    return o }
};
G.SRCP = SRCP;
})(typeof window != 'undefined' ? window : globalThis);
