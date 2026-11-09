"""Arma mapa_validacion.html en la computadora, con los mismos datos que muestra la app web mapa-validacion.

Los datos los prepara en Databricks el notebook src/12_mapa_validacion (tarea mapa_validacion del job) y quedan en el
Volume web. Este script los descarga a datos_cache.json y los inserta en plantilla.html.

Uso:  python validacion_mapa/generar_mapa.py   [--solo-html]   (--solo-html: rehace el HTML desde la caché, sin descargar)
Fondo de Google (solo en el HTML local, nunca en la app): poner la key (Map Tiles API) en validacion_mapa/google_maps_key.txt
o en la variable GOOGLE_MAPS_KEY.
"""
import json
import os
import sys
from pathlib import Path

PROFILE = "22200144"
ARCHIVO_VOLUME = "/Volumes/grupo06proyectofinal/sismos/web/mapa_validacion/datos.json"
CARPETA = Path(__file__).resolve().parent
SALIDA = CARPETA / "mapa_validacion.html"
CACHE = CARPETA / "datos_cache.json"                      # datos descargados del Volume (para rehacer solo el HTML)
ARCHIVO_KEY = CARPETA / "google_maps_key.txt"             # key de Google Map Tiles API (no se sube a git ni a Databricks)


def descargar():
    from databricks.sdk import WorkspaceClient

    w = WorkspaceClient(profile=PROFILE)
    meta = w.files.get_metadata(ARCHIVO_VOLUME)
    CACHE.write_bytes(w.files.download(ARCHIVO_VOLUME).contents.read())
    print(f"Descargado {ARCHIVO_VOLUME} ({CACHE.stat().st_size / 1e6:.1f} MB, modificado {meta.last_modified})")


def armar_html():
    plantilla = (CARPETA / "plantilla.html").read_text(encoding="utf-8")
    key = os.environ.get("GOOGLE_MAPS_KEY") or (ARCHIVO_KEY.read_text().strip() if ARCHIVO_KEY.exists() else "")
    texto = CACHE.read_text(encoding="utf-8").replace("</", "<\\/")
    html = plantilla.replace("/*__DATOS__*/null", texto).replace('/*__GOOGLE_KEY__*/""', json.dumps(key))
    SALIDA.write_text(html, encoding="utf-8")
    print(f"Listo: {SALIDA} ({SALIDA.stat().st_size / 1e6:.1f} MB) | fondo Google: {'sí' if key else 'no (sin key)'}")


if __name__ == "__main__":
    if "--solo-html" not in sys.argv:
        descargar()
    armar_html()
