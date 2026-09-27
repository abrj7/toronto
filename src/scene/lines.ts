/* The drafting layer. Every line in the piece — survey grid, footprints,
 * the ghost of the finished tower — is one LineSegments with two extra
 * attributes:
 *
 *   aDraw   when the pen reaches this vertex (0..1). Interpolated along the
 *           segment, so a line draws itself from one end to the other.
 *   aDelay  for city edges, when the building starts extruding. The shader
 *           squashes y by the growth, so before 02 every building is just
 *           its footprint. -1 opts out.
 */

import * as THREE from "three";

export const growOf = (delay: number, city: number) => {
  if (delay < 0) return 1;
  const t = Math.min(1, Math.max(0, (city - delay) / 0.3));
  return t * t * (3 - 2 * t);
};

export class Lines {
  private pos: number[] = [];
  private draw: number[] = [];
  private delay: number[] = [];

  seg(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    da: number, db: number,
    delay = -1
  ) {
    this.pos.push(ax, ay, az, bx, by, bz);
    this.draw.push(da, db);
    this.delay.push(delay, delay);
  }

  /** A closed polyline, drawn around its perimeter from d0 to d1. */
  loop(points: THREE.Vector3[], d0: number, d1: number, delay = -1) {
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const a = points[i];
      const b = points[(i + 1) % n];
      this.seg(a.x, a.y, a.z, b.x, b.y, b.z,
        d0 + ((d1 - d0) * i) / n, d0 + ((d1 - d0) * (i + 1)) / n, delay);
    }
  }

  /** The hard edges of a mesh, with draw order decided per vertex. */
  edges(
    geo: THREE.BufferGeometry,
    order: (p: THREE.Vector3) => number,
    opts: { matrix?: THREE.Matrix4; threshold?: number; delay?: number } = {}
  ) {
    const e = new THREE.EdgesGeometry(geo, opts.threshold ?? 20);
    const p = e.getAttribute("position");
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 2) {
      a.fromBufferAttribute(p, i);
      b.fromBufferAttribute(p, i + 1);
      if (opts.matrix) {
        a.applyMatrix4(opts.matrix);
        b.applyMatrix4(opts.matrix);
      }
      this.seg(a.x, a.y, a.z, b.x, b.y, b.z, order(a), order(b), opts.delay ?? -1);
    }
    e.dispose();
  }

  build(material: THREE.ShaderMaterial) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("aDraw", new THREE.Float32BufferAttribute(this.draw, 1));
    g.setAttribute("aDelay", new THREE.Float32BufferAttribute(this.delay, 1));
    const ls = new THREE.LineSegments(g, material);
    ls.frustumCulled = false;
    return ls;
  }
}

export function lineMaterial(color: string, alpha: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uDraw: { value: 0 },
      uCity: { value: 0 },
      uAlpha: { value: 1 },
      uBase: { value: alpha },
      uColor: { value: new THREE.Color(color) },
      uPen: { value: new THREE.Color("#b5532f") },
      uFogNear: { value: 900 },
      uFogFar: { value: 3600 },
    },
    vertexShader: /* glsl */ `
      attribute float aDraw;
      attribute float aDelay;
      uniform float uCity;
      uniform float uFogNear;
      uniform float uFogFar;
      varying float vDraw;
      varying float vFog;
      void main() {
        vec3 p = position;
        if (aDelay >= 0.0) p.y *= smoothstep(aDelay, aDelay + 0.3, uCity);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vDraw = aDraw;
        vFog = smoothstep(uFogNear, uFogFar, -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uDraw;
      uniform float uAlpha;
      uniform float uBase;
      uniform vec3 uColor;
      uniform vec3 uPen;
      varying float vDraw;
      varying float vFog;
      void main() {
        if (vDraw > uDraw) discard;
        // the last stretch behind the pen is still wet: warmer and darker
        float wet = (1.0 - smoothstep(0.0, 0.03, uDraw - vDraw)) * step(uDraw, 0.999);
        vec3 c = mix(uColor, uPen, wet);
        float a = uAlpha * uBase * (1.0 - vFog) * (1.0 + wet * 1.5);
        gl_FragColor = vec4(c, min(a, 1.0));
      }
    `,
  });
}
