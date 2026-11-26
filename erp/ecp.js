/* 이카운트 엑셀 읽기 → ERP 저장 (ERP 화면·광고 장부 업로드 공용) */
(function (G) {
'use strict';
const p2 = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const mEnd = m => { const [y, mm] = m.split('-').map(Number); return new Date(y, mm, 0).getDate() };
const TODAY = iso(new Date());
const T = v => v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
const num = v => { if (typeof v == 'number') return v; const s = String(v ?? '').replace(/[,\s원]/g, ''); if (s === '' || s == '-') return 0; const n = +s; return isFinite(n) ? n : 0 };
const dates = t => { const o = []; String(t || '').replace(/(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/g, (_, y, m, d) => { o.push(`${y}-${p2(m)}-${p2(d)}`) }); return o };
const SKIP = /^(합계|소계|총계|누계)$|계$|^\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}\s+(오전|오후|AM|PM)/i;
const nkey = s => T(s).toLowerCase().replace(/[\s\[\]()\-_/]/g, '');

const ECP = {
  dates, T, num,
  /* 시트 하나 → {kind:'sale'|'item'|'stock', ...} | {kind:null, why} */
  sheet(A, fname, sname) {
    A = (A || []).map(r => (r || []).map(v => v instanceof Date ? iso(v) : v));
    const hi = A.findIndex(r => { const h = r.map(T); return h.some(x => /^품목(코드|명)/.test(x)) && h.some(x => /수량|재고|판매|금액|공급가액/.test(x)) });
    if (hi < 0) return { kind: null, why: A.some(r => (r || []).some(v => /^거래처(코드|명)$/.test(T(v)))) ? '거래처별 합계 자료라 품목을 알 수 없음 — 거래처·품목이 함께 있는 일별이익현황으로 올려 주세요' : '품목코드·품목명 열이 있는 제목 줄을 못 찾음' };
    const H = A[hi].map(T), H2 = (A[hi + 1] || []).map(T), title = A.slice(0, hi).map(r => r.map(T).filter(Boolean).join(' ')).join(' ');
    const sub = H2.filter(x => /^(수량|단가|금액)$/.test(x)).length >= 2;
    let g = ''; const C = H.map((h, i) => { if (h) g = h; const s = sub ? H2[i] : ''; return sub && s ? (g + '.' + s) : (h || (sub ? '' : g)) });
    const col = (...re) => { for (const r of re) { const i = C.findIndex(c => r.test(c)); if (i >= 0) return i } return -1 };
    const fdates = dates(title + ' ' + (fname || '')), body = A.slice(hi + (sub ? 2 : 1));
    const id = C.findIndex(h => /^일자/.test(h)), isDay = id >= 0;
    const ic = col(/^품목코드$/), inm = col(/^품목명/);
    if (C.some(c => /재고수량|^재고$|기말|현재고/.test(c)) && !isDay) {
      const iq = col(/재고수량|^재고$|기말.*수량|현재고/), iu = col(/재고단가|^단가$/), ia = col(/재고금액|^금액$/), iw = col(/^창고/);
      const parts = title.split('/').map(s => s.trim()).filter(Boolean), dt = dates(title).pop() || dates(fname).pop() || null;
      let wh = parts.find(p => !/회사명|\d{4}[\/.-]\d{1,2}/.test(p)) || sname || '창고'; wh = wh.replace(/^온비즈\s*/, '').trim() || wh;
      const by = {};
      for (const r of body) { const code = T(r[ic >= 0 ? ic : inm]); if (!code || SKIP.test(code)) continue;
        const w = iw >= 0 ? (T(r[iw]).replace(/^온비즈\s*/, '') || wh) : wh, q = num(r[iq]), a = ia >= 0 ? num(r[ia]) : 0, u = iu >= 0 ? num(r[iu]) : (q ? a / q : 0);
        (by[w] = by[w] || []).push([code, T(r[inm]), q, Math.round(u), Math.round(a || u * q)]) }
      return Object.keys(by).length ? { kind: 'stock', date: dt, W: by } : { kind: null, why: '재고 품목 줄이 없음' } }
    const iq = col(/^판매\.수량$/, /^수량$/), ip = col(/^판매\.단가$/, /^단가$/),
      isup = col(/^공급가액$/), ivat = col(/^부가세$/),
      ia = col(/^판매\.금액$/, /^합계(금액)?$/, /^금액$/),
      iuc = col(/^원가\.단가$/, /^원가단가$/), ica = col(/^원가\.금액$/, /^원가금액$/, /^원가$/);
    if (iq < 0 || (ia < 0 && isup < 0)) return { kind: null, why: '수량·금액 열을 못 찾음 (열: ' + C.filter(Boolean).join(', ') + ')' };
    const amt = r => isup >= 0 ? num(r[isup]) : num(r[ia]);
    const per = dates(title), from = per[0] || null, to = per[1] || per[0] || null;
    if (isDay) { const icu = col(/^거래처명?$/), L = [];
      const fy = from ? +from.slice(0, 4) : new Date().getFullYear(), fm = from ? +from.slice(5, 7) : 1, ty = to ? +to.slice(0, 4) : fy;
      for (const r of body) { const s = T(r[id]); if (!s || SKIP.test(s) || /계/.test(s)) continue;
        const code = T(r[ic]), nm = T(r[inm]); if (!code && !nm) continue;
        let m = s.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})(?:\s*-\s*(\d+))?/), y, mo, d, no;
        if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; no = +(m[4] || 0) }
        else if ((m = s.match(/^(\d{1,2})[\/.-](\d{1,2})(?:\s*-\s*(\d+))?/))) { mo = +m[1]; d = +m[2]; no = +(m[3] || 0); y = mo >= fm ? fy : ty }
        else continue;
        const q = num(r[iq]), pr0 = ip >= 0 ? num(r[ip]) : 0; let a = amt(r); if (isup < 0 && pr0 && q && Math.abs(a - pr0 * q * 1.1) <= Math.max(2, Math.abs(a) * .002)) a = Math.round(a / 1.1); const ca = ica >= 0 ? num(r[ica]) : null;
        L.push([`${y}-${p2(mo)}-${p2(d)}`, no, T(r[icu]), code, nm, q, ip >= 0 ? num(r[ip]) : (q ? a / q : 0), a, iuc >= 0 ? num(r[iuc]) : (ca != null && q ? ca / q : null), ca]) }
      if (!L.length) return { kind: null, why: '판매 줄이 없음' }; const ds = L.map(x => x[0]).sort();
      return { kind: 'sale', from: from || ds[0], to: to || ds[ds.length - 1], L, noCost: ica < 0 && iuc < 0 } }
    const R = []; for (const r of body) { const code = T(r[ic >= 0 ? ic : inm]); if (!code || SKIP.test(code)) continue;
      R.push([code, T(r[inm]), num(r[iq]), amt(r), ica >= 0 ? num(r[ica]) : 0]) }
    return R.length ? { kind: 'item', from, to, R } : { kind: null, why: '품목 줄이 없음' } },

  /* 저장된 매출 줄 중 부가세 포함 금액(금액 = 단가×수량×1.1)을 공급가로 바꿈 → 바뀐 줄 수 */
  toSupply(doc) { let n = 0; (doc.L || []).forEach(l => { const q = l[4], pr = l[5], a = l[6]; if (pr && q && Math.abs(a - pr * q * 1.1) <= Math.max(2, Math.abs(a) * .002)) { l[6] = Math.round(a / 1.1); n++ } }); return n },
  /* 읽은 결과를 저장 문서에 합치기 → 바뀐 문서 {key:doc} */
  apply(res, docs, log) { const out = {};
    // 품목코드 없는 자료(판매현황)용: 이름 → 코드, 최근 원가단가
    const n2c = {}, uc = {};
    Object.keys(docs).sort().forEach(k => { const v = docs[k]; if (!v) return;
      if (k[0] == 's') { Object.entries(v.I || {}).forEach(([c, n]) => n2c[nkey(n)] = c); (v.L || []).forEach(l => { if (l[4] > 0 && l[7] > 0) uc[l[3]] = l[7] }) }
      if (k[0] == 't') Object.values(v.W || {}).forEach(rs => rs.forEach(r => { n2c[nkey(r[1])] = n2c[nkey(r[1])] || r[0]; if (!uc[r[0]] && r[3] > 0) uc[r[0]] = r[3] })) });
    for (let xi = 0; xi < res.length; xi++) { const x = res[xi];
      if (x.kind == 'sale') { const byM = {}; let est = 0, noCode = 0;
        x.L.forEach(l => { if (!l[3]) { l[3] = n2c[nkey(l[4])] || l[4]; if (!n2c[nkey(l[4])]) noCode++ }
          if (l[8] == null) { const u = uc[l[3]] || 0; l[8] = u; l[9] = u * l[5]; est++ } else if (l[9] == null) l[9] = l[8] * l[5];
          (byM[l[0].slice(0, 7)] = byM[l[0].slice(0, 7)] || []).push(l) });
        const months = new Set(Object.keys(byM)); if (x.from && x.to) { let m = x.from.slice(0, 7); while (m <= x.to.slice(0, 7)) { months.add(m); const [y, mm] = m.split('-').map(Number); m = mm == 12 ? `${y + 1}-01` : `${y}-${p2(mm + 1)}` } }
        for (const m of [...months].sort()) { const k = 's' + m, doc = out[k] || docs[k] || { m, R: [], C: [], I: {}, L: [] }, f = Math.max(1, x.from && x.from.slice(0, 7) == m ? +x.from.slice(8) : 1), t = Math.min(mEnd(m), x.to && x.to.slice(0, 7) == m ? +x.to.slice(8) : 31);
          const keep = doc.L.filter(l => l[0] < f || l[0] > t), C = [], ci = {}, I = { ...doc.I }; const cix = n => ci[n] ?? (ci[n] = C.push(n) - 1);
          const L2 = keep.map(l => [l[0], l[1], cix(doc.C[l[2]] || ''), ...l.slice(3)]);
          (byM[m] || []).forEach(l => { I[l[3]] = l[4] || I[l[3]] || ''; L2.push([+l[0].slice(8), l[1], cix(l[2]), l[3], l[5], Math.round(l[6]), l[7], Math.round(l[8]), Math.round(l[9])]) });
          L2.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
          const R = [...doc.R, [f, t]].sort((a, b) => a[0] - b[0]), R2 = []; R.forEach(r => { const z = R2[R2.length - 1]; if (z && r[0] <= z[1] + 1) z[1] = Math.max(z[1], r[1]); else R2.push([...r]) });
          const CD = { ...(doc.CD || {}) }; if (!x.viaItem) for (let d = f; d <= t; d++) delete CD[d]; // 거래처가 있는 일별 자료가 오면 거래처 합계(임시)는 지움
          out[k] = { m, R: R2, C, I, L: L2, at: Date.now() }; if (Object.keys(CD).length) out[k].CD = CD;
          const nn = (byM[m] || []).length, amt = (byM[m] || []).reduce((s, l) => s + l[7], 0);
          log.push(`매출 ${m.slice(5)}/${f}~${m.slice(5)}/${t} · ${nn.toLocaleString()}줄 ${Math.round(amt).toLocaleString()}원 반영${keep.length ? ` (같은 달 다른 날 ${keep.length.toLocaleString()}줄은 그대로)` : ''}`) }
        if (est) log.push(`원가 열이 없는 자료라 ${est}줄은 최근 원가단가(이전 매출·재고)로 원가를 채웠습니다. 정확한 원가는 일별이익현황으로 올리면 바뀝니다.`);
        if (noCode) log.push(`품목코드가 없어 이름으로도 못 찾은 ${noCode}줄은 품목명을 코드 자리에 넣었습니다.`) }
      if (x.kind == 'item') { if (!x.from) { log.push('✗ 품목별 자료: 기간을 못 찾아 건너뜀 (엑셀 맨 위 회사명 줄에 기간이 있어야 합니다)'); continue }
        const m = x.from.slice(0, 7), to = x.to || x.from; if (to.slice(0, 7) != m) { log.push('✗ 품목별 자료: 두 달에 걸친 기간이라 건너뜀 (월별로 뽑아 주세요)'); continue }
        const sd = out['s' + m] || docs['s' + m], f1 = +x.from.slice(8), t1 = +to.slice(8);
        if (res.some(y => y.kind == 'sale' && !y.viaItem && y.from <= x.from && y.to >= to)) { log.push(`품목별 이익 ${x.from}~${to}: 같은 기간 일별이익현황을 같이 올려서 그쪽을 씀`); continue }
        if (x.from != to && sd && sd.R.some(r => r[0] <= f1 && r[1] >= t1)) { log.push(`품목별 이익 ${x.from}~${to}: 이 기간 일별 매출이 이미 있어 건너뜀 (하루치 품목별 파일이나 일별이익현황은 바로 반영됩니다)`); continue }
        if (!sd && f1 == 1) { out['p' + m] = { m, from: x.from, to, R: x.R, at: Date.now() }; log.push(`품목별 이익 ${x.from}~${to} · ${x.R.length}품목 → ${m} 월 합계로 반영`); continue }
        // 일별 매출에 그 기간을 품목별 줄로 넣음 (하루치면 그날 매출과 같음)
        const day = to, L = x.R.map(r => [day, 0, '(품목별이익현황)', r[0], r[1], r[2], r[2] ? r[3] / r[2] : 0, r[3], r[2] ? r[4] / r[2] : 0, r[4]]);
        res.push({ kind: 'sale', from: x.from, to, L, viaItem: 1 });
        log.push(`품목별 이익 ${x.from.slice(5).replace('-', '/')}~${to.slice(5).replace('-', '/')} · ${x.R.length}품목을 매출에 넣음${x.from != to ? ` (여러 날 합계라 ${to.slice(5).replace('-', '/')} 하루에 모아 넣음 — 날짜·거래처별로 보려면 일별이익현황으로 올려 주세요)` : ' (거래처는 일별이익현황을 올리면 채워짐)'}`) }
      if (x.kind == 'custday') { const m = x.date.slice(0, 7), k = 's' + m, doc = out[k] || docs[k]; if (!doc) { log.push('거래처 합계: 그 달 매출이 없어 건너뜀'); continue }
        out[k] = { ...doc, CD: { ...(doc.CD || {}), [+x.date.slice(8)]: x.R }, at: Date.now() }; log.push(`${x.date} 거래처별 합계 ${x.R.length}곳 반영 (품목은 따로)`); continue }
      if (x.kind == 'stock') { const d = x.date || TODAY, k = 't' + d, doc = out[k] || docs[k] || { d, W: {} }; const Wn = { ...doc.W };
        Object.entries(x.W).forEach(([w, rows]) => { Wn[w] = rows; log.push(`재고 ${d} ${w} · ${rows.length}품목 ${rows.reduce((s, r) => s + r[2], 0).toLocaleString()}개 반영${x.date ? '' : ' (기준일을 못 찾아 오늘 날짜로)'}`) });
        out[k] = { d, W: Wn, at: Date.now() } } }
    return out },

  /* 파일 → 읽기 → 저장소 문서 불러와 합치기 → 저장. opt: {pw, key, quiet} */
  async ingest(files, opt = {}) { const log = [], res = [], api = '/api/store?ns=erp';
    for (let i = 0; i < 50 && !G.XLSX; i++) await new Promise(r => setTimeout(r, 200));
    if (!G.XLSX) throw new Error('엑셀 읽기 도구를 불러오지 못했습니다');
    for (const f of files) { let n = 0, why = [];
      try { const wb = G.XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
        for (const sn of wb.SheetNames) { const A = G.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null }); const x = ECP.sheet(A, f.name, sn); if (x.kind) { res.push(x); n++ } else why.push(`${sn}: ${x.why}`) } }
      catch (e) { why.push(e.message) }
      if (!n && !opt.quiet) log.push(`✗ ${f.name}: 이카운트 매출·재고 양식으로 읽지 못했습니다 — ${why.join(' / ')}`) }
    if (!res.length) return { log, n: 0 };
    const H = { 'content-type': 'application/json', 'x-team-key': opt.key || '', 'x-admin-key': encodeURIComponent(opt.pw || '') };
    const { keys } = await fetch(api, { cache: 'no-store', headers: H }).then(r => r.json());
    const want = keys.filter(k => k[0] == 's').concat(keys.filter(k => k[0] == 't').sort().slice(-1));
    res.forEach(x => { if (x.kind == 'stock') { const k = 't' + (x.date || TODAY); if (keys.includes(k) && !want.includes(k)) want.push(k) } });
    const docs = want.length ? (await fetch(api + '&k=' + want.join(','), { cache: 'no-store', headers: H }).then(r => r.json())).docs : {};
    const out = ECP.apply(res, docs, log);
    const r = await fetch(api, { method: 'PUT', headers: H, body: JSON.stringify({ docs: out }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error(j.msg || '저장하지 못했습니다'), { status: r.status }) }
    return { log, out, n: Object.keys(out).length } }
};
G.ECP = ECP;
})(typeof window != 'undefined' ? window : globalThis);
