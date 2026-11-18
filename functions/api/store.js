// 쿠팡 광고 장부 공용 저장소 (Cloudflare Pages Functions + KV)
// 필요한 설정: KV 바인딩 이름 DB. (선택) 환경변수 TEAM_PASSWORD를 넣으면 비밀번호로 잠김, 없으면 누구나 공용
// ?admin=status|set|check  운영자 비밀번호 (설정 탭·전체 삭제 보호)
// ?ns=memo                 회의록 폴더 (브라우저에서 암호화된 내용만 저장, 수정·삭제는 그 폴더 비밀번호 필요)
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const ok = k => /^(cfg|wk|dl|y\d{4}|m\d{4}-\d{2}|d\d{4}-\d{2}-\d{2})$/.test(k);
const okMemo = k => /^v[a-z0-9]{4,32}$/.test(k);
const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
const ADM = 'sys:admin';
const adminOk = async (env, pw) => { const a = await env.DB.get(ADM, 'json'); return !!(a && pw && await sha(a.salt + pw) === a.h); };
const body = async request => { try { return await request.json(); } catch { return null; } };
const decode = s => { try { return decodeURIComponent(s || ''); } catch { return ''; } };

export async function onRequest({ request, env }) {
  const url = new URL(request.url), qp = url.searchParams;
  const ch = qp.get('ch') === 'nv' ? 'nv:' : '';
  if (!env.DB) return json({ error: 'no_kv' }, 503);
  if (env.TEAM_PASSWORD && (request.headers.get('x-team-key') || '') !== env.TEAM_PASSWORD) return json({ error: 'auth' }, 401);

  /* 운영자 비밀번호 */
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
        if (await sha('vh:' + cur.salt + key) !== cur.vh) return json({ error: 'vault' }, 403);
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
    // 전체 삭제처럼 여러 문서를 한 번에 지우거나 설정(cfg)을 지우는 요청은 운영자만
    const dels = Object.entries(docs).filter(([k, v]) => ok(k) && v === null).map(([k]) => k);
    if ((b.wipe || dels.length >= 3 || dels.includes('cfg')) && !await adminOk(env, decode(request.headers.get('x-admin-key')))) return json({ error: 'admin' }, 403);
    for (const [k, v] of Object.entries(docs)) {
      if (!ok(k)) continue;
      if (v === null) await env.DB.delete(P + k);
      else await env.DB.put(P + k, JSON.stringify(v));
    }
    return json({ ok: true, at: Date.now() });
  }
  return json({ error: 'method' }, 405);
}
