import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { PrismaClient } from '../../../src/generated/prisma/client'
import { assertV2Database } from '../../../src/lib/db-guard'

/** ADAPTED from v1: Prisma client on v2's DATABASE_URL, every session read-only. Scripts use this, never src/lib/prisma. */
export function amcReadonlyPrisma(url = process.env.DATABASE_URL): PrismaClient {
  if (!url) throw new Error('DATABASE_URL (v2) is not set')
  assertV2Database(url)
  const pool = new Pool({ connectionString: url.replace(/\?schema=public$/, ''), options: '-c default_transaction_read_only=on' })
  return new PrismaClient({ adapter: new PrismaPg(pool) } as never)
}
