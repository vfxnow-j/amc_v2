/**
 * Reading the backup status files. Pure: JSON in, a verdict out, so a server
 * component and the tests share it. The files are written by
 * scripts/backup-v2.sh (STATUS.json) and scripts/verify-backups.sh (VERIFY.json).
 */

export const BACKUP_MAX_AGE_HOURS = 26;
/** The verify runs weekly; flag it once a run has been missed. */
export const VERIFY_MAX_AGE_HOURS = 24 * 8;

export type BackupState = "ok" | "stale" | "failed" | "never";

export type BackupStatus = {
  lastRunAt?: unknown;
  ok?: unknown;
  setDir?: unknown;
  databases?: unknown;
  errors?: unknown;
  unregistered?: unknown;
  oldestKeptSet?: unknown;
  keptSets?: unknown;
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
): Verdict {
  const time = typeof at === "string" ? Date.parse(at) : NaN;
  if (Number.isNaN(time)) {
    return { state: "failed", ageHours: null, reason: `The ${what} record is unreadable.` };
  }
  const ageHours = (now.getTime() - time) / 3_600_000;
  if (ok !== true) {
    return { state: "failed", ageHours, reason: `The last ${what} failed.` };
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
  status: BackupStatus | null | undefined,
  now: Date = new Date(),
  maxAgeHours: number = BACKUP_MAX_AGE_HOURS,
): Verdict {
  if (!status || typeof status !== "object") {
    return { state: "never", ageHours: null, reason: "No backup has run yet." };
  }
  return judge(status.lastRunAt, status.ok, now, maxAgeHours, "backup");
}

export function assessVerify(
  verify: VerifyStatus | null | undefined,
  now: Date = new Date(),
  maxAgeHours: number = VERIFY_MAX_AGE_HOURS,
): Verdict {
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
export function summariseDatabases(status: BackupStatus | null | undefined): {
  count: number;
  bytes: number;
} {
  const list = Array.isArray(status?.databases) ? (status!.databases as unknown[]) : [];
  let bytes = 0;
  for (const d of list) {
    const b = (d as { bytes?: unknown } | null)?.bytes;
    if (typeof b === "number" && Number.isFinite(b)) bytes += b;
  }
  return { count: list.length, bytes };
}
