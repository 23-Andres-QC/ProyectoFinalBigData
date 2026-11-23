// Base de la intranet: utilidades, menú de vistas, mapa compartido, selector de distritos y edificios de cada distrito.
if (!D) {
  document.body.innerHTML = '<p style="padding:24px;font:15px system-ui">Esta es solo la plantilla, sin datos. Abra la app web <b>mapa-validacion</b> ' +
    'en Databricks, o <b>mapa_validacion.html</b> (se genera con <code>python validacion_mapa/generar_mapa.py</code>).</p>';
  throw new Error("plantilla sin datos");
}
const $ = (id) => document.getElementById(id);

// ---------------- utilidades ----------------
const fmt = (v, d = 2) => (v == null || Number.isNaN(v) ? "—" : typeof v === "number" ? v.toLocaleString("es-PE", { maximumFractionDigits: d }) : v);
const corto = (n) => (n >= 1e6 ? fmt(n / 1e6, 1) + " M" : n >= 1e4 ? fmt(n / 1e3, 0) + " mil" : fmt(n, 0));
const porc = (a, b, d = 1) => (b ? `${fmt(100 * a / b, d)} %` : "—");
const MENORES = new Set(["de", "del", "la", "las", "los", "y", "el"]);
const titulo = (s) => String(s).toLowerCase().split(" ").map((p, k) => (k > 0 && MENORES.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const VIRIDIS = ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"];
const MAGMA = ["#000004", "#51127c", "#b73779", "#fc8961", "#fcfdbf"];
const DIVERGENTE = ["#2166ac", "#67a9cf", "#f7f7f7", "#ef8a62", "#b2182b"];
const CATS = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac"];
const TIPOLOGIA = { adobe: "Adobe", albanileria_confinada: "Albañilería confinada", albanileria_no_reforzada: "Albañilería no reforzada",
  concreto_armado: "Concreto armado", concreto_armado_dul: "Concreto armado dúctil", madera: "Madera", quincha: "Quincha" };
const nombreTipologia = (t) => (t == null ? "—" : TIPOLOGIA[t] || t);
function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function rampa(colores) {
  const rgb = colores.map(hex2rgb);
  return (t) => {
    if (t == null || Number.isNaN(t)) return "#999";
    t = Math.max(0, Math.min(1, t)) * (rgb.length - 1);
    const i = Math.min(Math.floor(t), rgb.length - 2), f = t - i;
    const c = rgb[i].map((a, k) => Math.round(a + (rgb[i + 1][k] - a) * f));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  };
}
function cuantil(arr, q) {
  const v = arr.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return 0;
  return v[Math.min(v.length - 1, Math.floor(q * (v.length - 1)))];
}
// Escala continua con dominio robusto (p2–p98) o fijo.
function escalaContinua(valores, colores, dominio, log) {
  let [a, b] = dominio || [cuantil(valores, 0.02), cuantil(valores, 0.98)];
  if (a === b) b = a + 1;
  const f = rampa(colores), tr = log ? (x) => Math.log10(Math.max(x, 1e-6)) : (x) => x, ta = tr(a), tb = tr(b);
  return { color: (v) => (v == null ? "#999" : f((tr(v) - ta) / (tb - ta))), min: a, max: b, colores, log };
}
const merc = (lon, lat) => {
  const s = Math.sin(lat * Math.PI / 180);
  return [(lon + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
};
function tablaPopup(tit, filas) {
  return `<div class="popup-titulo">${tit}</div><table>${filas.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>`;
}
const enlaces = (lat, lon, osmId) =>
  `<div style="margin-top:6px"><a target="_blank" rel="noopener" href="https://www.google.com/maps/@${lat},${lon},120a,35y,0h,65t/data=!3m1!1e3">Google Maps 3D</a>` +
  ` · <a target="_blank" rel="noopener" href="https://www.google.com/maps?q=&layer=c&cbll=${lat},${lon}">Street View</a>` +
  (osmId ? ` · <a target="_blank" rel="noopener" href="https://www.openstreetmap.org/way/${osmId}">OSM</a>` : "") + "</div>";
function toast(txt) { const t = $("toast"); t.textContent = txt; t.style.display = "block"; clearTimeout(toast.h); toast.h = setTimeout(() => { t.style.display = "none"; }, 2800); }

// ---------------- gráficos en canvas ----------------
function lienzo(id) {
  const c = $(id);
  if (!c || !c.clientWidth || !c.clientHeight) return null;
  const r = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * r) || c.height !== Math.round(h * r)) { c.width = Math.round(w * r); c.height = Math.round(h * r); }
  const ctx = c.getContext("2d");
  ctx.setTransform(r, 0, 0, r, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}
function marcasLineales(a, b, n = 5) {
  const paso0 = (b - a) / n, mag = 10 ** Math.floor(Math.log10(paso0)), paso = [1, 2, 5, 10].map((m) => m * mag).find((p) => p >= paso0);
  const out = [];
  for (let v = Math.ceil(a / paso) * paso; v <= b + 1e-9; v += paso) out.push(+v.toFixed(10));
  return out;
}
// Gráfico de líneas, áreas apiladas, bandas y marcas verticales u horizontales en un canvas.
function grafico(id, op) {
  const L0 = lienzo(id);
  if (!L0) return null;
  const { ctx, w, h } = L0, m = { l: 46, r: 10, t: 10, b: 22 };
  const X = (v) => m.l + (op.logx ? (Math.log10(v) - Math.log10(op.x[0])) / (Math.log10(op.x[1]) - Math.log10(op.x[0])) : (v - op.x[0]) / (op.x[1] - op.x[0])) * (w - m.l - m.r);
  const Y = (v) => h - m.b - (op.logy ? (Math.log10(v) - Math.log10(op.y[0])) / (Math.log10(op.y[1]) - Math.log10(op.y[0])) : (v - op.y[0]) / (op.y[1] - op.y[0])) * (h - m.t - m.b);
  ctx.font = "10px Inter, system-ui, sans-serif"; ctx.fillStyle = "#94a3b8"; ctx.strokeStyle = "#eef2f7"; ctx.lineWidth = 1;
  const ticks = (a, b, log) => (log ? Array.from({ length: Math.floor(Math.log10(b)) - Math.ceil(Math.log10(a)) + 1 }, (_, k) => 10 ** (Math.ceil(Math.log10(a)) + k)) : marcasLineales(a, b));
  const etq = (v) => (Math.abs(v) >= 10000 || (Math.abs(v) < 0.01 && v !== 0) ? v.toExponential(0) : String(+v.toPrecision(3)));
  ticks(op.y[0], op.y[1], op.logy).forEach((v) => { const y = Y(v); ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(w - m.r, y); ctx.stroke(); ctx.textAlign = "right"; ctx.fillText(op.etqY ? op.etqY(v) : etq(v), m.l - 5, y + 3); });
  ticks(op.x[0], op.x[1], op.logx).forEach((v) => { const x = X(v); ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, h - m.b); ctx.stroke(); ctx.textAlign = "center"; ctx.fillText(etq(v), x, h - m.b + 13); });
  ctx.fillStyle = "#64748b"; ctx.textAlign = "right"; ctx.fillText(op.ejeX || "", w - m.r, h - 2); ctx.textAlign = "left"; ctx.fillText(op.ejeY || "", m.l + 4, m.t + 10);
  ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t, w - m.l - m.r, h - m.t - m.b); ctx.clip();
  (op.bandas || []).forEach((b) => { ctx.fillStyle = b.color; ctx.fillRect(X(b.desde), m.t, X(b.hasta) - X(b.desde), h - m.t - m.b); });
  (op.areas || []).forEach((a) => {
    if (!a.x.length) return;
    ctx.fillStyle = a.color; ctx.beginPath();
    for (let i = 0; i < a.x.length; i++) ctx.lineTo(X(a.x[i]), Y(a.y1[i]));
    for (let i = a.x.length - 1; i >= 0; i--) ctx.lineTo(X(a.x[i]), Y(a.y0[i]));
    ctx.closePath(); ctx.fill();
  });
  (op.hlineas || []).forEach((l) => { ctx.strokeStyle = l.color; ctx.setLineDash(l.continua ? [] : [4, 3]); ctx.lineWidth = l.ancho || 1; ctx.beginPath(); ctx.moveTo(m.l, Y(l.y)); ctx.lineTo(w - m.r, Y(l.y)); ctx.stroke(); });
  (op.vlineas || []).forEach((l) => { if (l.x == null) return; ctx.strokeStyle = l.color; ctx.setLineDash(l.punteada ? [5, 4] : []); ctx.lineWidth = l.ancho || 1.5; ctx.beginPath(); ctx.moveTo(X(l.x), m.t); ctx.lineTo(X(l.x), h - m.b); ctx.stroke(); });
  (op.series || []).forEach((s) => {
    ctx.strokeStyle = s.color; ctx.lineWidth = s.ancho || 1.2; ctx.setLineDash(s.punteada ? [5, 4] : []); ctx.beginPath();
    let empezado = false;
    for (let i = 0; i < s.y.length; i++) {
      const xv = s.x ? s.x[i] : s.x0 + i * s.dx, yv = s.y[i];
      if (yv == null || !Number.isFinite(yv) || (op.logy && yv <= 0) || (op.logx && xv <= 0)) { empezado = false; continue; }
      const px = X(xv), py = Y(op.logy ? Math.min(Math.max(yv, op.y[0] / 1e3), op.y[1] * 1e3) : yv);
      if (empezado) ctx.lineTo(px, py); else { ctx.moveTo(px, py); empezado = true; }
    }
    ctx.stroke();
  });
  ctx.restore();
  if (op.mensaje) { ctx.setLineDash([]); ctx.fillStyle = "#94a3b8"; ctx.font = "500 12px Inter, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText(op.mensaje, (m.l + w - m.r) / 2, (m.t + h - m.b) / 2 + 4); }
  return { X, Y };
}

// ---------------- avisos entre vistas ----------------
const OYENTES = { seleccion: [], datos: [], motor: [], sim: [] };
const escuchar = (tipo, f) => OYENTES[tipo].push(f);
const avisar = (tipo) => OYENTES[tipo].forEach((f) => f());

// ---------------- distritos ----------------
const ARCH = D.archivos || {};
const DISTRITOS = D.distritos.features.map((f) => {
  const u = String(f.properties.ubigeo), a = ARCH[u] || {};
  return { u, nombre: f.properties.distrito, edificios: a.edificios ?? f.properties.edificios ?? 0, mb: a.mb ?? null, f };
}).sort((a, b) => a.nombre.localeCompare(b.nombre));
const POR_U = new Map(DISTRITOS.map((d) => [d.u, d]));
const SURCO = (DISTRITOS.find((d) => d.nombre.toUpperCase() === "SANTIAGO DE SURCO") || DISTRITOS[0]).u;
const nombreDistrito = (u) => titulo(POR_U.get(u)?.nombre ?? u);

// ---------------- vistas y rutas (#/vista?d=ubigeos) ----------------
const VISTAS = {};
const NOMBRES_VISTA = ["mapa", "simulacion", "resultados", "validacion"];
let vistaActual = null;
function leerRuta() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  if (h.startsWith("d=")) return { vista: "mapa", d: h.slice(2) };
  const [v, q = ""] = h.split("?");
  return { vista: NOMBRES_VISTA.includes(v) ? v : "mapa", d: new URLSearchParams(q).get("d") };
}
function distritosDeTexto(txt) {
  if (!txt) return null;
  if (txt === "todos") return DISTRITOS.map((d) => d.u);
  const v = txt.split(",").filter((u) => POR_U.has(u));
  return v.length ? v : null;
}
let SEL = new Set(distritosDeTexto(leerRuta().d) || [SURCO]);
const textoSel = () => (SEL.size === DISTRITOS.length ? "todos" : [...SEL].join(","));
function escribirRuta(nueva) {
  const url = `${location.pathname}${location.search}#/${vistaActual || "mapa"}?d=${textoSel()}`;
  if (nueva) history.pushState(null, "", url); else history.replaceState(null, "", url);
  document.querySelectorAll("#menu .item").forEach((a) => { a.href = `#/${a.dataset.vista}?d=${textoSel()}`; });
}
const enMapa = (v = vistaActual) => v === "mapa" || v === "simulacion";
function actualizarBarra() {
  if (!vistaActual) return;
  $("t-vista").textContent = VISTAS[vistaActual].titulo;
  $("s-vista").textContent = VISTAS[vistaActual].subtitulo();
}
function mostrarVista(v, nueva) {
  if (v === vistaActual) return;
  const antes = vistaActual;
  if (antes && VISTAS[antes].salir) VISTAS[antes].salir(v);
  vistaActual = v;
  document.querySelectorAll("#menu .item").forEach((a) => a.classList.toggle("activo", a.dataset.vista === v));
  $("v-mapa").classList.toggle("activa", enMapa(v));
  $("v-mapa").classList.toggle("en-sim", v === "simulacion");
  $("v-resultados").classList.toggle("activa", v === "resultados");
  $("v-validacion").classList.toggle("activa", v === "validacion");
  $("panel-mapa").hidden = v !== "mapa";
  $("panel-sim").hidden = v !== "simulacion";
  escribirRuta(nueva);
  actualizarBarra();
  if (enMapa(v)) mapa.invalidateSize({ pan: false });
  VISTAS[v].entrar(antes);
  if (enMapa(v)) {
    if (encuadrePendiente) encuadre();
    capaEdif.dibujar();
  }
}
document.querySelectorAll("#menu .item").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); mostrarVista(a.dataset.vista, true); }));
window.addEventListener("popstate", () => mostrarVista(leerRuta().vista, false));

// ---------------- mapa compartido por Mapa y Simulación ----------------
const mapa = L.map("mapa", { zoomControl: true }).setView([-12.06, -77.03], 11);
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const bases = {
  "Gris claro (Esri)": L.layerGroup([
    L.tileLayer(`${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 20, maxNativeZoom: 16, attribution: "© Esri, HERE, Garmin, OpenStreetMap" }),
    L.tileLayer(`${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 20, maxNativeZoom: 16 })]),
  // la imagen de Esri/Maxar calza con las huellas; la de Google en Lima está corrida unos metros
  "Satélite + calles (Esri)": L.layerGroup([
    L.tileLayer(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 20, maxNativeZoom: 19, attribution: "Imágenes © Esri, Maxar, Earthstar Geographics" }),
    L.tileLayer(`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 20, maxNativeZoom: 19, opacity: 0.8 }),
    L.tileLayer(`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 20, maxNativeZoom: 19 })]),
  "OpenStreetMap": L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 20, maxNativeZoom: 19, attribution: "© OpenStreetMap" }),
};
const ctrlBases = L.control.layers(bases, null, { position: "topright" }).addTo(mapa);
bases["Gris claro (Esri)"].addTo(mapa);
if (GOOGLE_KEY) {
  // Google Map Tiles API: una sesión por tipo de mapa; las capas se agregan cuando la sesión responde
  [["Google · mapa", { mapType: "roadmap" }], ["Google · satélite", { mapType: "satellite" }],
    ["Google · híbrido", { mapType: "satellite", layerTypes: ["layerRoadmap"], overlay: false }]].forEach(([nombre, cfg]) =>
    fetch(`https://tile.googleapis.com/v1/createSession?key=${GOOGLE_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language: "es-PE", region: "PE", ...cfg }),
    }).then((r) => r.json()).then((j) => {
      if (!j.session) throw new Error(JSON.stringify(j));
      ctrlBases.addBaseLayer(L.tileLayer(`https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${j.session}&key=${GOOGLE_KEY}`,
        { maxZoom: 22, maxNativeZoom: 21, attribution: "Datos del mapa © Google" }), nombre);
    }).catch((err) => console.warn("Google Map Tiles no disponible:", nombre, err)));
}
L.control.scale({ imperial: false }).addTo(mapa);
// Capas propias: los lienzos y los SVG no tapan los clics; solo los elementos interactivos los reciben.
[["suelo", 330], ["hex", 380], ["simhex", 382], ["distritos", 420], ["edif", 440], ["osm", 450], ["frentes", 455], ["epicentro", 458], ["marcas", 460]]
  .forEach(([n, z]) => { const p = mapa.createPane(n); p.style.zIndex = z; p.style.pointerEvents = "none"; });
mapa.getPane("overlayPane").style.pointerEvents = "none";

// Capa canvas genérica (miles de puntos o polígonos); el clic se resuelve con buscar().
const CapaCanvas = L.Layer.extend({
  initialize(opts) { this.o = opts; },
  onAdd(m) {
    this._m = m;
    this._c = L.DomUtil.create("canvas", "leaflet-zoom-hide");
    this._c.style.position = "absolute"; this._c.style.pointerEvents = "none";
    m.getPane(this.o.pane).appendChild(this._c);
    m.on("moveend resize viewreset", this.dibujar, this);
    m.on("zoomstart", this._ocultar, this);
    this.dibujar();
  },
  onRemove(m) {
    this._c.remove();
    m.off("moveend resize viewreset", this.dibujar, this);
    m.off("zoomstart", this._ocultar, this);
    this._m = null; this._visibles = null;
  },
  _ocultar() { this._c.style.visibility = "hidden"; },
  _transf() { const m = this._m, W = m.options.crs.scale(m.getZoom()), pb = m.getPixelBounds(); return { W, x0: pb.min.x, y0: pb.min.y }; },
  dibujar() {
    if (!this._m) return;
    const m = this._m, s = m.getSize(), dpr = window.devicePixelRatio || 1, c = this._c;
    c.width = s.x * dpr; c.height = s.y * dpr; c.style.width = s.x + "px"; c.style.height = s.y + "px";
    L.DomUtil.setPosition(c, m.containerPointToLayerPoint([0, 0]));
    c.style.visibility = "visible";
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._visibles = s.x && s.y ? this.o.dibujar(ctx, this._transf(), s, m.getZoom()) : null;
  },
  // Elemento bajo el punto (coordenadas de contenedor) como [trozo, índice], o null.
  buscar(p) { return this._m && this._visibles ? this.o.buscar(p, this._transf(), this._m.getZoom(), this._visibles) : null; },
});
function dentro(p, c, i, t) {
  let ok = false;
  const P = c.poly, a0 = c.off[i], a1 = c.off[i + 1];
  for (let a = a0, b = a1 - 2; a < a1; b = a, a += 2) {
    const xa = P[a] * t.W - t.x0, ya = P[a + 1] * t.W - t.y0, xb = P[b] * t.W - t.x0, yb = P[b + 1] * t.W - t.y0;
    if ((ya > p.y) !== (yb > p.y) && p.x < (xb - xa) * (p.y - ya) / (yb - ya) + xa) ok = !ok;
  }
  return ok;
}
// Edificios: una sola capa; cada vista decide cómo pintarlos (validación o daño de la simulación).
const capaEdif = new CapaCanvas({
  pane: "edif",
  dibujar(ctx, t, s, z) { const v = VISTAS[vistaActual]; return v && v.dibujarEdificios ? v.dibujarEdificios(ctx, t, s, z) : null; },
  buscar(p, t, z, vis) {
    let mejor = null, dmin = 49;
    for (const [c, i] of vis) {
      if (z >= 15 && c.off[i + 1] - c.off[i] >= 6 && dentro(p, c, i, t)) return [c, i];
      const dx = c.bX[i] * t.W - t.x0 - p.x, dy = c.bY[i] * t.W - t.y0 - p.y, d = dx * dx + dy * dy;
      if (d < dmin) { dmin = d; mejor = [c, i]; }
    }
    return mejor;
  },
}).addTo(mapa);
// Trazo de la huella de un edificio en el lienzo.
function trazarHuella(ctx, c, i, t) {
  ctx.moveTo(c.poly[c.off[i]] * t.W - t.x0, c.poly[c.off[i] + 1] * t.W - t.y0);
  for (let k = c.off[i] + 2; k < c.off[i + 1]; k += 2) ctx.lineTo(c.poly[k] * t.W - t.x0, c.poly[k + 1] * t.W - t.y0);
  ctx.closePath();
}
mapa.on("click", (e) => { const v = VISTAS[vistaActual]; if (v && v.clic) v.clic(e); });
mapa.on("zoomend", () => { etiquetas(); const v = VISTAS[vistaActual]; if (v && v.alZoom) v.alZoom(); });

// ---------------- límites de distritos ----------------
const capaDistritos = L.geoJSON(D.distritos, { pane: "distritos", interactive: false }).addTo(mapa);
function pintarDistritos() {
  capaDistritos.eachLayer((l) => {
    const sel = SEL.has(String(l.feature.properties.ubigeo));
    l.setStyle(sel ? { color: "#1d4ed8", weight: 2.4, opacity: 0.95, dashArray: null, fill: true, fillColor: "#2563eb", fillOpacity: 0.035 }
      : { color: "#475569", weight: 0.8, opacity: 0.55, dashArray: "3 3", fill: false });
    l.unbindTooltip();
    if (sel) l.bindTooltip(titulo(l.feature.properties.distrito), { permanent: true, direction: "center", className: "etq-distrito" });
  });
}
function etiquetas() { $("mapa").classList.toggle("sin-etiquetas", mapa.getZoom() < 12 && SEL.size > 6 || mapa.getZoom() >= 15); }
// Punto dentro de un polígono GeoJSON (Polygon o MultiPolygon), con la regla par-impar.
function dentroGeo(lon, lat, g) {
  const anillos = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  return anillos.some((pol) => pol.reduce((ok, an) => {
    for (let a = 0, b = an.length - 1; a < an.length; b = a++) {
      const [xa, ya] = an[a], [xb, yb] = an[b];
      if ((ya > lat) !== (yb > lat) && lon < (xb - xa) * (lat - ya) / (yb - ya) + xa) ok = !ok;
    }
    return ok;
  }, false));
}
function limitesSel() {
  const capas = [];
  capaDistritos.eachLayer((l) => { if (SEL.has(String(l.feature.properties.ubigeo))) capas.push(l); });
  return capas.length ? L.featureGroup(capas).getBounds() : capaDistritos.getBounds();
}
let encuadrePendiente = false;
// Encuadra lo elegido; si el mapa está oculto lo deja para cuando vuelva a verse.
function encuadre() {
  if (!enMapa()) { encuadrePendiente = true; return; }
  encuadrePendiente = false;
  const v = VISTAS[vistaActual];
  if (v.encuadrar) { v.encuadrar(); return; }
  const b = limitesSel();
  if (b.isValid()) mapa.fitBounds(b, { padding: [24, 24] });
}

// ---------------- edificios de cada distrito ----------------
const CARGA = new Map();
// Trae un distrito: de la app con fetch, o del archivo local datos_mapa/{ubigeo}.js con una etiqueta script.
function traer(u) {
  if (!LOCAL) return fetch(`distrito/${u}.json`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
  return new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = `datos_mapa/${u}.js`;
    s.onload = () => { const R = window.DISTRITO_RECIBIDO || {}, d = R[u]; delete R[u]; s.remove(); d ? ok(d) : mal(new Error("archivo vacío")); };
    s.onerror = () => { s.remove(); mal(new Error(`no se encontró ${s.src} (corra generar_mapa.py)`)); };
    document.head.appendChild(s);
  });
}
function alertas(B, i) {
  const a = [];
  if (!B.distrito_ok[i]) a.push("centroide fuera de su distrito");
  if (B.dist_centroide_m[i] > 5) a.push(`punto a ${fmt(B.dist_centroide_m[i], 1)} m del centroide de la huella`);
  if (B.altura_m[i] != null && B.pisos[i]) { const r = B.altura_m[i] / B.pisos[i]; if (r > 6 || r < 1.8) a.push(`altura/piso = ${fmt(r, 1)} m`); }
  return a;
}
// Proyecta edificios, huellas, puntos OSM y celdas de suelo de un distrito una sola vez.
function preparar(d) {
  const B = d.edificios, n = B.id.length, bX = new Float64Array(n), bY = new Float64Array(n), off = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) off[i + 1] = off[i] + (B.g[i] ? B.g[i].length : 0);
  const poly = new Float64Array(off[n]), bMal = new Uint8Array(n);
  let malos = 0;
  for (let i = 0; i < n; i++) {
    [bX[i], bY[i]] = merc(B.lon[i], B.lat[i]);
    const g = B.g[i] || [];
    for (let k = 0; k < g.length; k += 2) [poly[off[i] + k], poly[off[i] + k + 1]] = merc(B.lon[i] + g[k] / 1e6, B.lat[i] + g[k + 1] / 1e6);
    bMal[i] = alertas(B, i).length > 0 ? 1 : 0; malos += bMal[i];
  }
  B.g = null;
  const O = d.osm, nO = O.osm_id.length, oX = new Float64Array(nO), oY = new Float64Array(nO);
  for (let i = 0; i < nO; i++) [oX[i], oY[i]] = merc(O.lon[i], O.lat[i]);
  const S = d.suelo, nS = S.lon.length, h = D.suelo_paso / 2, sR = new Float64Array(4 * nS);
  for (let i = 0; i < nS; i++) { const [ax, ay] = merc(S.lon[i] - h, S.lat[i] + h), [bx, by] = merc(S.lon[i] + h, S.lat[i] - h); sR.set([ax, ay, bx, by], 4 * i); }
  return { u: d.ubigeo, B, n, bX, bY, off, poly, bMal, malos, O, nO, oX, oY, S, nS, sR };
}
const activos = () => [...SEL].map((u) => CARGA.get(u)).filter((c) => c && c.estado === "listo").map((c) => c.datos);
const datosDe = (u) => { const c = CARGA.get(u); return c && c.estado === "listo" ? c.datos : null; };
let ocupado = false;
// Carga en orden los distritos elegidos que faltan, uno por vez, y avisa a las vistas después de cada uno.
async function cargarPendientes() {
  if (ocupado) return;
  ocupado = true;
  for (;;) {
    const pend = [...SEL].filter((u) => !CARGA.has(u));
    if (!pend.length) break;
    const u = pend[0], info = POR_U.get(u), total = SEL.size, listos = [...SEL].filter((x) => CARGA.get(x)?.estado === "listo").length;
    CARGA.set(u, { estado: "cargando" });
    $("aviso-texto").textContent = `Cargando los edificios de ${titulo(info.nombre)}${info.mb ? ` · ${fmt(info.mb, 1)} MB` : ""}  (${listos + 1} de ${total})`;
    $("aviso").style.display = "flex";
    $("barra-carga").style.display = "block";
    $("barra-carga").firstElementChild.style.width = `${100 * listos / total}%`;
    pintarLista(); pintarBoton();
    await pausa(30);
    try { CARGA.set(u, { estado: "listo", datos: preparar(await traer(u)) }); }
    catch (e) { CARGA.set(u, { estado: "error", error: e.message }); console.warn("No se pudo cargar", u, e); }
    if (!SEL.has(u)) CARGA.delete(u);
    pintarLista(); pintarBoton();
    avisar("datos");
  }
  ocupado = false;
  $("aviso").style.display = "none";
  $("barra-carga").style.display = "none";
  pintarBoton();
}

// ---------------- selector de distritos (barra superior) ----------------
function pintarLista() {
  const q = $("buscar").value.trim().toLowerCase();
  $("lista").innerHTML = DISTRITOS.filter((d) => !q || d.nombre.toLowerCase().includes(q)).map((d) => {
    const c = CARGA.get(d.u), est = SEL.has(d.u) && c ? c.estado : "";
    return `<label class="fila-d${SEL.has(d.u) ? " sel" : ""}" title="${c && c.error ? esc(c.error) : ""}"><input type="checkbox" value="${d.u}"${SEL.has(d.u) ? " checked" : ""}>` +
      `<span class="nombre">${titulo(d.nombre)}</span><span class="meta">${corto(d.edificios)}${d.mb ? ` · ${fmt(d.mb, 0)} MB` : ""}</span><span class="est ${est}"></span></label>`;
  }).join("") || '<div style="padding:10px;color:var(--tenue)">Sin coincidencias</div>';
  const sel = [...SEL].map((u) => POR_U.get(u)), mb = sel.reduce((a, d) => a + (d.mb || 0), 0);
  $("resumen-sel").innerHTML = SEL.size ? `${fmt(sel.reduce((a, d) => a + d.edificios, 0), 0)} edificios${mb ? ` · ${fmt(mb, 0)} MB por traer` : ""}` +
    (SEL.size > 8 ? ' · <span class="mal">muchos distritos: la carga y el dibujo serán lentos</span>' : "") : "Ningún distrito elegido.";
}
function pintarBoton() {
  const n = SEL.size, nombres = [...SEL].map(nombreDistrito).sort((a, b) => a.localeCompare(b));
  $("sel-txt").textContent = !n ? "Ningún distrito" : n === DISTRITOS.length ? "Todos los distritos" : n <= 2 ? nombres.join(" y ") : `${nombres[0]} y ${n - 1} más`;
  $("n-sel").textContent = `${n} de ${DISTRITOS.length}`;
  const cargando = [...SEL].some((u) => CARGA.get(u)?.estado === "cargando");
  $("sel-est").className = `est${cargando ? " cargando" : ""}`;
}
// Cambia la selección: libera lo que ya no se usa, avisa a las vistas, encuadra y trae lo que falta.
function elegir(nuevos, encuadrar = true) {
  SEL = new Set(nuevos);
  for (const [u, c] of CARGA) if (!SEL.has(u) && c.estado !== "cargando") CARGA.delete(u);
  escribirRuta(false);
  pintarLista(); pintarBoton(); pintarDistritos(); etiquetas();
  $("vacio").style.display = SEL.size ? "none" : "flex";
  avisar("seleccion");
  actualizarBarra();
  if (encuadrar) encuadre();
  cargarPendientes();
}
$("sel-boton").addEventListener("click", (e) => {
  e.stopPropagation();
  const abrir = $("sel-panel").hidden;
  $("sel-panel").hidden = !abrir; $("sel-boton").setAttribute("aria-expanded", String(abrir));
  if (abrir) { pintarLista(); $("buscar").focus(); }
});
document.addEventListener("click", (e) => { if (!$("selector").contains(e.target)) $("sel-panel").hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("sel-panel").hidden = true; });
$("lista").addEventListener("change", (e) => {
  const u = e.target.value, s = new Set(SEL);
  e.target.checked ? s.add(u) : s.delete(u);
  elegir(s);
});
$("buscar").addEventListener("input", pintarLista);
document.querySelectorAll("#sel-panel .pildora").forEach((b) => b.addEventListener("click", () => {
  const a = b.dataset.accion;
  elegir(a === "todos" ? DISTRITOS.map((d) => d.u) : a === "limpiar" ? [] : [SURCO]);
}));

// Arranque: se llama al final del último guion, cuando todas las vistas ya están registradas.
function iniciar() {
  $("menu-pie").innerHTML = `Datos del mapa<br><b>${esc(D.generado)}</b><br>${DISTRITOS.length} distritos · ${corto(DISTRITOS.reduce((a, d) => a + d.edificios, 0))} edificios`;
  pintarDistritos();
  mostrarVista(leerRuta().vista, false);
  elegir(SEL);
}
