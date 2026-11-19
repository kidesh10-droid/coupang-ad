// 쿠팡 광고 장부 공용 저장소 (Cloudflare Pages Functions + KV)
// 필요한 설정: KV 바인딩 이름 DB. (선택) 환경변수 TEAM_PASSWORD를 넣으면 비밀번호로 잠김, 없으면 누구나 공용
// ?admin=status|set|check  관리자 비밀번호 (설정 탭·전체 삭제 보호)
// ?ns=memo                 회의록 폴더 (브라우저에서 암호화된 내용만 저장, 수정·삭제는 그 폴더 비밀번호 필요)
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
