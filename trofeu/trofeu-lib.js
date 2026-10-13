// Funções compartilhadas do troféu: transformar imagens/textos em relevo 3D imprimível.
// Unidades: milímetros (escala de impressão). Z para cima.
import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';

export const PX_PER_MM = 20;      // resolução do traçado: 0,05 mm por pixel
export const MIN_FEATURE_MM = 0.8; // menor traço que imprime bem com bico de 0,4 mm
export const RELIEF_MM = 1.0;      // altura do relevo dos logos

// ---------- imagem -> máscara ----------

/** Desenha uma imagem (PNG/JPG/SVG/ImageBitmap) num canvas com altura alvo em pixels. */
export async function imageToCanvas(source, maxW, maxH) {
  const bmp = source instanceof ImageBitmap ? source : source.type === 'image/svg+xml' ? await svgImage(source) : await createImageBitmap(source);
  const k = Math.min(maxW / bmp.width, maxH / bmp.height);
  const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

/** SVG -> <img> (createImageBitmap não decodifica SVG no Chrome); desenhada em qualquer tamanho sem perder nitidez. */
async function svgImage(blob) {
  // a URL não é revogada: o Chrome redesenha o SVG a partir dela no drawImage
  const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode();
  return img;
}

/**
 * Máscara "tinta" de um canvas. Funciona com logo em fundo transparente ou em fundo sólido:
 * a cor de fundo é estimada pela borda; tinta = pixel opaco e diferente do fundo.
 */
export function canvasToMask(canvas, threshold = 60) {
  const { width: W, height: H } = canvas;
  const d = canvas.getContext('2d').getImageData(0, 0, W, H).data;
  let transparentBorder = 0, n = 0, br = 0, bg = 0, bb = 0;
  const border = (x, y) => { const i = (y * W + x) * 4; n++; if (d[i + 3] < 128) transparentBorder++; else { br += d[i]; bg += d[i + 1]; bb += d[i + 2]; } };
  for (let x = 0; x < W; x++) { border(x, 0); border(x, H - 1); }
  for (let y = 0; y < H; y++) { border(0, y); border(W - 1, y); }
  const useAlpha = transparentBorder > n * 0.5;
  const solid = n - transparentBorder || 1; br /= solid; bg /= solid; bb /= solid;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const a = d[i * 4 + 3];
    if (useAlpha) mask[i] = a >= 128 ? 1 : 0;
    else mask[i] = a >= 128 && Math.hypot(d[i * 4] - br, d[i * 4 + 1] - bg, d[i * 4 + 2] - bb) > threshold ? 1 : 0;
  }
  return { mask, W, H, mode: useAlpha ? 'transparência' : 'cor de fundo' };
}

/** Texto -> máscara, com a fonte da página (precisa estar carregada). */
export function textToMask(lines, pxPerMm = PX_PER_MM) {
  // lines: [{ text, heightMm, weight, family, gapMm }]
  const ctx0 = new OffscreenCanvas(10, 10).getContext('2d');
  const metrics = lines.map(l => { const px = l.heightMm * pxPerMm; ctx0.font = `${l.weight || 800} ${px}px ${l.family || 'sans-serif'}`; const m = ctx0.measureText(l.text); return { px, w: Math.ceil(m.width), asc: m.actualBoundingBoxAscent, desc: m.actualBoundingBoxDescent }; });
  const pad = 4, W = Math.max(...metrics.map(m => m.w)) + pad * 2;
  const H = metrics.reduce((s, m, i) => s + m.asc + m.desc + (i ? (lines[i].gapMm || 1) * pxPerMm : 0), 0) + pad * 2;
  const c = new OffscreenCanvas(Math.ceil(W), Math.ceil(H)), ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
  let y = pad;
  lines.forEach((l, i) => { const m = metrics[i]; if (i) y += (l.gapMm || 1) * pxPerMm; ctx.font = `${l.weight || 800} ${m.px}px ${l.family || 'sans-serif'}`; y += m.asc; ctx.fillText(l.text, W / 2, y); y += m.desc; });
  return canvasToMask(c);
}

// ---------- morfologia (garante traço mínimo) ----------

function dilate(mask, W, H, r) {
  if (r <= 0) return mask;
  const out = new Uint8Array(W * H), offs = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) offs.push([dx, dy]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!mask[y * W + x]) continue;
    for (const [dx, dy] of offs) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) out[ny * W + nx] = 1; }
  }
  return out;
}
function erode(mask, W, H, r) {
  const inv = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) inv[i] = mask[i] ? 0 : 1;
  const d = dilate(inv, W, H, r); const out = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) out[i] = d[i] ? 0 : 1; return out;
}

/** Fração da tinta que é mais fina que o mínimo imprimível (some numa "abertura" morfológica). */
export function thinFraction(mask, W, H, pxPerMm) {
  const r = Math.max(1, Math.round(MIN_FEATURE_MM / 2 * pxPerMm) - 1);
  const opened = dilate(erode(mask, W, H, r), W, H, r);
  let ink = 0, lost = 0; for (let i = 0; i < W * H; i++) { if (mask[i]) { ink++; if (!opened[i]) lost++; } }
  return ink ? lost / ink : 0;
}

/** Engrossa todos os traços em `mm` (de cada lado) e remove ilhas menores que o mínimo. */
export function thicken(mask, W, H, pxPerMm, mm) {
  const m = dilate(mask, W, H, Math.round(mm * pxPerMm));
  // remove "poeira": componentes com área menor que (traço mínimo)²
  const minArea = (MIN_FEATURE_MM * pxPerMm) ** 2, seen = new Uint8Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (!m[s] || seen[s]) continue;
    const stack = [s], comp = []; seen[s] = 1;
    while (stack.length) { const k = stack.pop(); comp.push(k); const x = k % W, y = (k / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const nk = ny * W + nx; if (m[nk] && !seen[nk]) { seen[nk] = 1; stack.push(nk); } } }
    if (comp.length < minArea) comp.forEach(k => { m[k] = 0; });
  }
  return m;
}

// ---------- máscara -> contornos -> formas ----------

/** Contornos fechados (marching squares em bordas de pixel). Área > 0 = contorno externo. */
export function traceMask(mask, W, H) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
  const next = new Map();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inside(x, y)) continue;
    if (!inside(x, y - 1)) next.set(`${x},${y}`, [x + 1, y]);
    if (!inside(x + 1, y)) next.set(`${x + 1},${y}r`, [x + 1, y + 1]);
    if (!inside(x, y + 1)) next.set(`${x + 1},${y + 1}b`, [x, y + 1]);
    if (!inside(x - 1, y)) next.set(`${x},${y + 1}l`, [x, y]);
  }
  const starts = new Map();
  for (const k of next.keys()) { const from = k.replace(/[rbl]$/, ''); if (!starts.has(from)) starts.set(from, []); starts.get(from).push(k); }
  const visited = new Set(), loops = [];
  for (const k0 of next.keys()) {
    if (visited.has(k0)) continue;
    const loop = []; let k = k0;
    while (k && !visited.has(k)) {
      visited.add(k); const to = next.get(k); loop.push(k.replace(/[rbl]$/, '').split(',').map(Number));
      const c = (starts.get(to.join(',')) || []).filter(kk => !visited.has(kk)); k = c.length ? c[0] : null;
    }
    if (loop.length >= 8) loops.push(loop);
  }
  const dp = (pts, eps) => { if (pts.length < 3) return pts; const a = pts[0], b = pts[pts.length - 1]; let md = 0, mi = 0; for (let i = 1; i < pts.length - 1; i++) { const p = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, d = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / L; if (d > md) { md = d; mi = i; } } return md > eps ? dp(pts.slice(0, mi + 1), eps).slice(0, -1).concat(dp(pts.slice(mi), eps)) : [a, b]; };
  const area = l => { let s = 0; for (let i = 0; i < l.length; i++) { const [x1, y1] = l[i], [x2, y2] = l[(i + 1) % l.length]; s += x1 * y2 - x2 * y1; } return s / 2; };
  return loops.map(l => { const h = Math.floor(l.length / 2); const p = dp(l.slice(0, h + 1), 0.7).slice(0, -1).concat(dp(l.slice(h).concat([l[0]]), 0.7).slice(0, -1)); return { pts: p, area: area(p) }; }).filter(l => l.pts.length >= 3);
}

/** Contornos (px, y para baixo) -> THREE.Shape (unidades do desenho, y para cima), com furos. */
export function loopsToShapes(loops) {
  const inPoly = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c; } return c; };
  const outers = loops.filter(l => l.area > 0), holes = loops.filter(l => l.area < 0);
  return outers.map(o => {
    const s = new THREE.Shape(o.pts.map(([x, y]) => new THREE.Vector2(x, -y)));
    // o furo pertence ao menor contorno externo que o contém
    for (const h of holes) { const owners = outers.filter(oo => inPoly(h.pts[0], oo.pts)); if (owners.length && owners.sort((a, b) => a.area - b.area)[0] === o) s.holes.push(new THREE.Path(h.pts.map(([x, y]) => new THREE.Vector2(x, -y)))); }
    return s;
  });
}

export function shapesBounds(shapes) {
  const a = [1e9, 1e9, -1e9, -1e9];
  shapes.forEach(s => s.getPoints().forEach(p => { a[0] = Math.min(a[0], p.x); a[1] = Math.min(a[1], p.y); a[2] = Math.max(a[2], p.x); a[3] = Math.max(a[3], p.y); }));
  return a;
}

/**
 * Extruda formas e as coloca numa face: cabem em `fit` [larguraMm, alturaMm] (mantém proporção),
 * centradas em `center`; h/v = direções horizontal/vertical da face; out = normal para fora.
 * `embed` mm entram na peça para colar no volume.
 */
export function reliefOnFace(shapes, { fit, center, h, v, out, depth = RELIEF_MM, embed = 0.4 }) {
  const [x0, y0, x1, y1] = shapesBounds(shapes);
  const k = Math.min(fit[0] / (x1 - x0), fit[1] / (y1 - y0)), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const g = new THREE.ExtrudeGeometry(shapes, { depth: depth + embed, bevelEnabled: false, curveSegments: 1 }).toNonIndexed();
  const p = g.attributes.position, tmp = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const a = (p.getX(i) - cx) * k, b = (p.getY(i) - cy) * k, w = p.getZ(i) - embed;
    tmp.copy(center).addScaledVector(h, a).addScaledVector(v, b).addScaledVector(out, w); p.setXYZ(i, tmp.x, tmp.y, tmp.z);
  }
  const det = new THREE.Matrix3().set(h.x, v.x, out.x, h.y, v.y, out.y, h.z, v.z, out.z).determinant();
  if (det < 0) flipWinding(g.attributes.position.array);
  return { geometry: positionsOnly(g), size: [(x1 - x0) * k, (y1 - y0) * k] };
}

/** Moldura retangular de cantos arredondados (para o espaço do logo da imobiliária). */
export function frameShape(w, hgt, stroke, radius) {
  const rr = (W, H, r) => { const s = new THREE.Shape(); const x = -W / 2, y = -H / 2; s.moveTo(x + r, y); s.lineTo(x + W - r, y); s.absarc(x + W - r, y + r, r, -Math.PI / 2, 0); s.lineTo(x + W, y + H - r); s.absarc(x + W - r, y + H - r, r, 0, Math.PI / 2); s.lineTo(x + r, y + H); s.absarc(x + r, y + H - r, r, Math.PI / 2, Math.PI); s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5); return s; };
  const outer = rr(w, hgt, radius), inner = rr(w - 2 * stroke, hgt - 2 * stroke, Math.max(0.5, radius - stroke));
  outer.holes.push(new THREE.Path(inner.getPoints(8).reverse()));
  return [outer];
}

// ---------- placas encaixáveis ----------

export const PLATE_T = 1.6;        // mm: espessura do fundo da placa (= profundidade do rebaixo)
export const PLATE_GAP = 0.2;      // mm: folga de encaixe por lado
export const PLATE_R = 3;          // mm: raio dos cantos

export function roundedRect(w, h, r, cx = 0, cy = 0) {
  const s = new THREE.Shape(), x = cx - w / 2, y = cy - h / 2; r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0); s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2); s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  return s;
}

/** Leva pontos do sistema "plano" (x, y, z) para uma face: origem em `center`, x->h, y->v, z->out. */
export function mapToFace(geom, center, h, v, out) {
  const p = geom.attributes.position, t = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { const a = p.getX(i), b = p.getY(i), c = p.getZ(i); t.copy(center).addScaledVector(h, a).addScaledVector(v, b).addScaledVector(out, c); p.setXYZ(i, t.x, t.y, t.z); }
  const det = new THREE.Matrix3().set(h.x, v.x, out.x, h.y, v.y, out.y, h.z, v.z, out.z).determinant();
  if (det < 0) flipWinding(p.array);
  return geom;
}

/**
 * Camada externa de uma face com rebaixos: retângulo (w × h) com furos arredondados, espessura `depth`
 * para dentro da peça. holes: [{ cx, cy, w, h }] no sistema da face (centro da face = 0,0).
 */
export function slabWithPockets(w, h, holes, depth, center, hAx, vAx, out) {
  const s = new THREE.Shape(); s.moveTo(-w / 2, -h / 2); s.lineTo(w / 2, -h / 2); s.lineTo(w / 2, h / 2); s.lineTo(-w / 2, h / 2); s.closePath();
  for (const o of holes) s.holes.push(new THREE.Path(roundedRect(o.w + 2 * PLATE_GAP, o.h + 2 * PLATE_GAP, PLATE_R + PLATE_GAP, o.cx, o.cy).getPoints(10)));
  const g = positionsOnly(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 10 }));
  g.translate(0, 0, -depth); // de -depth (dentro) até 0 (face externa)
  return mapToFace(g, center, hAx, vAx, out);
}

/**
 * Placa plana para imprimir deitada: fundo arredondado (0..PLATE_T) + conteúdos em relevo.
 * items: [{ mask, fit: [w, h], at: [x, y] }] em mm, relativos ao centro da placa.
 * Retorna { tile, relief, thin } em coordenadas de impressão (Z para cima, fundo em Z = 0).
 */
export function makePlate(w, h, items, { thickenMm = 0.08 } = {}) {
  const tile = positionsOnly(new THREE.ExtrudeGeometry(roundedRect(w, h, PLATE_R), { depth: PLATE_T, bevelEnabled: false, curveSegments: 10 }));
  const reliefs = [], thin = [];
  for (const it of items) {
    const r = maskToRelief(it.mask, it.fit, { center: new THREE.Vector3(it.at[0], it.at[1], PLATE_T), h: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0), out: new THREE.Vector3(0, 0, 1) }, { thickenMm: it.thickenMm ?? thickenMm });
    reliefs.push(r.geometry); thin.push({ thinAfter: r.thinAfter, size: r.size });
  }
  return { tile, relief: merge(reliefs), thin };
}

/** Cópia de uma placa encaixada no rebaixo (para a prévia e para o "troféu montado"). */
export function placeInPocket(geom, pocket) {
  const g = geom.clone();
  const c = new THREE.Vector3(...pocket.center).addScaledVector(new THREE.Vector3(...pocket.out), -PLATE_T);
  return mapToFace(g, c, new THREE.Vector3(...pocket.h), new THREE.Vector3(...pocket.v), new THREE.Vector3(...pocket.out));
}

// ---------- utilidades de malha ----------

export function flipWinding(a) { for (let i = 0; i < a.length; i += 9) for (let j = 0; j < 3; j++) { const t = a[i + 3 + j]; a[i + 3 + j] = a[i + 6 + j]; a[i + 6 + j] = t; } }

export function positionsOnly(g) {
  const n = g.index ? g.toNonIndexed() : g;
  const q = new THREE.BufferGeometry(); q.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n.attributes.position.array), 3)); return q;
}

export function merge(geoms) { return BGU.mergeGeometries(geoms.map(positionsOnly)); }

export function box(x0, x1, y0, y1, z0, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return positionsOnly(g);
}

export function toSTL(geometry) { return new STLExporter().parse(new THREE.Mesh(geometry), { binary: true }); }

/** Imagem/texto -> relevo pronto: máscara, checagem de traço fino, engrossamento, contorno, extrusão. */
export function maskToRelief(m, fitMm, place, { thickenMm = 0.08 } = {}) {
  // a escala real (px por mm) depende do encaixe; reamostra a máscara para PX_PER_MM no tamanho final
  const k = Math.min(fitMm[0] / m.W, fitMm[1] / m.H) * PX_PER_MM; // px finais por px originais
  const W = Math.max(2, Math.round(m.W * k)), H = Math.max(2, Math.round(m.H * k));
  const r = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) r[y * W + x] = m.mask[Math.min(m.H - 1, Math.floor(y / k)) * m.W + Math.min(m.W - 1, Math.floor(x / k))];
  const thinBefore = thinFraction(r, W, H, PX_PER_MM);
  const t = thicken(r, W, H, PX_PER_MM, thickenMm);
  const thinAfter = thinFraction(t, W, H, PX_PER_MM);
  // margem de 1 px para os contornos fecharem
  const W2 = W + 2, H2 = H + 2, pm = new Uint8Array(W2 * H2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) pm[(y + 1) * W2 + x + 1] = t[y * W + x];
  const shapes = loopsToShapes(traceMask(pm, W2, H2));
  const rel = reliefOnFace(shapes, { fit: fitMm, ...place });
  return { ...rel, thinBefore, thinAfter, shapes: shapes.length };
}
