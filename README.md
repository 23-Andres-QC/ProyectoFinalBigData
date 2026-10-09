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
| 3 | **Silver territorio**: 49 distritos, suelo E.030, microzonificación, 1.92 M edificios con pisos y periodo Tb | `distritos`, `suelo`, `edificios` |
| 4 | **Silver validación**: xBD, Maxar, ShakeMap Turquía, STEAD | `xbd_escenas`, `maxar_pares`, `shakemap_turquia`, `stead_trazas` |
| 5 | **Gold**: amplificación (Random Forest), kriging validado + escenarios (registrados, de diseño y E.030), demanda por edificio, daño (curvas GEM), K-means, rankings | `amplificacion_lima`, `kriging_validacion`, `demanda`, `dano_edificios`, `ranking_distritos`, `riesgo_h3` |
| 6 | **Modelos**: detector de onda P (Gradient Boosting) y picador STA/LTA con STEAD | `stead_ventanas`, `stead_picks` |
| 7 | **Validación** con daño observado en Turquía 2023 (Antakya, Nurdağı) | `validacion_turquia` |
| 8 | **Tiempo real**: Spark Structured Streaming + STA/LTA y alerta | `stream_acelerograma`, `stream_energia` |
| — | Métricas de todos los modelos, calidad de datos, OPTIMIZE y comentarios en Unity Catalog | `metricas_modelos`, `calidad_log` |

## Cómo ejecutar

1. **Datos:** correr `descarga.ipynb` para crear `raw/`. Además, el notebook usa:
   - `raw/limites_inei/complemento_osm_la_punta_santa_anita.geojson` (límites de OpenStreetMap de dos distritos que el INEI trae sin geometría),
   - `raw/fragilidad_gem/` (curvas de fragilidad de GEM),
   - `raw/turquia_dano/2023Turkey_earthquake_data.zip` (Zenodo 18437501).
2. **Entorno:** kernel *Databricks Connect* (Python 3.12) con `databricks-connect`, `databricks-sdk`, `pandas`, `pyarrow`, `geopandas`, `shapely`, `rasterio`, `pypdf`, `pyproj`, `scipy`, `scikit-learn`, `h5py`, `pillow`, `matplotlib` (opcional: `mlflow`), y el perfil de Databricks en `~/.databrickscfg`.
3. **Ejecución:** *Kernel → Restart & Run All*. Las tablas se sobrescriben, así que se puede volver a correr. La celda final de limpieza **no** borra nada salvo que se escriba `BORRAR CATALOGO` a propósito.

**Diseño:** los archivos crudos se leen en la PC y solo se suben tablas. Las transformaciones corren en Spark (Databricks). Lo que necesita los archivos crudos o NumPy/SciPy por registro (espectros, alturas desde GeoTIFF, máscaras xBD, HDF5 de STEAD) se calcula en la PC y se sube el resultado. No se usan UDF de Python en serverless. El point-in-polygon usa las funciones `ST_*` de Databricks (o Shapely si no están) y las celdas hexagonales, las funciones H3 nativas.

## Métodos

- **Espectros:** línea base, Butterworth 0.1–25 Hz, Sa(T) exacto (Nigam-Jennings) en 50 periodos, validado contra Newmark (< 0.5 %).
- **Amplificación del suelo:** cociente espectral contra estaciones de suelo firme (Vs30 ≥ 500 m/s) con corrección 1/R; Random Forest `ln F(T, Vs30)` validado dejando un sismo fuera.
- **Demanda:** roca en las estaciones → kriging ordinario a celdas H3 r8 (validado dejando una estación fuera) → amplificación por el Vs30 de cada edificio. Escenarios: 5 sismos registrados, los que pueden escalarse a Z = 0.45 g sin multiplicarlos más de 10 veces y el espectro de diseño de la E.030. Las celdas a más de 10 km de una estación se marcan como extrapoladas, y el ranking de distritos solo incluye los que tienen al menos 1000 edificios y cobertura suficiente.
- **Daño:** curvas lognormales del modelo global de GEM por tipología (adobe, albañilería confinada, concreto armado) y altura, en su propia medida de intensidad (PGA o Sa a 0.3/0.6/1.0 s), con banda de incertidumbre de la amplificación.
- **Perfiles de riesgo:** K-means sobre (ln Sa(Tb), Tb/TP, Vs30, pisos), k elegido por silueta.
- **Validación:** daño predicho con el ShakeMap del USGS frente al daño observado en Antakya y Nurdağı.
- **Tiempo real:** el acelerograma se reproduce por lotes en una tabla Delta que hace de tópico (en Databricks serverless no hay Kafka) y Structured Streaming calcula la energía por ventanas; el STA/LTA dispara la alerta.

## Fuentes y licencias

| Fuente | Uso | Licencia / cita |
|---|---|---|
| CISMID-UNI (REDACIS) | Acelerogramas de Lima | Datos públicos del CISMID |
| USGS Vs30 global, ShakeMap us6000jllz | Suelo y movimiento en Turquía | Dominio público (USGS) |
| Google Open Buildings v3 y 2.5D Temporal | Huellas y alturas de edificios | CC BY 4.0 |
| INEI (límites distritales) y OpenStreetMap | Distritos | Datos públicos / ODbL © OpenStreetMap contributors |
| CISMID/MVCS microzonificación (SIGRID) | Zonas y periodos del suelo | Documentos públicos |
| Norma E.030 (2018) | Perfiles de suelo, Z, S, TP, TL | Norma técnica peruana |
| GEM global fragility model | Curvas de fragilidad | Martins L, Silva V (2021), *Bull Earthquake Eng*, doi:10.1007/s10518-020-00885-1 — CC BY-SA 4.0 |
| xBD (xView2) | Escenas de daño | Gupta et al. (2019) — CC BY-NC-SA 4.0 |
| Maxar Open Data | Imágenes antes/después de Turquía | CC BY-NC 4.0 |
| STEAD | Trazas para el detector de onda P | Mousavi et al. (2019) |
| Daño observado Turquía 2023 | Validación | Liu H. (2026), Zenodo, doi:10.5281/zenodo.18437501 — CC BY 4.0 |

## Limitaciones conocidas

- El Vs30 de USGS no detecta suelos blandos S3 en Lima. Falta digitalizar los mapas de microzonificación.
- La tipología se supone por distrito y número de pisos (no hay catastro abierto).
- Solo 5 sismos registrados, todos moderados (PGA ≤ 0.30 g).
- La validación en Turquía usa daño de imágenes satelitales y una tipología supuesta sin altura por edificio.
- Pendiente: dashboard (Streamlit + Kepler.gl) y U-Net siamesa para los pares Maxar (requiere GPU).
