// 쿠팡 광고 장부 공용 저장소 (Cloudflare Pages Functions + KV)
// 필요한 설정: KV 바인딩 이름 DB. (선택) 환경변수 TEAM_PASSWORD를 넣으면 비밀번호로 잠김, 없으면 누구나 공용
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const ok = k => /^(cfg|wk|dl|y\d{4}|m\d{4}-\d{2}|d\d{4}-\d{2}-\d{2})$/.test(k);

export async function onRequest({ request, env }) {
  const ch = new URL(request.url).searchParams.get('ch') === 'nv' ? 'nv:' : '';
  const P = ch + 'doc:';
  if (!env.DB) return json({ error: 'no_kv' }, 503);
  if (env.TEAM_PASSWORD && (request.headers.get('x-team-key') || '') !== env.TEAM_PASSWORD) return json({ error: 'auth' }, 401);

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
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
    const docs = body && body.docs || {};
    for (const [k, v] of Object.entries(docs)) {
      if (!ok(k)) continue;
      if (v === null) await env.DB.delete(P + k);
      else await env.DB.put(P + k, JSON.stringify(v));
    }
    return json({ ok: true, at: Date.now() });
  }
  return json({ error: 'method' }, 405);
}
