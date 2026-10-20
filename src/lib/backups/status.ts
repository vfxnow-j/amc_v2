/**
 * Reading the backup status files. Pure: JSON in, a verdict out, so a server
 * component and the tests share it. The files are written by
 * scripts/backup-v2.sh (STATUS.json) and scripts/verify-backups.sh (VERIFY.json).
 */

export const BACKUP_MAX_AGE_HOURS = 26;
/** The restore test runs daily, an hour after the backup. */
export const VERIFY_MAX_AGE_HOURS = 26;

export type BackupState = "ok" | "stale" | "failed" | "never" | "unreadable";

/** What read.ts hands over: the parsed file, null when it does not exist, "unreadable" when it exists but cannot be used. */
export type FileRead<T> = T | null | "unreadable";

export type BackupStatus = {
  lastRunAt?: unknown;
  ok?: unknown;
  setDir?: unknown;
  databases?: unknown;
  errors?: unknown;
  unregistered?: unknown;
  oldestKeptSet?: unknown;
  keptSets?: unknown;
  warnings?: unknown;
  /** ok | failed | partial | suspect, written by backup-v2.sh. */
  outcome?: unknown;
};

export type VerifyStatus = {
  verifiedAt?: unknown;
  ok?: unknown;
  setDir?: unknown;
  checks?: unknown;
};

export type Verdict = { state: BackupState; ageHours: number | null; reason: string };

function judge(
  at: unknown,
  ok: unknown,
  now: Date,
  maxAgeHours: number,
  what: string,
  outcome?: unknown,
): Verdict {
  const time = typeof at === "string" ? Date.parse(at) : NaN;
  if (Number.isNaN(time)) {
    return { state: "failed", ageHours: null, reason: `The ${what} record is unreadable.` };
  }
  const ageHours = (now.getTime() - time) / 3_600_000;
  if (ageHours < -1) {
    return { state: "failed", ageHours, reason: `The ${what} record is dated in the future; the clock or the file is wrong.` };
  }
  if (ok !== true) {
    const why =
      outcome === "partial"
        ? `The last ${what} wrote a set but with problems (something was skipped or rotation failed).`
        : outcome === "suspect"
          ? `The last ${what} wrote a set that looks suspect (data shrank sharply since the previous one).`
          : `The last ${what} failed.`;
    return { state: "failed", ageHours, reason: why };
  }
  if (ageHours > maxAgeHours) {
    return {
      state: "stale",
      ageHours,
      reason: `The last good ${what} is ${Math.floor(ageHours)} hours old.`,
    };
  }
  return { state: "ok", ageHours, reason: "" };
}

/** `null`/`undefined` means the file does not exist: nothing has run. */
export function assessBackup(
  status: FileRead<BackupStatus> | undefined,
  now: Date = new Date(),
  maxAgeHours: number = BACKUP_MAX_AGE_HOURS,
): Verdict {
  if (status === "unreadable") {
    return { state: "unreadable", ageHours: null, reason: "The backup status file exists but could not be read." };
  }
  if (!status || typeof status !== "object") {
    return { state: "never", ageHours: null, reason: "No backup has run yet." };
  }
  return judge(status.lastRunAt, status.ok, now, maxAgeHours, "backup", status.outcome);
}

export function assessVerify(
  verify: FileRead<VerifyStatus> | undefined,
  now: Date = new Date(),
  maxAgeHours: number = VERIFY_MAX_AGE_HOURS,
): Verdict {
  if (verify === "unreadable") {
    return { state: "unreadable", ageHours: null, reason: "The restore test result exists but could not be read." };
  }
  if (!verify || typeof verify !== "object") {
    return { state: "never", ageHours: null, reason: "No restore test has run yet." };
  }
  return judge(verify.verifiedAt, verify.ok, now, maxAgeHours, "restore test");
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${i === 0 ? value : value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

/** Sum of `bytes` over the status's databases; tolerant of a malformed file. */
export function summariseDatabases(status: FileRead<BackupStatus> | undefined): {
  count: number;
  bytes: number;
} {
  const usable = status && status !== "unreadable" ? status : null;
  const list = Array.isArray(usable?.databases) ? (usable!.databases as unknown[]) : [];
  let bytes = 0;
  for (const d of list) {
    const b = (d as { bytes?: unknown } | null)?.bytes;
    if (typeof b === "number" && Number.isFinite(b)) bytes += b;
  }
  return { count: list.length, bytes };
}

/** Strings from a status field that should be a list of strings. */
export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export type Problem = { key: string; text: string };

/** The problems worth telling someone about: one per source, keyed by what is wrong. */
export function problemsFrom(backup: Verdict, restore: Verdict): Problem[] {
  const out: Problem[] = [];
  if (backup.state !== "ok") out.push({ key: `backup:${backup.state}`, text: backup.reason });
  if (restore.state !== "ok") out.push({ key: `restore-test:${restore.state}`, text: restore.reason });
  return out;
}

/**
 * Which problems to mail now: those not mailed within `quietHours`. Also
 * returns the next dedupe state, with problems that have cleared dropped so
 * they alert again if they come back.
 */
export function dueAlerts(
  problems: Problem[],
  sent: Record<string, string>,
  now: Date,
  quietHours = 24,
): { send: Problem[]; next: Record<string, string> } {
  const next: Record<string, string> = {};
  const send: Problem[] = [];
  for (const p of problems) {
    const last = Date.parse(sent[p.key] ?? "");
    const quiet = !Number.isNaN(last) && now.getTime() - last < quietHours * 3_600_000 && now.getTime() >= last;
    if (quiet) next[p.key] = sent[p.key];
    else {
      send.push(p);
      next[p.key] = now.toISOString();
    }
  }
  return { send, next };
}
