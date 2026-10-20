/**
 * Dashboard "Revenue by order type": the three figures per type and the Total.
 *
 * Earned is accrual-basis revenue in the window (lib/analytics/earned-revenue).
 * Quoted is the open quotes at their stage weight (lib/queries/forecast), so it
 * is already the weighted prospect. Potential is the two added together. Each
 * row is rounded to whole cents first and the Total is the sum of those
 * rounded rows, so the Total always equals the visible rows to the cent.
 */

export type TypeFigures = { earned: number; quoted: number };

export type TypeLine = TypeFigures & { potential: number };

const cents = (dollars: number) => Math.round((Number.isFinite(dollars) ? dollars : 0) * 100);

/** One row: earned and quoted rounded to cents, potential their sum. */
export function typeLine(row: Partial<TypeFigures> | undefined): TypeLine {
  const earned = cents(row?.earned ?? 0);
  const quoted = cents(row?.quoted ?? 0);
  return { earned: earned / 100, quoted: quoted / 100, potential: (earned + quoted) / 100 };
}

/** Sum of every row, computed in integer cents so it never drifts. */
export function totalLine(rows: Array<Partial<TypeFigures> | undefined>): TypeLine {
  let earned = 0;
  let quoted = 0;
  for (const row of rows) {
    earned += cents(row?.earned ?? 0);
    quoted += cents(row?.quoted ?? 0);
  }
  return { earned: earned / 100, quoted: quoted / 100, potential: (earned + quoted) / 100 };
}
