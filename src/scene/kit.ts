/* Small shared pieces for the tower scene: maths, a seeded random, and the
 * one uniform bag every patched material reads from. */

import * as THREE from "three";

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function smooth(e0: number, e1: number, x: number) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** 0..1 over [start, start + span], eased at both ends. */
export function window01(x: number, start: number, span: number) {
  return smooth(start, start + span, x);
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** mulberry32 — deterministic, so the city is the same city every visit. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Every material that changes with the timeline reads these by reference,
 * so one write per frame reaches all of them. */
export const U = {
  uTime: { value: 0 },
  /** clay model -> real materials */
  uReal: { value: 0 },
  /** daylight -> night; drives every emissive */
  uNight: { value: 0 },
  /** hue of the tower's LED wash */
  uLed: { value: new THREE.Color("#d8263a") },
};

export type Uniforms = typeof U;

/** Replace one shader chunk, failing loudly if three renamed it — a silent
 *  no-op here would just mean a material quietly stops animating. */
export function inject(src: string, find: string, replace: string) {
  if (!src.includes(find)) throw new Error(`shader chunk not found: ${find}`);
  return src.replace(find, replace);
}

/* A standard material whose colour, roughness and metalness slide from a
 * clay version to a real one as uReal goes 0 -> 1. Tracked here so the
 * engine can drive them all in one pass. */
export interface Look {
  mat: THREE.MeshStandardMaterial;
  clay: THREE.Color;
  real: THREE.Color;
  clayRough: number;
  realRough: number;
  realMetal: number;
  /** emissive colour at full night, and its intensity */
  glow?: THREE.Color;
  glowAt?: number;
}

export const looks: Look[] = [];

export function look(
  real: string,
  opts: {
    clay?: string;
    rough?: number;
    metal?: number;
    clayRough?: number;
    glow?: string;
    glowAt?: number;
    transparent?: boolean;
    opacity?: number;
    flat?: boolean;
    side?: THREE.Side;
  } = {}
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: opts.clay ?? "#f3efe8",
    roughness: opts.clayRough ?? 0.92,
    metalness: 0,
    flatShading: opts.flat ?? false,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    /* Pushes faces back a hair so the drafting lines drawn on their edges
       win the depth test instead of flickering half-hidden. */
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  looks.push({
    mat,
    clay: new THREE.Color(opts.clay ?? "#f3efe8"),
    real: new THREE.Color(real),
    clayRough: opts.clayRough ?? 0.92,
    realRough: opts.rough ?? 0.8,
    realMetal: opts.metal ?? 0,
    glow: opts.glow ? new THREE.Color(opts.glow) : undefined,
    glowAt: opts.glowAt ?? 1,
  });
  return mat;
}

export function driveLooks(real: number, night: number) {
  for (const l of looks) {
    l.mat.color.copy(l.clay).lerp(l.real, real);
    l.mat.roughness = lerp(l.clayRough, l.realRough, real);
    l.mat.metalness = l.realMetal * real;
    if (l.glow) {
      l.mat.emissive.copy(l.glow);
      l.mat.emissiveIntensity = (l.glowAt ?? 1) * night;
    }
  }
}

/** Instance colours only apply once the model turns real; in clay every
 *  instance is the same white. */
export function clayInstances(mat: THREE.Material) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev?.call(mat, shader, r);
    shader.uniforms.uReal = U.uReal;
    shader.fragmentShader = inject(
      shader.fragmentShader,
      "#include <color_fragment>",
      `#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
         diffuseColor.rgb *= mix(vec3(1.0), vColor.rgb, uReal);
       #endif
       // <clay-colour>`
    );
    shader.fragmentShader = "uniform float uReal;\n" + shader.fragmentShader;
  };
}
