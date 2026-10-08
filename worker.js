/* Cortadito Games — stats worker. Existing persistent browser IDs are pseudonymous.
   Exact numeric snapshot allowlist; no raw storage or arbitrary event data retained
   by this proposed ingest path. Existing historical D1 records are not deleted. */

// Los hashes de las contrasenas de admin viven en secretos del Worker:
// env.ADMIN_PW_HASH (propietario) y el opcional env.ADMIN_TEAM_PW_HASH
// (contrasena compartida del equipo). Este archivo esta en un repositorio
// publico, asi que no se deben guardar credenciales ni hashes aqui. La cookie
// tampoco es el secreto (ver admin-session mas abajo).
/* Pure data projection shared verbatim by the isolated clients and Worker.
   Existing random persistent browser ID; pseudonymous, not anonymous.
   Exact keys and numeric fields only. No arbitrary storage enumeration. */
var CG_STATS_ALLOWLIST = {
  'clasico-stats': {game:'flechas', fields:['played','solved','best','ranks','cur','max','retos','curReto','maxReto'], current:['cur','curReto'], maximum:['max','maxReto']},
  'cascada-stats': {game:'flechas', fields:['played','best','ranks','cur','max','retos','curReto','maxReto'], current:['cur','curReto'], maximum:['max','maxReto']},
  'cortadito-palabreo-stats': {game:'palabreo', fields:['played','wins','ranks','curPlay','maxPlay','curReto','maxReto'], current:['curPlay','curReto'], maximum:['maxPlay','maxReto']},
  'cortadito-palabreo-quordle-stats': {game:'palabreo', fields:['played','wins','ranks','curPlay','maxPlay','curReto','maxReto'], current:['curPlay','curReto'], maximum:['maxPlay','maxReto']},
  'cortadito-palabreo-waffle-stats': {game:'palabreo', fields:['played','wins','ranks','curPlay','maxPlay','curReto','maxReto'], current:['curPlay','curReto'], maximum:['maxPlay','maxReto']},
  'sudoku-lifetime': {game:'sudoku', fields:['days','completed','bestRankIdx','ranks','streak','longest','retoStreak','retoLongest'], current:['streak','retoStreak'], maximum:['longest','retoLongest']},
  'sudoku-mini-streak': {game:'sudoku', fields:['count'], current:['count'], maximum:['count']},
  'sudoku-mini-best': {game:'sudoku', scalar:true, current:[], maximum:[]}
};
function cgPlainObject(value) {
  return value!==null && typeof value==='object' && !Array.isArray(value);
}
function cgInteger(value, minimum, maximum) {
  return typeof value==='number' && Number.isSafeInteger(value) && value>=minimum && value<=maximum;
}
function cgStatValue(key, raw) {
  if (!Object.prototype.hasOwnProperty.call(CG_STATS_ALLOWLIST,key) || typeof raw!=='string' || raw.length>4000) return null;
  var spec=CG_STATS_ALLOWLIST[key], value;
  try { value=JSON.parse(raw); } catch(e) { return null; }
  if(spec.scalar) return cgInteger(value,0,864000)?String(value):null;
  if(!cgPlainObject(value)) return null;
  var projected={};
  spec.fields.forEach(function(field){
    if(!Object.prototype.hasOwnProperty.call(value,field)) return;
    var item=value[field];
    if(field==='ranks') {
      if(Array.isArray(item) && item.length===10 && item.every(function(n){return cgInteger(n,0,1000000);})) projected.ranks=item.slice();
    } else if(field==='bestRankIdx') {
      if(cgInteger(item,-1,9)) projected[field]=item;
    } else if(cgInteger(item,0,field==='best'?1000000000:1000000)) projected[field]=item;
  });
  return Object.keys(projected).length?JSON.stringify(projected):null;
}
function cgReadSnapshot(storage) {
  var snapshot={};
  Object.keys(CG_STATS_ALLOWLIST).forEach(function(key){
    try { var value=cgStatValue(key,storage.getItem(key)); if(value!==null) snapshot[key]=value; } catch(e) {}
  });
  return snapshot;
}
function cgFilterSnapshot(raw) {
  var value=raw;
  if(typeof raw==='string') {
    if(raw.length>48000) return {};
    try { value=JSON.parse(raw); } catch(e) { return {}; }
  }
  if(!cgPlainObject(value)) return {};
  var snapshot={};
  Object.keys(CG_STATS_ALLOWLIST).forEach(function(key){
    if(!Object.prototype.hasOwnProperty.call(value,key)) return;
    var projected=cgStatValue(key,value[key]);
    if(projected!==null) snapshot[key]=projected;
  });
  return snapshot;
}
function cgValidUid(uid) {
  return typeof uid==='string' && (/^[a-f0-9]{32}$/.test(uid) || uid==='no-ls');
}
// Racimo runtime projection; no localStorage key or found-word access.
function cgRacimoValue(raw) {
  if(typeof raw!=='string' || raw.length>4000) return null;
  var value; try {value=JSON.parse(raw);} catch(e){return null;}
  if(!cgPlainObject(value) || typeof value.day!=='string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value.day)) return null;
  var date=new Date(value.day+'T00:00:00Z');
  if(!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==value.day) return null;
  if(!cgInteger(value.score,1,1000000) || !cgInteger(value.rankIdx,0,9) || !cgInteger(value.goal,0,100)) return null;
  return JSON.stringify({day:value.day,score:value.score,rankIdx:value.rankIdx,goal:value.goal});
}
function cgRacimoData(raw) {
  var value=raw;
  if(typeof raw==='string') {if(raw.length>48000)return null;try{value=JSON.parse(raw);}catch(e){return null;}}
  if(!cgPlainObject(value) || !Object.prototype.hasOwnProperty.call(value,'racimo-summary'))return null;
  var summary=cgRacimoValue(value['racimo-summary']);
  return summary===null?null:JSON.stringify({'racimo-summary':summary});
}
function cgRacimoScores(rows,since,until) {
  var latest=new Map();
  rows.forEach(function(row){
    if(!cgValidUid(row.uid) || row.uid==='no-ls' || !cgInteger(row.ts,0,Number.MAX_SAFE_INTEGER))return;
    var clean=cgRacimoData(row.data);if(clean===null)return;
    var value=JSON.parse(JSON.parse(clean)['racimo-summary']);
    if(value.day<since || value.day>until)return;
    var key=row.uid+':'+value.day, previous=latest.get(key);
    if(!previous || row.ts>previous.ts || (row.ts===previous.ts && row.id>previous.id))latest.set(key,{...value,ts:row.ts,id:row.id});
  });
  var daily={};
  latest.forEach(function(value){
    var item=daily[value.day] || {day:value.day,browserDays:0,totalScore:0,maxScore:0,goalReached:0,ranks:Array(10).fill(0)};
    item.browserDays++;item.totalScore+=value.score;item.maxScore=Math.max(item.maxScore,value.score);item.goalReached+=value.score>=value.goal?1:0;item.ranks[value.rankIdx]++;daily[value.day]=item;
  });
  return Object.keys(daily).sort().map(function(day){var item=daily[day];item.meanScore=Math.round(item.totalScore/item.browserDays*10)/10;delete item.totalScore;return item;});
}
function cgFilterEvent(event, now) {
  if(!cgPlainObject(event) || !['view','session','snapshot'].includes(event.ev)) return null;
  var game=event.game==='index'?'hub':event.game, modes={hub:[],racimo:[],palabreo:['clasico','quordle','waffle','trenza','cuarteto'],sudoku:['clasico','mini','niebla'],flechas:['clasico','cascada','borde','rumbo','flujo','desvio']};
  if(typeof game!=='string' || !Object.prototype.hasOwnProperty.call(modes,game)) return null;
  var mode=event.mode==null || event.mode==='' || event.mode==='index'?null:event.mode;
  if(mode!==null && (typeof mode!=='string' || !modes[game].includes(mode))) return null;
  if(!cgInteger(event.ts,0,Math.min(Number.MAX_SAFE_INTEGER,now+300000))) return null;
  var clean={ev:event.ev,game:game,mode:mode,ts:event.ts,dur:null,data:null};
  if(event.ev==='session') {
    if(!cgInteger(event.dur,0,14400)) return null;
    clean.dur=event.dur;
    if(game==='racimo') clean.data=cgRacimoData(event.data);
  }
  if(event.ev==='snapshot') clean.data=JSON.stringify(cgFilterSnapshot(event.data));
  return clean;
}
function cgSnapshotStreaks(rows) {
  var rachas={};
  rows.forEach(function(row){
    var snap=cgFilterSnapshot(row.data), perBrowser={};
    Object.keys(snap).forEach(function(key){
      var spec=CG_STATS_ALLOWLIST[key]; if(spec.scalar) return;
      var value=JSON.parse(snap[key]), r=perBrowser[spec.game] || {active:false,max:0};
      spec.current.forEach(function(field){if(value[field]>0)r.active=true;});
      spec.maximum.forEach(function(field){if(value[field]>r.max)r.max=value[field];});
      spec.current.forEach(function(field){if(value[field]>r.max)r.max=value[field];});
      perBrowser[spec.game]=r;
    });
    Object.keys(perBrowser).forEach(function(game){
      var source=perBrowser[game];if(!source.active&&!source.max)return;
      var total=rachas[game] || {active:0,max:0};
      if(source.active)total.active++;total.max=Math.max(total.max,source.max);rachas[game]=total;
    });
  });
  return rachas;
}

const COOKIE = "cg_sess";              // renombrada: invalida el formato viejo
const SESSION_TTL_MS = 12 * 3600000;   // 12 h

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
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS gate_codes(
      email TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      expires INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_sent INTEGER NOT NULL
    )`),
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

/* --- admin-session:start -------------------------------------------------
   Sesion de admin firmada. La cookie NO es el secreto: lleva una expiracion
   mas una firma HMAC-SHA256 real sobre esa expiracion, hecha con
   ADMIN_SESSION_SECRET, que solo existe como secreto del Worker.

   La verificacion usa crypto.subtle.verify, que es de tiempo constante por
   construccion: no hay ninguna comparacion manual de material secreto.

   Falla cerrado: falta de secreto, token mal formado o token caducado son
   siempre un rechazo, nunca un acceso. */

function b64urlFromBytes(buf) {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesFromB64url(s) {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sessionKey(env) {
  const secret = env && env.ADMIN_SESSION_SECRET;
  if (!secret) return null;                       // falla cerrado
  return crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function makeSession(env, now) {
  const key = await sessionKey(env);
  if (!key) return null;
  const exp = (now || Date.now()) + SESSION_TTL_MS;
  const sig = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode("adm|" + exp));
  return exp + "." + b64urlFromBytes(sig);
}

async function verifySession(env, token, now) {
  const key = await sessionKey(env);
  if (!key || typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;          // la cookie vieja (64 hex) no tiene punto
  const expStr = token.slice(0, dot), sigStr = token.slice(dot + 1);
  if (!/^\d{1,15}$/.test(expStr) || !sigStr) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= (now || Date.now())) return false;
  let sig;
  try { sig = bytesFromB64url(sigStr); } catch (e) { return false; }
  return crypto.subtle.verify(
    "HMAC", key, sig, new TextEncoder().encode("adm|" + exp));
}

/* OJO: es async. Toda llamada DEBE llevar await — un authed() sin await
   devuelve una Promise, que siempre es truthy, y dejaria pasar a cualquiera. */
async function authed(request, env) {
  const c = request.headers.get("Cookie") || "";
  const m = c.match(/(?:^|;\s*)cg_sess=([^;\s]+)/);
  return m ? verifySession(env, m[1]) : false;
}
/* --- admin-session:end --------------------------------------------------- */

const GAMES = ["racimo", "palabreo", "sudoku", "flechas", "hub"];

// ============ BeeHiiv validation helpers ============

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* Accepts the email from a POST JSON body ({email}) or the legacy GET
   ?email= param; trims, lowercases, and format-checks it. Returns null if bad. */
async function readEmail(request, url) {
  let raw = "";
  if (request.method === "POST") {
    try { const b = await request.json(); raw = String((b && b.email) || ""); } catch (e) { return null; }
  } else {
    raw = url.searchParams.get("email") || "";
  }
  const email = raw.trim().toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 254 ? email : null;
}

/* Spec §4: only status "active" counts. Premium requires subscription_tier
   "premium". When BeeHiiv returns the premium-tiers detail array (Stripe-backed
   subs), at least one entry must be active — a lapsed payment leaves tier
   "premium" with no active entries, which is FREE, not PAID. Comped /
   API-granted subs (e.g. tier gifted via the API, no Stripe) come back WITHOUT
   that array even when expanded — for those, BeeHiiv's own tier verdict rules. */
function classify(sub) {
  if (!sub) return "NOT_SUBSCRIBED";
  if (sub.status !== "active") return "PENDING";
  if (sub.subscription_tier !== "premium") return "FREE_SUBSCRIBER";
  const tiers = sub.subscription_premium_tiers;
  const paid = (Array.isArray(tiers) && tiers.length)
    ? tiers.some(t => t && t.status === "active")
    : true;   // comped: no tier entries to check
  return paid ? "PAID_SUBSCRIBER" : "FREE_SUBSCRIBER";
}

// ============ One-time-code premium verification (audit CG-01) ============
// Email lookup alone no longer grants premium: a paid email receives a
// 6-digit code (Resend) and only the code confirmation returns a signed
// grant. The flow activates when BOTH secrets exist (wrangler secret put
// GATE_SECRET / RESEND_API_KEY); until then /a/premium behaves as before,
// so deploying this worker ahead of the Resend setup changes nothing.

const CODE_TTL = 10 * 60000;        // a code lives 10 minutes
const CODE_RESEND_MS = 60000;       // one email per address per minute
const GRANT_MS = 30 * 86400000;     // signed grant: 30 days, rolled forward by /a/premium-check

function codeFlowOn(env) { return !!(env.GATE_SECRET && env.RESEND_API_KEY); }

function normEmail(raw) {
  const email = String(raw || "").trim().toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 254 ? email : null;
}

async function makeGrant(env, email) {
  const until = Date.now() + GRANT_MS;
  const token = await sha256hex("grant|" + email + "|" + until + "|" + env.GATE_SECRET);
  return { until, token };
}

function codeEmailHtml(code) {
  return '<div style="font-family:Georgia,serif;max-width:420px;margin:0 auto;padding:28px 20px;color:#171210">'
    + '<p style="font-size:17px;margin:0 0 6px"><strong>Cortadito<span style="color:#e35336">.</span>games</strong></p>'
    + '<p style="font-size:15px;margin:0 0 18px">Tu código de verificación Premium:</p>'
    + '<p style="font-size:38px;letter-spacing:10px;font-weight:700;margin:0 0 18px;color:#171210">' + code + '</p>'
    + '<p style="font-size:13px;color:#7a6a5f;margin:0">Caduca en 10 minutos. Si no lo pediste, ignora este correo.</p>'
    + '</div>';
}

/* Creates/replaces the code row and emails it. A second request inside the
   per-email cooldown quietly reuses the code already in the inbox. */
async function sendLoginCode(env, email) {
  await initDB(env);
  const now = Date.now();
  const prev = await env.DB.prepare("SELECT last_sent FROM gate_codes WHERE email=?").bind(email).first();
  if (prev && now - prev.last_sent < CODE_RESEND_MS) return { ok: true, throttled: true };
  const code = String((crypto.getRandomValues(new Uint32Array(1))[0] % 900000) + 100000);
  const hash = await sha256hex(code + "|" + email + "|" + env.GATE_SECRET);
  await env.DB.prepare(
    "INSERT INTO gate_codes (email, hash, expires, attempts, last_sent) VALUES (?,?,?,0,?) "
    + "ON CONFLICT(email) DO UPDATE SET hash=excluded.hash, expires=excluded.expires, attempts=0, last_sent=excluded.last_sent"
  ).bind(email, hash, now + CODE_TTL, now).run();
  const from = env.RESEND_FROM || "Cortadito Games <juegos@cortadito.games>";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [email],
      subject: "Tu código de Cortadito Games: " + code,
      html: codeEmailHtml(code),
      text: "Tu código de verificación de Cortadito Games es: " + code
        + "\nCaduca en 10 minutos. Si no lo pediste, ignora este correo.",
    }),
  });
  if (!r.ok) return { ok: false, error: r.status === 429 ? "busy" : "mail", status: r.status === 429 ? 503 : 502 };
  return { ok: true };
}

/* Cache-aware BeeHiiv state lookup shared by the premium endpoints.
   Returns a state string, or { err, status } on upstream trouble. */
async function lookupState(env, email) {
  const cached = cacheGet(email);
  if (cached) return cached;
  try {
    const r = await bhFetch(
      `https://api.beehiiv.com/v2/publications/${env.BEEHIIV_PUB_ID}/subscriptions/by_email/${encodeURIComponent(email)}`
      + `?expand[]=subscription_premium_tiers`,
      { headers: { "Authorization": `Bearer ${env.BEEHIIV_API_KEY}` } });
    let state;
    if (r.status === 404) state = "NOT_SUBSCRIBED";           // never subscribed — clean answer, not an error
    else if (r.ok) { const d = await r.json(); state = classify(d && d.data); }
    else if (r.status === 429) return { err: "busy", status: 503 };
    else return { err: "upstream", status: 502 };
    cachePut(email, state);
    return state;
  } catch (e) { return { err: "upstream", status: 502 }; }
}

/* Per-isolate IP rate limit (best effort — Workers isolates are ephemeral,
   but this still stops a single client from probing emails or burning the
   shared 180/min BeeHiiv budget). maxPerMin requests per IP per minute. */
const rlBuckets = new Map();
function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "0";
}
function rateLimited(ip, maxPerMin) {
  const now = Date.now();
  if (rlBuckets.size > 5000) rlBuckets.clear();
  let b = rlBuckets.get(ip);
  if (!b || now > b.reset) { b = { n: 0, reset: now + 60000 }; rlBuckets.set(ip, b); }
  b.n++;
  return b.n > maxPerMin;
}

/* Short per-isolate cache of classifications (5 min) — absorbs repeat checks
   ("Comprobar de nuevo", re-validation on load) without spending rate limit. */
const vCache = new Map();
const V_TTL = 5 * 60000;
function cacheGet(email) {
  const c = vCache.get(email);
  if (c && c.exp > Date.now()) return c.state;
  if (c) vCache.delete(email);
  return null;
}
function cachePut(email, state) {
  if (vCache.size > 2000) vCache.clear();
  vCache.set(email, { state, exp: Date.now() + V_TTL });
}

/* fetch with exponential backoff on 429/5xx (0.5s, 1s), max 3 attempts. */
async function bhFetch(url, opts) {
  let r;
  for (let i = 0; i < 3; i++) {
    r = await fetch(url, opts);
    if (r.status !== 429 && r.status < 500) return r;
    if (i < 2) await new Promise(res => setTimeout(res, 500 * Math.pow(2, i)));
  }
  return r;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

    try {
      // ---------- public health probe (Jarvis interface) ----------
      // Side-effect-free: no BeeHiiv call, no email, no writes. Publishes only
      // whether things are CONFIGURED and REACHABLE — never a key, hash, id or
      // any subscriber data. Deliberately public so basic health needs no
      // credentials; authenticated metrics are pulled separately.
      if (p === "/a/health" && (request.method === "GET" || request.method === "HEAD")) {
        let db = "unknown";
        try {
          await env.DB.prepare("SELECT 1").first();
          db = "ok";
        } catch (e) { db = "error"; }
        return json({
          ok: true,
          ts: Date.now(),
          beehiiv: (env.BEEHIIV_API_KEY && env.BEEHIIV_PUB_ID) ? "configured" : "unconfigured",
          code_flow: (env.GATE_SECRET && env.RESEND_API_KEY) ? "active" : "configured_off",
          db,
        });
      }

      // ---------- beacon ingest ----------
      if (p === "/a/e" && request.method === "POST") {
        await initDB(env);
        let body;
        try { body = await request.json(); } catch (e) { return new Response("bad", { status: 400 }); }
        const uid = cgPlainObject(body) && cgValidUid(body.uid) ? body.uid : null;
        const evts = cgPlainObject(body) && Array.isArray(body.evts) ? body.evts.slice(0, 20) : [];
        if (!uid || !evts.length) return new Response("empty", { status: 400 });
        const stmts = [];
        const ins = env.DB.prepare(
          "INSERT INTO events (ts, day, uid, game, mode, ev, dur, data) VALUES (?,?,?,?,?,?,?,?)");
        for (const event of evts) {
          const e = cgFilterEvent(event, Date.now());
          if (!e) continue;
          stmts.push(ins.bind(e.ts, etDay(e.ts), uid, e.game, e.mode, e.ev, e.dur, e.data));
        }
        if (!stmts.length) return new Response("empty", { status: 400 });
        await env.DB.batch(stmts);
        return new Response("ok", { status: 202 });
      }

      // ---------- subscription validation (BeeHiiv) ----------
      // Four states: NOT_SUBSCRIBED | PENDING | FREE_SUBSCRIBER | PAID_SUBSCRIBER.
      // The API key never leaves this worker; the browser only ever sees
      // { ok, state, premium } — never the raw subscriber object.
      // GET kept alongside POST for backwards compat with cached gate.js.
      if (p === "/a/premium" && (request.method === "GET" || request.method === "POST")) {
        let body = {};
        if (request.method === "POST") {
          try { body = (await request.json()) || {}; } catch (e) { return json({ ok: false, error: "bad-email" }, 400); }
        } else {
          body = { email: url.searchParams.get("email") || "", silent: url.searchParams.get("silent") === "1" };
        }
        const email = normEmail(body.email);
        if (!email) return json({ ok: false, error: "bad-email" }, 400);
        if (!env.BEEHIIV_API_KEY || !env.BEEHIIV_PUB_ID) return json({ ok: false, configured: false });
        if (rateLimited("v:" + clientIp(request), 10)) return json({ ok: false, error: "rate" }, 429);

        const state = await lookupState(env, email);
        if (typeof state !== "string") return json({ ok: false, error: state.err }, state.status);

        // CG-01: with the code flow on, a paid email triggers a one-time code
        // instead of an instant grant. Silent background refreshes (gate.js
        // refreshPremium) never send an email.
        if (state === "PAID_SUBSCRIBER" && codeFlowOn(env)) {
          if (body.silent) return json({ ok: true, state, premium: true, code_required: true });
          const sent = await sendLoginCode(env, email);
          if (!sent.ok) return json({ ok: false, error: sent.error }, sent.status || 502);
          return json({ ok: true, state, premium: true, code_required: true, code_sent: true });
        }
        return json({ ok: true, state, premium: state === "PAID_SUBSCRIBER" });
      }

      // ---------- one-time code confirmation (audit CG-01) ----------
      if (p === "/a/premium-code" && request.method === "POST") {
        if (!codeFlowOn(env)) return json({ ok: false, configured: false });
        let body; try { body = (await request.json()) || {}; } catch (e) { return json({ ok: false, error: "bad" }, 400); }
        const email = normEmail(body.email);
        const code = String(body.code || "").replace(/\D/g, "");
        if (!email || code.length !== 6) return json({ ok: false, error: "bad" }, 400);
        if (rateLimited("c:" + clientIp(request), 15)) return json({ ok: false, error: "rate" }, 429);
        await initDB(env);
        const row = await env.DB.prepare("SELECT hash, expires, attempts FROM gate_codes WHERE email=?").bind(email).first();
        if (!row) return json({ ok: false, error: "expired" });
        if (row.expires < Date.now()) {
          await env.DB.prepare("DELETE FROM gate_codes WHERE email=?").bind(email).run();
          return json({ ok: false, error: "expired" });
        }
        if (row.attempts >= 5) return json({ ok: false, error: "many" });
        const h = await sha256hex(code + "|" + email + "|" + env.GATE_SECRET);
        if (h !== row.hash) {
          await env.DB.prepare("UPDATE gate_codes SET attempts=attempts+1 WHERE email=?").bind(email).run();
          return json({ ok: false, error: "code" });
        }
        await env.DB.prepare("DELETE FROM gate_codes WHERE email=?").bind(email).run();
        const grant = await makeGrant(env, email);
        return json({ ok: true, granted: true, until: grant.until, token: grant.token });
      }

      // ---------- signed-grant validation + rolling renewal (audit CG-01) ----------
      if (p === "/a/premium-check" && request.method === "POST") {
        let body; try { body = (await request.json()) || {}; } catch (e) { return json({ ok: false, error: "bad" }, 400); }
        const email = normEmail(body.email);
        const until = Number(body.until) || 0;
        const token = String(body.token || "");
        if (!email || !token) return json({ ok: false, error: "bad" }, 400);
        if (!codeFlowOn(env)) return json({ ok: true, valid: true });   // legacy mode: never kill grants
        if (rateLimited("k:" + clientIp(request), 20)) return json({ ok: false, error: "rate" }, 429);
        const expect = await sha256hex("grant|" + email + "|" + until + "|" + env.GATE_SECRET);
        if (expect !== token || until < Date.now()) return json({ ok: true, valid: false });
        // Token holds — if the sub is still paid, roll the grant forward quietly.
        if (!env.BEEHIIV_API_KEY || !env.BEEHIIV_PUB_ID) return json({ ok: true, valid: true });
        const state = await lookupState(env, email);
        if (typeof state !== "string") return json({ ok: true, valid: true });   // upstream trouble: keep the valid grant
        if (state !== "PAID_SUBSCRIBER") return json({ ok: true, valid: false });
        const grant = await makeGrant(env, email);
        return json({ ok: true, valid: true, renewed: true, until: grant.until, token: grant.token });
      }

      // ---------- in-app newsletter signup (BeeHiiv create subscription) ----------
      if (p === "/a/subscribe" && request.method === "POST") {
        const email = await readEmail(request, url);
        if (!email) return json({ ok: false, error: "bad-email" }, 400);
        if (!env.BEEHIIV_API_KEY || !env.BEEHIIV_PUB_ID) return json({ ok: false, configured: false });
        if (rateLimited("s:" + clientIp(request), 5)) return json({ ok: false, error: "rate" }, 429);

        try {
          const r = await bhFetch(
            `https://api.beehiiv.com/v2/publications/${env.BEEHIIV_PUB_ID}/subscriptions`,
            { method: "POST",
              headers: { "Authorization": `Bearer ${env.BEEHIIV_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                email,
                send_welcome_email: true,
                reactivate_existing: true,
                utm_source: "cortadito-games",   // measure games-driven growth in beehiiv
                utm_medium: "email-gate",
              }) });
          if (r.status === 429) return json({ ok: false, error: "busy" }, 503);
          if (!r.ok && r.status !== 201) return json({ ok: false, error: "upstream" }, 502);
          const d = await r.json();
          const sub = d && d.data;
          // With double opt-in on, new signups land as "validating" until confirmed.
          const state = sub && sub.status === "active" ? "FREE_SUBSCRIBER" : "PENDING";
          vCache.delete(email);   // don't serve a stale NOT_SUBSCRIBED afterwards
          return json({ ok: true, state });
        } catch (e) { return json({ ok: false, error: "upstream" }, 502); }
      }

      // ---------- admin auth ----------
      if (p === "/admin/login" && request.method === "POST") {
        // Sin el secreto del propietario y el secreto de sesion nadie entra.
        // El hash del equipo es opcional para mantener el acceso del dueno
        // antes de configurarlo.
        if (!env.ADMIN_PW_HASH || !env.ADMIN_SESSION_SECRET) {
          return new Response(loginPage(true), { status: 503, headers: { "Content-Type": "text/html;charset=utf-8" } });
        }
        // Limite de intentos: el resto de /a/* ya usa rateLimited, el login de
        // admin no. 10 intentos por IP y minuto no molesta a un humano y quita
        // la fuerza bruta barata. Cambio SEPARADO del arreglo de sesion firmada.
        if (rateLimited("adm:" + clientIp(request), 10)) {
          return new Response(loginPage(true), { status: 429, headers: { "Content-Type": "text/html;charset=utf-8" } });
        }
        const form = await request.formData();
        const pw = String(form.get("pw") || "");
        const h = await sha256hex("cortadito-admin:" + pw);
        // Comparacion simple a proposito: se comparan dos digest SHA-256 y el
        // atacante no puede elegir el suyo sin una preimagen, asi que no hay
        // un canal temporal aprovechable aqui. El material que SI se compara
        // en tiempo constante es la firma de sesion, via crypto.subtle.verify.
        const ownerPasswordMatches = h === env.ADMIN_PW_HASH;
        const teamPasswordMatches = Boolean(env.ADMIN_TEAM_PW_HASH) && h === env.ADMIN_TEAM_PW_HASH;
        if (ownerPasswordMatches || teamPasswordMatches) {
          const token = await makeSession(env);
          if (!token) {
            return new Response(loginPage(true), { status: 503, headers: { "Content-Type": "text/html;charset=utf-8" } });
          }
          return new Response(null, { status: 302, headers: {
            "Location": "/admin",
            "Set-Cookie": `${COOKIE}=${token}; Path=/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`,
          }});
        }
        return new Response(loginPage(true), { status: 401, headers: { "Content-Type": "text/html;charset=utf-8" } });
      }
      if (p === "/admin/logout") {
        return new Response(null, { status: 302, headers: {
          "Location": "/admin", "Set-Cookie": `${COOKIE}=; Path=/admin; Max-Age=0` } });
      }

      if (p === "/admin" || p.startsWith("/admin/")) {
        if (!(await authed(request, env))) {
          return new Response(loginPage(false), { headers: { "Content-Type": "text/html;charset=utf-8" } });
        }
        await initDB(env);
        if (p === "/admin" || p === "/admin/") {
          return new Response(dashPage(), { headers: { "Content-Type": "text/html;charset=utf-8" } });
        }
        if (p === "/admin/log") {
          return new Response(logPage(), { headers: { "Content-Type": "text/html;charset=utf-8" } });
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

function parseRange(url) {
  const q = new URL(url).searchParams;
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const from = q.get("from"), to = q.get("to");
  if (from && to && re.test(from) && re.test(to) && from <= to) {
    return { since: from, until: to, days: null, label: from + " \u2192 " + to };
  }
  const days = Math.min(3650, Math.max(1, Number(q.get("days")) || 14));
  return { since: etDay(Date.now() - (days - 1) * 86400000), until: etDay(Date.now()),
           days, label: "\u00faltimos " + days + " d\u00edas" };
}

async function summary(env, url) {
  const { days, since, until, label } = parseRange(url);
  const today = etDay(Date.now());

  const [tiles, perGame, daily, snaps, racimo] = await Promise.all([
    env.DB.prepare(`SELECT
        (SELECT COUNT(DISTINCT uid) FROM events WHERE day = ?1) AS players_today,
        (SELECT COUNT(*) FROM events WHERE day = ?1 AND ev = 'session') AS sessions_today,
        (SELECT COALESCE(SUM(dur),0) FROM events WHERE day = ?1 AND ev = 'session') AS seconds_today,
        (SELECT COUNT(DISTINCT uid) FROM events WHERE day BETWEEN ?2 AND ?3) AS players_range,
        (SELECT COUNT(*) FROM events WHERE day BETWEEN ?2 AND ?3 AND ev = 'session') AS sessions_range,
        (SELECT COALESCE(SUM(dur),0) FROM events WHERE day BETWEEN ?2 AND ?3 AND ev = 'session') AS seconds_range
      `).bind(today, since, until).first(),
    env.DB.prepare(`SELECT game,
        COUNT(DISTINCT uid) AS players,
        SUM(CASE WHEN ev='view' THEN 1 ELSE 0 END) AS views,
        SUM(CASE WHEN ev='session' THEN 1 ELSE 0 END) AS sessions,
        COALESCE(SUM(CASE WHEN ev='session' THEN dur ELSE 0 END),0) AS seconds
      FROM events WHERE day BETWEEN ? AND ? GROUP BY game ORDER BY sessions DESC`).bind(since, until).all(),
    env.DB.prepare(`SELECT day,
        COUNT(DISTINCT uid) AS players,
        SUM(CASE WHEN ev='session' THEN 1 ELSE 0 END) AS sessions,
        COALESCE(SUM(CASE WHEN ev='session' THEN dur ELSE 0 END),0) AS seconds
      FROM events WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day`).bind(since, until).all(),
    env.DB.prepare(`SELECT uid, data FROM events e WHERE ev='snapshot' AND id =
        (SELECT MAX(id) FROM events WHERE ev='snapshot' AND uid = e.uid) LIMIT 500`).all(),
    // Latest observed session per browser/puzzle date. Guard legacy invalid JSON.
    env.DB.prepare(`WITH raw AS (
      SELECT id, ts, uid, data, CASE WHEN json_valid(data) THEN json_extract(data, '$."racimo-summary"') END AS numeric
      FROM events WHERE ev='session' AND game='racimo' AND uid!='no-ls'
    ), dated AS (
      SELECT *, CASE WHEN json_valid(numeric) THEN json_extract(numeric,'$.day') END AS puzzleDay FROM raw
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY uid,puzzleDay ORDER BY ts DESC,id DESC) AS position
      FROM dated WHERE puzzleDay BETWEEN ? AND ?
    ) SELECT id,ts,uid,data FROM ranked WHERE position=1`).bind(since,until).all(),
  ]);

  // Exact allowed counters; count each browser at most once per game family.
  const rachas = cgSnapshotStreaks(snaps.results || []);

  return json({ days, since, until, label, today, tiles, perGame: perGame.results || [], daily: daily.results || [],
                rachas, snapshotUsers: (snaps.results || []).length, racimoScores: cgRacimoScores(racimo.results || [],since,until) });
}

async function recent(env, url) {
  const { since, until } = parseRange(url);
  const limit = Math.min(1000, Number(new URL(url).searchParams.get("limit")) || 200);
  const r = await env.DB.prepare(
    `SELECT ts, day, substr(uid,1,8) AS uid, game, mode, ev, dur FROM events
     WHERE day BETWEEN ? AND ? ORDER BY id DESC LIMIT ?`)
    .bind(since, until, limit).all();
  return json(r.results || []);
}

async function exportCsv(env, url) {
  const { since, until } = parseRange(url);
  const r = await env.DB.prepare(
    `SELECT ts, day, uid, game, mode, ev, dur, data FROM events WHERE day BETWEEN ? AND ? ORDER BY id`)
    .bind(since, until).all();
  const rows = [["ts", "day", "uid", "game", "mode", "ev", "dur_s", "data"]];
  for (const e of (r.results || [])) {
    rows.push([e.ts, e.day, e.uid, e.game, e.mode || "", e.ev, e.dur ?? "",
               (e.ev === 'snapshot' ? JSON.stringify(cgFilterSnapshot(e.data)) : e.ev === 'session' && e.game === 'racimo' ? cgRacimoData(e.data) || '' : '').replaceAll('"', '""')]);
  }
  const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
  return new Response(csv, { headers: {
    "Content-Type": "text/csv;charset=utf-8",
    "Content-Disposition": `attachment; filename="cortadito-stats-${etDay(Date.now())}.csv"` } });
}

function json(o, status) {
  return new Response(JSON.stringify(o), { status: status || 200,
    headers: { "Content-Type": "application/json" } });
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
  .filters{display:flex;gap:6px;align-items:center;font-size:13px;flex-wrap:wrap}
  .filters a{padding:5px 11px;border:1px solid var(--line);border-radius:999px;color:var(--ink2);text-decoration:none}
  .filters a.on{background:var(--ink);color:#fff;border-color:var(--ink)}
  .filters a.plain{border:none;color:var(--muted)}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px}
  .tile{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .tile .n{font-size:26px;font-weight:700;line-height:1.1}
  .tile .l{font-size:12px;color:var(--muted);margin-top:3px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:14px}
  .card h2{font-size:14px;margin:0 0 12px;color:var(--ink2)}
  .twrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .twrap table{min-width:560px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  .range{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:13px}
  .range input[type=date]{padding:5px 8px;border:1px solid var(--line);border-radius:8px;font:inherit;color:var(--ink);background:var(--card)}
  .range button{padding:6px 12px;border:0;border-radius:999px;background:var(--ink);color:#fff;font:inherit;cursor:pointer}
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
<div class="card"><h2>Por juego</h2><div class="twrap" id="pergame"></div></div>
<div class="card"><h2>Racimo · puntajes observados por fecha del puzzle</h2><div class="twrap" id="racimoScores"></div></div>
<div class="card"><h2>Rachas (de los datos guardados en cada navegador)</h2><div class="twrap" id="rachas"></div></div>
<div class="tip" id="tip"></div>
</div>
<script>
const COLORS = { racimo:'#B02E2E', palabreo:'#4E8C4C', sudoku:'#2F6FBF', flechas:'#D89B3D', hub:'#9a9187' };
const NAME = { racimo:'Racimo', palabreo:'Palabreo', sudoku:'Sudoku', flechas:'Flechas', hub:'Portada' };
const params = new URLSearchParams(location.search);
const days = Number(params.get('days')) || 14;
const customFrom = params.get('from'), customTo = params.get('to');
const isCustom = !!(customFrom && customTo);
const qs = isCustom ? ('from='+customFrom+'&to='+customTo) : ('days='+days);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtMin = s => { const m = Math.round(s/60); return m >= 60 ? (m/60).toFixed(1)+' h' : m+' min'; };

document.getElementById('filters').innerHTML =
  [[7,'7 días'],[30,'30 días'],[90,'90 días'],[365,'1 año'],[3650,'Todo']].map(x => '<a href="?days='+x[0]+'" class="'+(!isCustom && x[0]===days?'on':'')+'">'+x[1]+'</a>').join('') +
  '<span class="range"><input type="date" id="rf" value="'+(customFrom||'')+'"><input type="date" id="rt" value="'+(customTo||'')+'"><button id="rgo">Ir</button></span>' +
  '<a class="plain" href="/admin/api/export.csv?'+qs+'">Exportar CSV</a>' +
  '<a class="plain" href="/admin/log">Registro</a>' +
  '<a class="plain" href="/admin/logout">Salir</a>';
document.getElementById('rgo').addEventListener('click', () => {
  const f = document.getElementById('rf').value, t = document.getElementById('rt').value;
  if (f && t && f <= t) location.search = '?from='+f+'&to='+t;
});

const tip = document.getElementById('tip');
function showTip(e, html){ tip.innerHTML = html; tip.style.opacity = 1;
  tip.style.left = Math.min(e.clientX+12, innerWidth-170)+'px'; tip.style.top = (e.clientY-34)+'px'; }
function hideTip(){ tip.style.opacity = 0; }

fetch('/admin/api/summary?'+qs).then(r => r.json()).then(d => {
  const t = d.tiles || {};
  document.getElementById('tiles').innerHTML = [
    [t.players_today||0, 'jugadores hoy'],
    [t.sessions_today||0, 'sesiones hoy'],
    [fmtMin(t.seconds_today||0), 'tiempo jugado hoy'],
    [t.players_range||0, 'jugadores · '+d.label],
    [t.sessions_range||0, 'sesiones · '+d.label],
    [fmtMin(t.seconds_range||0), 'tiempo · '+d.label],
  ].map(x => '<div class="tile"><div class="n">'+x[0]+'</div><div class="l">'+x[1]+'</div></div>').join('');

  // daily players line (single series — no legend needed)
  const daily = d.daily || [];
  document.getElementById('dailyTitle').textContent = 'Jugadores por día · '+d.label;
  if (!daily.length) { document.getElementById('daily').innerHTML = '<div class="empty">Sin datos todavía — los eventos empiezan a llegar en cuanto alguien juega.</div>'; }
  else {
    const W = 940, H = 180, P = 28, PB = 24;
    const max = Math.max(1, ...daily.map(r => r.players));
    const x = i => P + i * (W - 2*P) / Math.max(1, daily.length - 1);
    const y = v => (H - PB) - v * (H - PB - 14) / max;
    let path = daily.map((r, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(r.players).toFixed(1)).join(' ');
    if (daily.length === 1) path = '';
    const pts = daily.map((r, i) =>
      '<circle cx="'+x(i)+'" cy="'+y(r.players)+'" r="'+(daily.length < 40 ? 4 : (daily.length < 150 ? 2.5 : 1.6))+'" fill="#B02E2E" stroke="#fff" stroke-width="1.5" data-d="'+r.day+'" data-p="'+r.players+'" data-s="'+r.sessions+'"/>').join('');
    const grid = [0, Math.ceil(max/2), max].map(v =>
      '<g><line x1="'+P+'" x2="'+(W-P)+'" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#f0e8db"/><text x="'+(P-6)+'" y="'+(y(v)+4)+'" font-size="10" fill="#8d8580" text-anchor="end">'+v+'</text></g>').join('');
    const labs = daily.map((r, i) => (i % Math.ceil(daily.length/10) === 0) ?
      '<text x="'+x(i)+'" y="'+(H-6)+'" font-size="10" fill="#8d8580" text-anchor="middle">'+(daily.length > 90 ? r.day.slice(0,7) : r.day.slice(5))+'</text>' : '').join('');
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

  // One latest observed score per browser/puzzle date; not finished-game counts.
  const rs=d.racimoScores || [];
  document.getElementById('racimoScores').innerHTML=rs.length ?
    '<table><tr><th>Puzzle</th><th class="num">Navegadores con puntos</th><th class="num">Media de puntos</th><th class="num">Máximo</th><th class="num">Reto alcanzado</th><th class="num">Maestro/a</th></tr>'+
    rs.map(r=>'<tr><td>'+esc(r.day)+'</td><td class="num">'+r.browserDays+'</td><td class="num">'+r.meanScore+'</td><td class="num">'+r.maxScore+'</td><td class="num">'+r.goalReached+'</td><td class="num">'+r.ranks[9]+'</td></tr>').join('')+'</table><p style="font-size:12px;color:#8d8580">Último puntaje recibido por navegador y fecha del puzzle; puede seguir cambiando. Sin partidas del archivo ni navegadores sin identificador guardado. Los datos anteriores no incluyen este resumen.</p>' :
    '<div class="empty">Sin resúmenes numéricos de Racimo en este rango. Los registros anteriores conservan visitas y sesiones, pero no permiten calcular estos puntajes.</div>';

  // rachas
  const rk = Object.keys(d.rachas || {});
  document.getElementById('rachas').innerHTML = rk.length ?
    '<table><tr><th>Juego</th><th class="num">Navegadores con racha guardada</th><th class="num">Racha más larga guardada</th></tr>' +
    rk.map(g => '<tr><td><span class="dot" style="background:'+(COLORS[g]||'#9a9187')+'"></span>'+(NAME[g]||g)+'</td>'+
      '<td class="num">'+d.rachas[g].active+'</td><td class="num">'+d.rachas[g].max+'</td></tr>').join('') + '</table>' +
    '<p style="font-size:12px;color:#8d8580">De los últimos guardados de '+d.snapshotUsers+' navegadores (un resumen numérico diario por navegador).</p>'
    : '<div class="empty">Aparecen cuando lleguen los primeros guardados diarios (un resumen numérico por navegador y día).</div>';
});

</script></body></html>`;
}

function logPage() {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Registro · Cortadito Games Stats</title>
<style>
  :root{--bg:#fcfcfb;--card:#fff;--line:#eee2d6;--ink:#171210;--muted:#8d8580}
  body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--ink);margin:0;padding:20px 16px 60px}
  .wrap{max-width:1020px;margin:0 auto}
  header{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:14px}
  h1{font-size:18px;margin:0} h1 a{color:var(--muted);text-decoration:none;font-weight:400}
  .bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px;margin-bottom:14px}
  .bar input[type=date],.bar select{padding:6px 9px;border:1px solid var(--line);border-radius:8px;font:inherit;background:var(--card)}
  .bar button{padding:7px 14px;border:0;border-radius:999px;background:var(--ink);color:#fff;font:inherit;cursor:pointer}
  .bar a{color:var(--muted);font-size:13px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
  .twrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .twrap table{min-width:640px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;color:var(--muted);font-weight:600;padding:6px 8px;border-bottom:1px solid var(--line)}
  td{padding:6px 8px;border-bottom:1px solid #f6efe4}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  .empty{color:var(--muted);font-size:13px;padding:12px 0}
  .meta{color:var(--muted);font-size:12px;margin-top:10px}
</style></head><body><div class="wrap">
<header><h1><a href="/admin">← Panel</a> · Registro de eventos</h1></header>
<div class="bar">
  <input type="date" id="rf"><span>–</span><input type="date" id="rt">
  <select id="lim"><option>200</option><option>500</option><option>1000</option></select>
  <button id="go">Ver</button>
  <a id="csv" href="#">Descargar CSV de este rango</a>
</div>
<div class="card"><div class="twrap" id="log"></div><div class="meta" id="meta"></div></div>
</div>
<script>
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const NAME = { racimo:'Racimo', palabreo:'Palabreo', sudoku:'Sudoku', flechas:'Flechas', hub:'Portada' };
const p = new URLSearchParams(location.search);
const today = new Date(); const iso = d => d.toISOString().slice(0,10);
const week = new Date(); week.setDate(week.getDate()-6);
document.getElementById('rf').value = p.get('from') || iso(week);
document.getElementById('rt').value = p.get('to') || iso(today);
if (p.get('limit')) document.getElementById('lim').value = p.get('limit');
function qs(){ return 'from='+document.getElementById('rf').value+'&to='+document.getElementById('rt').value+'&limit='+document.getElementById('lim').value; }
document.getElementById('go').addEventListener('click', () => { location.search = '?'+qs(); });
document.getElementById('csv').href = '/admin/api/export.csv?'+qs();
fetch('/admin/api/recent?'+qs()).then(r => r.json()).then(rows => {
  document.getElementById('log').innerHTML = rows.length ?
    '<table><tr><th>Cuándo (ET)</th><th>Jugador</th><th>Juego</th><th>Modo</th><th>Evento</th><th class="num">Duración</th></tr>' +
    rows.map(e => '<tr><td>'+new Date(e.ts).toLocaleString('es-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+'</td>'+
      '<td style="font-family:monospace">'+esc(e.uid)+'</td><td>'+esc(NAME[e.game]||e.game)+'</td><td>'+esc(e.mode||'—')+'</td><td>'+esc(e.ev)+'</td>'+
      '<td class="num">'+(e.dur != null ? e.dur+' s' : '—')+'</td></tr>').join('') + '</table>'
    : '<div class="empty">Sin eventos en este rango.</div>';
  document.getElementById('meta').textContent = rows.length + ' eventos mostrados (máx. ' + document.getElementById('lim').value + '). El CSV incluye todos los del rango.';
});
</script></body></html>`;
}
