// Vista Simulación: corre la cadena del notebook 11 en el navegador sobre el mismo mapa de edificios y clasifica el daño de cada uno.
let SD = null, M = null, errorSim = null, interpCorr = null;
const J_DE = new Map(), IDX_HEX = new Map();
let edifDist = [], hexDist = [], edifHex = [];
let epicentro = null, HIST = [], vista = null, tVista = 0, animando = false, ultimoCuadro = null, ultimoDibujo = 0, seguido = 0, CLAVE = "";
let modoClase = "sorteo", capaSim = "edificios", selEdif = null, versionEdif = 0, leyendaPlegada = false;
let claveHex = "", claveEdif = "", claveCajon = "", lineaVisible = false, ultimoEdif = 0;
const PASO_FOTO = 1, GUARDAR_SIM = 6, Z_HUELLA = 15, MAX_PUNTOS_LEJOS = 400000;
const NIVELES = ["Sin daño", "Leve", "Moderado", "Severo", "Colapso"];
const COLOR_DANO = ["#5fb56a", "#facc15", "#f97316", "#dc2626", "#4a0d1a"];
const COLOR_ESTADO = { espera: "#94a3b8", p: "#f59e0b", alarma: "#dc2626", s: "#7c3aed", inicio: "#2563eb" };
const COLORES_HEX = ["#ffffcc", "#ffeda0", "#fed976", "#feb24c", "#fd8d3c", "#fc4e2a", "#e31a1c", "#bd0026", "#800026"];
const CORTES_PCT = [0.1, 0.5, 1, 2, 5, 10, 20, 40], CORTES_PGA = [0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.4];
// Lo que pintan los hexágonos: la sacudida en el suelo o un nivel de daño esperado de las curvas GEM.
const CAPAS_SIM = {
  pga: { nombre: "sacudida en el suelo (PGA)", titulo: "PGA media en el suelo (g)", cortes: CORTES_PGA, unidad: " g", valor: (g, i) => (g.hexNP[i] ? g.hexPGA[i] / g.hexNP[i] : null) },
  leve: { nombre: "% daño ≥ leve", titulo: "% de edificios con daño ≥ leve", cortes: CORTES_PCT, unidad: " %", valor: (g, i) => (g.hexN[i] ? 100 * g.hexLeve[i] / g.hexN[i] : null) },
  moderado: { nombre: "% daño ≥ moderado", titulo: "% de edificios con daño ≥ moderado", cortes: CORTES_PCT, unidad: " %", valor: (g, i) => (g.hexN[i] ? 100 * g.hexMod[i] / g.hexN[i] : null) },
  severo: { nombre: "% daño ≥ severo", titulo: "% de edificios con daño ≥ severo", cortes: CORTES_PCT, unidad: " %", valor: (g, i) => (g.hexN[i] ? 100 * g.hexEsp[i] / g.hexN[i] : null) },
  colapso: { nombre: "% colapso", titulo: "% de edificios que colapsan", cortes: CORTES_PCT, unidad: " %", valor: (g, i) => (g.hexN[i] ? 100 * g.hexCol[i] / g.hexN[i] : null) },
};
const letra = (i) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) + 1 : "");
const nivelHtml = (k) => `<span class="nivel" style="background:${COLOR_DANO[k]};color:${k === 1 ? "#422006" : "#fff"}">${NIVELES[k]}</span>`;

// ---------------- parámetros ----------------
function parametros() { return { ds: 10 ** Number($("ds").value), ka: Number($("ka").value), q0: Number($("q0").value), corregir: $("corregir").checked }; }
function sismoForm() { return { magnitud: Number($("mag").value), lat: epicentro[0], lon: epicentro[1], prof_km: Number($("prof").value), semilla: Number($("semilla").value) || 1 }; }
function calibrado() { const S = SD.sintetico; return { ds: S.delta_sigma, ka: S.kappa, q0: S.q0, corregir: true }; }
const activosSel = () => [...SEL].map((u) => J_DE.get(u)).filter((j) => j !== undefined).sort((a, b) => a - b);
// Lo que se dibuja: la simulación elegida en el historial o, en Inicio, lo que se va a simular.
function contexto() { return vista ? { s: vista.s, p: vista.p, activos: vista.activos } : { s: sismoForm(), p: parametros(), activos: activosSel() }; }
function mostrarParametros() {
  if (!M) return;
  const p = parametros(), s = sismoForm(), act = activosSel();
  $("v-mag").textContent = `M${s.magnitud.toFixed(1)}`;
  $("v-prof").textContent = `${s.prof_km} km`;
  $("v-ds").textContent = `${fmt(p.ds, 0)} bar`;
  $("v-ka").textContent = `${p.ka.toFixed(3)} s`;
  $("v-q0").textContent = fmt(p.q0, 0);
  const { fc } = M.espectroFourier([1], s.magnitud, 50, p.ds, p.ka, p.q0);
  $("fc").textContent = `Frecuencia de esquina ${fc.toFixed(3)} Hz (periodo ${(1 / fc).toFixed(1)} s). Δσ más alta la sube y da más altas frecuencias; κ y Q0 más bajos las apagan.`;
  $("epi").textContent = `Epicentro ${epicentro[0].toFixed(3)}°, ${epicentro[1].toFixed(3)}° · haga clic en el mapa (en Inicio) para moverlo.`;
  $("prox").textContent = `Simulación ${letra(HIST.length)}`;
  $("simular-txt").textContent = `Simular · Simulación ${letra(HIST.length)}`;
  $("sim-distritos").innerHTML = act.length
    ? `Se simulan los distritos elegidos arriba: <b>${act.length === 1 ? titulo(M.DIST[act[0]].nombre) : `${act.length} distritos`}</b> · ${fmt(act.reduce((a, j) => a + edifDist[j], 0), 0)} edificios.`
    : '<span class="mal">Elija al menos un distrito en el selector de arriba.</span>';
}

// ---------------- daño de cada edificio ----------------
// Número fijo entre 0 y 1 para cada edificio (de su id), para el sorteo de su nivel de daño.
function azar(id) {
  let h = 2166136261;
  for (let k = 0; k < id.length; k++) { h ^= id.charCodeAt(k); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return ((h >>> 0) + 0.5) / 4294967296;
}
// Une cada edificio del distrito con su grupo del 11 (hexágono, Vs30, tipología y pisos GEM) y comprueba los conteos y los ids repetidos.
function prepSim(c) {
  if (c.sim) return c.sim;
  const j = J_DE.get(c.u), B = c.B, n = c.n;
  if (j === undefined) return (c.sim = { error: "Este distrito no está en los datos del simulador." });
  if (!B.tipologia || !B.vs30_bin) return (c.sim = { error: "El archivo de este distrito no trae la tipología GEM: vuelva a correr el notebook 12." });
  const tSim = (D.cats_edif.tipologia || []).map((t) => SD.tipologias.indexOf(t)), TOPE = SD.pisos_max_gem;
  const gi = new Int32Array(n), u = new Float64Array(n), uniq = new Map(), veces = new Map();
  let fuera = 0;
  for (let i = 0; i < n; i++) {
    const id = String(B.id[i]);
    u[i] = azar(id);
    veces.set(id, (veces.get(id) || 0) + 1);
    const tc = B.tipologia[i], t = tc == null ? -1 : tSim[tc], p = B.pisos[i], vb = B.vs30_bin[i];
    let g = -1;
    if (t >= 0 && p != null && vb != null) {
      const h = B.h3_r8[i] == null ? -1 : (IDX_HEX.get(B.h3_r8[i]) ?? -1), tope = TOPE[SD.tipologias[t]] ?? TOPE.albanileria_confinada;
      g = M.grupoDe(j, h, Math.round((vb - 150) / 10), t, Math.min(p, tope));
    }
    if (g < 0) { gi[i] = -1; fuera += 1; continue; }
    let k = uniq.get(g);
    if (k === undefined) { k = uniq.size; uniq.set(g, k); }
    gi[i] = k;
  }
  const grupos = Int32Array.from(uniq.keys()), cuenta = new Float64Array(grupos.length);
  for (let i = 0; i < n; i++) if (gi[i] >= 0) cuenta[gi[i]] += 1;
  let distintos = 0, gruposDistrito = 0;
  grupos.forEach((g, k) => { if (SD.grupos.count[g] !== cuenta[k]) distintos += 1; });
  for (let g = 0; g < SD.grupos.d.length; g++) if (SD.grupos.d[g] === j) gruposDistrito += 1;
  let idsRepetidos = 0;
  veces.forEach((k) => { if (k > 1) idsRepetidos += 1; });
  return (c.sim = { j, gi, u, grupos, fuera, distintos, gruposDistrito, edif11: edifDist[j], idsRepetidos, filasDeMas: n - veces.size,
    ok: fuera === 0 && distintos === 0 && grupos.length === gruposDistrito && n === edifDist[j], probs: new Map(), conteos: new WeakMap(), ultimo: null });
}
// PGA en el suelo, IM y P(≥ leve…colapso) de cada grupo del distrito con el movimiento de la foto f (6 valores por grupo).
// Guarda solo las últimas 4 fotos: con todos los distritos y todas las fotos la memoria no alcanzaría.
function probsEn(c, f) {
  const S = prepSim(c);
  if (S.error || !f) return null;
  let r = S.probs.get(f);
  if (r !== undefined) return r;
  if (S.probs.size >= 4) S.probs.delete(S.probs.keys().next().value);
  const m = f.dem[S.j];
  r = null;
  if (m) {
    r = new Float64Array(6 * S.grupos.length);
    for (let k = 0; k < S.grupos.length; k++) {
      const x = M.danoGrupo(S.grupos[k], m);
      r[6 * k] = x.pga; r[6 * k + 1] = x.im ?? NaN;
      if (x.p) for (let q = 0; q < 4; q++) r[6 * k + 2 + q] = x.p[q];
    }
  }
  S.probs.set(f, r);
  return r;
}
// Nivel de daño (0 a 4): sorteo con el número fijo u del edificio, o el mayor nivel con P ≥ 50 %.
function nivel(P, b, u, modo = modoClase) {
  return modo === "sorteo" ? (u < P[b + 2]) + (u < P[b + 3]) + (u < P[b + 4]) + (u < P[b + 5])
    : (P[b + 2] >= 0.5) + (P[b + 3] >= 0.5) + (P[b + 4] >= 0.5) + (P[b + 5] >= 0.5);
}
function estadosEn(c, f) {
  const S = prepSim(c);
  if (S.error || !f) return null;
  if (S.ultimo && S.ultimo.f === f && S.ultimo.modo === modoClase) return S.ultimo.s;
  const P = probsEn(c, f), s = new Uint8Array(c.n);
  if (P) for (let i = 0; i < c.n; i++) { const k = S.gi[i]; if (k >= 0) s[i] = nivel(P, 6 * k, S.u[i]); }
  S.ultimo = { f, modo: modoClase, s };
  return s;
}
// Edificios en cada nivel, más lo esperado (suma de probabilidades) y su varianza, para un distrito en la foto f.
function conteosEn(c, f, modo = modoClase) {
  const S = prepSim(c);
  if (S.error) return null;
  const vacio = { n: [c.n, 0, 0, 0, 0], esp: [0, 0, 0, 0], vari: [0, 0, 0, 0] };
  if (!f) return vacio;
  let porModo = S.conteos.get(f);
  if (!porModo) S.conteos.set(f, (porModo = {}));
  if (porModo[modo]) return porModo[modo];
  const P = probsEn(c, f);
  if (!P) return (porModo[modo] = vacio);
  const n = [0, 0, 0, 0, 0], esp = [0, 0, 0, 0], vari = [0, 0, 0, 0];
  for (let i = 0; i < c.n; i++) {
    const k = S.gi[i];
    if (k < 0) { n[0] += 1; continue; }
    const b = 6 * k;
    n[nivel(P, b, S.u[i], modo)] += 1;
    for (let q = 0; q < 4; q++) { const p = P[b + 2 + q]; esp[q] += p; vari[q] += p * (1 - p); }
  }
  return (porModo[modo] = { n, esp, vari });
}
// Suma de los distritos de la simulación que tienen sus edificios cargados en el mapa.
function edificiosMapa(H, f, modo = modoClase) {
  const act = new Set(H ? H.activos : activosSel()), out = { n: 0, cont: [0, 0, 0, 0, 0], esp: [0, 0, 0, 0], distritos: [] };
  for (const c of activos()) {
    const j = J_DE.get(c.u);
    if (!act.has(j) || prepSim(c).error) continue;
    const k = conteosEn(c, f, modo);
    out.n += c.n; out.distritos.push(c);
    k.n.forEach((v, q) => { out.cont[q] += v; });
    k.esp.forEach((v, q) => { out.esp[q] += v; });
  }
  return out;
}

// ---------------- historial de simulaciones ----------------
const fotoActual = () => (vista && vista.sim ? fotoEn(vista, tVista) : null);
// Foto del daño más reciente hasta el instante t (se toma una por segundo de señal).
function fotoEn(H, t) {
  let f = null;
  for (const x of H.fotos) { if (x.t > t + 1e-9) break; f = x; }
  return f;
}
function rfEn(H, t) {
  let r = null;
  for (const x of H.fotos) { if (x.t > t + 1e-9) break; if (x.rf) r = x.rf; }
  return r;
}
function foto(H, t, conRF) {
  const dem = H.sim.demanda(), gem = M.impactoGEM(dem);
  H.fotos.push({ t, dem, gem, rf: conRF || H.fotos.length % 5 === 0 ? M.impactoRF(dem) : null });
}
// Consume la señal hasta t con fotos del daño cada PASO_FOTO segundos; al llegar al final cierra la simulación.
function calcularHasta(H, t) {
  t = Math.min(t, H.sim.duracion);
  while (H.tFoto <= t + 1e-9) { H.sim.avanzar(H.tFoto); foto(H, H.tFoto, false); H.tFoto += PASO_FOTO; }
  H.sim.avanzar(t);
  H.tCalc = Math.max(H.tCalc, t);
  if (t >= H.sim.duracion && !H.fin) {
    if (H.fotos[H.fotos.length - 1].t < H.sim.duracion) foto(H, H.sim.duracion, true);
    else H.fotos[H.fotos.length - 1].rf = M.impactoRF(H.fotos[H.fotos.length - 1].dem);
    cerrar(H);
  }
}
// Resumen de la simulación H en el instante t: detecciones, falsas alarmas, aviso y daño.
function resumenEn(H, t) {
  const C = SD.constantes, filas = H.activos.map((j) => {
    const d = H.sim.dist[j], e = H.sim.estado[j];
    let falsas = 0;
    for (const v of e.ventanas) { if (v.fin > t) break; if (v.fin <= d.tP && v.p >= C.UMBRAL_P_MODELO) falsas += 1; }
    return { j, d, tMod: e.tModelo !== null && e.tModelo <= t ? e.tModelo : null, tSta: e.tStaLta !== null && e.tStaLta <= t ? e.tStaLta : null, falsas };
  });
  const det = filas.filter((f) => f.tMod !== null), media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null), f = fotoEn(H, t);
  return { filas, n: filas.length, det: det.length, sta: filas.filter((x) => x.tSta !== null).length, falsas: filas.reduce((a, x) => a + x.falsas, 0),
    aviso: media(det.map((x) => x.d.tS - x.tMod)), retraso: media(det.map((x) => x.tMod - x.d.tP)),
    severo: f ? f.gem.severo : 0, moderado: f ? f.gem.moderado : 0, colapso: f ? f.gem.colapso : 0, leve: f ? f.gem.leve : 0, total: f ? f.gem.total : 0,
    pgaMax: f ? f.gem.pgaMax : 0, pgaDist: f ? H.activos.reduce((a, j) => (f.gem.dist[j].pgaMax > f.gem.dist[a].pgaMax ? j : a), H.activos[0]) : 0 };
}
// Termina una simulación: guarda su resumen, libera las señales que ya no se dibujan y actualiza el historial.
function cerrar(H) {
  H.fin = true;
  H.resumen = resumenEn(H, H.sim.duracion);
  delete H.resumen.filas;
  H.sim.dist.forEach((d) => { if (!d) return; d.sueloG = null; d.rocaG = [d.rocaG[0]]; delete d.series.ns; delete d.series.ns_roca; delete d.series.ew_roca; });
  const conSim = HIST.filter((x) => x.sim && x !== vista).sort((a, b) => b.visto - a.visto);
  conSim.slice(GUARDAR_SIM - 1).forEach((x) => { Object.assign(x, { sim: null, fotos: [], tCalc: 0, tFoto: 0, fin: false, espectros: {} }); });
  guardarHistorial(); pintarHistorial();
}
function nuevaEntrada(i, s, p, activos, escenario) {
  return { letra: letra(i), s, p, activos, escenario, sim: null, fotos: [], tCalc: 0, tFoto: 0, fin: false, resumen: null, espectros: {}, visto: 0 };
}
function crearSim(H) { Object.assign(H, { sim: M.simular(H.s, H.p, H.activos), fotos: [], tCalc: 0, tFoto: 0, fin: false, espectros: {} }); }
function guardarHistorial() {
  try { localStorage.setItem(CLAVE, JSON.stringify(HIST.map((H) => ({ letra: H.letra, s: H.s, p: H.p, activos: H.activos, escenario: H.escenario, resumen: H.resumen })))); } catch (e) { /* sin almacenamiento */ }
}
function leerHistorial() {
  try { return JSON.parse(localStorage.getItem(CLAVE) || "[]").map((x, i) => Object.assign(nuevaEntrada(i, x.s, x.p, x.activos, x.escenario), { resumen: x.resumen })); } catch (e) { return []; }
}
function descripcion(H) {
  const n = H.activos.length, primero = titulo(M.DIST[H.activos[0]]?.nombre || "");
  return `${n === 1 ? primero : n === M.DIST.length ? "todos los distritos" : `${primero} y ${n - 1} más`} · Δσ ${fmt(H.p.ds, 0)} bar`;
}
function pintarHistorial() {
  if (!M) return;
  const r = (H) => (H.resumen ? `P ${H.resumen.det}/${H.resumen.n} · ${fmt(H.resumen.severo, 0)} edificios ≥ severo` : "");
  const est = (H) => (H.fin || (!H.sim && H.resumen) ? '<span class="estado lista">terminada</span>' : H === vista && animando ? '<span class="estado curso">en curso</span>' : H.sim ? '<span class="estado">en pausa</span>' : "");
  $("hist").innerHTML = `<button class="hist-item${vista ? "" : " activo"}" data-i="-1" type="button"><span class="insignia inicio">○</span><span class="hist-txt"><b>Inicio · sin sismo</b><small>Edificios sin daño y ninguna onda</small></span><span></span></button>` +
    HIST.map((H, i) => `<button class="hist-item${H === vista ? " activo" : ""}" data-i="${i}" type="button"><span class="insignia">${H.letra}</span><span class="hist-txt"><b>Simulación ${H.letra}</b>` +
      `<small>M${H.s.magnitud.toFixed(1)} · ${H.s.prof_km} km · ${descripcion(H)}</small>${r(H) ? `<small>${r(H)}</small>` : ""}</span>${est(H)}</button>`).reverse().join("");
  $("n-hist").textContent = HIST.length ? `${HIST.length} ${HIST.length === 1 ? "prueba" : "pruebas"}` : "";
  $("usar").disabled = !vista;
  $("borrar").disabled = !HIST.length || animando;
  $("m-res").textContent = vista ? vista.letra : HIST.length ? HIST[HIST.length - 1].letra : "";
  $("m-res").classList.toggle("si", HIST.length > 0);
}
// Calcula la simulación hasta el final por tramos de 5 s sin congelar la página; si se liberó, la vuelve a generar con su semilla.
async function completar(H, progreso) {
  if (!H.sim) crearSim(H);
  const S = H.sim;
  while (!H.fin && H.sim === S) {
    calcularHasta(H, Math.min(H.tCalc + 5, S.duracion));
    if (progreso) progreso(H.tCalc / S.duracion);
    await pausa(0);
  }
}
async function recalcular(H) {
  $("ocupado-txt").textContent = `Recalculando la Simulación ${H.letra}…`; $("ocupado").style.display = "flex";
  await pausa(30);
  try { await completar(H, (x) => { $("ocupado-txt").textContent = `Recalculando la Simulación ${H.letra}… ${Math.round(100 * x)} %`; }); }
  finally { $("ocupado").style.display = "none"; }
}
// Muestra una simulación del historial (o Inicio con null); el mapa pasa a sus distritos y, si se liberó, se recalcula igual con su semilla.
async function ver(H) {
  animando = false;
  vista = H; claveHex = ""; claveEdif = ""; claveCajon = "";
  if (H) {
    H.visto = Date.now();
    if (!H.sim) await recalcular(H);
    tVista = H.fin ? H.sim.duracion : H.tCalc;
    const us = H.activos.map((j) => M.DIST[j].ubigeo);
    if (us.length !== SEL.size || us.some((u) => !SEL.has(u))) elegir(us, false);
    if (!H.activos.includes(seguido)) seguido = masCercano(H.activos);
  } else {
    tVista = 0;
    const act = activosSel();
    if (!act.includes(seguido)) seguido = masCercano(act);
  }
  estadoControles(); pintarHistorial(); mostrarParametros(); pintarTodo(); avisar("sim");
  if (vistaActual === "simulacion") encuadrarSim(); else encuadrePendiente = true;
}
$("hist").addEventListener("click", (e) => {
  const b = e.target.closest(".hist-item");
  if (!b) return;
  const i = Number(b.dataset.i);
  ver(i < 0 ? null : HIST[i]);
});
$("usar").addEventListener("click", () => {
  if (!vista) return;
  const H = vista;
  $("mag").value = H.s.magnitud; $("prof").value = H.s.prof_km; $("semilla").value = H.s.semilla;
  $("ds").value = Math.log10(H.p.ds); $("ka").value = H.p.ka; $("q0").value = H.p.q0; $("corregir").checked = H.p.corregir;
  epicentro = [H.s.lat, H.s.lon];
  ver(null);
});
$("borrar").addEventListener("click", () => { HIST = []; guardarHistorial(); ver(null); });

// ---------------- capas de la simulación en el mapa ----------------
let capaHexSim = null, hexPol = [], marcas = [], frenteP = null, frenteS = null, marcaEpi = null, marcaPlan = null;
const ctrlLeyendaSim = L.control({ position: "bottomleft" });
function colorHex(v, cortes) { if (v == null) return null; let k = 0; while (k < cortes.length && v >= cortes[k]) k++; return k === 0 ? null : COLORES_HEX[k]; }
function tooltipHex(i) {
  const f = fotoActual(), n = edifHex[i];
  if (!f || !f.gem.hexNP[i]) return `<b>Hexágono ${SD.hex.h3[i]}</b><br>${fmt(n, 0)} edificios · ${vista ? "la onda aún no llega" : "sin sismo"}`;
  const g = f.gem, pc = (a) => (g.hexN[i] ? `${fmt(100 * a[i] / g.hexN[i], 2)} %` : "—");
  return `<b>Hexágono ${SD.hex.h3[i]}</b> · ${fmt(n, 0)} edificios<br>PGA en el suelo <b>${fmt(g.hexPGA[i] / g.hexNP[i], 3)} g</b><br>` +
    `Daño ≥ leve ${pc(g.hexLeve)} · ≥ moderado ${pc(g.hexMod)}<br>≥ severo <b>${pc(g.hexEsp)}</b> · colapso ${pc(g.hexCol)}`;
}
function estadoDistrito(j, t) {
  if (!vista || !vista.sim || !vista.sim.dist[j]) return "inicio";
  const d = vista.sim.dist[j], e = vista.sim.estado[j];
  if (t >= d.tS) return "s";
  if (e.tModelo !== null && t >= e.tModelo) return "alarma";
  return t >= d.tP ? "p" : "espera";
}
function tooltipDistrito(j) {
  const d = M.DIST[j], est = { inicio: "sin sismo", espera: "aún sin la onda P", p: "llegó la P", alarma: "alarma del champion", s: "llegó la S" }[estadoDistrito(j, tVista)];
  return `<b>${titulo(d.nombre)}</b><br>${est}<br><span style="color:#64748b">clic: seguir este distrito</span>`;
}
function crearCapasSim() {
  hexPol = SD.hex.borde.map((b, i) => L.polygon(b.map(([x, y]) => [y, x]), { pane: "simhex", stroke: false, fill: false }).bindTooltip(() => tooltipHex(i), { sticky: true }));
  capaHexSim = L.layerGroup(hexPol);
  marcas = M.DIST.map((d) => L.circleMarker([d.lat, d.lon], { pane: "marcas", radius: 7, weight: 2, color: "#fff", fillColor: COLOR_ESTADO.inicio, fillOpacity: 1, bubblingMouseEvents: false })
    .bindTooltip(() => tooltipDistrito(d.j)).on("click", () => seguir(d.j)));
  frenteP = L.circle([0, 0], { pane: "frentes", radius: 1, color: "#f59e0b", weight: 2, dashArray: "6 6", fill: false, interactive: false });
  frenteS = L.circle([0, 0], { pane: "frentes", radius: 1, color: "#7c3aed", weight: 2.5, fillColor: "#7c3aed", fillOpacity: 0.04, interactive: false });
  marcaEpi = L.marker([0, 0], { pane: "epicentro", interactive: false, keyboard: false,
    icon: L.divIcon({ className: "", html: '<div style="font-size:28px;line-height:28px;color:#dc2626;text-shadow:0 0 4px #fff,0 0 4px #fff">★</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) });
  marcaPlan = L.marker([0, 0], { pane: "epicentro", interactive: false, keyboard: false,
    icon: L.divIcon({ className: "", html: '<div style="width:22px;height:22px;border:2px dashed #2563eb;border-radius:50%;background:rgba(37,99,235,.12)"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }) });
}
function leyendaSimHtml() {
  const opciones = [["edificios", "Edificios: nivel de daño"], ...Object.entries(CAPAS_SIM).map(([k, x]) => [k, `Hexágonos: ${x.nombre}`])];
  let h = `<div class="titulo">Ver en el mapa<button type="button" id="ley-plegar" title="${leyendaPlegada ? "Mostrar" : "Plegar"} la leyenda">${leyendaPlegada ? "▸" : "▾"}</button></div>` +
    `<select id="capa-sim">${opciones.map(([k, n]) => `<option value="${k}"${k === capaSim ? " selected" : ""}>${n}</option>`).join("")}</select>`;
  if (leyendaPlegada) return h;
  if (capaSim === "edificios") h += `<div class="sub">${modoClase === "sorteo" ? "Nivel de cada edificio (sorteo)" : "Nivel con P ≥ 50 %"}</div>` + NIVELES.map((n, k) => `<div class="cat"><i style="background:${COLOR_DANO[k]}"></i>${n}</div>`).join("");
  else {
    const c = CAPAS_SIM[capaSim];
    h += `<div class="sub">${c.titulo}</div>` + c.cortes.map((v, k) => `<div class="cat"><i style="background:${COLORES_HEX[k + 1]}"></i>${v}${k + 1 < c.cortes.length ? "–" + c.cortes[k + 1] : "+"}${c.unidad}</div>`).join("");
  }
  return h + '<div class="sub">Distritos</div>' + [[COLOR_ESTADO.inicio, "sin sismo"], [COLOR_ESTADO.espera, "aún sin la onda P"], [COLOR_ESTADO.p, "llegó la P"], [COLOR_ESTADO.alarma, "alarma del champion"], [COLOR_ESTADO.s, "llegó la S"]]
    .map(([col, x]) => `<div class="cat punto"><i style="background:${col}"></i>${x}</div>`).join("");
}
ctrlLeyendaSim.onAdd = () => {
  const div = L.DomUtil.create("div", "leyenda");
  div.id = "leyenda-sim";
  div.innerHTML = leyendaSimHtml();
  L.DomEvent.disableClickPropagation(div); L.DomEvent.disableScrollPropagation(div);
  div.addEventListener("change", (e) => { if (e.target.id !== "capa-sim") return; capaSim = e.target.value; div.innerHTML = leyendaSimHtml(); claveHex = ""; claveEdif = ""; pintarTodo(); });
  div.addEventListener("click", (e) => { if (e.target.id !== "ley-plegar") return; leyendaPlegada = !leyendaPlegada; div.innerHTML = leyendaSimHtml(); });
  return div;
};
function refrescarLeyendaSim() { const d = $("leyenda-sim"); if (d) d.innerHTML = leyendaSimHtml(); }
// Encuadra los distritos simulados junto con el epicentro, para ver llegar las ondas.
function encuadrarSim() {
  let b = limitesSel();
  if (M && epicentro) { const s = contexto().s; b = L.latLngBounds(b.getSouthWest(), b.getNorthEast()).extend([s.lat, s.lon]); }
  if (b.isValid()) mapa.fitBounds(b, { padding: [30, 30], maxZoom: 14 });
}
function masCercano(js) {
  if (!js.length) return 0;
  const s = contexto().s;
  return js.reduce((a, j) => (M.llegada(s, M.DIST[j]).r < M.llegada(s, M.DIST[a]).r ? j : a), js[0]);
}
function seguir(j) {
  if (!contexto().activos.includes(j)) return;
  seguido = j; pintarTodo(); avisar("sim");
}
// Pinta en el mapa la vista: distritos simulados, frentes de onda, epicentro, hexágonos y edificios en el instante tVista.
function pintarMapaSim() {
  if (vistaActual !== "simulacion" || !M) return;
  const c = contexto(), act = new Set(c.activos), C = SD.constantes, f = fotoActual();
  marcas.forEach((m, j) => {
    if (!act.has(j)) { if (mapa.hasLayer(m)) m.remove(); return; }
    if (!mapa.hasLayer(m)) m.addTo(mapa);
    m.setStyle({ fillColor: COLOR_ESTADO[estadoDistrito(j, tVista)], radius: j === seguido ? 9 : 6.5, color: j === seguido ? "#0f172a" : "#fff", weight: j === seguido ? 2.5 : 2 });
  });
  if (vista) {
    const s = vista.s, radio = (v) => { const d = v * tVista; return d > s.prof_km ? Math.sqrt(d * d - s.prof_km ** 2) * 1000 : 1; };
    [frenteP, frenteS, marcaEpi].forEach((l) => { if (!mapa.hasLayer(l)) l.addTo(mapa); });
    frenteP.setLatLng([s.lat, s.lon]).setRadius(radio(C.VP_KM_S));
    frenteS.setLatLng([s.lat, s.lon]).setRadius(radio(C.VS_KM_S));
    marcaEpi.setLatLng([s.lat, s.lon]);
    marcaPlan.remove();
  } else {
    [frenteP, frenteS, marcaEpi].forEach((l) => l.remove());
    marcaPlan.setLatLng(epicentro).addTo(mapa);
  }
  if (capaSim === "edificios") capaHexSim.remove();
  else {
    if (!mapa.hasLayer(capaHexSim)) { capaHexSim.addTo(mapa); claveHex = ""; }
    const clave = `${vista ? vista.letra : "-"}|${f ? f.t : "-"}|${c.activos.join(",")}|${capaSim}`, capa = CAPAS_SIM[capaSim];
    if (clave !== claveHex) {
      claveHex = clave;
      hexPol.forEach((h, i) => {
        if (!hexDist[i].some((j) => act.has(j))) { h.setStyle({ stroke: false, fill: false }); return; }
        const col = f ? colorHex(capa.valor(f.gem, i), capa.cortes) : null;
        h.setStyle(col ? { stroke: true, color: "#fff", weight: 0.5, opacity: 1, fill: true, fillColor: col, fillOpacity: 0.8 }
          : { stroke: true, color: "#94a3b8", weight: 0.5, opacity: 0.7, fill: true, fillColor: "#ffffff", fillOpacity: 0.25 });
      });
    }
  }
  const claveE = `${vista ? vista.letra : "-"}|${f ? f.t : "-"}|${modoClase}|${capaSim}|${c.activos.join(",")}|${selEdif ? selEdif.u + ":" + selEdif.i : ""}|${versionEdif}`;
  const ahora = performance.now();
  if (claveE !== claveEdif && (!animando || ahora - ultimoEdif > 180)) { claveEdif = claveE; ultimoEdif = ahora; capaEdif.dibujar(); }
  pistaSim();
}
// Edificios coloreados por su nivel de daño en el instante tVista; cada punto es un edificio y desde zoom 15 se ve su huella.
function dibujarEdificiosSim(ctx, t, s, z) {
  if (!M || capaSim !== "edificios") return null;
  const f = fotoActual(), act = new Set(contexto().activos), A = activos().filter((c) => act.has(J_DE.get(c.u)));
  if (!A.length || (z < 12 && A.reduce((a, c) => a + c.n, 0) > MAX_PUNTOS_LEJOS)) return null;
  const huella = z >= Z_HUELLA, r = z >= 14 ? 2.3 : z >= 13 ? 1.7 : z >= 12 ? 1.3 : 1, est = A.map((c) => (f ? estadosEn(c, f) : null)), vis = [];
  ctx.lineWidth = 0.5; ctx.strokeStyle = "rgba(15,23,42,.5)";
  for (let k = 0; k < 5; k++) {
    let alguno = false;
    ctx.fillStyle = COLOR_DANO[k]; ctx.beginPath();
    A.forEach((c, a) => {
      const st = est[a];
      for (let i = 0; i < c.n; i++) {
        if ((st ? st[i] : 0) !== k) continue;
        const x = c.bX[i] * t.W - t.x0, y = c.bY[i] * t.W - t.y0;
        if (x < -20 || y < -20 || x > s.x + 20 || y > s.y + 20) continue;
        alguno = true;
        if (huella && c.off[i + 1] - c.off[i] >= 6) trazarHuella(ctx, c, i, t); else ctx.rect(x - r, y - r, 2 * r, 2 * r);
        if (z >= 14) vis.push([c, i]);
      }
    });
    if (alguno) { ctx.fill(); if (huella) ctx.stroke(); }
  }
  const c = selEdif && A.find((x) => x.u === selEdif.u);
  if (c && selEdif.i < c.n) {
    const i = selEdif.i, x = c.bX[i] * t.W - t.x0, y = c.bY[i] * t.W - t.y0;
    ctx.beginPath();
    if (huella && c.off[i + 1] - c.off[i] >= 6) trazarHuella(ctx, c, i, t); else ctx.arc(x, y, Math.max(7, r + 5), 0, 2 * Math.PI);
    ctx.lineWidth = 4; ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = "#0f172a"; ctx.stroke();
  }
  return vis.length ? vis : null;
}
function pistaSim() {
  if (vistaActual !== "simulacion") return;
  const p = $("pista"), z = mapa.getZoom();
  let txt = "";
  if (M && capaSim === "edificios" && activos().length) {
    const total = contexto().activos.reduce((a, j) => a + edifDist[j], 0);
    if (z < 12 && total > MAX_PUNTOS_LEJOS) txt = "Acerque el mapa para ver cada edificio";
    else if (z < 14) txt = "Cada punto es un edificio · acerque el mapa para hacer clic en uno";
    else if (z < Z_HUELLA) txt = "Clic en un edificio para ver cómo cambia su daño · desde zoom 15 se ve su huella";
  } else if (M && !vista) txt = "Clic en el mapa para mover el epicentro";
  p.textContent = txt;
  p.style.display = txt ? "block" : "none";
}
function clicSim(e) {
  if (!M) return;
  if (capaSim === "edificios" && mapa.getZoom() >= 14) {
    const r = capaEdif.buscar(e.containerPoint);
    if (r) { abrirEdificio(r[0], r[1]); return; }
  }
  if (vista) { toast("Para mover el epicentro vuelva a «Inicio · sin sismo» en el historial."); return; }
  epicentro = [e.latlng.lat, e.latlng.lng];
  mostrarParametros(); pintarTodo();
  toast("Epicentro movido · pulse Simular");
}

// ---------------- ficha del edificio elegido ----------------
function abrirEdificio(c, i) {
  selEdif = { u: c.u, i };
  const j = J_DE.get(c.u);
  if (j !== undefined && j !== seguido && contexto().activos.includes(j)) seguido = j;
  claveCajon = "";
  pintarTodo(); avisar("sim");
}
function cerrarCajon() { selEdif = null; claveCajon = ""; $("cajon").classList.remove("abierto"); pintarMapaSim(); }
$("cj-cerrar").addEventListener("click", cerrarCajon);
// Historia del edificio en las fotos de la simulación H hasta t: probabilidades y nivel en cada segundo.
function historiaEdificio(H, c, i, t) {
  const S = prepSim(c), k = S.error ? -1 : S.gi[i], out = [];
  if (!H || !H.sim || k < 0) return out;
  const g = S.grupos[k];
  for (const f of H.fotos) {
    if (f.t > t + 1e-9) break;
    const m = f.dem[S.j], x = m ? M.danoGrupo(g, m) : null, p = x && x.p ? x.p : [0, 0, 0, 0];
    out.push({ t: f.t, p, pga: x ? x.pga : 0, im: x && x.im != null ? x.im : 0, nivel: nivel([0, 0, ...p], 0, S.u[i]) });
  }
  return out;
}
function dibujarCajon() {
  if (vistaActual !== "simulacion" || !selEdif || !M) return;
  const c = datosDe(selEdif.u);
  if (!c) { cerrarCajon(); return; }
  const f = fotoActual(), clave = `${selEdif.u}:${selEdif.i}|${vista ? vista.letra : "-"}|${f ? f.t : "-"}|${modoClase}|${versionEdif}`;
  $("cajon").classList.add("abierto");
  if (clave === claveCajon) return;
  claveCajon = clave;
  const i = selEdif.i, B = c.B, S = prepSim(c), tip = B.tipologia && B.tipologia[i] != null ? (D.cats_edif.tipologia || [])[B.tipologia[i]] : null;
  $("cj-tit").textContent = `Edificio ${B.id[i]}`;
  $("cj-sub").textContent = `${nombreDistrito(c.u)} · ${nombreTipologia(tip)} · ${B.pisos[i]} ${B.pisos[i] === 1 ? "piso" : "pisos"}`;
  if (S.error) { $("cj-cuerpo").innerHTML = `<p class="mal">${esc(S.error)}</p>`; return; }
  const k = S.gi[i], g = k >= 0 ? S.grupos[k] : -1, curva = g >= 0 ? M.curvaGrupo(g) : null, H = vista && vista.sim ? vista : null;
  const hist = historiaEdificio(H, c, i, tVista), ahora = hist.length ? hist[hist.length - 1] : null, nv = ahora ? ahora.nivel : 0;
  const umbral = modoClase === "sorteo" ? S.u[i] : 0.5, pgem = SD.grupos.pisos_gem[g];
  let html = `<div><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">${nivelHtml(nv)}<span class="nota" style="margin:0">${H ? `Simulación ${H.letra} · t = ${tVista.toFixed(1)} s` : "Inicio · sin sismo"}</span></div>`;
  if (k < 0) html += '<p class="nota">Este edificio no cae en ningún grupo del notebook 11 (sin tipología, pisos o Vs30): no se le calcula daño.</p>';
  html += "</div>";
  html += `<div class="ficha">${[["Tipología GEM", nombreTipologia(tip)], ["Curva GEM", curva ? `${pgem} ${pgem === 1 ? "piso" : "pisos"} · ${curva.im}` : "—"],
    ["Vs30", `${fmt(B.vs30[i], 0)} m/s`], ["Área de la huella", `${fmt(B.area_m2[i], 0)} m²`],
    ["PGA en el suelo", ahora && ahora.pga ? `${fmt(ahora.pga, 3)} g` : "—"], [curva ? `${curva.im} en el suelo` : "IM", ahora && ahora.im ? `${fmt(ahora.im, 3)} g` : "—"]]
    .map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join("")}</div>`;
  if (curva) {
    html += `<div><h3>Probabilidad de daño ahora</h3><p class="expl">${modoClase === "sorteo" ? `El número fijo de este edificio es u = ${S.u[i].toFixed(3)} (línea negra): queda en el mayor nivel con P(≥ nivel) mayor que u.` : "Queda en el mayor nivel con P(≥ nivel) de al menos 50 % (línea negra)."}</p><div class="barras-p">` +
      [1, 2, 3, 4].map((q) => { const p = ahora ? ahora.p[q - 1] : 0; return `<div class="barra-p"><span>≥ ${NIVELES[q].toLowerCase()}</span><span class="pista-b"><i style="width:${100 * p}%;background:${COLOR_DANO[q]}"></i><em style="left:calc(${100 * umbral}% - 1px)"></em></span><b>${fmt(100 * p, 1)} %</b></div>`; }).join("") +
      `</div><p class="nota">Medianas θ de la curva (${curva.im}): ${curva.th.map((x) => fmt(x, 3)).join(" · ")} g; β = ${fmt(curva.beta, 3)}.</p></div>`;
    html += `<div><h3>Cómo cambió en el tiempo</h3><canvas id="g-edif" class="grafico" style="height:150px"></canvas>` +
      `<div class="ley-graf">${[1, 2, 3, 4].map((q) => `<span><i style="border-color:${COLOR_DANO[q]}"></i>≥ ${NIVELES[q].toLowerCase()}</span>`).join("")}<span><i class="punteada" style="border-color:#0f172a"></i>${modoClase === "sorteo" ? "u del sorteo" : "50 %"}</span></div>`;
    const pasos = [];
    hist.forEach((x, n) => { if (n === 0 || x.nivel !== hist[n - 1].nivel) pasos.push(x); });
    html += H ? `<ul class="pasos" style="margin-top:8px">${pasos.map((x) => `<li>${nivelHtml(x.nivel)}<small>desde t = ${x.t.toFixed(0)} s</small></li>`).join("")}</ul>` : '<p class="nota">Sin sismo: el edificio está sin daño.</p>';
    const otras = HIST.filter((x) => x !== H && x.fin && x.sim && x.activos.includes(S.j)).map((x) => {
      const hx = historiaEdificio(x, c, i, x.sim.duracion);
      return `<li><span class="chip">Simulación ${x.letra} · M${x.s.magnitud.toFixed(1)}</span>${nivelHtml(hx.length ? hx[hx.length - 1].nivel : 0)}</li>`;
    });
    html += `</div><div><h3>En las otras simulaciones (al final)</h3>${otras.length ? `<ul class="pasos">${otras.join("")}</ul>` : '<p class="nota">No hay otras simulaciones terminadas en memoria con este distrito.</p>'}</div>`;
  }
  html += `<div class="nota">${enlaces(B.lat[i], B.lon[i])}</div>`;
  $("cj-cuerpo").innerHTML = html;
  if (!curva) return;
  if (!H) { grafico("g-edif", { x: [0, 60], y: [0, 1], ejeX: "s", ejeY: "P(≥ nivel)", mensaje: "Sin sismo" }); return; }
  const d = H.sim.dist[S.j], xs = hist.map((x) => x.t);
  grafico("g-edif", { x: [0, H.sim.duracion], y: [0, 1], ejeX: "s desde el origen", ejeY: "P(≥ nivel)",
    hlineas: [{ y: umbral, color: "#0f172a" }],
    vlineas: [{ x: d.tP, color: "#f59e0b", punteada: true }, { x: d.tS, color: "#7c3aed", punteada: true }, { x: tVista, color: "#cbd5e1", ancho: 1 }],
    series: [1, 2, 3, 4].map((q) => ({ x: xs, y: hist.map((x) => x.p[q - 1]), color: COLOR_DANO[q], ancho: 1.8 })) });
}

// ---------------- indicadores y línea de tiempo ----------------
function dibujarKpis() {
  const ks = (t, v, s, cls = "") => `<div class="ks ${cls}"><span>${t}</span><b>${v}</b>${s ? `<small>${s}</small>` : ""}</div>`;
  if (!M) { $("kpis-sim").innerHTML = ks("Simulador", errorSim ? "No disponible" : "Cargando…", errorSim ? esc(errorSim) : "datos del notebook 11", "vista-k"); return; }
  const H = vista && vista.sim ? vista : null, f = H ? fotoEn(H, tVista) : null, E = edificiosMapa(H, f), danados = E.cont[1] + E.cont[2] + E.cont[3] + E.cont[4];
  const enMapaK = ks("Edificios del mapa con daño", fmt(danados, 0), E.n ? `${fmt(E.cont[3] + E.cont[4], 0)} ≥ severo · de ${fmt(E.n, 0)} en el mapa` : "cargando los edificios…");
  if (!H) {
    const act = activosSel();
    $("kpis-sim").innerHTML = ks("Vista", "Inicio · sin sismo", `${act.length} ${act.length === 1 ? "distrito listo" : "distritos listos"} para simular`, "vista-k") +
      ks("Onda P detectada", "—", "sin onda") + ks("Aviso antes de la S", "—", "sin onda") + ks("PGA máx. en el suelo", "—", "sin sacudida") + enMapaK +
      ks("Daño esperado (GEM)", "0", "≥ severo en todos los edificios");
    return;
  }
  const r = resumenEn(H, tVista), est = H.fin && tVista >= H.sim.duracion - 1e-6 ? "terminada" : animando ? "en curso" : "en pausa";
  $("kpis-sim").innerHTML = ks("Vista", `Simulación ${H.letra}`, `M${H.s.magnitud.toFixed(1)} · ${H.s.prof_km} km · ${est}`, "vista-k") +
    ks("Onda P detectada", `${r.det}/${r.n}`, `STA/LTA ${r.sta}/${r.n} · ${r.falsas} ${r.falsas === 1 ? "falsa alarma" : "falsas alarmas"}`) +
    ks("Aviso antes de la S", r.aviso !== null ? `${fmt(r.aviso, 1)} s` : "—", r.retraso !== null ? `retraso medio ${fmt(r.retraso, 2)} s` : "aún sin alarma") +
    ks("PGA máx. en el suelo", r.pgaMax ? `${fmt(r.pgaMax, 3)} g` : "—", r.pgaMax ? `en ${titulo(M.DIST[r.pgaDist].nombre)}` : "la onda aún no llega") + enMapaK +
    ks("Daño esperado (GEM)", `${fmt(r.severo, 0)} ≥ severo`, r.total ? `${fmt(r.moderado, 0)} ≥ moderado · ${fmt(r.colapso, 0)} colapso` : "");
}
function dibujarLinea() {
  const H = vista, si = !!(M && H && H.sim && vistaActual === "simulacion");
  $("linea").classList.toggle("si", si);
  if (si !== lineaVisible) { lineaVisible = si; mapa.invalidateSize({ pan: false }); }
  if (!si) return;
  const t = $("t");
  t.max = H.sim.duracion.toFixed(2);
  if (document.activeElement !== t) t.value = tVista;
  $("t-txt").textContent = `${tVista.toFixed(1)} / ${H.sim.duracion.toFixed(0)} s`;
  const d = H.sim.dist[seguido];
  $("t-marcas").textContent = d ? `${titulo(d.nombre)}: llega la P a ${d.tP.toFixed(1)} s y la S a ${d.tS.toFixed(1)} s` : "";
  $("play").textContent = animando ? "❚❚" : "▶";
}
function pintarTodo() {
  if (!M) { dibujarKpis(); return; }
  dibujarKpis(); dibujarLinea(); pintarMapaSim(); dibujarCajon();
  $("m-sim").classList.toggle("si", !!animando);
  if (vistaActual === "simulacion") actualizarBarra();
}

// ---------------- simulación y reproducción ----------------
function estadoControles() {
  if (!M) return;
  const vivo = animando && vista && !vista.fin, act = activosSel();
  ["escenario", "mag", "prof", "ds", "ka", "q0", "corregir", "calibrado", "semilla"].forEach((id) => { $(id).disabled = vivo; });
  $("simular").disabled = vivo || !act.length;
  $("estado-sim").textContent = !act.length ? "Elija al menos un distrito en el selector de arriba." : vivo ? `Simulando… la Simulación ${vista.letra} queda en el historial.` : "";
}
function simular() {
  const act = activosSel();
  if (!M || !act.length) return;
  const H = nuevaEntrada(HIST.length, sismoForm(), parametros(), act, $("escenario").selectedOptions[0].text);
  $("ocupado-txt").textContent = `Generando las señales de ${act.length} ${act.length === 1 ? "distrito" : "distritos"}…`;
  $("ocupado").style.display = "flex";
  setTimeout(() => {
    try {
      crearSim(H);
      HIST.push(H); guardarHistorial();
      vista = H; H.visto = Date.now(); tVista = 0; claveHex = ""; claveEdif = ""; claveCajon = "";
      if (!H.activos.includes(seguido)) seguido = masCercano(H.activos);
      reproducir(true);
      pintarHistorial(); mostrarParametros(); encuadrarSim(); avisar("sim");
    } catch (err) {
      $("estado-sim").textContent = "No se pudo simular: " + err.message;
      console.error(err);
    } finally {
      $("ocupado").style.display = "none";
    }
  }, 30);
}
function reproducir(si) {
  if (!vista || !vista.sim) return;
  if (si && tVista >= vista.sim.duracion - 1e-6) tVista = 0;
  animando = si; ultimoCuadro = null;
  estadoControles(); pintarHistorial(); pintarTodo();
  if (si) requestAnimationFrame(cuadro);
}
function cuadro(ahora) {
  if (!animando || !vista) return;
  const H = vista;
  if (ultimoCuadro !== null) tVista = Math.min(H.sim.duracion, tVista + (ahora - ultimoCuadro) / 1000 * Number($("velocidad").value));
  ultimoCuadro = ahora;
  if (tVista > H.tCalc) calcularHasta(H, tVista);
  const fin = tVista >= H.sim.duracion;
  if (ahora - ultimoDibujo > 60 || fin) { pintarTodo(); ultimoDibujo = ahora; }
  if (fin) { animando = false; estadoControles(); pintarHistorial(); pintarTodo(); avisar("sim"); return; }
  requestAnimationFrame(cuadro);
}
$("play").addEventListener("click", () => reproducir(!animando));
$("t").addEventListener("input", () => {
  if (!vista || !vista.sim) return;
  animando = false;
  tVista = Number($("t").value);
  if (tVista > vista.tCalc) calcularHasta(vista, tVista);
  estadoControles(); pintarHistorial(); pintarTodo();
});
$("simular").addEventListener("click", simular);
const NOTA_MODO = {
  sorteo: "Cada edificio tiene un número fijo al azar u (sale de su id). Queda en el mayor nivel con P(≥ nivel) > u; así la cantidad de edificios en cada nivel cuadra con lo esperado de las curvas GEM.",
  mediana: "Cada edificio queda en el mayor nivel que tiene al menos 50 % de probabilidad (la demanda ya superó la mediana θ de la curva). Suele dar menos edificios dañados que lo esperado.",
};
$("modo-clase").addEventListener("change", () => {
  modoClase = $("modo-clase").value;
  $("modo-nota").textContent = NOTA_MODO[modoClase];
  claveEdif = ""; claveCajon = "";
  refrescarLeyendaSim(); pintarTodo(); avisar("sim");
});
$("modo-nota").textContent = NOTA_MODO[modoClase];

// ---------------- arranque del simulador ----------------
function aplicarEscenario(mag) {
  const b = SD.sismo_base;
  epicentro = [b.lat, b.lon];
  $("mag").value = mag; $("prof").value = Math.round(b.prof_km);
}
async function cargarSimulador() {
  try {
    SD = SIM_INCRUSTADO || await fetch("simulador.json", { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(r.status === 404 || r.status === 503 ? "todavía no existen los datos del simulador (los escribe el notebook 11)" : `HTTP ${r.status}`);
      return r.json();
    });
    M = Motor.crear(SD);
  } catch (err) {
    errorSim = err.message;
    $("sim-cargando").innerHTML = `<b class="mal">No se pudo cargar el simulador</b><p class="nota">${esc(errorSim)}</p>`;
    console.error(err);
    pintarTodo(); actualizarBarra(); avisar("motor");
    return;
  }
  CLAVE = `simulador-historial|${SD.generado}`;
  const S = SD.sintetico, lnCal = S.periodos_cal.map(Math.log);
  interpCorr = (x) => { if (x <= lnCal[0]) return S.correccion[0]; if (x >= lnCal[lnCal.length - 1]) return S.correccion[S.correccion.length - 1]; let j = 0; while (lnCal[j + 1] < x) j++; return S.correccion[j] + (x - lnCal[j]) / (lnCal[j + 1] - lnCal[j]) * (S.correccion[j + 1] - S.correccion[j]); };
  M.DIST.forEach((d) => J_DE.set(String(d.ubigeo), d.j));
  SD.hex.h3.forEach((h, i) => IDX_HEX.set(h, i));
  edifDist = M.DIST.map(() => 0); hexDist = SD.hex.h3.map(() => []); edifHex = SD.hex.h3.map(() => 0);
  SD.grupos.d.forEach((d, g) => { edifDist[d] += SD.grupos.count[g]; const h = SD.grupos.h[g]; if (h >= 0) { edifHex[h] += SD.grupos.count[g]; if (!hexDist[h].includes(d)) hexDist[h].push(d); } });
  const b = SD.sismo_base;
  [[b.magnitud, `${b.nombre} (M${b.magnitud}, registrado)`], [7.5, "Mismo epicentro con M7.5"], [8.0, "Mismo epicentro con M8.0"]].forEach(([m, t]) => $("escenario").add(new Option(t, m)));
  $("semilla").value = b.semilla;
  aplicarEscenario(b.magnitud);
  const cal = calibrado();
  $("ds").value = Math.log10(cal.ds); $("ka").value = cal.ka; $("q0").value = cal.q0;
  ["mag", "prof", "ds", "ka", "q0", "corregir", "semilla"].forEach((id) => $(id).addEventListener("input", () => { mostrarParametros(); if (!vista) { pintarTodo(); avisar("sim"); } }));
  $("escenario").addEventListener("change", () => { aplicarEscenario(Number($("escenario").value)); mostrarParametros(); if (!vista) pintarTodo(); });
  $("calibrado").addEventListener("click", () => { const c = calibrado(); $("ds").value = Math.log10(c.ds); $("ka").value = c.ka; $("q0").value = c.q0; $("corregir").checked = true; mostrarParametros(); });
  HIST = leerHistorial();
  crearCapasSim();
  seguido = masCercano(activosSel());
  $("sim-cargando").hidden = true;
  mostrarParametros(); pintarHistorial(); estadoControles();
  if (vistaActual === "simulacion") VISTAS.simulacion.entrar();
  avisar("motor");
  const q = new URLSearchParams(location.search);
  if (q.has("velocidad")) $("velocidad").value = q.get("velocidad");
  if (q.has("auto")) { if (vistaActual !== "simulacion") mostrarVista("simulacion", false); setTimeout(simular, 300); }
}

VISTAS.simulacion = {
  titulo: "Simulación de un sismo",
  subtitulo: () => (!M ? (errorSim ? "El simulador no está disponible" : "Cargando el simulador…")
    : vista ? `Simulación ${vista.letra} · M${vista.s.magnitud.toFixed(1)} · ${vista.s.prof_km} km · ${descripcion(vista)} · t = ${tVista.toFixed(1)} s`
      : "Inicio · sin sismo: elija el sismo en el panel y pulse Simular"),
  entrar() {
    $("sim-cargando").hidden = !!M;
    if (!M) { pintarTodo(); return; }
    capaDistritos.addTo(mapa);
    if (!ctrlLeyendaSim._map) ctrlLeyendaSim.addTo(mapa);
    claveHex = ""; claveEdif = ""; claveCajon = "";
    estadoControles(); pintarHistorial(); mostrarParametros(); pintarTodo();
  },
  salir() {
    if (animando) { animando = false; estadoControles(); pintarHistorial(); }
    [capaHexSim, frenteP, frenteS, marcaEpi, marcaPlan, ...marcas].forEach((l) => l && l.remove());
    if (ctrlLeyendaSim._map) ctrlLeyendaSim.remove();
    $("pista").style.display = "none";
    dibujarLinea();
  },
  clic: clicSim,
  dibujarEdificios: dibujarEdificiosSim,
  alZoom: pistaSim,
  encuadrar: encuadrarSim,
};
escuchar("seleccion", () => {
  if (!M) return;
  const act = activosSel();
  if (vista && (vista.activos.length !== act.length || vista.activos.some((j, k) => j !== act[k]))) { ver(null); return; }
  if (!act.includes(seguido)) seguido = masCercano(act);
  if (selEdif && !SEL.has(selEdif.u)) cerrarCajon();
  claveEdif = ""; mostrarParametros(); estadoControles(); pintarTodo();
});
escuchar("datos", () => { versionEdif += 1; if (M) pintarTodo(); });
