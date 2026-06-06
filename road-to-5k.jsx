import React, { useState, useEffect, useRef, useMemo } from "react";

const WEEKS = [
  { n: 1, label: "Foundation", days: [
    { d: "MON", type: "run", title: "4 km", detail: "Run 6 min / walk 1 min", km: 4 },
    { d: "TUE", type: "easy", title: "Easy 2–3 km", detail: "Slow jog or 30 min walk", km: 2.5 },
    { d: "WED", type: "run", title: "4.5 km", detail: "Run 6 / walk 1", km: 4.5 },
    { d: "THU", type: "easy", title: "Easy 2–3 km", detail: "Slow jog or walk", km: 2.5 },
    { d: "FRI", type: "run", title: "5 km", detail: "Run 6 / walk 1 — first 5 km!", km: 5 },
    { d: "SAT", type: "rest", title: "Walk or rest", detail: "30 min walk, or full rest", km: 0 },
    { d: "SUN", type: "run", title: "4 km", detail: "Easy continuous", km: 4 },
  ]},
  { n: 2, label: "Extend", days: [
    { d: "MON", type: "run", title: "5 km", detail: "Run 8 / walk 1", km: 5 },
    { d: "TUE", type: "easy", title: "Easy 3 km", detail: "Slow jog", km: 3 },
    { d: "WED", type: "run", title: "4 km", detail: "Continuous, no walking", km: 4 },
    { d: "THU", type: "easy", title: "Easy 2–3 km", detail: "Jog or walk", km: 2.5 },
    { d: "FRI", type: "run", title: "5 km", detail: "Run 10 / walk 1", km: 5 },
    { d: "SAT", type: "rest", title: "Walk or rest", detail: "Keep it light", km: 0 },
    { d: "SUN", type: "run", title: "5 km", detail: "Only 1–2 walk breaks", km: 5 },
  ]},
  { n: 3, label: "Hit 5 km", days: [
    { d: "MON", type: "run", title: "5 km", detail: "Attempt continuous", km: 5 },
    { d: "TUE", type: "easy", title: "Easy 3 km", detail: "Slow jog", km: 3 },
    { d: "WED", type: "run", title: "4 km", detail: "Continuous, relaxed", km: 4 },
    { d: "THU", type: "rest", title: "Walk or rest", detail: "Recover", km: 0 },
    { d: "FRI", type: "run", title: "5 km", detail: "Continuous 🎉", km: 5 },
    { d: "SAT", type: "easy", title: "Easy walk", detail: "Loose legs", km: 2 },
    { d: "SUN", type: "run", title: "5 km", detail: "Continuous, comfortable", km: 5 },
  ]},
  { n: 4, label: "Lock it in", days: [
    { d: "MON", type: "run", title: "5 km", detail: "Easy continuous", km: 5 },
    { d: "TUE", type: "easy", title: "Easy 3 km", detail: "Jog", km: 3 },
    { d: "WED", type: "run", title: "5 km", detail: "Steady", km: 5 },
    { d: "THU", type: "rest", title: "Walk or rest", detail: "Recover", km: 0 },
    { d: "FRI", type: "run", title: "5 km", detail: "Easy", km: 5 },
    { d: "SAT", type: "rest", title: "Rest", detail: "Full rest", km: 0 },
    { d: "SUN", type: "rest", title: "Rest", detail: "Arrive fresh!", km: 0 },
  ]},
];

const FLAT = WEEKS.flatMap((w) => w.days.map((day, di) => ({ ...day, key: `w${w.n}d${di}`, week: w.n })));
const TOTAL = FLAT.length;

const C = {
  bg: "#0c0d10", surface: "#15171c", surface2: "#1b1e25", line: "#2a2e38",
  text: "#f1f3ee", dim: "#878d99", accent: "#ccff33", run: "#ccff33",
  easy: "#43e0c4", rest: "#5a6170", warn: "#ff6a3d",
};
const typeColor = (t) => (t === "run" ? C.run : t === "easy" ? C.easy : C.rest);

export default function App() {
  const [log, setLog] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(null);
  const [tab, setTab] = useState("plan"); // plan | stats
  const [tipsOpen, setTipsOpen] = useState(false);

  // stopwatch
  const [swMs, setSwMs] = useState(0);
  const [swRun, setSwRun] = useState(false);
  const swRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("run5k:v2");
        if (r && r.value) setLog(JSON.parse(r.value));
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (swRun) {
      const start = Date.now() - swMs;
      swRef.current = setInterval(() => setSwMs(Date.now() - start), 200);
    } else if (swRef.current) clearInterval(swRef.current);
    return () => swRef.current && clearInterval(swRef.current);
  }, [swRun]);

  const persist = async (next) => {
    try { await window.storage.set("run5k:v2", JSON.stringify(next)); } catch (e) {}
  };
  const update = (key, patch) => {
    const cur = log[key] || {};
    const next = { ...log, [key]: { ...cur, ...patch } };
    setLog(next); persist(next);
  };
  const reset = async () => { setLog({}); await persist({}); setOpen(null); };

  const stats = useMemo(() => {
    let kmLogged = 0, done = 0, stitches = 0, runsLogged = 0;
    FLAT.forEach((f) => {
      const e = log[f.key];
      if (!e) return;
      if (e.done) done++;
      const k = parseFloat(e.km);
      if (!isNaN(k)) { kmLogged += k; if (k > 0) runsLogged++; }
      if (e.stitch) stitches++;
    });
    // best streak over flat sequence
    let best = 0, cur = 0;
    FLAT.forEach((f) => { if (log[f.key] && log[f.key].done) { cur++; best = Math.max(best, cur); } else cur = 0; });
    return { kmLogged, done, stitches, runsLogged, best };
  }, [log]);

  const pct = Math.round((stats.done / TOTAL) * 100);
  const nextUp = FLAT.find((f) => !(log[f.key] && log[f.key].done));

  const fmt = (ms) => {
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  // progress ring math
  const R = 46, CIRC = 2 * Math.PI * R;

  const Stat = ({ label, value, sub, color }) => (
    <div style={{ flex: 1, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 12px" }}>
      <div className="num" style={{ fontSize: 26, fontWeight: 800, color: color || C.text, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, letterSpacing: 1.5, color: C.dim, marginTop: 6, fontWeight: 600 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Manrope', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=Manrope:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        .syne { font-family: 'Syne', sans-serif; }
        .num { font-family: 'Syne', sans-serif; font-variant-numeric: tabular-nums; }
        input { font-family: 'Manrope', sans-serif; }
        .row { transition: background .15s ease, border-color .15s ease; }
        .glow { box-shadow: 0 0 0 1px ${C.accent}, 0 0 22px -6px ${C.accent}; }
        @keyframes rise { from { opacity:0; transform: translateY(8px) } to { opacity:1; transform:none } }
        .rise { animation: rise .3s ease both; }
        .inp { background:${C.bg}; border:1px solid ${C.line}; color:${C.text}; border-radius:10px; padding:9px 11px; width:100%; font-size:14px; font-weight:600; outline:none; }
        .inp:focus { border-color:${C.accent}; }
        .chip { cursor:pointer; border-radius:999px; padding:7px 13px; font-size:12px; font-weight:700; border:1px solid ${C.line}; background:${C.bg}; color:${C.dim}; }
      `}</style>

      <div style={{ maxWidth: 620, margin: "0 auto", padding: "22px 16px 70px" }}>
        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 3, color: C.accent, fontWeight: 700 }}>4-WEEK MISSION</div>
            <h1 className="syne" style={{ fontSize: 30, fontWeight: 800, margin: "2px 0 0", letterSpacing: -0.5 }}>ROAD TO 5K</h1>
          </div>
          <div style={{ position: "relative", width: 108, height: 108 }}>
            <svg width="108" height="108" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="54" cy="54" r={R} fill="none" stroke={C.surface2} strokeWidth="9" />
              <circle cx="54" cy="54" r={R} fill="none" stroke={C.accent} strokeWidth="9" strokeLinecap="round"
                strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - pct / 100)} style={{ transition: "stroke-dashoffset .5s ease" }} />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <span className="num" style={{ fontSize: 24, fontWeight: 800 }}>{pct}%</span>
              <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1 }}>{stats.done}/{TOTAL} DAYS</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {["plan", "stats"].map((t) => (
            <button key={t} onClick={() => setTab(t)} className="chip"
              style={{ flex: 1, padding: "10px 0", background: tab === t ? C.accent : C.surface, color: tab === t ? C.bg : C.dim, border: "none", textTransform: "uppercase", letterSpacing: 1 }}>
              {t}
            </button>
          ))}
        </div>

        {tab === "stats" && (
          <div className="rise">
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <Stat label="KM LOGGED" value={stats.kmLogged.toFixed(1)} color={C.accent} />
              <Stat label="BEST STREAK" value={stats.best} sub="days in a row" />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <Stat label="RUNS DONE" value={stats.runsLogged} />
              <Stat label="STITCHES" value={stats.stitches} sub="should drop!" color={stats.stitches ? C.warn : C.easy} />
            </div>

            {/* Stopwatch */}
            <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, textAlign: "center" }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: C.dim, fontWeight: 700 }}>RUN STOPWATCH</div>
              <div className="num" style={{ fontSize: 52, fontWeight: 800, margin: "6px 0 12px", color: swRun ? C.accent : C.text }}>{fmt(swMs)}</div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <button onClick={() => setSwRun((r) => !r)} className="chip"
                  style={{ background: swRun ? C.warn : C.accent, color: C.bg, border: "none", padding: "11px 26px", fontSize: 14 }}>
                  {swRun ? "PAUSE" : swMs ? "RESUME" : "START"}
                </button>
                <button onClick={() => { setSwRun(false); setSwMs(0); }} className="chip" style={{ padding: "11px 22px", fontSize: 14 }}>RESET</button>
              </div>
            </div>
          </div>
        )}

        {tab === "plan" && (
          <div className="rise">
            {/* Next up */}
            {nextUp ? (
              <div className="glow" style={{ background: C.surface, borderRadius: 16, padding: 16, marginBottom: 18 }}>
                <div style={{ fontSize: 10, letterSpacing: 2, color: C.accent, fontWeight: 700 }}>NEXT UP · WEEK {nextUp.week}</div>
                <div className="syne" style={{ fontSize: 24, fontWeight: 800, margin: "4px 0 2px" }}>{nextUp.d} · {nextUp.title}</div>
                <div style={{ fontSize: 13, color: C.dim }}>{nextUp.detail}</div>
              </div>
            ) : (
              <div className="glow" style={{ background: C.surface, borderRadius: 16, padding: 18, marginBottom: 18, textAlign: "center" }}>
                <div className="syne" style={{ fontSize: 22, fontWeight: 800 }}>🎖️ MISSION COMPLETE</div>
                <div style={{ fontSize: 13, color: C.dim, marginTop: 4 }}>You built up to 5 km. Go crush that army run.</div>
              </div>
            )}

            {/* Tips */}
            <button onClick={() => setTipsOpen((o) => !o)} className="chip"
              style={{ width: "100%", textAlign: "left", padding: "12px 14px", marginBottom: 16, background: C.surface, color: C.text, fontSize: 13 }}>
              {tipsOpen ? "▾" : "▸"} Beat the side stitch
            </button>
            {tipsOpen && (
              <div className="rise" style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 16px", marginBottom: 16, fontSize: 13, lineHeight: 1.55, color: C.dim }}>
                <p style={{ margin: "0 0 7px" }}><b style={{ color: C.text }}>Belly breathing.</b> Deep into your stomach, not shallow into the chest — your #1 weapon.</p>
                <p style={{ margin: "0 0 7px" }}><b style={{ color: C.text }}>Exhale on the opposite foot</b> to the stitch side.</p>
                <p style={{ margin: "0 0 7px" }}><b style={{ color: C.text }}>No food 2–3h before.</b> Don't chug water right before either.</p>
                <p style={{ margin: 0 }}><b style={{ color: C.text }}>Slow down</b> to a pace where you could still talk.</p>
              </div>
            )}

            {/* Weeks */}
            {WEEKS.map((w) => {
              const wDone = w.days.filter((_, i) => log[`w${w.n}d${i}`] && log[`w${w.n}d${i}`].done).length;
              return (
                <div key={w.n} style={{ marginBottom: 22 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
                    <span className="syne" style={{ fontSize: 14, fontWeight: 800, letterSpacing: 1 }}>WEEK {w.n}</span>
                    <span style={{ fontSize: 11, color: C.dim }}>{w.label}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: C.dim, fontWeight: 600 }}>{wDone}/{w.days.length}</span>
                  </div>
                  <div style={{ display: "grid", gap: 7 }}>
                    {w.days.map((day, di) => {
                      const key = `w${w.n}d${di}`;
                      const e = log[key] || {};
                      const isOpen = open === key;
                      return (
                        <div key={di}>
                          <div className="row" onClick={() => setOpen(isOpen ? null : key)}
                            style={{ display: "flex", alignItems: "center", gap: 12, background: C.surface, border: `1px solid ${e.done ? typeColor(day.type) : C.line}`, borderRadius: isOpen ? "12px 12px 0 0" : 12, padding: "11px 13px", cursor: "pointer" }}>
                            <button onClick={(ev) => { ev.stopPropagation(); update(key, { done: !e.done }); }}
                              style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 8, border: `2px solid ${e.done ? typeColor(day.type) : C.line}`, background: e.done ? typeColor(day.type) : "transparent", color: C.bg, fontWeight: 900, fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              {e.done ? "✓" : ""}
                            </button>
                            <div style={{ width: 30, fontSize: 11, fontWeight: 700, color: C.dim }}>{day.d}</div>
                            <div style={{ flex: 1 }}>
                              <div className="syne" style={{ fontSize: 16, fontWeight: 700, textDecoration: e.done ? "line-through" : "none", color: e.done ? C.dim : C.text }}>{day.title}</div>
                              <div style={{ fontSize: 11, color: C.dim, marginTop: 1 }}>{day.detail}</div>
                            </div>
                            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: typeColor(day.type) }}>
                              {day.type.toUpperCase()}
                            </span>
                          </div>

                          {isOpen && (
                            <div className="rise" style={{ background: C.surface2, border: `1px solid ${C.line}`, borderTop: "none", borderRadius: "0 0 12px 12px", padding: 14 }}>
                              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                                <div style={{ flex: 1 }}>
                                  <label style={{ fontSize: 10, color: C.dim, fontWeight: 700, letterSpacing: 1 }}>DISTANCE (km)</label>
                                  <input className="inp" type="number" inputMode="decimal" placeholder={String(day.km || 0)} value={e.km ?? ""} onChange={(ev) => update(key, { km: ev.target.value })} />
                                </div>
                                <div style={{ flex: 1 }}>
                                  <label style={{ fontSize: 10, color: C.dim, fontWeight: 700, letterSpacing: 1 }}>TIME (min)</label>
                                  <input className="inp" type="number" inputMode="numeric" placeholder="—" value={e.min ?? ""} onChange={(ev) => update(key, { min: ev.target.value })} />
                                </div>
                              </div>
                              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                                <span style={{ fontSize: 12, color: C.dim, fontWeight: 600 }}>Side stitch hit?</span>
                                <button onClick={() => update(key, { stitch: !e.stitch })} className="chip"
                                  style={{ background: e.stitch ? C.warn : C.bg, color: e.stitch ? C.bg : C.dim, border: e.stitch ? "none" : `1px solid ${C.line}` }}>
                                  {e.stitch ? "YES 😣" : "NO 🙌"}
                                </button>
                              </div>
                              <input className="inp" placeholder="How did it feel? (note)" value={e.note ?? ""} onChange={(ev) => update(key, { note: ev.target.value })} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 13, fontSize: 12, lineHeight: 1.5, color: C.dim, marginBottom: 14 }}>
              <b style={{ color: C.text }}>Listen to your body.</b> Muscle soreness = normal. Sharp joint or shin pain = stop and rest 1–2 days. Don't arrive injured.
            </div>
            <button onClick={reset} className="chip" style={{ fontSize: 11, letterSpacing: 1 }}>RESET ALL PROGRESS</button>
          </div>
        )}

        {!loaded && <div style={{ fontSize: 11, color: C.dim, marginTop: 12 }}>loading…</div>}
      </div>
    </div>
  );
}
