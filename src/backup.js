// ---------------------------------------------------------------------------
// Backup freshness.
//
// Everything the app knows lives in localStorage on one device: clear the site
// data, lose the phone, or reinstall the APK and 28 sessions are gone. Export
// has always existed but it is manual, and nothing ever reminded anyone — which
// makes it a safety net only for people who did not need one.
//
// So: remember when the log was last written out, notice when that is stale
// *relative to what would actually be lost*, and say so. The pure logic lives
// here; App owns the writing and the UI.
// ---------------------------------------------------------------------------

/** How many sessions may pile up unbacked before it is worth mentioning. */
const NAG_SESSIONS = 4;
/** …and how long, for someone who trains less often. */
const NAG_DAYS = 21;
/** Automatic native backups are cheap, but not worth writing more often. */
export const AUTO_INTERVAL_MS = 7 * 86400000;

const DAY_MS = 86400000;

export const daysSince = (iso, now = Date.now()) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY_MS));
};

/** Sessions with anything worth keeping in them. */
export const countSessions = (log) =>
  Object.values(log || {}).filter((e) => e && (e.done || parseFloat(e.km) > 0)).length;

/**
 * Should the app say something about backing up?
 *
 * Deliberately quiet in two cases that would otherwise generate noise: an empty
 * log has nothing to lose, and a backup taken since the last session is already
 * current however old it is. The nag is about *unprotected work*, not about the
 * calendar.
 *
 * Returns { stale, never, sessions, unsaved, days, reason } — `reason` is null
 * when there is nothing to say.
 */
export function backupState({ log, lastBackupAt, sessionsAtLastBackup = 0, now = Date.now() }) {
  const sessions = countSessions(log);
  const days = daysSince(lastBackupAt, now);
  const unsaved = Math.max(0, sessions - (lastBackupAt ? sessionsAtLastBackup : 0));

  if (sessions === 0) {
    return { stale: false, never: !lastBackupAt, sessions, unsaved: 0, days, reason: null };
  }
  if (!lastBackupAt) {
    return {
      stale: true, never: true, sessions, unsaved: sessions, days: null,
      reason: `${sessions} session${sessions === 1 ? "" : "s"} logged and never backed up. They live only on this phone.`,
    };
  }
  if (unsaved >= NAG_SESSIONS) {
    return {
      stale: true, never: false, sessions, unsaved, days,
      reason: `${unsaved} session${unsaved === 1 ? "" : "s"} logged since your last backup.`,
    };
  }
  if (unsaved > 0 && days != null && days >= NAG_DAYS) {
    return {
      stale: true, never: false, sessions, unsaved, days,
      reason: `Last backed up ${days} days ago, with ${unsaved} session${unsaved === 1 ? "" : "s"} logged since.`,
    };
  }
  return { stale: false, never: false, sessions, unsaved, days, reason: null };
}

/** "Backed up today" / "Backed up 3 days ago" / "Never backed up". */
export function backupLabel({ lastBackupAt, now = Date.now() }) {
  const days = daysSince(lastBackupAt, now);
  if (days == null) return "Never backed up";
  if (days === 0) return "Backed up today";
  if (days === 1) return "Backed up yesterday";
  return `Backed up ${days} days ago`;
}

/** Whether an automatic native backup is due. */
export const autoDue = ({ lastAutoAt, log, now = Date.now() }) =>
  countSessions(log) > 0 && (!lastAutoAt || now - new Date(lastAutoAt).getTime() >= AUTO_INTERVAL_MS);

export const backupFilename = (date = new Date()) =>
  `stride-backup-${new Date(date).toISOString().slice(0, 10)}.json`;
