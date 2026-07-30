/* Cortadito Games — freemium gate (rotación diaria + Premium).
   Served from the hub at /gate.js; every game and the hub include it.
   ENFORCE=false → preview mode: badges and calendar are visible, nothing is
   blocked. Add ?cgpreview=1 to any URL to demo the real lock screen.
   Flip ENFORCE to true (one line, hub deploy) on Premium launch day. */
(function () {
  var ENFORCE = false;
  var PREVIEW = /[?&]cgpreview=1/.test(location.search);
  var ACTIVE = ENFORCE || PREVIEW;

  var POOLS = {
    palabreo: ["trenza", "cuarteto"],
    sudoku: ["clasico", "niebla", "mini"],
    flechas: ["borde", "cascada", "clasico", "desvio", "rumbo", "flujo"]
  };
  var NAME = { racimo:"Racimo", palabreo:"Palabreo", sudoku:"Sudoku", flechas:"Flechas",
    clasico:"Clásico", trenza:"Trenza", cuarteto:"Cuarteto", niebla:"Niebla", mini:"Mini",
    borde:"Borde", cascada:"Cascada", desvio:"Desvío", rumbo:"Rumbo", flujo:"Flujo" };
  var DOW = ["dom","lun","mar","mié","jue","vie","sáb"];

  function fnv(s){ var h=2166136261; for (var i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
  function dayStr(d){ d=d||new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
  function freeMode(fam, d){ var p=POOLS[fam]; if(!p) return null; return p[fnv(dayStr(d)+":"+fam)%p.length]; }
  function isPremium(){ try{ var p=JSON.parse(localStorage.getItem("cg-premium")||"null"); return !!(p && p.until>Date.now()); }catch(e){ return false; } }
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
    + ".cgk-status{display:block;font:700 11px/1.4 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;margin:auto 0 0;padding-top:20px}"
    + ".modes .card .desc{min-height:2.9em}"
    + ".cgk-status.prem{color:#9a6b2f}"
    + ".cgk-status.hoy{color:#e35336}"
    + ".cbody:has(.cgk-status) .go{margin-top:12px}"
    + ".cbody:not(:has(.cgk-status)) .go{margin-top:auto}"
    + ".cbody:has(.cgk-status.prem) .go{padding:9px 14px;font-size:13.5px}"
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
    + ".cgk-note{font-size:11px;color:#8d8580;margin-top:10px}";
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
        + "<p>Hoy gratis en " + NAME[game] + ": <b>" + NAME[fm] + "</b>. Con <b>Premium</b> juegas los 12 juegos todos los días, más el archivo de Anteriores.</p>"
        + calendarHtml(game)
        + '<a class="cgk-btn main" href="' + modeUrl(game, fm) + '">Jugar ' + NAME[fm] + " gratis</a>";
    }
    html += '<button class="cgk-btn dark" id="cgk-prem">Ya soy Premium</button>'
      + '<a class="cgk-btn ghost" href="/">Ver todos los juegos</a>'
      + '<div class="cgk-note" id="cgk-msg">Racimo y Palabreo Clásico son gratis todos los días.</div>'
      + "</div>";
    var ov = document.createElement("div"); ov.className = "cgk-ov"; ov.id = "cgk-ov"; ov.innerHTML = html;
    document.body.appendChild(ov);
    document.getElementById("cgk-prem").addEventListener("click", function(){
      var email = prompt("Tu correo de suscriptor de Cortadito.News:");
      if (!email) return;
      fetch("/a/premium?email=" + encodeURIComponent(email.trim()))
        .then(function(r){ return r.json(); })
        .then(function(d){
          var msg = document.getElementById("cgk-msg");
          if (d && d.premium){
            try{ localStorage.setItem("cg-premium", JSON.stringify({ email: email.trim(), until: Date.now() + 7*86400000 })); }catch(e){}
            msg.textContent = "✅ ¡Premium activo! Disfruta.";
            setTimeout(function(){ ov.remove(); }, 900);
          } else if (d && d.configured === false){
            msg.textContent = "La verificación Premium se activa muy pronto, junto con el lanzamiento.";
          } else {
            msg.textContent = "No encontramos una suscripción Premium con ese correo.";
          }
        }).catch(function(){ document.getElementById("cgk-msg").textContent = "No se pudo verificar ahora. Intenta de nuevo."; });
    });
  }

  /* ---------- hub decoration ---------- */
  function decorateHub(){
    var cards = document.querySelectorAll("a.card, a.feature");
    cards.forEach(function(a){
      var href = a.getAttribute("href") || "";
      var mm = href.match(/^\/(racimo|palabreo|sudoku|flechas)\/?([a-z]*\.?h?t?m?l?)?(\?modo=([a-z]+))?/);
      if (!mm) return;
      var game = mm[1];
      var mode = mm[4] || (mm[2] ? mm[2].replace(".html","") : null);
      if (game === "flechas") mode = (!mode || mode === "") ? "borde" : mode;
      var anchor = game === "racimo" || (game === "palabreo" && (mode || "clasico") === "clasico");
      if (anchor) return;                       /* free is the normal state — no label */
      var body = a.querySelector(".cbody"); if (!body) return;
      var go = body.querySelector(".go");
      var status = document.createElement("span");
      if (isFree(game, mode)){
        status.className = "cgk-status hoy"; status.textContent = "Gratis hoy";
      } else {
        status.className = "cgk-status prem"; status.textContent = "Premium";
        if (go) go.innerHTML = go.innerHTML.replace(/Jugar/, "Ver Premium");
      }
      if (go) body.insertBefore(status, go); else body.appendChild(status);
    });

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
      if (ACTIVE){
        el.addEventListener("click", function(ev){
          if (isPremium()) return;
          ev.preventDefault(); ev.stopImmediatePropagation();
          var h = here(); showLock("anteriores", h.game, h.mode);
        }, true);
      }
    });
  }

  function boot(){
    var h = here();
    if (h.game === "hub"){ decorateHub(); }
    else {
      if (ACTIVE && !isPremium() && !isFree(h.game, h.mode)) showLock("game", h.game, h.mode);
      tagAnteriores();
      setTimeout(tagAnteriores, 1200);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.CGGate = { isFree: isFree, freeMode: freeMode, isPremium: isPremium, pools: POOLS, enforce: ENFORCE };
})();
