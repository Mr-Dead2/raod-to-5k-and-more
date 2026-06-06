# Road to 5K 🏃

A 4-week training app to build up to a continuous 5 km run. Tick off each day,
log your distance/time, watch your charts grow, and get a daily reminder to run.
It installs to your phone like a normal app and works offline.

![icon](public/icons/icon-192.png)

## Features

- **4-week plan** with run / easy / rest days and side-stitch tips.
- **Stats**: km logged, best streak, runs done, stitch count, and a live stopwatch.
- **Charts**: km per week (logged vs plan) and your cumulative distance curve.
- **History**: every completed session with distance, time, pace, and notes.
- **Daily reminders**: a notification nudging you to do today's session.
- **Installable PWA**: add to your home screen, works offline, your data stays on your phone.

---

## Put it on your phone (Nothing Phone / any Android)

You need to host the built app somewhere with an `https://` link, then install
that link on your phone. Pick whichever host is easiest for you — the project is
pre-configured for all of them.

### Option A — Netlify (easiest, works from your phone, free, even for private repos)

1. Go to **netlify.com** and sign up (you can log in with GitHub).
2. **Add new site → Import an existing project → GitHub**, authorize, and pick
   this repo.
3. The build settings auto-fill from `netlify.toml` (command `npm run build`,
   publish `dist`). Click **Deploy**.
4. After ~1 minute you get a link like `https://<random-name>.netlify.app`.

> Cloudflare Pages and Vercel work the same way — import the repo, deploy. They
> auto-detect the Vite settings (Cloudflare: build command `npm run build`,
> output `dist`).

### Option B — GitHub Pages

1. Repo → **Settings → Pages → Source → "GitHub Actions"**.
2. Merge this branch into **`main`** (every push to `main` auto-deploys).
3. Your link appears in the Pages settings:
   `https://<username>.github.io/raod-to-5k-and-more/`
   (Note: GitHub Pages on a **private** repo needs a paid plan — use Option A if
   yours is private.)

### Then, on your phone

1. Open your link in **Chrome**.
2. Tap **⋮ menu → Install app** (or "Add to Home Screen"). An icon appears.
3. Open it from the icon, go to the **Stats** tab, turn on **Daily Reminder**,
   pick a time, and **Allow** notifications when asked.

> Heads up on reminders: a website can't fire an exact alarm when it's fully
> closed the way a built-in alarm app can. Installing it (step 6) gives the most
> reliable reminders — your phone will catch up and notify you the next time the
> app wakes in the background. If you ever miss one, opening the app shows
> today's session straight away.

---

## Run it on a computer (for development)

```bash
npm install      # Node 20+
npm run icons    # generate the app icons (first time only)
npm run dev      # start the dev server, open the printed URL
npm run build    # production build into dist/
npm run preview  # preview the production build
```

See `CLAUDE.md` for the code architecture.
