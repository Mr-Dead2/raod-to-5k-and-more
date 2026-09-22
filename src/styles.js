import { C, tint } from "./data.js";

// ---------------------------------------------------------------------------
// The app's stylesheet, in Apple's idiom: true black ground, grouped surfaces,
// glass chrome, Dynamic Type–style text styles and iOS controls.
//
// It is a function because it reads the live `C` tokens — App injects it in a
// <style> element on every render, so switching accent re-themes the lot. The
// static base (fonts, custom properties) lives in app.css.
// ---------------------------------------------------------------------------
export const appCss = () => `
  html, body { background:${C.bg}; }
  body { overscroll-behavior-y: none; }

  /* ---- type: Apple's text styles. Tracking is size-specific: tighter as
         the type grows, near zero for body copy. ---- */
  .t-large   { font-family:var(--font-display); font-size:34px; line-height:1.12; font-weight:700; letter-spacing:-.024em; margin:0; }
  .t-title1  { font-family:var(--font-display); font-size:28px; line-height:1.15; font-weight:700; letter-spacing:-.022em; }
  .t-title2  { font-family:var(--font-display); font-size:22px; line-height:1.2;  font-weight:700; letter-spacing:-.019em; }
  .t-title3  { font-family:var(--font-display); font-size:20px; line-height:1.25; font-weight:600; letter-spacing:-.017em; }
  .t-headline{ font-size:17px; line-height:1.3;  font-weight:600; letter-spacing:-.014em; }
  .t-body    { font-size:17px; line-height:1.4;  letter-spacing:-.014em; }
  .t-callout { font-size:16px; line-height:1.4;  letter-spacing:-.012em; }
  .t-sub     { font-size:15px; line-height:1.38; letter-spacing:-.009em; }
  .t-foot    { font-size:13px; line-height:1.38; letter-spacing:-.003em; }
  .t-cap     { font-size:12px; line-height:1.34; }
  .t-cap2    { font-size:11px; line-height:1.25; letter-spacing:.006em; }
  .disp { font-family:var(--font-display); letter-spacing:-.02em; }
  .num  { font-family:var(--font-round); font-variant-numeric:tabular-nums; letter-spacing:-.012em; }
  .eyebrow { font-size:13px; font-weight:600; letter-spacing:.02em; text-transform:uppercase; color:${C.dim}; margin-bottom:1px; }
  .lab { font-size:13px; font-weight:500; letter-spacing:.012em; text-transform:uppercase; color:${C.dim}; }
  .gtext { background:${C.grad}; -webkit-background-clip:text; background-clip:text; color:transparent; }

  .tap { cursor:pointer; }
  .hscroll { display:flex; gap:8px; overflow-x:auto; scrollbar-width:none; -ms-overflow-style:none; }
  .hscroll::-webkit-scrollbar { display:none; }
  .hair { height:1px; background:var(--sep); transform:scaleY(.5); transform-origin:top; }

  /* ---- screen header + navigation bar ---- */
  .screen-head { display:flex; align-items:flex-end; gap:12px; margin:2px 0 18px; }
  .screen-trail { display:flex; align-items:center; gap:10px; flex-shrink:0; padding-bottom:3px; }
  .navbar { position:fixed; top:0; left:0; right:0; z-index:60; pointer-events:none; }
  .navbar-bg {
    position:absolute; left:0; right:0; top:0; height:calc(100% + 16px);
    background:linear-gradient(to bottom, rgba(0,0,0,.74), rgba(0,0,0,.56) 72%, rgba(0,0,0,0));
    -webkit-backdrop-filter:blur(18px) saturate(180%); backdrop-filter:blur(18px) saturate(180%);
    -webkit-mask-image:linear-gradient(to bottom, #000 68%, transparent); mask-image:linear-gradient(to bottom, #000 68%, transparent);
    opacity:var(--nav-p, 0);
  }
  .navbar-row { position:relative; max-width:620px; height:44px; margin:env(safe-area-inset-top) auto 0; display:flex; align-items:center; justify-content:center; padding:0 16px; }
  .navbar-title { font-size:17px; font-weight:600; letter-spacing:-.014em; max-width:58%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    opacity:var(--nav-p, 0); transform:translateY(calc((1 - var(--nav-p, 0)) * 5px)); }
  .navbar-trail { position:absolute; right:16px; top:50%; transform:translateY(-50%); display:flex; align-items:center; gap:9px; opacity:var(--nav-p, 0); pointer-events:none; visibility:hidden; }
  /* Out of the tab order and the accessibility tree until it can be seen. */
  .nav-scrolled .navbar-trail { visibility:visible; }
  .nav-collapsed .navbar-trail { pointer-events:auto; }

  /* ---- Liquid Glass ---- */
  .glass {
    background:linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.015) 55%), rgba(30,30,32,.56);
    -webkit-backdrop-filter:blur(24px) saturate(190%); backdrop-filter:blur(24px) saturate(190%);
    border:1px solid rgba(255,255,255,.1);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.14), 0 12px 32px -8px rgba(0,0,0,.6), 0 2px 6px rgba(0,0,0,.28);
  }
  .glass-btn { display:inline-flex; align-items:center; justify-content:center; border-radius:50%; padding:0; color:${C.text}; cursor:pointer; flex-shrink:0; }

  /* ---- tab bar ---- */
  .tabbar { position:fixed; left:0; right:0; bottom:0; z-index:50; padding:0 16px calc(10px + env(safe-area-inset-bottom)); pointer-events:none; }
  .tabbar-edge { position:absolute; left:0; right:0; bottom:0; height:calc(100px + env(safe-area-inset-bottom)); z-index:-1;
    background:linear-gradient(to top, rgba(0,0,0,.88) 28%, rgba(0,0,0,0));
    -webkit-backdrop-filter:blur(5px); backdrop-filter:blur(5px);
    -webkit-mask-image:linear-gradient(to top, #000 42%, transparent); mask-image:linear-gradient(to top, #000 42%, transparent); }
  .tabbar-track { pointer-events:auto; position:relative; max-width:420px; margin:0 auto; display:flex; padding:4px; border-radius:999px; touch-action:none; -webkit-user-select:none; user-select:none; }
  .tabbar-lens { position:absolute; left:4px; top:4px; bottom:4px; border-radius:999px; will-change:transform;
    background:linear-gradient(180deg, rgba(255,255,255,.16), rgba(255,255,255,.09));
    box-shadow:inset 0 1px 0 rgba(255,255,255,.2), inset 0 -1px 0 rgba(255,255,255,.05), 0 4px 14px -6px rgba(0,0,0,.5); }
  .tabbar-item { position:relative; z-index:1; flex:1; min-width:0; background:none; border:none; cursor:pointer; padding:6px 0 5px; min-height:54px !important;
    display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; transition:color .2s ease; }
  .tabbar-item span { font-size:10.5px; font-weight:600; letter-spacing:.01em; }
  .tabbar-item svg { transition:transform .14s ease-out; }
  .tabbar-item:active { transform:none !important; }
  .tabbar-item:active svg { transform:scale(.86); }

  /* ---- surfaces ---- */
  .card { position:relative; background:${C.surface}; border-radius:22px; box-shadow:inset 0 .5px 0 rgba(255,255,255,.07); }
  .card.accented {
    background:
      radial-gradient(120% 95% at 0% 0%, ${tint(C.accent, 0.2)}, transparent 58%),
      radial-gradient(90% 80% at 100% 0%, ${tint(C.accent2, 0.12)}, transparent 62%),
      ${C.surface};
    box-shadow:inset 0 .5px 0 ${tint(C.accent, 0.3)}, inset 0 0 0 .5px ${tint(C.accent, 0.1)};
  }
  .card.glow { box-shadow:inset 0 0 0 1px ${tint(C.accent, 0.38)}, 0 14px 36px -24px ${tint(C.accent, 0.8)}; }
  .card.flat { background:var(--fill4); box-shadow:none; }
  .well { background:var(--fill4); border-radius:14px; }

  /* ---- grouped lists ---- */
  .grp { margin-bottom:26px; scroll-margin-top:calc(env(safe-area-inset-top) + 56px); }
  .grp-head { display:flex; align-items:baseline; gap:10px; padding:0 16px 7px; font-size:13px; font-weight:500; letter-spacing:.012em; text-transform:uppercase; color:${C.dim}; }
  .grp-body { background:${C.surface}; border-radius:22px; overflow:hidden; box-shadow:inset 0 .5px 0 rgba(255,255,255,.07); }
  .grp-foot { padding:7px 16px 0; font-size:13px; line-height:1.38; color:${C.dim}; }
  .cell { position:relative; display:flex; align-items:center; gap:14px; width:100%; min-height:50px; padding:11px 16px;
    background:none; border:none; border-radius:0; text-align:left; color:${C.text}; font:inherit; }
  .grp-body > * + .cell::before, .cell + .cell::before, .sep::before {
    content:""; position:absolute; top:0; right:0; left:var(--inset, 16px); height:1px; background:var(--sep); transform:scaleY(.5); transform-origin:top; }
  .sep { position:relative; }
  button.cell { cursor:pointer; transition:background-color .25s ease; }
  button.cell:active { background:rgba(255,255,255,.08); transform:none !important; transition:none; }
  button.cell:disabled { opacity:.5; }
  .cell-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
  .cell-title { font-size:17px; line-height:1.3; letter-spacing:-.014em; }
  .cell-sub { font-size:13px; line-height:1.38; color:${C.dim}; }
  .cell-value { font-size:17px; letter-spacing:-.014em; color:${C.dim}; flex-shrink:0; text-align:right; }
  .cell-chev { display:flex; color:${C.dim2}; flex-shrink:0; margin-left:-6px; }
  .badge { display:inline-flex; align-items:center; justify-content:center; border-radius:8px; flex-shrink:0; box-shadow:inset 0 .5px 0 rgba(255,255,255,.35); }

  /* ---- buttons ---- */
  .cta { border:none !important; cursor:pointer; color:${C.onAccent} !important; font-weight:600;
    background:linear-gradient(180deg, rgba(255,255,255,.22), rgba(255,255,255,0) 62%), ${C.accent} !important;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.42), 0 10px 24px -14px ${tint(C.accent, 0.9)}; }
  .cta:disabled { opacity:.45; box-shadow:none; }
  .btn { display:inline-flex; align-items:center; justify-content:center; gap:7px; border:none; cursor:pointer; border-radius:999px;
    background:var(--fill3); color:${C.text}; font-size:15px; font-weight:600; letter-spacing:-.01em; padding:11px 18px; }
  .btn:disabled { opacity:.45; }
  .btn.tinted { background:${tint(C.accent, 0.16)}; color:${C.accent}; }
  .btn.danger { background:${tint(C.warn, 0.16)}; color:${C.warn}; }
  .link { background:none; border:none; padding:0; cursor:pointer; color:${C.accent}; font-weight:500; font-size:15px; letter-spacing:-.009em; }
  .chip { cursor:pointer; border-radius:999px; padding:8px 14px; font-size:14px; font-weight:600; letter-spacing:-.006em;
    border:none; background:var(--fill3); color:${C.text}; transition:background-color .2s ease, color .2s ease, transform .12s ease-out; }
  .chip.on { background:${C.accent}; color:${C.onAccent}; }
  .chip:disabled { opacity:.45; }

  /* ---- fields ---- */
  .inp { background:var(--fill3); border:1px solid transparent; color:${C.text}; border-radius:12px; padding:11px 13px; width:100%;
    font-size:17px; letter-spacing:-.014em; outline:none; transition:border-color .15s ease, box-shadow .15s ease; }
  .inp::placeholder { color:var(--label3); }
  .inp:focus { border-color:${tint(C.accent, 0.75)}; box-shadow:0 0 0 3px ${tint(C.accent, 0.16)}; }
  .inp:disabled { opacity:.5; }
  input[type="date"].inp, input[type="time"].inp { width:auto; padding:7px 11px; font-size:17px; }

  /* ---- segmented control ---- */
  .seg { position:relative; display:flex; padding:3px; border-radius:999px; background:var(--fill3); touch-action:pan-y; -webkit-user-select:none; user-select:none; }
  .seg > i { position:absolute; top:3px; bottom:3px; left:3px; border-radius:999px; will-change:transform;
    background:linear-gradient(180deg, #6c6c70, #5c5c60); box-shadow:0 3px 8px rgba(0,0,0,.28), inset 0 .5px 0 rgba(255,255,255,.24); }
  .seg > button { position:relative; z-index:1; flex:1; min-width:0; min-height:34px !important; background:none; border:none; cursor:pointer;
    padding:6px 2px; font-size:13.5px; font-weight:500; letter-spacing:-.006em; color:${C.text}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; transition:opacity .2s ease; }
  .seg > button.on { font-weight:600; }
  .seg > button:active { transform:none !important; }
  .seg > button:not(.on):active { opacity:.5; }

  /* ---- progress bar ---- */
  .bar { height:6px; border-radius:999px; background:var(--fill3); overflow:hidden; }
  .bar > i { display:block; height:100%; border-radius:999px; background:${C.grad}; transition:width .8s cubic-bezier(.2,.8,.2,1); }

  /* ---- iOS switch: the knob stretches under a finger ---- */
  .sw { position:relative; width:51px; height:31px; min-height:31px !important; flex-shrink:0; padding:0; border:none; border-radius:999px; cursor:pointer;
    background:rgba(120,120,128,.32); transition:background-color .25s ease; }
  .sw.on { background:${C.accent}; }
  .sw.on.muted { background:${C.gray}; }
  .sw b { position:absolute; top:2px; left:2px; width:27px; height:27px; border-radius:999px; background:#fff;
    box-shadow:0 3px 8px rgba(0,0,0,.18), 0 3px 1px rgba(0,0,0,.06); transition:transform .32s cubic-bezier(.3,.85,.3,1.04), width .2s ease; }
  .sw.on b { transform:translateX(20px); }
  .sw:active { transform:none !important; }
  .sw:active:not(:disabled) b { width:33px; }
  .sw.on:active:not(:disabled) b { transform:translateX(14px); }
  .sw:disabled { opacity:.4; cursor:default; }

  /* ---- stepper ---- */
  .stepper { display:inline-flex; align-items:center; height:34px; border-radius:999px; background:var(--fill3); overflow:hidden; flex-shrink:0; }
  .stepper button { width:46px; height:34px; min-height:34px !important; padding:0; border:none; background:none; color:${C.text}; cursor:pointer;
    display:flex; align-items:center; justify-content:center; transition:background-color .2s ease; }
  .stepper button:active { background:rgba(255,255,255,.1); transform:none !important; transition:none; }
  .stepper button:disabled { opacity:.3; }
  .stepper i { width:1px; height:18px; background:var(--sep); }

  /* ---- the round tick on every plan row (Reminders' circle) ---- */
  .tick { width:26px; height:26px; min-height:26px !important; flex-shrink:0; padding:0; border-radius:50%; cursor:pointer;
    display:flex; align-items:center; justify-content:center; background:transparent; border:1.8px solid ${C.gray}; color:${C.onAccent};
    transition:background-color .2s ease, border-color .2s ease; }

  /* ---- page ---- */
  .page { position:relative; z-index:1; max-width:620px; margin:0 auto; padding:calc(env(safe-area-inset-top) + 44px) 16px calc(116px + env(safe-area-inset-bottom)); }
  .ambient { position:absolute; left:0; right:0; top:0; height:380px; z-index:-1; pointer-events:none;
    background:radial-gradient(70% 58% at 18% 0%, ${tint(C.accent, 0.13)}, transparent 72%), radial-gradient(60% 50% at 100% 0%, ${tint(C.accent2, 0.07)}, transparent 70%); }
  .ring-btn { position:relative; padding:0; border:none; background:none; cursor:pointer; flex-shrink:0; border-radius:50%; }
  .ring-btn > span { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-weight:700; color:${C.text}; }
  .pill { display:inline-flex; align-items:center; font-size:12px; font-weight:700; letter-spacing:.01em; padding:3px 10px; border-radius:999px; line-height:1.35; }
  .tag { display:inline-flex; align-items:center; font-size:11px; font-weight:700; letter-spacing:.02em; padding:2px 7px; border-radius:6px; }

  /* ---- plan weeks ---- */
  .week-head { display:flex; align-items:center; gap:8px; padding:0 4px 9px; }
  .day-row { position:relative; display:flex; align-items:center; gap:14px; min-height:62px; padding:10px 14px 10px 16px; cursor:pointer; transition:background-color .25s ease; outline:none; }
  .day-row:active { background:rgba(255,255,255,.07) !important; transition:none; }
  .day-row:focus-visible { box-shadow:inset 0 0 0 2px ${tint(C.accent, 0.6)}; }
  .day-editor { padding:4px 16px 16px 56px; }
  .editor-row { display:flex; align-items:center; gap:10px; min-height:44px; margin-bottom:6px; font-size:15px; color:${C.text}; }

  /* ---- awards: medals ---- */
  .medal-btn { display:flex; flex-direction:column; align-items:center; text-align:center; background:none; border:none; padding:0 2px; cursor:pointer; min-height:0; color:inherit; }
  .medal-btn:disabled { cursor:default; }
  .medal { width:78px; height:78px; border-radius:50%; display:flex; align-items:center; justify-content:center; padding:4px;
    background:linear-gradient(145deg, ${C.surface3}, #232325); box-shadow:inset 0 1px 0 rgba(255,255,255,.08); }
  .medal > span { width:100%; height:100%; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:32px;
    background:radial-gradient(circle at 50% 30%, ${C.surface2}, #1a1a1c); filter:grayscale(1); opacity:.38; }
  .medal.got { background:conic-gradient(from 210deg, ${C.accent}, ${C.accent2}, #ffffff, ${C.accent}, ${C.accent2}, ${C.accent});
    box-shadow:0 10px 26px -12px ${tint(C.accent, 0.8)}, inset 0 1px 0 rgba(255,255,255,.4); }
  .medal.got > span { filter:none; opacity:1; background:radial-gradient(circle at 50% 28%, ${C.surface3}, #161618 72%); box-shadow:inset 0 2px 6px rgba(0,0,0,.6); }
  .medal-btn:not(:disabled):active .medal { transform:scale(.94); }
  .medal { transition:transform .15s ease-out; }

  /* ---- round clock buttons (the Clock app's stopwatch) ---- */
  .round-btn { width:80px; height:80px; min-height:80px !important; border-radius:50%; border:none; cursor:pointer; font-size:16px; font-weight:500;
    box-shadow:0 0 0 2px ${C.surface}, 0 0 0 3.5px rgba(255,255,255,.1); }
  .round-btn:disabled { opacity:.5; }

  /* ---- coach: Messages bubbles and composer ---- */
  .bubble { padding:10px 14px; font-size:16px; line-height:1.42; letter-spacing:-.011em; white-space:pre-wrap; border-radius:20px; word-wrap:break-word; }
  .bubble.me { background:${C.accent}; color:${C.onAccent}; border-bottom-right-radius:6px; }
  .bubble.them { background:${C.surface2}; color:${C.text}; border-bottom-left-radius:6px; }
  .composer { display:flex; align-items:center; gap:6px; background:var(--fill4); border-radius:999px; padding:4px 4px 4px 16px; box-shadow:inset 0 0 0 1px rgba(255,255,255,.07); }
  .composer:focus-within { box-shadow:inset 0 0 0 1px ${tint(C.accent, 0.6)}; }
  .composer input { flex:1; min-width:0; background:none; border:none; outline:none; color:${C.text}; font-size:16px; padding:8px 0; min-height:0; }
  .composer input::placeholder { color:var(--label3); }
  .send { width:34px; height:34px; min-height:34px !important; border-radius:50%; border:none; cursor:pointer; flex-shrink:0; padding:0;
    display:flex; align-items:center; justify-content:center; background:${C.accent}; color:${C.onAccent}; }
  .send:disabled { background:${C.surface3}; color:${C.dim}; }
  .send.stop { background:${C.line2}; color:${C.text}; }

  /* ---- history ---- */
  .split { display:flex; flex-direction:column; gap:2px; flex-shrink:0; padding:8px 12px; border-radius:12px; background:var(--fill4); min-width:62px; }

  /* disclosure rows */
  .cell-details > summary { list-style:none; }
  .cell-details > summary::-webkit-details-marker { display:none; }
  .cell-details[open] .cell-chev { transform:rotate(90deg); }
  .cell-details .cell-chev { transition:transform .3s cubic-bezier(.3,.8,.3,1); }
  .cell-details { position:relative; }
  .grp-body > * + .cell-details::before { content:""; position:absolute; top:0; right:0; left:60px; height:1px; background:var(--sep); transform:scaleY(.5); transform-origin:top; z-index:1; }

  /* ---- sheets ---- */
  .sheet { position:relative; width:100%; max-width:560px; max-height:94vh; display:flex; flex-direction:column; will-change:transform;
    background:${C.surface}; border-radius:34px 34px 0 0;
    box-shadow:inset 0 .5px 0 rgba(255,255,255,.12), 0 -20px 60px -10px rgba(0,0,0,.75); }
  .sheet-handle { padding:6px 20px 0; touch-action:none; cursor:grab; flex-shrink:0; -webkit-user-select:none; user-select:none; }
  .sheet-handle:active { cursor:grabbing; }
  .grabber { width:36px; height:5px; border-radius:3px; background:var(--label3); margin:0 auto 10px; }
  .sheet-body { overflow-y:auto; overscroll-behavior:contain; padding:0 20px calc(20px + env(safe-area-inset-bottom)); }
  .close-btn { width:30px; height:30px; min-height:30px !important; flex-shrink:0; padding:0; border:none; border-radius:50%; cursor:pointer;
    background:var(--fill3); color:${C.dim}; display:flex; align-items:center; justify-content:center; }
  .sheet-action { display:flex; flex-direction:column; align-items:center; gap:7px; min-height:0 !important; padding:0; border:none; background:none; cursor:pointer;
    color:${C.text}; font-size:12px; font-weight:500; }
  .sheet-action > span { width:58px; height:58px; border-radius:50%; background:var(--fill3); display:flex; align-items:center; justify-content:center; transition:background-color .2s ease; }
  .sheet-action:active > span { background:var(--fill); }
  .sheet-action:disabled { opacity:.45; }

  /* ---- run tracker (Workout) ---- */
  .tracker { position:fixed; inset:0; z-index:200; overflow-y:auto; overscroll-behavior:contain; color:${C.text};
    background:radial-gradient(110% 48% at 50% -8%, ${tint(C.accent, 0.12)}, transparent 62%), ${C.bg};
    animation:coverUp .44s cubic-bezier(.2,.9,.25,1) both; }
  .tracker-inner { max-width:560px; min-height:100%; margin:0 auto; padding:max(14px, env(safe-area-inset-top)) 16px 0; display:flex; flex-direction:column; }
  .tracker-body { flex:1; display:flex; flex-direction:column; }
  .tracker-dock { position:sticky; bottom:0; z-index:5; margin-top:auto; padding:22px 0 calc(14px + env(safe-area-inset-bottom));
    background:linear-gradient(to top, ${C.bg} 64%, rgba(0,0,0,0)); }
  .gps-pill { display:inline-flex; align-items:center; gap:6px; font-size:13px; font-weight:600; padding:5px 11px; border-radius:999px; background:var(--fill3); white-space:nowrap; }
  .gps-pill i { width:8px; height:8px; border-radius:50%; }
  .round-ctl { display:flex; flex-direction:column; align-items:center; gap:8px; min-height:0 !important; padding:0; border:none; background:none; cursor:pointer; color:${C.text}; }
  .round-ctl > span:first-child { width:78px; height:78px; border-radius:50%; display:flex; align-items:center; justify-content:center; transition:transform .12s ease-out; }
  .round-ctl:active { transform:none !important; }
  .round-ctl:active > span:first-child { transform:scale(.92); }
  .countdown { position:fixed; inset:0; z-index:10; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.9);
    -webkit-backdrop-filter:blur(24px); backdrop-filter:blur(24px); animation:fadeIn .2s ease both; }
  .count-ring { animation:drain 1s linear forwards; }
  .split-row { display:flex; align-items:center; gap:12px; padding:9px 0; border-top:.5px solid var(--sep); }
  .split-bar { flex:1; height:8px; border-radius:999px; background:var(--fill4); overflow:hidden; }
  .split-bar > i { display:block; height:100%; border-radius:999px; background:${C.grad}; }

  /* ---- route planner (Maps: the map is the screen, controls float on glass) ---- */
  .rm { position:fixed; inset:0; z-index:9999; background:${C.bg}; color:${C.text}; animation:coverUp .44s cubic-bezier(.2,.9,.25,1) both; }
  .rm-build, .rm-map { position:absolute; inset:0; }
  .rm-head { position:absolute; left:0; right:0; top:0; z-index:700; display:flex; align-items:center; gap:10px;
    padding:calc(env(safe-area-inset-top) + 10px) 14px 0; pointer-events:none; }
  .rm-head > * { pointer-events:auto; }
  .rm-stats { position:absolute; z-index:600; left:14px; right:14px; max-width:560px; margin:0 auto; top:calc(env(safe-area-inset-top) + 66px); border-radius:22px; padding:10px 16px 12px; }
  .rm-panel { position:absolute; z-index:600; left:10px; right:10px; max-width:580px; margin:0 auto; bottom:calc(10px + env(safe-area-inset-bottom)); border-radius:30px; padding:14px 14px 14px; }
  .rm-float { position:absolute; left:4px; right:4px; bottom:calc(100% + 12px); display:flex; align-items:flex-end; gap:10px; }
  .rm-saved { position:absolute; inset:0; overflow-y:auto; padding:calc(env(safe-area-inset-top) + 72px) 16px calc(24px + env(safe-area-inset-bottom)); }
  .rm .leaflet-bottom { bottom:calc(var(--panel-h, 0px) + 14px + env(safe-area-inset-bottom)); }
  .km-field { display:flex; align-items:center; height:44px; border-radius:999px; background:var(--fill3); flex-shrink:0; }
  .km-field button { width:40px; height:44px; min-height:44px !important; padding:0; border:none; background:none; color:${C.text}; cursor:pointer; display:flex; align-items:center; justify-content:center; }
  .km-field button:active { transform:none !important; opacity:.5; }
  .km-field input { width:46px; min-height:0; padding:0; border:none; background:none; color:${C.text}; font-size:18px; font-weight:600; text-align:center; outline:none; -moz-appearance:textfield; }
  .km-field input::-webkit-outer-spin-button, .km-field input::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
  .km-field span { font-size:15px; color:${C.dim}; margin-right:2px; }

  /* ---- route replay ---- */
  .rp { position:fixed; inset:0; z-index:200; background:${C.bg}; color:${C.text}; animation:coverUp .44s cubic-bezier(.2,.9,.25,1) both; }
  .rp-map { position:absolute; inset:0; }
  .rp .leaflet-bottom { bottom:calc(var(--panel-h, 190px) + 14px + env(safe-area-inset-bottom)); }
  .scrub { position:relative; height:32px; flex:1; cursor:pointer; touch-action:none; display:flex; align-items:center; }
  .scrub-track { position:absolute; left:0; right:0; height:6px; border-radius:999px; background:var(--fill); overflow:hidden; }
  .scrub-track > i { display:block; height:100%; background:${C.grad}; border-radius:999px; }
  .scrub-thumb { position:absolute; top:50%; width:28px; height:28px; margin:-14px 0 0 -14px; border-radius:50%; background:#fff;
    box-shadow:0 3px 8px rgba(0,0,0,.3), 0 0 0 .5px rgba(0,0,0,.06); transition:transform .15s ease-out; }
  .scrub.dragging .scrub-thumb { transform:scale(1.12); }

  /* ---- metric grid (a workout summary) ---- */
  .mgrid { display:grid; column-gap:16px; }
  .mcell { padding:11px 0; border-top:.5px solid rgba(84,84,88,.75); min-width:0; }

  /* ---- Dynamic Island toast ---- */
  .island { position:fixed; top:calc(8px + env(safe-area-inset-top)); left:50%; transform:translateX(-50%); z-index:9998;
    width:min(390px, calc(100% - 20px)); pointer-events:none; }
  .island > div { display:flex; align-items:center; gap:12px; background:${C.bg}; border-radius:30px; padding:9px 20px 9px 9px;
    box-shadow:0 0 0 1px rgba(255,255,255,.1), 0 22px 46px -12px rgba(0,0,0,.85); transform-origin:50% 0;
    animation:islandIn .62s cubic-bezier(.2,1.18,.32,1) both; }
  .island.out > div { animation:islandOut .3s cubic-bezier(.5,0,.75,.2) both; }
  .island-icon { width:42px; height:42px; border-radius:50%; background:${C.surface}; display:flex; align-items:center; justify-content:center; font-size:22px; flex-shrink:0; }
  .island-label { display:block; font-size:12px; font-weight:600; color:${C.accent}; }
  .island-label::first-letter { text-transform:uppercase; }
  .island-title { display:block; font-size:15px; line-height:1.3; font-weight:600; letter-spacing:-.01em; color:${C.text}; }

  /* ---- Leaflet chrome matched to the ground ---- */
  .leaflet-container { background:${C.bg}; font-family:var(--font); }
  .leaflet-control-attribution { background:rgba(0,0,0,.6) !important; color:${C.dim2} !important; font-size:9px !important; border-radius:6px 0 0 0; }
  .leaflet-control-attribution a { color:${C.dim} !important; }

  /* ---- motion: short, purposeful ---- */
  @keyframes rise { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:none } }
  @keyframes pop { 0% { transform:scale(.7) } 55% { transform:scale(1.14) } 100% { transform:scale(1) } }
  @keyframes cellIn { from { opacity:0; transform:scale(.5) } to { opacity:1; transform:none } }
  @keyframes slideUp { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:none } }
  @keyframes spin { to { transform:rotate(360deg) } }
  @keyframes blink { 0%,45% { opacity:1 } 55%,100% { opacity:.15 } }
  @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
  @keyframes coverUp { from { opacity:0; transform:translateY(36px) } to { opacity:1; transform:none } }
  @keyframes drain { from { stroke-dashoffset:0 } to { stroke-dashoffset:100 } }
  @keyframes barUp { from { transform:scaleY(0) } to { transform:scaleY(1) } }
  @keyframes fadeOut { from { opacity:1 } to { opacity:0 } }
  @keyframes islandIn { 0% { opacity:0; transform:scale(.3,.45); filter:blur(8px) } 45% { opacity:1; filter:blur(0) } 100% { opacity:1; transform:none; filter:none } }
  @keyframes islandOut { 0% { opacity:1; transform:none; filter:none } 100% { opacity:0; transform:scale(.3,.45); filter:blur(8px) } }
  .caret { animation:blink .9s steps(1,end) infinite; }
  .rise { animation:rise .34s cubic-bezier(.2,.8,.2,1) both; }
  .pop { animation:pop .34s cubic-bezier(.3,.7,.4,1); }
  .stagger { opacity:0; animation:slideUp .5s cubic-bezier(.2,.8,.2,1) forwards; }
  .spin { animation:spin 1s linear infinite; }

  /* Small phones: a notch smaller, as iOS sets large titles on an SE. */
  @media (max-width: 350px) {
    .t-large { font-size:30px; }
    .seg > button { font-size:12.5px; letter-spacing:-.015em; }
    .screen-trail { gap:8px; }
  }

  /* Reduced motion is not "no feedback": slides and springs become short
     cross-fades, and nothing scales, bounces or drifts. */
  @media (prefers-reduced-motion: reduce) {
    .stagger, .rise, .pop, .spin, .caret { animation:none !important; }
    .tracker { animation:fadeIn .2s ease both !important; }
    .stagger { opacity:1; }
    .island > div { animation:fadeIn .2s ease both !important; }
    .island.out > div { animation:fadeOut .2s ease both !important; }
  }
  @media (prefers-reduced-transparency: reduce) {
    .glass { background:${C.surface} !important; -webkit-backdrop-filter:none !important; backdrop-filter:none !important; }
    .navbar-bg { background:${C.bg} !important; -webkit-backdrop-filter:none !important; backdrop-filter:none !important; -webkit-mask-image:none; mask-image:none; }
    .tabbar-edge { -webkit-backdrop-filter:none !important; backdrop-filter:none !important; }
  }
  @media (prefers-contrast: more) {
    .glass { background:${C.surface} !important; border-color:rgba(255,255,255,.5) !important; }
    .card, .grp-body { box-shadow:inset 0 0 0 1px ${C.gray}; }
    .grp-body > * + .cell::before, .cell + .cell::before, .sep::before, .hair { transform:none; background:${C.gray}; }
    .seg > i { background:${C.dim}; }
  }
`;
