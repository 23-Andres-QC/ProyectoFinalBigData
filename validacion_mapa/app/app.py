"""App web del mapa de validación (Databricks Apps).

Lee el JSON que deja el notebook 12_mapa_validacion en el Volume web, lo inserta en plantilla.html y sirve la página.
Cada REVISAR_CADA_S segundos revisa si el job escribió datos nuevos; si cambiaron, rehace la página.
La app entra a Databricks con su service principal (credenciales que pone Databricks Apps en el entorno).
"""
import gzip
import hashlib
import html
import os
import threading
import time
from pathlib import Path

from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import NotFound
from flask import Flask, Response, jsonify, request

ARCHIVO_DATOS = os.environ.get("ARCHIVO_DATOS", "/Volumes/grupo06proyectofinal/sismos/web/mapa_validacion/datos.json")
REVISAR_CADA_S = int(os.environ.get("REVISAR_CADA_S", "300"))
PLANTILLA = (Path(__file__).parent / "plantilla.html").read_text(encoding="utf-8")
SIN_DATOS = """<!doctype html><html lang="es"><meta charset="utf-8"><title>Mapa de validación</title>
<body style="font:15px/1.5 system-ui,sans-serif;padding:24px;max-width:720px">
<h1 style="font-size:18px">Mapa de validación · sin datos todavía</h1>
<p>{mensaje}</p>
<p>Los datos los prepara la tarea <code>mapa_validacion</code> del job <b>sismos_pipeline</b>
(notebook <code>12_mapa_validacion</code>) en <code>{ruta}</code>.</p></body></html>"""

w = WorkspaceClient()
app = Flask(__name__)
estado = {"modificado": None, "html": None, "gzip": None, "etag": None, "revisado": 0.0, "error": None, "cargado": None}
candado = threading.Lock()


def actualizar():
    """Recarga los datos del Volume si cambiaron (como mucho una revisión cada REVISAR_CADA_S segundos)."""
    with candado:
        if estado["html"] is not None and time.time() - estado["revisado"] < REVISAR_CADA_S:
            return
        estado["revisado"] = time.time()
        try:
            modificado = w.files.get_metadata(ARCHIVO_DATOS).last_modified
            if estado["html"] is not None and modificado == estado["modificado"]:
                return
            datos = w.files.download(ARCHIVO_DATOS).contents.read().decode("utf-8")
        except NotFound:
            estado.update(html=None, gzip=None, error="Todavía no existe el archivo de datos.")
            return
        except Exception as e:  # se mantiene la página anterior, si la hay
            estado["error"] = f"{type(e).__name__}: {e}"
            return
        pagina = PLANTILLA.replace("/*__DATOS__*/null", datos.replace("</", "<\\/")).encode("utf-8")
        estado.update(modificado=modificado, html=pagina, gzip=gzip.compress(pagina, 6), error=None,
                      etag='"' + hashlib.sha1(f"{modificado}|{len(pagina)}".encode()).hexdigest()[:20] + '"',
                      cargado=time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()))


@app.get("/")
def mapa():
    actualizar()
    if estado["html"] is None:
        mensaje = html.escape(estado["error"] or "Sin datos.")
        return Response(SIN_DATOS.format(mensaje=mensaje, ruta=html.escape(ARCHIVO_DATOS)), status=503, mimetype="text/html")
    if request.headers.get("If-None-Match") == estado["etag"]:
        return Response(status=304, headers={"ETag": estado["etag"]})
    comprimir = "gzip" in request.headers.get("Accept-Encoding", "")
    respuesta = Response(estado["gzip"] if comprimir else estado["html"], mimetype="text/html")
    if comprimir:
        respuesta.headers["Content-Encoding"] = "gzip"
    respuesta.headers.update({"ETag": estado["etag"], "Cache-Control": "no-cache", "Vary": "Accept-Encoding"})
    return respuesta


@app.get("/salud")
def salud():
    actualizar()
    return jsonify(datos=ARCHIVO_DATOS, modificado=estado["modificado"], cargado=estado["cargado"],
                   mb=round(len(estado["html"]) / 1e6, 1) if estado["html"] else None, error=estado["error"])


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("DATABRICKS_APP_PORT", "8000")), threaded=True)
