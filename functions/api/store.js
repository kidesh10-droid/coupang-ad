// 쿠팡 광고 장부 공용 저장소 (Cloudflare Pages Functions + KV)
// 필요한 설정: KV 바인딩 이름 DB. (선택) 환경변수 TEAM_PASSWORD를 넣으면 비밀번호로 잠김, 없으면 누구나 공용
// ?admin=status|set|check  관리자 비밀번호 (설정 탭·전체 삭제 보호)
// ?ns=src                  소싱 (보기 누구나, 올리기·AI·삭제 관리자)
// ?ns=ev                   행사 기록 (입력 누구나, 삭제 관리자)
// ?ns=erp                  ERP 자료 (보기 누구나, 쓰기 관리자)
// ?ns=memo                 회의록 폴더 (브라우저에서 암호화된 내용만 저장, 수정·삭제는 그 폴더 비밀번호 필요)
import '../../scripts/erp_ecp.js'; // globalThis.ECP (이카운트 자료 합치기, 화면과 같은 코드)
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const ok = k => /^(cfg|wk|dl|y\d{4}|m\d{4}-\d{2}|d\d{4}-\d{2}-\d{2})$/.test(k);
const okMemo = k => /^v[a-z0-9]{4,32}$/.test(k);
const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
const ADM = 'sys:admin';
const GAP = 10 * 60e3, KEEP = 30 * 86400; // 버전 간격 10분 · 보관 30일
/* 덩어리 삭제 판단: 주차·품목 줄·일별 시트·이카운트/광고 자료·배송비 기준표가 줄면 삭제로 봄 */
const units = (k, v) => {
  if (!v) return null;
  if (k === 'wk') { const w = v.wk || {}; return { a: Object.keys(w).length, b: Object.values(w).reduce((s, x) => s + ((x && x.rows) || []).length, 0) }; }
  if (k === 'dl') return { a: ((v.dl && v.dl.blocks) || []).length, b: 0 };
  if (k[0] === 'm' || k[0] === 'd') { const o = v.mon || v.day || {}; return { a: (o.ec ? 1 : 0) + (o.ad ? 1 : 0), b: 0 }; }
  if (k === 'cfg') return { a: Object.keys(v.ship || {}).length, b: 0 };
  return null;
};
const shrinks = (k, cur, v) => { const a = units(k, cur), b = units(k, v); return !!(a && b && (b.a < a.a || b.b < a.b)); };
async function snap(env, ch, k, cur, force, why) {
  const ix = (await env.DB.get('histidx:' + ch, 'json')) || {}, now = Date.now();
  if (!force && ix[k] && now - ix[k] < GAP) return;
  await env.DB.put('hist:' + ch + String(now).padStart(14, '0') + ':' + k, JSON.stringify(cur === null ? { __none: 1 } : cur), { expirationTtl: KEEP, metadata: { k, ts: now, why: why || 'auto' } });
  ix[k] = now; await env.DB.put('histidx:' + ch, JSON.stringify(ix));
}
async function histList(env, ch) {
  const out = []; let cursor;
  do { const l = await env.DB.list({ prefix: 'hist:' + ch, cursor }); l.keys.forEach(x => { const m = x.name.slice(('hist:' + ch).length).match(/^(\d{14}):(.+)$/); if (m) out.push({ name: x.name, ts: +m[1], k: m[2], why: (x.metadata && x.metadata.why) || 'auto' }); }); cursor = l.list_complete ? null : l.cursor; } while (cursor);
  return out.sort((a, b) => a.ts - b.ts);
}
const adminOk = async (env, pw) => { const a = await env.DB.get(ADM, 'json'); return !!(a && pw && await sha(a.salt + pw) === a.h); };
const body = async request => { try { return await request.json(); } catch { return null; } };
const decode = s => { try { return decodeURIComponent(s || ''); } catch { return ''; } };

export async function onRequest({ request, env }) {
  const url = new URL(request.url), qp = url.searchParams;
  const ch = qp.get('ch') === 'nv' ? 'nv:' : '';
  if (!env.DB) return json({ error: 'no_kv' }, 503);
  if (env.TEAM_PASSWORD && (request.headers.get('x-team-key') || '') !== env.TEAM_PASSWORD) return json({ error: 'auth' }, 401);

  /* 관리자 비밀번호 */
  const adm = qp.get('admin');
  if (adm) {
    const a = await env.DB.get(ADM, 'json');
    if (adm === 'status') return json({ set: !!a });
    if (request.method !== 'POST') return json({ error: 'method' }, 405);
    const b = await body(request) || {};
    if (adm === 'check') return json({ ok: await adminOk(env, b.pw) });
    if (adm === 'set') {
      if (!b.pw || String(b.pw).length < 4) return json({ error: 'short' }, 400);
      if (a && !await adminOk(env, b.old)) return json({ error: 'admin' }, 403);
      const salt = crypto.randomUUID();
      await env.DB.put(ADM, JSON.stringify({ salt, h: await sha(salt + b.pw), at: Date.now() }));
      return json({ ok: true });
    }
    return json({ error: 'bad' }, 400);
  }

  /* 버전 기록 · 복구 (관리자만) */
  const hq = qp.get('hist');
  if (hq) {
    if (!await adminOk(env, decode(request.headers.get('x-admin-key')))) return json({ error: 'admin' }, 403);
    const L = await histList(env, ch);
    if (hq === 'list') return json({ items: L.map(x => ({ ts: x.ts, k: x.k, why: x.why })) });
    if (hq === 'restore' && request.method === 'POST') {
      const b = await body(request) || {}, T = +b.ts; if (!T) return json({ error: 'bad' }, 400);
      const pick = {}; for (const x of L) if (x.ts >= T && !pick[x.k]) pick[x.k] = x; // 그 시점 이후 첫 기록 = 그 시점의 내용
      let n = 0;
      for (const [k, x] of Object.entries(pick)) {
        const v = await env.DB.get(x.name, 'json'), cur = await env.DB.get(ch + 'doc:' + k, 'json');
        await snap(env, ch, k, cur, true, 'restore'); // 복구 직전 상태도 남김 → 복구 취소 가능
        if (!v || v.__none) await env.DB.delete(ch + 'doc:' + k); else await env.DB.put(ch + 'doc:' + k, JSON.stringify(v));
        n++;
      }
      return json({ ok: true, docs: n });
    }
    return json({ error: 'bad' }, 400);
  }

  /* 소싱 (?ns=src) — 보기·올리기·AI 소싱은 누구나, 삭제는 관리자 */
  if (qp.get('ns') === 'src') {
    const LK = 'src:doc:list', okId = id => /^[a-z0-9]{6,40}$/.test(id || '');
    const img = qp.get('img');
    if (request.method === 'GET') {
      if (img) { if (!okId(img)) return new Response('', { status: 400 }); const v = await env.DB.get('src:img:' + img); if (!v) return new Response('', { status: 404 });
        const m = v.match(/^data:([^;]+);base64,(.*)$/); if (!m) return new Response('', { status: 404 });
        const bin = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)); return new Response(bin, { headers: { 'content-type': m[1], 'cache-control': 'public, max-age=31536000, immutable' } }); }
      let L = await env.DB.get(LK, 'json');
      if (!L && !(await env.DB.get('src:seeded')) && env.ASSETS) { try { const r = await env.ASSETS.fetch(new URL('/sourcing/seed.json', url.origin)); if (r.ok) { L = (await r.json()).batches || []; await env.DB.put(LK, JSON.stringify(L)) } } catch (e) { } await env.DB.put('src:seeded', '1') }
      // 자동 소싱 결과: 배포에 들어온 sourcing/apply.json 배치를 id마다 한 번만 추가
      if (env.ASSETS) { try { const r = await env.ASSETS.fetch(new URL('/sourcing/apply.json', url.origin)); const A = r.ok ? await r.json() : null;
        if (A && A.batch && okId(A.batch.id) && !(await env.DB.get('src:applied:' + A.batch.id))) { await env.DB.put('src:applied:' + A.batch.id, '1'); L = (L || []).filter(y => y.id !== A.batch.id).concat([A.batch]); await env.DB.put(LK, JSON.stringify(L)) } } catch (e) { } }
      return json({ batches: L || [], ai: !!env.ANTHROPIC_API_KEY, at: Date.now() });
    }
    const srcAdm = () => adminOk(env, decode(request.headers.get('x-admin-key'))); // 보기·올리기·AI 소싱은 누구나, 삭제·기준 저장만 관리자
    if (qp.get('run') && request.method === 'POST') { // AI 소싱: Claude API(웹 검색) 응답을 그대로 흘려보냄 → 화면이 받아서 저장
      if (!env.ANTHROPIC_API_KEY) return json({ error: 'nokey', msg: 'AI 소싱을 쓰려면 Cloudflare Pages 환경변수에 ANTHROPIC_API_KEY를 넣어야 합니다' }, 501);
      const b = await body(request) || {};
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'web-fetch-2025-09-10' },
        body: JSON.stringify({ model: env.SOURCING_MODEL || 'claude-sonnet-5-5', max_tokens: 32000, stream: true, system: String(b.system || '').slice(0, 20000),
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: Math.min(40, +b.searches || 25) }, { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: Math.min(40, +b.fetches || 25) }],
          messages: [{ role: 'user', content: String(b.prompt || '').slice(0, 20000) }] }) });
      if (!r.ok) { const t = await r.text(); return json({ error: 'api', msg: 'Claude API 오류 ' + r.status + ': ' + t.slice(0, 300) }, 502) }
      return new Response(r.body, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' } });
    }
    if (request.method !== 'PUT') return json({ error: 'method' }, 405);
    const b = await body(request); if (!b) return json({ error: 'bad_json' }, 400);
    const L = (await env.DB.get(LK, 'json')) || [];
    const keep = async L2 => { await env.DB.put('hist:src:' + String(Date.now()).padStart(14, '0') + ':list', JSON.stringify(L), { expirationTtl: KEEP, metadata: { k: 'list', ts: Date.now(), why: 'up' } }); await env.DB.put(LK, JSON.stringify(L2)); return json({ ok: true, batches: L2 }) };
    if (b.op === 'add') { const x = b.batch || {}; if (!okId(x.id) || !Array.isArray(x.items)) return json({ error: 'bad' }, 400);
      let n = 0; for (const it of x.items) { if (typeof it.img === 'string' && it.img.startsWith('data:image/')) { const id = x.id + 'i' + (n++); await env.DB.put('src:img:' + id, it.img); it.img = '/api/store?ns=src&img=' + id } }
      const L2 = L.filter(y => y.id !== x.id).concat([{ ...x, at: x.at || Date.now() }]); if (JSON.stringify(L2).length > 20e6) return json({ error: 'big' }, 413); return keep(L2) }
    if ((b.op === 'del' || b.op === 'plan') && !await srcAdm()) return json({ error: 'admin', msg: '소싱 자료 삭제는 관리자만 할 수 있습니다' }, 403);
    if (b.op === 'del') { const x = L.find(y => y.id === b.id); if (x) for (const it of x.items || []) { const m = String(it.img || '').match(/img=([a-z0-9]+)/); if (m) await env.DB.delete('src:img:' + m[1]) } return keep(L.filter(y => y.id !== b.id)) }
    if (b.op === 'plan') { const x = L.find(y => y.id === b.id); if (!x) return json({ error: 'none' }, 404); x.cfg = { ...x.cfg, ...(b.cfg || {}) }; if (b.plans) x.items.forEach(it => { if (b.plans[it.cat] != null) it.plan = +b.plans[it.cat] }); return keep(L) }
    return json({ error: 'bad' }, 400);
  }

  /* 행사 기록 (?ns=ev) — 입력·수정·이미지 추가는 누구나, 행사 삭제·이미지 빼기는 관리자 */
  if (qp.get('ns') === 'ev') {
    const LK = 'ev:doc:list', okId = id => /^[a-z0-9]{6,32}$/.test(id || '');
    const img = qp.get('img');
    if (request.method === 'GET') {
      if (img) { if (!okId(img)) return json({ error: 'bad' }, 400); const v = await env.DB.get('ev:img:' + img, 'json'); return v ? json(v) : json({ error: 'none' }, 404); }
      return json({ list: (await env.DB.get(LK, 'json')) || [], at: Date.now() });
    }
    if (request.method !== 'PUT') return json({ error: 'method' }, 405);
    const b = await body(request); if (!b) return json({ error: 'bad_json' }, 400);
    const isAdm = () => adminOk(env, decode(request.headers.get('x-admin-key')));
    if (img) {
      if (!okId(img) || !b.d || !/^data:image\//.test(b.d)) return json({ error: 'bad' }, 400);
      if (b.d.length > 20e6) return json({ error: 'big', msg: '이미지가 너무 큽니다' }, 413);
      if (await env.DB.get('ev:img:' + img)) return json({ error: 'exists' }, 409);
      await env.DB.put('ev:img:' + img, JSON.stringify({ d: b.d, name: String(b.name || '').slice(0, 120), at: Date.now() }));
      return json({ ok: true });
    }
    const list = (await env.DB.get(LK, 'json')) || [];
    const save = async (L, why) => { await env.DB.put('hist:ev:' + String(Date.now()).padStart(14, '0') + ':list', JSON.stringify(list), { expirationTtl: KEEP, metadata: { k: 'list', ts: Date.now(), why } }); await env.DB.put(LK, JSON.stringify(L)); return json({ ok: true, list: L, at: Date.now() }); };
    if (b.op === 'upsert') {
      const e = b.ev || {}; if (!okId(e.id)) return json({ error: 'bad' }, 400);
      const i = list.findIndex(x => x.id === e.id), cur = i >= 0 ? list[i] : null;
      const gone = cur ? (cur.imgs || []).filter(x => !(e.imgs || []).some(y => y.id === x.id)) : [];
      if (gone.length && !await isAdm()) return json({ error: 'admin', msg: '이미지 삭제는 관리자만 할 수 있습니다' }, 403);
      for (const g of gone) await env.DB.delete('ev:img:' + g.id);
      const L = list.slice(); const v = { ...e, ut: Date.now() }; if (i >= 0) L[i] = v; else L.push(v);
      if (JSON.stringify(L).length > 20e6) return json({ error: 'big' }, 413);
      return save(L, 'auto');
    }
    if (b.op === 'bulk') { // 엑셀로 여러 행사 한 번에 (같은 id는 고침, 이미지는 건드리지 않음)
      if (!Array.isArray(b.evs) || b.evs.length > 2000) return json({ error: 'bad' }, 400);
      const L = list.slice();
      for (const e of b.evs) { if (!e || !okId(e.id)) continue; const i = L.findIndex(x => x.id === e.id); const v = { ...e, imgs: i >= 0 ? (L[i].imgs || []) : [], ut: Date.now() }; if (i >= 0) L[i] = v; else L.push(v) }
      if (JSON.stringify(L).length > 20e6) return json({ error: 'big' }, 413);
      return save(L, 'up');
    }
    if (b.op === 'addimgs') { // 이미지 추가는 기존 목록에 덧붙이기만 (동시에 올려도 서로 안 지움)
      if (!okId(b.id) || !Array.isArray(b.imgs)) return json({ error: 'bad' }, 400);
      const L = list.slice(); let i = L.findIndex(x => x.id === b.id);
      if (i < 0) { if (b.id !== 'gallerylibrary') return json({ error: 'none' }, 404); L.push({ id: b.id, lib: 1, name: '이미지 보관함', imgs: [] }); i = L.length - 1 }
      const have = new Set((L[i].imgs || []).map(x => x.id));
      L[i] = { ...L[i], imgs: [...(L[i].imgs || []), ...b.imgs.filter(x => x && okId(x.id) && !have.has(x.id)).map(x => ({ id: x.id, name: String(x.name || '').slice(0, 120), at: +x.at || Date.now() }))], ut: Date.now() };
      return save(L, 'auto');
    }
    if (b.op === 'del') {
      if (!await isAdm()) return json({ error: 'admin', msg: '행사 삭제는 관리자만 할 수 있습니다' }, 403);
      const cur = list.find(x => x.id === b.id); if (!cur) return json({ ok: true, list });
      for (const g of (cur.imgs || [])) await env.DB.delete('ev:img:' + g.id);
      return save(list.filter(x => x.id !== b.id), 'del');
    }
    return json({ error: 'bad' }, 400);
  }

  /* ERP (이카운트 자료: 매출·재고) — 보기는 누구나, 올리기·고치기·지우기는 관리자만 */
  if (qp.get('ns') === 'erp') {
    const P = 'erp:doc:', okE = k => /^(cfg|s\d{4}-\d{2}|p\d{4}-\d{2}|t\d{4}-\d{2}-\d{2})$/.test(k);
    if (request.method === 'GET') {
      let names = []; let cursor;
      do { const l = await env.DB.list({ prefix: P, cursor }); l.keys.forEach(x => names.push(x.name.slice(P.length))); cursor = l.list_complete ? null : l.cursor; } while (cursor);
      // 처음 한 번: 배포에 들어 있는 기본 자료(erp/seed.json)를 넣어 둠
      if (!names.length && !(await env.DB.get('erp:seeded')) && env.ASSETS) {
        try {
          const r = await env.ASSETS.fetch(new URL('/erp/seed.json', url.origin));
          if (r.ok) { const S = await r.json(); for (const [k, v] of Object.entries(S.docs || {})) if (okE(k)) { await env.DB.put(P + k, JSON.stringify(v)); names.push(k); } }
        } catch (e) { }
        await env.DB.put('erp:seeded', '1');
      }
      // 받은 파일을 직접 반영해야 할 때: 배포에 넣은 erp/apply.json(읽은 결과)을 id마다 한 번만 합침
      if (!qp.get('k') && env.ASSETS && globalThis.ECP) {
        try {
          const r = await env.ASSETS.fetch(new URL('/erp/apply.json', url.origin));
          const A = r.ok ? await r.json() : null;
          if (A && A.id && !(await env.DB.get('erp:applied:' + A.id))) {
            await env.DB.put('erp:applied:' + A.id, 'running');
            const need = names.filter(k => k[0] === 's' || k[0] === 't'), docs = {};
            for (const k of need) docs[k] = await env.DB.get(P + k, 'json');
            const log = [], pre = {}, orig = {}; for (const k of need) if (docs[k]) orig[k] = JSON.stringify(docs[k]);
            if (A.supply) for (const k of need) if (k[0] === 's' && docs[k]) { const n = globalThis.ECP.toSupply(docs[k]); if (n) { pre[k] = docs[k]; log.push(k + ' 공급가로 ' + n + '줄') } }
            const out = Object.assign(pre, globalThis.ECP.apply(A.res || [], docs, log));
            for (const k of (A.del || [])) if (names.includes(k)) out[k] = null;
            for (const [k, v] of Object.entries(out)) {
              if (!okE(k)) continue;
              if (orig[k]) await env.DB.put('hist:erp:' + String(Date.now()).padStart(14, '0') + ':' + k, orig[k], { expirationTtl: KEEP, metadata: { k, ts: Date.now(), why: 'up' } });
              if (v === null) { await env.DB.delete(P + k); names = names.filter(x => x !== k); continue }
              await env.DB.put(P + k, JSON.stringify(v)); if (!names.includes(k)) names.push(k);
            }
            await env.DB.put('erp:applied:' + A.id, JSON.stringify({ at: Date.now(), log }));
          }
        } catch (e) { }
      }
      const want = qp.get('k');
      if (!want) return json({ keys: names.sort(), at: Date.now() });
      const docs = {};
      await Promise.all(want.split(',').filter(okE).map(async k => { docs[k] = await env.DB.get(P + k, 'json'); }));
      return json({ docs, at: Date.now() });
    }
    if (request.method === 'PUT') {
      if (!await adminOk(env, decode(request.headers.get('x-admin-key')))) return json({ error: 'admin', msg: 'ERP 자료는 관리자만 올리거나 고칠 수 있습니다' }, 403);
      const b = await body(request); if (!b) return json({ error: 'bad_json' }, 400);
      for (const [k, v] of Object.entries(b.docs || {})) {
        if (!okE(k)) continue;
        const cur = await env.DB.get(P + k, 'json');
        if (cur) await env.DB.put('hist:erp:' + String(Date.now()).padStart(14, '0') + ':' + k, JSON.stringify(cur), { expirationTtl: KEEP, metadata: { k, ts: Date.now(), why: v === null ? 'del' : 'up' } });
        if (v === null) await env.DB.delete(P + k); else await env.DB.put(P + k, JSON.stringify(v));
      }
      return json({ ok: true, at: Date.now() });
    }
    return json({ error: 'method' }, 405);
  }

  /* 회의록 (암호문만 저장) */
  if (qp.get('ns') === 'memo') {
    const P = 'memo:';
    if (request.method === 'GET') {
      const docs = {};
      let cursor;
      do {
        const list = await env.DB.list({ prefix: P, cursor });
        await Promise.all(list.keys.map(async k => { const v = await env.DB.get(k.name, 'json'); if (v) { delete v.vh; docs[k.name.slice(P.length)] = v; } }));
        cursor = list.list_complete ? null : list.cursor;
      } while (cursor);
      return json({ docs, at: Date.now() });
    }
    if (request.method === 'PUT') {
      const b = await body(request);
      if (!b || !b.id || !okMemo(b.id)) return json({ error: 'bad' }, 400);
      const cur = await env.DB.get(P + b.id, 'json');
      if (cur) {
        const key = decode(request.headers.get('x-vault-key'));
        // 폴더 비밀번호가 맞거나, 관리자가 폴더를 지우는 경우(내용은 암호라 관리자도 못 읽음)
        const adminDel = b.doc === null && await adminOk(env, decode(request.headers.get('x-admin-key')));
        if (!adminDel && await sha('vh:' + cur.salt + key) !== cur.vh) return json({ error: 'vault' }, 403);
      }
      if (b.doc === null) { await env.DB.delete(P + b.id); return json({ ok: true }); }
      const d = b.doc || {};
      if (!d.salt || !d.iv || !d.ct || !d.vh) return json({ error: 'bad' }, 400);
      if (JSON.stringify(d).length > 20e6) return json({ error: 'big' }, 413);
      await env.DB.put(P + b.id, JSON.stringify({ name: String(d.name || '').slice(0, 60), salt: d.salt, iv: d.iv, ct: d.ct, vh: d.vh, ts: Date.now() }));
      return json({ ok: true, ts: Date.now() });
    }
    return json({ error: 'method' }, 405);
  }

  const P = ch + 'doc:';
  if (request.method === 'GET') {
    const docs = {};
    let cursor;
    do {
      const list = await env.DB.list({ prefix: P, cursor });
      await Promise.all(list.keys.map(async k => { docs[k.name.slice(P.length)] = await env.DB.get(k.name, 'json'); }));
      cursor = list.list_complete ? null : list.cursor;
    } while (cursor);
    return json({ docs, at: Date.now() });
  }

  if (request.method === 'PUT') {
    const b = await body(request);
    if (!b) return json({ error: 'bad_json' }, 400);
    const docs = b.docs || {};
    // 전체 삭제처럼 여러 문서를 한 번에 지우거나 설정(cfg)을 지우는 요청은 관리자만
    const ks = Object.keys(docs).filter(ok), curs = {};
    await Promise.all(ks.map(async k => { curs[k] = await env.DB.get(P + k, 'json'); }));
    // 입력·수정은 누구나, 삭제(문서 삭제·덩어리로 줄어드는 저장)는 관리자만
    const isDel = b.wipe || ks.some(k => (docs[k] === null && curs[k] != null) || shrinks(k, curs[k], docs[k]));
    if (isDel && !await adminOk(env, decode(request.headers.get('x-admin-key')))) return json({ error: 'admin', msg: '삭제는 관리자만 할 수 있습니다' }, 403);
    for (const k of ks) {
      const v = docs[k], cur = curs[k];
      if (v === null && cur == null) continue;
      await snap(env, ch, k, cur, v === null || isDel || !!b.snap, isDel || v === null ? 'del' : b.snap ? 'up' : 'auto'); // 10분에 한 번 · 삭제·파일 업로드 직전은 항상 기록
      if (v === null) await env.DB.delete(P + k);
      else await env.DB.put(P + k, JSON.stringify(v));
    }
    return json({ ok: true, at: Date.now() });
  }
  return json({ error: 'method' }, 405);
}
