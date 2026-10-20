/** Limits the import screen shows and the parser enforces. No imports: safe for client components. */
/** 500 rows never needs more; well under Next's 1 MB server-action body limit. */
export const MAX_CSV_BYTES = 256_000
