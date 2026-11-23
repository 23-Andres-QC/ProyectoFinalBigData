# Arma la intranet local mapa_validacion.html (con datos_mapa/ por distrito) con los datos del Volume web; --solo-html no vuelve a descargarlos.
# El fondo de Google solo se usa aquí, con la key de google_maps_key.txt o de GOOGLE_MAPS_KEY.
import json
import os
import sys
from pathlib import Path

PROFILE = "22200144"
CARPETA_VOLUME = "/Volumes/grupo06proyectofinal/sismos/web/mapa_validacion"
ARCHIVO_SIMULADOR = "/Volumes/grupo06proyectofinal/sismos/web/simulador/simulador.json"
CARPETA = Path(__file__).resolve().parent
SALIDA = CARPETA / "mapa_validacion.html"
SALIDA_DISTRITOS = CARPETA / "datos_mapa"
CACHE = CARPETA / "datos_cache"
CACHE_SIM = CARPETA / "simulador_cache.json"
ARCHIVO_KEY = CARPETA / "google_maps_key.txt"


# Descarga un archivo del Volume si no está ya en la caché con el mismo tamaño.
def bajar(w, remoto, local):
    meta = w.files.get_metadata(remoto)
    if local.exists() and local.stat().st_size == meta.content_length:
        return False
    local.parent.mkdir(parents=True, exist_ok=True)
    local.write_bytes(w.files.download(remoto).contents.read())
    return True


# Descarga la base, los distritos y el simulador del Volume web a la caché local.
def descargar():
    from databricks.sdk import WorkspaceClient
    from databricks.sdk.errors import NotFound

    w = WorkspaceClient(profile=PROFILE)
    try:
        bajar(w, f"{CARPETA_VOLUME}/base.json", CACHE / "base.json")
    except NotFound:
        print(f"Todavía no existe {CARPETA_VOLUME}/base.json (lo escribe el notebook 12)")
        return
    archivos = json.loads((CACHE / "base.json").read_text(encoding="utf-8"))["archivos"]
    nuevos = sum(bajar(w, f"{CARPETA_VOLUME}/distritos/{u}.json", CACHE / "distritos" / f"{u}.json") for u in archivos)
    print(f"Base y {len(archivos)} distritos en {CACHE} ({nuevos} descargados ahora)")
    try:
        bajar(w, ARCHIVO_SIMULADOR, CACHE_SIM)
    except NotFound:
        print(f"Todavía no existe {ARCHIVO_SIMULADOR} (lo escribe el notebook 11)")


# Inserta la base, el simulador y la key en plantilla.html; cada distrito queda en datos_mapa/{ubigeo}.js para cargarlo con file://.
def armar_html():
    plantilla = (CARPETA / "plantilla.html").read_text(encoding="utf-8")
    key = os.environ.get("GOOGLE_MAPS_KEY") or (ARCHIVO_KEY.read_text().strip() if ARCHIVO_KEY.exists() else "")
    base = (CACHE / "base.json").read_text(encoding="utf-8")
    simulador = CACHE_SIM.read_text(encoding="utf-8") if CACHE_SIM.exists() else "null"
    html = (plantilla.replace("/*__DATOS__*/null", base.replace("</", "<\\/")).replace("/*__LOCAL__*/false", "true")
            .replace('/*__GOOGLE_KEY__*/""', json.dumps(key)).replace("/*__SIMULADOR__*/null", simulador.replace("</", "<\\/")))
    SALIDA.write_text(html, encoding="utf-8")
    SALIDA_DISTRITOS.mkdir(exist_ok=True)
    for archivo in sorted((CACHE / "distritos").glob("*.json")):
        texto = archivo.read_text(encoding="utf-8")
        (SALIDA_DISTRITOS / f"{archivo.stem}.js").write_text(
            f"(window.DISTRITO_RECIBIDO = window.DISTRITO_RECIBIDO || {{}})[{json.dumps(archivo.stem)}] = {texto};\n", encoding="utf-8")
    print(f"Listo: {SALIDA} ({SALIDA.stat().st_size / 1e6:.1f} MB) y {SALIDA_DISTRITOS} | simulador: {'sí' if CACHE_SIM.exists() else 'no (sin datos del 11)'}"
          f" | fondo Google: {'sí' if key else 'no (sin key)'}")


if __name__ == "__main__":
    if "--solo-html" not in sys.argv:
        descargar()
    if (CACHE / "base.json").exists():
        armar_html()
    else:
        print("Sin la base del mapa: corra el notebook 12 y luego este guion sin --solo-html")
