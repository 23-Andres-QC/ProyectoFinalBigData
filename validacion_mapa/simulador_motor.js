// Motor del simulador de sismos: repite en el navegador la cadena del notebook 11 con lo que exporta (champions, amplificación y curvas GEM).
// No entrena ni ajusta nada; funciona igual en Node para las pruebas.
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica();
  else raiz.Motor = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Generador con semilla (mulberry32) y normales estándar por Box-Muller.
  function Aleatorio(semilla) {
    let a = semilla >>> 0, guardado = null;
    const u = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const normal = () => {
      if (guardado !== null) { const g = guardado; guardado = null; return g; }
      let x = 0;
      while (x === 0) x = u();
      const r = Math.sqrt(-2 * Math.log(x)), th = 2 * Math.PI * u();
      guardado = r * Math.sin(th);
      return r * Math.cos(th);
    };
    return { u, normal, normales: (n) => { const v = new Float64Array(n); for (let i = 0; i < n; i++) v[i] = normal(); return v; } };
  }

  // FFT compleja radix 2 en el lugar, con tabla de senos y cosenos por tamaño.
  const TABLAS = new Map();
  function fft(re, im, inversa) {
    const n = re.length;
    let tb = TABLAS.get(n);
    if (!tb) {
      tb = { c: new Float64Array(n / 2), s: new Float64Array(n / 2) };
      for (let k = 0; k < n / 2; k++) { tb.c[k] = Math.cos(2 * Math.PI * k / n); tb.s[k] = Math.sin(2 * Math.PI * k / n); }
      TABLAS.set(n, tb);
    }
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    const signo = inversa ? 1 : -1;
    for (let len = 2; len <= n; len <<= 1) {
      const mitad = len >> 1, paso = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < mitad; k++) {
          const wr = tb.c[k * paso], wi = signo * tb.s[k * paso], a = i + k, b = a + mitad;
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        }
      }
    }
    if (inversa) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }

  function rfft(x) {
    const n = x.length, re = Float64Array.from(x), im = new Float64Array(n);
    fft(re, im, false);
    return { re: re.slice(0, n / 2 + 1), im: im.slice(0, n / 2 + 1) };
  }

  function irfft(re, im, n) {
    const R = new Float64Array(n), I = new Float64Array(n), h = n / 2;
    for (let k = 0; k <= h; k++) { R[k] = re[k]; I[k] = im[k]; }
    I[0] = 0; I[h] = 0;
    for (let k = 1; k < h; k++) { R[n - k] = re[k]; I[n - k] = -im[k]; }
    fft(R, I, true);
    return R;
  }

  // Utilidades numéricas iguales a las de numpy usadas en el 11.
  const media = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i]; return s / (b - a); };
  const desv = (x, a = 0, b = x.length) => { const m = media(x, a, b); let s = 0; for (let i = a; i < b; i++) s += (x[i] - m) ** 2; return Math.sqrt(s / (b - a)); };
  const maxAbs = (x) => { let m = 0; for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > m) m = v; } return m; };
  function buscar(arr, v) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } return lo; }
  function interp(x, xp, fp) {
    if (x <= xp[0]) return fp[0];
    const n = xp.length;
    if (x >= xp[n - 1]) return fp[n - 1];
    const j = buscar(xp, x) - 1, w = (x - xp[j]) / (xp[j + 1] - xp[j]);
    return fp[j] + w * (fp[j + 1] - fp[j]);
  }

  function tukey(M, alfa) {
    const w = new Float64Array(M).fill(1);
    if (M <= 1 || alfa <= 0) return w;
    const ancho = Math.floor(alfa * (M - 1) / 2);
    for (let i = 0; i <= ancho; i++) w[i] = 0.5 * (1 + Math.cos(Math.PI * (-1 + 2 * i / alfa / (M - 1))));
    for (let i = M - ancho - 1; i < M; i++) w[i] = 0.5 * (1 + Math.cos(Math.PI * (-2 / alfa + 1 + 2 * i / alfa / (M - 1))));
    return w;
  }

  function quitarTendencia(x) {
    const n = x.length;
    let st = 0, sx = 0, stt = 0, stx = 0;
    for (let i = 0; i < n; i++) { st += i; sx += x[i]; stt += i * i; stx += i * x[i]; }
    const b = (n * stx - st * sx) / (n * stt - st * st), a = (sx - b * st) / n, y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = x[i] - a - b * i;
    return y;
  }

  // Filtro en secciones (forma directa II transpuesta) y su versión de fase cero como sosfiltfilt de scipy.
  function sosfilt(sos, x, zi, escala) {
    const ns = sos.length, z = new Float64Array(2 * ns), y = new Float64Array(x.length);
    for (let k = 0; k < ns; k++) { z[2 * k] = zi[k][0] * escala; z[2 * k + 1] = zi[k][1] * escala; }
    for (let n = 0; n < x.length; n++) {
      let v = x[n];
      for (let k = 0; k < ns; k++) {
        const s = sos[k], o = s[0] * v + z[2 * k];
        z[2 * k] = s[1] * v - s[4] * o + z[2 * k + 1];
        z[2 * k + 1] = s[2] * v - s[5] * o;
        v = o;
      }
      y[n] = v;
    }
    return y;
  }

  function sosfiltfilt(F, x) {
    const e = F.padlen, n = x.length;
    if (n <= e) throw new Error(`Señal de ${n} muestras: muy corta para el filtro (mínimo ${e + 1})`);
    const ext = new Float64Array(n + 2 * e);
    for (let i = 0; i < e; i++) ext[i] = 2 * x[0] - x[e - i];
    ext.set(x, e);
    for (let i = 0; i < e; i++) ext[e + n + i] = 2 * x[n - 1] - x[n - 2 - i];
    let y = sosfilt(F.sos, ext, F.zi, ext[0]).reverse();
    y = sosfilt(F.sos, y, F.zi, y[0]).reverse();
    return y.slice(e, e + n);
  }

  // Aproximación de la normal estándar que usa la función phi del 11 (Abramowitz y Stegun 7.1.26).
  function phi(x) {
    const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
    const poli = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    const erf = 1 - poli * Math.exp(-z * z);
    return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
  }

  // Árboles exportados: escalado y probabilidad de la clase 1 como Spark (GBT logístico o promedio del bosque).
  function preparar(modelo) {
    const arboles = modelo.arboles.map((a) => ({ f: Int32Array.from(a.f), t: Float64Array.from(a.t), l: Int32Array.from(a.l), r: Int32Array.from(a.r), v: Float64Array.from(a.v) }));
    const pesos = Float64Array.from(modelo.pesos), mu = Float64Array.from(modelo.media), sd = Float64Array.from(modelo.desv);
    const z = new Float64Array(mu.length);
    return function (x) {
      for (let i = 0; i < mu.length; i++) z[i] = sd[i] > 0 ? (x[i] - mu[i]) / sd[i] : 0;
      let total = 0;
      for (let k = 0; k < arboles.length; k++) {
        const a = arboles[k];
        let nodo = 0;
        while (a.f[nodo] >= 0) nodo = z[a.f[nodo]] <= a.t[nodo] ? a.l[nodo] : a.r[nodo];
        total += pesos[k] * a.v[nodo];
      }
      return modelo.tipo === "gbt" ? 1 / (1 + Math.exp(-2 * total)) : total / arboles.length;
    };
  }

  // Crea el motor con los datos del simulador (simulador.json).
  function crear(D) {
    const C = D.constantes, FS = C.FS_SIM, G = C.G_CM_S2, S = D.sintetico;
    const PER = Float64Array.from(D.sdof.periodos), LNP = PER.map(Math.log), NP = PER.length;
    const PER_CAL = S.periodos_cal.map(Math.log), CORR = S.correccion;
    const VS = D.amplificacion.vs30, LNF = D.amplificacion.ln_f, F4 = D.amplificacion.f4, F5 = D.amplificacion.f5;
    const NL_REF = Math.log((D.amplificacion.pga_ref_nl + 0.1) / 0.1);
    const probOnda = preparar(D.modelo_onda), probDano = preparar(D.modelo_dano);
    const N_VENT = Math.round(C.VENTANA_P_S * FS), PASO = Math.round(C.PASO_P_S * FS), N_STA = Math.round(C.STA_S * FS), N_LTA = Math.round(C.LTA_S / C.STA_S);
    const RASGOS = ["e", "n", "z"].flatMap((c) => ["log_energia", "log_max", "curtosis", "log_ratio_mitades"].map((r) => `${r}_${c}`)).concat(["frec_dominante_z", "log_z_sobre_h"]);
    const COLS_ONDA = D.modelo_onda.columnas, COLS_DANO = D.modelo_dano.columnas;

    // Espectro de Fourier del modelo estocástico: fuente, distancia y atenuación (igual que espectro_fourier del 11).
    function espectroFourier(fr, m, r, ds, ka, q0) {
      const m0 = 10 ** (1.5 * m + 16.05), fc = 4.9e6 * S.beta_km_s * (ds / m0) ** (1 / 3);
      const re = Math.sqrt(r * r + (10 ** (-0.405 + 0.235 * m)) ** 2);
      const g = re <= 70 ? 1 / re : (re <= 130 ? 1 / 70 : Math.sqrt(130 / re) / 70);
      const c = 0.55 * 0.707 * 2.0 / (4 * Math.PI * S.rho_g_cm3 * S.beta_km_s ** 3) * 1e-20;
      const a = new Float64Array(fr.length);
      for (let k = 0; k < fr.length; k++) {
        const q = Math.max(q0 * fr[k] ** 0.5, 50.0);
        a[k] = c * m0 * (2 * Math.PI * fr[k]) ** 2 / (1 + (fr[k] / fc) ** 2) * g * Math.exp(-Math.PI * fr[k] * re / (q * S.beta_km_s)) * Math.exp(-Math.PI * ka * fr[k]);
      }
      return { a, fc, re };
    }

    const correccion = (f) => Math.exp(interp(Math.log(1 / f), PER_CAL, CORR));

    // Acelerograma estocástico en roca (cm/s²); recibe las normales para poder repetirlo.
    function largoSintetico(m, r, p) {
      const { fc, re } = espectroFourier([1.0], m, r, p.ds, p.ka, p.q0);
      const tgm = 1 / fc + 0.05 * re;
      return { n: 2 ** Math.ceil(Math.log2((2.5 * tgm + 20) * FS)), tgm };
    }

    function sinteticoRoca(m, r, p, normales) {
      const { n, tgm } = largoSintetico(m, r, p);
      const eps = 0.2, tn = 2 * tgm, b = -eps * Math.log(0.05) / (1 + eps * (Math.log(eps) - 1));
      const x = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / FS;
        x[i] = normales[i] * (Math.E / (eps * tn)) ** b * Math.max(t, 1e-9) ** b * Math.exp(-(b / (eps * tn)) * t);
      }
      const X = rfft(x), h = n / 2 + 1;
      let pot = 0;
      for (let k = 0; k < h; k++) pot += X.re[k] ** 2 + X.im[k] ** 2;
      const norma = Math.sqrt(pot / h), fr = new Float64Array(h);
      for (let k = 0; k < h; k++) fr[k] = k * FS / n;
      fr[0] = fr[1];
      const a = espectroFourier(fr, m, r, p.ds, p.ka, p.q0).a;
      for (let k = 0; k < h; k++) {
        const amp = a[k] * (p.corregir ? correccion(fr[k]) : 1) * FS / norma;
        X.re[k] *= amp; X.im[k] *= amp;
      }
      return irfft(X.re, X.im, n);
    }

    // Quita tendencia, aplica ventana y filtro pasa banda (filtrar_cms2 del 11).
    function filtrar(acc) {
      const m = media(acc), a = quitarTendencia(acc.map((v) => v - m)), w = tukey(a.length, 0.05);
      for (let i = 0; i < a.length; i++) a[i] *= w[i];
      return sosfiltfilt(D.filtros.senal, a);
    }

    // Oscilador de un grado de libertad por periodo, en bloque o muestra a muestra (Sa con 5 % de amortiguamiento).
    function Osciladores() {
      const z = new Float64Array(2 * NP), maximo = new Float64Array(NP);
      return {
        maximo,
        agregar(x) {
          for (let k = 0; k < NP; k++) {
            const b = D.sdof.b[k], a = D.sdof.a[k], y = b[0] * x + z[2 * k];
            z[2 * k] = b[1] * x - a[1] * y + z[2 * k + 1];
            z[2 * k + 1] = b[2] * x - a[2] * y;
            const v = Math.abs(y);
            if (v > maximo[k]) maximo[k] = v;
          }
        },
        sa() { return maximo.map((v, k) => (2 * Math.PI / PER[k]) ** 2 * v); },
      };
    }

    function espectroSa(acc) { const o = Osciladores(); for (let i = 0; i < acc.length; i++) o.agregar(acc[i]); return o.sa(); }

    // Amplificación lineal del champion de 06 (tabla de 07) y con la no linealidad de BSSA14.
    function lnAmplificacion(T, vs30) {
      const v = Math.min(Math.max(vs30, VS[0]), VS[VS.length - 1]), x = Math.log(Math.min(Math.max(T, PER[0]), PER[NP - 1]));
      const i = Math.min(Math.max(buscar(VS, v) - 1, 0), VS.length - 2), j = Math.min(Math.max(buscar(LNP, x) - 1, 0), NP - 2);
      const fv = (v - VS[i]) / (VS[i + 1] - VS[i]), fj = (x - LNP[j]) / (LNP[j + 1] - LNP[j]);
      return (1 - fv) * ((1 - fj) * LNF[i][j] + fj * LNF[i][j + 1]) + fv * ((1 - fj) * LNF[i + 1][j] + fj * LNF[i + 1][j + 1]);
    }

    const noLineal = (f4, f5, vs30, pgaR) => f4 * (Math.exp(f5 * (Math.min(vs30, 760) - 360)) - Math.exp(f5 * 400)) * (Math.log((pgaR + 0.1) / 0.1) - NL_REF);

    function lnF(T, vs30, pgaR) {
      const x = Math.log(T);
      return lnAmplificacion(T, vs30) + noLineal(interp(x, LNP, F4), interp(x, LNP, F5), vs30, pgaR);
    }

    // Rasgos de una ventana de 4 s (columnas e, n, z) iguales a los de 02_silver; la ventana ya viene en la escala de STEAD.
    const DFT = (() => {
      const c = new Float64Array(N_VENT), s = new Float64Array(N_VENT);
      for (let i = 0; i < N_VENT; i++) { c[i] = Math.cos(2 * Math.PI * i / N_VENT); s[i] = Math.sin(2 * Math.PI * i / N_VENT); }
      return { c, s };
    })();

    function rasgosVentana(cols) {
      const n = cols[0].length, mitad = n >> 1, r = {}, x = cols.map((col) => { const m = media(col); return col.map((v) => v - m); });
      const energia = [];
      ["e", "n", "z"].forEach((c, i) => {
        const xi = x[i];
        let e1 = 0, e2 = 0, m2 = 0, m4 = 0, mx = 0;
        for (let k = 0; k < n; k++) { const v2 = xi[k] * xi[k]; if (k < mitad) e1 += v2; else e2 += v2; if (Math.abs(xi[k]) > mx) mx = Math.abs(xi[k]); }
        const mk = media(xi);
        for (let k = 0; k < n; k++) { const d = (xi[k] - mk) ** 2; m2 += d; m4 += d * d; }
        m2 /= n; m4 /= n;
        energia.push((e1 + e2) / n);
        r[`log_energia_${c}`] = Math.log10((e1 + e2) / n + 1e-12);
        r[`log_max_${c}`] = Math.log10(mx + 1e-12);
        r[`curtosis_${c}`] = m4 / (m2 * m2) - 3;
        r[`log_ratio_mitades_${c}`] = Math.log10((e2 / (n - mitad) + 1e-12) / (e1 / mitad + 1e-12));
      });
      let mejor = -1, kMejor = 0;
      for (let k = 0; k <= n / 2; k++) {
        let re = 0, im = 0;
        for (let i = 0; i < n; i++) { const idx = (k * i) % n; re += x[2][i] * DFT.c[idx]; im -= x[2][i] * DFT.s[idx]; }
        const p = re * re + im * im;
        if (p > mejor) { mejor = p; kMejor = k; }
      }
      r.frec_dominante_z = kMejor * FS / n;
      r.log_z_sobre_h = Math.log10((energia[2] + 1e-12) / ((energia[0] + energia[1]) / 2 + 1e-12));
      return r;
    }

    const probabilidadOnda = (rasgos) => probOnda(COLS_ONDA.map((c) => rasgos[c]));

    // Distancia y tiempos de llegada de las ondas P y S a cada distrito.
    const DIST = D.distritos.ubigeo.map((u, j) => ({ j, ubigeo: u, nombre: D.distritos.distrito[j], lon: D.distritos.centroide_lon[j], lat: D.distritos.centroide_lat[j], vs30: D.distritos.vs30_mediana[j] }));
    function llegada(s, d) {
      const r = Math.sqrt(((d.lon - s.lon) * 111.32 * Math.cos((d.lat + s.lat) / 2 * Math.PI / 180)) ** 2 + ((d.lat - s.lat) * 110.57) ** 2 + s.prof_km ** 2);
      return { r, tP: r / C.VP_KM_S, tS: r / C.VS_KM_S };
    }

    const intensidadArias = (acc) => { const ia = new Float64Array(acc.length); let s = 0; for (let i = 0; i < acc.length; i++) { s += (acc[i] * 9.80665) ** 2; ia[i] = Math.PI / (2 * 9.80665) * s / FS; } return ia; };

    // Serie de un distrito como serie_distrito del 11: ruido, fase P y fase S en dos horizontales (suelo y roca) y una vertical.
    function serieDistrito(s, p, d, generador) {
      const { r, tP, tS } = llegada(s, d), base = s.semilla * 1000 + 100 * d.j;
      const gen = generador || ((tipo, i) => Aleatorio(tipo === "roca" ? base + i : base + 50));
      const roca = [0, 1, 2].map((i) => sinteticoRoca(s.magnitud, r, p, gen("roca", i).normales(largoSintetico(s.magnitud, r, p).n)));
      const n = roca[0].length, pgaR = Math.sqrt(maxAbs(roca[0]) * maxAbs(roca[1])) / G, h = n / 2 + 1;
      const transf = new Float64Array(h);
      for (let k = 0; k < h; k++) transf[k] = Math.exp(lnF(1 / ((k === 0 ? 1 : k) * FS / n), d.vs30, pgaR));
      const suelo = roca.slice(0, 2).map((x) => { const X = rfft(x); for (let k = 0; k < h; k++) { X.re[k] *= transf[k]; X.im[k] *= transf[k]; } return irfft(X.re, X.im, n); });
      const rocaG = roca.map((x) => filtrar(x).map((v) => v / G)), sueloG = suelo.map((x) => filtrar(x).map((v) => v / G));
      const ia = intensidadArias(sueloG[0]);
      const iFin = Math.min(buscar(ia, 0.99 * ia[n - 1]) + 5 * FS, C.DURACION_MAX_S * FS, n);
      const iP = Math.floor(tP * FS), iS = Math.floor(tS * FS), L = iS + iFin, rng = gen("ruido", 0);
      const componer = (baseG, factorP, factorS) => {
        const x = rng.normales(L).map((v) => v * C.RUIDO_G);
        const fp = sosfiltfilt(D.filtros.p, rng.normales(iS - iP)), w = tukey(iS - iP, 0.2);
        for (let i = 0; i < fp.length; i++) fp[i] *= w[i];
        const escala = factorP * C.RAZON_P_S * desv(baseG.hor, 0, iFin) / Math.max(desv(fp), 1e-12);
        for (let i = 0; i < fp.length; i++) x[iP + i] += fp[i] * escala;
        for (let i = 0; i < iFin; i++) x[iS + i] += factorS * baseG.ver[i];
        return x;
      };
      const series = {};
      [["ew", sueloG[0]], ["ns", sueloG[1]], ["ew_roca", rocaG[0]], ["ns_roca", rocaG[1]]].forEach(([nombre, b]) => { series[nombre] = componer({ hor: b, ver: b }, 1, 1); });
      series.z = componer({ hor: sueloG[0], ver: rocaG[2] }, C.RAZON_PZ_PH, C.RAZON_V_H);
      return { ...d, r, tP, tS, iP, iS, L, pgaRSerie: pgaR, series, sueloG, rocaG };
    }

    // Grupos de edificios y muestra para el champion de daño, con lo que no cambia entre sismos ya calculado.
    const GR = D.grupos, MU = D.muestra_rf, HEX = D.hex, NHEX = HEX.h3.length, ND = DIST.length;
    const FRAG = (() => {
      const f = D.fragilidad, m = new Map();
      f.tipologia.forEach((t, i) => m.set(`${t}|${f.pisos_gem[i]}`, { im: f.im[i], th: [f.theta_leve[i], f.theta_moderado[i], f.theta_severo[i], f.theta_colapso[i]], beta: f.beta[i] }));
      return m;
    })();
    const fijo = (T) => { const j = Math.min(Math.max(buscar(PER, T) - 1, 0), NP - 2); return { j, w: Math.min(Math.max((Math.log(T) - LNP[j]) / (LNP[j + 1] - LNP[j]), 0), 1) }; };
    const IM_T = { PGA: null, "SA(0.3s)": fijo(0.3), "SA(0.6s)": fijo(0.6), "SA(1.0s)": fijo(1.0) };
    const IM_COD = { PGA: 0, "SA(0.3s)": 1, "SA(0.6s)": 2, "SA(1.0s)": 3 };
    const lnDS = (h, k) => (h >= 0 && HEX.dS[h] ? Math.log(HEX.dS[h][k]) : 0);
    const NG = GR.d.length, gIM = new Int8Array(NG), gTh = new Float64Array(4 * NG), gBeta = new Float64Array(NG), gSin = new Uint8Array(NG);
    for (let g = 0; g < NG; g++) {
      const fr = FRAG.get(`${D.tipologias[GR.t[g]]}|${GR.pisos_gem[g]}`);
      if (!fr) { gSin[g] = 1; continue; }
      gIM[g] = IM_COD[fr.im]; gBeta[g] = fr.beta;
      for (let e = 0; e < 4; e++) gTh[4 * g + e] = fr.th[e];
    }

    // ln F en los periodos de las IM para un grupo: tabla del champion + término de sitio + no linealidad.
    function lnFArr(v, h, vs30, k, pgaR) { return LNF[v][k] + lnDS(h, k) + noLineal(F4[k], F5[k], vs30, pgaR); }
    function lnFEnT(v, h, vs30, pgaR, t) { return (1 - t.w) * lnFArr(v, h, vs30, t.j, pgaR) + t.w * lnFArr(v, h, vs30, t.j + 1, pgaR); }
    const lnSaEnT = (sa, t) => (1 - t.w) * Math.log(sa[t.j]) + t.w * Math.log(sa[t.j + 1]);

    // PGA en el suelo y P(daño ≥ leve, moderado, severo, colapso) de un grupo con el movimiento en roca m de su distrito.
    // La no linealidad usa m.pgaNL (PGA en roca de todo el registro) si viene, así el daño no baja con el tiempo; dv corre el Vs30 del grupo.
    const IM_NOMBRE = ["PGA", "SA(0.3s)", "SA(0.6s)", "SA(1.0s)"];
    function danoGrupo(g, m, dv = 0) {
      const nl = m.pgaNL ?? m.pga, v = GR.v[g], h = GR.h[g], vs30 = VS[v] + dv, lnPGA = Math.log(m.pga) + lnFArr(v, h, vs30, 0, nl);
      if (gSin[g]) return { pga: Math.exp(lnPGA), im: null, p: null };
      let lnIM;
      if (gIM[g] === 0) lnIM = lnPGA;
      else { const t = IM_T[IM_NOMBRE[gIM[g]]]; lnIM = lnSaEnT(m.sa, t) + lnFEnT(v, h, vs30, nl, t); }
      const b = gBeta[g];
      return { pga: Math.exp(lnPGA), im: Math.exp(lnIM), p: [0, 1, 2, 3].map((k) => phi((lnIM - Math.log(gTh[4 * g + k])) / b)) };
    }
    // Curva GEM de un grupo: medida de intensidad, medianas de los cuatro estados y β.
    const curvaGrupo = (g) => (gSin[g] ? null : { im: IM_NOMBRE[gIM[g]], th: Array.from(gTh.subarray(4 * g, 4 * g + 4)), beta: gBeta[g] });
    // Grupo del 11 al que pertenece un edificio (distrito, hexágono, Vs30, tipología y pisos GEM), o -1.
    let indice = null;
    const claveGrupo = (d, h, v, t, pg) => (((d * 4096 + h + 1) * 128 + v) * 8 + t) * 16 + pg;
    function grupoDe(d, h, v, t, pg) {
      if (!indice) { indice = new Map(); for (let g = 0; g < NG; g++) indice.set(claveGrupo(GR.d[g], GR.h[g], GR.v[g], GR.t[g], GR.pisos_gem[g]), g); }
      return indice.get(claveGrupo(d, h, v, t, pg)) ?? -1;
    }

    // Daño esperado con las curvas GEM para todos los grupos, a partir del movimiento en roca de cada distrito.
    // También deja por hexágono y distrito la PGA en el suelo (media por edificio) y los cuatro niveles de daño.
    function impactoGEM(dem, dv = 0) {
      const hexEsp = new Float64Array(NHEX), hexN = new Float64Array(NHEX), hexLeve = new Float64Array(NHEX), hexMod = new Float64Array(NHEX);
      const hexCol = new Float64Array(NHEX), hexPGA = new Float64Array(NHEX), hexNP = new Float64Array(NHEX);
      const dist = DIST.map(() => ({ n: 0, nP: 0, leve: 0, moderado: 0, severo: 0, colapso: 0, pga: 0, pgaMax: 0 }));
      let total = 0, leve = 0, moderado = 0, severo = 0, colapso = 0, pgaMax = 0;
      for (let g = 0; g < NG; g++) {
        const d = GR.d[g], m = dem[d];
        if (!m) continue;
        const h = GR.h[g], n = GR.count[g], { pga, p } = danoGrupo(g, m, dv);
        dist[d].pga += n * pga; dist[d].nP += n; dist[d].pgaMax = Math.max(dist[d].pgaMax, pga); pgaMax = Math.max(pgaMax, pga);
        if (h >= 0) { hexPGA[h] += n * pga; hexNP[h] += n; }
        if (!p) continue;
        total += n; leve += n * p[0]; moderado += n * p[1]; severo += n * p[2]; colapso += n * p[3];
        dist[d].n += n; dist[d].leve += n * p[0]; dist[d].moderado += n * p[1]; dist[d].severo += n * p[2]; dist[d].colapso += n * p[3];
        if (h >= 0) { hexEsp[h] += n * p[2]; hexN[h] += n; hexLeve[h] += n * p[0]; hexMod[h] += n * p[1]; hexCol[h] += n * p[3]; }
      }
      dist.forEach((x) => { x.pga = x.nP ? x.pga / x.nP : 0; });
      return { total, leve, moderado, severo, colapso, pgaMax, dist, hexEsp, hexN, hexLeve, hexMod, hexCol, hexPGA, hexNP };
    }

    // Variables del champion de daño para un edificio de la muestra (igual que dem y variables_lima del 11).
    function variablesDano(i, m) {
      const v = MU.v[i], h = MU.h[i], vs30 = MU.vs30[i], tb = MU.Tb[i], tTb = fijo(tb), nl = m.pgaNL ?? m.pga;
      const val = {
        pisos: MU.pisos[i], Tb: tb, area_m2: MU.area_m2[i], vs30, suelo_cod: vs30 < 180 ? 3 : vs30 < 500 ? 2 : vs30 < 1500 ? 1 : 0,
        PGA_g: m.pga * Math.exp(lnFArr(v, h, vs30, 0, nl)), PGV_cms: m.pgv,
        Sa03_g: Math.exp(lnSaEnT(m.sa, IM_T["SA(0.3s)"]) + lnFEnT(v, h, vs30, nl, IM_T["SA(0.3s)"])),
        Sa06_g: Math.exp(lnSaEnT(m.sa, IM_T["SA(0.6s)"]) + lnFEnT(v, h, vs30, nl, IM_T["SA(0.6s)"])),
        Sa10_g: Math.exp(lnSaEnT(m.sa, IM_T["SA(1.0s)"]) + lnFEnT(v, h, vs30, nl, IM_T["SA(1.0s)"])),
        Sa_Tb: Math.exp(lnSaEnT(m.sa, tTb) + lnFEnT(v, h, vs30, nl, tTb)),
      };
      return val;
    }

    // Índice del champion de daño en la muestra: medio por distrito y porcentaje fuera del rango de entrenamiento.
    function impactoRF(dem) {
      const dist = DIST.map(() => ({ n: 0, suma: 0, suma2: 0, fuera: 0 })), rangos = D.modelo_dano.rangos || {};
      for (let i = 0; i < MU.d.length; i++) {
        const d = MU.d[i], m = dem[d];
        if (!m) continue;
        const val = variablesDano(i, m), p = probDano(COLS_DANO.map((c) => val[c]));
        dist[d].n += 1; dist[d].suma += p; dist[d].suma2 += p * p;
        if (rangos.PGA_g && (val.PGA_g < rangos.PGA_g[0] || val.PGA_g > rangos.PGA_g[1])) dist[d].fuera += 1;
      }
      return dist.map((x) => ({ n: x.n, indice: x.n ? x.suma / x.n : null, pctFuera: x.n ? 100 * x.fuera / x.n : null,
        sd: x.n > 1 ? Math.sqrt(Math.max(0, (x.suma2 - x.suma * x.suma / x.n) / (x.n - 1))) : null }));
    }

    // Simulación de un sismo en los distritos activos (todos si no se indican): genera las series y las consume por muestras como el streaming del 11.
    // La semilla de cada distrito depende solo de su índice, así que un distrito da la misma señal solo o junto a otros.
    function simular(s, p, activos) {
      const usar = activos ? new Set(activos) : null;
      const dist = DIST.map((d) => (!usar || usar.has(d.j) ? serieDistrito(s, p, d) : null));
      dist.forEach((d) => { if (d) d.pgaFinal = Math.sqrt(maxAbs(d.series.ew_roca) * maxAbs(d.series.ns_roca)); });
      const estado = dist.map((d) => d && ({
        hecho: 0, staE: 0, staN: 0, sta: [], lta: [], tStaLta: null, ventanas: [], tModelo: null, falsas: 0, pMaxAntes: 0,
        oscER: Osciladores(), oscNR: Osciladores(), oscES: Osciladores(), oscNS: Osciladores(),
        maxER: 0, maxNR: 0, maxES: 0, maxNS: 0, velE: 0, velN: 0, maxVE: 0, maxVN: 0,
      }));
      const duracion = Math.max(...dist.filter(Boolean).map((d) => d.L)) / FS;
      let msModelo = 0, nVentanas = 0;

      // Procesa una muestra nueva de un distrito: STA/LTA, ventanas para el champion, osciladores y velocidad.
      function muestra(d, e, i) {
        const x = d.series, ew = x.ew[i], ns = x.ns[i];
        e.staE += ew * ew + ns * ns; e.staN += 1;
        if ((i + 1) % N_STA === 0 || i === d.L - 1) {
          const sta = e.staE / e.staN;
          if (e.sta.length >= N_LTA) {
            let s0 = 0;
            for (let k = e.sta.length - N_LTA; k < e.sta.length; k++) s0 += e.sta[k];
            const cociente = sta / (s0 / N_LTA);
            e.lta.push(cociente);
            if (e.tStaLta === null && cociente > C.UMBRAL_STA_LTA) e.tStaLta = (i + 1) / FS;
          } else e.lta.push(null);
          e.sta.push(sta); e.staE = 0; e.staN = 0;
        }
        const ini = i + 1 - N_VENT;
        if (ini >= 0 && ini % PASO === 0) {
          const t0 = (typeof performance !== "undefined" ? performance : Date).now();
          const cols = [x.ew, x.ns, x.z].map((c) => c.slice(ini, ini + N_VENT).map((v) => v * C.ESCALA_STEAD));
          const pr = probabilidadOnda(rasgosVentana(cols)), fin = (ini + N_VENT) / FS;
          msModelo += (typeof performance !== "undefined" ? performance : Date).now() - t0; nVentanas += 1;
          e.ventanas.push({ fin, p: pr });
          const antes = fin <= d.tP;
          if (antes) { e.pMaxAntes = Math.max(e.pMaxAntes, pr); if (pr >= C.UMBRAL_P_MODELO) e.falsas += 1; }
          if (e.tModelo === null && pr >= C.UMBRAL_P_MODELO) e.tModelo = fin;
        }
        e.oscER.agregar(x.ew_roca[i]); e.oscNR.agregar(x.ns_roca[i]); e.oscES.agregar(ew); e.oscNS.agregar(ns);
        e.maxER = Math.max(e.maxER, Math.abs(x.ew_roca[i])); e.maxNR = Math.max(e.maxNR, Math.abs(x.ns_roca[i]));
        e.maxES = Math.max(e.maxES, Math.abs(ew)); e.maxNS = Math.max(e.maxNS, Math.abs(ns));
        if (i > 0) {
          e.velE += (x.ew[i - 1] + ew) * G / (2 * FS); e.velN += (x.ns[i - 1] + ns) * G / (2 * FS);
          e.maxVE = Math.max(e.maxVE, Math.abs(e.velE)); e.maxVN = Math.max(e.maxVN, Math.abs(e.velN));
        }
      }

      return {
        dist, estado, duracion,
        // Avanza la señal hasta t segundos desde el origen.
        avanzar(t) {
          dist.forEach((d, k) => {
            if (!d) return;
            const e = estado[k], hasta = Math.min(d.L, Math.floor(t * FS));
            for (let i = e.hecho; i < hasta; i++) muestra(d, e, i);
            e.hecho = Math.max(e.hecho, hasta);
          });
        },
        // Movimiento en roca y suelo que ya llegó a cada distrito (Sa, PGA y PGV hasta ahora).
        demanda() {
          return estado.map((e, k) => {
            if (!e) return null;
            const saE = e.oscER.sa(), saN = e.oscNR.sa(), sa = saE.map((v, k) => Math.sqrt(v * saN[k]));
            const sueloE = e.oscES.sa(), sueloN = e.oscNS.sa();
            return { sa, saSuelo: sueloE.map((v, k) => Math.sqrt(v * sueloN[k])), pga: Math.sqrt(e.maxER * e.maxNR), pgaSuelo: Math.sqrt(e.maxES * e.maxNS), pgv: Math.sqrt(e.maxVE * e.maxVN),
              pgaNL: dist[k].pgaFinal };
          }).map((m) => (m && m.pga > 0 && m.sa.every((v) => v > 0) ? m : null));
        },
        rendimiento: () => ({ ventanas: nVentanas, msPorVentana: nVentanas ? msModelo / nVentanas : null }),
      };
    }

    // Comprueba con los resultados de Spark que trae el JSON que el navegador da lo mismo. Por distrito, el GEM del 11 debe caer entre los grupos
    // con el Vs30 en los bordes de su intervalo de 10 m/s (el 11 usa el exacto) y el índice de 08 de la muestra se mide en errores estándar.
    function verificar() {
      const V = D.verificacion, out = {};
      const vent = V.ventanas, nv = vent.p_onda_p.length;
      let e1 = 0, iguales = 0;
      for (let i = 0; i < nv; i++) {
        const p = probOnda(COLS_ONDA.map((c) => vent[c][i]));
        e1 = Math.max(e1, Math.abs(p - vent.p_onda_p[i]));
        if ((p >= C.UMBRAL_P_MODELO) === (vent.p_onda_p[i] >= C.UMBRAL_P_MODELO)) iguales += 1;
      }
      out.onda = { n: nv, errMax: e1, alarmasIguales: iguales };
      const ed = V.edificios, ne = ed.indice_dano.length;
      let e2 = 0, e3 = 0;
      for (let i = 0; i < ne; i++) {
        const vs30 = ed.vs30[i], val = { ...Object.fromEntries(COLS_DANO.map((c) => [c, ed[c] ? ed[c][i] : null])), suelo_cod: vs30 < 180 ? 3 : vs30 < 500 ? 2 : vs30 < 1500 ? 1 : 0 };
        e2 = Math.max(e2, Math.abs(probDano(COLS_DANO.map((c) => val[c])) - ed.indice_dano[i]));
        const tope = D.pisos_max_gem[ed.tipologia[i]] ?? D.pisos_max_gem.albanileria_confinada;
        const fr = FRAG.get(`${ed.tipologia[i]}|${Math.min(ed.pisos[i], tope)}`);
        const im = { PGA: ed.PGA_g[i], "SA(0.3s)": ed.Sa03_g[i], "SA(0.6s)": ed.Sa06_g[i], "SA(1.0s)": ed.Sa10_g[i] }[fr.im];
        e3 = Math.max(e3, Math.abs(phi(Math.log(im / fr.th[2]) / fr.beta) - ed.P_ge_severo[i]));
      }
      out.dano = { n: ne, errMax: e2 };
      out.gem = { n: ne, errMax: e3 };
      const vd = V.distritos, dem = [];
      let e4 = 0;
      vd.d.forEach((d, i) => {
        dem[d] = { sa: vd.sa_roca[i], pga: vd.pga_roca_g[i], pgv: vd.pgv_cms[i] };
        PER.forEach((T, k) => { e4 = Math.max(e4, Math.abs(Math.exp(lnF(T, vd.vs30_mediana[i], vd.pga_roca_g[i])) / vd.F_no_lineal[i][k] - 1)); });
      });
      out.amplificacion = { n: vd.d.length * NP, errRelMax: e4 };
      const gem =impactoGEM(dem), menos = impactoGEM(dem, -5), mas = impactoGEM(dem, 5), rf = impactoRF(dem), sev = (x, d) => x.dist[d].severo / x.dist[d].n;
      const di = { n: vd.d.length, errMaxSevero: 0, fueraRango: [], excesoMax: 0, anchoMax: 0, errMaxIndice: 0, zMax: 0, zDistrito: null, nMuestra: 0 };
      vd.d.forEach((d, i) => {
        const p = vd.P_ge_severo_medio[i], a = sev(menos, d), b = sev(mas, d), ex = Math.max(0, Math.min(a, b) - p, p - Math.max(a, b));
        di.errMaxSevero = Math.max(di.errMaxSevero, Math.abs(sev(gem, d) - p)); di.anchoMax = Math.max(di.anchoMax, Math.abs(b - a));
        if (ex > 1e-9) di.fueraRango.push(d);
        di.excesoMax = Math.max(di.excesoMax, ex);
        const r = rf[d], dif = r.indice - vd.indice_dano_medio[i], se = r.sd / Math.sqrt(r.n) * Math.sqrt(Math.max(0, 1 - r.n / gem.dist[d].nP));
        di.errMaxIndice = Math.max(di.errMaxIndice, Math.abs(dif)); di.nMuestra = Math.max(di.nMuestra, r.n);
        if (se > 0 && Math.abs(dif / se) > di.zMax) { di.zMax = Math.abs(dif / se); di.zDistrito = d; }
      });
      out.distritos = di;
      return out;
    }

    return {
      D, FS, PER, DIST, RASGOS, Aleatorio, espectroFourier, sinteticoRoca, largoSintetico, filtrar, espectroSa, lnAmplificacion, lnF,
      rasgosVentana, probabilidadOnda, probDano, llegada, serieDistrito, impactoGEM, impactoRF, variablesDano, simular, verificar, sosfiltfilt, tukey, quitarTendencia,
      danoGrupo, curvaGrupo, grupoDe, NG,
    };
  }

  return { crear, Aleatorio, fft, rfft, irfft, phi };
});
