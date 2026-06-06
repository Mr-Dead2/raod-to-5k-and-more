import React, { useState, useEffect, useRef, useMemo } from "react";
import { WEEKS, FLAT, TOTAL, C, typeColor } from "./data.js";
import { loadLog, saveLog } from "./storage.js";
import { WeeklyBars, CumulativeArea } from "./components/Charts.jsx";
import {
  notificationsSupported, permission, loadReminder, saveReminder,
  enableReminders, disableReminders, showReminderNow, syncMessage,
  startForegroundScheduler,
} from "./notifications.js";

const pace = (min, km) => {
  const m = parseFloat(min), k = parseFloat(km);
  if (!m || !k) return null;
  const s = (m * 60) / k;
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
};

export default function App() {
  const [log, setLog] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(null);
  const [tab, setTab] = useState("plan"); // plan | stats | history
  const [tipsOpen, setTipsOpen] = useState(false);

  // reminders
  const [remOn, setRemOn] = useState(false);
  const [remTime, setRemTime] = useState("18:00");
  const [perm, setPerm] = useState("default");

  // install prompt
  const [installEvt, setInstallEvt] = useState(null);

  // stopwatch
  const [swMs, setSwMs] = useState(0);
  const [swRun, setSwRun] = useState(false);
  const swRef = useRef(null);

  useEffect(() => {
    setLog(loadLog());
    setLoaded(true);
    (async () => {
      const r = await loadReminder();
      setRemOn(!!r.enabled);
      setRemTime(r.time || "18:00");
    })();
    if (notificationsSupported()) setPerm(permission());
  }, []);

  // capture Android's "add to home screen" prompt
  useEffect(() => {
    const h = (e) => { e.preventDefault(); setInstallEvt(e); };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  useEffect(() => {
    if (swRun) {
      const start = Date.now() - swMs;
      swRef.current = setInterval(() => setSwMs(Date.now() - start), 200);
    } else if (swRef.current) clearInterval(swRef.current);
    return () => swRef.current && clearInterval(swRef.current);
  }, [swRun]);

  const persist = (next) => { setLog(next); saveLog(next); };
  const update = (key, patch) => {
    const cur = log[key] || {};
    const next = { ...cur, ...patch };
    // stamp the completion date the first time a day is marked done (for history/charts)
    if (patch.done && !cur.done && !next.date) next.date = new Date().toISOString();
    persist({ ...log, [key]: next });
  };
  const reset = () => { persist({}); setOpen(null); };

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
    let best = 0, cur = 0;
    FLAT.forEach((f) => { if (log[f.key] && log[f.key].done) { cur++; best = Math.max(best, cur); } else cur = 0; });
    return { kmLogged, done, stitches, runsLogged, best };
  }, [log]);

  // chart + history data
  const weekly = useMemo(() => WEEKS.map((w) => {
    let value = 0, target = 0;
    w.days.forEach((day, di) => {
      target += day.km || 0;
      const e = log[`w${w.n}d${di}`];
      const k = e && parseFloat(e.km);
      if (k && !isNaN(k)) value += k;
    });
    return { label: w.n, value, target };
  }), [log]);

  const history = useMemo(() => {
    const items = FLAT.map((f) => ({ ...f, e: log[f.key] || {} }))
      .filter((f) => f.e.done || parseFloat(f.e.km) > 0);
    items.sort((a, b) => {
      const da = a.e.date || "", db = b.e.date || "";
      if (da && db) return db.localeCompare(da);
      return 0;
    });
    return items;
  }, [log]);

  const cumulative = useMemo(() => {
    const runs = history
      .filter((h) => parseFloat(h.e.km) > 0)
      .slice()
      .sort((a, b) => (a.e.date || "").localeCompare(b.e.date || ""));
    let total = 0;
    return runs.map((r) => { total += parseFloat(r.e.km); return { total }; });
  }, [history]);

  const pct = Math.round((stats.done / TOTAL) * 100);
  const nextUp = FLAT.find((f) => !(log[f.key] && log[f.key].done));

  // keep the background reminder message in sync with today's session
  const msg = nextUp ? `Today: Week ${nextUp.week} · ${nextUp.d} · ${nextUp.title} — ${nextUp.detail}` : "You finished the plan — go enjoy a victory run! 🎖️";
  const msgRef = useRef(msg);
  msgRef.current = msg;
  useEffect(() => { if (remOn) syncMessage(msg); }, [msg, remOn]);

  // foreground reminder scheduler (fires if app is open at reminder time)
  useEffect(() => {
    const stop = startForegroundScheduler(() => msgRef.current);
    return stop;
  }, []);

  const toggleReminder = async () => {
    if (remOn) {
      await disableReminders();
      setRemOn(false);
    } else {
      const ok = await enableReminders(remTime, msgRef.current);
      setRemOn(ok);
      setPerm(permission());
      if (ok) showReminderNow(`Reminders on — I'll nudge you around ${remTime} ✅`);
    }
  };
  const changeTime = async (t) => {
    setRemTime(t);
    if (remOn) await saveReminder({ time: t });
  };
  const doInstall = async () => {
    if (!installEvt) return;
    installEvt.prompt();
    await installEvt.userChoice;
    setInstallEvt(null);
  };

  const fmt = (ms) => {
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  const R = 46, CIRC = 2 * Math.PI * R;

  const Stat = ({ label, value, sub, color }) => (
    <div style={{ flex: 1, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 12px" }}>
      <div className="num" style={{ fontSize: 26, fontWeight: 800, color: color || C.text, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, letterSpacing: 1.5, color: C.dim, marginTop: 6, fontWeight: 600 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  const Card = ({ children, style }) => (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16, ...style }}>{children}</div>
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
        .sw { width:46px; height:27px; border-radius:999px; border:none; cursor:pointer; position:relative; transition:background .2s; }
        .sw b { position:absolute; top:3px; left:3px; width:21px; height:21px; border-radius:50%; background:#fff; transition:left .2s; }
      `}</style>

      <div style={{ maxWidth: 620, margin: "0 auto", padding: "max(22px, env(safe-area-inset-top)) 16px 70px" }}>
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

        {/* Install banner */}
        {installEvt && (
          <button onClick={doInstall} className="chip" style={{ width: "100%", padding: "11px 14px", marginBottom: 14, background: C.accent, color: C.bg, border: "none", fontSize: 13 }}>
            ⬇ Install Road to 5K on your phone
          </button>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {["plan", "stats", "history"].map((t) => (
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

            {/* Charts */}
            <Card style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: C.dim, fontWeight: 700, marginBottom: 8 }}>KM PER WEEK · LOGGED VS PLAN</div>
              <WeeklyBars data={weekly} />
            </Card>
            <Card style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: C.dim, fontWeight: 700, marginBottom: 8 }}>CUMULATIVE DISTANCE</div>
              <CumulativeArea points={cumulative} />
            </Card>

            {/* Reminders */}
            <Card style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, letterSpacing: 2, color: C.dim, fontWeight: 700 }}>DAILY REMINDER</div>
                  <div style={{ fontSize: 13, color: C.text, marginTop: 3, fontWeight: 600 }}>Get nudged to do your session</div>
                </div>
                <button onClick={toggleReminder} className="sw" style={{ background: remOn ? C.accent : C.line }} aria-label="Toggle reminders">
                  <b style={{ left: remOn ? 22 : 3 }} />
                </button>
              </div>
              {remOn && (
                <div className="rise" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                  <span style={{ fontSize: 12, color: C.dim, fontWeight: 600 }}>Remind me at</span>
                  <input className="inp" type="time" value={remTime} onChange={(e) => changeTime(e.target.value)} style={{ width: "auto" }} />
                </div>
              )}
              {!notificationsSupported() && (
                <div style={{ fontSize: 11, color: C.warn, marginTop: 8 }}>This browser can't show notifications.</div>
              )}
              {notificationsSupported() && perm === "denied" && (
                <div style={{ fontSize: 11, color: C.warn, marginTop: 8 }}>Notifications are blocked — enable them in your browser/site settings.</div>
              )}
              <div style={{ fontSize: 11, color: C.dim, marginTop: 8, lineHeight: 1.5 }}>
                Tip: install the app (Add to Home Screen) for the most reliable reminders. The web can't guarantee an exact alarm when fully closed, but it'll catch up next time the app wakes.
              </div>
            </Card>

            {/* Stopwatch */}
            <Card style={{ textAlign: "center", padding: 18 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: C.dim, fontWeight: 700 }}>RUN STOPWATCH</div>
              <div className="num" style={{ fontSize: 52, fontWeight: 800, margin: "6px 0 12px", color: swRun ? C.accent : C.text }}>{fmt(swMs)}</div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <button onClick={() => setSwRun((r) => !r)} className="chip"
                  style={{ background: swRun ? C.warn : C.accent, color: C.bg, border: "none", padding: "11px 26px", fontSize: 14 }}>
                  {swRun ? "PAUSE" : swMs ? "RESUME" : "START"}
                </button>
                <button onClick={() => { setSwRun(false); setSwMs(0); }} className="chip" style={{ padding: "11px 22px", fontSize: 14 }}>RESET</button>
              </div>
            </Card>
          </div>
        )}

        {tab === "history" && (
          <div className="rise">
            {history.length === 0 ? (
              <Card style={{ textAlign: "center" }}>
                <div className="syne" style={{ fontSize: 18, fontWeight: 800 }}>No runs logged yet</div>
                <div style={{ fontSize: 13, color: C.dim, marginTop: 4 }}>Tick off a day on the Plan tab and it'll show up here.</div>
              </Card>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {history.map((h) => {
                  const p = pace(h.e.min, h.e.km);
                  const date = h.e.date ? new Date(h.e.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
                  return (
                    <Card key={h.key} style={{ padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ width: 4, alignSelf: "stretch", borderRadius: 4, background: typeColor(h.type) }} />
                        <div style={{ flex: 1 }}>
                          <div className="syne" style={{ fontSize: 15, fontWeight: 700 }}>{h.title}</div>
                          <div style={{ fontSize: 11, color: C.dim }}>Week {h.week} · {h.d} · {date}</div>
                          {h.e.note && <div style={{ fontSize: 12, color: C.dim, marginTop: 4, fontStyle: "italic" }}>“{h.e.note}”</div>}
                        </div>
                        <div style={{ textAlign: "right" }}>
                          {parseFloat(h.e.km) > 0 && <div className="num" style={{ fontSize: 18, fontWeight: 800, color: C.accent }}>{parseFloat(h.e.km)} km</div>}
                          <div style={{ fontSize: 11, color: C.dim }}>
                            {h.e.min ? `${h.e.min} min` : ""}{p ? ` · ${p}/km` : ""}
                          </div>
                          {h.e.stitch && <div style={{ fontSize: 10, color: C.warn, fontWeight: 700 }}>STITCH 😣</div>}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
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
                              {pace(e.min, e.km) && (
                                <div style={{ fontSize: 11, color: C.accent, fontWeight: 700, marginBottom: 10 }}>Pace: {pace(e.min, e.km)} / km</div>
                              )}
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
