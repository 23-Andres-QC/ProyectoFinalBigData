# Predicción del daño sísmico por edificio en Lima — Big Data (Grupo 06)

¿Qué edificios de Lima sufrirían más daño en un sismo, según cómo el suelo amplifica la onda y si el edificio entra en resonancia con ella?

El proyecto construye un **lakehouse en Databricks** (Unity Catalog + Delta Lake) con arquitectura medallón y, sobre él, los modelos de amplificación del suelo, demanda sísmica, daño por edificio, validación y detección de la onda P en tiempo real.

```
PC: raw/ (~57 GB, no se sube) ──Databricks Connect──► bronze ──► silver ──► gold ──► modelos / validación / tiempo real
                                                        └─ volumen01 (manifiesto de la tanda 01)
```

## Contenido del repositorio

| Archivo | Qué es |
|---|---|
| `BigData_Grupo06_ProyectoFinal.ipynb` | **Notebook principal**: todo el pipeline en Databricks (partes 0 a 8) |
| `descarga.ipynb` | Descarga de las fuentes a `raw/` con sus tiempos |
| `Grupo06/lakehouse_bronze_silver.ipynb` | Versión anterior (lakehouse local con PySpark + Delta) |
| `Grupo06/Informe_Grupo06.pdf`, `Grupo06/PPT Grupo 06.pdf` | Informe y presentación |

## Partes del notebook

| Parte | Contenido | Tablas principales |
|---|---|---|
| 0 | Conexión (Databricks Connect serverless), catálogo `Grupo06ProyectoFinal`, esquemas `bronze`/`silver`/`gold`, volumen `bronze.volumen01` | — |
| 1 | **Bronze**: 11 fuentes tal como llegaron + linaje (`_fuente`, `_archivo`, `_tanda`, `_fecha_ingesta`) | 16 tablas (`cismid_registros`, `open_buildings`, …) |
| 2 | **Silver ondas**: espectros de respuesta Sa(T) 5 % de 137 acelerogramas CISMID | `ondas_registros`, `espectros`, `eventos` |
| 3 | **Silver territorio**: 49 distritos, suelo E.030 (Vs30 sin el relleno de mar e interpolado por edificio), microzonificación, 1.92 M edificios con pisos (altura por huella, validada con OpenStreetMap) y periodo Tb | `distritos`, `suelo`, `edificios`, `validacion_pisos_osm` |
| 4 | **Silver validación**: xBD, Maxar, ShakeMap Turquía, STEAD | `xbd_escenas`, `maxar_pares`, `shakemap_turquia`, `stead_trazas` |
| 5 | **Gold**: amplificación (Random Forest con términos de evento), kriging validado + escenarios (registrados, de diseño, E.030 y E.030 en roca × amplificación medida), demanda por edificio, daño (curvas GEM), K-means por edificio, rankings | `amplificacion_lima`, `amplificacion_validacion`, `kriging_validacion`, `demanda`, `dano_edificios`, `ranking_distritos`, `riesgo_h3` |
| 6 | **Modelos**: detector de onda P (Gradient Boosting) y picador STA/LTA con STEAD | `stead_ventanas`, `stead_picks` |
| 7 | **Validación** con daño observado en Turquía 2023 (Antakya, Nurdağı y Jindires), con altura real por edificio | `validacion_turquia` |
| 8 | **Tiempo real**: Spark Structured Streaming + STA/LTA y alerta | `stream_acelerograma`, `stream_energia` |
| — | Métricas de todos los modelos, calidad de datos, OPTIMIZE y comentarios en Unity Catalog | `metricas_modelos`, `calidad_log` |

## Cómo ejecutar

1. **Datos:** correr `descarga.ipynb` para crear `raw/`. Además, el notebook usa:
   - `raw/limites_inei/complemento_osm_la_punta_santa_anita.geojson` (límites de OpenStreetMap de dos distritos que el INEI trae sin geometría),
   - `raw/fragilidad_gem/` (curvas de fragilidad de GEM, incluidas `MUR-CL99_LWAL-DNO_H1..H5.csv`, `W-WWD_LWAL-DNO_H1..H2.csv` y `W_LFM-DUL_H1..H3.csv` de `fragility_curves/fragility_other_IMs/` del repositorio de GEM),
   - `raw/limites_osm/distritos_lima_callao_osm.geojson` (distritos `admin_level = 8` de OpenStreetMap con `pe:ubigeo`; consulta Overpass guardada en `overpass_distritos_lima_callao.json`),
   - `raw/microzonificacion_cismid/` (mapa PDF de CISMID y su digitalización `zonas_cismid_utm18s_25m.tif`; ver `LEEME.txt`),
   - `raw/censo2017/paredes_distrito_lima_callao.csv` (viviendas particulares por distrito y material de las paredes; consulta *Frecuencias* de `Vivienda.C2P3` por distrito en el REDATAM del Censo 2017, Provincia de Lima y Callao),
   - `raw/osm_niveles/lima_building_levels.json` (edificios de Lima con `building:levels` de OpenStreetMap; consulta Overpass `way["building"]["building:levels"](-12.52,-77.20,-11.57,-76.62); out tags center;`),
   - `raw/turquia_dano/2023Turkey_earthquake_data.zip` (Zenodo 18437501). La Parte 7 extrae de él las capas de daño y las huellas GBA con altura (~1.9 GB).
2. **Entorno:** kernel *Databricks Connect* (Python 3.12) con `databricks-connect`, `databricks-sdk`, `pandas`, `pyarrow`, `geopandas`, `shapely`, `rasterio`, `pypdf`, `pyproj`, `scipy`, `scikit-learn`, `h5py`, `pillow`, `matplotlib` (opcional: `mlflow`), y el perfil de Databricks en `~/.databrickscfg`.
3. **Ejecución:** *Kernel → Restart & Run All*. Las tablas se sobrescriben, así que se puede volver a correr. La celda final de limpieza **no** borra nada salvo que se escriba `BORRAR CATALOGO` a propósito.

**Diseño:** los archivos crudos se leen en la PC y solo se suben tablas. Las transformaciones corren en Spark (Databricks). Lo que necesita los archivos crudos o NumPy/SciPy por registro (espectros, alturas desde GeoTIFF, máscaras xBD, HDF5 de STEAD) se calcula en la PC y se sube el resultado. No se usan UDF de Python en serverless. El point-in-polygon usa las funciones `ST_*` de Databricks (o Shapely si no están) y las celdas hexagonales, las funciones H3 nativas.

## Métodos

- **Distritos:** geometría detallada de OpenStreetMap (con el ubigeo del INEI) en lugar del GeoJSON simplificado del INEI, que deformaba los distritos (Breña 0.41 km² en vez de 3.22, Los Olivos 10.1 en vez de 18.3).
- **Microzonificación:** el mapa de CISMID (PDF vectorial) se digitalizó leyendo sus polígonos y georreferenciándolo con sus límites distritales contra los de OSM; cada edificio recibe su zona (I a V) y su perfil E.030 (I → S1, II → S2, III a V → S3).
- **Suelo y edificios:** el ráster de Vs30 de USGS rellena el mar con 600 m/s; esos píxeles toman el valor de tierra más cercano y el Vs30 se interpola (bilineal) en cada estación y edificio (las estaciones CAL001 y DHNPE del Callao pasaban de ~250 m/s a 600 m/s y se usaban como suelo firme de referencia). La altura de cada edificio es la mediana de los píxeles 2.5D dentro de su huella; frente a 22 800 edificios de OpenStreetMap con número de pisos acierta el ~51 % (centroide: ~49 %) con error medio de 0.73 pisos y sin sesgo.
- **Espectros:** línea base, Butterworth 0.1–25 Hz, Sa(T) exacto (Nigam-Jennings) en 50 periodos, validado contra Newmark (< 0.5 %).
- **Amplificación del suelo:** modelo de términos de evento `ln(Sa·R) = η(evento, T) + f(T, Vs30)` con un Random Forest **monótono en Vs30**, anclado en suelo firme (Vs30 ≥ 500 m/s), más el **término de sitio** de cada estación interpolado a las celdas H3 (*regression kriging*). Validado dejando estaciones fuera (sitios nuevos, como los edificios): error en ln ≈ 0.50, frente a ≈ 0.68–0.71 del método anterior (que memorizaba estaciones) y 0.58 sin modelo de suelo.
- **Demanda:** roca en las estaciones → kriging ordinario a celdas H3 r8 → amplificación por el Vs30 de cada edificio × término de sitio de su celda. Dejando una estación fuera: roca krigeada ≈ 0.22 en ln (media de las otras: 0.26) y demanda de punta a punta ≈ 0.46 (krigear directo la Sa observada: 0.52). Con sacudidas fuertes el suelo se vuelve no lineal y amplifica menos: la amplificación medida con sismos débiles se corrige con el término no lineal de BSSA14 (Seyhan y Stewart 2014; coeficientes en `raw/bssa14/`), relativo al PGA en roca de los registros. Escenarios: los sismos registrados con al menos 10 estaciones, los que pueden escalarse a Z = 0.45 g sin multiplicarlos más de 10 veces, el espectro de diseño de la E.030 y el **escenario principal `e030_sitio`**: espectro E.030 en roca (S1) × amplificación medida de cada edificio. Las celdas a más de 10 km de una estación se marcan como extrapoladas, y el ranking de distritos solo incluye los que tienen al menos 1000 edificios y cobertura suficiente.
- **Tipología:** edificios de 5 pisos o más, concreto armado; de 1–2 pisos, adobe, quincha, madera o albañilería según el **material de las paredes del Censo 2017 de su distrito** (REDATAM del INEI, sorteo reproducible por edificio); de 3–4 pisos, albañilería.
- **Daño:** curvas lognormales del modelo global de GEM por tipología (adobe, quincha, madera, albañilería confinada, concreto armado) y altura, en su propia medida de intensidad (PGA o Sa a 0.3/0.6/1.0 s). La incertidumbre de la demanda medida en las validaciones (σ ≈ 0.46 en ln) se suma a la de la curva, `Φ(ln(IM/θ)/√(β²+σ²))`, y hay banda de incertidumbre de la amplificación. Periodo de cada edificio con la fórmula de la E.030, `Tb = h/C_T` (C_T = 60 albañilería/adobe, 45 concreto), con su altura medida.
- **Perfiles de riesgo:** K-means por edificio (escenario `e030_sitio`) sobre (ln Sa(Tb), ln IM/θ_colapso, Tb/TP, Vs30, ln pisos), k elegido por silueta.
- **Validación:** daño predicho (ShakeMap del USGS interpolado, con su incertidumbre oficial `uncertainty.xml`, + curvas GEM según la altura GBA de cada edificio: albañilería no reforzada en 1–2 pisos, concreto con tabiquería en 3 o más) frente al daño observado por interpretación visual en Antakya, Nurdağı y Jindires.
- **Detector de onda P:** Gradient Boosting entrenado con negativas difíciles (ruido previo, ventanas dentro del sismo y llegada de la onda S); con solo ruido previo disparaba en ~84 % de las llegadas S.
- **Tiempo real:** el acelerograma se reproduce por lotes en una tabla Delta que hace de tópico (en Databricks serverless no hay Kafka) y Structured Streaming calcula la energía por ventanas; el STA/LTA dispara la alerta.

## Fuentes y licencias

| Fuente | Uso | Licencia / cita |
|---|---|---|
| CISMID-UNI (REDACIS) | Acelerogramas de Lima | Datos públicos del CISMID |
| USGS Vs30 global, ShakeMap us6000jllz (`grid.xml` y `uncertainty.xml`, versión 19) | Suelo, movimiento en Turquía y su incertidumbre | Dominio público (USGS) |
| Google Open Buildings v3 y 2.5D Temporal | Huellas y alturas de edificios | CC BY 4.0 |
| INEI (límites distritales) y OpenStreetMap | Distritos y validación de pisos (`building:levels`) | Datos públicos / ODbL © OpenStreetMap contributors |
| CISMID/MVCS microzonificación (SIGRID) y Mapa de Microzonificación Sísmica de Lima y Callao (CISMID-UNI) | Zonas y periodos del suelo; zonas digitalizadas | Documentos públicos |
| Norma E.030 (2018) | Perfiles de suelo, Z, S, TP, TL | Norma técnica peruana |
| GEM global fragility model | Curvas de fragilidad | Martins L, Silva V (2021), *Bull Earthquake Eng*, doi:10.1007/s10518-020-00885-1 — CC BY-SA 4.0 |
| xBD (xView2) | Escenas de daño | Gupta et al. (2019) — CC BY-NC-SA 4.0 |
| Maxar Open Data | Imágenes antes/después de Turquía | CC BY-NC 4.0 |
| STEAD | Trazas para el detector de onda P | Mousavi et al. (2019) |
| INEI, Censos Nacionales 2017 (REDATAM, base CPV2017DI) | Material de las paredes por distrito (`raw/censo2017/`) | Datos públicos del INEI |
| Daño observado Turquía 2023 | Validación | Liu H. (2026), Zenodo, doi:10.5281/zenodo.18437501 — CC BY 4.0 |

## Limitaciones conocidas

- El Vs30 de USGS no detecta suelos blandos S3 en Lima. Falta digitalizar los mapas de microzonificación.
- La tipología sale del censo por distrito (proporción de viviendas, no de edificios) y del número de pisos: no hay catastro abierto por edificio.
- La microzonificación de CISMID se digitalizó del mapa PDF oficial (georreferenciación con error mediano < 100 m); la categoría marrón de la leyenda no se pudo identificar. Sin estaciones en Zona IV, la zona se usa para el perfil E.030 y no para calibrar la amplificación.
- Solo 5 sismos registrados, todos moderados (PGA ≤ 0.30 g).
- La validación en Turquía usa daño de imágenes satelitales y una tipología supuesta por altura. El ShakeMap (~900 m) no resuelve la variación dentro de una ciudad: acierta la tasa de daño de Antakya, pero no qué edificios se dañan (AUC < 0.5). Jindires (Siria) queda fuera del dominio.
- Pendiente: dashboard (Streamlit + Kepler.gl) y U-Net siamesa para los pares Maxar (requiere GPU).
