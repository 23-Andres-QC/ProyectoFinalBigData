"""Genera mapa_validacion.html: mapa de los 6 distritos de estudio con los datos del lakehouse para revisarlos a ojo.

Capas: distritos (silver.distritos), hexágonos H3 r8 (agregados de silver.edificios + gold.riesgo_h3 + gold.sa_roca_h3),
todos los edificios con su huella (silver.edificios), validación de pisos con OSM, grilla de suelo y estaciones CISMID.
Además corre chequeos (H3 recalculado, distrito por point-in-polygon, centroide vs. huella) y los muestra en el mapa.

Uso (kernel databricks-connect, Python 3.12):  python validacion_mapa/generar_mapa.py   [--solo-html]
Fondo de Google: poner la key (Map Tiles API) en validacion_mapa/google_maps_key.txt o en la variable GOOGLE_MAPS_KEY.
"""
import json
import math
import os
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import shapely
from databricks.connect import DatabricksSession

PROFILE = "22200144"
C = "grupo06proyectofinal"
CARPETA = Path(__file__).resolve().parent
SALIDA = CARPETA / "mapa_validacion.html"

CACHE = CARPETA / "datos_cache.json"                      # datos ya extraídos (para rehacer solo el HTML)
ARCHIVO_KEY = CARPETA / "google_maps_key.txt"             # key de Google Map Tiles API (no se sube a git)


def armar_html():
    plantilla = (CARPETA / "plantilla.html").read_text(encoding="utf-8")
    key = os.environ.get("GOOGLE_MAPS_KEY") or (ARCHIVO_KEY.read_text().strip() if ARCHIVO_KEY.exists() else "")
    texto = CACHE.read_text(encoding="utf-8").replace("</", "<\\/")
    html = plantilla.replace("/*__DATOS__*/null", texto).replace('/*__GOOGLE_KEY__*/""', json.dumps(key))
    SALIDA.write_text(html, encoding="utf-8")
    print(f"Listo: {SALIDA} ({SALIDA.stat().st_size / 1e6:.1f} MB) | fondo Google: {'sí' if key else 'no (sin key)'}")


if "--solo-html" in sys.argv:                             # rehace el HTML desde la caché sin consultar Databricks
    armar_html()
    sys.exit()

spark =DatabricksSession.builder.profile(PROFILE).serverless(True).getOrCreate()
E = f"{C}.silver.edificios"
t0 = time.perf_counter()


def tabla(sql):
    return spark.sql(sql).toPandas()


def columnas(df, redondeo=None):
    """DataFrame -> dict de listas (columnar, NaN -> None) para el JSON."""
    redondeo = redondeo or {}
    out = {}
    for c in df.columns:
        s = df[c]
        if pd.api.types.is_bool_dtype(s) or (s.dtype == object and s.notna().any() and s.dropna().map(lambda v: isinstance(v, (bool, np.bool_))).all()):
            out[c] = [None if pd.isna(v) else int(bool(v)) for v in s]
        elif pd.api.types.is_numeric_dtype(s):
            a = s.to_numpy(dtype="float64", na_value=np.nan)
            if c in redondeo:
                a = np.round(a, redondeo[c])
            out[c] = [None if math.isnan(v) else (int(v) if float(v).is_integer() else float(v)) for v in a]
        else:
            out[c] = [None if pd.isna(v) else str(v) for v in s]
    return out


def categorias(df, cols):
    """Reemplaza texto repetido por índices; devuelve los diccionarios."""
    dic = {}
    for c in cols:
        cats = sorted(df[c].dropna().astype(str).unique().tolist())
        idx = {v: i for i, v in enumerate(cats)}
        df[c] = pd.array([None if pd.isna(v) else idx[str(v)] for v in df[c]], dtype="Int64")
        dic[c] = cats
    return dic


# ---------------- Chequeos globales sobre todos los edificios ----------------
r = spark.sql(f"""
SELECT count(*) AS total,
       count_if(h3_r8 IS NULL) AS sin_h3_r8,
       count_if(h3_r8 <> h3_longlatash3string(lon, lat, 8)) AS h3_r8_distinto,
       count_if(h3_resolution(h3_id) <> 9) AS h3_id_no_r9,
       count_if(h3_id <> h3_longlatash3string(lon, lat, 9)) AS h3_r9_distinto,
       count_if(h3_toparent(h3_id, 8) <> h3_r8) AS padre_distinto,
       count_if(distrito IS NULL) AS sin_distrito,
       count_if(altura_imputada) AS altura_imputada,
       count_if(altura_m IS NULL) AS sin_altura,
       count_if(pisos IS NULL) AS sin_pisos,
       count_if(vs30 IS NULL) AS sin_vs30,
       count_if(Tb_TP IS NULL) AS sin_Tb_TP,
       count_if(altura_m / pisos > 6 OR altura_m / pisos < 1.8) AS altura_por_piso_rara,
       min(lon) AS lon_min, max(lon) AS lon_max, min(lat) AS lat_min, max(lat) AS lat_max,
       percentile_approx(altura_m, array(0.01, 0.5, 0.99)) AS altura_p01_p50_p99,
       max(altura_m) AS altura_max, max(pisos) AS pisos_max
FROM {E}""").first().asDict()
chequeos_globales = {k: (list(v) if isinstance(v, (list, tuple)) else v) for k, v in r.items()}
print("Chequeos globales:", chequeos_globales)

# ---------------- Distritos ----------------
dist = tabla(f"""
SELECT d.ubigeo, d.distrito, d.provincia, d.area_km2, d.geometria_fuente, d.geometry_wkt, e.edificios
FROM {C}.silver.distritos d
LEFT JOIN (SELECT distrito, count(*) AS edificios FROM {E} GROUP BY distrito) e USING (distrito)
WHERE d.en_estudio""")
geoms_dist = shapely.from_wkt(dist.geometry_wkt.to_numpy())
features_dist = []
for fila, g in zip(dist.itertuples(), geoms_dist):
    if g is None:
        continue
    gs = shapely.set_precision(shapely.simplify(g, 0.00003, preserve_topology=True), 0.000001)
    features_dist.append({"type": "Feature", "geometry": json.loads(shapely.to_geojson(gs)),
                          "properties": {"distrito": fila.distrito, "provincia": fila.provincia, "ubigeo": fila.ubigeo,
                                         "area_km2": round(float(fila.area_km2), 2) if pd.notna(fila.area_km2) else None,
                                         "fuente": fila.geometria_fuente,
                                         "edificios": int(fila.edificios) if pd.notna(fila.edificios) else 0}})
print(f"Distritos: {len(features_dist)}")

# ---------------- Hexágonos H3 r8 ----------------
hex_base = tabla(f"""
SELECT h3_r8, count(*) AS edificios, avg(pisos) AS pisos_medio, max(pisos) AS pisos_max, avg(altura_m) AS altura_media,
       avg(CAST(altura_imputada AS INT)) * 100 AS pct_imputada, avg(vs30) AS vs30_medio, avg(Tb_TP) AS Tb_TP_medio,
       mode(tipo_suelo) AS tipo_suelo, mode(distrito) AS distrito, count(DISTINCT distrito) AS n_distritos,
       h3_boundaryasgeojson(h3_r8) AS borde
FROM {E} WHERE h3_r8 IS NOT NULL GROUP BY h3_r8""")
riesgo = tabla(f"SELECT * FROM {C}.gold.riesgo_h3")
sa_roca = tabla(f"SELECT h3_r8, escenario, pga_roca_g, kriging_sd_rel, dist_estacion_km FROM {C}.gold.sa_roca_h3")
escenarios = tabla(f"SELECT escenario, evento, tipo, pga_roca_escenario_g FROM {C}.gold.escenarios ORDER BY tipo, escenario")

METRICAS_ESC = ["Sa_Tb_mediana_g", "P_colapso_media", "dano_esperado_medio", "pct_P_colapso_mayor_umbral",
                "pct_resonancia", "pct_fuera_cobertura"]
riesgo = riesgo.merge(sa_roca, on=["h3_r8", "escenario"], how="left")
METRICAS_ESC += ["pga_roca_g", "kriging_sd_rel", "dist_estacion_km"]
idx_hex = {h: i for i, h in enumerate(hex_base.h3_r8)}
esc_lista = escenarios.escenario.tolist()
por_esc = {}
for esc, d in riesgo.groupby("escenario"):
    pos = d.h3_r8.map(idx_hex)
    por_esc[esc] = {}
    for m in METRICAS_ESC:
        a = [None] * len(hex_base)
        for p, v in zip(pos, d[m]):
            if pd.notna(p) and pd.notna(v):
                a[int(p)] = round(float(v), 5)
        por_esc[esc][m] = a
hex_sin_edificios = sorted(set(riesgo.h3_r8) - set(hex_base.h3_r8))
edif_riesgo = riesgo.groupby("escenario").edificios.sum().to_dict()

bordes = []
for b in hex_base.borde:
    anillo = json.loads(b)["coordinates"][0]
    bordes.append([[round(x, 6), round(y, 6)] for x, y in anillo[:-1]])
hex_out = columnas(hex_base.drop(columns=["borde"]),
                   {"pisos_medio": 2, "altura_media": 1, "pct_imputada": 1, "vs30_medio": 0, "Tb_TP_medio": 3})
hex_out["borde"] = bordes
print(f"Hexágonos: {len(hex_base)} con edificios | en riesgo_h3 sin edificios: {len(hex_sin_edificios)}")

# ---------------- Pares OSM -> edificio ----------------
# Cada punto de OSM con building:levels se empareja con la huella que lo contiene (st_contains); si ninguna lo contiene,
# con el edificio de centroide más cercano a < 8 m. Se compara pisos_25d (la estimación 2.5D, sin OSM) para que no sea circular
spark.sql(f"""
WITH o AS (SELECT osm_id, lon, lat, niveles, explode(h3_kring(h3_longlatash3string(lon, lat, 9), 1)) AS celda
           FROM {C}.bronze.osm_niveles WHERE niveles BETWEEN 1 AND 40),
cand AS (SELECT o.osm_id, e.id, e.pisos_25d AS pisos, e.pisos AS pisos_final, e.pisos_metodo, e.altura_m, e.altura_metodo, e.area_m2,
                st_contains(st_geomfromwkt(e.geometry_wkt), st_point(o.lon, o.lat)) AS dentro,
                st_distance(st_transform(st_point(o.lon, o.lat, 4326), 32718), st_transform(st_point(e.lon, e.lat, 4326), 32718)) AS dist_m
         FROM o JOIN {E} e ON e.h3_id = o.celda),
mejor AS (SELECT * FROM (SELECT *, row_number() OVER (PARTITION BY osm_id ORDER BY dentro DESC, dist_m) AS r FROM cand)
          WHERE r = 1 AND (dentro OR dist_m < 8))
SELECT o.osm_id, o.lon, o.lat, o.niveles, m.id, m.pisos, m.pisos_final, m.pisos_metodo, m.altura_m, m.altura_metodo, m.area_m2, m.dist_m,
       CASE WHEN m.dentro THEN 'huella' WHEN m.id IS NOT NULL THEN 'centroide_8m' ELSE 'sin_pareja' END AS pareja
FROM (SELECT DISTINCT osm_id, lon, lat, niveles FROM {C}.bronze.osm_niveles WHERE niveles BETWEEN 1 AND 40) o
LEFT JOIN mejor m USING (osm_id)""").createOrReplaceTempView("pares_osm")
pares_osm = tabla("SELECT * FROM pares_osm")

# ---------------- Edificios (todos los del área de estudio) ----------------
edif = tabla(f"""
SELECT id, distrito, h3_r8, lon, lat, area_m2, confianza, altura_m, altura_metodo, pisos, pisos_metodo, Tb, Tb_TP,
       vs30, tipo_suelo, perfil_fuente, zona_cismid, con_microzonificacion, pisos_25d, niveles_osm, altura_max_m, geometry_wkt
FROM {E}""")
print(f"Edificios: {len(edif):,}")

# point-in-polygon local: ¿el centroide cae en el distrito asignado?
puntos = shapely.points(edif.lon.to_numpy(), edif.lat.to_numpy())
arbol = shapely.STRtree(geoms_dist)
i_pt, i_pol = arbol.query(puntos, predicate="within")
dist_pip = np.full(len(edif), None, dtype=object)
dist_pip[i_pt] = dist.distrito.to_numpy()[i_pol]
edif["distrito_pip"] = dist_pip
edif["distrito_ok"] = [a == b for a, b in zip(edif.distrito, edif.distrito_pip)]

# huellas: vértices como enteros (1e-6 grados) relativos al punto del edificio
huellas = shapely.from_wkt(edif.geometry_wkt.to_numpy())
edif["dist_centroide_m"] = np.round(
    np.hypot((shapely.get_x(shapely.centroid(huellas)) - edif.lon) * 111320 * np.cos(np.radians(edif.lat)),
             (shapely.get_y(shapely.centroid(huellas)) - edif.lat) * 110574), 1)
geo = []
for g, x0, y0 in zip(huellas, edif.lon.to_numpy(), edif.lat.to_numpy()):
    if g is None or g.is_empty:
        geo.append([])
        continue
    if g.geom_type == "MultiPolygon":
        g = max(g.geoms, key=lambda p: p.area)
    xy = np.asarray(g.exterior.coords)[:-1]
    geo.append(np.round((xy - [x0, y0]) * 1e6).astype(int).ravel().tolist())
edif = edif.drop(columns=["geometry_wkt", "distrito_pip"])
cats_edif = categorias(edif, ["distrito", "altura_metodo", "pisos_metodo", "tipo_suelo", "perfil_fuente"])
edif_out = columnas(edif, {"lon": 7, "lat": 7, "area_m2": 1, "confianza": 3, "altura_m": 1, "altura_max_m": 1, "Tb": 3, "Tb_TP": 3,
                            "vs30": 0, "niveles_osm": 1})
edif_out["g"] = geo
chequeos_muestra = {
    "muestra": len(edif),
    "distrito_distinto": int((~edif.distrito_ok).sum()),
    "centroide_lejos_5m": int((edif.dist_centroide_m > 5).sum()),
}
print("Chequeos de la muestra:", chequeos_muestra)

# ---------------- Validación de pisos con OSM (dato real) ----------------
osm = pares_osm.copy()
con_par = osm[osm.id.notna()]
dif = con_par.pisos - con_par.niveles
resumen_osm = {"n_osm": len(osm), "n": len(con_par), "por_huella": int((con_par.pareja == "huella").sum()),
               "mae": round(float(dif.abs().mean()), 2), "sesgo": round(float(dif.mean()), 2),
               "pct_exacto": round(float((dif == 0).mean() * 100), 1), "pct_pm1": round(float((dif.abs() <= 1).mean() * 100), 1),
               "corr": round(float(con_par[["pisos", "niveles"]].corr().iloc[0, 1]), 3)}
GRUPOS_OSM = [(1, 1, "1"), (2, 2, "2"), (3, 3, "3"), (4, 4, "4"), (5, 6, "5–6"), (7, 9, "7–9"), (10, 14, "10–14"), (15, 40, "15+")]
por_grupo = []
for a, b, nombre in GRUPOS_OSM:
    g = osm[osm.niveles.between(a, b)]
    p = g[g.id.notna()]
    d = p.pisos - p.niveles
    por_grupo.append({"grupo": nombre, "osm": len(g), "con_par": len(p), "niveles_medio": round(float(p.niveles.mean()), 1),
                      "pisos_medio": round(float(p.pisos.mean()), 1), "altura_media": round(float(p.altura_m.mean()), 1),
                      "mae": round(float(d.abs().mean()), 2), "sesgo": round(float(d.mean()), 2),
                      "pct_pm1": round(float((d.abs() <= 1).mean() * 100), 0)})
resumen_osm["por_grupo"] = por_grupo
# edificios altos (OSM >= 10 pisos) peor estimados, para revisarlos uno por uno
peores = con_par[con_par.niveles >= 10].assign(err=lambda x: x.pisos - x.niveles).sort_values("err").head(40)
resumen_osm["con_pisos_osm"] = int((con_par.pisos_metodo == "osm").sum())
resumen_osm["peores"] = [{"osm_id": r.osm_id, "lon": r.lon, "lat": r.lat, "niveles": float(r.niveles), "pisos": int(r.pisos),
                          "pisos_final": int(r.pisos_final),
                          "altura_m": None if pd.isna(r.altura_m) else round(float(r.altura_m), 1)} for r in peores.itertuples()]
cats_osm = categorias(osm, ["pisos_metodo", "altura_metodo", "pareja"])
osm_out = columnas(osm.drop(columns=["area_m2"]), {"lon": 7, "lat": 7, "dist_m": 1, "altura_m": 1})
print("Validación OSM:", {k: v for k, v in resumen_osm.items() if k not in ("por_grupo", "peores")})
print(pd.DataFrame(por_grupo).to_string(index=False))

# ---------------- Suelo y estaciones ----------------
suelo = tabla(f"SELECT lon, lat, vs30, vs30_usgs, relleno_mar, perfil, distrito, en_area_estudio FROM {C}.silver.suelo WHERE en_area_estudio")
paso = float(np.min(np.diff(np.sort(suelo.lon.unique()))))
cats_suelo = categorias(suelo, ["perfil", "distrito"])
suelo_out = columnas(suelo, {"lon": 6, "lat": 6, "vs30": 0, "vs30_usgs": 0})
est = tabla(f"""
SELECT estacion, first(estacion_nombre) AS nombre, first(red) AS red, avg(lat) AS lat, avg(lon) AS lon, first(vs30) AS vs30,
       count(*) AS registros, max(pga_geo_g) AS pga_max_g, concat_ws(', ', collect_set(evento)) AS eventos
FROM {C}.silver.ondas_registros GROUP BY estacion""")
est_out = columnas(est, {"lat": 5, "lon": 5, "vs30": 0, "pga_max_g": 4})

# ---------------- HTML ----------------
datos = {
    "generado": time.strftime("%Y-%m-%d %H:%M"),
    "chequeos": {"globales": chequeos_globales, "muestra": chequeos_muestra, "osm": resumen_osm,
                 "hex_sin_edificios": len(hex_sin_edificios), "hex_con_edificios": len(hex_base),
                 "edificios_en_riesgo_h3": {k: int(v) for k, v in edif_riesgo.items()}},
    "distritos": {"type": "FeatureCollection", "features": features_dist},
    "hex": hex_out, "hex_esc": por_esc,
    "escenarios": columnas(escenarios, {"pga_roca_escenario_g": 3}),
    "edificios": edif_out, "cats_edif": cats_edif,
    "osm": osm_out, "cats_osm": cats_osm,
    "suelo": suelo_out, "cats_suelo": cats_suelo, "suelo_paso": paso,
    "estaciones": est_out,
}
CACHE.write_text(json.dumps(datos, ensure_ascii=False, separators=(",", ":"), allow_nan=False), encoding="utf-8")
print(f"Extracción en {time.perf_counter() - t0:.0f} s")
armar_html()
