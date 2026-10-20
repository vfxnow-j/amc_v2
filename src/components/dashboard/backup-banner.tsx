import Link from "next/link";
import { Notice } from "@/components/feedback/notice";
import { readBackupFiles } from "@/lib/backups/read";
import { assessBackup, assessVerify } from "@/lib/backups/status";

/**
 * Super admin only (the caller decides): a red strip when backups are stale,
 * failed or have never run. Renders nothing when they are healthy, and nothing
 * if the status cannot be read at all beyond saying so.
 */
export async function BackupBanner() {
  const { status, verify } = await readBackupFiles();
  const problems = [assessBackup(status), assessVerify(verify)].filter((v) => v.state !== "ok");
  if (problems.length === 0) return null;
  return (
    <Notice tone="error" className="mb-3">
      {problems.map((p) => p.reason).join(" ")}{" "}
      <Link href="/dashboard/settings/entities" className="underline">
        Backup details
      </Link>
    </Notice>
  );
}
