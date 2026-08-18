/* Cortadito Games — freemium gate (rotación diaria + Premium).
   Served from the hub at /gate.js; every game and the hub include it.
   ENFORCE=true → gate live. Add ?cgpreview=1 to any URL to demo the lock
   screen even without ENFORCE; ?cgpremium=1 demos the subscriber view
   (localhost only — disabled in production per UI audit CG-01).
   Verification: POST /a/premium (worker → BeeHiiv, key server-side only).
   States: PAID_SUBSCRIBER unlocks; FREE_SUBSCRIBER → upgrade CTA; PENDING →
   confirm-your-email; NOT_SUBSCRIBED → in-app signup via POST /a/subscribe.
   CG-01 code flow: when the worker has GATE_SECRET + RESEND_API_KEY set,
   a paid email additionally receives a 6-digit code (code_required in the
   response) and only POST /a/premium-code returns the signed 30-day grant
   {until, token}; refreshPremium() validates/renews it via /a/premium-check.
   Without those secrets everything behaves exactly as before. */
(function () {
  var ENFORCE = true;
  var NEWS_URL = "https://cortadito.news/";
  var UPGRADE_URL = "https://cortadito.news/upgrade";
  var PREVIEW = /[?&]cgpreview=1/.test(location.search);
  /* demo the subscriber view — LOCAL ONLY (audit CG-01: never honored in production) */
  var PREMDEMO = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
                 && /[?&]cgpremium=1/.test(location.search);
  var ACTIVE = ENFORCE || PREVIEW;

  var POOLS = {
    palabreo: ["trenza", "cuarteto"],
    sudoku: ["clasico", "niebla", "mini"],
    flechas: ["borde", "cascada", "clasico"]   /* Desvío, Rumbo y Flujo retirados: no jugables */
  };
  var NAME = { racimo:"Racimo", palabreo:"Palabreo", sudoku:"Sudoku", flechas:"Flechas",
    clasico:"Clásico", trenza:"Trenza", cuarteto:"Cuarteto", niebla:"Niebla", mini:"Mini",
    borde:"Borde", cascada:"Cascada" };
  var DOW = ["dom","lun","mar","mié","jue","vie","sáb"];

  function fnv(s){ var h=2166136261; for (var i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
  function dayStr(d){ d=d||new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
  function freeMode(fam, d){ var p=POOLS[fam]; if(!p) return null; return p[fnv(dayStr(d)+":"+fam)%p.length]; }
  function isPremium(){ if (PREMDEMO) return true; try{ var p=JSON.parse(localStorage.getItem("cg-premium")||"null"); return !!(p && p.until>Date.now()); }catch(e){ return false; } }
  function defMode(game){ return game==="flechas" ? "borde" : "clasico"; }
  function isFree(game, mode){
    if (!game || game==="hub" || game==="racimo") return true;
    var m = mode || defMode(game);
    if (game==="palabreo" && m==="clasico") return true;
    if (!POOLS[game]) return true;
    return m === freeMode(game);
  }
  function modeUrl(game, m){
    if (game==="flechas") return "/flechas/" + (m==="borde" ? "" : m + ".html");
    return "/" + game + "/?modo=" + m + "#landing";
  }
  function here(){
    var parts = location.pathname.split("/");
    var game = (parts[1]||"").replace(/\.html$/,"") || "hub";
    var mode = (parts[2]||"").replace(/\.html$/,"") || null;
    if (game==="flechas") mode = mode==="index" ? "borde" : (mode || "borde");
    else { var q = new URLSearchParams(location.search).get("modo"); if (q) mode = q; }
    return { game: game, mode: mode };
  }

  /* ---------- styles ---------- */
  var css = ""
    + ".cgk-chip{display:inline-block;font:600 10px/1 system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;"
    + "padding:4px 8px;border-radius:999px;vertical-align:middle;white-space:nowrap}"
    + ".cgk-chip.free{background:#548C4C;color:#fff}"
    + ".cgk-chip.today{background:#e35336;color:#fff}"
    + ".cgk-chip.prem{background:#171210;color:#F7EFE0}"
    + ".cgk-band{display:block;width:100%;box-sizing:border-box;flex:none;font:800 11px/1 system-ui,sans-serif;"
    + "letter-spacing:.14em;text-transform:uppercase;color:#fff;text-align:center;padding:7px 10px 6px}"
    + ".cgk-band.free{background:#427C40}"
    + ".cgk-band.hoy{background:#2670B8}"
    + ".cgk-band.prem{background:#9C3B8E}"
    + "a.feature .cgk-band{position:absolute;top:0;left:0;right:0;z-index:2}"
    + "a.card.cgk-edge-prem .go{padding:9px 14px;font-size:13.5px}"
    + ".cgk-prem-pill{position:relative;display:inline-flex;align-items:center;gap:5px;font:800 11px/1 system-ui,sans-serif;cursor:pointer;border:0;"
    + "letter-spacing:.08em;text-transform:uppercase;color:#fff;background:#9C3B8E;border-radius:999px;"
    + "padding:7px 12px;margin-right:10px;white-space:nowrap}"
    + ".cgk-prem-pill .ck{font-weight:800}"
    /* invisible hit-area extender: keeps the pill visually compact but gives a
       ~44px touch target (audit CG-05) */
    + ".cgk-prem-pill::before{content:\"\";position:absolute;inset:-10px -4px}"
    + ".cgk-prem-pill .txt-s{display:none}"
    /* narrow masthead: shorten to "✓ Premium" — never a bare check with no
       visible status text (audit CG-12) */
    + "@media (max-width:700px){.cgk-prem-pill{padding:6px 10px;margin-right:8px}"
    + ".cgk-prem-pill .txt{display:none}.cgk-prem-pill .txt-s{display:inline}}"
    + ".menu-wrap{display:flex;align-items:center}"
    + ".cgk-strip{max-width:760px;margin:2px auto 0;padding:0 24px;text-align:center;font:400 13px/1.6 system-ui,sans-serif;color:#8d8580}"
    + ".cgk-strip a{color:inherit;text-decoration:underline;text-underline-offset:2px}"
    + ".cgk-ov{position:fixed;inset:0;z-index:99990;background:rgba(23,18,16,.38);-webkit-backdrop-filter:blur(5px) saturate(.85);"
    + "backdrop-filter:blur(5px) saturate(.85);display:flex;align-items:center;justify-content:center;padding:16px}"
    + "@supports not (backdrop-filter:blur(5px)){.cgk-ov{background:rgba(23,18,16,.55)}}"
    + ".cgk-panel{background:#FAF5EC;color:#171210;border-radius:18px;max-width:430px;width:100%;padding:0;"
    + "box-shadow:0 30px 80px -30px rgba(0,0,0,.55);font-family:system-ui,sans-serif;text-align:center;max-height:92vh;overflow:auto}"
    + ".cgk-topband{display:block;font:800 11px/1 system-ui,sans-serif;letter-spacing:.18em;text-transform:uppercase;"
    + "color:#fff;background:#9C3B8E;padding:8px 10px 7px}"
    + ".cgk-inner{padding:18px 18px 20px}"
    + ".cgk-panel h2{font-family:'Fraunces',Georgia,serif;font-weight:900;font-size:22px;margin:0 0 4px;letter-spacing:-.01em;color:#1c1108}"
    + ".cgk-panel p{font-size:13.5px;color:#5f5852;margin:0 0 12px}"
    + ".cgk-cards{display:flex;gap:9px;margin:2px 0 12px}"
    + ".cgk-mini{flex:1 1 0;min-width:0;background:#fff;border:1px solid #eee2d6;border-radius:14px;overflow:hidden;"
    + "text-decoration:none;color:#171210;display:flex;flex-direction:column;transition:transform .15s,box-shadow .15s}"
    + ".cgk-mini:hover{transform:translateY(-2px);box-shadow:0 10px 24px -14px rgba(23,18,16,.35)}"
    + ".cgk-mini .cgk-band{font-size:8.5px;padding:5px 4px 4px;letter-spacing:.12em}"
    + ".cgk-mini .p2{display:flex;align-items:center;justify-content:center;padding:13px 8px 11px}"
    + ".cgk-mini .i2{width:60px;height:60px;display:block}"
    + ".cgk-mini .i2 svg{width:100%;height:100%;display:block}"
    + ".cgk-mini .cat{font:800 8.5px/1 system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#9c9186;margin-top:9px}"
    + ".cgk-mini .ttl{font-family:'Fraunces',Georgia,serif;font-weight:900;font-size:17px;line-height:1.05;color:#1c1108;margin:4px 4px 3px}"
    + ".cgk-mini .d2{font:400 10.5px/1.35 system-ui,sans-serif;color:#5f5852;margin:0 6px 9px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}"
    + ".cgk-mini .go2{font:700 11.5px/1 system-ui,sans-serif;margin:auto auto 10px;border:1.5px solid #171210;color:#171210;"
    + "border-radius:999px;padding:6px 13px;background:#fff;white-space:nowrap}"
    + ".cgk-premblock{background:#fff;border:1px solid #eee2d6;border-radius:14px;padding:14px 14px 12px;margin:12px 0 4px}"
    + ".cgk-premchip{display:inline-block;font:800 9px/1 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;"
    + "color:#fff;background:#9C3B8E;border-radius:999px;padding:5px 10px 4px;margin-bottom:8px}"
    + ".cgk-premblock .tx{font-size:13.5px;color:#3d3833;margin:0 0 4px}"
    + ".cgk-premblock .cafe{font-size:12.5px;color:#8d8580;font-style:italic;margin:0 0 12px}"
    + ".cgk-btn.plum{background:#9C3B8E;color:#fff}"
    + ".cgk-linkbtn{display:block;width:100%;background:none;border:0;font:600 13px system-ui,sans-serif;color:#5f5852;"
    + "cursor:pointer;padding:9px;text-decoration:underline;text-underline-offset:2px}"
    + ".cgk-btn{display:block;width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:0;font-size:15px;font-weight:700;"
    + "cursor:pointer;text-decoration:none;margin-bottom:8px}"
    + ".cgk-btn.main{background:#e35336;color:#fff}"
    + ".cgk-btn.dark{background:#171210;color:#fff}"
    + ".cgk-btn.ghost{background:none;border:1.5px solid #eee2d6;color:#5f5852;font-weight:600}"
    + ".cgk-btn.white{background:#fff;border:1.5px solid #171210;color:#171210}"
    + ".cgk-back{font-size:13px;color:#5f5852;margin:0 0 2px}"
    + ".cgk-back b{color:#171210}"
    /* aviso "Sitio para computadoras": only ever shown on a phone rendering a
       ~980px desktop layout viewport, i.e. the page is zoomed way out — so
       these sizes are ~2.4x normal to read at physical size after scaling. */
    + ".cgk-dsktip{position:fixed;left:20px;right:20px;bottom:20px;z-index:99995;background:#FAF5EC;color:#171210;"
    + "border:2px solid #eee2d6;border-radius:22px;box-shadow:0 16px 50px -12px rgba(0,0,0,.4);padding:22px 26px;"
    + "display:flex;gap:22px;align-items:center;justify-content:space-between;font:500 27px/1.45 system-ui,sans-serif}"
    + ".cgk-dsktip button{flex:none;border:0;background:#171210;color:#fff;font:700 25px system-ui,sans-serif;"
    + "border-radius:999px;padding:16px 28px;cursor:pointer}"
    + ".cgk-note{font-size:11px;color:#8d8580;margin-top:10px}"
    + ".cgk-list{margin:0 0 12px;padding-left:20px;text-align:left}"
    + ".cgk-list li{font-size:13.5px;color:#5f5852;margin-bottom:7px;line-height:1.45}"
    + ".cgk-list b{color:#1c1108}"
    + ".cgk-note.ok{color:#427C40;font-size:13px;font-weight:600}"
    + ".cgk-note.warn{color:#B02E2E;font-size:12px}"
    + ".cgk-input{display:block;width:100%;box-sizing:border-box;padding:11px 12px;border:1.5px solid #eee2d6;"
    + "border-radius:10px;font-size:16px;font-family:inherit;margin-bottom:8px;background:#fff;color:#171210}"
    + ".cgk-input:focus{outline:none;border-color:#171210}"
    + ".cgk-linkbtn{background:none;border:0;padding:6px 0;cursor:pointer;font:600 12px/1 system-ui,sans-serif;"
    + "color:#7A6A5F;text-decoration:underline}"
    + ".cgk-linkbtn:disabled{cursor:default;text-decoration:none;opacity:.6}"
    + ".cgk-filter{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:26px auto 2px;padding:0 16px}"
    + ".cgk-filter button{position:relative;font:600 13px/1 system-ui,sans-serif;padding:9px 18px;border-radius:999px;cursor:pointer;"
    + "background:transparent;color:var(--ink,#171210);border:1.5px solid var(--line,#eee2d6);transition:background .15s}"
    /* invisible hit-area extender → ~44px tall touch target (audit CG-05) */
    + ".cgk-filter button::before{content:\"\";position:absolute;inset:-5px -3px}"
    + ".cgk-filter button.on{background:var(--ink,#171210);color:var(--bg,#fff);border-color:var(--ink,#171210)}";
  var st = document.createElement("style"); st.textContent = css;
  (document.head || document.documentElement).appendChild(st);
  try{ if (!document.querySelector('link[href*=\"Fraunces\"]')){
    var fl = document.createElement("link"); fl.rel = "stylesheet";
    fl.href = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,900&display=swap";
    (document.head || document.documentElement).appendChild(fl);
  } }catch(e){}

  /* ---------- lock overlay ---------- */
  /* "Cuarteto vuelve gratis el martes." — when the locked mode next rotates
     into the free slot. Answers the question the old weekly strip didn't. */
  var DOWFULL = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
  function comebackHtml(game, mode){
    if (!mode) return "";
    for (var i = 1; i <= 14; i++){
      var d = new Date(); d.setDate(d.getDate() + i);
      if (freeMode(game, d) === mode){
        var when = i === 1 ? "mañana" : "el " + DOWFULL[d.getDay()];
        return '<p class="cgk-back">📅 ' + NAME[mode] + ' vuelve gratis <b>' + when + '</b>.</p>';
      }
    }
    return "";
  }
  /* ---------- hub card art, verbatim (same SVGs as the hub cards) ---------- */
  function csvg(i){ return '<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">'+i+'</svg>'; }
  function csvg32(i){ return '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">'+i+'</svg>'; }
  function cfill(raw,a,a2){ return raw.split('var(--accent-2)').join(a2).split('var(--accent)').join(a); }
  var PAL_SAGE = "#548C4C";
  function palClasico(a){return csvg32('<rect x="3" y="3" width="12" height="12" rx="3" fill="'+a+'"/><rect x="17" y="3" width="12" height="12" rx="3" fill="'+PAL_SAGE+'"/><rect x="3" y="17" width="12" height="12" rx="3" fill="'+PAL_SAGE+'"/><rect x="17" y="17" width="12" height="12" rx="3" fill="'+a+'"/>');}
  function palTrenza(a){return csvg32('<rect x="3" y="3" width="9" height="9" rx="2" fill="'+a+'"/><rect x="20" y="3" width="9" height="9" rx="2" fill="'+a+'"/><rect x="3" y="20" width="9" height="9" rx="2" fill="'+a+'"/><rect x="20" y="20" width="9" height="9" rx="2" fill="'+a+'"/><rect x="11.5" y="11.5" width="9" height="9" rx="2" fill="'+PAL_SAGE+'"/>');}
  function palCuarteto(a){return csvg32('<rect x="2" y="2" width="11" height="11" rx="2.5" fill="'+a+'"/><rect x="19" y="2" width="11" height="11" rx="2.5" fill="'+PAL_SAGE+'"/><rect x="2" y="19" width="11" height="11" rx="2.5" fill="'+PAL_SAGE+'"/><rect x="19" y="19" width="11" height="11" rx="2.5" fill="'+a+'"/>');}
  var SUDOKU3_RAW = '<g transform="rotate(-28 22 22)"><ellipse cx="22" cy="22" rx="13.75" ry="9.375" style="fill:var(--accent)"/><path d="M 10.75 23.5 Q 22 18.25 33.25 22.5" style="fill:none;stroke:var(--accent-2);stroke-width:2.125;stroke-linecap:round"/></g><g transform="rotate(14 60 22)"><ellipse cx="60" cy="22" rx="13.75" ry="9.375" style="fill:var(--accent)"/><path d="M 48.75 23.5 Q 60 18.25 71.25 22.5" style="fill:none;stroke:var(--accent-2);stroke-width:2.125;stroke-linecap:round"/></g><g transform="rotate(-18 98 22)"><ellipse cx="98" cy="22" rx="13.75" ry="9.375" style="fill:var(--accent)"/><path d="M 86.75 23.5 Q 98 18.25 109.25 22.5" style="fill:none;stroke:var(--accent-2);stroke-width:2.125;stroke-linecap:round"/></g><g transform="rotate(22 22 60)"><ellipse cx="22" cy="60" rx="13.75" ry="9.375" style="fill:var(--accent)"/><path d="M 10.75 61.5 Q 22 56.25 33.25 60.5" style="fill:none;stroke:var(--accent-2);stroke-width:2.125;stroke-linecap:round"/></g><g transform="rotate(0 60 60)"><ellipse cx="60" cy="60" rx="13.75" ry="9.375" style="fill:var(--accent-2)"/><path d="M 48.75 61.5 Q 60 56.25 71.25 60.5" style="fill:none;stroke:var(--accent);stroke-width:2.125;stroke-linecap:round"/></g><g transform="rotate(-22 98 60)"><ellipse cx="98" cy="60" rx="13.75" ry="9.375" style="fill:var(--accent)"/><path d="M 86.75 61.5 Q 98 56.25 109.25 60.5" style="fill:none;stroke:var(--accent-2);stroke-width:2.125;stroke-linecap:round"/></g><g transform="rotate(-14 22 98)"><ellipse cx="22" cy="98" rx="13.75" ry="9.375" style="fill:var(--accent)"/><path d="M 10.75 99.5 Q 22 94.25 33.25 98.5" style="fill:none;stroke:var(--accent-2);stroke-width:2.125;stroke-linecap:round"/></g><g transform="rotate(24 60 98)"><ellipse cx="60" cy="98" rx="13.75" ry="9.375" style="fill:var(--accent)"/><path d="M 48.75 99.5 Q 60 94.25 71.25 98.5" style="fill:none;stroke:var(--accent-2);stroke-width:2.125;stroke-linecap:round"/></g><g transform="rotate(-30 98 98)"><ellipse cx="98" cy="98" rx="13.75" ry="9.375" style="fill:var(--accent)"/><path d="M 86.75 99.5 Q 98 94.25 109.25 98.5" style="fill:none;stroke:var(--accent-2);stroke-width:2.125;stroke-linecap:round"/></g>';
  var SUDOKU_MINI_RAW = '<g transform="translate(60 60) scale(1.27) translate(-60 -60)"><g transform="rotate(-22 36 36)"><ellipse cx="36" cy="36" rx="17.05" ry="11.625" style="fill:var(--accent-2)"/><path d="M 22.05 37.86 Q 36 31.35 49.95 36.62" style="fill:none;stroke:var(--accent);stroke-width:3.1;stroke-linecap:round"/></g><g transform="rotate(18 84 36)"><ellipse cx="84" cy="36" rx="17.05" ry="11.625" style="fill:var(--accent)"/><path d="M 70.05 37.86 Q 84 31.35 97.95 36.62" style="fill:none;stroke:var(--accent-2);stroke-width:3.1;stroke-linecap:round"/></g><g transform="rotate(14 36 84)"><ellipse cx="36" cy="84" rx="17.05" ry="11.625" style="fill:var(--accent)"/><path d="M 22.05 85.86 Q 36 79.35 49.95 84.62" style="fill:none;stroke:var(--accent-2);stroke-width:3.1;stroke-linecap:round"/></g><g transform="rotate(-26 84 84)"><ellipse cx="84" cy="84" rx="17.05" ry="11.625" style="fill:var(--accent-2)"/><path d="M 70.05 85.86 Q 84 79.35 97.95 84.62" style="fill:none;stroke:var(--accent);stroke-width:3.1;stroke-linecap:round"/></g></g>';
  var RACIMO_LOGO = csvg('<circle cx="60" cy="21" r="18" fill="#cf2a2a"/><circle cx="93.8" cy="40.5" r="18" fill="#cf2a2a"/><circle cx="26.2" cy="40.5" r="18" fill="#cf2a2a"/><circle cx="93.8" cy="79.5" r="18" fill="#cf2a2a"/><circle cx="26.2" cy="79.5" r="18" fill="#cf2a2a"/><circle cx="60" cy="99" r="18" fill="#cf2a2a"/><circle cx="60" cy="60" r="18" fill="#548C4C"/>');
  var FLECHAS_CLASICO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><path fill="#136B60" d="M280.74,0H19.26C8.62,0,0,8.62,0,19.26v261.49c0,10.63,8.62,19.26,19.26,19.26h261.49c10.63,0,19.26-8.62,19.26-19.26V19.26C300,8.62,291.38,0,280.74,0ZM284.45,271.87c0,6.95-5.63,12.58-12.58,12.58H28.13c-6.95,0-12.58-5.63-12.58-12.58V28.13c0-6.95,5.63-12.58,12.58-12.58h243.74c6.95,0,12.58,5.63,12.58,12.58v243.74Z"/><rect fill="#EAF1F0" x="15.55" y="15.55" width="268.9" height="268.9" rx="12.58" ry="12.58"/><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="15.55 66.93 48.44 66.93 48.44 38.77"/><polygon fill="#393c3f" points="58.61 50.72 48.44 40.54 38.27 50.72 38.27 42.08 48.44 31.91 58.61 42.08 58.61 50.72"/></g><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="15.55 92.44 61.49 92.44 61.49 140.15 35.96 140.15"/><polygon fill="#393c3f" points="47.91 129.98 37.73 140.15 47.91 150.32 39.27 150.32 29.1 140.15 39.27 129.98 47.91 129.98"/></g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="15.55 170.19 61.49 170.19 61.49 212.01 130.01 212.01 130.01 284.45"/><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="15.55 203.76 38.52 203.76 38.52 255.21"/><polygon fill="#393c3f" points="28.35 243.26 38.52 253.44 48.7 243.26 48.7 251.9 38.52 262.07 28.35 251.9 28.35 243.26"/></g><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="61.49 284.45 61.49 236.74 99.99 236.74"/><polygon fill="#393c3f" points="88.04 246.92 98.22 236.74 88.04 226.57 96.67 226.57 106.85 236.74 96.67 246.92 88.04 246.92"/></g><line fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" x1="206.44" y1="284.45" x2="206.44" y2="232.92"/><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="231.12 284.45 231.12 210.83 183.24 210.83 183.24 232.92 163.29 232.92 163.29 255.21"/><polygon fill="#393c3f" points="153.12 243.26 163.29 253.44 173.46 243.26 173.46 251.9 163.29 262.07 153.12 251.9 153.12 243.26"/></g><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="84.17 15.55 84.17 66.93 111.56 66.93 111.56 96.98"/><polygon fill="#393c3f" points="101.39 85.02 111.56 95.2 121.73 85.02 121.73 93.66 111.56 103.83 101.39 93.66 101.39 85.02"/></g><g><line fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" x1="141.01" y1="15.55" x2="141.01" y2="57.31"/><polygon fill="#393c3f" points="130.84 45.36 141.01 55.54 151.18 45.36 151.18 54 141.01 64.17 130.84 54 130.84 45.36"/></g><g><line fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" x1="193.61" y1="96.95" x2="193.61" y2="62.48"/><polygon fill="#393c3f" points="203.78 74.43 193.61 64.25 183.44 74.43 183.44 65.79 193.61 55.62 203.78 65.79 203.78 74.43"/></g><line fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" x1="176.35" y1="39.86" x2="176.35" y2="15.55"/><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="210.87 15.55 210.87 49.42 239.37 49.42 239.37 130.73 263.52 130.73 263.52 160.76 239.91 160.76 239.91 189.98 263.52 189.98 263.52 245.47"/><polygon fill="#393c3f" points="253.35 233.52 263.52 243.7 273.69 233.52 273.69 242.16 263.52 252.33 253.35 242.16 253.35 233.52"/></g><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="284.45 107.42 263.52 107.42 263.52 38.77"/><polygon fill="#393c3f" points="273.69 50.72 263.52 40.54 253.35 50.72 253.35 42.08 263.52 31.91 273.69 42.08 273.69 50.72"/></g><g><g><path fill="#136B60" d="M150,126.71c-12.85,0-23.29,10.44-23.29,23.29s10.44,23.29,23.29,23.29,23.29-10.44,23.29-23.29-10.44-23.29-23.29-23.29ZM148.23,143.09c-2.89,0-5.3,2.41-5.3,5.3h-7.71c.16-7.23,5.94-13.01,13.01-13.01v7.71Z"/><path fill="#136B60" d="M220.67,145.18c-7.87-9.8-35.98-41.76-70.67-41.76s-62.8,31.96-70.67,41.76c-2.25,2.73-2.25,6.75,0,9.64,7.87,9.8,35.98,41.76,70.67,41.76s62.8-31.96,70.67-41.76c2.25-2.73,2.25-6.75,0-9.64ZM150,183.73c-18.63,0-33.73-15.1-33.73-33.73s15.1-33.73,33.73-33.73,33.73,15.1,33.73,33.73-15.1,33.73-33.73,33.73Z"/></g><circle fill="#EAF1F0" cx="138.36" cy="138.36" r="11.64"/></g></svg>';
  var FLECHAS_CASCADA = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><path fill="#3a7fd9" d="M280.74,0H19.26C8.62,0,0,8.62,0,19.26v261.49c0,10.63,8.62,19.26,19.26,19.26h261.49c10.63,0,19.26-8.62,19.26-19.26V19.26C300,8.62,291.38,0,280.74,0ZM284.45,271.87c0,6.95-5.63,12.58-12.58,12.58H28.13c-6.95,0-12.58-5.63-12.58-12.58V28.13c0-6.95,5.63-12.58,12.58-12.58h243.74c6.95,0,12.58,5.63,12.58,12.58v243.74Z"/><rect fill="#eaf3ff" x="15.55" y="15.55" width="268.9" height="268.9" rx="12.58" ry="12.58"/><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="15.55 66.93 48.44 66.93 48.44 38.77"/><polygon fill="#393c3f" points="58.61 50.72 48.44 40.54 38.27 50.72 38.27 42.08 48.44 31.91 58.61 42.08 58.61 50.72"/></g><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="15.55 92.44 61.49 92.44 61.49 140.15 35.96 140.15"/><polygon fill="#393c3f" points="47.91 129.98 37.73 140.15 47.91 150.32 39.27 150.32 29.1 140.15 39.27 129.98 47.91 129.98"/></g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="15.55 170.19 61.49 170.19 61.49 212.01 130.01 212.01 130.01 284.45"/><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="15.55 203.76 38.52 203.76 38.52 255.21"/><polygon fill="#393c3f" points="28.35 243.26 38.52 253.44 48.7 243.26 48.7 251.9 38.52 262.07 28.35 251.9 28.35 243.26"/></g><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="61.49 284.45 61.49 236.74 99.99 236.74"/><polygon fill="#393c3f" points="88.04 246.92 98.22 236.74 88.04 226.57 96.67 226.57 106.85 236.74 96.67 246.92 88.04 246.92"/></g><line fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" x1="206.44" y1="284.45" x2="206.44" y2="232.92"/><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="231.12 284.45 231.12 210.83 183.24 210.83 183.24 232.92 163.29 232.92 163.29 255.21"/><polygon fill="#393c3f" points="153.12 243.26 163.29 253.44 173.46 243.26 173.46 251.9 163.29 262.07 153.12 251.9 153.12 243.26"/></g><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="84.17 15.55 84.17 66.93 111.56 66.93 111.56 96.98"/><polygon fill="#393c3f" points="101.39 85.02 111.56 95.2 121.73 85.02 121.73 93.66 111.56 103.83 101.39 93.66 101.39 85.02"/></g><g><line fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" x1="141.01" y1="15.55" x2="141.01" y2="57.31"/><polygon fill="#393c3f" points="130.84 45.36 141.01 55.54 151.18 45.36 151.18 54 141.01 64.17 130.84 54 130.84 45.36"/></g><g><line fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" x1="193.61" y1="96.95" x2="193.61" y2="62.48"/><polygon fill="#393c3f" points="203.78 74.43 193.61 64.25 183.44 74.43 183.44 65.79 193.61 55.62 203.78 65.79 203.78 74.43"/></g><line fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" x1="176.35" y1="39.86" x2="176.35" y2="15.55"/><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="210.87 15.55 210.87 49.42 239.37 49.42 239.37 130.73 263.52 130.73 263.52 160.76 239.91 160.76 239.91 189.98 263.52 189.98 263.52 245.47"/><polygon fill="#393c3f" points="253.35 233.52 263.52 243.7 273.69 233.52 273.69 242.16 263.52 252.33 253.35 242.16 253.35 233.52"/></g><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="284.45 107.42 263.52 107.42 263.52 38.77"/><polygon fill="#393c3f" points="273.69 50.72 263.52 40.54 253.35 50.72 253.35 42.08 263.52 31.91 273.69 42.08 273.69 50.72"/></g><g><g><path fill="#3a7fd9" d="M160.62,108.53c-.95-.06-1.9.22-2.66.8l-7.97,6.16-7.97-6.16c-.85-.63-1.92-.91-2.97-.77-2.19.35-3.68,2.4-3.33,4.59.16,1.01.71,1.93,1.52,2.55l8.89,6.64v10.3c-3.47.83-6.62,2.68-9.03,5.31l-8.97-5.31-1.27-11.02c-.25-2.18-2.23-3.75-4.41-3.5-.05,0-.1.01-.15.02-2.17.25-3.73,2.21-3.48,4.38,0,0,0,.02,0,.03l1.17,10.06-9.29,4.12c-2.02.87-2.96,3.22-2.08,5.24s3.22,2.96,5.24,2.08l10.17-4.38,8.95,5.02c-1.06,3.41-1.06,7.05,0,10.46l-8.95,5.15-10.17-4.38c-2.03-.87-4.38.07-5.26,2.1-.87,2.03.07,4.38,2.1,5.26l9.29,3.98-1.17,10.06c-.34,2.16,1.14,4.18,3.3,4.52.06,0,.12.02.18.02,2.18.27,4.17-1.29,4.43-3.47,0,0,0,0,0,0l1.27-11.02,8.97-5.18c2.41,2.63,5.55,4.48,9.03,5.31v10.3l-8.89,6.64c-1.76,1.32-2.12,3.82-.8,5.58,1.32,1.76,3.82,2.12,5.58.8l8.1-6.16,7.97,6.03c1.76,1.32,4.26.96,5.58-.8,1.32-1.76.96-4.26-.8-5.58l-8.89-6.64v-10.3c3.47-.83,6.62-2.68,9.03-5.31l8.97,5.18,1.27,11.02c.18,2.19,2.1,3.82,4.3,3.64.09,0,.18-.02.27-.03,2.17-.25,3.73-2.21,3.48-4.38,0,0,0-.02,0-.03l-1.17-10.06,9.29-4.12c2.02-.87,2.96-3.22,2.08-5.24s-3.22-2.96-5.24-2.08l-10.17,4.38-8.95-5.02c1.06-3.41,1.06-7.05,0-10.46l8.95-5.15,10.17,4.38c2.03.87,4.38-.07,5.26-2.1.87-2.03-.07-4.38-2.1-5.26l-9.29-3.98,1.17-10.06c.34-2.16-1.14-4.18-3.3-4.52-.06,0-.12-.02-.18-.02-2.18-.27-4.17,1.29-4.43,3.47,0,0,0,0,0,0l-1.27,11.02-8.97,5.31c-2.41-2.63-5.55-4.48-9.03-5.31v-10.3l8.89-6.64c1.76-1.32,2.12-3.81.8-5.57-.72-.97-1.85-1.55-3.06-1.59h0ZM150,140.15c5.44,0,9.85,4.41,9.85,9.85s-4.41,9.85-9.85,9.85-9.85-4.41-9.85-9.85,4.41-9.85,9.85-9.85h0Z"/><path fill="#3a7fd9" d="M150,78.31c-5.87,0-10.62,4.75-10.62,10.62s4.75,10.62,10.62,10.62,10.62-4.75,10.62-10.62-4.75-10.62-10.62-10.62Z"/><path fill="#3a7fd9" d="M150,221.69c-5.87,0-10.62-4.75-10.62-10.62s4.75-10.62,10.62-10.62,10.62,4.75,10.62,10.62-4.75,10.62-10.62,10.62Z"/><path fill="#3a7fd9" d="M212.07,114.16c-2.88-5.11-9.36-6.91-14.47-4.03s-6.91,9.36-4.03,14.47c2.88,5.11,9.36,6.91,14.47,4.03.06-.03.12-.07.18-.1,4.98-2.94,6.69-9.33,3.85-14.36Z"/><path fill="#3a7fd9" d="M87.93,185.84c-2.95-5.07-1.22-11.57,3.85-14.52,5.07-2.95,11.57-1.22,14.52,3.85,2.95,5.07,1.22,11.57-3.85,14.52-.08.04-.15.09-.23.13-5.05,2.77-11.39,1-14.28-3.98Z"/><path fill="#3a7fd9" d="M87.93,114.16c2.88-5.11,9.36-6.91,14.47-4.03,5.11,2.88,6.91,9.36,4.03,14.47-2.88,5.11-9.36,6.91-14.47,4.03-.06-.03-.12-.07-.18-.1-4.98-2.94-6.69-9.33-3.85-14.36Z"/><path fill="#3a7fd9" d="M212.07,185.84c2.95-5.07,1.22-11.57-3.85-14.52s-11.57-1.22-14.52,3.85c-2.95,5.07-1.22,11.57,3.85,14.52.08.04.15.09.23.13,5.05,2.77,11.39,1,14.28-3.98Z"/></g><line stroke="#3a7fd9" stroke-miterlimit="10" stroke-width="4px" fill="none" x1="97.18" y1="119.38" x2="120" y2="132.61"/><line stroke="#3a7fd9" stroke-miterlimit="10" stroke-width="4px" fill="none" x1="202.82" y1="119.38" x2="180.02" y2="132.61"/><line stroke="#3a7fd9" stroke-miterlimit="10" stroke-width="4px" fill="none" x1="150" y1="184.38" x2="150" y2="211.07"/><line stroke="#3a7fd9" stroke-miterlimit="10" stroke-width="4px" fill="none" x1="150" y1="88.93" x2="150" y2="116.3"/><line stroke="#3a7fd9" stroke-miterlimit="10" stroke-width="4px" fill="none" x1="97.11" y1="180.51" x2="120" y2="167.4"/><line stroke="#3a7fd9" stroke-miterlimit="10" stroke-width="4px" fill="none" x1="180.02" y1="167.4" x2="202.89" y2="180.51"/></g></svg>';
  var FLECHAS_BORDE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><path fill="#8754ba" d="M280.74,0H19.26C8.62,0,0,8.62,0,19.26v261.49c0,10.63,8.62,19.26,19.26,19.26h261.49c10.63,0,19.26-8.62,19.26-19.26V19.26C300,8.62,291.38,0,280.74,0ZM284.45,271.87c0,6.95-5.63,12.58-12.58,12.58H28.13c-6.95,0-12.58-5.63-12.58-12.58V28.13c0-6.95,5.63-12.58,12.58-12.58h243.74c6.95,0,12.58,5.63,12.58,12.58v243.74Z"/><rect fill="#f3eaf8" x="15.55" y="15.55" width="268.9" height="268.9" rx="12.58" ry="12.58"/><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="15.55 66.93 48.44 66.93 48.44 38.77"/><polygon fill="#393c3f" points="58.61 50.72 48.44 40.54 38.27 50.72 38.27 42.08 48.44 31.91 58.61 42.08 58.61 50.72"/></g><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="15.55 92.44 61.49 92.44 61.49 140.15 35.96 140.15"/><polygon fill="#393c3f" points="47.91 129.98 37.73 140.15 47.91 150.32 39.27 150.32 29.1 140.15 39.27 129.98 47.91 129.98"/></g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="15.55 170.19 61.49 170.19 61.49 212.01 130.01 212.01 130.01 284.45"/><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="15.55 203.76 38.52 203.76 38.52 255.21"/><polygon fill="#393c3f" points="28.35 243.26 38.52 253.44 48.7 243.26 48.7 251.9 38.52 262.07 28.35 251.9 28.35 243.26"/></g><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="61.49 284.45 61.49 236.74 99.99 236.74"/><polygon fill="#393c3f" points="88.04 246.92 98.22 236.74 88.04 226.57 96.67 226.57 106.85 236.74 96.67 246.92 88.04 246.92"/></g><line fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" x1="206.44" y1="284.45" x2="206.44" y2="232.92"/><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="231.12 284.45 231.12 210.83 183.24 210.83 183.24 232.92 163.29 232.92 163.29 255.21"/><polygon fill="#393c3f" points="153.12 243.26 163.29 253.44 173.46 243.26 173.46 251.9 163.29 262.07 153.12 251.9 153.12 243.26"/></g><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="84.17 15.55 84.17 66.93 111.56 66.93 111.56 96.98"/><polygon fill="#393c3f" points="101.39 85.02 111.56 95.2 121.73 85.02 121.73 93.66 111.56 103.83 101.39 93.66 101.39 85.02"/></g><g><line fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" x1="141.01" y1="15.55" x2="141.01" y2="57.31"/><polygon fill="#393c3f" points="130.84 45.36 141.01 55.54 151.18 45.36 151.18 54 141.01 64.17 130.84 54 130.84 45.36"/></g><line fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" x1="176.35" y1="39.86" x2="176.35" y2="15.55"/><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="210.87 15.55 210.87 49.42 239.37 49.42 239.37 130.73 263.52 130.73 263.52 160.76 239.91 160.76 239.91 189.98 263.52 189.98 263.52 245.47"/><polygon fill="#393c3f" points="253.35 233.52 263.52 243.7 273.69 233.52 273.69 242.16 263.52 252.33 253.35 242.16 253.35 233.52"/></g><g><polyline fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" points="284.45 107.42 263.52 107.42 263.52 38.77"/><polygon fill="#393c3f" points="273.69 50.72 263.52 40.54 253.35 50.72 253.35 42.08 263.52 31.91 273.69 42.08 273.69 50.72"/></g><g><rect fill="#8754ba" x="198.17" y="98.87" width="25.39" height="91.12" rx="5.09" ry="5.09"/><path stroke="#f3eaf8" stroke-miterlimit="10" fill="#8754ba" d="M130.06,144.42l-.05-38.21c0-5.65,6.12-9.19,11.01-6.35l33.06,19.15,33.11,19.06c4.9,2.82,4.9,9.89,0,12.71l-33.11,19.06-33.06,19.15c-4.89,2.83-11.01-.7-11.01-6.35l.05-38.21Z"/><path fill="#f3eaf8" d="M137.51,144.42l-.05-34.81c0-1.69,1.83-2.75,3.29-1.9l30.12,17.45,30.17,17.36c1.47.84,1.47,2.96,0,3.8l-30.17,17.36-30.12,17.45c-1.46.85-3.3-.21-3.29-1.9l.05-34.81Z"/><path fill="#8754ba" d="M76.49,144.42l-.05-38.21c0-5.65,6.12-9.19,11.01-6.35l33.06,19.15,33.11,19.06c4.9,2.82,4.9,9.89,0,12.71l-33.11,19.06-33.06,19.15c-4.89,2.83-11.01-.7-11.01-6.35l.05-38.21Z"/></g><g><line fill="none" stroke="#393c3f" stroke-linejoin="round" stroke-width="6px" x1="176.35" y1="105.5" x2="176.35" y2="71.03"/><polygon fill="#393c3f" points="186.52 82.98 176.35 72.8 166.18 82.98 166.18 74.34 176.35 64.17 186.52 74.34 186.52 82.98"/></g></svg>';
  /* same data the hub FAMILIES array uses for each card */
  var CARDS = {
    "palabreo:clasico":  { cat:"Palabreo", ttl:"Cl\u00e1sico",  d:"\u00bfCu\u00e1l es la palabra de hoy?",      bg:"#f4d8d2", logo:palClasico("#CF2A2A") },
    "palabreo:trenza":   { cat:"Palabreo", ttl:"Trenza",   d:"Teje la trenza con intercambios.",  bg:"#f3e3c4", logo:palTrenza("#D99F3B") },
    "palabreo:cuarteto": { cat:"Palabreo", ttl:"Cuarteto", d:"Cuatro palabras a la vez.",         bg:"#f4e2d3", logo:palCuarteto("#d9633b") },
    "sudoku:clasico":    { cat:"Sudoku",   ttl:"Cl\u00e1sico",  d:"\u00bfQu\u00e9 patr\u00f3n encontrar\u00e1s hoy?",     bg:"#f6dac8", logo:csvg(cfill(SUDOKU3_RAW,"#d9633b","#5b3a26")) },
    "sudoku:mini":       { cat:"Sudoku",   ttl:"Mini",     d:"Un sorbo. Tres minutos.",           bg:"#cfe6d5", logo:csvg(cfill(SUDOKU_MINI_RAW,"#548C4C","#2f3640")) },
    "sudoku:niebla":     { cat:"Sudoku",   ttl:"Niebla",   d:"Despeja la niebla, celda a celda.", bg:"#d2dde2", logo:csvg(cfill(SUDOKU3_RAW,"#294f61","#8a5572")) },
    "racimo:":           { cat:"Silueta",  ttl:"Racimo",   d:"Un racimo, muchas palabras.",       bg:"#f4d8d2", logo:RACIMO_LOGO },
    "flechas:clasico":   { cat:"Flechas",  ttl:"Cl\u00e1sico",  d:"Desenreda el tablero.",             bg:"#EAF1F0", logo:FLECHAS_CLASICO },
    "flechas:cascada":   { cat:"Flechas",  ttl:"Cascada",  d:"Despeja antes de que caiga.",       bg:"#EAF3FF", logo:FLECHAS_CASCADA },
    "flechas:borde":     { cat:"Flechas",  ttl:"Borde",    d:"Despeja sin tocar el borde.",       bg:"#F3EAF8", logo:FLECHAS_BORDE }
  };
  function miniCard(game, mode, band){
    var c = CARDS[game + ":" + (mode || "")];
    if (!c) return "";
    var url = game === "racimo" ? "/racimo/" : modeUrl(game, mode);
    return '<a class="cgk-mini" href="' + url + '">'
      + '<div class="cgk-band ' + band + '">' + (band === "hoy" ? "Gratis hoy" : "Gratis") + '</div>'
      + '<div class="p2" style="background:' + c.bg + '"><span class="i2">' + c.logo + '</span></div>'
      + '<div class="cat">' + c.cat + '</div><div class="ttl">' + c.ttl + '</div>'
      + '<div class="d2">' + c.d + '</div>'
      + '<span class="go2">Jugar \u2192</span></a>';
  }
  function showLock(kind, game, mode){
    if (document.getElementById("cgk-ov")) return;
    var fm = freeMode(game);
    var html = '<div class="cgk-panel"><div class="cgk-topband">Premium</div><div class="cgk-inner">';
    if (kind === "anteriores") {
      html += "<h2>El archivo es Premium</h2>"
        + "<p>El puzzle de hoy siempre es gratis. El archivo completo de Anteriores se abre con Premium.</p>";
    } else {
      html += "<h2>" + NAME[game] + " " + (NAME[mode]||"") + " descansa hoy</h2>"
        + "<p>Esto es lo que hoy está abierto para ti:</p>"
        + '<div class="cgk-cards">'
        + miniCard(game, fm, "hoy")
        + (game !== "racimo" ? miniCard("racimo", null, "free") : "")
        + miniCard("palabreo", "clasico", "free")
        + '</div>'
        + comebackHtml(game, mode);
    }
    html += '<div class="cgk-premblock">'
      + '<p class="tx">Con <b>Premium</b> juegas todos los juegos, todos los días, más el archivo de Anteriores.</p>'
      + '<p class="cafe">Menos que un cortadito al mes.</p>'
      + '<a class="cgk-btn plum" style="margin-bottom:0" href="' + UPGRADE_URL + '" target="_blank" rel="noopener">Hazte Premium →</a>'
      + '</div>'
      + '<button class="cgk-linkbtn" id="cgk-prem">Ya soy Premium</button>'
      + '<a class="cgk-btn white" style="margin-bottom:0" href="/">Ver todos los juegos</a>'
      + '<div class="cgk-note" id="cgk-msg"></div>'
      + "</div></div>";
    var ov = document.createElement("div"); ov.className = "cgk-ov"; ov.id = "cgk-ov"; ov.innerHTML = html;
    document.body.appendChild(ov);
    document.getElementById("cgk-prem").addEventListener("click", function(){ openVerify(ov); });
  }

  /* ---------- email verification form (the four states) ---------- */
  function storedEmail(){
    try{ var p = JSON.parse(localStorage.getItem("cg-premium")||"null"); return (p && p.email) || ""; }catch(e){ return ""; }
  }
  /* until/token come from the worker once the code flow is live (a signed
     30-day grant); without them we fall back to the legacy local 7 days. */
  function grantPremium(email, until, token){
    try{ localStorage.setItem("cg-premium", JSON.stringify({
      email: email,
      until: until || (Date.now() + 7*86400000),
      token: token || null
    })); }catch(e){}
  }
  /* payload: an email string (legacy call sites) or a plain object body */
  function apiPost(path, payload, cb){
    var body = (typeof payload === "string") ? { email: payload } : payload;
    fetch(path, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) })
      .then(function(r){ return r.json(); })
      .then(function(d){ cb(null, d); })
      .catch(function(e){ cb(e); });
  }
  function openVerify(ov){
    var btn = document.getElementById("cgk-prem");
    if (!btn || document.getElementById("cgk-email")) return;
    var wrap = document.createElement("div");
    wrap.innerHTML = '<input class="cgk-input" id="cgk-email" type="email" inputmode="email" autocomplete="email" '
      + 'placeholder="tu@correo.com" value="' + storedEmail().replace(/"/g,"&quot;") + '">'
      + '<button class="cgk-btn dark" id="cgk-check">Verificar</button>'
      + '<div id="cgk-extra"></div>';
    btn.replaceWith(wrap);
    var input = document.getElementById("cgk-email");
    input.focus();
    input.addEventListener("keydown", function(e){ if (e.key === "Enter") check(); });
    document.getElementById("cgk-check").addEventListener("click", check);

    function msg(text, cls){
      var m = document.getElementById("cgk-msg");
      if (m){ m.textContent = text; m.className = "cgk-note" + (cls ? " " + cls : ""); }
    }
    function extra(html){
      var x = document.getElementById("cgk-extra");
      if (x) x.innerHTML = html;
    }
    function upgradeBtn(){
      return '<a class="cgk-btn main" href="' + UPGRADE_URL + '" target="_blank" rel="noopener">Hazte Premium</a>';
    }
    function check(){
      var email = (input.value || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){ msg("Escribe un correo válido.", "warn"); return; }
      msg("Verificando…"); extra("");
      apiPost("/a/premium", email, function(err, d){
        if (err || !d){ msg("No se pudo verificar ahora. Intenta de nuevo.", "warn"); return; }
        if (d.configured === false){ msg("La verificación Premium se activa muy pronto, junto con el lanzamiento."); return; }
        if (!d.ok){
          msg(d.error === "rate" || d.error === "busy"
            ? "Demasiados intentos. Espera un minuto e intenta de nuevo."
            : "No se pudo verificar ahora. Intenta de nuevo.", "warn");
          return;
        }
        if (d.state === "PAID_SUBSCRIBER"){
          if (d.code_required){
            codeStep(email);
          } else {
            grantPremium(email);
            msg("✅ ¡Premium activo! Disfruta.", "ok");
            setTimeout(function(){ ov.remove(); if (here().game === "hub") location.reload(); }, 900);
          }
        } else if (d.state === "FREE_SUBSCRIBER"){
          msg("Ese correo recibe Cortadito.News gratis 💌 — pero este contenido es del Club Premium.");
          extra(upgradeBtn());
        } else if (d.state === "PENDING"){
          msg("Tu suscripción está pendiente de confirmar. Busca nuestro correo, pulsa el enlace y verifica de nuevo aquí.");
          document.getElementById("cgk-check").textContent = "Comprobar de nuevo";
        } else {   /* NOT_SUBSCRIBED */
          msg("Ese correo no está suscrito a Cortadito.News.");
          extra('<button class="cgk-btn main" id="cgk-sub">Suscribirme gratis al boletín</button>');
          var sb = document.getElementById("cgk-sub");
          if (sb) sb.addEventListener("click", function(){
            sb.disabled = true; sb.textContent = "Un momento…";
            apiPost("/a/subscribe", email, function(e2, d2){
              if (e2 || !d2 || !d2.ok){
                sb.disabled = false; sb.textContent = "Suscribirme gratis al boletín";
                msg(d2 && (d2.error === "rate" || d2.error === "busy")
                  ? "Demasiados intentos. Espera un minuto e intenta de nuevo."
                  : "No se pudo completar. Intenta de nuevo.", "warn");
                return;
              }
              if (d2.state === "FREE_SUBSCRIBER"){
                msg("✅ ¡Suscrito! El boletín llega cada mañana. Para desbloquear todos los juegos, hazte Premium.", "ok");
              } else {
                msg("📬 Te enviamos un correo — confirma tu suscripción y el boletín llega cada mañana. Para desbloquear todos los juegos, hazte Premium.", "ok");
              }
              extra(upgradeBtn());
            });
          });
        }
      });
    }

    /* CG-01 step 2: the paid email got a 6-digit code by correo; only the
       code confirmation grants premium. */
    function codeStep(email){
      msg("📬 Te enviamos un código de 6 dígitos a " + email + ". Revisa tu correo (y el spam).");
      wrap.innerHTML = '<input class="cgk-input" id="cgk-code" type="text" inputmode="numeric" '
        + 'autocomplete="one-time-code" maxlength="6" placeholder="123456">'
        + '<button class="cgk-btn dark" id="cgk-confirm">Confirmar código</button>'
        + '<div class="cgk-note"><button type="button" class="cgk-linkbtn" id="cgk-resend" disabled>Reenviar código (60s)</button></div>'
        + '<div id="cgk-extra"></div>';
      var ci = document.getElementById("cgk-code");
      ci.focus();
      ci.addEventListener("keydown", function(e){ if (e.key === "Enter") submitCode(); });
      document.getElementById("cgk-confirm").addEventListener("click", submitCode);

      var rs = document.getElementById("cgk-resend");
      function cooldown(){
        var left = 60; rs.disabled = true; rs.textContent = "Reenviar código (60s)";
        var tick = setInterval(function(){
          left--;
          if (left <= 0){ clearInterval(tick); rs.disabled = false; rs.textContent = "Reenviar código"; }
          else rs.textContent = "Reenviar código (" + left + "s)";
        }, 1000);
      }
      cooldown();
      rs.addEventListener("click", function(){
        if (rs.disabled) return;
        cooldown();
        apiPost("/a/premium", { email: email }, function(){});
        msg("📬 Código reenviado a " + email + ".");
      });

      function submitCode(){
        var code = (ci.value || "").replace(/\D/g, "");
        if (code.length !== 6){ msg("Escribe el código de 6 dígitos.", "warn"); return; }
        msg("Verificando…");
        apiPost("/a/premium-code", { email: email, code: code }, function(err, d){
          if (err || !d){ msg("No se pudo verificar ahora. Intenta de nuevo.", "warn"); return; }
          if (d.granted){
            grantPremium(email, d.until, d.token);
            msg("✅ ¡Premium activo! Disfruta.", "ok");
            setTimeout(function(){ ov.remove(); if (here().game === "hub") location.reload(); }, 900);
            return;
          }
          if (d.error === "code") msg("Código incorrecto. Revísalo e intenta de nuevo.", "warn");
          else if (d.error === "expired") msg("El código expiró. Pulsa “Reenviar código” para recibir uno nuevo.", "warn");
          else if (d.error === "many") msg("Demasiados intentos con este código. Pide uno nuevo.", "warn");
          else if (d.error === "rate") msg("Demasiados intentos. Espera un minuto.", "warn");
          else msg("No se pudo verificar ahora. Intenta de nuevo.", "warn");
        });
      }
    }
  }

  /* ---------- silent weekly re-validation ----------
     Premium is stored per-browser for 7 days. When it has expired (or is
     about to), re-check the stored email in the background: still paid →
     renew quietly (and lift any lock already on screen); no longer paid →
     clear, so the gate applies again. Network errors leave things as-is. */
  function refreshPremium(){
    var p; try{ p = JSON.parse(localStorage.getItem("cg-premium")||"null"); }catch(e){ p = null; }
    if (!p || !p.email) return;

    /* Signed grant (code flow): validate/renew server-side at most every 12h,
       and always when the grant is inside its last day. */
    if (p.token){
      var due = p.until - Date.now() < 86400000;
      var last = 0; try{ last = Number(localStorage.getItem("cg-premium-ck")||0); }catch(e){}
      if (!due && Date.now() - last < 43200000) return;
      apiPost("/a/premium-check", { email: p.email, until: p.until, token: p.token }, function(err, d){
        if (err || !d || !d.ok) return;   /* network/rate trouble: leave things as-is */
        try{ localStorage.setItem("cg-premium-ck", String(Date.now())); }catch(e){}
        if (d.valid === false){
          try{ localStorage.removeItem("cg-premium"); }catch(e){}
          return;
        }
        if (d.renewed) grantPremium(p.email, d.until, d.token);
        var ov = document.getElementById("cgk-ov"); if (ov) ov.remove();
      });
      return;
    }

    /* Legacy 7-day grant (stored before the code flow). silent:1 keeps the
       worker from emailing a code during a background refresh. */
    if (p.until - Date.now() > 86400000) return;   /* fresh — nothing to do */
    apiPost("/a/premium", { email: p.email, silent: true }, function(err, d){
      if (err || !d || !d.ok || !d.state) return;
      if (d.state === "PAID_SUBSCRIBER"){
        if (!d.code_required){
          grantPremium(p.email);
          var ov = document.getElementById("cgk-ov"); if (ov) ov.remove();
        }
        /* code_required: let the legacy grant lapse quietly — the user
           confirms once with the emailed code on their next visit */
      } else {
        try{ localStorage.removeItem("cg-premium"); }catch(e){}
      }
    });
  }

  /* ---------- hub decoration ---------- */
  function decorateHub(){
    /* Subscriber view: NO bands, no "Ver Premium", no filter — a clean game
       library. Just a quiet "Premium activo" pill by the menu, plus a one-time
       welcome banner. Access info (bands/filter) is for non-subscribers only. */
    if (isPremium()){ premiumHub(); return; }

    var cards = document.querySelectorAll("a.card, a.feature");
    cards.forEach(function(a){
      var href = a.getAttribute("href") || "";
      var mm = href.match(/^\/(racimo|palabreo|sudoku|flechas)\/?([a-z]*\.?h?t?m?l?)?(\?modo=([a-z]+))?/);
      if (!mm) return;
      var game = mm[1];
      var mode = mm[4] || (mm[2] ? mm[2].replace(".html","") : null);
      if (game === "flechas") mode = (!mode || mode === "") ? "borde" : mode;
      var anchor = game === "racimo" || (game === "palabreo" && (mode || "clasico") === "clasico");
      var st = anchor ? "free" : (isFree(game, mode) ? "hoy" : "prem");
      a.classList.add("cgk-edge-" + st);
      var band = document.createElement("div");
      band.className = "cgk-band " + st;
      band.textContent = st === "free" ? "Gratis" : (st === "hoy" ? "Gratis hoy" : "Premium");
      a.insertBefore(band, a.firstChild);
      var body = a.querySelector(".cbody"); if (!body) return;   /* featured card: band only */
      var go = body.querySelector(".go");
      if (st === "prem" && go) go.innerHTML = go.innerHTML.replace(/Jugar/, "Ver Premium");
    });

    /* filter bar: Todos · Gratis · Premium */
    var app = document.getElementById("app");
    var firstFam = app && app.querySelector(".fam");
    if (!app || !firstFam) return;
    var bar = document.createElement("div");
    bar.className = "cgk-filter";
    bar.innerHTML = '<button data-f="all" class="on">Todos</button>'
      + '<button data-f="free">Gratis</button>'
      + '<button data-f="prem">Premium</button>';
    app.insertBefore(bar, firstFam);
    function cardSt(a){
      if (a.classList.contains("soon")) return "soon";
      if (a.classList.contains("cgk-edge-free") || a.classList.contains("cgk-edge-hoy")) return "free";
      if (a.classList.contains("cgk-edge-prem")) return "prem";
      return "all";
    }
    function applyFilter(f){
      bar.querySelectorAll("button").forEach(function(b){ b.classList.toggle("on", b.dataset.f === f); });
      app.querySelectorAll(".fam").forEach(function(fam){
        var visible = 0;
        fam.querySelectorAll("a.card").forEach(function(a){
          var st = cardSt(a);
          var show = f === "all" || st === f;
          a.style.display = show ? "" : "none";
          if (show) visible++;
        });
        fam.style.display = visible ? "" : "none";
      });
    }
    bar.addEventListener("click", function(e){
      var b = e.target.closest("button"); if (!b) return;
      applyFilter(b.dataset.f);
    });
  }

  /* ---------- subscriber hub: quiet confirmation, clean cards ---------- */
  function premiumHub(){
    /* "Premium activo ✓" pill next to the menu button */
    var wrap = document.querySelector(".menu-wrap");
    if (wrap){
      var pill = document.createElement("button");
      pill.type = "button";
      pill.className = "cgk-prem-pill";
      pill.innerHTML = '<span class="ck">✓</span><span class="txt">Premium activo</span><span class="txt-s">Premium</span>';
      pill.title = "Premium activo — toca para ver qué incluye";
      pill.setAttribute("aria-label", "Premium activo — ver qué incluye");
      pill.addEventListener("click", showPremiumInfo);
      wrap.insertBefore(pill, wrap.firstChild);
    }
  }

  /* ---------- "Eres Premium" info box (opens from the masthead pill) ---------- */
  function showPremiumInfo(){
    if (document.getElementById("cgk-ov")) return;
    var em = storedEmail();
    var html = '<div class="cgk-panel"><div class="cgk-topband">Premium</div><div class="cgk-inner">'
      + '<h2>Eres Premium ✓</h2>'
      + '<p>Tu cortadito completo, servido cada mañana. Esto es lo que incluye:</p>'
      + '<ul class="cgk-list">'
      + '<li><b>Los diez modos</b> de los cuatro juegos, abiertos <b>todos los días</b> — sin esperar la rotación gratis.</li>'
      + '<li>El <b>archivo de Anteriores</b> completo, en todos los juegos.</li>'
      + '<li>Los <b>juegos y modos nuevos</b> entran directo a tu Premium al salir.</li>'
      + '</ul>'
      + (em ? '<div class="cgk-note" style="margin:0 0 12px">Activo en este navegador como <b>' + em.replace(/</g,"&lt;") + '</b>.</div>' : '')
      + '<p style="font-style:italic;color:#9C3B8E;font-weight:600;font-size:12.5px">Gracias por apoyar a Cortadito. ☕</p>'
      + '<button class="cgk-btn white" id="cgk-pi-close" style="margin-bottom:0">Cerrar</button>'
      + '</div></div>';
    var ov = document.createElement("div"); ov.className = "cgk-ov"; ov.id = "cgk-ov"; ov.innerHTML = html;
    document.body.appendChild(ov);
    document.getElementById("cgk-pi-close").addEventListener("click", function(){ ov.remove(); });
    ov.addEventListener("click", function(e){ if (e.target === ov) ov.remove(); });
  }

  /* ---------- Anteriores chips + gate ---------- */
  function tagAnteriores(){
    var els = document.querySelectorAll("button, a, summary, [role=menuitem], [role=button]");
    els.forEach(function(el){
      if (el._cgkTagged) return;
      var t = (el.textContent || "").trim();
      if (!/^Anteriores\b/i.test(t) || t.length > 24) return;
      el._cgkTagged = true;
      el.addEventListener("click", function(ev){
        if (isPremium()) return;
        ev.preventDefault(); ev.stopImmediatePropagation();
        var h = here(); showLock("anteriores", h.game, h.mode);
      }, true);
    });
  }

  /* ---------- aviso "Sitio para computadoras" ----------
     A phone whose browser has Chrome's per-site "Desktop site" flag on renders
     the page at a ~980px layout viewport shrunk onto a small screen — boards
     land below the fold, headers cram. We can't override the flag, but we can
     tell the player how to fix it. Fires ONLY on: wide layout viewport + small
     physical screen + touch. Dismissal remembered for 7 days. */
  function desktopSiteTip(){
    try{
      if (window.innerWidth < 900) return;                                  /* layout viewport is phone-sized: fine */
      var sw = Math.min(screen.width || 9999, screen.height || 9999);
      if (sw > 500) return;                                                 /* real desktop/tablet screen: fine */
      if (!(navigator.maxTouchPoints > 0)) return;
      if (Number(localStorage.getItem("cg-dsk-tip") || 0) > Date.now() - 7*86400000) return;
      var b = document.createElement("div");
      b.className = "cgk-dsktip";
      b.innerHTML = '<span>📱 ¿Se ve rara la página? Desactiva <b>«Sitio para computadoras»</b> en el menú <b>⋮</b> de tu navegador.</span>'
        + '<button id="cgk-dsk-x" type="button">Entendido</button>';
      document.body.appendChild(b);
      document.getElementById("cgk-dsk-x").addEventListener("click", function(){
        try{ localStorage.setItem("cg-dsk-tip", String(Date.now())); }catch(e){}
        b.remove();
      });
    }catch(e){}
  }

  function boot(){
    var h = here();
    desktopSiteTip();
    /* Nothing visible until the gate is ACTIVE (ENFORCE, or ?cgpreview=1 to
       demo). Before 2026-08-05 the hub's Gratis/Premium bands rendered in
       preview-off mode too — players saw Premium chrome on a product with no
       Premium. (2026-08-11: the ◆ diamond that used to mark "Anteriores" was
       removed at Dre's request — the click itself still gates via showLock.) */
    if (!ACTIVE) return;
    refreshPremium();
    if (h.game === "hub"){ decorateHub(); }
    else {
      if (!isPremium() && !isFree(h.game, h.mode)) showLock("game", h.game, h.mode);
      tagAnteriores();
      setTimeout(tagAnteriores, 1200);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.CGGate = { isFree: isFree, freeMode: freeMode, isPremium: isPremium, pools: POOLS, enforce: ENFORCE };
})();
