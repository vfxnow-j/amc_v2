/**
 * Type guards for closed sets of string literals.
 *
 * Nearly every list screen in this app has the same three lines: a `VIEWS`
 * tuple, a type derived from it, and a hand-written predicate saying
 * `VIEWS.includes(value as View)` so a search param can be narrowed before it
 * is used. That predicate was written out twelve times across eight modules,
 * identical but for the tuple it closed over.
 *
 * The cast inside is unavoidable — `Array.prototype.includes` is typed to
 * accept only `T`, so an `unknown` cannot be passed without one. Writing it
 * once here is the point: it is the only place in the app that needs it, and
 * the call sites read as a declaration rather than as a cast.
 *
 * No imports, deliberately. Client components pull these in through their
 * label modules, and anything reaching `lib/prisma` from that side drags the pg
 * driver into the browser bundle.
 */

/**
 * Build a guard for one closed set.
 *
 *   const VIEWS = ["open", "closed"] as const;
 *   type View = (typeof VIEWS)[number];
 *   const isView = oneOf(VIEWS);
 */
export function oneOf<T extends string>(
  values: readonly T[],
): (value: unknown) => value is T {
  return (value: unknown): value is T => values.includes(value as T);
}
