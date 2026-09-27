/* Sky, light and the lake.
 *
 * For three stages the "sky" is paper: the scene sits on the same warm
 * sheet as the rest of the site. In the fourth it turns into a real sky —
 * golden hour, then night — and the lake starts to reflect the city. */

import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import type { Phases } from "../timeline";
import { SHORE } from "./city";
import { lerp } from "./kit";

export const PAPER = new THREE.Color("#ebe4d9");

const C = (h: string) => new THREE.Color(h);
const DUSK = { top: C("#35578c"), horizon: C("#eea57a"), glow: C("#ff9c55") };
const NIGHT = { top: C("#050915"), horizon: C("#1d2236"), glow: C("#000000") };

export interface Sky {
  update(ph: Phases, t: number, camera: THREE.Camera): void;
  fog: THREE.Fog;
  sun: THREE.DirectionalLight;
  /** current horizon colour, for the line fog */
  horizon: THREE.Color;
}

export function buildSky(scene: THREE.Scene): Sky {
  /* ---------- dome ---------- */
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uPaper: { value: PAPER.clone() },
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() },
      uSun: { value: new THREE.Vector3() },
      uMix: { value: 0 },
      uStars: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uPaper, uTop, uHorizon, uGlow, uSun;
      uniform float uMix, uStars;
      varying vec3 vDir;
      float h31(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(uHorizon, uTop, pow(smoothstep(0.0, 0.55, h), 0.65));
        float s = max(dot(d, normalize(uSun)), 0.0);
        col += uGlow * (pow(s, 6.0) * 0.55 + pow(s, 90.0) * 1.2) * smoothstep(-0.05, 0.1, d.y + 0.05);
        // stars: a hashed grid on the sphere, twinkle-free on purpose
        vec3 g = floor(d * 1100.0);
        float st = step(0.9982, h31(g)) * smoothstep(0.08, 0.35, h);
        col += vec3(0.9, 0.92, 1.0) * st * uStars * (0.4 + 0.6 * h31(g + 3.0));
        gl_FragColor = vec4(mix(uPaper, col, uMix), 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(40000, 48, 24), skyMat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);

  const fog = new THREE.Fog(PAPER.clone(), 1400, 7000);
  scene.fog = fog;

  /* ---------- light ---------- */
  const hemi = new THREE.HemisphereLight("#ffffff", "#d8d0c3", 1.2);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight("#ffffff", 2.4);
  sun.castShadow = true;
  const mobile = Math.min(window.innerWidth, window.innerHeight) < 700;
  sun.shadow.mapSize.set(mobile ? 2048 : 4096, mobile ? 2048 : 4096);
  const sc = sun.shadow.camera;
  sc.left = -950;
  sc.right = 950;
  sc.top = 950;
  sc.bottom = -950;
  sc.near = 100;
  sc.far = 6000;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  const SUN_CLAY = new THREE.Vector3(-0.62, 0.72, 0.32).normalize();
  const SUN_DUSK = new THREE.Vector3(-0.92, 0.12, 0.36).normalize();
  const MOON = new THREE.Vector3(0.4, 0.62, -0.5).normalize();

  /* ---------- lake ---------- */
  const lakeGeo = new THREE.PlaneGeometry(80000, 40000);
  const dpr = Math.min(window.devicePixelRatio, 1.5);
  const lake = new Reflector(lakeGeo, {
    textureWidth: Math.round(window.innerWidth * dpr * 0.5),
    textureHeight: Math.round(window.innerHeight * dpr * 0.5),
    clipBias: 0.003,
    multisample: 0,
    shader: {
      name: "Lake",
      uniforms: {
        color: { value: null },
        tDiffuse: { value: null },
        textureMatrix: { value: null },
        uTime: { value: 0 },
        uReal: { value: 0 },
        uOpacity: { value: 1 },
        uClay: { value: new THREE.Color("#d9d8d2") },
        uDeep: { value: new THREE.Color("#0f2433") },
        uFog: { value: new THREE.Color() },
        uFogNear: { value: 1400 },
        uFogFar: { value: 7000 },
      },
      vertexShader: /* glsl */ `
        uniform mat4 textureMatrix;
        varying vec4 vUv;
        varying vec3 vWP;
        void main() {
          vUv = textureMatrix * vec4(position, 1.0);
          vWP = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uTime, uReal, uOpacity, uFogNear, uFogFar;
        uniform vec3 uClay, uDeep, uFog;
        varying vec4 vUv;
        varying vec3 vWP;
        void main() {
          vec2 p = vWP.xz;
          // a few crossed swells; enough to break the mirror into streaks
          vec2 w = vec2(
            sin(p.x * 0.021 + uTime * 0.9) + sin(p.y * 0.047 - uTime * 1.3) * 0.6 + sin((p.x + p.y) * 0.09 + uTime * 1.7) * 0.3,
            cos(p.y * 0.018 + uTime * 0.7) + cos(p.x * 0.055 + uTime * 1.1) * 0.5
          );
          vec3 V = normalize(cameraPosition - vWP);
          float fres = 0.08 + 0.92 * pow(1.0 - max(V.y, 0.0), 4.0);
          vec4 uv = vUv;
          uv.xy += w * vec2(2.5, 9.0) * (0.5 + uReal);
          vec3 refl = texture2DProj(tDiffuse, uv).rgb;
          vec3 base = mix(uClay, uDeep, uReal);
          vec3 col = mix(base, refl, fres * mix(0.18, 0.95, uReal));
          float d = length(cameraPosition - vWP);
          col = mix(col, uFog, smoothstep(uFogNear, uFogFar, d));
          gl_FragColor = vec4(col, uOpacity);
        }
      `,
    },
  });
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(0, -0.6, SHORE + 20000);
  lake.renderOrder = -3;
  const lakeMat = lake.material as THREE.ShaderMaterial;
  lakeMat.transparent = true;
  scene.add(lake);

  const top = new THREE.Color();
  const horizon = new THREE.Color();
  const glow = new THREE.Color();
  const sunDir = new THREE.Vector3();

  return {
    fog,
    sun,
    horizon,
    update(ph, t) {
      const { dusk, night } = ph;
      top.copy(DUSK.top).lerp(NIGHT.top, night);
      horizon.copy(DUSK.horizon).lerp(NIGHT.horizon, night);
      glow.copy(DUSK.glow).lerp(NIGHT.glow, night);

      skyMat.uniforms.uTop.value.copy(top);
      skyMat.uniforms.uHorizon.value.copy(horizon);
      skyMat.uniforms.uGlow.value.copy(glow);
      skyMat.uniforms.uMix.value = dusk;
      skyMat.uniforms.uStars.value = night;

      // fog follows whatever is at the horizon
      fog.color.copy(PAPER).lerp(horizon, dusk);
      fog.near = lerp(1400, 2200, dusk);
      fog.far = lerp(7000, 17000, dusk);

      /* sun: high and neutral for the model, low and orange for the real
         thing, then handing over to a cold dim moon */
      sunDir.copy(SUN_CLAY).lerp(SUN_DUSK, dusk).normalize();
      if (night > 0) sunDir.lerp(MOON, night).normalize();
      skyMat.uniforms.uSun.value.copy(SUN_DUSK);
      sun.position.copy(sunDir).multiplyScalar(2600);
      sun.color.set("#ffffff").lerp(C("#ffb67a"), dusk).lerp(C("#9fb4e6"), night);
      sun.intensity = lerp(lerp(3.1, 3.4, dusk), 0.18, night);

      hemi.color.set("#ffffff").lerp(C("#b8c6e0"), dusk).lerp(C("#1f2a48"), night);
      hemi.groundColor.set("#d8d0c3").lerp(C("#6b5a4c"), dusk).lerp(C("#07070b"), night);
      hemi.intensity = lerp(lerp(0.75, 0.8, dusk), 0.55, night);

      const u = lakeMat.uniforms;
      u.uTime.value = t;
      u.uReal.value = ph.real;
      u.uOpacity.value = ph.ground;
      u.uFog.value.copy(fog.color);
      u.uFogNear.value = fog.near;
      u.uFogFar.value = fog.far;
      lake.visible = ph.ground > 0.001;
    },
  };
}
