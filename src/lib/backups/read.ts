import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BackupStatus, VerifyStatus } from "./status";

/** Where the scheduled backup scripts write (see scripts/backup-v2.sh). */
export function backupRoot(): string {
  return process.env.BACKUP_ROOT || path.join(process.cwd(), "backups", "scheduled");
}

async function readJson<T>(name: string): Promise<T | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(backupRoot(), name), "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    // Missing or unreadable: callers treat both as "nothing has run".
    return null;
  }
}

export async function readBackupFiles(): Promise<{ status: BackupStatus | null; verify: VerifyStatus | null }> {
  const [status, verify] = await Promise.all([
    readJson<BackupStatus>("STATUS.json"),
    readJson<VerifyStatus>("VERIFY.json"),
  ]);
  return { status, verify };
}
