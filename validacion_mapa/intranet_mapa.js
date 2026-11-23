// Vista Mapa de edificios: validación espacial de lo que hay en el lakehouse (hexágonos, edificios, OSM, suelo y estaciones).

// ---------------- hexágonos ----------------
const H = D.hex, nHex = H.h3_r8.length;
const METRICAS = [
  ["edificios", "Edificios por hexágono", null, MAGMA, true],
  ["pisos_medio", "Pisos medio", null, VIRIDIS],
  ["pisos_max", "Pisos máximo", null, VIRIDIS],
  ["altura_media", "Altura media (m)", null, VIRIDIS],
  ["pct_imputada", "% altura imputada", [0, 100], MAGMA],
  ["vs30_medio", "Vs30 medio (m/s)", null, VIRIDIS],
  ["Tb_TP_medio", "Tb/TP medio", null, VIRIDIS],
  ["n_distritos", "Distritos que toca el hexágono", [1, 3], MAGMA],
  ["esc:Sa_Tb_mediana_g", "Sa(Tb) mediana (g)", null, MAGMA],
  ["esc:pga_roca_g", "PGA en roca, kriging (g)", null, MAGMA],
  ["esc:kriging_sd_rel", "Incertidumbre kriging (sd rel.)", null, MAGMA],
  ["esc:dist_estacion_km", "Distancia a la estación (km)", null, MAGMA],
  ["esc:P_colapso_media", "P(colapso) media", null, MAGMA],
  ["esc:dano_esperado_medio", "Daño esperado medio", null, MAGMA],
  ["esc:pct_P_colapso_mayor_umbral", "% edificios P(colapso) > umbral", null, MAGMA],
  ["esc:pct_resonancia", "% edificios en resonancia", null, MAGMA],
  ["esc:pct_fuera_cobertura", "% fuera de cobertura", [0, 100], MAGMA],
];
const selMet = $("hex-metrica"), selEsc = $("hex-esc");
METRICAS.forEach(([k, n]) => selMet.add(new Option(n, k)));
D.escenarios.escenario.forEach((e, i) => selEsc.add(new Option(`${e} (${D.escenarios.tipo[i]})`, e)));
const hexFeatures = H.borde.map((b, i) => ({ type: "Feature", properties: { i }, geometry: { type: "Polygon", coordinates: [[...b, b[0]]] } }));
let hexEscala = null, hexValores = [], hexClick = null, hexVisibles = [];
const capaHex = L.geoJSON(null, {
  pane: "hex",
  style: () => ({ weight: 0.6, color: "#fff", opacity: 0.8, fillOpacity: 0.6 }),
  onEachFeature: (f, l) => {
    l.bindTooltip(() => `${H.h3_r8[f.properties.i]}<br>${selMet.selectedOptions[0].text}: <b>${fmt(hexValores[f.properties.i], 3)}</b>`, { sticky: true });
    l.on("click", () => { hexClick = f.properties.i; });
  },
});
function filtrarHex() {
  const nombres = new Set([...SEL].map((u) => POR_U.get(u).nombre));
  hexVisibles = hexFeatures.filter((f) => nombres.has(H.distrito[f.properties.i]));
  capaHex.clearLayers();
  capaHex.addData(hexVisibles);
  pintarHex();
}
function valoresHex() {
  const k = selMet.value;
  if (k.startsWith("esc:")) { const e = D.hex_esc[selEsc.value]; return e ? e[k.slice(4)] : Array(nHex).fill(null); }
  return H[k];
}
function pintarHex() {
  const def = METRICAS.find((m) => m[0] === selMet.value);
  selEsc.disabled = !selMet.value.startsWith("esc:");
  hexValores = valoresHex();
  hexEscala = escalaContinua(hexVisibles.map((f) => hexValores[f.properties.i]), def[3], def[2], def[4]);
  const op = +$("hex-op").value;
  $("v-op").textContent = `${Math.round(op * 100)} %`;
  capaHex.eachLayer((l) => {
    const v = hexValores[l.feature.properties.i];
    l.setStyle({ fillColor: hexEscala.color(v), fillOpacity: v == null ? op * 0.25 : op });
  });
  leyendasMapa();
}
selMet.onchange = selEsc.onchange = pintarHex;
$("hex-op").oninput = pintarHex;
function popupHex(i) {
  const filas = [["Distrito (moda)", titulo(H.distrito[i])], ["Distritos que toca", H.n_distritos[i]], ["Edificios", fmt(H.edificios[i], 0)],
    ["Pisos medio / máx", `${fmt(H.pisos_medio[i])} / ${H.pisos_max[i]}`], ["Altura media", fmt(H.altura_media[i], 1) + " m"],
    ["% altura imputada", fmt(H.pct_imputada[i], 1)], ["Vs30 medio", fmt(H.vs30_medio[i], 0)], ["Suelo (moda)", H.tipo_suelo[i]],
    ["Tb/TP medio", fmt(H.Tb_TP_medio[i], 3)]];
  const e = D.hex_esc[selEsc.value];
  if (e) {
    filas.push([`<i>Escenario ${selEsc.value}</i>`, ""]);
    for (const [k, n] of METRICAS.filter((m) => m[0].startsWith("esc:"))) filas.push([n, fmt(e[k.slice(4)][i], 4)]);
  }
  return tablaPopup(`Hexágono ${H.h3_r8[i]}`, filas);
}

// ---------------- edificios (color de validación) ----------------
const CE = D.cats_edif;
// Muestra de valores de una columna en los distritos cargados, para fijar la escala de color sin ordenar millones.
function muestraColumna(k, max = 60000) {
  const A = activos(), total = A.reduce((a, c) => a + c.n, 0), paso = Math.max(1, Math.floor(total / max)), v = [];
  for (const c of A) for (let i = 0; i < c.n; i += paso) v.push(c.B[k][i]);
  return v;
}
let edifColor = () => "#999", edifLeyenda = null;
function prepararColorEdif() {
  const k = $("edif-color").value;
  const catEsc = (cats, nombre, nombres) => {
    const col = cats.map((_, j) => CATS[j % CATS.length]);
    edifColor = (c, i) => (c.B[k] == null || c.B[k][i] == null ? "#999" : col[c.B[k][i]]);
    edifLeyenda = { titulo: nombre, cats: cats.map((x, j) => [nombres ? nombres(x) : x, col[j]]) };
  };
  if (k === "tipologia") return catEsc(CE.tipologia || [], "Tipología GEM", nombreTipologia);
  if (k === "altura_metodo") return catEsc(CE.altura_metodo, "Método de altura");
  if (k === "tipo_suelo") return catEsc(CE.tipo_suelo, "Tipo de suelo E.030");
  if (k === "pisos_metodo") return catEsc(CE.pisos_metodo, "Origen de los pisos");
  if (k === "error_osm") {
    const e = escalaContinua(null, DIVERGENTE, [-4, 4]);
    edifColor = (c, i) => (c.B.niveles_osm[i] == null ? "rgba(150,150,150,.35)" : e.color(c.B.pisos_25d[i] - c.B.niveles_osm[i]));
    edifLeyenda = { titulo: "pisos 2.5D − pisos OSM (gris: sin OSM)", escala: e };
    return;
  }
  if (k === "alerta") {
    edifColor = (c, i) => (c.bMal[i] ? "#e31a1c" : "#33a02c");
    edifLeyenda = { titulo: "Alertas", cats: [["sin alerta", "#33a02c"], ["con alerta", "#e31a1c"]] };
    return;
  }
  const dom = { pisos: [1, 10], altura_m: [3, 30], Tb_TP: [0, 2], confianza: [0.65, 1] }[k];
  const e = escalaContinua(dom ? null : muestraColumna(k), k === "Tb_TP" ? DIVERGENTE : VIRIDIS, dom);
  edifColor = (c, i) => e.color(c.B[k][i]);
  edifLeyenda = { titulo: $("edif-color").selectedOptions[0].text, escala: e };
}
const soloMalos = $("c-malos"), Z_EDIF = 14;
function dibujarEdificiosMapa(ctx, t, s, z) {
  if (!$("c-edif").checked || z < Z_EDIF) return null;
  const vis = [], huella = z >= 15, r = 2.2;
  ctx.lineWidth = 0.6; ctx.strokeStyle = "rgba(15,23,42,.55)";
  for (const c of activos()) {
    const { n, bX, bY, off, bMal } = c;
    for (let i = 0; i < n; i++) {
      if (soloMalos.checked && !bMal[i]) continue;
      const x = bX[i] * t.W - t.x0, y = bY[i] * t.W - t.y0;
      if (x < -50 || y < -50 || x > s.x + 50 || y > s.y + 50) continue;
      vis.push([c, i]);
      ctx.fillStyle = edifColor(c, i);
      if (huella && off[i + 1] - off[i] >= 6) {
        ctx.beginPath(); trazarHuella(ctx, c, i, t);
        ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
      } else ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
  }
  return vis;
}
function popupEdif([c, i]) {
  const B = c.B, al = alertas(B, i), tip = B.tipologia && B.tipologia[i] != null ? (CE.tipologia || [])[B.tipologia[i]] : null;
  return tablaPopup(`Edificio ${esc(B.id[i])}`, [
    ["Distrito", titulo(CE.distrito[B.distrito[i]])], ["H3 r8", B.h3_r8[i]],
    ["Pisos", `${B.pisos[i]} <span style="color:#94a3b8">(${CE.pisos_metodo[B.pisos_metodo[i]]})</span>`],
    ["Tipología GEM (simulador)", nombreTipologia(tip)],
    ["Altura", `${fmt(B.altura_m[i], 1)} m <span style="color:#94a3b8">(${CE.altura_metodo[B.altura_metodo[i]]})</span>`],
    ["Área huella", fmt(B.area_m2[i], 0) + " m²"], ["Confianza OB", fmt(B.confianza[i], 3)],
    ["Tb", fmt(B.Tb[i], 3) + " s"], ["Tb / TP", fmt(B.Tb_TP[i], 2)],
    ["Vs30", fmt(B.vs30[i], 0) + " m/s"], ["Suelo E.030", CE.tipo_suelo[B.tipo_suelo[i]]],
    ["Fuente del perfil", CE.perfil_fuente[B.perfil_fuente[i]] ?? "—"], ["Zona CISMID", B.zona_cismid[i] ?? "—"],
    ["Pisos estimados 2.5D", B.pisos_25d[i]],
    ["Pisos según OSM (real)", B.niveles_osm[i] == null ? "—" :
      `<b class="${Math.abs(B.pisos_25d[i] - B.niveles_osm[i]) <= 1 ? "ok" : "mal"}">${fmt(B.niveles_osm[i], 1)}</b>`],
    ["Altura máx. en la huella", fmt(B.altura_max_m[i], 1) + " m"],
    ["Alertas", al.length ? `<span class="mal">${al.join("<br>")}</span>` : '<span class="ok">ninguna</span>'],
  ]) + enlaces(B.lat[i], B.lon[i]);
}
$("edif-color").onchange = () => { prepararColorEdif(); capaEdif.dibujar(); leyendasMapa(); };
soloMalos.onchange = () => capaEdif.dibujar();

// ---------------- validación OSM ----------------
const escOsm = escalaContinua(null, DIVERGENTE, [-4, 4]);
const capaOsm = new CapaCanvas({
  pane: "osm",
  dibujar(ctx, t, s, z) {
    const vis = [], r = z >= 15 ? 5 : z >= 13 ? 3.5 : 2.2;
    ctx.lineWidth = 0.8; ctx.strokeStyle = "#0f172a";
    for (const c of activos()) {
      const { O, nO, oX, oY } = c;
      for (let i = 0; i < nO; i++) {
        const x = oX[i] * t.W - t.x0, y = oY[i] * t.W - t.y0;
        if (x < -10 || y < -10 || x > s.x + 10 || y > s.y + 10) continue;
        vis.push([c, i]);
        ctx.fillStyle = O.pisos[i] == null ? "#9a9a9a" : escOsm.color(O.pisos[i] - O.niveles[i]);
        ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); if (z >= 13) ctx.stroke();
      }
    }
    return vis;
  },
  buscar(p, t, z, vis) {
    let mejor = null, dmin = 64;
    for (const [c, i] of vis) {
      const dx = c.oX[i] * t.W - t.x0 - p.x, dy = c.oY[i] * t.W - t.y0 - p.y, d = dx * dx + dy * dy;
      if (d < dmin) { dmin = d; mejor = [c, i]; }
    }
    return mejor;
  },
});
function popupOsm([c, i]) {
  const O = c.O, par = O.pisos[i] != null, dif = par ? O.pisos[i] - O.niveles[i] : null;
  return tablaPopup(`OSM ${O.osm_id[i]}`, [
    ["Pisos según OSM (real)", fmt(O.niveles[i], 1)], ["Pisos estimados 2.5D", par ? O.pisos[i] : "—"],
    ["Pisos finales del modelo", par ? `${O.pisos_final[i]} (${D.cats_osm.pisos_metodo[O.pisos_metodo[i]]})` : "—"],
    ["Diferencia", par ? `<b class="${Math.abs(dif) <= 1 ? "ok" : "mal"}">${fmt(dif, 1)}</b>` : "—"],
    ["Altura 2.5D del modelo", fmt(O.altura_m[i], 1) + " m"], ["Altura esperada (OSM × 3.32 m − 0.31 m)", fmt(O.niveles[i] * 3.32 - 0.31, 0) + " m"],
    ["Emparejado por", D.cats_osm.pareja[O.pareja[i]]], ["Edificio del modelo", O.id[i] ?? "—"],
    ["Distancia al centroide", fmt(O.dist_m[i], 1) + " m"],
    ["Método altura", par ? D.cats_osm.altura_metodo[O.altura_metodo[i]] : "—"],
  ]) + enlaces(O.lat[i], O.lon[i], O.osm_id[i]);
}

// ---------------- suelo ----------------
const escSuelo = escalaContinua(null, VIRIDIS, [150, 760]);
const capaSuelo = new CapaCanvas({
  pane: "suelo",
  dibujar(ctx, t, s) {
    const vis = [];
    ctx.globalAlpha = 0.6;
    for (const c of activos()) {
      const { S, nS, sR } = c;
      for (let i = 0; i < nS; i++) {
        const x0 = sR[4 * i] * t.W - t.x0, y0 = sR[4 * i + 1] * t.W - t.y0, x1 = sR[4 * i + 2] * t.W - t.x0, y1 = sR[4 * i + 3] * t.W - t.y0;
        if (x1 < 0 || y1 < 0 || x0 > s.x || y0 > s.y) continue;
        vis.push([c, i]);
        ctx.fillStyle = escSuelo.color(S.vs30[i]);
        ctx.fillRect(x0, y0, x1 - x0 + 0.5, y1 - y0 + 0.5);
        if (S.relleno_mar[i]) { ctx.strokeStyle = "#e31a1c"; ctx.strokeRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2); }
      }
    }
    ctx.globalAlpha = 1;
    return vis;
  },
  buscar(p, t, z, vis) {
    for (const [c, i] of vis) {
      const r = c.sR;
      if (p.x >= r[4 * i] * t.W - t.x0 && p.x <= r[4 * i + 2] * t.W - t.x0 && p.y >= r[4 * i + 1] * t.W - t.y0 && p.y <= r[4 * i + 3] * t.W - t.y0) return [c, i];
    }
    return null;
  },
});
function popupSuelo([c, i]) {
  const S = c.S;
  return tablaPopup("Celda de suelo", [["Vs30 usado", fmt(S.vs30[i], 0) + " m/s"], ["Vs30 USGS", fmt(S.vs30_usgs[i], 0) + " m/s"],
    ["Perfil E.030", D.cats_suelo.perfil[S.perfil[i]]], ["Relleno / mar", S.relleno_mar[i] ? "sí" : "no"],
    ["Distrito", titulo(D.cats_suelo.distrito[S.distrito[i]] ?? "—")], ["En área de estudio", S.en_area_estudio[i] ? "sí" : "no"]]);
}

// ---------------- estaciones ----------------
const ES = D.estaciones;
const capaEst = L.layerGroup(ES.estacion.map((e, i) => L.circleMarker([ES.lat[i], ES.lon[i]], {
  pane: "marcas", radius: 6, color: "#0f172a", weight: 1.5, fillColor: "#facc15", fillOpacity: 1,
}).bindTooltip(`${e} · ${ES.nombre[i] ?? ""}`).bindPopup(tablaPopup(`Estación ${e}`, [["Nombre", ES.nombre[i] ?? "—"], ["Red", ES.red[i] ?? "—"],
  ["Vs30", fmt(ES.vs30[i], 0) + " m/s"], ["Registros", ES.registros[i]], ["PGA máx (g)", fmt(ES.pga_max_g[i], 4)], ["Eventos", ES.eventos[i]]]))));

// ---------------- leyendas ----------------
const ctrlLeyenda = L.control({ position: "bottomright" });
ctrlLeyenda.onAdd = () => { const d = L.DomUtil.create("div"); d.id = "leyendas"; L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d); return d; };
function htmlLeyenda(tit, e, cats) {
  if (cats) return `<div class="leyenda"><div class="titulo">${tit}</div>${cats.map(([n, c]) => `<div class="cat"><i style="background:${c}"></i>${n}</div>`).join("")}</div>`;
  return `<div class="leyenda"><div class="titulo">${tit}</div><div class="barra" style="background:linear-gradient(90deg,${e.colores.join(",")})"></div>` +
    `<div class="extremos"><span>${fmt(e.min, 3)}</span><span>${e.log ? "escala log" : ""}</span><span>${fmt(e.max, 3)}</span></div></div>`;
}
function leyendasMapa() {
  const div = $("leyendas");
  if (!div) return;
  let h = "";
  if (mapa.hasLayer(capaHex) && hexEscala && hexVisibles.length) h += htmlLeyenda("Hexágonos · " + selMet.selectedOptions[0].text, hexEscala);
  if ($("c-edif").checked && edifLeyenda && activos().length) h += htmlLeyenda("Edificios · " + edifLeyenda.titulo, edifLeyenda.escala, edifLeyenda.cats);
  if (mapa.hasLayer(capaOsm)) h += htmlLeyenda("OSM · pisos 2.5D − pisos OSM", escOsm);
  if (mapa.hasLayer(capaSuelo)) h += htmlLeyenda("Suelo · Vs30 (m/s), borde rojo = relleno/mar", escSuelo);
  div.innerHTML = h;
  div.style.display = h ? "" : "none";
}
function pistaMapa() {
  const p = $("pista");
  p.textContent = "Acerque el mapa para ver los edificios uno por uno";
  p.style.display = vistaActual === "mapa" && $("c-edif").checked && activos().length && mapa.getZoom() < Z_EDIF ? "block" : "none";
}

// Redibuja las capas de los distritos cargados y actualiza las cifras del panel.
function refrescarMapa() {
  const A = activos();
  $("k-edif").textContent = corto(A.reduce((a, c) => a + c.n, 0));
  $("k-alerta").textContent = corto(A.reduce((a, c) => a + c.malos, 0));
  $("k-osm").textContent = corto(A.reduce((a, c) => a + c.nO, 0));
  if (vistaActual !== "mapa") return;
  prepararColorEdif();
  capaEdif.dibujar(); capaOsm.dibujar(); capaSuelo.dibujar();
  leyendasMapa(); pistaMapa();
}

// ---------------- interruptores de capas ----------------
const CAPAS_MAPA = { "c-hex": capaHex, "c-osm": capaOsm, "c-suelo": capaSuelo, "c-est": capaEst };
function aplicarCapasMapa() {
  const ver = vistaActual === "mapa";
  for (const [id, capa] of Object.entries(CAPAS_MAPA)) (ver && $(id).checked ? capa.addTo(mapa) : capa.remove());
  if (ver && !$("c-distritos").checked) capaDistritos.remove(); else capaDistritos.addTo(mapa);
}
for (const id of [...Object.keys(CAPAS_MAPA), "c-distritos", "c-edif"]) {
  $(id).onchange = () => { aplicarCapasMapa(); capaEdif.dibujar(); leyendasMapa(); pistaMapa(); };
}

// Clic: OSM, edificio o suelo; si no, hexágono; si no, distrito sin cargar.
function clicMapa(e) {
  const p = e.containerPoint;
  for (const [capa, popup] of [[capaOsm, popupOsm], [capaEdif, popupEdif], [capaSuelo, popupSuelo]]) {
    if (!mapa.hasLayer(capa)) continue;
    const r = capa.buscar(p);
    if (r) { L.popup().setLatLng(e.latlng).setContent(popup(r)).openOn(mapa); hexClick = null; return; }
  }
  if (hexClick != null) { L.popup().setLatLng(e.latlng).setContent(popupHex(hexClick)).openOn(mapa); hexClick = null; return; }
  const d = DISTRITOS.find((x) => !SEL.has(x.u) && dentroGeo(e.latlng.lng, e.latlng.lat, x.f.geometry));
  if (d) {
    const div = L.DomUtil.create("div");
    div.innerHTML = tablaPopup(titulo(d.nombre), [["Edificios", fmt(d.edificios, 0)], ["Tamaño", d.mb ? fmt(d.mb, 1) + " MB" : "—"]]) + "<button>Agregar este distrito</button>";
    div.querySelector("button").onclick = () => { mapa.closePopup(); elegir([...SEL, d.u], false); };
    L.popup().setLatLng(e.latlng).setContent(div).openOn(mapa);
  }
}

VISTAS.mapa = {
  titulo: "Mapa de edificios",
  subtitulo: () => `Validación espacial del lakehouse · ${SEL.size} de ${DISTRITOS.length} distritos · datos del ${D.generado}`,
  entrar() {
    ctrlLeyenda.addTo(mapa);
    aplicarCapasMapa();
    refrescarMapa();
  },
  salir() {
    mapa.closePopup();
    for (const capa of Object.values(CAPAS_MAPA)) capa.remove();
    capaDistritos.addTo(mapa);
    ctrlLeyenda.remove();
    $("pista").style.display = "none";
  },
  clic: clicMapa,
  dibujarEdificios: dibujarEdificiosMapa,
  alZoom: pistaMapa,
};
escuchar("seleccion", () => { filtrarHex(); refrescarMapa(); });
escuchar("datos", refrescarMapa);
$("pie").textContent = `Fuente: notebook 12_mapa_validacion (base ${fmt(D.chequeos?.hex_con_edificios, 0)} hexágonos). Cada distrito se trae aparte al elegirlo.`;
