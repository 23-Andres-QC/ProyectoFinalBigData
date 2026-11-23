# Intranet web de sismos: inserta en plantilla.html la base del Volume web y sirve cada distrito, el simulador y sus guiones.
# Revisa cada cierto tiempo si el job escribió datos nuevos; entra a Databricks con su service principal.
import gzip
import hashlib
import html
import os
import re
import threading
import time
from pathlib import Path

from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import NotFound
from flask import Flask, Response, jsonify, redirect, request

ARCHIVO_BASE = os.environ.get("ARCHIVO_BASE", "/Volumes/grupo06proyectofinal/sismos/web/mapa_validacion/base.json")
CARPETA_DISTRITOS = os.environ.get("CARPETA_DISTRITOS", "/Volumes/grupo06proyectofinal/sismos/web/mapa_validacion/distritos")
ARCHIVO_SIMULADOR = os.environ.get("ARCHIVO_SIMULADOR", "/Volumes/grupo06proyectofinal/sismos/web/simulador/simulador.json")
REVISAR_CADA_S = int(os.environ.get("REVISAR_CADA_S", "300"))
PLANTILLA = (Path(__file__).parent / "plantilla.html").read_text(encoding="utf-8")
HUELLA_PLANTILLA = hashlib.sha1(PLANTILLA.encode("utf-8")).hexdigest()[:12]
GUIONES = ["simulador_motor.js", "intranet_base.js", "intranet_mapa.js", "intranet_sim.js", "intranet_resultados.js"]
GUIONES = {n: (Path(__file__).parent / n).read_bytes() for n in GUIONES}
GUIONES = {n: (c, gzip.compress(c, 6), '"' + hashlib.sha1(c).hexdigest()[:20] + '"') for n, c in GUIONES.items()}
SIN_DATOS = """<!doctype html><html lang="es"><meta charset="utf-8"><title>Sismos Lima · Intranet</title>
<body style="font:15px/1.5 system-ui,sans-serif;padding:24px;max-width:720px">
<h1 style="font-size:18px">Intranet de sismos · sin datos todavía</h1>
<p>{mensaje}</p>
<p>Los datos los prepara la tarea <code>mapa_validacion</code> del job <b>sismos_pipeline</b>
(notebook <code>12_mapa_validacion</code>) en <code>{ruta}</code>.</p></body></html>"""

w = WorkspaceClient()
app = Flask(__name__)
estado = {"modificado": None, "html": None, "gzip": None, "etag": None, "revisado": 0.0, "error": None, "cargado": None}
simulador = {"modificado": None, "json": None, "gzip": None, "etag": None, "revisado": 0.0, "error": None}
distritos = {}
candado = threading.Lock()
candado_sim = threading.Lock()
candado_dist = threading.Lock()


# Respuesta comprimida si el navegador lo admite.
def comprimida(cuerpo, cuerpo_gzip, tipo, encabezados):
    encabezados = {"Cache-Control": "no-cache", "Vary": "Accept-Encoding", **encabezados}
    if "gzip" in request.headers.get("Accept-Encoding", ""):
        return Response(cuerpo_gzip, mimetype=tipo, headers={**encabezados, "Content-Encoding": "gzip"})
    return Response(cuerpo if cuerpo is not None else gzip.decompress(cuerpo_gzip), mimetype=tipo, headers=encabezados)


def etiqueta(modificado, largo):
    return '"' + hashlib.sha1(f"{modificado}|{largo}".encode()).hexdigest()[:20] + '"'


# Recarga la base del Volume si cambió, con una revisión cada REVISAR_CADA_S segundos como máximo.
def actualizar():
    with candado:
        if estado["html"] is not None and time.time() - estado["revisado"] < REVISAR_CADA_S:
            return
        estado["revisado"] = time.time()
        try:
            modificado = w.files.get_metadata(ARCHIVO_BASE).last_modified
            if estado["html"] is not None and modificado == estado["modificado"]:
                return
            datos = w.files.download(ARCHIVO_BASE).contents.read().decode("utf-8")
        except NotFound:
            estado.update(html=None, gzip=None, error="Todavía no existe la base del mapa (base.json).")
            return
        except Exception as e:
            estado["error"] = f"{type(e).__name__}: {e}"
            return
        pagina = PLANTILLA.replace("/*__DATOS__*/null", datos.replace("</", "<\\/")).encode("utf-8")
        estado.update(modificado=modificado, html=pagina, gzip=gzip.compress(pagina, 6), error=None, etag=etiqueta(f"{modificado}|{HUELLA_PLANTILLA}", len(pagina)),
                      cargado=time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()))


# Sirve la página con la base (sin edificios), o un aviso si aún no hay datos.
@app.get("/")
def mapa():
    actualizar()
    if estado["html"] is None:
        mensaje = html.escape(estado["error"] or "Sin datos.")
        return Response(SIN_DATOS.format(mensaje=mensaje, ruta=html.escape(ARCHIVO_BASE)), status=503, mimetype="text/html")
    if request.headers.get("If-None-Match") == estado["etag"]:
        return Response(status=304, headers={"ETag": estado["etag"]})
    return comprimida(estado["html"], estado["gzip"], "text/html", {"ETag": estado["etag"]})


# Edificios, puntos OSM y suelo de un distrito; se guardan comprimidos en memoria y se revisan como la base.
@app.get("/distrito/<ubigeo>.json")
def distrito(ubigeo):
    if not re.fullmatch(r"\d{6}", ubigeo):
        return jsonify(error="ubigeo no válido"), 400
    ruta = f"{CARPETA_DISTRITOS}/{ubigeo}.json"
    with candado_dist:
        d = distritos.get(ubigeo)
        if d is None or time.time() - d["revisado"] >= REVISAR_CADA_S:
            try:
                modificado = w.files.get_metadata(ruta).last_modified
                if d is None or modificado != d["modificado"]:
                    contenido = w.files.download(ruta).contents.read()
                    d = {"modificado": modificado, "gzip": gzip.compress(contenido, 6), "etag": etiqueta(modificado, len(contenido))}
                d["revisado"] = time.time()
                distritos[ubigeo] = d
            except NotFound:
                distritos.pop(ubigeo, None)
                return jsonify(error=f"No existe {ruta}"), 404
            except Exception as e:
                if d is None:
                    return jsonify(error=f"{type(e).__name__}: {e}"), 502
    if request.headers.get("If-None-Match") == d["etag"]:
        return Response(status=304, headers={"ETag": d["etag"]})
    return comprimida(None, d["gzip"], "application/json", {"ETag": d["etag"]})


# Muestra de qué archivo y fecha vienen los datos, su tamaño y el último error.
@app.get("/salud")
def salud():
    actualizar()
    return jsonify(base=ARCHIVO_BASE, modificado=estado["modificado"], cargado=estado["cargado"],
                   mb=round(len(estado["html"]) / 1e6, 1) if estado["html"] else None, error=estado["error"],
                   distritos_en_memoria=len(distritos), mb_distritos_gzip=round(sum(len(d["gzip"]) for d in distritos.values()) / 1e6, 1),
                   simulador=ARCHIVO_SIMULADOR, simulador_modificado=simulador["modificado"], simulador_error=simulador["error"])


# Recarga los datos del simulador (los escribe el notebook 11) si cambiaron.
def actualizar_simulador():
    with candado_sim:
        if simulador["gzip"] is not None and time.time() - simulador["revisado"] < REVISAR_CADA_S:
            return
        simulador["revisado"] = time.time()
        try:
            modificado = w.files.get_metadata(ARCHIVO_SIMULADOR).last_modified
            if simulador["gzip"] is not None and modificado == simulador["modificado"]:
                return
            contenido = w.files.download(ARCHIVO_SIMULADOR).contents.read()
        except NotFound:
            simulador.update(json=None, gzip=None, error="Todavía no existe el archivo del simulador.")
            return
        except Exception as e:
            simulador["error"] = f"{type(e).__name__}: {e}"
            return
        simulador.update(modificado=modificado, json=contenido, gzip=gzip.compress(contenido, 6), error=None, etag=etiqueta(modificado, len(contenido)))


# El simulador ahora es una vista de la intranet.
@app.get("/simulador")
def simulador_antiguo():
    return redirect("/#/simulacion")


# Motor del simulador y guiones de las vistas: archivos fijos de la app, comprimidos al arrancar.
@app.get("/<nombre>.js")
def guion(nombre):
    if f"{nombre}.js" not in GUIONES:
        return jsonify(error="no existe"), 404
    cuerpo, cuerpo_gzip, etag = GUIONES[f"{nombre}.js"]
    if request.headers.get("If-None-Match") == etag:
        return Response(status=304, headers={"ETag": etag})
    return comprimida(cuerpo, cuerpo_gzip, "text/javascript", {"ETag": etag})


# Datos del simulador: champions, amplificación, curvas GEM y edificios agrupados.
@app.get("/simulador.json")
def datos_simulador():
    actualizar_simulador()
    if simulador["gzip"] is None:
        return jsonify(error=simulador["error"] or "Sin datos."), 503
    if request.headers.get("If-None-Match") == simulador["etag"]:
        return Response(status=304, headers={"ETag": simulador["etag"]})
    return comprimida(simulador["json"], simulador["gzip"], "application/json", {"ETag": simulador["etag"]})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("DATABRICKS_APP_PORT", "8000")), threaded=True)
