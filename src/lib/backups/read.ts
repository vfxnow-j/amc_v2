import "server-only";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BackupStatus, FileRead, VerifyStatus } from "./status";

/**
 * Where the scheduled backup scripts write (see scripts/backup-v2.sh): outside
 * the repo, so a re-clone or `git clean -fdx` cannot take the backups with it.
 */
export function backupRoot(): string {
  return process.env.BACKUP_ROOT || path.join(os.homedir(), "backups", "v2");
}

/** null: the file does not exist. "unreadable": it exists but cannot be used. */
async function readJson<T>(name: string): Promise<FileRead<T>> {
  let raw: string;
  try {
    raw = await readFile(path.join(backupRoot(), name), "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : "unreadable";
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : "unreadable";
  } catch {
    return "unreadable";
  }
}

export async function readBackupFiles(): Promise<{ status: FileRead<BackupStatus>; verify: FileRead<VerifyStatus> }> {
  const [status, verify] = await Promise.all([
    readJson<BackupStatus>("STATUS.json"),
    readJson<VerifyStatus>("VERIFY.json"),
  ]);
  return { status, verify };
}
