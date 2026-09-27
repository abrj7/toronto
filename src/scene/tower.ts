/* The CN Tower, built from its section rather than from a mesh.
 *
 * The shaft is a Y: a hexagonal core with a leg on every other face. The
 * legs flare out toward the ground and die into the core just under the
 * main pod, so the whole thing is one loft of an 18-point outline whose
 * leg length shrinks with height. Above the pod it's just the hexagon.
 *
 * Heights follow the real thing: LookOut at 346 m, SkyPod at 447 m, the
 * tip at 553.33 m.
 */

import * as THREE from "three";
import { H, type Phases } from "../timeline";
import { Lines } from "./lines";
import { U, look, inject, lerp, clamp01, easeOutCubic, smooth } from "./kit";

const LEG_TOP = 330;
const LEG_BASE = 31; // leg tip distance from centre at grade
const TAN30 = Math.tan(Math.PI / 6);

/** Distance from the centre to a face of the hexagonal core. */
export function apothem(y: number) {
  if (y <= LEG_TOP) return lerp(7.4, 5.9, y / LEG_TOP);
  return lerp(5.9, 5.0, clamp01((y - LEG_TOP) / (H.shaftTop - LEG_TOP)));
}

function reach(y: number) {
  const ra = apothem(y);
  const t = clamp01(1 - y / LEG_TOP);
  return ra + 1.2 + (LEG_BASE - 7.4 - 1.2) * Math.pow(t, 1.35);
}

/* Legs point north-ish and to either side of the lake; the exposed hex
   faces between them carry the glass elevators. */
const LEG_ANGLES = [0, 1, 2].map((k) => -Math.PI / 2 + (k * 2 * Math.PI) / 3);

/** The 18-point Y outline at height y, in increasing-angle order. */
export function section(y: number, grow = 0): THREE.Vector2[] {
  const ra = apothem(y) + grow;
  const hw = (apothem(y) + grow) * TAN30;
  const L = reach(y) + grow;
  const legLen = L - ra;
  const ht = lerp(hw, hw * 0.78, clamp01(legLen / 6));
  const c = Math.min(1.4, legLen * 0.25);
  const local: [number, number][] = [
    [ra, -hw],
    [L - c, -ht],
    [L, -ht + c],
    [L, ht - c],
    [L - c, ht],
    [ra, hw],
  ];
  const out: THREE.Vector2[] = [];
  for (const phi of LEG_ANGLES) {
    const cs = Math.cos(phi);
    const sn = Math.sin(phi);
    for (const [x, z] of local) out.push(new THREE.Vector2(x * cs - z * sn, x * sn + z * cs));
  }
  return out;
}

function hexSection(y: number): THREE.Vector2[] {
  const r = apothem(y) / Math.cos(Math.PI / 6);
  const out: THREE.Vector2[] = [];
  for (const phi of LEG_ANGLES) {
    for (const d of [-Math.PI / 6, Math.PI / 6]) {
      out.push(new THREE.Vector2(Math.cos(phi + d) * r, Math.sin(phi + d) * r));
    }
  }
  return out;
}

/** Flat-shaded loft through a stack of outlines. */
function loft(levels: number[], outline: (y: number) => THREE.Vector2[]) {
  const pos: number[] = [];
  const rings = levels.map((y) => ({ y, pts: outline(y) }));
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r];
    const B = rings[r + 1];
    const n = A.pts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a0 = A.pts[i], a1 = A.pts[j], b0 = B.pts[i], b1 = B.pts[j];
      // skip slivers where a leg has collapsed onto the core
      if (a0.distanceTo(a1) < 1e-3 && b0.distanceTo(b1) < 1e-3) continue;
      pos.push(
        a0.x, A.y, a0.y, b1.x, B.y, b1.y, a1.x, A.y, a1.y,
        a0.x, A.y, a0.y, b0.x, B.y, b0.y, b1.x, B.y, b1.y
      );
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function range(a: number, b: number, step: number) {
  const out: number[] = [];
  for (let y = a; y < b; y += step) out.push(y);
  out.push(b);
  return out;
}

const lathe = (pts: [number, number][], segs = 96) =>
  new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);

/* ---------------------------------------------------------------- */

export interface Tower {
  group: THREE.Group;
  update(ph: Phases, t: number, dt: number): void;
  /** built height right now, for the readout */
  height: number;
  mastSegments: THREE.Mesh[];
  mastHeights: number[];
  mastBases: number[];
}

export function buildTower(lines: Lines, clip: THREE.Plane): Tower {
  const group = new THREE.Group();

  /* ---------- materials ---------- */
  const concrete = look("#bdb5a8", { clay: "#f2ede5", rough: 0.86 });
  concrete.clippingPlanes = [clip];
  concrete.clipShadows = true;
  concrete.side = THREE.DoubleSide;

  /* The LED wash: the real tower is floodlit from the base and carries
     light up its edges. Stronger low, with a slow band travelling up. */
  concrete.onBeforeCompile = (s) => {
    s.uniforms.uNight = U.uNight;
    s.uniforms.uTime = U.uTime;
    s.uniforms.uLed = U.uLed;
    s.vertexShader = inject(
      "varying float vWY;\n" + s.vertexShader,
      "#include <project_vertex>",
      "#include <project_vertex>\n vWY = (modelMatrix * vec4(transformed, 1.0)).y;"
    );
    s.fragmentShader = inject(
      "uniform float uNight; uniform float uTime; uniform vec3 uLed; varying float vWY;\n" +
        s.fragmentShader,
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
       // floodlit from the foot, with the colour caught hardest where the
       // faces turn away from you — edges glow, flats stay dark concrete
       float base = 0.35 + 0.65 * exp(-vWY / 160.0);
       float rim = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
       float band = pow(0.5 + 0.5 * sin(vWY * 0.022 - uTime * 0.9), 8.0);
       totalEmissiveRadiance += uLed * uNight * (base * (0.08 + 1.15 * rim * rim) + band * 0.4);`
    );
  };

  const podConcrete = look("#cfc9bf", { clay: "#f4f0ea", rough: 0.7, side: THREE.DoubleSide });
  const radome = look("#e9e7e2", {
    clay: "#f7f4ef",
    rough: 0.55,
    flat: true,
    side: THREE.DoubleSide,
    glow: "#ffffff",
    glowAt: 0.1,
  });
  const glass = look("#1b2733", {
    clay: "#dfe0dc",
    rough: 0.1,
    metal: 0.75,
    clayRough: 0.35,
    side: THREE.DoubleSide,
    glow: "#ffc27a",
    glowAt: 1.6,
  });
  const mullionMat = look("#3a3d40", { clay: "#cfcac1", rough: 0.5, metal: 0.4 });
  const steel = look("#c4c7ca", { clay: "#eeeae3", rough: 0.45, metal: 0.55 });
  const red = look("#b8342a", { clay: "#eeeae3", rough: 0.5 });
  const elevGlass = look("#2a3a48", {
    clay: "#e4e4df",
    rough: 0.1,
    metal: 0.6,
    transparent: true,
    opacity: 0.55,
  });
  const cabMat = look("#d9d3c6", { clay: "#f5f1ea", rough: 0.4, glow: "#ffe2b0", glowAt: 3.0 });

  /* ---------- shaft ---------- */
  const lowerLevels = range(0, LEG_TOP, 5);
  const lower = loft(lowerLevels, (y) => section(y));
  const upper = loft(range(LEG_TOP - 4, H.shaftTop - 2, 6), hexSection);

  const shaft = new THREE.Group();
  for (const g of [lower, upper]) {
    const m = new THREE.Mesh(g, concrete);
    m.castShadow = true;
    m.receiveShadow = true;
    shaft.add(m);
  }
  group.add(shaft);

  /* ---------- the ghost: the finished tower, drawn before it exists ---------- */
  const order = (p: THREE.Vector3) =>
    0.3 + 0.64 * (p.y / H.tip) + 0.015 * ((Math.atan2(p.z, p.x) + Math.PI) / (2 * Math.PI));

  lines.edges(lower, order, { threshold: 25 });
  lines.edges(upper, order, { threshold: 25 });

  // section cuts every 30 m, the way a drawing set would slice it
  for (let y = 0; y <= H.shaftTop; y += 30) {
    const pts = (y < LEG_TOP ? section(y) : hexSection(y)).map(
      (v) => new THREE.Vector3(v.x, y, v.y)
    );
    const d = order(new THREE.Vector3(0, y, 0));
    lines.loop(pts, d, d + 0.035);
  }

  // centreline, dashed
  for (let y = -12; y < H.tip + 30; y += 9) {
    lines.seg(0, y, 0, 0, y + 5, 0, order(new THREE.Vector3(0, y, 0)), order(new THREE.Vector3(0, y + 5, 0)));
  }

  /* ---------- base pavilion ---------- */
  let podiumMesh: THREE.Mesh;
  {
    const podium = lathe(
      [
        [0, 0],
        [44, 0],
        [44, 6.5],
        [42, 7.2],
        [0, 7.2],
      ],
      6
    );
    podium.rotateY(Math.PI / 6);
    const m = new THREE.Mesh(podium, podConcrete);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    podiumMesh = m;
    lines.edges(podium, () => 0.3, { threshold: 30 });
  }

  /* ---------- main pod ---------- */
  type Part = { pts: [number, number][]; mat: THREE.Material; segs?: number };
  const POD: Part[] = [
    { pts: [[5.6, 314], [8, 326], [18.5, 336.5], [20.6, 338.6], [20.4, 339.2]], mat: podConcrete },
    {
      pts: [[20.4, 339.2], [22.4, 339.7], [23.9, 341.1], [24.5, 343], [24.2, 344.9], [22.9, 346.3], [20.6, 347]],
      mat: radome,
      segs: 48,
    },
    { pts: [[20.6, 347], [21.9, 352.4]], mat: glass },
    { pts: [[21.9, 352.4], [22.1, 353.2], [21.0, 353.8]], mat: podConcrete },
    { pts: [[21.0, 353.8], [21.7, 357.8]], mat: glass },
    { pts: [[21.7, 357.8], [23.2, 358.4], [23.2, 359.2], [19.5, 359.8], [13.2, 360.2], [13.2, 361.5]], mat: podConcrete },
    { pts: [[13.2, 361.5], [12.9, 364.6]], mat: glass },
    { pts: [[12.9, 364.6], [12.6, 366], [11.2, 367], [6.5, 367.8], [5.4, 368.4]], mat: podConcrete },
  ];

  const podParts: THREE.Mesh[] = [];
  const podOrder = (p: THREE.Vector3) => order(p) + 0.01;
  for (const part of POD) {
    const g = lathe(part.pts, part.segs ?? 96);
    const m = new THREE.Mesh(g, part.mat);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    podParts.push(m);
    lines.edges(g, podOrder, { threshold: 12 });
  }

  // mullions on both glass bands, and panel ribs on the radome
  const mullionGeo = new THREE.BoxGeometry(0.28, 1, 0.5);
  const bands: [number, number, number, number, number][] = [
    // r0, y0, r1, y1, count
    [20.6, 347, 21.9, 352.4, 72],
    [21.0, 353.8, 21.7, 357.8, 72],
    [13.2, 361.5, 12.9, 364.6, 40],
    [8.3, 446.5, 8.7, 451.5, 32],
  ];
  const mullionCount = bands.reduce((s, b) => s + b[4], 0);
  const mullions = new THREE.InstancedMesh(mullionGeo, mullionMat, mullionCount);
  {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    let k = 0;
    for (const [r0, y0, r1, y1, n] of bands) {
      const len = Math.hypot(r1 - r0, y1 - y0);
      const tilt = Math.atan2(r1 - r0, y1 - y0);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = (r0 + r1) / 2 + 0.12;
        e.set(0, -a, -tilt, "YXZ");
        q.setFromEuler(e);
        m4.compose(
          new THREE.Vector3(Math.cos(a) * r, (y0 + y1) / 2, Math.sin(a) * r),
          q,
          new THREE.Vector3(1, len, 1)
        );
        mullions.setMatrixAt(k++, m4);
      }
    }
  }
  mullions.castShadow = true;
  group.add(mullions);

  /* ---------- SkyPod ---------- */
  const SKY: Part[] = [
    { pts: [[5.2, 440], [7.6, 444.6], [8.3, 446.5]], mat: podConcrete },
    { pts: [[8.3, 446.5], [8.7, 451.5]], mat: glass },
    { pts: [[8.7, 451.5], [8.8, 452.3], [8, 453], [5.2, 455.8], [3.9, 458]], mat: podConcrete },
  ];
  const skyParts: THREE.Mesh[] = [];
  for (const part of SKY) {
    const g = lathe(part.pts, 64);
    const m = new THREE.Mesh(g, part.mat);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    skyParts.push(m);
    lines.edges(g, podOrder, { threshold: 12 });
  }

  /* ---------- the mast, in the pieces Olga carried ---------- */
  const mastSegments: THREE.Mesh[] = [];
  const mastHeights: number[] = [];
  const mastBases: number[] = [];
  {
    const spec: [number, number, number][] = []; // rBottom, rTop, height
    for (let i = 0; i < 6; i++) spec.push([lerp(3.4, 2.7, i / 6), lerp(3.4, 2.7, (i + 1) / 6), 6.5]);
    for (let i = 0; i < 6; i++) spec.push([lerp(1.55, 1.05, i / 6), lerp(1.55, 1.05, (i + 1) / 6), 7]);
    const used = spec.reduce((s, x) => s + x[2], 0);
    const rest = (H.tip - H.mastBase - used) / 2;
    spec.push([0.62, 0.48, rest], [0.44, 0.22, rest]);

    let y = H.mastBase;
    spec.forEach(([rb, rt, h], i) => {
      const g = new THREE.CylinderGeometry(rt, rb, h, 20, 1);
      g.translate(0, h / 2, 0);
      // a flange at the joint, which is what the crews actually bolted
      const flange = new THREE.CylinderGeometry(rb * 1.22, rb * 1.22, 0.45, 20);
      flange.translate(0, 0.22, 0);
      const joined = mergeSimple([g, flange]);
      const topBand = i >= spec.length - 3 && i % 2 === 0;
      const m = new THREE.Mesh(joined, topBand ? red : steel);
      m.castShadow = true;
      m.position.y = y;
      group.add(m);
      mastSegments.push(m);
      mastHeights.push(h);
      mastBases.push(y);
      const mat = new THREE.Matrix4().makeTranslation(0, y, 0);
      lines.edges(joined, order, { matrix: mat, threshold: 30 });
      y += h;
    });
  }

  /* ---------- aircraft warning lights ---------- */
  const beaconMat = new THREE.MeshBasicMaterial({ color: "#e9e2d8" });
  const beaconGeo = new THREE.SphereGeometry(0.9, 12, 8);
  const beacons: THREE.Mesh[] = [];
  for (const [y, r] of [
    [H.tip + 0.4, 0],
    [520, 1.3],
    [496, 3.1],
    [360.4, 13.4],
    [459.2, 4.2],
  ] as [number, number][]) {
    const n = r === 0 ? 1 : 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.4;
      const b = new THREE.Mesh(beaconGeo, beaconMat);
      b.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      group.add(b);
      beacons.push(b);
    }
  }

  /* ---------- glass elevators on the three open faces ---------- */
  const elevators: { cab: THREE.Mesh; a: THREE.Vector3; b: THREE.Vector3; phase: number }[] = [];
  const shafts: THREE.Mesh[] = [];
  {
    const top = H.lookout;
    LEG_ANGLES.forEach((phi, k) => {
      const th = phi + Math.PI / 3;
      const dir = new THREE.Vector3(Math.cos(th), 0, Math.sin(th));
      const r0 = apothem(0) + 1.25;
      const r1 = apothem(top) + 1.25;
      const a = dir.clone().multiplyScalar(r0);
      const b = dir.clone().multiplyScalar(r1).setY(top);
      const len = a.distanceTo(b);
      const tilt = Math.atan2(r0 - r1, top);

      const g = new THREE.BoxGeometry(3.4, len, 2.3);
      const m = new THREE.Mesh(g, elevGlass);
      m.position.copy(a).lerp(b, 0.5);
      m.rotation.set(0, -th, tilt, "YXZ");
      group.add(m);
      shafts.push(m);
      lines.edges(g, order, { matrix: m.matrix.clone().compose(m.position, m.quaternion, m.scale) });

      for (let c = 0; c < 2; c++) {
        const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.2, 1.7), cabMat);
        cab.rotation.copy(m.rotation);
        cab.castShadow = true;
        group.add(cab);
        elevators.push({ cab, a, b, phase: k * 0.37 + c * 0.5 });
      }
    });
  }

  /* ---------- slipform deck and its crane ---------- */
  const deck = new THREE.Group();
  const deckGeo = new THREE.BufferGeometry();
  const DECK_N = 18;
  deckGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array((DECK_N + 1) * 2 * 3), 3));
  {
    const idx: number[] = [];
    const c0 = DECK_N; // top centre
    const c1 = DECK_N * 2 + 1; // bottom centre
    for (let i = 0; i < DECK_N; i++) {
      const j = (i + 1) % DECK_N;
      idx.push(c0, j, i); // top
      idx.push(c1, DECK_N + 1 + i, DECK_N + 1 + j); // bottom
      idx.push(i, j, DECK_N + 1 + j, i, DECK_N + 1 + j, DECK_N + 1 + i); // side
    }
    deckGeo.setIndex(idx);
  }
  const deckMat = look("#6f6a62", { clay: "#e2dcd2", rough: 0.9, side: THREE.DoubleSide });
  const deckMesh = new THREE.Mesh(deckGeo, deckMat);
  deckMesh.castShadow = true;
  deck.add(deckMesh);

  const crane = new THREE.Group();
  const craneMat = look("#d9a520", { clay: "#e7e1d6", rough: 0.6 });
  const mast = new THREE.Mesh(new THREE.BoxGeometry(1.6, 26, 1.6), craneMat);
  mast.position.y = 13;
  const jib = new THREE.Group();
  jib.position.y = 26;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(38, 1.3, 1.3), craneMat);
  arm.position.x = 13;
  const counter = new THREE.Mesh(new THREE.BoxGeometry(10, 1.3, 1.3), craneMat);
  counter.position.x = -6;
  const weight = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 2), deckMat);
  weight.position.set(-9.5, -1.6, 0);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.2), craneMat);
  cabin.position.set(1.4, -1.4, 0);
  const peak = new THREE.Mesh(new THREE.ConeGeometry(0.9, 6, 4), craneMat);
  peak.position.y = 3.6;
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.1, 14, 0.1), deckMat);
  hook.position.set(24, -7, 0);
  jib.add(arm, counter, weight, cabin, peak, hook);
  crane.add(mast, jib);
  for (const o of [mast, arm, counter, cabin, peak]) o.castShadow = true;
  deck.add(crane);
  group.add(deck);

  /* ---------- update ---------- */
  const tmp = new THREE.Vector3();
  const state: Tower = {
    group,
    height: 0,
    mastSegments,
    mastHeights,
    mastBases,
    update(ph, t) {
      /* 02: concrete climbs through the ghost */
      const yGrow = ph.shaft * H.shaftTop;
      clip.constant = ph.shaft >= 1 ? 1e5 : yGrow;
      shaft.visible = ph.shaft > 0;
      // the pavilion comes up with the first lift of concrete
      const pk = clamp01(ph.shaft * 12);
      podiumMesh.visible = pk > 0;
      podiumMesh.scale.set(1, Math.max(0.001, pk), 1);

      const pouring = ph.shaft > 0 && ph.shaft < 1;
      deck.visible = pouring;
      if (pouring) {
        const y = yGrow;
        const outline = y < LEG_TOP ? section(y, 1.6) : hexSection(y).map((v) => v.multiplyScalar(1.3));
        const p = deckGeo.getAttribute("position") as THREE.BufferAttribute;
        outline.forEach((v, i) => {
          p.setXYZ(i, v.x, y + 1.2, v.y);
          p.setXYZ(DECK_N + 1 + i, v.x, y - 1.4, v.y);
        });
        // hex has 6 points, the Y has 18 — pad by repeating the last
        for (let i = outline.length; i < DECK_N; i++) {
          const v = outline[outline.length - 1];
          p.setXYZ(i, v.x, y + 1.2, v.y);
          p.setXYZ(DECK_N + 1 + i, v.x, y - 1.4, v.y);
        }
        p.setXYZ(DECK_N, 0, y + 1.2, 0);
        p.setXYZ(DECK_N * 2 + 1, 0, y - 1.4, 0);
        p.needsUpdate = true;
        deckGeo.computeVertexNormals();
        deckGeo.computeBoundingSphere();
        crane.position.y = y + 1.2;
        jib.rotation.y = t * 0.25;
      }

      /* the pod opens out of the shaft, part by part, bottom first */
      podParts.forEach((m, i) => {
        const k = easeOutCubic(clamp01(ph.pod * 1.6 - i * 0.09));
        m.visible = k > 0.001;
        const s = lerp(0.24, 1, k);
        m.scale.set(s, 1, s);
        m.position.y = (1 - k) * -10;
      });
      const mk = easeOutCubic(clamp01(ph.pod * 1.6 - 0.75));
      mullions.visible = mk > 0.01 && ph.detail > 0;
      mullions.scale.set(1, mk, 1);

      skyParts.forEach((m, i) => {
        const k = easeOutCubic(clamp01(ph.skypod * 1.5 - i * 0.2));
        m.visible = k > 0.001;
        const s = lerp(0.3, 1, k);
        m.scale.set(s, 1, s);
        m.position.y = (1 - k) * -6;
      });

      /* 03: segments appear as Olga sets them down (craft.ts carries the
         one in flight; this just shows the ones already placed) */
      const placed = ph.mast * mastSegments.length;
      mastSegments.forEach((m, i) => {
        m.visible = placed >= i + 0.8;
        if (m.visible) m.position.set(0, mastBases[i], 0);
      });

      for (const s of shafts) s.visible = ph.detail > 0.02;
      for (const e of elevators) {
        e.cab.visible = ph.detail > 0.02;
        if (!e.cab.visible) continue;
        const u = 0.5 - 0.5 * Math.cos(((t / 26 + e.phase) % 1) * Math.PI * 2);
        tmp.copy(e.a).lerp(e.b, smooth(0, 1, u));
        e.cab.position.copy(tmp).setY(tmp.y + 1.7);
      }

      /* beacons: slow red pulse, as on the real one */
      const blink = 0.5 + 0.5 * Math.sin(t * 2.2);
      const n = ph.night;
      beaconMat.color.setRGB(
        lerp(0.82, 6 * (0.25 + 0.75 * blink), n),
        lerp(0.78, 0.25 * blink, n),
        lerp(0.72, 0.18 * blink, n)
      );
      for (const b of beacons) b.visible = ph.mast > 0.99 || b.position.y < H.mastBase;

      const placedTop = mastBases[Math.min(mastBases.length - 1, Math.floor(placed))] ?? H.mastBase;
      state.height =
        ph.mast > 0
          ? Math.min(H.tip, placed >= mastSegments.length ? H.tip : placedTop)
          : ph.skypod > 0.9
            ? H.mastBase
            : ph.pod > 0 && yGrow < 368
              ? Math.max(yGrow, 368 * clamp01(ph.pod * 1.6))
              : yGrow;
    },
  };
  return state;
}

/** Concatenate non-indexed copies of a few geometries. */
function mergeSimple(geos: THREE.BufferGeometry[]) {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    if (!ng.getAttribute("normal")) ng.computeVertexNormals();
    pos.push(...(ng.getAttribute("position").array as Float32Array));
    nor.push(...(ng.getAttribute("normal").array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
