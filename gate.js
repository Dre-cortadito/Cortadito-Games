/* Cortadito Games — freemium gate (rotación diaria + Premium).
   Served from the hub at /gate.js; every game and the hub include it.
   ENFORCE=true → gate live. Add ?cgpreview=1 to any URL to demo the lock
   screen even without ENFORCE; ?cgpremium=1 demos the subscriber view.
   Verification: POST /a/premium (worker → BeeHiiv, key server-side only).
   States: PAID_SUBSCRIBER unlocks; FREE_SUBSCRIBER → upgrade CTA; PENDING →
   confirm-your-email; NOT_SUBSCRIBED → in-app signup via POST /a/subscribe. */
(function () {
  var ENFORCE = true;
  var NEWS_URL = "https://cortadito.news/";
  var UPGRADE_URL = "https://cortadito.news/upgrade";
  var PREVIEW = /[?&]cgpreview=1/.test(location.search);
  var PREMDEMO = /[?&]cgpremium=1/.test(location.search);   /* demo the subscriber view */
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
    + ".cgk-dia{color:#c47a3d;font-size:.72em;vertical-align:.12em;margin-left:4px}"
    + ".cgk-band{display:block;width:100%;box-sizing:border-box;flex:none;font:800 11px/1 system-ui,sans-serif;"
    + "letter-spacing:.14em;text-transform:uppercase;color:#fff;text-align:center;padding:7px 10px 6px}"
    + ".cgk-band.free{background:#427C40}"
    + ".cgk-band.hoy{background:#2670B8}"
    + ".cgk-band.prem{background:#9C3B8E}"
    + "a.feature .cgk-band{position:absolute;top:0;left:0;right:0;z-index:2}"
    + "a.card.cgk-edge-prem .go{padding:9px 14px;font-size:13.5px}"
    + ".cgk-prem-pill{display:inline-flex;align-items:center;gap:5px;font:800 11px/1 system-ui,sans-serif;"
    + "letter-spacing:.08em;text-transform:uppercase;color:#fff;background:#9C3B8E;border-radius:999px;"
    + "padding:7px 12px;margin-right:10px;white-space:nowrap}"
    + ".cgk-prem-pill .ck{font-weight:800}"
    + ".menu-wrap{display:flex;align-items:center}"
    + ".cgk-strip{max-width:760px;margin:2px auto 0;padding:0 24px;text-align:center;font:400 13px/1.6 system-ui,sans-serif;color:#8d8580}"
    + ".cgk-strip a{color:inherit;text-decoration:underline;text-underline-offset:2px}"
    + ".cgk-ov{position:fixed;inset:0;z-index:99990;background:rgba(23,18,16,.55);display:flex;align-items:center;justify-content:center;padding:20px}"
    + ".cgk-panel{background:#fff;color:#171210;border-radius:16px;max-width:400px;width:100%;padding:26px 24px;box-shadow:0 30px 80px -30px rgba(0,0,0,.5);"
    + "font-family:system-ui,sans-serif;text-align:center;max-height:88vh;overflow:auto}"
    + ".cgk-panel h2{font-size:20px;margin:0 0 6px}"
    + ".cgk-panel p{font-size:14px;color:#5f5852;margin:0 0 14px}"
    + ".cgk-btn{display:block;width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:0;font-size:15px;font-weight:700;"
    + "cursor:pointer;text-decoration:none;margin-bottom:8px}"
    + ".cgk-btn.main{background:#e35336;color:#fff}"
    + ".cgk-btn.dark{background:#171210;color:#fff}"
    + ".cgk-btn.ghost{background:none;border:1.5px solid #eee2d6;color:#5f5852;font-weight:600}"
    + ".cgk-cal{display:flex;gap:4px;justify-content:center;margin:12px 0 16px}"
    + ".cgk-cal div{flex:1;max-width:48px;background:#F7EFE0;border-radius:8px;padding:6px 2px;font-size:10px;color:#5f5852}"
    + ".cgk-cal div.on{background:#e35336;color:#fff}"
    + ".cgk-cal b{display:block;font-size:10px;margin-top:2px}"
    + ".cgk-note{font-size:11px;color:#8d8580;margin-top:10px}"
    + ".cgk-note.ok{color:#427C40;font-size:13px;font-weight:600}"
    + ".cgk-note.warn{color:#B02E2E;font-size:12px}"
    + ".cgk-input{display:block;width:100%;box-sizing:border-box;padding:11px 12px;border:1.5px solid #eee2d6;"
    + "border-radius:10px;font-size:16px;font-family:inherit;margin-bottom:8px;background:#fff;color:#171210}"
    + ".cgk-input:focus{outline:none;border-color:#171210}"
    + ".cgk-filter{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:26px auto 2px;padding:0 16px}"
    + ".cgk-filter button{font:600 13px/1 system-ui,sans-serif;padding:9px 18px;border-radius:999px;cursor:pointer;"
    + "background:transparent;color:var(--ink,#171210);border:1.5px solid var(--line,#eee2d6);transition:background .15s}"
    + ".cgk-filter button.on{background:var(--ink,#171210);color:var(--bg,#fff);border-color:var(--ink,#171210)}";
  var st = document.createElement("style"); st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  /* ---------- lock overlay ---------- */
  function calendarHtml(fam){
    var out = "";
    for (var i=0;i<7;i++){
      var d = new Date(); d.setDate(d.getDate()+i);
      var m = freeMode(fam, d);
      out += '<div class="'+(i===0?"on":"")+'">'+(i===0?"hoy":DOW[d.getDay()])+"<b>"+NAME[m]+"</b></div>";
    }
    return '<div class="cgk-cal">'+out+"</div>";
  }
  function showLock(kind, game, mode){
    if (document.getElementById("cgk-ov")) return;
    var fm = freeMode(game);
    var html = '<div class="cgk-panel">';
    if (kind === "anteriores") {
      html += "<h2>El archivo es Premium</h2>"
        + "<p>El puzzle de hoy siempre es gratis. Con <b>Premium</b> juegas también todos los Anteriores — cada puzzle que hemos publicado.</p>";
    } else {
      html += "<h2>" + NAME[game] + " " + (NAME[mode]||"") + " descansa hoy</h2>"
        + "<p>Hoy gratis en " + NAME[game] + ": <b>" + NAME[fm] + "</b>. Con <b>Premium</b> juegas todos los juegos, todos los días, más el archivo de Anteriores.</p>"
        + calendarHtml(game)
        + '<a class="cgk-btn main" href="' + modeUrl(game, fm) + '">Jugar ' + NAME[fm] + " gratis</a>";
    }
    html += '<button class="cgk-btn dark" id="cgk-prem">Ya soy Premium</button>'
      + '<a class="cgk-btn ghost" href="/">Ver todos los juegos</a>'
      + '<div class="cgk-note" id="cgk-msg">Racimo y Palabreo Clásico son gratis todos los días.</div>'
      + "</div>";
    var ov = document.createElement("div"); ov.className = "cgk-ov"; ov.id = "cgk-ov"; ov.innerHTML = html;
    document.body.appendChild(ov);
    document.getElementById("cgk-prem").addEventListener("click", function(){ openVerify(ov); });
  }

  /* ---------- email verification form (the four states) ---------- */
  function storedEmail(){
    try{ var p = JSON.parse(localStorage.getItem("cg-premium")||"null"); return (p && p.email) || ""; }catch(e){ return ""; }
  }
  function grantPremium(email){
    try{ localStorage.setItem("cg-premium", JSON.stringify({ email: email, until: Date.now() + 7*86400000 })); }catch(e){}
  }
  function apiPost(path, email, cb){
    fetch(path, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ email: email }) })
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
          grantPremium(email);
          msg("✅ ¡Premium activo! Disfruta.", "ok");
          setTimeout(function(){ ov.remove(); if (here().game === "hub") location.reload(); }, 900);
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
  }

  /* ---------- silent weekly re-validation ----------
     Premium is stored per-browser for 7 days. When it has expired (or is
     about to), re-check the stored email in the background: still paid →
     renew quietly (and lift any lock already on screen); no longer paid →
     clear, so the gate applies again. Network errors leave things as-is. */
  function refreshPremium(){
    var p; try{ p = JSON.parse(localStorage.getItem("cg-premium")||"null"); }catch(e){ p = null; }
    if (!p || !p.email) return;
    if (p.until - Date.now() > 86400000) return;   /* fresh — nothing to do */
    apiPost("/a/premium", p.email, function(err, d){
      if (err || !d || !d.ok || !d.state) return;
      if (d.state === "PAID_SUBSCRIBER"){
        grantPremium(p.email);
        var ov = document.getElementById("cgk-ov"); if (ov) ov.remove();
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
      var pill = document.createElement("span");
      pill.className = "cgk-prem-pill";
      pill.innerHTML = '<span class="ck">✓</span>Premium activo';
      wrap.insertBefore(pill, wrap.firstChild);
    }
  }

  /* ---------- Anteriores chips + gate ---------- */
  function tagAnteriores(){
    var els = document.querySelectorAll("button, a, summary, [role=menuitem], [role=button]");
    els.forEach(function(el){
      if (el._cgkTagged) return;
      var t = (el.textContent || "").trim();
      if (!/^Anteriores\b/i.test(t) || t.length > 24) return;
      el._cgkTagged = true;
      var dia = document.createElement("span");
      dia.className = "cgk-dia"; dia.textContent = "\u25C6"; dia.title = "Premium";
      el.appendChild(dia);
      el.addEventListener("click", function(ev){
        if (isPremium()) return;
        ev.preventDefault(); ev.stopImmediatePropagation();
        var h = here(); showLock("anteriores", h.game, h.mode);
      }, true);
    });
  }

  function boot(){
    var h = here();
    /* Nothing visible until the gate is ACTIVE (ENFORCE, or ?cgpreview=1 to
       demo). Before 2026-08-05 the ◆ diamond on "Anteriores" and the hub's
       Gratis/Premium bands rendered in preview-off mode too — players saw
       Premium chrome on a product with no Premium. */
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
