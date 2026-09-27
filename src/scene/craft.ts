/* Things that fly.
 *
 * Olga — the Sikorsky S-64 Skycrane that lifted the antenna into place in
 * 1975, one piece at a time. She ferries each mast segment up, lowers it on
 * a cable, lets go, and goes back for the next. Her position is a pure
 * function of progress, so scrubbing back makes her un-place pieces.
 *
 * And, once it's the present day, Porter Q400s on final into Billy Bishop.
 */

import * as THREE from "three";
import type { Phases } from "../timeline";
import type { Tower } from "./tower";
import { RUNWAY } from "./city";
import { look, lerp, clamp01, smooth, easeInOutCubic } from "./kit";

const CABLE = 20;

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  b.castShadow = true;
  return b;
}

function skycrane() {
  // Olga keeps her colours even in the clay model: she's the only thing
  // moving in 03, and white-on-white she simply disappears
  const body = look("#d2601f", { clay: "#c9622a", rough: 0.55, clayRough: 0.55 });
  const white = look("#e9e6df", { clay: "#f5f2ec", rough: 0.5 });
  const dark = look("#2c2f33", { clay: "#34363a", rough: 0.6, clayRough: 0.6 });
  const glassM = look("#1d2a35", { clay: "#2a3540", rough: 0.15, metal: 0.6, clayRough: 0.2 });

  const g = new THREE.Group();
  // the famous skeletal spine: nothing under it but the load
  g.add(box(19, 1.6, 1.5, body, -0.5, 1.6, 0));
  g.add(box(6, 1.1, 1.2, white, 1, 2.8, 0)); // engine housings
  const cockpit = new THREE.Mesh(new THREE.CapsuleGeometry(1.35, 2.2, 4, 10), glassM);
  cockpit.rotation.z = Math.PI / 2;
  cockpit.position.set(9.6, 1.2, 0);
  g.add(cockpit);
  g.add(box(3.4, 2.2, 2.5, body, 7.8, 1.3, 0));
  // tail boom and fin
  const boom = box(8, 1, 1, body, -12.5, 2.4, 0);
  boom.rotation.z = 0.12;
  g.add(boom);
  g.add(box(2.4, 4.2, 0.35, body, -16.2, 3.8, 0));
  // long legs: the Skycrane stands on stilts so it can straddle a load
  for (const [x, z] of [[6.5, 2.6], [6.5, -2.6], [-6.5, 3.2], [-6.5, -3.2]]) {
    const leg = box(0.35, 4.4, 0.35, dark, x, -0.8, z * 0.8);
    leg.rotation.x = z > 0 ? -0.22 : 0.22;
    g.add(leg);
  }
  g.add(box(0.4, 0.4, 6.8, dark, -6.5, -2.9, 0));

  const rotor = new THREE.Group();
  rotor.position.set(0.5, 3.9, 0);
  for (let i = 0; i < 6; i++) {
    const blade = box(11, 0.12, 0.7, dark, 5.5, 0, 0);
    const arm = new THREE.Group();
    arm.rotation.y = (i / 6) * Math.PI * 2;
    arm.add(blade);
    rotor.add(arm);
  }
  // a faint disc so the spin reads even between frames
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(11, 32),
    new THREE.MeshBasicMaterial({ color: "#2c2f33", transparent: true, opacity: 0.08, depthWrite: false })
  );
  disc.rotation.x = -Math.PI / 2;
  rotor.add(disc);
  g.add(rotor);

  const tailRotor = new THREE.Group();
  tailRotor.position.set(-16.4, 4.8, 0.4);
  for (let i = 0; i < 4; i++) {
    const b = box(0.2, 2.2, 0.3, dark, 0, 1.1, 0);
    const arm = new THREE.Group();
    arm.rotation.z = (i / 4) * Math.PI * 2;
    arm.add(b);
    tailRotor.add(arm);
  }
  g.add(tailRotor);

  const cable = box(0.12, 1, 0.12, dark);
  cable.castShadow = false;
  g.add(cable);
  g.scale.setScalar(1.5);

  return { g, rotor, tailRotor, cable };
}

function q400() {
  const navy = look("#1f2b4d", { clay: "#f1ece4", rough: 0.4, metal: 0.2 });
  const white = look("#eef0f2", { clay: "#f5f2ec", rough: 0.35 });
  const dark = look("#2a2c30", { clay: "#dcd6cc", rough: 0.5 });
  const g = new THREE.Group();

  const fus = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 24, 16), navy);
  fus.rotation.z = Math.PI / 2;
  g.add(fus);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1.35, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), white);
  nose.rotation.z = -Math.PI / 2;
  nose.scale.set(1, 2.2, 1);
  nose.position.x = 12;
  g.add(nose);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 0.35, 7, 16), navy);
  tail.rotation.z = -Math.PI / 2;
  tail.position.set(-15.5, 0.5, 0);
  g.add(tail);
  // high wing, nacelles, T-tail
  g.add(box(3, 0.35, 28.4, white, 1.5, 1.45, 0));
  for (const z of [-4.3, 4.3]) {
    const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 6, 10), white);
    nac.rotation.z = Math.PI / 2;
    nac.position.set(2.5, 0.9, z);
    g.add(nac);
    const prop = new THREE.Mesh(
      new THREE.CircleGeometry(2.1, 24),
      new THREE.MeshBasicMaterial({ color: "#222", transparent: true, opacity: 0.15, depthWrite: false })
    );
    prop.rotation.y = Math.PI / 2;
    prop.position.set(5.6, 0.9, z);
    g.add(prop);
  }
  g.add(box(3.4, 5, 0.4, navy, -17.2, 3.1, 0));
  g.add(box(2.2, 0.3, 8, navy, -18, 5.6, 0));
  g.add(box(1.2, 1.6, 0.4, dark, 2, -1.8, 1.2));
  g.add(box(1.2, 1.6, 0.4, dark, 2, -1.8, -1.2));

  // lights: landing, red port, green starboard, white strobe
  const lamp = (c: THREE.Color, r: number, x: number, y: number, z: number) => {
    const m = new THREE.MeshBasicMaterial({ color: c.clone() });
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), m);
    s.position.set(x, y, z);
    s.userData.base = c;
    g.add(s);
    return s;
  };
  const lamps = {
    landing: lamp(new THREE.Color(9, 8.5, 7.5), 0.8, 13.5, -0.4, 0),
    port: lamp(new THREE.Color(6, 0.2, 0.15), 0.5, 1.5, 1.5, -14.3),
    star: lamp(new THREE.Color(0.2, 6, 0.8), 0.5, 1.5, 1.5, 14.3),
    strobe: lamp(new THREE.Color(9, 9, 9), 0.45, -19, 5.8, 0),
  };
  g.scale.setScalar(1.25); // a touch bigger than life, or it's a speck
  return { g, lamps };
}

export interface Craft {
  group: THREE.Group;
  update(ph: Phases, t: number, p: number): void;
}

export function buildCraft(tower: Tower): Craft {
  const group = new THREE.Group();

  /* ---------- Olga ---------- */
  const heli = skycrane();
  group.add(heli.g);
  const carried = new THREE.Mesh();
  carried.castShadow = true;
  group.add(carried);

  const N = tower.mastSegments.length;
  const FAR = new THREE.Vector3(1100, 760, 900);
  const pickup = (i: number) => {
    // alternate sides so she isn't flying the exact same line every lap
    const a = 0.5 + (i % 3) * 0.6;
    return new THREE.Vector3(Math.cos(a) * 170, 420 + i * 4, Math.sin(a) * 170);
  };

  function olgaAt(p: number, mast: number, out: THREE.Vector3): number {
    // returns which segment she's carrying (-1 for none)
    if (mast <= 0) {
      const a = easeInOutCubic(clamp01((p - 1.9) / 0.18));
      out.copy(FAR).lerp(pickup(0), a);
      return 0;
    }
    const x = mast * N;
    if (x >= N) {
      const a = easeInOutCubic(clamp01((p - 2.88) / 0.22));
      out.copy(pickup(N)).lerp(FAR, a);
      return -1;
    }
    const i = Math.floor(x);
    const u = x - i;
    const hover = tower.mastBases[i] + tower.mastHeights[i] + CABLE;
    if (u < 0.4) {
      const a = easeInOutCubic(u / 0.4);
      out.copy(pickup(i)).lerp(new THREE.Vector3(0, hover + 10, 0), a);
      out.y += Math.sin(a * Math.PI) * 18;
      return i;
    }
    if (u < 0.8) {
      out.set(0, lerp(hover + 10, hover, smooth(0.4, 0.8, u)), 0);
      return i;
    }
    const a = easeInOutCubic((u - 0.8) / 0.2);
    out.set(0, hover + a * 6, 0).lerp(pickup(i + 1), a);
    return -1;
  }

  const pos = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  let yaw = 0;

  /* ---------- Q400s ---------- */
  const planes = [q400(), q400()];
  for (const pl of planes) group.add(pl.g);
  const rc = Math.cos(RUNWAY.rot);
  const rs = Math.sin(RUNWAY.rot);
  const onRunway = (u: number, y: number, out: THREE.Vector3) =>
    out.set(RUNWAY.x + u * rc, y, RUNWAY.z - u * rs);

  return {
    group,
    update(ph, t, p) {
      /* Olga only exists in 1975 */
      const flying = ph.heli > 0 && ph.real < 0.5;
      heli.g.visible = flying;
      carried.visible = false;
      heli.cable.visible = false;
      if (flying) {
        const seg = olgaAt(p, ph.mast, pos);
        olgaAt(p + 0.004, clamp01(ph.mast + 0.004), ahead);
        const v = ahead.sub(pos);
        const speed = Math.hypot(v.x, v.z);
        if (speed > 0.05) yaw = Math.atan2(-v.z, v.x);
        heli.g.position.copy(pos);
        heli.g.rotation.set(0, yaw, -Math.min(0.18, speed * 0.02), "YXZ");
        heli.rotor.rotation.y = t * 13;
        heli.tailRotor.rotation.z = t * 40;

        if (seg >= 0 && seg < N) {
          const src = tower.mastSegments[seg];
          carried.geometry = src.geometry;
          carried.material = src.material;
          carried.visible = true;
          const h = tower.mastHeights[seg];
          carried.position.set(pos.x, pos.y - CABLE - h, pos.z);
          carried.rotation.set(0, 0, 0);
          // the cable runs from the belly to the top of the load
          heli.cable.visible = true;
          // the group is scaled 1.5×, so the cable is in its local units
          heli.cable.scale.set(1, (CABLE - 1) / 1.5, 1);
          heli.cable.position.set(0, -(CABLE - 1) / 3 - 0.2, 0);
          heli.cable.rotation.set(0, 0, 0);
          // the group's own roll would swing it; undo that for the cable
          heli.cable.quaternion.copy(heli.g.quaternion).invert();
        }
      }

      /* Porter on final for runway 26, every 36 s, two in the pattern */
      const show = ph.real > 0.02;
      planes.forEach((pl, k) => {
        pl.g.visible = show;
        if (!show) return;
        const cyc = ((t / 72 + k * 0.5) % 1) * 72;
        const L = RUNWAY.len / 2;
        let u: number, y: number, pitch = 0.04;
        if (cyc < 56) {
          // 3° glideslope from 3.4 km out
          const a = cyc / 56;
          u = lerp(L + 3400, L - 260, a);
          y = 2 + Math.max(0, u - (L - 260)) * Math.tan((3 * Math.PI) / 180) + 4;
        } else {
          const a = (cyc - 56) / 16;
          u = L - 260 - 700 * (1 - Math.pow(1 - a, 2));
          y = 4.5;
          pitch = 0.0;
        }
        onRunway(u, y, pl.g.position);
        pl.g.rotation.set(0, Math.PI + RUNWAY.rot, pitch, "YXZ");
        pl.g.visible = show && cyc < 71;

        const n = ph.night;
        const blink = (Math.floor(t * 1.2 + k) % 2 === 0 ? 1 : 0) * (t * 1.2 % 1 < 0.12 ? 1 : 0);
        for (const [key, lampMesh] of Object.entries(pl.lamps)) {
          const base = lampMesh.userData.base as THREE.Color;
          const m = lampMesh.material as THREE.MeshBasicMaterial;
          const on = key === "strobe" ? blink : 1;
          const k2 = lerp(0.12, 1, n) * on;
          m.color.setRGB(base.r * k2 + 0.1, base.g * k2 + 0.1, base.b * k2 + 0.1);
        }
      });
    },
  };
}
