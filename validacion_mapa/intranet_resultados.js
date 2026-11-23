// Vistas Resultados y Validación: lo que dejó la onda en cada edificio y las pruebas de que la simulación es correcta.
let tokRes = 0, tokVal = 0, verifSpark = null, redibujarRes = null, pendientePagina = null;
const VALIDADA = new WeakMap();
const ICONO = { ok: "✓", aviso: "!", mal: "✗", info: "i", espera: "…" };
const CLAVES_GEM = ["leve", "moderado", "severo", "colapso"], NOMBRE_GE = ["≥ leve", "≥ moderado", "≥ severo", "colapso"];
const vigente = (tok, v) => vistaActual === v && tok === (v === "resultados" ? tokRes : tokVal);
const kg = (t, v, s = "") => `<div class="kg"><span>${t}</span><b>${v}</b><small>${s}</small></div>`;
const seg = (x, d = 1) => (x == null ? "—" : `${fmt(x, d)} s`);
const expo = (x) => (x === 0 ? "0" : Number.isFinite(x) ? x.toExponential(1) : "—");
const icono = (e, t = 24) => `<span class="icono ${e}" style="display:inline-grid;width:${t}px;height:${t}px;font-size:${t / 2}px">${ICONO[e]}</span>`;
const distSeguido = (H) => (H.activos.includes(seguido) ? seguido : H.activos[0]);

// ---------------- piezas comunes ----------------
function paginaCargando(id, txt) {
  $(id).innerHTML = `<div class="tarjeta vacio-pag"><span class="est cargando" style="display:inline-block;width:22px;height:22px;margin-bottom:12px"></span>` +
    `<b>${txt}</b><p id="${id}-progreso"></p></div>`;
}
const progresoEn = (id) => (x) => { const p = $(`${id}-progreso`); if (p) p.textContent = `${Math.round(100 * x)} %`; };
function sinMotor(id) {
  if (errorSim) $(id).innerHTML = `<div class="tarjeta vacio-pag"><b>El simulador no está disponible</b><p>${esc(errorSim)}</p></div>`;
  else paginaCargando(id, "Cargando el simulador…");
}
function listaSims(tit, txt) {
  if (!HIST.length) return `<div class="tarjeta vacio-pag"><b>Todavía no hay simulaciones</b><p>Corra un sismo en la vista Simulación: aquí aparecerá lo que dejó la onda en cada edificio.</p>` +
    '<button class="boton primario" type="button" data-ir="simulacion">Ir a Simulación</button></div>';
  return `<section class="tarjeta"><h2>${tit}</h2><p class="expl">${txt}</p><div class="hist" style="max-height:none">` + HIST.map((H, i) =>
    `<button class="hist-item" data-ver="${i}" type="button"><span class="insignia">${H.letra}</span><span class="hist-txt"><b>Simulación ${H.letra}</b>` +
    `<small>M${H.s.magnitud.toFixed(1)} · ${H.s.prof_km} km · ${descripcion(H)}</small>` +
    (H.resumen ? `<small>P detectada en ${H.resumen.det}/${H.resumen.n} · ${fmt(H.resumen.severo, 0)} edificios ≥ severo</small>` : "") +
    `</span><span class="estado${H.fin ? " lista" : ""}">${H.sim ? (H.fin ? "terminada" : "en pausa") : "se recalcula"}</span></button>`).reverse().join("") + "</div></section>";
}
// Clics de las dos páginas: elegir simulación, ir a otra vista, seguir un distrito o abrir un edificio en el mapa.
function clicPagina(e) {
  const b = e.target.closest("[data-ver],[data-ir],[data-seguir],[data-edif]");
  if (!b) return;
  if (b.dataset.ver !== undefined) {
    const H = HIST[Number(b.dataset.ver)];
    if (!H.sim) paginaCargando(e.currentTarget.id, `Recalculando la Simulación ${H.letra} con su semilla…`);
    ver(H);
  } else if (b.dataset.ir) {
    if (b.dataset.final && vista && vista.sim) { animando = false; tVista = vista.sim.duracion; }
    mostrarVista(b.dataset.ir, true);
  } else if (b.dataset.seguir !== undefined) seguir(Number(b.dataset.seguir));
  else { const [u, i] = b.dataset.edif.split(":"); irAEdificio(u, Number(i)); }
}
$("res").addEventListener("click", clicPagina);
$("val").addEventListener("click", clicPagina);
$("res").addEventListener("change", (e) => {
  if (e.target.id === "res-sim") ver(HIST[Number(e.target.value)]);
  else if (e.target.id === "res-dist") seguir(Number(e.target.value));
  else if (e.target.id === "res-modo") { $("modo-clase").value = e.target.value; $("modo-clase").dispatchEvent(new Event("change")); }
});
// Lleva al mapa de la simulación con el edificio al final de la onda y su ficha abierta.
function irAEdificio(u, i) {
  const c = datosDe(u);
  if (!c || !vista || !vista.sim) return;
  animando = false; tVista = vista.sim.duracion; capaSim = "edificios";
  mostrarVista("simulacion", true);
  refrescarLeyendaSim();
  mapa.setView([c.B.lat[i], c.B.lon[i]], 17, { animate: false });
  abrirEdificio(c, i);
}

// ---------------- resultados ----------------
// Clasificación de los edificios cargados en las fotos de la simulación (una por segundo; como mucho unos 60 puntos).
async function serieClases(H, cargados, tok) {
  const F = H.fotos, paso = Math.max(1, Math.ceil(F.length / 60)), idx = [], out = { t: [], n: [], esp: [] };
  for (let k = 0; k < F.length; k += paso) idx.push(k);
  if (idx[idx.length - 1] !== F.length - 1) idx.push(F.length - 1);
  for (let a = 0; a < idx.length; a++) {
    const f = F[idx[a]], n = [0, 0, 0, 0, 0], esp = [0, 0, 0, 0];
    cargados.forEach((c) => { const x = conteosEn(c, f); x.n.forEach((v, q) => { n[q] += v; }); x.esp.forEach((v, q) => { esp[q] += v; }); });
    out.t.push(f.t); out.n.push(n); out.esp.push(esp);
    if (a % 6 === 5) { await pausa(0); if (!vigente(tok, "resultados")) return null; }
  }
  return out;
}
// Un edificio de ejemplo de cada grupo (tipología, pisos, Vs30 y hexágono), ordenados por su probabilidad de daño al final.
function masAfectados(cargados, fin, cuantos = 12) {
  const todos = [];
  cargados.forEach((c) => {
    const S = prepSim(c), P = probsEn(c, fin);
    if (!P) return;
    const primero = new Int32Array(S.grupos.length).fill(-1), cuenta = new Int32Array(S.grupos.length);
    for (let i = 0; i < c.n; i++) { const k = S.gi[i]; if (k >= 0) { cuenta[k] += 1; if (primero[k] < 0) primero[k] = i; } }
    for (let k = 0; k < S.grupos.length; k++) {
      if (primero[k] >= 0 && P[6 * k + 2] > 1e-6) todos.push({ c, k, i: primero[k], n: cuenta[k], p: [2, 3, 4, 5].map((q) => P[6 * k + q]), im: P[6 * k + 1] });
    }
  });
  return todos.sort((a, b) => b.p[2] - a.p[2] || b.p[1] - a.p[1] || b.p[0] - a.p[0]).slice(0, cuantos);
}
function filaTop(H, x) {
  const { c, i, k } = x, B = c.B, S = prepSim(c), g = S.grupos[k], cu = M.curvaGrupo(g), pg = SD.grupos.pisos_gem[g];
  const tip = (D.cats_edif.tipologia || [])[B.tipologia[i]], h = historiaEdificio(H, c, i, H.sim.duracion), nv = h.length ? h[h.length - 1].nivel : 0;
  const desde = h.find((y) => y.nivel === nv);
  return `<tr class="clic" data-edif="${c.u}:${i}"><td><b>${nombreTipologia(tip)}</b> · ${pg} ${pg === 1 ? "piso" : "pisos"}<br>` +
    `<small style="color:var(--suave)">${nombreDistrito(c.u)} · Vs30 ${fmt(B.vs30[i], 0)} m/s · ${fmt(x.n, 0)} ${x.n === 1 ? "edificio" : "edificios iguales"}</small></td>` +
    `<td>${cu ? `${cu.im} ${fmt(x.im, 3)} g` : "—"}</td><td>${fmt(100 * x.p[2], 1)} %</td><td>${fmt(100 * x.p[3], 1)} %</td>` +
    `<td>${nivelHtml(nv)}${nv && desde ? `<br><small style="color:var(--suave)">desde t = ${desde.t.toFixed(0)} s</small>` : ""}</td></tr>`;
}
const textoOnda = (d, e) => `La P llega a los ${d.tP.toFixed(2)} s (a ${fmt(d.r, 1)} km del hipocentro) y la S a los ${d.tS.toFixed(2)} s. ` +
  (e.tModelo !== null ? `El champion da la alarma a los ${e.tModelo.toFixed(2)} s, ${(e.tModelo - d.tP).toFixed(2)} s después de la P, y deja ${(d.tS - e.tModelo).toFixed(1)} s de aviso.`
    : "El champion no llegó a dar la alarma.") + ` STA/LTA: ${e.tStaLta !== null ? `${e.tStaLta.toFixed(2)} s` : "sin detección"}.`;
const apilada = (v, tot) => `<div class="apilada">${v.map((x, k) => (x > 0 ? `<i style="width:${100 * x / tot}%;background:${COLOR_DANO[k]}" title="${NIVELES[k]}: ${fmt(x, 0)} (${porc(x, tot, 2)})"></i>` : "")).join("")}</div>`;
const leyNiveles = (desde = 0) => `<div class="ley-graf">${NIVELES.map((n, k) => (k >= desde ? `<span><i class="bloque" style="background:${COLOR_DANO[k]}"></i>${n}</span>` : "")).join("")}</div>`;

function htmlResultados(H, cargados, serie) {
  const fin = H.fotos[H.fotos.length - 1], gem = fin.gem, R = resumenEn(H, H.sim.duracion), rf = rfEn(H, H.sim.duracion), js = distSeguido(H);
  const nCarg = cargados.reduce((a, c) => a + c.n, 0), faltan = H.activos.length - cargados.length;
  const total = (modo) => cargados.reduce((o, c) => { conteosEn(c, fin, modo).n.forEach((v, q) => { o[q] += v; }); return o; }, [0, 0, 0, 0, 0]);
  const nS = total("sorteo"), nM = total("mediana"), nA = modoClase === "sorteo" ? nS : nM, e = serie.esp[serie.esp.length - 1] || [0, 0, 0, 0];
  const espN = [nCarg - e[0], e[0] - e[1], e[1] - e[2], e[2] - e[3], e[3]], nEd = H.activos.reduce((a, j) => a + edifDist[j], 0), cambiaron = nCarg - nA[0];
  const modoTxt = modoClase === "sorteo" ? "sorteo" : "nivel con P ≥ 50 %", d = H.sim.dist[js], nomD = titulo(d.nombre);
  const cab = '<div class="cab-pagina" id="res-listo">' +
    `<label class="campo"><span>Simulación</span><select id="res-sim">${HIST.map((x, i) => `<option value="${i}"${x === H ? " selected" : ""}>Simulación ${x.letra} · M${x.s.magnitud.toFixed(1)} · ${descripcion(x)}</option>`).reverse().join("")}</select></label>` +
    `<label class="campo"><span>Clasificación de cada edificio</span><select id="res-modo"><option value="sorteo"${modoClase === "sorteo" ? " selected" : ""}>Sorteo con su probabilidad</option><option value="mediana"${modoClase === "mediana" ? " selected" : ""}>Nivel con P ≥ 50 %</option></select></label>` +
    `<label class="campo"><span>Distrito de las ondas</span><select id="res-dist">${H.activos.map((j) => [j, titulo(M.DIST[j].nombre)]).sort((a, b) => a[1].localeCompare(b[1])).map(([j, n]) => `<option value="${j}"${j === js ? " selected" : ""}>${n}</option>`).join("")}</select></label>` +
    '<button class="boton primario" type="button" data-ir="simulacion" data-final="1">Ver el final en el mapa</button></div>';
  const kpis = '<div class="kpi-fila">' +
    kg("Edificios simulados", fmt(nEd, 0), `${H.activos.length} ${H.activos.length === 1 ? "distrito" : "distritos"} · M${H.s.magnitud.toFixed(1)} a ${H.s.prof_km} km`) +
    kg("Onda P detectada", `${R.det}/${R.n}`, `STA/LTA ${R.sta}/${R.n} · ${R.falsas} ${R.falsas === 1 ? "falsa alarma" : "falsas alarmas"}`) +
    kg("Aviso antes de la S", seg(R.aviso), R.retraso != null ? `detecta ${fmt(R.retraso, 2)} s después de la P` : "sin alarma") +
    kg("PGA máx. en el suelo", `${fmt(R.pgaMax, 3)} g`, `en ${titulo(M.DIST[R.pgaDist].nombre)}`) +
    kg("Daño ≥ severo (GEM)", fmt(gem.severo, 0), `${porc(gem.severo, gem.total, 2)} · ${fmt(gem.colapso, 0)} colapso`) +
    kg("Edificios que cambiaron", fmt(cambiaron, 0), nCarg ? `${porc(cambiaron, nCarg)} de ${fmt(nCarg, 0)} en el mapa` : "cargando sus edificios…") + "</div>";
  const clasif = !nCarg ? '<p class="nota">Cargando los edificios de los distritos simulados…</p>'
    : [["Antes del sismo", [nCarg, 0, 0, 0, 0]], ["Después · sorteo", nS], ["Después · P ≥ 50 %", nM], ["Esperado (curvas GEM)", espN]]
      .map(([t, v]) => `<div class="fila-apilada"><span>${t}</span>${apilada(v, nCarg)}</div>`).join("") + leyNiveles() +
      '<div class="tabla-scroll" style="margin-top:12px"><table><tr><th>Nivel</th><th>Antes</th><th>Sorteo</th><th>P ≥ 50 %</th><th>Esperado GEM</th></tr>' +
      NIVELES.map((n, k) => `<tr><td><span class="punto-n" style="background:${COLOR_DANO[k]}"></span>${n}</td><td>${fmt(k ? 0 : nCarg, 0)}</td><td>${fmt(nS[k], 0)}</td><td>${fmt(nM[k], 0)}</td><td>${fmt(espN[k], 1)}</td></tr>`).join("") +
      `<tr class="total"><td>Total</td><td>${fmt(nCarg, 0)}</td><td>${fmt(nCarg, 0)}</td><td>${fmt(nCarg, 0)}</td><td>${fmt(nCarg, 0)}</td></tr></table></div>`;
  const t1 = `<section class="tarjeta c7"><h2>Cómo cambió la clasificación de daño</h2><p class="expl">Antes del sismo los ${fmt(nCarg, 0)} edificios con huella del mapa están sin daño. ` +
    `Con la sacudida que les llega cada uno queda en un nivel según su probabilidad de las curvas GEM: <b>${fmt(cambiaron, 0)} (${porc(cambiaron, nCarg)}) cambiaron de nivel</b> con el ${modoTxt}.` +
    `${faltan ? ` Faltan ${faltan} ${faltan === 1 ? "distrito" : "distritos"} por cargar.` : ""}</p>${clasif}</section>`;
  const t2 = `<section class="tarjeta c5"><h2>Cuándo cambió</h2><p class="expl">Porcentaje de edificios en cada nivel segundo a segundo (${modoTxt}). La línea negra es lo esperado con daño ≥ leve.</p>` +
    `<canvas class="grafico" id="r-tiempo" style="height:250px"></canvas>${leyNiveles(1)}<div class="ley-graf"><span><i class="punteada" style="border-color:#0f172a"></i>esperado ≥ leve (GEM)</span>` +
    `<span><i class="punteada" style="border-color:#f59e0b"></i>P en ${nomD}</span><span><i class="punteada" style="border-color:#7c3aed"></i>S en ${nomD}</span></div></section>`;
  const top = masAfectados(cargados, fin);
  const t3 = '<section class="tarjeta c7"><h2>Edificios con más daño</h2><p class="expl">Un edificio de ejemplo por cada grupo (misma tipología, pisos, suelo y hexágono), ordenados por su probabilidad de daño severo al final. Clic para verlo en el mapa con su historia.</p>' +
    (top.length ? `<div class="tabla-scroll"><table><tr><th>Edificio</th><th>Demanda</th><th>≥ severo</th><th>Colapso</th><th>Nivel final</th></tr>${top.map((x) => filaTop(H, x)).join("")}</table></div>`
      : `<p class="nota">${nCarg ? "Ningún edificio con probabilidad de daño." : "Cargando los edificios…"}</p>`) + "</section>";
  const tips = D.cats_edif.tipologia || [], porTip = tips.map(() => [0, 0, 0, 0, 0]);
  cargados.forEach((c) => { const st = estadosEn(c, fin), T = c.B.tipologia; for (let i = 0; i < c.n; i++) if (T[i] != null) porTip[T[i]][st[i]] += 1; });
  const ordenT = tips.map((t, k) => ({ t, v: porTip[k], n: porTip[k].reduce((a, b) => a + b, 0) })).filter((x) => x.n).sort((a, b) => b.n - a.n);
  const t4 = `<section class="tarjeta c5"><h2>Por tipología GEM</h2><p class="expl">Nivel final de los edificios de cada tipología (${modoTxt}).</p>` +
    ordenT.map((x) => `<div class="fila-apilada"><span>${nombreTipologia(x.t)}<br><small>${fmt(x.n, 0)} · ${porc(x.v[3] + x.v[4], x.n)} ≥ severo</small></span>${apilada(x.v, x.n)}</div>`).join("") +
    (ordenT.length ? leyNiveles() : '<p class="nota">Cargando los edificios…</p>') + "</section>";
  const maxPct = Math.max(...H.activos.map((j) => (gem.dist[j].n ? gem.dist[j].severo / gem.dist[j].n : 0)), 1e-9);
  const filasG = H.activos.map((j) => ({ j, g: gem.dist[j], rf: rf ? rf[j] : null })).sort((a, b) => b.g.severo - a.g.severo || b.g.pga - a.g.pga);
  const conRF = rf ? H.activos.map((j) => rf[j]).filter((x) => x && x.indice != null) : [];
  const t5 = '<section class="tarjeta c12"><h2>Daño esperado por distrito (curvas GEM)</h2><p class="expl">Suma de las probabilidades de cada edificio: el número esperado de edificios en cada nivel. Clic en un distrito para ver sus ondas abajo.</p><div class="tabla-scroll"><table>' +
    "<tr><th>Distrito</th><th>Edificios</th><th>PGA suelo media</th><th>PGA máx.</th><th>≥ leve</th><th>≥ moderado</th><th>≥ severo</th><th>%</th><th>Colapso</th><th>Índice 08</th></tr>" +
    `<tr class="total"><td>Total · ${H.activos.length} ${H.activos.length === 1 ? "distrito" : "distritos"}</td><td>${fmt(gem.total, 0)}</td><td>—</td><td>${fmt(gem.pgaMax, 3)} g</td><td>${fmt(gem.leve, 0)}</td><td>${fmt(gem.moderado, 0)}</td>` +
    `<td>${fmt(gem.severo, 0)}</td><td>${porc(gem.severo, gem.total, 2)}</td><td>${fmt(gem.colapso, 0)}</td><td>${conRF.length ? fmt(conRF.reduce((a, x) => a + x.indice, 0) / conRF.length, 3) : "—"}</td></tr>` +
    filasG.map((x) => {
      const pct = x.g.n ? x.g.severo / x.g.n : 0;
      return `<tr class="clic${x.j === js ? " sel" : ""}" data-seguir="${x.j}"><td><span class="barra-sev" style="width:${Math.max(2, 34 * pct / maxPct)}px"></span>${titulo(M.DIST[x.j].nombre)}</td>` +
        `<td>${fmt(x.g.n, 0)}</td><td>${fmt(x.g.pga, 3)} g</td><td>${fmt(x.g.pgaMax, 3)} g</td><td>${fmt(x.g.leve, 0)}</td><td>${fmt(x.g.moderado, 0)}</td><td>${fmt(x.g.severo, 0)}</td>` +
        `<td>${fmt(100 * pct, 2)} %</td><td>${fmt(x.g.colapso, 0)}</td><td>${x.rf && x.rf.indice != null ? fmt(x.rf.indice, 3) : "—"}</td></tr>`;
    }).join("") + "</table></div>" +
    (rf ? `<p class="nota">El índice de 08 se calcula en una muestra de 120 edificios por distrito; ${fmt(H.activos.reduce((a, j) => a + (rf[j].pctFuera || 0) * rf[j].n, 0) / Math.max(1, H.activos.reduce((a, j) => a + rf[j].n, 0)), 1)} % de la muestra queda fuera del rango de PGA con que se entrenó.</p>` : "") + "</section>";
  const t6 = `<section class="tarjeta c7"><h2>La onda en ${nomD}</h2><p class="expl">${textoOnda(d, H.sim.estado[js])}</p>` +
    '<canvas class="grafico" id="r-acel"></canvas><div class="ley-graf"><span><i style="border-color:#2563eb"></i>EW en el suelo</span><span><i style="border-color:#94a3b8"></i>vertical Z</span>' +
    '<span><i class="punteada" style="border-color:#f59e0b"></i>llega la P</span><span><i class="punteada" style="border-color:#7c3aed"></i>llega la S</span><span><i style="border-color:#dc2626"></i>alarma del champion</span><span><i style="border-color:#0ea5e9"></i>alarma STA/LTA</span></div>' +
    '<canvas class="grafico" id="r-onda" style="margin-top:12px"></canvas><div class="ley-graf"><span><i style="border-color:#dc2626"></i>P(onda P) del champion en cada ventana de 4 s</span><span><i style="border-color:#0ea5e9"></i>STA/LTA ÷ 10</span>' +
    '<span><i class="bloque" style="background:rgba(245,158,11,.3)"></i>entre la P y la S</span></div></section>';
  const t7 = '<section class="tarjeta c5"><h2>Detección en cada distrito</h2><p class="expl">Ordenados por distancia al hipocentro. Clic para ver sus ondas.</p><div class="tabla-scroll" style="max-height:440px;overflow-y:auto"><table>' +
    "<tr><th>Distrito</th><th>Distancia</th><th>Llega la P</th><th>Alarma</th><th>Aviso</th><th>STA/LTA</th><th>Falsas</th></tr>" +
    R.filas.slice().sort((a, b) => a.d.r - b.d.r).map((x) => `<tr class="clic${x.j === js ? " sel" : ""}" data-seguir="${x.j}"><td>${titulo(x.d.nombre)}</td><td>${fmt(x.d.r, 1)} km</td>` +
      `<td>${x.d.tP.toFixed(1)} s</td><td>${x.tMod !== null ? `${x.tMod.toFixed(1)} s` : "—"}</td><td>${x.tMod !== null ? `${(x.d.tS - x.tMod).toFixed(1)} s` : "—"}</td>` +
      `<td>${x.tSta !== null ? `${x.tSta.toFixed(1)} s` : "—"}</td><td>${x.falsas}</td></tr>`).join("") + "</table></div></section>";
  const t8 = '<section class="tarjeta c6"><h2>Frecuencias del movimiento en roca</h2><p class="expl" id="r-t-frec"></p><canvas class="grafico" id="r-frec" style="height:210px"></canvas>' +
    '<div class="ley-graf"><span><i style="border-color:#dc2626"></i>modelo de esta simulación</span><span><i class="punteada" style="border-color:#64748b"></i>modelo calibrado en 07</span>' +
    '<span><i style="border-color:#93c5fd"></i>señal simulada (EW)</span><span><i class="punteada" style="border-color:#334155"></i>frecuencia de esquina</span></div></section>';
  const t9 = '<section class="tarjeta c6"><h2>Amplificación del suelo</h2><p class="expl" id="r-t-amp"></p><div class="dos"><canvas class="grafico" id="r-amp" style="height:210px"></canvas><canvas class="grafico" id="r-sa" style="height:210px"></canvas></div>' +
    '<div class="ley-graf"><span><i class="punteada" style="border-color:#16a34a"></i>F lineal (champion de 06)</span><span><i style="border-color:#16a34a"></i>F con no linealidad (BSSA14)</span>' +
    '<span><i class="punteada" style="border-color:#b45309"></i>Sa en roca</span><span><i style="border-color:#b45309"></i>Sa en el suelo</span></div></section>';
  return cab + kpis + `<div class="rejilla">${t1}${t2}${t3}${t4}${t5}</div><h3 style="margin:8px 0 0">Las ondas y el suelo en ${nomD}</h3><div class="rejilla">${t6}${t7}${t8}${t9}</div>`;
}
function graficoTiempo(H, serie, nCarg) {
  const d = H.sim.dist[distSeguido(H)], x = serie.t, pct = (v) => (nCarg ? 100 * v / nCarg : 0);
  const ge = (n, q) => pct(n.slice(q).reduce((a, b) => a + b, 0));
  const areas = [4, 3, 2, 1].map((q) => ({ x, y0: serie.n.map((n) => (q === 4 ? 0 : ge(n, q + 1))), y1: serie.n.map((n) => ge(n, q)), color: COLOR_DANO[q] }));
  const gemLeve = serie.esp.map((e) => pct(e[0])), ymax = Math.max(0.01, ...serie.n.map((n) => ge(n, 1)), ...gemLeve) * 1.15;
  grafico("r-tiempo", { x: [0, H.sim.duracion], y: [0, ymax], ejeX: "s desde el origen", ejeY: "% de edificios", areas,
    vlineas: [{ x: d.tP, color: "#f59e0b", punteada: true }, { x: d.tS, color: "#7c3aed", punteada: true }],
    series: [{ x, y: gemLeve, color: "#0f172a", punteada: true, ancho: 1.4 }], mensaje: nCarg ? "" : "Cargando los edificios…" });
}
// Acelerograma, salida del champion, espectro de Fourier y amplificación del distrito seguido, al final de la simulación.
function graficosDistrito(H) {
  const j = distSeguido(H), d = H.sim.dist[j], e = H.sim.estado[j], C = SD.constantes, L = d.L, paso = Math.max(1, Math.floor(L / 900));
  if (d.series.ew) {
    const sub = (arr) => { const y = []; for (let i = 0; i < L; i += paso) { let mx = 0; for (let k = i; k < Math.min(i + paso, L); k++) if (Math.abs(arr[k]) > Math.abs(mx)) mx = arr[k]; y.push(mx); } return y; };
    let pico = 1e-4;
    for (const a of [d.series.ew, d.series.z]) for (let i = 0; i < L; i++) pico = Math.max(pico, Math.abs(a[i]));
    grafico("r-acel", { x: [0, L / M.FS], y: [-pico * 1.1, pico * 1.1], ejeX: "s desde el origen", ejeY: "g",
      vlineas: [{ x: d.tP, color: "#f59e0b", punteada: true }, { x: e.tModelo, color: "#dc2626", ancho: 2 }, { x: e.tStaLta, color: "#0ea5e9" }, { x: d.tS, color: "#7c3aed", punteada: true }],
      series: [{ y: sub(d.series.z), x0: 0, dx: paso / M.FS, color: "#94a3b8", ancho: 0.8 }, { y: sub(d.series.ew), x0: 0, dx: paso / M.FS, color: "#2563eb", ancho: 0.9 }] });
  }
  const staX = [], staY = [];
  e.lta.forEach((v, k) => { staX.push(Math.min((k + 1) * C.STA_S, L / M.FS)); staY.push(v == null ? null : Math.min(v / 10, 1.05)); });
  grafico("r-onda", { x: [0, L / M.FS], y: [0, 1.05], ejeX: "s (fin de cada ventana)", ejeY: "P(onda P)",
    hlineas: [{ y: C.UMBRAL_P_MODELO, color: "#dc2626" }, { y: C.UMBRAL_STA_LTA / 10, color: "#0ea5e9" }], bandas: [{ desde: d.tP, hasta: d.tS, color: "rgba(245,158,11,.1)" }],
    vlineas: [{ x: d.tP, color: "#f59e0b", punteada: true }, { x: d.tS, color: "#7c3aed", punteada: true }, { x: e.tModelo, color: "#dc2626", ancho: 2 }],
    series: [{ x: staX, y: staY, color: "#0ea5e9", ancho: 1 }, { x: e.ventanas.map((v) => v.fin), y: e.ventanas.map((v) => v.p), color: "#dc2626", ancho: 1.8 }] });
  const cal = calibrado(), fr = Array.from({ length: 160 }, (_, k) => 10 ** (-1.3 + k * (Math.log10(50) + 1.3) / 159));
  const corr = (f, q) => (q.corregir ? Math.exp(interpCorr(Math.log(1 / f))) : 1);
  const a = M.espectroFourier(fr, H.s.magnitud, d.r, H.p.ds, H.p.ka, H.p.q0), b = M.espectroFourier(fr, H.s.magnitud, d.r, cal.ds, cal.ka, cal.q0);
  const ya = Array.from(a.a, (v, k) => v * corr(fr[k], H.p)), yb = Array.from(b.a, (v, k) => v * corr(fr[k], cal)), series = [];
  if (!H.espectros[j] && d.rocaG && d.rocaG[0]) {
    const x = d.rocaG[0], n = 2 ** Math.floor(Math.log2(x.length)), X = Motor.rfft(Array.from(x.subarray(0, n), (v) => v * C.G_CM_S2)), fx = [], fy = [];
    for (let k = 1; k < X.re.length; k += 2) { fx.push(k * M.FS / n); fy.push(Math.hypot(X.re[k], X.im[k]) / M.FS); }
    H.espectros[j] = { fx, fy };
  }
  if (H.espectros[j]) series.push({ x: H.espectros[j].fx, y: H.espectros[j].fy, color: "#93c5fd", ancho: 0.8 });
  series.push({ x: fr, y: yb, color: "#64748b", punteada: true }, { x: fr, y: ya, color: "#dc2626", ancho: 1.8 });
  const ymax = Math.max(...ya.concat(yb).filter((v) => v > 0));
  grafico("r-frec", { x: [0.05, 50], y: [ymax / 1e5, ymax * 3], logx: true, logy: true, ejeX: "Hz", ejeY: "cm/s",
    bandas: [{ desde: 0.05, hasta: 0.1, color: "rgba(15,23,42,.04)" }, { desde: 25, hasta: 50, color: "rgba(15,23,42,.04)" }], vlineas: [{ x: a.fc, color: "#334155", punteada: true }], series });
  const tf = $("r-t-frec");
  if (tf) tf.textContent = `Espectro de Fourier del modelo estocástico a ${d.r.toFixed(0)} km de ${titulo(d.nombre)}, con frecuencia de esquina ${a.fc.toFixed(3)} Hz. Lo gris queda fuera del filtro de 0.1 a 25 Hz.`;
  const m = H.fotos[H.fotos.length - 1].dem[j], dd = M.DIST[j], pga = m ? m.pga : SD.amplificacion.pga_ref_nl, T = Array.from(M.PER);
  const fl = T.map((t) => Math.exp(M.lnAmplificacion(t, dd.vs30))), fn = T.map((t) => Math.exp(M.lnF(t, dd.vs30, pga)));
  grafico("r-amp", { x: [0.05, 4], y: [0, Math.max(2, ...fl, ...fn) * 1.1], logx: true, ejeX: "T (s)", ejeY: "F", hlineas: [{ y: 1, color: "#cbd5e1" }],
    series: [{ x: T, y: fl, color: "#16a34a", punteada: true }, { x: T, y: fn, color: "#16a34a", ancho: 1.8 }] });
  if (m) {
    const ym = Math.max(...m.saSuelo, ...m.sa);
    grafico("r-sa", { x: [0.05, 4], y: [Math.max(ym / 300, 1e-6), ym * 2], logx: true, logy: true, ejeX: "T (s)", ejeY: "Sa (g)",
      series: [{ x: T, y: Array.from(m.sa), color: "#b45309", punteada: true }, { x: T, y: Array.from(m.saSuelo), color: "#b45309", ancho: 1.8 }] });
  } else grafico("r-sa", { x: [0.05, 4], y: [1e-3, 1], logx: true, logy: true, ejeX: "T (s)", ejeY: "Sa (g)", mensaje: "Sin movimiento" });
  const ta = $("r-t-amp");
  if (ta) ta.textContent = `Izquierda: F(T) en ${titulo(dd.nombre)} (Vs30 mediano ${dd.vs30.toFixed(0)} m/s) con la PGA en roca de todo el registro, ${pga.toFixed(3)} g. Derecha: Sa en roca y en el suelo al final.`;
}
async function pintarResultados() {
  const tok = ++tokRes;
  if (vistaActual !== "resultados") return;
  actualizarBarra();
  if (!M) { redibujarRes = null; sinMotor("res"); return; }
  const H = vista;
  if (!H) { redibujarRes = null; $("res").innerHTML = listaSims("Elija una simulación", "Sus distritos pasan al mapa y aquí se ve lo que dejó la onda en cada edificio."); return; }
  if (!H.fin) {
    paginaCargando("res", `Calculando la Simulación ${H.letra} hasta el final de la onda…`);
    await completar(H, progresoEn("res"));
    if (!vigente(tok, "resultados") || vista !== H || !H.fin) return;
  }
  const act = new Set(H.activos), cargados = activos().filter((c) => act.has(J_DE.get(c.u)) && !prepSim(c).error);
  if (cargados.length && !$("res-listo")) paginaCargando("res", "Clasificando cada edificio en cada segundo de la onda…");
  const serie = await serieClases(H, cargados, tok);
  if (!serie || !vigente(tok, "resultados") || vista !== H) return;
  const nCarg = cargados.reduce((a, c) => a + c.n, 0), arriba = $("v-resultados").scrollTop;
  $("res").innerHTML = htmlResultados(H, cargados, serie);
  $("v-resultados").scrollTop = arriba;
  redibujarRes = () => { graficoTiempo(H, serie, nCarg); graficosDistrito(H); };
  redibujarRes();
  actualizarBarra();
}

// ---------------- validación ----------------
function bloqueSpark() {
  const v = verifSpark, bien = (x) => x < 1e-9, di = v.distritos, fuera = di.fueraRango.length, eGem = !fuera ? "ok" : di.excesoMax < 0.005 ? "aviso" : "mal";
  const nomD = (d) => nombreDistrito(String(M.DIST[d].ubigeo));
  return { titulo:"1 · Los modelos del navegador son los de Spark",
    texto: `El navegador no entrena nada: usa los champions y tablas que exporta el notebook 11. Se les pasan los mismos datos que Spark ya evaluó (sismo de prueba ${esc(SD.verificacion.sismo)}) y se comparan los resultados.`,
    items: [
      { e: bien(v.onda.errMax) && v.onda.alarmasIguales === v.onda.n ? "ok" : "mal", t: `Champion de onda P (${SD.modelo_onda.algoritmo} v${SD.modelo_onda.version})`,
        p: `Las ${fmt(v.onda.n, 0)} ventanas de 4 s del 11 dan la misma probabilidad de onda P y la misma alarma (P ≥ ${SD.constantes.UMBRAL_P_MODELO}).`, v: `error máx. ${expo(v.onda.errMax)} · ${v.onda.alarmasIguales}/${v.onda.n} alarmas` },
      { e: bien(v.dano.errMax) ? "ok" : "mal", t: `Champion de daño (${SD.modelo_dano.algoritmo} v${SD.modelo_dano.version})`,
        p: `El índice de daño de los ${fmt(v.dano.n, 0)} edificios de la muestra del 11 sale igual.`, v: `error máx. ${expo(v.dano.errMax)}` },
      { e: bien(v.gem.errMax) ? "ok" : "mal", t: "Curvas de fragilidad GEM", p: `P(daño ≥ severo) de los mismos ${fmt(v.gem.n, 0)} edificios con su tipología, pisos y medida de intensidad.`, v: `error máx. ${expo(v.gem.errMax)}` },
      { e: bien(v.amplificacion.errRelMax) ? "ok" : "mal", t: "Amplificación del suelo (champion de 06 + no linealidad BSSA14)",
        p: `F(T) en ${fmt(v.amplificacion.n, 0)} combinaciones de distrito y periodo.`, v: `error relativo máx. ${expo(v.amplificacion.errRelMax)}` },
      { e: eGem, t: "Daño GEM por distrito con el movimiento del 11",
        p: "Con la sacudida en roca que simuló el 11 se calcula el P(≥ severo) medio de cada distrito con el Vs30 de cada grupo en los dos bordes de su intervalo de 10 m/s, " +
          "porque el 11 usa el Vs30 exacto de cada edificio en la no linealidad del suelo. " +
          (!fuera ? `El valor del 11 cae dentro de ese rango en los ${di.n} distritos (diferencia máx. con el centro del intervalo: ${fmt(di.errMaxSevero, 4)}).`
            : `En ${fuera} de ${di.n} distritos (${di.fueraRango.slice(0, 4).map(nomD).join(", ")}${fuera > 4 ? "…" : ""}) el valor del 11 queda fuera, por hasta ${fmt(di.excesoMax, 4)}` +
              (eGem === "aviso" ? ": la tabla sismo_dano_edificios del 11 cuenta más de una vez a los edificios repetidos de gold_edificios (ver sección 2)." : ": revise el 11 y el simulador.")),
        v: fuera ? `${fuera} fuera · exceso máx. ${expo(di.excesoMax)}` : `${di.n}/${di.n} dentro` },
      { e: di.zMax <= 3 ? "ok" : "aviso", t: "Índice de daño de 08 por distrito (muestra)",
        p: `El navegador evalúa el champion de 08 en la muestra de ${di.nMuestra} edificios por distrito que exporta el 11, y el 11 lo promedia en todos los edificios. ` +
          `La diferencia (máx. ${fmt(di.errMaxIndice, 4)}) se mide en errores estándar de la muestra: ${di.zMax <= 3 ? `queda dentro de ± 3 en los ${di.n} distritos` : "algún distrito pasa de ± 3"}` +
          `${di.zDistrito != null ? ` (la mayor, ${fmt(di.zMax, 2)} σ en ${nomD(di.zDistrito)})` : ""}.`,
        v: `desvío máx. ${fmt(di.zMax, 2)} σ` },
    ] };
}
function bloqueEdificios() {
  const items = [], filas = [];
  let mal = 0;
  activos().forEach((c) => {
    const S = prepSim(c);
    if (S.error) { mal += 1; filas.push(`<tr><td>${nombreDistrito(c.u)}</td><td colspan="5" class="mal" style="text-align:left">${esc(S.error)}</td><td>${icono("mal", 20)}</td></tr>`); return; }
    if (!S.ok) mal += 1;
    filas.push(`<tr><td>${nombreDistrito(c.u)}</td><td>${fmt(c.n, 0)}</td><td>${fmt(S.edif11, 0)}</td><td>${fmt(S.grupos.length, 0)} de ${fmt(S.gruposDistrito, 0)}</td>` +
      `<td>${fmt(S.fuera, 0)}</td><td>${fmt(S.distintos, 0)}</td><td>${icono(S.ok ? "ok" : "mal", 20)}</td></tr>`);
  });
  const pend = [...SEL].filter((u) => !CARGA.has(u) || CARGA.get(u).estado === "cargando").length, tit = "Cada edificio del mapa cae en su grupo del notebook 11";
  items.push(filas.length ? { e: mal ? "mal" : pend ? "espera" : "ok", t: tit, v: `${filas.length - mal}/${filas.length} distritos`,
    p: "Con la tipología GEM y el Vs30 que el notebook 12 calcula igual que el 11, cada edificio cae en un grupo del 11 (distrito, hexágono, Vs30, tipología y pisos GEM) y los conteos por grupo son los mismos. " +
      `Por eso el daño de cada edificio es el de su grupo en el 11.${pend ? ` Faltan ${pend} ${pend === 1 ? "distrito" : "distritos"} por cargar.` : ""}` }
    : { e: "espera", t: tit, p: pend ? "Cargando los edificios de los distritos elegidos…" : "Elija distritos en el selector de arriba para comprobar sus edificios." });
  let idsRep = 0, deMas = 0, nEd = 0, nOk = 0;
  activos().forEach((c) => { const S = prepSim(c); if (S.error) return; idsRep += S.idsRepetidos; deMas += S.filasDeMas; nEd += c.n; nOk += 1; });
  const titRep = "Cada edificio aparece una sola vez";
  items.push(nOk ? { e: deMas ? "aviso" : "ok", t: titRep, v: deMas ? `${fmt(idsRep, 0)} ids repetidos` : `${fmt(nEd, 0)} ids únicos`,
    p: deMas ? `En los distritos elegidos, ${fmt(idsRep, 0)} ids aparecen más de una vez en gold_edificios (${fmt(deMas, 0)} filas de más, ${porc(deMas, nEd, 2)}): ` +
      "el mapa y los grupos del 11 los cuentan varias veces. Es un problema de los datos del lakehouse, no de la simulación." : `Ningún id se repite en los ${nOk} distritos elegidos.` }
    : { e: "espera", t: titRep, p: "Elija distritos en el selector de arriba para revisar sus ids." });
  let distintos = 0, nd = 0, tot = 0;
  M.DIST.forEach((d) => { const a = D.archivos && D.archivos[String(d.ubigeo)]; if (!a) return; nd += 1; tot += edifDist[d.j]; if (a.edificios !== edifDist[d.j]) distintos += 1; });
  items.push({ e: nd && !distintos ? "ok" : "mal", t: "El simulador y el mapa tienen los mismos edificios", p: `En los ${nd} distritos, los grupos del 11 suman los mismos edificios que los archivos del mapa que arma el 12.`,
    v: distintos ? `${distintos} distritos distintos` : `${fmt(tot, 0)} edificios` });
  return { titulo: "2 · Los edificios del mapa son los que simula el 11", items,
    extra: filas.length ? `<div class="tabla-scroll" style="margin-top:8px"><table><tr><th>Distrito</th><th>Edificios del mapa</th><th>Edificios del 11</th><th>Grupos</th><th>Sin grupo</th><th>Conteo distinto</th><th></th></tr>${filas.join("")}</table></div>` : "" };
}
// Repite desde cero el distrito más cercano al sismo y revisa en todas las fotos que la probabilidad de cada grupo nunca baje.
async function validarSim(H, progreso) {
  if (VALIDADA.has(H)) return VALIDADA.get(H);
  const t0 = performance.now(), j0 = H.activos.reduce((a, j) => (H.sim.dist[j].r < H.sim.dist[a].r ? j : a), H.activos[0]);
  const uno = M.simular(H.s, H.p, [j0]), d1 = uno.dist[j0], d0 = H.sim.dist[j0];
  let difSerie = d1.L === d0.L && d0.series.ew ? 0 : Infinity;
  if (difSerie === 0) for (let i = 0; i < d1.L; i++) difSerie = Math.max(difSerie, Math.abs(d1.series.ew[i] - d0.series.ew[i]));
  const maxAbs = (a) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); return m; };
  const saE = M.espectroSa(d1.series.ew_roca), saN = M.espectroSa(d1.series.ns_roca);
  const lote = { sa: Array.from(saE, (x, k) => Math.sqrt(x * saN[k])), pga: Math.sqrt(maxAbs(d1.series.ew_roca) * maxAbs(d1.series.ns_roca)) };
  await pausa(0);
  uno.avanzar(uno.duracion);
  const fin = H.fotos[H.fotos.length - 1], m0 = fin.dem[j0], dem1 = uno.demanda(), e1 = uno.estado[j0], e0 = H.sim.estado[j0];
  const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
  const difDem = (x) => (x && m0 ? Math.max(rel(x.pga, m0.pga), ...Array.from(m0.sa, (s, k) => rel(x.sa[k], s))) : Infinity);
  const g1 = M.impactoGEM(dem1).dist[j0], g0 = fin.gem.dist[j0];
  const difDano = Math.max(...CLAVES_GEM.map((q) => Math.abs(g1[q] - g0[q]) / Math.max(g0[q], 1)));
  const mismaAlarma = e1.tModelo === e0.tModelo && e1.tStaLta === e0.tStaLta && e1.ventanas.length === e0.ventanas.length && e1.ventanas.every((w, k) => w.p === e0.ventanas[k].p);
  const v = { j0, difSerie, difSolo: Math.max(difDem(dem1[j0]), difDano), mismaAlarma, difLote: difDem(lote), ms: 0 };
  const act = new Set(H.activos), GR = SD.grupos, gs = [];
  for (let g = 0; g < M.NG; g++) if (act.has(GR.d[g])) gs.push(g);
  const prev = new Float64Array(4 * gs.length);
  let bajadas = 0, maxBajada = 0, edificios = 0;
  gs.forEach((g) => { edificios += GR.count[g]; });
  for (let k = 0; k < H.fotos.length; k++) {
    const dem = H.fotos[k].dem;
    for (let x = 0; x < gs.length; x++) {
      const m = dem[GR.d[gs[x]]];
      if (!m) continue;
      const p = M.danoGrupo(gs[x], m).p;
      if (!p) continue;
      for (let q = 0; q < 4; q++) { const b = prev[4 * x + q] - p[q]; if (b > 1e-12) { bajadas += 1; maxBajada = Math.max(maxBajada, b); } prev[4 * x + q] = p[q]; }
    }
    if (k % 4 === 3) { if (progreso) progreso(k / H.fotos.length); await pausa(0); }
  }
  Object.assign(v, { monotonia: { bajadas, maxBajada, grupos: gs.length, edificios }, ms: performance.now() - t0 });
  VALIDADA.set(H, v);
  return v;
}
function bloqueSim(H, v) {
  if (!H) return { titulo: "3 · La simulación", items: [{ e: "espera", t: "Ninguna simulación elegida", p: "Corra un sismo o elija uno del historial para comprobar que su simulación es correcta." }],
    extra: listaSims("Elija una simulación para validarla", "Se repite uno de sus distritos desde cero y se revisa cada segundo de la clasificación de los edificios.") };
  const C = SD.constantes, fin = H.fotos[H.fotos.length - 1], R = resumenEn(H, H.sim.duracion), act = new Set(H.activos), items = [], nom = titulo(M.DIST[v.j0].nombre), n1 = H.activos.length;
  let ruido = 0, desorden = 0;
  H.activos.forEach((j) => { const d = H.sim.dist[j], x = d.series.ew; if (!(d.tP < d.tS)) desorden += 1; if (x) for (let i = 0; i < d.iP; i++) ruido = Math.max(ruido, Math.abs(x[i])); });
  items.push({ e: !desorden && ruido <= 8 * C.RUIDO_G ? "ok" : "mal", t: "Las ondas llegan cuando deben", v: `${n1 - desorden}/${n1} distritos`,
    p: `En cada distrito la P llega a la distancia ÷ ${C.VP_KM_S} km/s y la S a la distancia ÷ ${C.VS_KM_S} km/s. Antes de la P el sensor solo registra ruido: como máximo ${fmt(ruido, 5)} g, del orden del ruido simulado (${C.RUIDO_G} g).` });
  items.push({ e: v.difSerie === 0 ? "ok" : "mal", t: "La misma semilla da la misma señal", v: `diferencia máx. ${expo(v.difSerie)} g`,
    p: `Se volvió a generar desde cero el registro de ${nom} (el distrito más cercano al sismo) con la semilla ${H.s.semilla}: es idéntico muestra a muestra.` });
  items.push({ e: v.difSolo <= 1e-12 && v.mismaAlarma ? "ok" : "mal", t: n1 > 1 ? "Un distrito da lo mismo solo o junto a otros" : "Repetir la simulación da lo mismo",
    v: v.mismaAlarma ? `alarma igual · dif. ${expo(v.difSolo)}` : "alarma distinta",
    p: `Simulando solo ${nom}, la probabilidad del champion en cada ventana, la alarma, la Sa, la PGA y el daño esperado son los mismos que en la simulación con ${n1} ${n1 === 1 ? "distrito" : "distritos"}.` });
  items.push({ e: v.difLote <= 1e-12 ? "ok" : "mal", t: "Muestra a muestra da lo mismo que en lote", v: `dif. relativa ${expo(v.difLote)}`,
    p: "La Sa y la PGA en roca que se acumulan muestra a muestra (como el streaming del 11) son, al final, las mismas que calcular el espectro con todo el registro de una vez." });
  const cargados = activos().filter((c) => act.has(J_DE.get(c.u)) && !prepSim(c).error);
  if (!cargados.length) items.push({ e: "espera", t: "Clasificación de cada edificio", p: "Cargando los edificios de los distritos simulados…" });
  else {
    const n = [0, 0, 0, 0, 0], esp = [0, 0, 0, 0], vari = [0, 0, 0, 0], nE = cargados.reduce((a, c) => a + c.n, 0), todosOk = cargados.every((c) => prepSim(c).ok);
    let err = 0;
    cargados.forEach((c) => {
      const k = conteosEn(c, fin, "sorteo"), g = fin.gem.dist[J_DE.get(c.u)];
      k.n.forEach((x, q) => { n[q] += x; });
      k.esp.forEach((x, q) => { esp[q] += x; vari[q] += k.vari[q]; err = Math.max(err, Math.abs(x - g[CLAVES_GEM[q]]) / Math.max(g[CLAVES_GEM[q]], 1)); });
    });
    items.push({ e: err < 1e-9 && todosOk ? "ok" : "mal", t: "La probabilidad de cada edificio suma lo esperado del distrito", v: `dif. relativa ${expo(err)}`,
      p: `Sumando la probabilidad de cada uno de los ${fmt(nE, 0)} edificios del mapa sale exactamente el número esperado de edificios en cada nivel que da la curva GEM de su distrito.` });
    const ge = (q) => n.slice(q + 1).reduce((a, b) => a + b, 0), z = [0, 1, 2, 3].map((q) => (ge(q) - esp[q]) / Math.max(Math.sqrt(vari[q]), 1));
    items.push({ e: z.every((x) => Math.abs(x) <= 3) ? "ok" : "aviso", t: "El sorteo de niveles cuadra con lo esperado", v: `desvío máx. ${fmt(Math.max(...z.map(Math.abs)), 2)} σ`,
      p: "Con un número fijo al azar por edificio, la cantidad en cada nivel cae dentro de lo esperado ± 3 desviaciones: " +
        [0, 1, 2, 3].map((q) => `${NOMBRE_GE[q]} ${fmt(ge(q), 0)} frente a ${fmt(esp[q], 1)} ± ${fmt(Math.sqrt(vari[q]), 1)}`).join("; ") + "." });
  }
  const mo = v.monotonia;
  items.push({ e: mo.bajadas === 0 ? "ok" : "mal", t: "Ningún edificio baja de nivel con el tiempo", v: mo.bajadas ? `${fmt(mo.bajadas, 0)} bajadas (máx. ${expo(mo.maxBajada)})` : "0 bajadas",
    p: `En las ${H.fotos.length} fotos de la simulación (una por segundo) la probabilidad de cada nivel de los ${fmt(mo.grupos, 0)} grupos (${fmt(mo.edificios, 0)} edificios) nunca baja: ` +
      "la sacudida acumulada solo crece y la no linealidad del suelo usa la PGA en roca de todo el registro, igual que el 11. Así el daño final es el mismo que calcula el 11." });
  const tarde = R.filas.filter((x) => x.tMod !== null && x.tMod >= x.d.tS).length;
  items.push({ e: R.det === R.n && !R.falsas && !tarde ? "ok" : "aviso", t: "El champion detecta la onda P antes de la S", v: `${R.det}/${R.n} distritos`,
    p: `Detecta la P en ${R.det} de ${R.n} distritos${R.retraso != null ? `, en promedio ${fmt(R.retraso, 2)} s después de que llega` : ""}${R.aviso != null ? `, y deja ${fmt(R.aviso, 1)} s de aviso antes de la S` : ""}. ` +
      `Falsas alarmas antes de la P: ${R.falsas}.${tarde ? ` En ${tarde} la alarma llega después de la S.` : ""}${R.det < R.n ? " Con sacudida débil el champion puede no reconocer la P: es un límite del modelo, no un error de la simulación." : ""}` });
  const rf = rfEn(H, H.sim.duracion), rango = (SD.modelo_dano.rangos || {}).PGA_g;
  if (rf) {
    const nn = H.activos.reduce((a, j) => a + (rf[j].n || 0), 0), fuera = H.activos.reduce((a, j) => a + (rf[j].pctFuera || 0) * (rf[j].n || 0) / 100, 0);
    items.push({ e: nn && fuera / nn > 0.05 ? "aviso" : "ok", t: "El champion de daño está dentro de lo que aprendió", v: `${porc(fuera, nn)} fuera`,
      p: `${porc(fuera, nn)} de la muestra de ${fmt(nn, 0)} edificios tiene una PGA en el suelo fuera del rango de entrenamiento${rango ? ` (${fmt(rango[0], 3)} a ${fmt(rango[1], 3)} g)` : ""}. ` +
        "La clasificación de cada edificio sale de las curvas GEM; el índice de 08 es un complemento." });
  }
  const rend = H.sim.rendimiento(), Vd = SD.verificacion, ms = rend.msPorVentana == null ? "—" : rend.msPorVentana < 0.005 ? `< ${fmt(0.01, 2)}` : fmt(rend.msPorVentana, 2);
  items.push({ e: "info", t: "Tiempo de cálculo", v: rend.msPorVentana != null ? `${ms} ms por ventana` : "—",
    p: `En este navegador el champion clasifica cada ventana de 4 s en ${ms} ms (${fmt(rend.ventanas, 0)} ventanas). ` +
      `En el 11, Spark tardó ${fmt(Vd.proceso_lote_spark_s, 0)} s por cada lote de ${Vd.lote_s} s de señal. Esta comprobación tomó ${fmt(v.ms / 1000, 1)} s.` });
  return { titulo: `3 · La Simulación ${H.letra} es correcta`, items,
    texto: `M${H.s.magnitud.toFixed(1)} a ${H.s.prof_km} km, ${descripcion(H)}. Se repite un distrito desde cero, se revisa la clasificación de los edificios cargados y cada segundo de los ${fmt(v.monotonia.edificios, 0)} edificios simulados.` };
}
function bloqueLakehouse() {
  const Q = D.chequeos || {}, g = Q.globales || {}, m = Q.muestra || {}, o = Q.osm || {}, tot = g.total || 0, items = [];
  const cuenta = (x) => (x ? `${fmt(x, 0)} (${porc(x, tot, 1)})` : "0");
  const cero = (x, t, p) => items.push({ e: x == null ? "espera" : x === 0 ? "ok" : "mal", t, p, v: x == null ? "—" : cuenta(x) });
  cero(g.sin_h3_r8, "Todos los edificios tienen hexágono H3", "La columna h3_r8 no tiene vacíos.");
  cero(g.h3_r9_distinto, "El hexágono r9 es el de su punto", "h3_id es la celda de resolución 9 que contiene (lon, lat).");
  cero(g.padre_distinto, "El hexágono r8 es el padre del r9", "h3_r8 = h3_toparent(h3_id, 8) en todos.");
  cero(g.sin_distrito, "Todos tienen distrito", "Ningún edificio queda sin distrito.");
  cero(m.distrito_distinto, "Cada punto cae dentro de su distrito", "Comprobado con los polígonos de los distritos (punto en polígono).");
  cero(m.centroide_lejos_5m, "El punto es el centro de la huella", "Ningún punto a más de 5 m del centroide de su polígono.");
  cero(g.sin_pisos == null ? null : g.sin_pisos + g.sin_vs30 + g.sin_Tb_TP, "Pisos, Vs30 y Tb/TP completos", "Lo que necesitan la tipología, la amplificación y el modelo de daño.");
  cero(Q.hex_sin_edificios, "Los hexágonos de riesgo tienen edificios", `Ningún hexágono de riesgo_h3 queda sin edificios (${fmt(Q.hex_con_edificios, 0)} hexágonos).`);
  items.push({ e: "info", t: "Hexágono r8 distinto al que contiene el punto", v: cuenta(g.h3_r8_distinto),
    p: "Es normal en H3, que no anida exacto: el padre de una celda r9 no siempre es la celda r8 que contiene el punto. Se usa el padre, igual que en el 11." });
  items.push({ e: "info", t: "Edificios sin altura 2.5D", v: cuenta(g.altura_imputada), p: "Open Buildings no trae su altura y se imputa (columna altura_imputada)." });
  items.push({ e: g.altura_por_piso_rara ? "aviso" : "ok", t: "Altura por piso fuera de 1.8 a 6 m", v: cuenta(g.altura_por_piso_rara),
    p: "La altura 2.5D de Open Buildings es ruidosa, sobre todo en edificios bajos; por eso los pisos se contrastan con OpenStreetMap." });
  if (o.n) items.push({ e: "info", t: "Pisos frente a OpenStreetMap", v: `error medio ${fmt(o.mae, 2)} pisos`,
    p: `${fmt(o.n, 0)} edificios con niveles en OSM: ${fmt(o.pct_exacto, 1)} % con los mismos pisos, ${fmt(o.pct_pm1, 1)} % a ±1 piso y correlación ${fmt(o.corr, 3)}.` });
  return { titulo: "4 · Los datos del lakehouse están completos (notebook 12)", texto: `Chequeos de los ${fmt(tot, 0)} edificios de la capa gold, hechos en Spark al generar el mapa.`, items };
}
function tarjetaChequeos(b) {
  const n = (e) => b.items.filter((x) => x.e === e).length, mal = n("mal"), base = b.items.filter((x) => x.e !== "info").length;
  return `<section class="tarjeta c12"><h2>${b.titulo}<span class="chip">${mal ? `${mal} ${mal === 1 ? "falla" : "fallan"}` : `${n("ok")} de ${base} correctas`}</span></h2>` +
    (b.texto ? `<p class="expl">${b.texto}</p>` : "") +
    b.items.map((x) => `<div class="chequeo">${icono(x.e)}<div><b>${x.t}</b><p>${x.p}</p></div><span class="valor">${x.v || ""}</span></div>`).join("") + (b.extra || "") + "</section>";
}
function insigniaVal(mal, av) {
  const b = $("m-val");
  b.className = `insignia-m si ${mal ? "mal" : "ok"}`;
  b.textContent = mal ? String(mal) : "✓";
  b.title = mal ? `${mal} comprobaciones fallan` : `Todo correcto${av ? ` (${av} avisos sobre los datos)` : ""}`;
}
async function pintarValidacion() {
  const tok = ++tokVal;
  if (vistaActual !== "validacion") return;
  actualizarBarra();
  if (!M) { sinMotor("val"); return; }
  if (!verifSpark) {
    paginaCargando("val", "Comparando los modelos del navegador con los de Spark…");
    await pausa(30);
    if (!vigente(tok, "validacion")) return;
    verifSpark = verifSpark || M.verificar();
  }
  const H = vista;
  let v = null;
  if (H) {
    if (!H.fin) {
      paginaCargando("val", `Calculando la Simulación ${H.letra} hasta el final…`);
      await completar(H, progresoEn("val"));
      if (!vigente(tok, "validacion") || vista !== H || !H.fin) return;
    }
    if (!VALIDADA.has(H)) { paginaCargando("val", `Repitiendo un distrito de la Simulación ${H.letra} y revisando cada segundo…`); await pausa(30); }
    v = await validarSim(H, progresoEn("val"));
    if (!vigente(tok, "validacion") || vista !== H) return;
  }
  const B = [bloqueSpark(), bloqueEdificios(), bloqueSim(H, v), bloqueLakehouse()], todos = B.flatMap((b) => b.items);
  const cuenta = (e) => todos.filter((x) => x.e === e).length, mal = cuenta("mal"), av = cuenta("aviso"), ok = cuenta("ok"), pend = cuenta("espera");
  insigniaVal(mal, av);
  const [est, tit, sub] = mal ? ["mal", `${mal} ${mal === 1 ? "comprobación falla" : "comprobaciones fallan"}`, "Revise las marcadas con ✗."]
    : pend && H ? ["espera", "Validando…", "Faltan datos por cargar; la página se completa sola."]
      : !H ? ["ok", "Los modelos y los edificios están validados", "Corra o elija una simulación para validarla también."]
        : ["ok", `La Simulación ${H.letra} es correcta`, `Pasan ${ok} de ${ok + av} comprobaciones${av ? `; ${av} ${av === 1 ? "aviso" : "avisos"} sobre los datos o los límites de los modelos, no sobre la simulación` : ""}.`];
  const arriba = $("v-validacion").scrollTop;
  $("val").innerHTML = `<section class="tarjeta" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">${icono(est, 44)}` +
    `<div style="min-width:0"><h3 style="font-size:17px">${tit}</h3><p class="expl" style="margin:0">${sub}</p></div><div class="resumen-val" style="margin-left:auto">` +
    `<span class="chip">${icono("ok", 18)} ${ok} correctas</span><span class="chip">${icono("aviso", 18)} ${av} ${av === 1 ? "aviso" : "avisos"}</span>` +
    `<span class="chip">${icono("mal", 18)} ${mal} fallan</span>${pend ? `<span class="chip">${icono("espera", 18)} ${pend} pendientes</span>` : ""}</div></section>` +
    `<div class="rejilla">${B.map(tarjetaChequeos).join("")}</div>`;
  $("v-validacion").scrollTop = arriba;
  actualizarBarra();
}

VISTAS.resultados = {
  titulo: "Resultados de la simulación",
  subtitulo: () => (!M ? "Cargando el simulador…" : vista ? `Simulación ${vista.letra} · M${vista.s.magnitud.toFixed(1)} · ${vista.s.prof_km} km · ${descripcion(vista)} · al final de la onda`
    : HIST.length ? "Elija una simulación del historial" : "Todavía no hay simulaciones"),
  entrar() { pintarResultados(); },
  salir() { tokRes += 1; },
};
VISTAS.validacion = {
  titulo: "Validación",
  subtitulo: () => (vista ? `Modelos, edificios y Simulación ${vista.letra}` : "Modelos y edificios · elija una simulación para validarla"),
  entrar() { pintarValidacion(); },
  salir() { tokVal += 1; },
};
function programarPagina() {
  clearTimeout(pendientePagina);
  pendientePagina = setTimeout(() => { if (vistaActual === "resultados") pintarResultados(); else if (vistaActual === "validacion") pintarValidacion(); }, 120);
}
["sim", "datos", "seleccion", "motor"].forEach((t) => escuchar(t, programarPagina));
escuchar("motor", () => setTimeout(() => {
  if (!M) return;
  verifSpark = verifSpark || M.verificar();
  if (vistaActual !== "validacion") insigniaVal(bloqueSpark().items.filter((x) => x.e === "mal").length, 0);
}, 800));
window.addEventListener("resize", () => { if (vistaActual === "resultados" && redibujarRes) redibujarRes(); });
iniciar();
cargarSimulador();
