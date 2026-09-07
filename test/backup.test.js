import { describe, it, expect } from "vitest";
import {
  backupState, backupLabel, countSessions, daysSince, autoDue, backupFilename, AUTO_INTERVAL_MS,
} from "../src/backup.js";

const NOW = new Date("2026-06-01T12:00:00Z").getTime();
const ago = (days) => new Date(NOW - days * 86400000).toISOString();
const logOf = (n) => Object.fromEntries(
  Array.from({ length: n }, (_, i) => [`w1d${i}`, { done: true, km: 5 }]),
);

describe("countSessions", () => {
  it("counts only entries with something in them", () => {
    expect(countSessions({ a: { done: true }, b: { km: 5 }, c: {}, d: null })).toBe(2);
    expect(countSessions({})).toBe(0);
    expect(countSessions(null)).toBe(0);
  });

  it("does not count a day that was merely opened", () => {
    // Typing a note without ticking the day or logging a distance is not work
    // worth nagging about.
    expect(countSessions({ a: { note: "felt ok" } })).toBe(0);
  });
});

describe("daysSince", () => {
  it("counts whole days and never goes negative", () => {
    expect(daysSince(ago(0), NOW)).toBe(0);
    expect(daysSince(ago(3), NOW)).toBe(3);
    expect(daysSince(new Date(NOW + 86400000).toISOString(), NOW)).toBe(0);
  });

  it("has no answer for a missing or unparseable stamp", () => {
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince("nonsense", NOW)).toBeNull();
  });
});

describe("backupState", () => {
  it("says nothing when there is nothing to lose", () => {
    const s = backupState({ log: {}, lastBackupAt: null, now: NOW });
    expect(s.stale).toBe(false);
    expect(s.reason).toBeNull();
  });

  it("speaks up as soon as real work has never been backed up", () => {
    const s = backupState({ log: logOf(3), lastBackupAt: null, now: NOW });
    expect(s.stale).toBe(true);
    expect(s.never).toBe(true);
    expect(s.reason).toMatch(/never backed up/i);
    expect(s.reason).toContain("3 sessions");
  });

  it("stays quiet while the backup still covers everything logged", () => {
    // Backed up six months ago, but nothing has happened since.
    const s = backupState({ log: logOf(5), lastBackupAt: ago(180), sessionsAtLastBackup: 5, now: NOW });
    expect(s.stale).toBe(false);
    expect(s.reason).toBeNull();
  });

  it("nags once enough new work has piled up, however recent the backup", () => {
    const s = backupState({ log: logOf(9), lastBackupAt: ago(1), sessionsAtLastBackup: 5, now: NOW });
    expect(s.stale).toBe(true);
    expect(s.unsaved).toBe(4);
    expect(s.reason).toMatch(/4 sessions logged since/i);
  });

  it("does not nag over one or two new sessions", () => {
    expect(backupState({ log: logOf(7), lastBackupAt: ago(2), sessionsAtLastBackup: 5, now: NOW }).stale).toBe(false);
  });

  it("also nags on age, for someone who trains rarely", () => {
    // Only one session since, but it has been three weeks.
    const s = backupState({ log: logOf(6), lastBackupAt: ago(25), sessionsAtLastBackup: 5, now: NOW });
    expect(s.stale).toBe(true);
    expect(s.reason).toMatch(/25 days ago/);
  });

  it("counts everything as unsaved when the count was never recorded", () => {
    // An older install has a timestamp but no session count.
    const s = backupState({ log: logOf(6), lastBackupAt: ago(1), now: NOW });
    expect(s.unsaved).toBe(6);
    expect(s.stale).toBe(true);
  });

  it("reports the numbers it based the decision on", () => {
    const s = backupState({ log: logOf(9), lastBackupAt: ago(4), sessionsAtLastBackup: 2, now: NOW });
    expect(s).toMatchObject({ sessions: 9, unsaved: 7, days: 4 });
  });
});

describe("backupLabel", () => {
  it("reads like a person would say it", () => {
    expect(backupLabel({ lastBackupAt: ago(0), now: NOW })).toBe("Backed up today");
    expect(backupLabel({ lastBackupAt: ago(1), now: NOW })).toBe("Backed up yesterday");
    expect(backupLabel({ lastBackupAt: ago(9), now: NOW })).toBe("Backed up 9 days ago");
    expect(backupLabel({ lastBackupAt: null, now: NOW })).toBe("Never backed up");
  });
});

describe("autoDue", () => {
  it("waits a week between automatic writes", () => {
    expect(autoDue({ lastAutoAt: ago(3), log: logOf(2), now: NOW })).toBe(false);
    expect(autoDue({ lastAutoAt: ago(8), log: logOf(2), now: NOW })).toBe(true);
    expect(autoDue({ lastAutoAt: null, log: logOf(2), now: NOW })).toBe(true);
  });

  it("never writes a backup of nothing", () => {
    expect(autoDue({ lastAutoAt: null, log: {}, now: NOW })).toBe(false);
  });

  it("fires exactly on the boundary", () => {
    expect(autoDue({ lastAutoAt: new Date(NOW - AUTO_INTERVAL_MS).toISOString(), log: logOf(1), now: NOW })).toBe(true);
  });
});

describe("backupFilename", () => {
  it("is dated, so successive backups do not overwrite each other", () => {
    expect(backupFilename(new Date("2026-06-01T12:00:00Z"))).toBe("stride-backup-2026-06-01.json");
  });
});
