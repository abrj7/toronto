/* The CN Tower, drawn, poured, assembled and lit — scrub through it.
 *
 * The scene (and three.js with it) loads as its own chunk, so the title
 * block and timeline paint before the drawing is ready.
 */

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { STAGES, END, stageOf } from "./timeline";
import type { Engine, View } from "./scene/engine";

const VIEWS: { id: View; label: string; icon: JSX.Element }[] = [
  {
    id: "orbit",
    label: "perspective",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z" />
        <path d="M4 7.5 12 12l8-4.5M12 12v9" />
      </svg>
    ),
  },
  {
    id: "elevation",
    label: "elevation",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2v20M9 21h6M10.5 21 12 9l1.5 12M8 11h8M9 14h6" />
      </svg>
    ),
  },
  {
    id: "plan",
    label: "plan",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="3.5" width="17" height="17" rx="1" />
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 3.5v5.3M12 15.2v5.3M3.5 12h5.3" />
      </svg>
    ),
  },
];

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const heightRef = useRef<HTMLSpanElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const progressRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [stage, setStage] = useState(0);
  const [night, setNight] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [manual, setManual] = useState(false);
  const [view, setView] = useState<View>("orbit");

  /* the grain is tuned for flat paper; over a render it only needs to hint */
  useEffect(() => {
    document.body.classList.add("is-tower");
    return () => document.body.classList.remove("is-tower");
  }, []);

  useEffect(() => {
    let disposed = false;
    let engine: Engine | null = null;

    import("./scene/engine")
      .then(({ createEngine }) => {
        if (disposed || !hostRef.current || !labelsRef.current) return;
        let lastStage = -1;
        let lastNight: boolean | null = null;
        let lastPlaying: boolean | null = null;
        let first = true;
        engine = createEngine(hostRef.current, labelsRef.current, {
          onFrame(p, height, isPlaying) {
            progressRef.current = p;
            const f = `${(p / END) * 100}%`;
            if (fillRef.current) fillRef.current.style.width = f;
            if (knobRef.current) knobRef.current.style.left = f;
            if (heightRef.current) heightRef.current.textContent = height.toFixed(1);
            if (trackRef.current) trackRef.current.setAttribute("aria-valuenow", p.toFixed(2));

            const s = stageOf(p);
            if (s !== lastStage) setStage((lastStage = s));
            const n = p > 3.45;
            if (n !== lastNight) setNight((lastNight = n));
            if (isPlaying !== lastPlaying) setPlaying((lastPlaying = isPlaying));
            if (first) {
              first = false;
              setReady(true);
            }
          },
          onManual: setManual,
        });
        engineRef.current = engine;
        if (import.meta.env.DEV) (window as unknown as { __tower: Engine }).__tower = engine;
      })
      .catch((err) => {
        console.error(err);
        if (!disposed) setFailed(true);
      });

    return () => {
      disposed = true;
      engine?.dispose();
      engineRef.current = null;
    };
  }, []);

  /* keyboard: space plays, arrows nudge */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const eng = engineRef.current;
      if (!eng || (e.target as HTMLElement)?.closest("input, textarea")) return;
      if (e.code === "Space" && !(e.target as HTMLElement)?.closest("button, a")) {
        e.preventDefault();
        playing ? eng.pause() : eng.play();
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        eng.pause();
        eng.seek(progressRef.current + (e.key === "ArrowRight" ? 0.05 : -0.05));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing]);

  /* scrubbing */
  const scrubbing = useRef(false);
  function scrubTo(clientX: number) {
    const el = trackRef.current;
    if (!el || !engineRef.current) return;
    const r = el.getBoundingClientRect();
    engineRef.current.seek(((clientX - r.left) / r.width) * END);
  }
  function onDown(e: PointerEvent<HTMLDivElement>) {
    scrubbing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    engineRef.current?.pause();
    engineRef.current?.follow();
    scrubTo(e.clientX);
  }
  function onMove(e: PointerEvent<HTMLDivElement>) {
    if (scrubbing.current) scrubTo(e.clientX);
  }
  function onUp() {
    scrubbing.current = false;
  }

  function goStage(i: number) {
    const eng = engineRef.current;
    if (!eng) return;
    eng.seek(i);
    eng.play();
  }

  function pickView(v: View) {
    setView(v);
    engineRef.current?.setView(v);
  }

  const s = STAGES[stage];

  return (
    <div className={`tower${night ? " tower--night" : ""}${ready ? " tower--ready" : ""}`}>
      <div className="tower__canvas" ref={hostRef} />
      <div className="tower__labels" ref={labelsRef} aria-hidden="true" />

      <header className="tower__head">
        <a className="tower__back" href="https://abdullahr.com">
          ar<span className="tower__dot">.</span>
        </a>
        <p className="tower__eyebrow">an architectural study</p>
        <h1 className="tower__title">
          CN <em>Tower.</em>
        </h1>
        <p className="tower__meta">
          Toronto · 43.6426° N 79.3871° W <span aria-hidden="true">/</span> from slipform to skyline
        </p>
      </header>

      <div className="tower__tools">
        <div className="tower__views" role="group" aria-label="camera">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className="tower__view"
              aria-pressed={view === v.id}
              aria-label={v.label}
              title={v.label}
              onClick={() => pickView(v.id)}
            >
              {v.icon}
            </button>
          ))}
        </div>
        <button
          className="tower__follow"
          onClick={() => engineRef.current?.follow()}
          aria-label="recentre camera"
          title="recentre camera"
          data-active={manual || undefined}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3.5" />
            <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
          </svg>
        </button>
      </div>

      <div className="tower__caption" key={stage} aria-live="polite">
        <span className="tower__num">{s.n}</span>
        <div>
          <p className="tower__line">{s.line}</p>
          <p className="tower__sub">{s.sub}</p>
        </div>
      </div>

      <div className="tower__readout" aria-hidden="true">
        <p className="tower__readout-label">elevation</p>
        <p className="tower__readout-value">
          <span ref={heightRef}>0.0</span>
          <small>m</small>
        </p>
        <p className="tower__readout-name">cn tower · 1976</p>
      </div>

      <div className="tower__panel">
        <button
          className="tower__play"
          onClick={() => (playing ? engineRef.current?.pause() : engineRef.current?.play())}
          aria-label={playing ? "pause" : "play"}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5v14M16 5v14" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5.5v13l10.5-6.5L8 5.5Z" />
            </svg>
          )}
        </button>

        <div className="tower__timeline">
          <ol className="tower__stages">
            {STAGES.map((st, i) => (
              <li key={st.n}>
                <button
                  className="tower__stage"
                  aria-current={i === stage ? "step" : undefined}
                  onClick={() => goStage(i)}
                >
                  <span className="tower__stage-n">{st.n}</span>
                  <span className="tower__stage-name">{st.name}</span>
                </button>
              </li>
            ))}
          </ol>
          <div
            className="tower__track"
            ref={trackRef}
            role="slider"
            aria-label="progress"
            aria-valuemin={0}
            aria-valuemax={END}
            tabIndex={0}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <div className="tower__rail" />
            <div className="tower__fill" ref={fillRef} />
            <div className="tower__knob" ref={knobRef} />
          </div>
        </div>
      </div>

      <p className="tower__hint">drag to orbit · click a stage · scrub to transform</p>

      {!ready && (
        <div className="tower__loading" role="status">
          {failed ? "this needs webgl, which this browser won't give it." : "drafting…"}
        </div>
      )}
    </div>
  );
}
