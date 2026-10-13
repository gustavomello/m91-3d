// Troféu em duas fases:
//  1. prepararPredio(): corta o prédio da direita do modelo original, simplifica para impressão e fecha a empena.
//     Rodar uma vez (preparar.html); grava predio-simplificado.stl + predio-simplificado.json.
//  2. gerarBase(): lê o prédio preparado e monta a base, os rebaixos e as placas fixas (gerar.html).
// A personalização (imobiliária + posição) é feita depois em personalizar.html.
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import * as L from './trofeu-lib.js';

// fase 1: só vale depois de rodar "Preparar prédio" de novo
export const PREPARO = {
  escala: 0.1,            // 1:100 -> cm reais viram mm
  cutFromStart: 5750,     // cm: meio da junta entre o 3º e o 4º prédio
  platibanda: 1510,       // cm: altura da platibanda (medida em todo o perímetro)
  empena: [-1.5, 2.0],    // mm: espessura da empena em relação ao corte
  minPlaca: 1.0,          // mm: placas finas (guarda-corpos, vidros) passam a ter esta espessura
  minLinha: 0.8,          // mm: barras com duas dimensões abaixo disso são removidas
  minPeca: 1.0,           // mm: peças com todas as dimensões abaixo disso são removidas
};

// fase 2
export const LAYOUT = {
  margem: 8,              // mm: base além do prédio
  alturaBase: 45,         // mm
};

const PREDIO_STL = new URL('./predio-simplificado.stl', import.meta.url);
const PREDIO_JSON = new URL('./predio-simplificado.json', import.meta.url);

/**
 * Fase 1: prédio da direita cortado, simplificado e com o miolo da empena (alas fechadas até a platibanda).
 * A camada externa da empena, que tem o rebaixo do símbolo M91, fica para gerarBase().
 */
export async function prepararPredio(log = console.log) {
  const S = PREPARO.escala;

  // ---------- 1. corta o prédio da direita no meio da junta ----------
  const Bm = await cortarPredio(log);

  // ---------- 2. simplificação para impressão ----------
  log('Simplificando peças finas para impressão…');
  const simp = simplificar(Bm);
  const building = simp.building;
  building.computeBoundingBox(); const bb = building.boundingBox;

  // ---------- 3. empena com topo horizontal na altura da platibanda ----------
  log('Fechando a empena…');
  const cell = 0.5, W = Math.ceil((bb.max.y - bb.min.y) / cell) + 3, H = Math.ceil(bb.max.z / cell) + 3;
  const mask = new Uint8Array(W * H);
  for (let t = 0; t < Bm.length; t += 9) {
    if (Math.min(Bm[t], Bm[t + 3], Bm[t + 6]) > 6) continue; // até 6 mm (60 cm reais) do corte
    const q = [0, 3, 6].map(k => [(Bm[t + k + 1] - bb.min.y) / cell + 1, Bm[t + k + 2] / cell + 1]);
    const span = Math.max(...q.map(p => p[0])) - Math.min(...q.map(p => p[0])) + Math.max(...q.map(p => p[1])) - Math.min(...q.map(p => p[1]));
    const s = Math.max(1, Math.ceil(span * 1.5));
    for (let a = 0; a <= s; a++) for (let b2 = 0; b2 <= s - a; b2++) { const c = s - a - b2; mask[Math.round((q[0][1] * a + q[1][1] * b2 + q[2][1] * c) / s) * W + Math.round((q[0][0] * a + q[1][0] * b2 + q[2][0] * c) / s)] = 1; }
  }
  const outside = new Uint8Array(W * H), st = [0]; outside[0] = 1;
  while (st.length) { const k = st.pop(), x = k % W, y = (k / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const nk = ny * W + nx; if (outside[nk] || mask[nk]) continue; outside[nk] = 1; st.push(nk); } }
  const cols = []; for (let x = 0; x < W; x++) { let any = false; for (let y = 0; y < H; y++) if (!outside[y * W + x]) { any = true; break; } cols.push(any); }
  const wings = []; let start = -1;
  cols.forEach((c, x) => { if (c && start < 0) start = x; if ((!c || x === W - 1) && start >= 0) { const end = c ? x + 1 : x; if (end - start > 10) wings.push([(start - 1) * cell + bb.min.y, (end - 1) * cell + bb.min.y]); start = -1; } });
  const top = PREPARO.platibanda * S, [e0, e1] = PREPARO.empena, T = L.PLATE_T;
  // miolo das alas; a camada externa (e0 .. e0 + T) é montada em gerarBase()
  const nucleo = wings.map(([a, b]) => L.box(e0 + T, e1, a, b, 0, top));

  return {
    geometry: L.merge([building, ...simp.extra, ...nucleo]),
    dados: {
      versao: 1,
      predioBbox: { min: bb.min.toArray(), max: bb.max.toArray() }, // só o prédio, sem empena nem painéis
      empena: { x0: e0, nucleoX0: e0 + T, x1: e1, topo: top, alas: wings },
      simplificacao: simp.stats,
    },
  };
}

/** Fase 2: base + rebaixos + placas fixas, a partir do prédio preparado. */
export async function gerarBase(log = console.log) {
  const info = {};

  log('Lendo o prédio preparado…');
  const [rs, rj] = await Promise.all([fetch(PREDIO_STL), fetch(PREDIO_JSON)]);
  if (!rs.ok || !rj.ok) throw new Error('Falta predio-simplificado.stl/.json: rode "Preparar prédio" primeiro.');
  const pred = await rj.json();
  if (pred.versao !== 1) throw new Error('predio-simplificado.json é de outra versão: rode "Preparar prédio" de novo.');
  const building = L.positionsOnly(new STLLoader().parse(await rs.arrayBuffer()));
  const bb = new THREE.Box3(new THREE.Vector3(...pred.predioBbox.min), new THREE.Vector3(...pred.predioBbox.max));
  const { x0: e0, nucleoX0, topo: top, alas: wings } = pred.empena, T = L.PLATE_T;
  if (Math.abs(nucleoX0 - e0 - T) > 1e-6) throw new Error('PLATE_T mudou desde a preparação do prédio: rode "Preparar prédio" de novo.');
  info.simplificacao = pred.simplificacao;
  info.empena = wings.map(([a, b]) => +(b - a).toFixed(1) + ' mm');
  const parts = [building];

  // ---------- 4. base e placas ----------
  // Os logos viram PLACAS impressas deitadas (fundo neutro + relevo colorido) e encaixadas em rebaixos.
  const M = LAYOUT.margem, BH = LAYOUT.alturaBase, zc = -BH / 2;
  const base = { x0: Math.min(bb.min.x, e0) - M, x1: bb.max.x + M, y0: bb.min.y - M, y1: bb.max.y + M };
  const bw = base.x1 - base.x0, cxB = (base.x0 + base.x1) / 2;
  const vUp = new THREE.Vector3(0, 0, 1);
  const face = (out) => ({ out, v: vUp.clone(), h: new THREE.Vector3().crossVectors(vUp, out) });
  const front = face(new THREE.Vector3(0, -1, 0)), back = face(new THREE.Vector3(0, 1, 0)), side = face(new THREE.Vector3(-1, 0, 0));

  // tamanhos das placas (mm)
  const plH = 36, pad = 6;
  const jdiP = { w: 58, h: plH }, imoP = { w: bw - 2 * pad - jdiP.w - pad, h: plH }, m91P = { w: 130, h: 30 };
  // posições na frente, em coordenadas da face (centro da face = 0,0; h = +X)
  const jdiAt = { cx: -bw / 2 + pad + jdiP.w / 2, cy: 0 }, imoAt = { cx: bw / 2 - pad - imoP.w / 2, cy: 0 };

  // núcleo da base (sem as camadas externas da frente e dos fundos) + camadas com rebaixos
  parts.push(L.box(base.x0, base.x1, base.y0 + T, base.y1 - T, -BH, 0));
  parts.push(L.box(bb.min.x, bb.max.x, bb.min.y, bb.max.y, -0.5, 0.3)); // sobreposição sob o prédio: garante que fiquem colados
  parts.push(L.slabWithPockets(bw, BH, [{ ...jdiAt, ...jdiP }, { ...imoAt, ...imoP }], T, new THREE.Vector3(cxB, base.y0, zc), front.h, front.v, front.out));
  parts.push(L.slabWithPockets(bw, BH, [{ cx: 0, cy: 0, ...m91P }], T, new THREE.Vector3(cxB, base.y1, zc), back.h, back.v, back.out));

  // empena: o miolo das alas já vem no prédio preparado; aqui só a camada externa, a maior ala recebe o rebaixo do símbolo M91
  const wingList = wings.map(([a, b]) => ({ a, b, w: b - a }));
  const big = [...wingList].sort((p, q) => q.w - p.w)[0];
  const symP = { w: Math.min(40, big.w - 8), h: 30 }, symZ = top * 0.72;
  for (const wg of wingList) {
    const holes = wg === big ? [{ cx: 0, cy: symZ - top / 2, ...symP }] : [];
    // olhando de -X, h aponta para -Y: o centro da ala em h é -(a+b)/2
    parts.push(L.slabWithPockets(wg.w, top, holes, T, new THREE.Vector3(e0, (wg.a + wg.b) / 2, top / 2), side.h, side.v, side.out));
  }

  // ---------- 5. junta, centraliza (X,Y) e apoia em Z = 0 ----------
  log('Montando…');
  const all = L.merge(parts);
  const dx = -cxB, dy = -(base.y0 + base.y1) / 2, dz = BH;
  all.translate(dx, dy, dz);
  orientOutward(all);
  all.computeBoundingBox();
  info.tamanhoMm = all.boundingBox.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(1));

  // rebaixos no sistema final (centro na face externa)
  const toFinal = (vec) => [vec.x + dx, vec.y + dy, vec.z + dz];
  const pocket = (f, center, size) => ({ center: toFinal(center), h: f.h.toArray(), v: f.v.toArray(), out: f.out.toArray(), w: size.w, h_: size.h });
  const pockets = {
    jardimDosIpes: pocket(front, new THREE.Vector3(cxB + jdiAt.cx, base.y0, zc), jdiP),
    imobiliaria: pocket(front, new THREE.Vector3(cxB + imoAt.cx, base.y0, zc), imoP),
    m91Fundos: pocket(back, new THREE.Vector3(cxB, base.y1, zc), m91P),
    m91Empena: pocket(side, new THREE.Vector3(e0, (big.a + big.b) / 2, symZ), symP),
  };

  // ---------- 6. placas fixas (impressas deitadas) ----------
  log('Placas: Jardim dos Ipês e M91…');
  const jdiMask = await pdfToMask(new URL('../fontes/logo-jardim-dos-ipes-amarelo.pdf', import.meta.url).href, 2400);
  const m91 = await m91Masks();
  const plates = {
    jardimDosIpes: L.makePlate(jdiP.w, jdiP.h, [{ mask: jdiMask, fit: [jdiP.w - 8, jdiP.h - 6], at: [0, 0] }]),
    m91Fundos: L.makePlate(m91P.w, m91P.h, [{ mask: m91.full, fit: [m91P.w - 12, m91P.h - 8], at: [0, 0] }]),
    m91Empena: L.makePlate(symP.w, symP.h, [{ mask: m91.symbol, fit: [symP.w - 6, symP.h - 6], at: [0, 0] }]),
  };
  info.placas = Object.fromEntries(Object.entries(plates).map(([k, p]) => [k, { logoMm: p.thin[0].size.map(v => +v.toFixed(1)), tracoFino: pct(p.thin[0].thinAfter) }]));

  // disposição na mesa de impressão (todas as placas fixas juntas, sem sobrepor)
  const bed = { jardimDosIpes: [0, 0], m91Empena: [jdiP.w / 2 + 6 + symP.w / 2, 0], m91Fundos: [0, -(jdiP.h / 2 + 6 + m91P.h / 2)] };
  const atBed = (g, k) => { const c = g.clone(); c.translate(bed[k][0], bed[k][1], 0); return c; };
  const tiles = L.merge(Object.keys(plates).map(k => atBed(plates[k].tile, k)));
  const amarelo = atBed(plates.jardimDosIpes.relief, 'jardimDosIpes');
  const azul = L.merge([atBed(plates.m91Fundos.relief, 'm91Fundos'), atBed(plates.m91Empena.relief, 'm91Empena')]);

  // troféu montado (só para visualizar): base + placas nos rebaixos
  const placed = (k) => [L.placeInPocket(plates[k].tile, pockets[k]), L.placeInPocket(plates[k].relief, pockets[k])];

  // frente justificada: logo do Jardim dos Ipês | posição | logo da imobiliária com espaços iguais entre eles e margem direita = margem esquerda.
  // Como a largura do logo da imobiliária varia, a distribuição é feita em personalizar.html; aqui vão os limites (relativos ao centro da placa).
  const jdiLogoW = plates.jardimDosIpes.thin[0].size[0], margemLateral = jdiAt.cx - jdiLogoW / 2 + bw / 2;
  const layout = {
    versao: 2,
    placaT: T, folga: L.PLATE_GAP,
    rebaixos: pockets,
    // conteúdo da placa personalizada (mm, relativo ao centro da placa); "at" é a posição sem justificar
    imobiliaria: {
      w: imoP.w, h: imoP.h,
      posicao: { fit: [30, 30], at: [-imoP.w / 2 + 4 + 15, 0] },
      logo: { fit: [imoP.w - 4 - 30 - 6 - 4, imoP.h - 8], at: [(-imoP.w / 2 + 4 + 30 + 6 + imoP.w / 2 - 4) / 2, 0] },
      justificar: { de: jdiAt.cx + jdiLogoW / 2 - imoAt.cx, ate: bw / 2 - margemLateral - imoAt.cx, borda: 4 },
    },
    tamanhoMm: info.tamanhoMm,
  };
  info.espacoLogoImobiliariaMm = layout.imobiliaria.logo.fit.map(v => +v.toFixed(1));
  return {
    geometry: all, layout, info,
    files: { tiles, amarelo, azul },
    preview: {
      fundo: L.merge(['jardimDosIpes', 'm91Fundos', 'm91Empena'].map(k => placed(k)[0])),
      amarelo: placed('jardimDosIpes')[1],
      azul: L.merge([placed('m91Fundos')[1], placed('m91Empena')[1]]),
    },
  };
}

const pct = x => (x * 100).toFixed(1) + '%';

async function pdfToMask(url, targetW) {
  if (!globalThis.pdfjsLib) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const page = await (await pdfjsLib.getDocument(url).promise).getPage(1);
  const vp = page.getViewport({ scale: targetW / page.getViewport({ scale: 1 }).width });
  const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp, background: 'rgba(0,0,0,0)' }).promise;
  return cropMask(L.canvasToMask(c));
}

async function m91Masks() {
  const bmp = await createImageBitmap(await (await fetch(new URL('../fontes/logo-m91/Asset%202.png', import.meta.url))).blob());
  const c = new OffscreenCanvas(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0);
  const all = L.canvasToMask(c);
  // sem a palavra ENGENHARIA (fina demais para a escala); símbolo = parte da esquerda
  for (let y = 0; y < all.H; y++) for (let x = 0; x < all.W; x++) if (x > 1000 && y > 500) all.mask[y * all.W + x] = 0;
  const sym = { W: all.W, H: all.H, mask: all.mask.map((v, i) => (i % all.W) < 980 ? v : 0) };
  return { full: cropMask(all), symbol: cropMask(sym) };
}

function cropMask(m) {
  let x0 = m.W, y0 = m.H, x1 = -1, y1 = -1;
  for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) if (m.mask[y * m.W + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const W = x1 - x0 + 1, H = y1 - y0 + 1, mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) mask[y * W + x] = m.mask[(y + y0) * m.W + x + x0];
  return { W, H, mask };
}

/** Deixa a orientação das faces coerente e virada para fora, por peça. */
export function orientOutward(geom) {
  const g0 = new THREE.BufferGeometry(); g0.setAttribute('position', geom.attributes.position);
  const m = BGU.mergeVertices(g0, 1e-5), P = m.attributes.position.array, I = m.index.array, T = I.length / 3;
  const edges = new Map(), ek = (a, b) => a < b ? a * 4194304 + b : b * 4194304 + a;
  for (let t = 0; t < T; t++) for (let j = 0; j < 3; j++) { const a = I[t * 3 + j], b = I[t * 3 + (j + 1) % 3], k = ek(a, b); let e = edges.get(k); if (!e) { e = []; edges.set(k, e); } e.push(t); }
  const comp = new Int32Array(T).fill(-1), flip = new Uint8Array(T); let n = 0;
  const dirOf = (t, a, b) => { for (let j = 0; j < 3; j++) { const x = I[t * 3 + j], y = I[t * 3 + (j + 1) % 3]; if (x === a && y === b) return 1; if (x === b && y === a) return -1; } return 0; };
  for (let s = 0; s < T; s++) { if (comp[s] >= 0) continue; const q = [s]; comp[s] = n;
    while (q.length) { const t = q.pop(); for (let j = 0; j < 3; j++) { const a = I[t * 3 + j], b = I[t * 3 + (j + 1) % 3], e = edges.get(ek(a, b)); if (e.length !== 2) continue; const u = e[0] === t ? e[1] : e[0]; if (comp[u] >= 0) continue; if (dirOf(t, a, b) * (flip[t] ? -1 : 1) === dirOf(u, a, b)) flip[u] = 1; comp[u] = n; q.push(u); } }
    n++; }
  const out = new Float32Array(T * 9);
  for (let t = 0; t < T; t++) { const ids = flip[t] ? [I[t * 3], I[t * 3 + 2], I[t * 3 + 1]] : [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]]; ids.forEach((v, j) => { out[t * 9 + j * 3] = P[v * 3]; out[t * 9 + j * 3 + 1] = P[v * 3 + 1]; out[t * 9 + j * 3 + 2] = P[v * 3 + 2]; }); }
  const vol = new Float64Array(n);
  for (let t = 0; t < T; t++) { const o = t * 9, [ax, ay, az, bx, by, bz, cx, cy, cz] = out.subarray(o, o + 9); vol[comp[t]] += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6; }
  for (let t = 0; t < T; t++) if (vol[comp[t]] < 0) { const o = t * 9; for (let j = 0; j < 3; j++) { const x = out[o + 3 + j]; out[o + 3 + j] = out[o + 6 + j]; out[o + 6 + j] = x; } }
  geom.setAttribute('position', new THREE.BufferAttribute(out, 3));
  return geom;
}

/** Lê o modelo original e devolve o prédio da direita em mm (X = comprimento, 0 = corte; Y = profundidade; Z = altura, 0 = chão). */
export async function cortarPredio(log = console.log) {
  const S = PREPARO.escala;
  log('Lendo o modelo original…');
  const P0 = new STLLoader().parse(await (await fetch(new URL('../fontes/jardim-dos-ipes.stl', import.meta.url))).arrayBuffer()).attributes.position.array;
  const N0 = P0.length / 3;
  let mx = 0, my = 0; for (let i = 0; i < P0.length; i += 3) { mx += P0[i]; my += P0[i + 1]; } mx /= N0; my /= N0;
  let sxx = 0, syy = 0, sxy = 0; for (let i = 0; i < P0.length; i += 3) { const x = P0[i] - mx, y = P0[i + 1] - my; sxx += x * x; syy += y * y; sxy += x * y; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang), vx = -uy, vy = ux;
  let umin = 1e9; for (let i = 0; i < P0.length; i += 3) umin = Math.min(umin, (P0[i] - mx) * ux + (P0[i + 1] - my) * uy);
  const cut = umin + PREPARO.cutFromStart;
  const U = (x, y) => (x - mx) * ux + (y - my) * uy, V = (x, y) => (x - mx) * vx + (y - my) * vy;
  log('Separando o prédio da direita…');
  const keep = [];
  for (let t = 0; t < P0.length; t += 9) {
    const tri = [0, 3, 6].map(k => [P0[t + k], P0[t + k + 1], P0[t + k + 2]]);
    const d = tri.map(p => U(p[0], p[1]) - cut);
    if (d.every(x => x >= 0)) { keep.push(...tri[0], ...tri[1], ...tri[2]); continue; }
    if (d.every(x => x <= 0)) continue;
    const poly = [];
    for (let i = 0; i < 3; i++) { const A = tri[i], B = tri[(i + 1) % 3], da = d[i], db = d[(i + 1) % 3];
      if (da >= 0) poly.push(A);
      if ((da >= 0) !== (db >= 0)) { const s = da / (da - db); poly.push([A[0] + (B[0] - A[0]) * s, A[1] + (B[1] - A[1]) * s, A[2] + (B[2] - A[2]) * s]); } }
    for (let i = 1; i + 1 < poly.length; i++) keep.push(...poly[0], ...poly[i], ...poly[i + 1]);
  }
  let zmin = 1e9; for (let i = 2; i < keep.length; i += 3) zmin = Math.min(zmin, keep[i]);
  // local em mm: X ao longo do comprimento (0 = corte), Y profundidade, Z altura (0 = chão)
  const Bm = new Float32Array(keep.length);
  for (let i = 0; i < keep.length; i += 3) { Bm[i] = (U(keep[i], keep[i + 1]) - cut) * S; Bm[i + 1] = V(keep[i], keep[i + 1]) * S; Bm[i + 2] = (keep[i + 2] - zmin) * S; }
  return Bm;
}

/** Peças (componentes conectados) do prédio, com caixa envolvente. */
export function componentes(Bm) {
  const g0 = new THREE.BufferGeometry(); g0.setAttribute('position', new THREE.BufferAttribute(Bm, 3));
  const m = BGU.mergeVertices(g0, 1e-5); const P = m.attributes.position.array, I = m.index.array, Vn = P.length / 3;
  const parent = new Int32Array(Vn).map((_, i) => i); const f = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let t = 0; t < I.length; t += 3) { const a = f(I[t]); parent[f(I[t + 1])] = a; parent[f(I[t + 2])] = a; }
  const comps = new Map();
  for (let v = 0; v < Vn; v++) { const r = f(v); let b = comps.get(r); if (!b) { b = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }; comps.set(r, b); } for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], P[v * 3 + k]); b.max[k] = Math.max(b.max[k], P[v * 3 + k]); } }
  return { P, I, Vn, f, comps };
}

/** Regras de simplificação para impressão. */
export function simplificar(Bm) {
  const { P, I, Vn, f, comps } = componentes(Bm);
  const stats = { removidasPoeira: 0, gaiolasRemovidas: 0, guardaCorposSolidos: 0, paineisSolidos: 0, barrasRemovidas: 0, engrossadas: 0, mantidas: 0 };
  const panels = []; // caixas sólidas que substituem conjuntos de barras
  const T1 = PREPARO.minPlaca;
  const list = [...comps.values()];
  for (const b of list) {
    b.d = [0, 1, 2].map(k => b.max[k] - b.min[k]);
    b.c = [0, 1, 2].map(k => (b.max[k] + b.min[k]) / 2);
    const s = [...b.d].sort((a, c) => a - c);
    b.isBar = s[2] >= PREPARO.minPeca && s[1] < PREPARO.minLinha;
    b.isVertical = b.isBar && b.d[2] >= 4 && b.d[0] < PREPARO.minLinha && b.d[1] < PREPARO.minLinha;
  }
  const overlap = (a, b, e) => { for (let k = 0; k < 3; k++) if (a.min[k] - e > b.max[k] || b.min[k] - e > a.max[k]) return false; return true; };
  const clusterOf = (items, e) => {
    const par = items.map((_, i) => i), fd = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (overlap(items[i], items[j], e)) par[fd(i)] = fd(j);
    const m = new Map(); items.forEach((it, i) => { const r = fd(i); if (!m.has(r)) m.set(r, []); m.get(r).push(it); });
    return [...m.values()];
  };
  const bboxOf = (items) => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; items.forEach(b => { for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], b.min[k]); mx[k] = Math.max(mx[k], b.max[k]); } }); return { min: mn, max: mx }; };

  // 1) gaiolas de botijão
  // 1a) a estrutura externa é um cubo aramado (só arestas, ~60 cm reais): peça do tamanho de um cubo, mas quase oca
  const area = new Map();
  for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b2 = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b2] - P[a], uy = P[b2 + 1] - P[a + 1], uz = P[b2 + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const r = comps.get(f(I[t])); area.set(r, (area.get(r) || 0) + Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2); }
  for (const b of list) {
    if (!b.d.every(v => v >= 3 && v <= 10)) continue;
    const boxArea = 2 * (b.d[0] * b.d[1] + b.d[1] * b.d[2] + b.d[0] * b.d[2]);
    if (area.get(b) / boxArea < 0.6) {
      const region = { min: b.min.map(v => v - 0.3), max: b.max.map(v => v + 0.3) };
      for (const o of list) if (!o.action && o.min.every((v, k) => v >= region.min[k]) && o.max.every((v, k) => v <= region.max[k])) o.action = 'remove';
      stats.gaiolasRemovidas++;
    }
  }
  // 1b) grades internas das gaiolas: grupos pequenos de barras de ~0,4 mm -> remove tudo o que estiver dentro delas
  const bars = list.filter(b => b.isBar && !b.action);
  for (const c of clusterOf(bars, 0.6)) {
    const cageBars = c.filter(b => { const s = [...b.d].sort((x, y) => x - y); return s[0] >= 0.3 && s[1] <= 0.55; });
    const bx = bboxOf(c), size = [0, 1, 2].map(k => bx.max[k] - bx.min[k]);
    if (c.length >= 6 && cageBars.length >= c.length * 0.6 && Math.max(...size) < 9) {
      const region = { min: bx.min.map(v => v - 0.3), max: bx.max.map(v => v + 0.3) };
      for (const b of list) if (!b.action && b.min.every((v, k) => v >= region.min[k]) && b.max.every((v, k) => v <= region.max[k])) b.action = 'remove';
      stats.gradesSoltasRemovidas = (stats.gradesSoltasRemovidas || 0) + 1;
    }
  }

  // 2) guarda-corpos: fileiras de balaústres verticais -> placa sólida de 1 mm, mesma altura e comprimento
  const verts = list.filter(b => b.isVertical && !b.action);
  const levels = []; // agrupa por andar (base do balaústre)
  for (const b of [...verts].sort((p, q) => p.min[2] - q.min[2])) { const lv = levels.find(l => Math.abs(l.z - b.min[2]) < 1.2); if (lv) lv.items.push(b); else levels.push({ z: b.min[2], items: [b] }); }
  const used = new Set();
  for (const lv of levels) for (const axis of [0, 1]) { // fileiras ao longo de X (mesmo Y) e ao longo de Y (mesmo X)
    const other = 1 - axis, rows = [];
    for (const b of [...lv.items].sort((p, q) => p.c[other] - q.c[other])) { const r = rows.find(r => Math.abs(r.at - b.c[other]) < 0.3); if (r) r.items.push(b); else rows.push({ at: b.c[other], items: [b] }); }
    for (const r of rows) {
      const its = r.items.sort((p, q) => p.c[axis] - q.c[axis]);
      let run = [its[0]];
      const flush = () => {
        if (run.length >= 3) {
          const bx = bboxOf(run), lo = [...bx.min], hi = [...bx.max];
          lo[other] = r.at - T1 / 2; hi[other] = r.at + T1 / 2;
          panels.push(L.box(lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]));
          run.forEach(b => used.add(b)); stats.guardaCorposSolidos++;
        }
      };
      for (let i = 1; i < its.length; i++) { if (its[i].c[axis] - its[i - 1].c[axis] <= 3) run.push(its[i]); else { flush(); run = [its[i]]; } }
      flush();
    }
  }
  verts.forEach(b => { b.action = 'remove'; });

  // 3) venezianas (pilhas de ripas) -> painel sólido; barras horizontais isoladas (peitoris, pingadeiras) -> removidas
  const rest = list.filter(b => b.isBar && !b.action);
  for (const c of clusterOf(rest, 0.6)) {
    const bx = bboxOf(c), size = [0, 1, 2].map(k => bx.max[k] - bx.min[k]);
    const thinH = size[0] < 3 ? 0 : size[1] < 3 ? 1 : -1;
    if (c.length >= 4 && thinH >= 0 && size[2] >= 3) {
      const lo = [...bx.min], hi = [...bx.max], mid = (lo[thinH] + hi[thinH]) / 2, t = Math.max(T1, size[thinH]);
      lo[thinH] = mid - t / 2; hi[thinH] = mid + t / 2;
      panels.push(L.box(lo[0], hi[0], lo[1], hi[1], lo[2], hi[2])); stats.paineisSolidos++;
    } else stats.barrasRemovidas += c.length;
    c.forEach(b => { b.action = 'remove'; });
  }

  // 4) demais peças
  for (const b of list) {
    if (b.action) continue;
    const order = [0, 1, 2].sort((a, c) => b.d[a] - b.d[c]), [t, , l] = order.map(k => b.d[k]);
    const horizMin = Math.min(b.d[0], b.d[1]), horizMax = Math.max(b.d[0], b.d[1]);
    if (l < PREPARO.minPeca) { b.action = 'remove'; stats.removidasPoeira++; }
    // peitoris e pingadeiras: placas horizontais estreitas (até 25 cm reais de profundidade) e finíssimas
    else if (b.d[2] < 0.5 && horizMin < 2.5 && horizMax >= 3) { b.action = 'remove'; stats.peitorisRemovidos = (stats.peitorisRemovidos || 0) + 1; }
    else if (t < T1) { b.action = 'thicken'; b.axis = order[0]; b.center = b.c[order[0]]; b.factor = t > 1e-4 ? T1 / t : null; stats.engrossadas++; }
    else { b.action = 'keep'; stats.mantidas++; }
  }
  // aplica: placas finas (inclusive as de espessura zero) viram placas de 1 mm
  const Pn = new Float32Array(P);
  const zeroThick = new Map(); // componente plano: duplica em "caixa" depois
  for (let v = 0; v < Vn; v++) { const b = comps.get(f(v)); if (b.action !== 'thicken') continue;
    if (b.factor) Pn[v * 3 + b.axis] = b.center + (P[v * 3 + b.axis] - b.center) * b.factor; else zeroThick.set(f(v), b); }
  const out = [];
  const extra = []; // placas de espessura zero viram caixas de 1 mm
  for (let t = 0; t < I.length; t += 3) { const b = comps.get(f(I[t])); if (b.action === 'remove') continue; if (b.action === 'thicken' && !b.factor) continue;
    for (let j = 0; j < 3; j++) { const v = I[t + j]; out.push(Pn[v * 3], Pn[v * 3 + 1], Pn[v * 3 + 2]); } }
  for (const b of zeroThick.values()) { const lo = [...b.min], hi = [...b.max]; lo[b.axis] = b.center - PREPARO.minPlaca / 2; hi[b.axis] = b.center + PREPARO.minPlaca / 2; extra.push(L.box(lo[0], hi[0], lo[1], hi[1], lo[2], hi[2])); }
  extra.push(...panels);
  const building = new THREE.BufferGeometry(); building.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return { building, extra, stats };
}
