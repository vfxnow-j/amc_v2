import 'dotenv/config'
import { Pool } from 'pg'
import { assertV2Database } from '../../../src/lib/db-guard'

// ADAPTED from v1: (1) the staging pool resolves the derived tables (unit_match, unit_sale,
// sale_hole, unit_last_seen, po_line_link, current_only) in schema `rms_v2` first, so v2 derivations
// never overwrite the v1-based ones in `public`; raw_record / pull_run / views fall through to
// `public`. (2) "amcReadonlyPool" is v2's own database, opened read-only at the session level.
const clean = (url: string) => url.replace(/\?schema=public$/, '')

export function stagingPool(): Pool {
  const url = process.env.CURRENT_RMS_STAGING_URL
  if (!url) throw new Error('CURRENT_RMS_STAGING_URL is not set')
  return new Pool({ connectionString: clean(url), options: '-c search_path=rms_v2,public' })
}

/** v2 database, every session read-only (Postgres rejects writes). */
export function amcReadonlyPool(): Pool {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL (v2) is not set')
  assertV2Database(url)
  return new Pool({ connectionString: clean(url), options: '-c default_transaction_read_only=on' })
}

/** v2 database for the apply script only (read-write). */
export function amcWritePool(): Pool {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL (v2) is not set')
  assertV2Database(url)
  return new Pool({ connectionString: clean(url) })
}

/** Refuse to run a derive/report if the v2 derived-tables schema is missing (otherwise TRUNCATE would hit v1's tables in `public`). */
export async function assertV2Schema(staging: Pool): Promise<void> {
  const { rows } = await staging.query(`SELECT to_regclass('rms_v2.unit_match') AS a, to_regclass('rms_v2.unit_sale') AS b, to_regclass('rms_v2.sale_hole') AS c, to_regclass('rms_v2.unit_last_seen') AS d, to_regclass('rms_v2.po_line_link') AS e, to_regclass('rms_v2.current_only') AS f`)
  if (Object.values(rows[0]).some((v) => v == null)) throw new Error('staging schema rms_v2 is incomplete; apply scripts/current-rms/staging-v2.sql first')
}
