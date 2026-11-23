# Predicción de exposición y vulnerabilidad sísmica de edificaciones con Big Data (Grupo 06)

¿Cómo integrar registros sísmicos, características del suelo e información geoespacial de edificaciones para estimar la demanda sísmica y el daño potencial en sectores urbanos de Lima?

**Área de estudio:** 48 distritos de Lima y el Callao, con 3 124 035 edificios de Google Open Buildings.

El proyecto es un *lakehouse* en Databricks (Unity Catalog, Delta Lake y Volumes) con arquitectura medallón. El job `sismos_pipeline` (12 tareas) integra 16 fuentes abiertas y deja 95 tablas Delta en el catálogo `grupo06proyectofinal`: 88 en el esquema `sismos` (29 Bronze, 24 Silver, 8 Gold, 6 de variables, 3 de control de modelos y 18 de riesgo) y 7 en `tiempo_real`. Entrena cuatro modelos en Spark ML, simula un sismo en tiempo real con Structured Streaming y publica una intranet como Databricks App.

## Contenido del repositorio

| Archivo | Qué es |
|---|---|
| `descarga.ipynb` | Descarga de las fuentes a `raw/` (no se sube) |
| `Subir_Datos_Databricks.ipynb` | Sube los datos a los Volumes de Databricks |
| `Simulacion_Llegada_Datos.ipynb` | Simula la llegada de cada sismo al Volume `landing` |
| `Crear_Workflow_Local.ipynb` | Sube los notebooks de `src/` y crea y ejecuta el job |
| `Desplegar_App_Local.ipynb` | Despliega la intranet (Databricks Apps) |
| `src/01` a `src/12` | Tareas del job |
| `validacion_mapa/` | Intranet: app Flask (`app/`), plantilla, scripts del navegador y `generar_mapa.py` |
| `Exposicion_BigData_Grupo06.pptx` y `.pdf` | Exposición del proyecto |

## Tareas del job

| Tarea | Contenido | Tablas principales |
|---|---|---|
| 01 Bronze | Ingesta sin transformar desde el Volume `landing`, con linaje; `replaceWhere` por sismo | 29 tablas `bronze_*` |
| 02 Silver | Limpieza, cuarentena y `MERGE`; espectros $S_a(T)$, suelo, edificios con pisos y $T_b$, ventanas de STEAD y Turquía | 24 tablas `silver_*` |
| 03 Gold | Integración para los modelos | 8 tablas `gold_*` |
| 04 Variables | Objetivos, columnas con fuga, correlación y selección de variables | `fe_clasificacion`, `fe_regresion` |
| 05 Onda P | Clasificador de ventanas de 4 s de STEAD (champion GBT, AUC 0.966) | `ml_registro_modelos` |
| 06 Amplificación | Regresor de $\ln F(T, V_{s30})$ con las ondas de Lima (champion GBT, $R^2$ 0.379) | `ml_registro_modelos` |
| 07 Demanda y daño | *Kriging* en roca, demanda por edificio en 9 escenarios, curvas de fragilidad GEM y validación en Turquía 2023 | `riesgo_demanda`, `riesgo_dano_edificios`, `fe_dano`, `fe_clustering` |
| 08 Daño | Daño severo entrenado en Tainan y Manta (champion Random Forest, AUC 0.672 entre ciudades) | `ml_registro_modelos`, `ml_metricas` |
| 09 Perfiles | KMeans sobre 3.1 M edificios ($k = 7$, silueta 0.430) | `riesgo_perfiles` |
| 10 Riesgo | Ranking de distritos y hexágonos H3 | `riesgo_ranking_distritos`, `riesgo_h3` |
| 11 Tiempo real | Structured Streaming con sismos M6.1, 7.5 y 8.0; solo inferencia | esquema `tiempo_real` |
| 12 Intranet | Datos del mapa y de la simulación en el Volume `web` | — |

Los cuatro modelos siguen un ciclo *champion*/*challenger*: monitoreo con PSI y su métrica, reentrenamiento con semilla fija y registro en MLflow. El job tiene los parámetros `fecha_desde`, `fecha_hasta`, `forzar_recalibrado` y `recargar_maestros`.

## Cómo ejecutar

1. Correr `descarga.ipynb` para crear `raw/`.
2. Subir los datos con `Subir_Datos_Databricks.ipynb` y simular la llegada de los sismos con `Simulacion_Llegada_Datos.ipynb`.
3. Crear y ejecutar el job con `Crear_Workflow_Local.ipynb`.
4. Desplegar la intranet con `Desplegar_App_Local.ipynb`. La key de Google Maps va en `validacion_mapa/google_maps_key.txt`, que no se sube.

Se necesita el perfil de Databricks en `~/.databrickscfg`. El sismo de Ica 2026 queda en el Volume `fuente` para simular un lote nuevo.

## Fuentes y licencias

| Fuente | Uso | Licencia / cita |
|---|---|---|
| CISMID-UNI (REDACIS) | Acelerogramas de Lima y el Callao | Datos públicos del CISMID |
| Tainan 2016 y Ecuador 2016 (PURR) | Daño observado para el modelo de daño | Pujol et al. (2017), doi:10.4231/R7M32SZ3; Sim et al. (2017), doi:10.4231/R7ZC8111 |
| STEAD | Trazas para el detector de onda P | Mousavi et al. (2019) |
| USGS Vs30 global, ShakeMap us6000jllz (`grid.xml` y `uncertainty.xml`, versión 19) | Suelo, movimiento en Turquía y su incertidumbre | Dominio público (USGS) |
| CISMID/MVCS microzonificación (SIGRID) y Mapa de Microzonificación Sísmica de Lima y Callao (CISMID-UNI) | Zonas y periodos del suelo; zonas digitalizadas | Documentos públicos |
| Norma E.030 (2018) | Perfiles de suelo, Z, S, TP, TL | Norma técnica peruana |
| BSSA14 | Término no lineal del suelo | Boore et al. (2014), *Earthquake Spectra* |
| Google Open Buildings v3 y 2.5D Temporal | Huellas y alturas de edificios | CC BY 4.0 |
| INEI (límites distritales) y OpenStreetMap | Distritos y validación de pisos (`building:levels`) | Datos públicos / ODbL © OpenStreetMap contributors |
| INEI, Censos Nacionales 2017 (REDATAM, base CPV2017DI) | Material de las paredes por distrito | Datos públicos del INEI |
| GEM global fragility model | Curvas de fragilidad | Martins L, Silva V (2021), *Bull Earthquake Eng*, doi:10.1007/s10518-020-00885-1 — CC BY-SA 4.0 |
| Daño observado Turquía 2023 | Validación externa | Liu H. (2026), Zenodo, doi:10.5281/zenodo.18437501 — CC BY 4.0 |

## Limitaciones conocidas

- Los sismos registrados en Lima son moderados (PGA ≤ 0.30 g); por eso se escalan y se usa el espectro de la E.030.
- Lima no tiene daño observado; el modelo de daño se entrena con 184 edificios de Tainan y Manta.
- El Vs30 del USGS tiene cerca de 1 km de resolución, y la tipología sale del censo distrital y de los pisos, sin catastro.
- La altura 2.5D tiene 4 m de resolución efectiva: el 7.8 % de los edificios no tiene altura y los pisos de las torres se subestiman.
- `gold_edificios` repite 4 969 identificadores (0.48 % de las filas); `riesgo_perfiles` y `sismo_dano_edificios` los cuentan más de una vez.
- En Turquía, el ShakeMap (~1 km) no resuelve la variación dentro de cada ciudad: las curvas aciertan el nivel de daño de Antakya, pero no qué edificios se dañan.
