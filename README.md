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

This app auto-publishes to **GitHub Pages**. One-time setup:

1. On GitHub, open this repo → **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Make sure the latest code is on the **`main`** branch (merge this branch into
   `main`). Every push to `main` rebuilds and deploys automatically.
4. Wait for the green check on the **Actions** tab, then your link appears at the
   top of the Pages settings — it looks like:
   `https://<your-username>.github.io/raod-to-5k-and-more/`

Then on your phone:

5. Open that link in **Chrome**.
6. Tap the **⋮ menu → Install app** (or "Add to Home Screen"). An icon appears on
   your home screen.
7. Open it from the icon, go to the **Stats** tab, turn on **Daily Reminder**,
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
