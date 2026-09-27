/* Downtown Toronto around the tower — procedural, but laid out the way the
 * real site is. The rail corridor runs east-west just north of the tower,
 * the Rogers Centre sits against it to the west, the Gardiner and the lake
 * are to the south, the financial district peaks to the north-east, and
 * Billy Bishop airport is on the islands out in the harbour.
 *
 * x is east, z is south, 1 unit is a metre. The tower stands at the origin.
 */

import * as THREE from "three";
import type { Phases } from "../timeline";
import { Lines, growOf } from "./lines";
import { U, look, inject, rng, clayInstances, lerp, clamp01 } from "./kit";

export const SHORE = 380;
const EXT = 1800; // detailed city half-width
const NORTH = -1800;

type Rect = { x0: number; z0: number; x1: number; z1: number };
type Road = Rect & { major?: boolean; glow: number };

const inRect = (x: number, z: number, r: Rect, pad = 0) =>
  x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;

const RAIL: Rect = { x0: -EXT, z0: -170, x1: EXT, z1: -78 };
const GARDINER_Z = 150;
const ROGERS = { x: -215, z: 32, r: 104 };
const RIPLEYS: Rect = { x0: 70, z0: 42, x1: 165, z1: 108 };
const ROUNDHOUSE: Rect = { x0: -104, z0: 12, x1: -58, z1: 128 };
export const RUNWAY = { x: -820, z: 1135, len: 1216, w: 45, rot: -0.09 };

export const ISLAND: [number, number][] = [
  [-1560, 1010], [-1180, 975], [-760, 1000], [-300, 1040], [260, 1070],
  [820, 1030], [1320, 1090], [1420, 1210], [1250, 1330], [700, 1420],
  [60, 1470], [-620, 1440], [-1180, 1390], [-1540, 1290],
];

/* ---------------------------------------------------------------- */

export interface City {
  group: THREE.Group;
  update(ph: Phases, t: number): void;
}

export function buildCity(lines: Lines): City {
  const R = rng(1976);
  const group = new THREE.Group();

  /* ---------- street grid ---------- */
  const xs: number[] = [];
  for (let x = -EXT; x < EXT; x += 104 + R() * 52) xs.push(Math.round(x));
  const zNorth = [-178];
  while (zNorth[zNorth.length - 1] > NORTH + 60) zNorth.push(zNorth[zNorth.length - 1] - (92 + R() * 26));

  const roads: Road[] = [];
  const hRoad = (z: number, w: number, x0 = -EXT, x1 = EXT, glow = 1) =>
    roads.push({ x0, x1, z0: z - w / 2, z1: z + w / 2, glow });
  const vRoad = (x: number, w: number, z0: number, z1: number, glow = 1) =>
    roads.push({ x0: x - w / 2, x1: x + w / 2, z0, z1, glow });

  zNorth.forEach((z, i) => hRoad(z, i % 3 === 0 ? 24 : 17, -EXT, EXT, i % 3 === 0 ? 1.3 : 1));
  xs.forEach((x, i) => vRoad(x, i % 4 === 0 ? 24 : 16, NORTH, -178, i % 4 === 0 ? 1.3 : 1));
  // south of the tracks the grid thins out
  hRoad(-66, 18);
  hRoad(GARDINER_Z, 34, -EXT, EXT, 1.8); // Lake Shore, under the Gardiner
  hRoad(262, 14, -EXT, EXT, 0.8);
  hRoad(SHORE - 16, 20, -EXT, EXT, 1.2); // Queens Quay
  xs.forEach((x, i) => {
    if (i % 2 === 0 && Math.abs(x) > 90 && Math.abs(x - ROGERS.x) > ROGERS.r + 20) vRoad(x, 16, -78, GARDINER_Z);
    vRoad(x, 14, GARDINER_Z, SHORE - 16, 0.8);
  });
  vRoad(-22, 14, 70, GARDINER_Z); // Bremner, roughly, and the tower's drive
  hRoad(70, 12, -110, 40);

  const onRoad = (r: Rect) => roads.some((rd) => r.x0 < rd.x1 && r.x1 > rd.x0 && r.z0 < rd.z1 && r.z1 > rd.z0);

  /* ---------- lots ---------- */
  interface B {
    x: number; z: number; w: number; d: number; h: number;
    y0: number; delay: number; color: THREE.Color; lines: boolean;
  }
  const blds: B[] = [];
  const trees: { x: number; z: number; s: number }[] = [];

  const palette = ["#8e9aa6", "#a9a39a", "#6f7b86", "#c4bcae", "#5b6570", "#9aa3a0", "#b8ad9c", "#7d8a94", "#8d6a58", "#a4aeb5"].map(
    (c) => new THREE.Color(c)
  );

  const reserved = (x: number, z: number, pad = 0) =>
    Math.hypot(x, z) < 64 + pad ||
    Math.hypot(x - ROGERS.x, z - ROGERS.z) < ROGERS.r + 14 + pad ||
    inRect(x, z, RIPLEYS, pad) ||
    inRect(x, z, ROUNDHOUSE, pad) ||
    inRect(x, z, RAIL, pad) ||
    Math.abs(z - GARDINER_Z) < 22 + pad;

  function heightAt(x: number, z: number): number {
    const r = R();
    if (z < -170) {
      // financial district peaks around Bay & King
      const core = Math.exp(-(((x - 470) / 300) ** 2 + ((z + 520) / 240) ** 2));
      let h = 10 + r * 22 + core * (90 + R() * 170);
      if (R() < 0.05) h = Math.max(h, 60 + R() * 80); // condos, everywhere
      if (z < -1150) h *= 0.7;
      return h;
    }
    if (z < GARDINER_Z) {
      if (x < -330) return R() < 0.5 ? 70 + r * 90 : 14 + r * 20; // CityPlace
      if (x > 130) return R() < 0.5 ? 80 + r * 100 : 18 + r * 24; // South Core
      return 12 + r * 14;
    }
    return R() < 0.3 ? 40 + r * 70 : 12 + r * 24; // waterfront
  }

  function addBuilding(cx: number, cz: number, w: number, d: number, h: number, withLines = true) {
    const dist = Math.hypot(cx, cz);
    const delay = 0.04 + 0.5 * clamp01(dist / 1900) + R() * 0.1;
    const color = palette[Math.floor(R() * palette.length)];
    if (h > 58 && w > 26 && d > 26) {
      const ph = 10 + R() * 12;
      blds.push({ x: cx, z: cz, w, d, h: ph, y0: 0, delay, color: palette[3], lines: withLines });
      const tw = Math.min(w * (0.45 + R() * 0.3), 42);
      const td = Math.min(d * (0.45 + R() * 0.3), 42);
      const ox = (R() - 0.5) * (w - tw) * 0.6;
      const oz = (R() - 0.5) * (d - td) * 0.6;
      blds.push({ x: cx + ox, z: cz + oz, w: tw, d: td, h: h - ph, y0: ph, delay: delay + 0.06, color, lines: withLines });
    } else {
      blds.push({ x: cx, z: cz, w, d, h, y0: 0, delay, color, lines: withLines });
    }
  }

  function fillBlock(b: Rect) {
    const w = b.x1 - b.x0;
    const d = b.z1 - b.z0;
    if (w < 24 || d < 24) return;
    if (reserved((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2)) return;

    // an occasional block is a park
    if (R() < 0.06 && b.z1 < -170) {
      for (let i = 0; i < (w * d) / 500; i++) {
        trees.push({ x: b.x0 + 6 + R() * (w - 12), z: b.z0 + 6 + R() * (d - 12), s: 0.8 + R() * 0.6 });
      }
      return;
    }

    const nx = w > 120 ? 3 : w > 70 ? 2 : 1;
    const nz = d > 80 ? 2 : 1;
    const lw = w / nx;
    const ld = d / nz;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        if (R() < 0.22) continue;
        const cx = b.x0 + lw * (i + 0.5);
        const cz = b.z0 + ld * (j + 0.5);
        if (reserved(cx, cz, 4)) continue;
        const bw = lw - 4 - R() * 8;
        const bd = ld - 4 - R() * 8;
        addBuilding(cx, cz, bw, bd, heightAt(cx, cz));
      }
    }
  }

  const bandsZ: [number, number][] = [];
  for (let i = 0; i < zNorth.length - 1; i++) bandsZ.push([zNorth[i + 1], zNorth[i]]);
  bandsZ.push([-66, GARDINER_Z], [GARDINER_Z, 262], [262, SHORE - 16]);

  for (const [za, zb] of bandsZ) {
    for (let i = 0; i < xs.length - 1; i++) {
      const b = { x0: xs[i], x1: xs[i + 1], z0: za, z1: zb };
      // trim the block back from any road running along its edges
      const roadsHere = roads.filter((r) => r.x0 < b.x1 && r.x1 > b.x0 && r.z0 < b.z1 && r.z1 > b.z0);
      for (const r of roadsHere) {
        const hz = r.x1 - r.x0 > r.z1 - r.z0;
        if (hz) {
          if (r.z0 <= b.z0 + 1 && r.z1 > b.z0) b.z0 = r.z1 + 4;
          else if (r.z1 >= b.z1 - 1 && r.z0 < b.z1) b.z1 = r.z0 - 4;
        } else {
          if (r.x0 <= b.x0 + 1 && r.x1 > b.x0) b.x0 = r.x1 + 4;
          else if (r.x1 >= b.x1 - 1 && r.x0 < b.x1) b.x1 = r.x0 - 4;
        }
      }
      // south of the tracks a block can straddle an interior street; split it
      if (onRoad(b) && b.z0 > -170) {
        const mid = roadsHere.find((r) => r.z1 - r.z0 > r.x1 - r.x0 && r.x0 > b.x0 && r.x1 < b.x1);
        if (mid) {
          fillBlock({ ...b, x1: mid.x0 - 4 });
          fillBlock({ ...b, x0: mid.x1 + 4 });
          continue;
        }
      }
      fillBlock(b);
    }
  }

  // Ripley's, low and long
  addBuilding((RIPLEYS.x0 + RIPLEYS.x1) / 2, (RIPLEYS.z0 + RIPLEYS.z1) / 2, 86, 56, 16);
  // Union Station's shed and the Roundhouse
  addBuilding(620, -120, 300, 60, 14);
  for (let i = 0; i < 90; i++) {
    trees.push({ x: lerp(ROUNDHOUSE.x0 + 4, ROUNDHOUSE.x1 - 4, R()), z: lerp(ROUNDHOUSE.z0 + 4, ROUNDHOUSE.z1 - 4, R()), s: 0.7 + R() * 0.6 });
  }
  // the tower's own grounds
  for (let i = 0; i < 40; i++) {
    const a = R() * Math.PI * 2;
    const r = 50 + R() * 12;
    trees.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, s: 0.7 + R() * 0.4 });
  }
  // street trees along Queens Quay
  for (let x = -EXT + 20; x < EXT; x += 18 + R() * 10) trees.push({ x, z: SHORE - 4, s: 0.6 + R() * 0.3 });

  // the sprawl past the edge of the drawing: only ever seen as lights
  const R2 = rng(7);
  for (let i = 0; i < 1400; i++) {
    const a = -Math.PI * (0.02 + R2() * 0.96);
    const r = EXT + 150 + Math.pow(R2(), 0.7) * 3800;
    const x = Math.cos(a) * r * 1.3;
    const z = Math.sin(a) * r * 0.9;
    if (z > SHORE - 40) continue;
    const s = 18 + R2() * 30;
    const tall = R2() < 0.04 ? 40 + R2() * 60 : 6 + R2() * 16;
    blds.push({ x, z, w: s, d: s * (0.6 + R2() * 0.8), h: tall, y0: 0, delay: 0.6 + R2() * 0.1, color: palette[i % palette.length], lines: false });
  }

  /* ---------- buildings: one instanced box ---------- */
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  const bldMat = look("#ffffff", { clay: "#f1ece4", rough: 0.78, metal: 0.1 });
  clayInstances(bldMat);
  const prev = bldMat.onBeforeCompile;
  bldMat.onBeforeCompile = (s, r) => {
    prev(s, r);
    s.uniforms.uNight = U.uNight;
    s.vertexShader = inject(
      "varying vec3 vWP; varying vec3 vWN; varying float vSeed;\n" + s.vertexShader,
      "#include <project_vertex>",
      `#include <project_vertex>
       vec4 wp4 = vec4(transformed, 1.0);
       vec3 wn = objectNormal;
       #ifdef USE_INSTANCING
         wp4 = instanceMatrix * wp4;
         wn = mat3(instanceMatrix) * wn;
         vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
       #else
         vSeed = 0.0;
       #endif
       vWP = (modelMatrix * wp4).xyz;
       vWN = normalize(mat3(modelMatrix) * wn);`
    );
    s.fragmentShader = inject(
      `uniform float uNight;
       varying vec3 vWP; varying vec3 vWN; varying float vSeed;
       float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
       float winMask(out vec2 cell) {
         float side = 1.0 - step(0.5, abs(vWN.y));
         vec2 t2 = normalize(vec2(-vWN.z, vWN.x));
         float u = dot(vWP.xz, t2) / 3.1;
         float v = vWP.y / 3.6;
         cell = vec2(floor(u), floor(v)) + vSeed * 91.0;
         vec2 f = vec2(fract(u), fract(v));
         return side * step(0.16, f.x) * step(f.x, 0.84) * step(0.24, f.y) * step(f.y, 0.86) * step(1.0, v);
       }
      ` + s.fragmentShader,
      "// <clay-colour>",
      `vec2 cell;
       float win = winMask(cell);
       float hv = h21(cell);
       diffuseColor.rgb *= 1.0 - 0.09 * win * (1.0 - uReal);
       diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.065, 0.08) + 0.07 * hv, win * uReal * 0.8);`
    );
    s.fragmentShader = inject(
      s.fragmentShader,
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
       // windows come on one at a time as night deepens, never all of them
       float on = step(h21(cell * 1.73 + 4.1), uNight * 0.3 - 0.02);
       vec3 warm = mix(vec3(1.0, 0.72, 0.42), vec3(1.0, 0.86, 0.62), hv);
       vec3 cool = vec3(0.72, 0.84, 1.0);
       totalEmissiveRadiance += win * on * mix(warm, cool, step(0.82, hv)) * (0.45 + 0.9 * hv) * uNight;`
    );
  };

  const bldMesh = new THREE.InstancedMesh(boxGeo, bldMat, blds.length);
  bldMesh.castShadow = true;
  bldMesh.receiveShadow = true;
  blds.forEach((b, i) => bldMesh.setColorAt(i, b.color));
  group.add(bldMesh);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const vp = new THREE.Vector3();
  const vs = new THREE.Vector3();
  let lastCity = -1;
  function growCity(city: number) {
    if (city === lastCity) return;
    lastCity = city;
    blds.forEach((b, i) => {
      const g = growOf(b.delay, city);
      vp.set(b.x, b.y0 * g, b.z);
      // zero scale until it starts to rise: the footprint lives in the lines
      if (g <= 0) vs.set(0, 0, 0);
      else vs.set(b.w, b.h * g, b.d);
      m4.compose(vp, q, vs);
      bldMesh.setMatrixAt(i, m4);
    });
    bldMesh.instanceMatrix.needsUpdate = true;
    bldMesh.computeBoundingSphere();
  }

  /* building edges, as footprints until they extrude */
  for (const b of blds) {
    if (!b.lines) continue;
    const d0 = 0.06 + 0.26 * clamp01(Math.hypot(b.x, b.z) / 1900);
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
    const yb = b.y0, yt = b.y0 + b.h;
    const c: [number, number][] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = c[k];
      const [bx, bz] = c[(k + 1) % 4];
      const dd = d0 + k * 0.004;
      lines.seg(ax, yb, az, bx, yb, bz, dd, dd + 0.004, b.delay);
      lines.seg(ax, yt, az, bx, yt, bz, dd, dd + 0.004, b.delay);
      lines.seg(ax, yb, az, ax, yt, az, dd, dd, b.delay);
    }
  }

  /* ---------- the ground, painted once to a canvas ---------- */
  const W = 2048;
  const Hh = Math.round((W * (SHORE - NORTH)) / (EXT * 2));
  const px = (x: number) => ((x + EXT) / (EXT * 2)) * W;
  const pz = (z: number) => ((z - NORTH) / (SHORE - NORTH)) * Hh;
  const sc = W / (EXT * 2);

  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = Hh;
  const g2 = cv.getContext("2d")!;
  g2.fillStyle = "#b3aea5";
  g2.fillRect(0, 0, W, Hh);

  const glow = document.createElement("canvas");
  glow.width = W / 2;
  glow.height = Math.round(Hh / 2);
  const e2 = glow.getContext("2d")!;
  e2.fillStyle = "#000";
  e2.fillRect(0, 0, glow.width, glow.height);

  // rail corridor: ballast and a fan of tracks
  g2.fillStyle = "#7d736a";
  g2.fillRect(px(RAIL.x0), pz(RAIL.z0), (RAIL.x1 - RAIL.x0) * sc, (RAIL.z1 - RAIL.z0) * sc);
  g2.strokeStyle = "#5a524b";
  g2.lineWidth = 0.9;
  for (let z = RAIL.z0 + 6; z < RAIL.z1 - 4; z += 7) {
    g2.beginPath();
    g2.moveTo(0, pz(z));
    g2.lineTo(W, pz(z));
    g2.stroke();
  }
  // parks
  g2.fillStyle = "#6f8453";
  g2.fillRect(px(ROUNDHOUSE.x0), pz(ROUNDHOUSE.z0), (ROUNDHOUSE.x1 - ROUNDHOUSE.x0) * sc, (ROUNDHOUSE.z1 - ROUNDHOUSE.z0) * sc);
  // the tower's plaza
  g2.fillStyle = "#cfc8bc";
  g2.beginPath();
  g2.arc(px(0), pz(0), 62 * sc, 0, Math.PI * 2);
  g2.fill();
  g2.fillStyle = "#6f8453";
  g2.beginPath();
  g2.arc(px(0), pz(0), 62 * sc, 0.3, 1.5);
  g2.lineTo(px(0), pz(0));
  g2.fill();
  // Rogers Centre forecourt
  g2.fillStyle = "#c2bcb2";
  g2.beginPath();
  g2.arc(px(ROGERS.x), pz(ROGERS.z), (ROGERS.r + 12) * sc, 0, Math.PI * 2);
  g2.fill();

  for (const r of roads) {
    g2.fillStyle = "#4b4b4d";
    g2.fillRect(px(r.x0), pz(r.z0), (r.x1 - r.x0) * sc, (r.z1 - r.z0) * sc);
    // sidewalks read as a lighter edge
    g2.strokeStyle = "#c9c3b9";
    g2.lineWidth = 0.8;
    g2.strokeRect(px(r.x0), pz(r.z0), (r.x1 - r.x0) * sc, (r.z1 - r.z0) * sc);

    e2.strokeStyle = `rgba(255, 170, 90, ${0.55 * r.glow})`;
    e2.lineWidth = 1.2 * r.glow;
    const hz = r.x1 - r.x0 > r.z1 - r.z0;
    e2.beginPath();
    if (hz) {
      e2.moveTo(px(r.x0) / 2, pz((r.z0 + r.z1) / 2) / 2);
      e2.lineTo(px(r.x1) / 2, pz((r.z0 + r.z1) / 2) / 2);
    } else {
      e2.moveTo(px((r.x0 + r.x1) / 2) / 2, pz(r.z0) / 2);
      e2.lineTo(px((r.x0 + r.x1) / 2) / 2, pz(r.z1) / 2);
    }
    e2.stroke();
  }
  // lane markings on the wide ones
  g2.strokeStyle = "rgba(230, 220, 190, 0.5)";
  g2.lineWidth = 0.5;
  g2.setLineDash([3, 4]);
  for (const r of roads) {
    if (Math.min(r.x1 - r.x0, r.z1 - r.z0) < 20) continue;
    const hz = r.x1 - r.x0 > r.z1 - r.z0;
    g2.beginPath();
    if (hz) {
      g2.moveTo(px(r.x0), pz((r.z0 + r.z1) / 2));
      g2.lineTo(px(r.x1), pz((r.z0 + r.z1) / 2));
    } else {
      g2.moveTo(px((r.x0 + r.x1) / 2), pz(r.z0));
      g2.lineTo(px((r.x0 + r.x1) / 2), pz(r.z1));
    }
    g2.stroke();
  }
  g2.setLineDash([]);
  // rail yard floodlights
  e2.fillStyle = "rgba(255, 210, 150, 0.5)";
  for (let x = -EXT; x < EXT; x += 90) e2.fillRect(px(x) / 2, pz(-124) / 2, 1.5, 1.5);

  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const emap = new THREE.CanvasTexture(glow);
  emap.colorSpace = THREE.SRGBColorSpace;

  const groundMat = look("#ffffff", { clay: "#ffffff", rough: 0.95 });
  groundMat.map = map;
  groundMat.emissiveMap = emap;
  groundMat.emissive.set("#ffffff");
  groundMat.transparent = true;
  groundMat.onBeforeCompile = (s) => {
    s.uniforms.uReal = U.uReal;
    s.uniforms.uNight = U.uNight;
    s.fragmentShader = inject(
      "uniform float uReal; uniform float uNight;\n" + s.fragmentShader,
      "#include <map_fragment>",
      `#include <map_fragment>
       // clay reads the plan as tone only: roads a step darker than lots
       float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
       vec3 clay = mix(vec3(0.80, 0.78, 0.74), vec3(0.93, 0.915, 0.89), smoothstep(0.05, 0.35, lum));
       diffuseColor.rgb = mix(clay, diffuseColor.rgb, uReal);`
    );
    s.fragmentShader = inject(
      s.fragmentShader,
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
       totalEmissiveRadiance *= uNight * 1.3;`
    );
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(EXT * 2, SHORE - NORTH), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, (SHORE + NORTH) / 2);
  ground.receiveShadow = true;
  ground.renderOrder = -2;
  group.add(ground);

  // beyond the drawing, flat land out to the horizon
  const farMat = look("#5f6152", { clay: "#e6e0d6", rough: 1 });
  farMat.transparent = true;
  // a U around the detailed ground rather than a shape with a hole: the
  // hole would share an edge with the outline and the triangulator chokes
  const farShape = new THREE.Shape(
    [
      [-30000, -SHORE], [-EXT, -SHORE], [-EXT, -NORTH], [EXT, -NORTH],
      [EXT, -SHORE], [30000, -SHORE], [30000, 30000], [-30000, 30000],
    ].map(([x, y]) => new THREE.Vector2(x, y))
  );
  const far = new THREE.Mesh(new THREE.ShapeGeometry(farShape), farMat);
  far.rotation.x = -Math.PI / 2;
  far.position.y = -0.05;
  far.receiveShadow = true;
  far.renderOrder = -2;
  group.add(far);

  /* ---------- the Rogers Centre ---------- */
  let stadium: THREE.Group;
  {
    const bowl = new THREE.LatheGeometry(
      [[ROGERS.r + 4, 0], [ROGERS.r + 4, 4], [ROGERS.r + 1, 5], [ROGERS.r, 30], [ROGERS.r - 2, 32]].map(
        ([r, y]) => new THREE.Vector2(r, y)
      ),
      64
    );
    const concreteMat = look("#b1aca3", { clay: "#f0ebe3", rough: 0.85, flat: true });
    const bowlMesh = new THREE.Mesh(bowl, concreteMat);
    const domePts: THREE.Vector2[] = [];
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * (Math.PI / 2);
      domePts.push(new THREE.Vector2(Math.cos(a) * (ROGERS.r - 2), 32 + Math.sin(a) * 54));
    }
    domePts.reverse();
    const dome = new THREE.LatheGeometry(domePts, 48);
    const domeMat = look("#e3e1dc", { clay: "#f6f3ee", rough: 0.4, metal: 0.2, flat: true, side: THREE.DoubleSide });
    const domeMesh = new THREE.Mesh(dome, domeMat);
    // the band of lights under the roof rim
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(ROGERS.r - 1.5, ROGERS.r - 1.5, 2, 64, 1, true),
      look("#f4efe4", { clay: "#e8e2d8", glow: "#ffe7c0", glowAt: 2.2 })
    );
    rim.position.y = 30.5;
    const st = new THREE.Group();
    st.add(bowlMesh, domeMesh, rim);
    st.position.set(ROGERS.x, 0, ROGERS.z);
    for (const m of [bowlMesh, domeMesh]) {
      m.castShadow = m.receiveShadow = true;
    }
    group.add(st);
    st.userData.grow = true;
    stadium = st;
    const mat = new THREE.Matrix4().makeTranslation(ROGERS.x, 0, ROGERS.z);
    const dist = Math.hypot(ROGERS.x, ROGERS.z) / 1900;
    lines.edges(bowl, () => 0.1 + dist * 0.3, { matrix: mat, threshold: 40, delay: 0.1 });
    // ribs, the way the roof panels read from above
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      for (let i = 0; i < domePts.length - 1; i++) {
        const p = domePts[i], n = domePts[i + 1];
        lines.seg(
          ROGERS.x + Math.cos(a) * p.x, p.y, ROGERS.z + Math.sin(a) * p.x,
          ROGERS.x + Math.cos(a) * n.x, n.y, ROGERS.z + Math.sin(a) * n.x,
          0.12 + (i / domePts.length) * 0.08, 0.12 + ((i + 1) / domePts.length) * 0.08,
          0.12
        );
      }
    }
  }

  /* ---------- the Gardiner ---------- */
  const gardinerMat = look("#8e8b86", { clay: "#ece7df", rough: 0.9 });
  const gardiner = new THREE.Group();
  {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(EXT * 2, 1.6, 26), gardinerMat);
    deck.position.set(0, 11, GARDINER_Z);
    deck.castShadow = deck.receiveShadow = true;
    gardiner.add(deck);
    const colGeo = new THREE.BoxGeometry(2.2, 10.2, 2.2);
    const cols = new THREE.InstancedMesh(colGeo, gardinerMat, Math.floor((EXT * 2) / 36) * 2);
    let k = 0;
    for (let x = -EXT + 10; x < EXT - 10 && k < cols.count - 1; x += 36) {
      for (const dz of [-8, 8]) {
        m4.makeTranslation(x, 5.1, GARDINER_Z + dz);
        cols.setMatrixAt(k++, m4);
      }
    }
    cols.count = k;
    cols.castShadow = true;
    gardiner.add(cols);
    lines.seg(-EXT, 11.8, GARDINER_Z - 13, EXT, 11.8, GARDINER_Z - 13, 0.14, 0.3, 0.2);
    lines.seg(-EXT, 11.8, GARDINER_Z + 13, EXT, 11.8, GARDINER_Z + 13, 0.14, 0.3, 0.2);
  }
  group.add(gardiner);

  /* traffic on the Gardiner: white one way, red the other */
  const CARS = 220;
  const carMat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  const cars = new THREE.InstancedMesh(new THREE.BoxGeometry(4.2, 0.8, 1.8), carMat, CARS);
  const carSeed = Array.from({ length: CARS }, () => ({ o: R(), lane: R() < 0.5 ? 1 : -1, v: 22 + R() * 10, j: R() }));
  carSeed.forEach((c, i) => {
    cars.setColorAt(i, c.lane > 0 ? new THREE.Color(5, 4.6, 3.8) : new THREE.Color(4.5, 0.25, 0.15));
  });
  cars.frustumCulled = false;
  group.add(cars);

  /* ---------- GO trains ---------- */
  const trainMat = look("#e6e8e4", { clay: "#f5f2ec", rough: 0.5, glow: "#ffe6bd", glowAt: 0.5 });
  const trainGreen = look("#2d6b3d", { clay: "#ece7de", rough: 0.6 });
  const TRAIN_CARS = 10;
  const trains = [0, 1].map((k) => {
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(25, 4.6, 3.2), trainMat, TRAIN_CARS);
    const stripe = new THREE.InstancedMesh(new THREE.BoxGeometry(25.1, 1.1, 3.3), trainGreen, TRAIN_CARS);
    body.castShadow = true;
    body.frustumCulled = stripe.frustumCulled = false;
    group.add(body, stripe);
    return { body, stripe, z: k === 0 ? -140 : -104, dir: k === 0 ? 1 : -1, phase: k * 0.45 };
  });

  /* ---------- trees ---------- */
  const treeGeo = new THREE.IcosahedronGeometry(1, 0);
  const treeMat = look("#ffffff", { clay: "#f0ebe2", rough: 0.9, flat: true });
  clayInstances(treeMat);
  const treeMesh = new THREE.InstancedMesh(treeGeo, treeMat, trees.length);
  const trunkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.45, 1, 5), look("#5b4a3c", { clay: "#e2dcd2" }), trees.length);
  const greens = ["#56703f", "#627c46", "#4a6538", "#6c8450", "#7b8a4c"].map((c) => new THREE.Color(c));
  trees.forEach((tr, i) => {
    const s = tr.s * 5.5;
    m4.compose(vp.set(tr.x, 4 * tr.s + s * 0.8, tr.z), q.setFromEuler(new THREE.Euler(0, R() * 3, 0)), vs.set(s, s * 1.15, s));
    treeMesh.setMatrixAt(i, m4);
    treeMesh.setColorAt(i, greens[i % greens.length]);
    m4.compose(vp.set(tr.x, 2.5 * tr.s, tr.z), q.identity(), vs.set(1, 5 * tr.s, 1));
    trunkMesh.setMatrixAt(i, m4);
  });
  treeMesh.castShadow = true;
  treeMesh.receiveShadow = true;
  const forest = new THREE.Group();
  forest.add(treeMesh, trunkMesh);
  group.add(forest);

  /* ---------- the islands and Billy Bishop ---------- */
  const islandMat = look("#6d7d52", { clay: "#e9e3d9", rough: 1 });
  const islandShape = new THREE.Shape(ISLAND.map(([x, z]) => new THREE.Vector2(x, -z)));
  const islandGeo = new THREE.ExtrudeGeometry(islandShape, { depth: 1.6, bevelEnabled: false });
  islandGeo.rotateX(-Math.PI / 2);
  const island = new THREE.Mesh(islandGeo, islandMat);
  island.receiveShadow = true;
  group.add(island);
  lines.loop(ISLAND.map(([x, z]) => new THREE.Vector3(x, 1.6, z)), 0.16, 0.28);

  const runwayMat = look("#3e3f41", { clay: "#dcd6cc", rough: 0.9 });
  const runway = new THREE.Mesh(new THREE.BoxGeometry(RUNWAY.len, 0.3, RUNWAY.w), runwayMat);
  runway.position.set(RUNWAY.x, 1.7, RUNWAY.z);
  runway.rotation.y = RUNWAY.rot;
  runway.receiveShadow = true;
  group.add(runway);
  {
    const c = Math.cos(RUNWAY.rot), s = Math.sin(RUNWAY.rot);
    const pt = (u: number, v: number) => new THREE.Vector3(RUNWAY.x + u * c + v * s, 1.9, RUNWAY.z - u * s + v * c);
    const L = RUNWAY.len / 2, Wd = RUNWAY.w / 2;
    lines.loop([pt(-L, -Wd), pt(L, -Wd), pt(L, Wd), pt(-L, Wd)], 0.2, 0.26);
    // centreline
    for (let u = -L + 40; u < L - 40; u += 30) {
      const a = pt(u, 0), b = pt(u + 15, 0);
      lines.seg(a.x, a.y, a.z, b.x, b.y, b.z, 0.26, 0.27);
    }
  }
  // edge lights
  const RL: THREE.Vector3[] = [];
  {
    const c = Math.cos(RUNWAY.rot), s = Math.sin(RUNWAY.rot);
    for (let u = -RUNWAY.len / 2; u <= RUNWAY.len / 2; u += 30) {
      for (const v of [-RUNWAY.w / 2 - 2, RUNWAY.w / 2 + 2]) {
        RL.push(new THREE.Vector3(RUNWAY.x + u * c + v * s, 2.2, RUNWAY.z - u * s + v * c));
      }
    }
  }
  const rlMat = new THREE.MeshBasicMaterial({ color: "#fff" });
  const rlMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1.1, 6, 4), rlMat, RL.length);
  RL.forEach((p, i) => {
    rlMesh.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z));
  });
  group.add(rlMesh);

  // trees on the islands
  const islandTrees = new THREE.InstancedMesh(treeGeo, treeMat, 500);
  {
    let k = 0;
    const poly = ISLAND;
    const inside = (x: number, z: number) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i], [xj, zj] = poly[j];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
      }
      return c;
    };
    while (k < 500) {
      const x = -1500 + R() * 2900;
      const z = 980 + R() * 480;
      if (!inside(x, z)) continue;
      if (x < -120 && Math.abs(z - RUNWAY.z) < 120) continue;
      const s = 4 + R() * 3.5;
      m4.compose(vp.set(x, 1.6 + s, z), q.identity(), vs.set(s, s * 1.2, s));
      islandTrees.setMatrixAt(k, m4);
      islandTrees.setColorAt(k, greens[k % greens.length]);
      k++;
    }
  }
  islandTrees.castShadow = true;
  group.add(islandTrees);

  /* ---------------------------------------------------------------- */
  return {
    group,
    update(ph, t) {
      growCity(ph.city);

      const g = growOf(0.1, ph.city);
      stadium.visible = g > 0.001;
      stadium.scale.set(1, Math.max(0.001, g), 1);
      gardiner.visible = ph.city > 0.2;
      gardiner.scale.set(1, Math.max(0.001, growOf(0.2, ph.city)), 1);

      ground.visible = far.visible = ph.ground > 0.001;
      groundMat.opacity = ph.ground;
      farMat.opacity = ph.ground;
      groundMat.depthWrite = farMat.depthWrite = ph.ground > 0.99;

      forest.visible = islandTrees.visible = ph.detail > 0.01;
      const ts = Math.max(0.001, ph.detail);
      forest.scale.set(1, ts, 1);
      island.visible = runway.visible = ph.ground > 0.01;

      rlMesh.visible = ph.night > 0.01;
      rlMat.color.setRGB(4 * ph.night, 3.2 * ph.night, 2 * ph.night);

      /* traffic, only once it's dark enough to be lights */
      cars.visible = ph.night > 0.02;
      if (cars.visible) {
        carSeed.forEach((c, i) => {
          const x = ((((c.o + (t * c.v) / (EXT * 2)) * c.lane) % 1) + 1) % 1;
          m4.makeTranslation(-EXT + x * EXT * 2, 12.3, GARDINER_Z + c.lane * (3 + c.j * 7));
          cars.setMatrixAt(i, m4);
        });
        cars.instanceMatrix.needsUpdate = true;
        carMat.color.setScalar(ph.night);
      }

      /* trains slide through from 03 on */
      for (const tr of trains) {
        const on = ph.detail > 0.5;
        tr.body.visible = tr.stripe.visible = on;
        if (!on) continue;
        const u = ((t / 70 + tr.phase) % 1) * 2 - 1; // -1..1 across the city and beyond
        const head = u * (EXT + 400) * tr.dir;
        for (let i = 0; i < TRAIN_CARS; i++) {
          const x = head - i * 26 * tr.dir;
          m4.makeTranslation(x, 2.8, tr.z);
          tr.body.setMatrixAt(i, m4);
          m4.makeTranslation(x, 1.6, tr.z);
          tr.stripe.setMatrixAt(i, m4);
        }
        tr.body.instanceMatrix.needsUpdate = true;
        tr.stripe.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
