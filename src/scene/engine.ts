/* Wires the scene together and runs it.
 *
 * The page owns the UI; this owns the canvas, the clock and progress. The
 * page talks to it through the small handle createEngine returns, and hears
 * back through onFrame — once a frame, so the scrubber can follow without
 * React re-rendering sixty times a second.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { END, H, STAGE_SECONDS, phases } from "../timeline";
import { U, driveLooks, lerp, smooth, looks } from "./kit";
import { Lines, lineMaterial } from "./lines";
import { buildTower } from "./tower";
import { buildCity } from "./city";
import { buildSky } from "./sky";
import { buildCraft } from "./craft";

export type View = "orbit" | "elevation" | "plan";

export interface Engine {
  play(): void;
  pause(): void;
  seek(p: number): void;
  setView(v: View): void;
  /** hand the camera back to the choreography after the user orbited */
  follow(): void;
  /** jump the camera straight to its pose instead of easing there */
  snap(): void;
  /** run one frame now — for tooling, when the tab isn't being painted */
  tick(): void;
  dispose(): void;
}

interface Hooks {
  onFrame(p: number, height: number, playing: boolean): void;
  onManual(manual: boolean): void;
}

/* Camera choreography, one key per beat. Interpolated as a Catmull-Rom
   spline over progress, so the camera never stops dead on a key. */
const KEYS: { p: number; pos: [number, number, number]; tgt: [number, number, number] }[] = [
  { p: 0.0, pos: [-1100, 1250, 1350], tgt: [0, 120, 0] },
  { p: 0.9, pos: [-1150, 800, 1400], tgt: [0, 210, 0] },
  { p: 1.5, pos: [-1050, 620, 1350], tgt: [0, 240, 0] },
  { p: 2.05, pos: [-430, 560, 470], tgt: [0, 445, 0] },
  { p: 2.55, pos: [-120, 600, 560], tgt: [0, 470, 0] },
  { p: 3.0, pos: [420, 560, 880], tgt: [0, 380, 0] },
  { p: 3.45, pos: [800, 300, 1900], tgt: [0, 240, 0] },
  { p: 4.0, pos: [450, 150, 2000], tgt: [0, 230, 0] },
];

const LABELS: { y: number; text: string; sub: string }[] = [
  { y: H.tip, text: "553.33", sub: "tip of mast" },
  { y: H.skypod, text: "447.00", sub: "skypod" },
  { y: H.lookout, text: "346.00", sub: "lookout" },
  { y: 0, text: "±0.00", sub: "grade" },
];

export function createEngine(host: HTMLElement, labelHost: HTMLElement, hooks: Hooks): Engine {
  /* ---------- renderer ---------- */
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  const dpr = Math.min(window.devicePixelRatio, 1.75);
  renderer.setPixelRatio(dpr);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(30, 1, 2, 90000);
  camera.position.set(...KEYS[0].pos);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 40;
  controls.maxDistance = 5200;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.target.set(...KEYS[0].tgt);

  /* ---------- world ---------- */
  const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  const lines = new Lines();
  const tower = buildTower(lines, clip);
  const city = buildCity(lines);
  const sky = buildSky(scene);
  const craft = buildCraft(tower);
  const lineMat = lineMaterial("#2a241e", 0.62);
  const lineMesh = lines.build(lineMat);
  scene.add(city.group, tower.group, craft.group, lineMesh);
  if (import.meta.env.DEV) Object.assign(window, { __scene: scene, __renderer: renderer, __camera: camera });

  /* ---------- post ---------- */
  const size = new THREE.Vector2();
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0, 0.5, 0.95);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    // narrow screens: widen the lens so the tower still fits
    baseFov = w / h < 0.8 ? 44 : 30;
    camera.updateProjectionMatrix();
    renderer.getSize(size);
  }
  let baseFov = 30;
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  /* ---------- labels ---------- */
  const labelEls = LABELS.map((l) => {
    const el = document.createElement("div");
    el.className = "tower-label";
    el.innerHTML = `<span class="tower-label__rule"></span><span class="tower-label__num">${l.text}</span><span class="tower-label__sub">${l.sub}</span>`;
    labelHost.appendChild(el);
    return el;
  });

  /* ---------- camera rig ---------- */
  const posCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3(...k.pos)), false, "centripetal");
  const tgtCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3(...k.tgt)), false, "centripetal");
  const rigPos = new THREE.Vector3();
  const rigTgt = new THREE.Vector3();

  function rigAt(p: number) {
    let i = 0;
    while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++;
    const f = Math.min(1, Math.max(0, (p - KEYS[i].p) / (KEYS[i + 1].p - KEYS[i].p)));
    const u = (i + f) / (KEYS.length - 1);
    posCurve.getPoint(u, rigPos);
    tgtCurve.getPoint(u, rigTgt);
  }

  let view: View = "orbit";
  let manual = false;
  let orbit = 0; // slow drift once a stage settles

  controls.addEventListener("start", () => {
    if (!manual) {
      manual = true;
      hooks.onManual(true);
    }
  });

  function viewPose(t: number) {
    if (view === "elevation") {
      rigPos.set(Math.sin(t * 0.03) * 60, 285, 3600);
      rigTgt.set(0, 280, 0);
      return 9;
    }
    if (view === "plan") {
      rigPos.set(0, 2900, 70);
      rigTgt.set(0, 0, 60);
      return 34;
    }
    return baseFov;
  }

  /* ---------- state ---------- */
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let p = reduced ? END : 0;
  let playing = !reduced;
  let last = performance.now();
  let clock = 0;
  let raf = 0;
  let firstFrame = true;

  const proj = new THREE.Vector3();

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;

    if (playing) {
      p += dt / STAGE_SECONDS;
      if (p >= END) {
        p = END;
        playing = false;
      }
    }

    const ph = phases(p);
    U.uTime.value = clock;
    U.uReal.value = ph.real;
    U.uNight.value = ph.night;
    // the tower's wash drifts slowly through a few colours
    U.uLed.value.setHSL((0.98 + 0.08 * Math.sin(clock * 0.07)) % 1, 0.85, 0.5);

    driveLooks(ph.real, ph.night);
    tower.update(ph, clock, dt);
    city.update(ph, clock);
    craft.update(ph, clock, p);
    sky.update(ph, clock, camera);

    lineMat.uniforms.uDraw.value = ph.draw * 1.02;
    lineMat.uniforms.uCity.value = ph.city;
    lineMat.uniforms.uAlpha.value = Math.max(0, ph.lines);
    lineMat.uniforms.uFogNear.value = sky.fog.near;
    lineMat.uniforms.uFogFar.value = sky.fog.far * 0.7;
    lineMesh.visible = ph.lines > 0.005;

    scene.environmentIntensity = lerp(lerp(0.3, 0.7, ph.real), 0.12, ph.night);
    bloom.enabled = ph.night > 0.01;
    bloom.strength = 0.7 * ph.night;

    /* camera */
    const fov = viewPose(clock);
    if (view === "orbit") {
      rigAt(p);
      // once a beat is reached, let the camera drift round the tower
      orbit += dt * 0.035 * (playing ? 0.4 : 1);
      const a = Math.sin(orbit) * 0.28;
      rigPos.sub(rigTgt).applyAxisAngle(THREE.Object3D.DEFAULT_UP, a).add(rigTgt);
    }
    if (!manual) {
      const k = firstFrame ? 1 : 1 - Math.exp(-dt * 2.6);
      camera.position.lerp(rigPos, k);
      controls.target.lerp(rigTgt, k);
    }
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = lerp(camera.fov, fov, firstFrame ? 1 : 1 - Math.exp(-dt * 3));
      camera.updateProjectionMatrix();
    }
    controls.update();
    firstFrame = false;

    composer.render(dt);

    /* labels: pinned to the centreline, pushed right by CSS */
    const w = size.x;
    const h = size.y;
    const drawn = ph.draw;
    LABELS.forEach((l, i) => {
      const el = labelEls[i];
      proj.set(0, l.y, 0).project(camera);
      const order = 0.3 + 0.64 * (l.y / H.tip);
      const vis = smooth(order, order + 0.06, drawn) * (1 - smooth(2.9, 3.2, p)) * (view === "plan" ? 0 : 1);
      if (proj.z > 1 || vis < 0.01) {
        el.style.opacity = "0";
        return;
      }
      el.style.opacity = String(vis);
      el.style.transform = `translate3d(${((proj.x + 1) / 2) * w}px, ${((1 - proj.y) / 2) * h}px, 0)`;
    });

    hooks.onFrame(p, tower.height, playing);

    if (import.meta.env.DEV) {
      fpsN++;
      if (now - fpsT > 1000) {
        (window as unknown as { __fps: number }).__fps = (fpsN * 1000) / (now - fpsT);
        fpsN = 0;
        fpsT = now;
      }
    }
  }
  let fpsN = 0;
  let fpsT = performance.now();
  raf = requestAnimationFrame(frame);

  const onVisibility = () => {
    last = performance.now();
  };
  document.addEventListener("visibilitychange", onVisibility);

  return {
    play() {
      if (p >= END - 1e-4) p = 0;
      playing = true;
      manual = false;
      hooks.onManual(false);
    },
    pause() {
      playing = false;
    },
    seek(np) {
      p = Math.min(END, Math.max(0, np));
    },
    setView(v) {
      view = v;
      manual = false;
      hooks.onManual(false);
    },
    follow() {
      manual = false;
      hooks.onManual(false);
    },
    snap() {
      firstFrame = true;
    },
    tick() {
      cancelAnimationFrame(raf);
      frame(performance.now());
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      controls.dispose();
      labelEls.forEach((e) => e.remove());
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
      });
      for (const l of looks) l.mat.dispose();
      looks.length = 0;
      composer.dispose();
      target.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
