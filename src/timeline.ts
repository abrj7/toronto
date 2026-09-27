/* The whole piece runs on one number, progress, from 0 to 4 — one unit per
 * stage. Everything in the scene is a pure function of it (plus a clock for
 * things that never stop, like rotors), so scrubbing backwards is exactly
 * as correct as playing forwards. */

import { clamp01, smooth } from "./scene/kit";

export interface Stage {
  n: string;
  name: string;
  line: string;
  sub: string;
}

export const STAGES: Stage[] = [
  { n: "01", name: "Survey", line: "First lines", sub: "site · plan · section" },
  { n: "02", name: "Slipform", line: "The shaft rises", sub: "concrete · 1973 – 74" },
  { n: "03", name: "Assembly", line: "Olga lifts the mast", sub: "sikorsky s-64 skycrane · 1975" },
  { n: "04", name: "Skyline", line: "Lights on", sub: "553.33 m · toronto · tonight" },
];

export const END = STAGES.length;

/** Seconds of autoplay per stage. */
export const STAGE_SECONDS = 9;

export const H = {
  shaftTop: 447,
  lookout: 346,
  skypod: 447,
  mastBase: 458,
  tip: 553.33,
};

export function phases(p: number) {
  return {
    /* 01 — the pen */
    draw: clamp01(p / 0.92),
    ground: smooth(0.85, 1.25, p),

    /* 02 — concrete, then the city around it */
    shaft: smooth(1.0, 1.72, p),
    city: clamp01((p - 1.0) / 0.95),
    pod: clamp01((p - 1.5) / 0.4),
    skypod: clamp01((p - 1.74) / 0.22),

    /* 03 — detail and the mast */
    detail: smooth(1.9, 2.3, p),
    mast: clamp01((p - 2.08) / 0.8),
    heli: p > 1.9 && p < 3.1 ? 1 : 0,

    /* the drafting fades as the model becomes a thing */
    lines: 1 - 0.45 * smooth(1.4, 2.4, p) - 0.55 * smooth(2.9, 3.35, p),

    /* 04 — golden hour, then night */
    real: smooth(3.0, 3.35, p),
    dusk: smooth(3.0, 3.4, p),
    night: smooth(3.38, 3.92, p),
  };
}

export type Phases = ReturnType<typeof phases>;

export const stageOf = (p: number) => Math.min(END - 1, Math.floor(p + 1e-6));
