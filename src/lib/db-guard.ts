/**
 * Refuses any connection that is not v2's own database.
 *
 * v1 is live. Both databases sit in the same Postgres container, reachable by
 * the same superuser, and the only thing separating them is the name on the end
 * of DATABASE_URL. `prisma db push --accept-data-loss` — which the refresh
 * script runs as a matter of course — rewrites the schema of whatever database
 * it is pointed at, without asking twice.
 *
 * Pointing v2 at v1 to compare against real production data is a reasonable
 * thing to want and a catastrophic thing to do, and it is one edited line away
 * at any time. So the name is checked rather than trusted, at the two places
 * every connection passes through: prisma.config.ts, which the Prisma CLI loads
 * for every command including `db push`, and the runtime client.
 *
 * To read v1, use scripts/refresh-from-v1.sh. It is the only thing here that
 * may, and it only ever SELECTs.
 */
export const V2_DATABASE = "vfxnow_amc_v2";

export function assertV2Database(url: string | undefined): string {
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  let name: string;
  try {
    name = decodeURIComponent(new URL(url).pathname).replace(/^\//, "");
  } catch {
    throw new Error("DATABASE_URL is not a valid connection string");
  }

  if (name !== V2_DATABASE) {
    throw new Error(
      `Refusing to connect to the database "${name}".\n` +
        `This project only ever talks to "${V2_DATABASE}".\n` +
        `v1 is live and is read-only here: it is read by ` +
        `scripts/refresh-from-v1.sh, and by nothing else.`,
    );
  }

  return url;
}
