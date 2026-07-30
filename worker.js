/* Cortadito Games — stats worker.
   Handles /a/* (anonymous event beacons) and /admin* (password-protected
   analytics dashboard). Everything else falls through to static assets.
   Storage: D1 (binding DB). No cookies/IDs beyond a random localStorage uuid
   the games send — no personal data, matching the "todo vive en tu navegador"
   promise. */

const PW_HASH = "8956b6712e73ae8e7a9760a34096f3c8b879c5eef5d6ccee8f89c45acf274e9f"; // sha256("cortadito-admin:" + password)
const COOKIE = "cg_admin";

let dbReady = false;
async function initDB(env) {
  if (dbReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      day TEXT NOT NULL,
      uid TEXT NOT NULL,
      game TEXT NOT NULL,
      mode TEXT,
      ev TEXT NOT NULL,
      dur INTEGER,
      data TEXT
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_ev_day ON events(day)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_ev_uid ON events(uid)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_ev_game ON events(game, ev)`),
  ]);
  dbReady = true;
}

function etDay(ts) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
  } catch (e) { return new Date(ts).toISOString().slice(0, 10); }
}

async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function authed(request) {
  const c = request.headers.get("Cookie") || "";
  const m = c.match(new RegExp(COOKIE + "=([a-f0-9]{64})"));
  return !!(m && m[1] === PW_HASH);
}

const GAMES = ["racimo", "palabreo", "sudoku", "flechas", "hub"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

    try {
      // ---------- beacon ingest ----------
      if (p === "/a/e" && request.method === "POST") {
        await initDB(env);
        let body;
        try { body = await request.json(); } catch (e) { return new Response("bad", { status: 400 }); }
        const uid = String(body.uid || "").slice(0, 40);
        const evts = Array.isArray(body.evts) ? body.evts.slice(0, 20) : [];
        if (!uid || !evts.length) return new Response("empty", { status: 400 });
        const stmts = [];
        const ins = env.DB.prepare(
          "INSERT INTO events (ts, day, uid, game, mode, ev, dur, data) VALUES (?,?,?,?,?,?,?,?)");
        for (const e of evts) {
          const ts = Number(e.ts) || Date.now();
          const game = String(e.game || "hub").slice(0, 24).toLowerCase();
          const ev = String(e.ev || "").slice(0, 24);
          if (!["view", "session", "snapshot", "start", "finish", "fail", "hint", "custom"].includes(ev)) continue;
          let dur = Number(e.dur);
          if (!Number.isFinite(dur) || dur < 0 || dur > 14400) dur = null;
          const mode = e.mode ? String(e.mode).slice(0, 32) : null;
          const data = e.data ? String(e.data).slice(0, 48000) : null;
          stmts.push(ins.bind(ts, etDay(ts), uid, game, mode, ev, dur, data));
        }
        if (stmts.length) await env.DB.batch(stmts);
        return new Response("ok", { status: 202 });
      }

      // ---------- admin auth ----------
      if (p === "/admin/login" && request.method === "POST") {
        const form = await request.formData();
        const pw = String(form.get("pw") || "");
        const h = await sha256hex("cortadito-admin:" + pw);
        if (h === PW_HASH) {
          return new Response(null, { status: 302, headers: {
            "Location": "/admin",
            "Set-Cookie": `${COOKIE}=${h}; Path=/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
          }});
        }
        return new Response(loginPage(true), { status: 401, headers: { "Content-Type": "text/html;charset=utf-8" } });
      }
      if (p === "/admin/logout") {
        return new Response(null, { status: 302, headers: {
          "Location": "/admin", "Set-Cookie": `${COOKIE}=; Path=/admin; Max-Age=0` } });
      }

      if (p === "/admin" || p.startsWith("/admin/")) {
        if (!authed(request)) {
          return new Response(loginPage(false), { headers: { "Content-Type": "text/html;charset=utf-8" } });
        }
        await initDB(env);
        if (p === "/admin" || p === "/admin/") {
          return new Response(dashPage(), { headers: { "Content-Type": "text/html;charset=utf-8" } });
        }
        if (p === "/admin/api/summary") return summary(env, url);
        if (p === "/admin/api/recent") return recent(env, url);
        if (p === "/admin/api/export.csv") return exportCsv(env, url);
        return new Response("not found", { status: 404 });
      }
    } catch (err) {
      return new Response("err: " + (err && err.message), { status: 500 });
    }

    // ---------- everything else: static assets ----------
    return env.ASSETS.fetch(request);
  }
};

// ============ queries ============

function sinceDay(url) {
  const days = Math.min(365, Math.max(1, Number(new URL(url).searchParams.get("days")) || 14));
  const since = etDay(Date.now() - (days - 1) * 86400000);
  return { days, since };
}

async function summary(env, url) {
  const { days, since } = sinceDay(url);
  const today = etDay(Date.now());

  const [tiles, perGame, daily, snaps] = await Promise.all([
    env.DB.prepare(`SELECT
        (SELECT COUNT(DISTINCT uid) FROM events WHERE day = ?1) AS players_today,
        (SELECT COUNT(*) FROM events WHERE day = ?1 AND ev = 'session') AS sessions_today,
        (SELECT COALESCE(SUM(dur),0) FROM events WHERE day = ?1 AND ev = 'session') AS seconds_today,
        (SELECT COUNT(DISTINCT uid) FROM events WHERE day >= ?2) AS players_range,
        (SELECT COUNT(*) FROM events WHERE day >= ?2 AND ev = 'session') AS sessions_range,
        (SELECT COALESCE(SUM(dur),0) FROM events WHERE day >= ?2 AND ev = 'session') AS seconds_range
      `).bind(today, since).first(),
    env.DB.prepare(`SELECT game,
        COUNT(DISTINCT uid) AS players,
        SUM(CASE WHEN ev='view' THEN 1 ELSE 0 END) AS views,
        SUM(CASE WHEN ev='session' THEN 1 ELSE 0 END) AS sessions,
        COALESCE(SUM(CASE WHEN ev='session' THEN dur ELSE 0 END),0) AS seconds
      FROM events WHERE day >= ? GROUP BY game ORDER BY sessions DESC`).bind(since).all(),
    env.DB.prepare(`SELECT day,
        COUNT(DISTINCT uid) AS players,
        SUM(CASE WHEN ev='session' THEN 1 ELSE 0 END) AS sessions,
        COALESCE(SUM(CASE WHEN ev='session' THEN dur ELSE 0 END),0) AS seconds
      FROM events WHERE day >= ? GROUP BY day ORDER BY day`).bind(since).all(),
    env.DB.prepare(`SELECT uid, data FROM events e WHERE ev='snapshot' AND id =
        (SELECT MAX(id) FROM events WHERE ev='snapshot' AND uid = e.uid) LIMIT 500`).all(),
  ]);

  // parse snapshots for streak-like numbers per game prefix
  const rachas = {};   // game -> {active:n, max:n}
  for (const row of (snaps.results || [])) {
    let snap; try { snap = JSON.parse(row.data); } catch (e) { continue; }
    if (!snap || typeof snap !== "object") continue;
    for (const [k, v] of Object.entries(snap)) {
      const g = GAMES.find(g => k.toLowerCase().includes(g)) ||
                (/(clasico|trenza|cuarteto|palabra)/.test(k) ? "palabreo" : null) ||
                (/(cascada|desvio|rumbo|flujo|borde)/.test(k) ? "flechas" : null);
      let obj; try { obj = JSON.parse(v); } catch (e) { obj = null; }
      if (!obj || typeof obj !== "object" || !g) continue;
      for (const [f, val] of Object.entries(obj)) {
        if (/(racha|streak)/i.test(f) && typeof val === "number" && val > 0 && val < 10000) {
          const r = rachas[g] = rachas[g] || { active: 0, max: 0 };
          if (/(cur|actual|racha$|streak$)/i.test(f)) r.active += 1;
          if (val > r.max) r.max = val;
        }
      }
    }
  }

  return json({ days, since, today, tiles, perGame: perGame.results || [], daily: daily.results || [],
                rachas, snapshotUsers: (snaps.results || []).length });
}

async function recent(env, url) {
  const limit = Math.min(300, Number(new URL(url).searchParams.get("limit")) || 60);
  const r = await env.DB.prepare(
    `SELECT ts, day, substr(uid,1,8) AS uid, game, mode, ev, dur FROM events ORDER BY id DESC LIMIT ?`)
    .bind(limit).all();
  return json(r.results || []);
}

async function exportCsv(env, url) {
  const { since } = sinceDay(url);
  const r = await env.DB.prepare(
    `SELECT ts, day, uid, game, mode, ev, dur, data FROM events WHERE day >= ? ORDER BY id`)
    .bind(since).all();
  const rows = [["ts", "day", "uid", "game", "mode", "ev", "dur_s", "data"]];
  for (const e of (r.results || [])) {
    rows.push([e.ts, e.day, e.uid, e.game, e.mode || "", e.ev, e.dur ?? "",
               (e.data || "").replaceAll('"', '""')]);
  }
  const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
  return new Response(csv, { headers: {
    "Content-Type": "text/csv;charset=utf-8",
    "Content-Disposition": `attachment; filename="cortadito-stats-${etDay(Date.now())}.csv"` } });
}

function json(o) {
  return new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });
}

// ============ pages ============

function loginPage(failed) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Cortadito Games · Stats</title>
<style>
  body{font-family:system-ui,sans-serif;background:#F7EFE0;display:grid;place-items:center;min-height:100vh;margin:0;color:#171210}
  form{background:#fff;border:1px solid #eee2d6;border-radius:14px;padding:32px;box-shadow:0 20px 50px -30px rgba(23,18,16,.3);width:min(320px,86vw)}
  h1{font-size:19px;margin:0 0 4px} p{margin:0 0 18px;color:#8d8580;font-size:14px}
  input{width:100%;box-sizing:border-box;padding:11px;border:1.5px solid #eee2d6;border-radius:9px;font-size:15px;margin-bottom:12px}
  button{width:100%;padding:11px;border:0;border-radius:9px;background:#171210;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
  .err{color:#B02E2E;font-size:13px;margin:0 0 10px}
</style></head><body>
<form method="POST" action="/admin/login">
  <h1>Cortadito Games · Stats</h1>
  <p>Panel privado</p>
  ${failed ? '<p class="err">Contraseña incorrecta.</p>' : ''}
  <input type="password" name="pw" placeholder="Contraseña" autofocus autocomplete="current-password">
  <button>Entrar</button>
</form></body></html>`;
}

function dashPage() {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Cortadito Games · Stats</title>
<style>
  :root{--bg:#fcfcfb;--card:#ffffff;--line:#eee2d6;--ink:#171210;--ink2:#5f5852;--muted:#8d8580;
        --racimo:#B02E2E;--palabreo:#4E8C4C;--sudoku:#2F6FBF;--flechas:#D89B3D;--hub:#9a9187}
  *{box-sizing:border-box}
  body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--ink);margin:0;padding:20px 16px 60px}
  .wrap{max-width:1020px;margin:0 auto}
  header{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:14px}
  h1{font-size:20px;margin:0} h1 small{color:var(--muted);font-weight:400;font-size:13px}
  .filters{display:flex;gap:6px;align-items:center;font-size:13px}
  .filters a{padding:5px 11px;border:1px solid var(--line);border-radius:999px;color:var(--ink2);text-decoration:none}
  .filters a.on{background:var(--ink);color:#fff;border-color:var(--ink)}
  .filters a.plain{border:none;color:var(--muted)}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px}
  .tile{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .tile .n{font-size:26px;font-weight:700;line-height:1.1}
  .tile .l{font-size:12px;color:var(--muted);margin-top:3px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:14px}
  .card h2{font-size:14px;margin:0 0 12px;color:var(--ink2)}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;color:var(--muted);font-weight:600;padding:6px 8px;border-bottom:1px solid var(--line)}
  td{padding:6px 8px;border-bottom:1px solid #f6efe4}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;vertical-align:baseline}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media(max-width:760px){.grid2{grid-template-columns:1fr}}
  .bar-row{display:grid;grid-template-columns:110px 1fr 64px;align-items:center;gap:10px;margin:7px 0;font-size:13px}
  .bar-track{height:14px;position:relative}
  .bar-fill{height:14px;border-radius:0 4px 4px 0;min-width:2px}
  .bar-val{text-align:right;font-variant-numeric:tabular-nums;color:var(--ink2)}
  svg text{font-family:system-ui,sans-serif}
  .tip{position:fixed;pointer-events:none;background:var(--ink);color:#fff;font-size:12px;padding:5px 9px;border-radius:7px;opacity:0;transition:opacity .1s;z-index:10;white-space:nowrap}
  .empty{color:var(--muted);font-size:13px;padding:12px 0}
</style></head><body><div class="wrap">
<header>
  <h1>Cortadito Games <small>· panel de stats</small></h1>
  <nav class="filters" id="filters"></nav>
</header>
<div class="tiles" id="tiles"></div>
<div class="card"><h2 id="dailyTitle">Jugadores por día</h2><div id="daily"></div></div>
<div class="grid2">
  <div class="card"><h2>Sesiones por juego</h2><div id="sessions"></div></div>
  <div class="card"><h2>Minutos jugados por juego</h2><div id="minutes"></div></div>
</div>
<div class="card"><h2>Por juego</h2><div id="pergame"></div></div>
<div class="card"><h2>Rachas (de los datos guardados en cada navegador)</h2><div id="rachas"></div></div>
<div class="card"><h2>Últimos eventos</h2><div id="recent"></div></div>
<div class="tip" id="tip"></div>
</div>
<script>
const COLORS = { racimo:'#B02E2E', palabreo:'#4E8C4C', sudoku:'#2F6FBF', flechas:'#D89B3D', hub:'#9a9187' };
const NAME = { racimo:'Racimo', palabreo:'Palabreo', sudoku:'Sudoku', flechas:'Flechas', hub:'Portada' };
const days = Number(new URLSearchParams(location.search).get('days')) || 14;
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtMin = s => { const m = Math.round(s/60); return m >= 60 ? (m/60).toFixed(1)+' h' : m+' min'; };

document.getElementById('filters').innerHTML =
  [7,14,30,90].map(d => '<a href="?days='+d+'" class="'+(d===days?'on':'')+'">'+d+' días</a>').join('') +
  '<a class="plain" href="/admin/api/export.csv?days='+days+'">Exportar CSV</a><a class="plain" href="/admin/logout">Salir</a>';

const tip = document.getElementById('tip');
function showTip(e, html){ tip.innerHTML = html; tip.style.opacity = 1;
  tip.style.left = Math.min(e.clientX+12, innerWidth-170)+'px'; tip.style.top = (e.clientY-34)+'px'; }
function hideTip(){ tip.style.opacity = 0; }

fetch('/admin/api/summary?days='+days).then(r => r.json()).then(d => {
  const t = d.tiles || {};
  document.getElementById('tiles').innerHTML = [
    [t.players_today||0, 'jugadores hoy'],
    [t.sessions_today||0, 'sesiones hoy'],
    [fmtMin(t.seconds_today||0), 'tiempo jugado hoy'],
    [t.players_range||0, 'jugadores · '+d.days+' días'],
    [t.sessions_range||0, 'sesiones · '+d.days+' días'],
    [fmtMin(t.seconds_range||0), 'tiempo · '+d.days+' días'],
  ].map(x => '<div class="tile"><div class="n">'+x[0]+'</div><div class="l">'+x[1]+'</div></div>').join('');

  // daily players line (single series — no legend needed)
  const daily = d.daily || [];
  document.getElementById('dailyTitle').textContent = 'Jugadores por día · últimos '+d.days;
  if (!daily.length) { document.getElementById('daily').innerHTML = '<div class="empty">Sin datos todavía — los eventos empiezan a llegar en cuanto alguien juega.</div>'; }
  else {
    const W = 940, H = 180, P = 28, PB = 24;
    const max = Math.max(1, ...daily.map(r => r.players));
    const x = i => P + i * (W - 2*P) / Math.max(1, daily.length - 1);
    const y = v => (H - PB) - v * (H - PB - 14) / max;
    let path = daily.map((r, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(r.players).toFixed(1)).join(' ');
    if (daily.length === 1) path = '';
    const pts = daily.map((r, i) =>
      '<circle cx="'+x(i)+'" cy="'+y(r.players)+'" r="'+(daily.length < 40 ? 4 : 2.5)+'" fill="#B02E2E" stroke="#fff" stroke-width="1.5" data-d="'+r.day+'" data-p="'+r.players+'" data-s="'+r.sessions+'"/>').join('');
    const grid = [0, Math.ceil(max/2), max].map(v =>
      '<g><line x1="'+P+'" x2="'+(W-P)+'" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#f0e8db"/><text x="'+(P-6)+'" y="'+(y(v)+4)+'" font-size="10" fill="#8d8580" text-anchor="end">'+v+'</text></g>').join('');
    const labs = daily.length <= 31 ? daily.map((r, i) => (i % Math.ceil(daily.length/10) === 0) ?
      '<text x="'+x(i)+'" y="'+(H-6)+'" font-size="10" fill="#8d8580" text-anchor="middle">'+r.day.slice(5)+'</text>' : '').join('') : '';
    document.getElementById('daily').innerHTML =
      '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto">'+grid+
      '<path d="'+path+'" fill="none" stroke="#B02E2E" stroke-width="2"/>'+pts+labs+'</svg>';
    document.querySelectorAll('#daily circle').forEach(c => {
      c.addEventListener('mousemove', e => showTip(e, c.dataset.d+' · <b>'+c.dataset.p+'</b> jugadores · '+c.dataset.s+' sesiones'));
      c.addEventListener('mouseleave', hideTip);
    });
  }

  // per-game bars
  const pg = (d.perGame || []).filter(g => COLORS[g.game]);
  const bars = (rows, val, fmt) => {
    if (!rows.length) return '<div class="empty">Sin datos todavía.</div>';
    const max = Math.max(1, ...rows.map(val));
    return rows.map(g => {
      const c = COLORS[g.game] || '#9a9187';
      return '<div class="bar-row"><span><span class="dot" style="background:'+c+'"></span>'+ (NAME[g.game]||g.game)+'</span>'+
        '<div class="bar-track"><div class="bar-fill" style="width:'+(100*val(g)/max)+'%;background:'+c+'"></div></div>'+
        '<span class="bar-val">'+fmt(g)+'</span></div>';
    }).join('');
  };
  document.getElementById('sessions').innerHTML = bars(pg, g => g.sessions, g => g.sessions);
  document.getElementById('minutes').innerHTML  = bars([...pg].sort((a,b) => b.seconds-a.seconds), g => g.seconds, g => fmtMin(g.seconds));

  // per-game table
  document.getElementById('pergame').innerHTML = pg.length ?
    '<table><tr><th>Juego</th><th class="num">Jugadores</th><th class="num">Visitas</th><th class="num">Sesiones</th><th class="num">Tiempo total</th><th class="num">Media/sesión</th></tr>' +
    pg.map(g => '<tr><td><span class="dot" style="background:'+(COLORS[g.game]||'#9a9187')+'"></span>'+(NAME[g.game]||g.game)+'</td>'+
      '<td class="num">'+g.players+'</td><td class="num">'+g.views+'</td><td class="num">'+g.sessions+'</td>'+
      '<td class="num">'+fmtMin(g.seconds)+'</td><td class="num">'+(g.sessions ? Math.round(g.seconds/g.sessions/60*10)/10+' min' : '—')+'</td></tr>').join('') +
    '</table>' : '<div class="empty">Sin datos todavía.</div>';

  // rachas
  const rk = Object.keys(d.rachas || {});
  document.getElementById('rachas').innerHTML = rk.length ?
    '<table><tr><th>Juego</th><th class="num">Jugadores con racha activa</th><th class="num">Racha más larga vista</th></tr>' +
    rk.map(g => '<tr><td><span class="dot" style="background:'+(COLORS[g]||'#9a9187')+'"></span>'+(NAME[g]||g)+'</td>'+
      '<td class="num">'+d.rachas[g].active+'</td><td class="num">'+d.rachas[g].max+'</td></tr>').join('') + '</table>' +
    '<p style="font-size:12px;color:#8d8580">De los últimos guardados de '+d.snapshotUsers+' navegadores (una foto diaria por jugador).</p>'
    : '<div class="empty">Aparecen cuando lleguen los primeros guardados diarios (una foto por jugador y día).</div>';
});

fetch('/admin/api/recent?limit=60').then(r => r.json()).then(rows => {
  document.getElementById('recent').innerHTML = rows.length ?
    '<table><tr><th>Cuándo (ET)</th><th>Jugador</th><th>Juego</th><th>Modo</th><th>Evento</th><th class="num">Duración</th></tr>' +
    rows.map(e => '<tr><td>'+new Date(e.ts).toLocaleString('es-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+'</td>'+
      '<td style="font-family:monospace">'+esc(e.uid)+'</td><td>'+esc(NAME[e.game]||e.game)+'</td><td>'+esc(e.mode||'—')+'</td><td>'+esc(e.ev)+'</td>'+
      '<td class="num">'+(e.dur != null ? e.dur+' s' : '—')+'</td></tr>').join('') + '</table>'
    : '<div class="empty">Todavía no hay eventos.</div>';
});
</script></body></html>`;
}
