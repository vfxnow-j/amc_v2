# Dashboard: Revenue by order type, totals

## Before
src/components/orders/revenue-strip.tsx rendered, per order type, Earned / Active / Approved / Quoted x weight, plus an "All types" row. Numbers come from getRevenueByType (src/lib/queries/orders.ts): earned from lib/analytics/earned-revenue (billing-period rule), active/approved/quoted from Forecast (quotes at stage weights, one version per deal, month pro-rated by days for Week/Today).

## Change (assumption: owner's request interpreted as below)
- Columns now: Type, Earned, Quoted, Potential. Active and Approved are removed from this table.
- Earned = accrual revenue recognised in the selected window (unchanged query).
- Quoted = counted open quotes at their stage weight (sent 60%, draft/revision 40%), ex-tax, from Forecast, pro-rated for week/today (unchanged query). It is already the weighted prospect; no new weights.
- Potential = Earned + Quoted (assumed meaning of "potential total").
- Total row (bold, sunken background) sums every type per column. New pure code src/lib/dashboard/type-totals.ts rounds each row to cents and sums in integer cents, so Total equals the visible rows to the cent. No second calculation of earned or quoted; filters unchanged (no double counting added or removed by this change).
- Layout: same grid rule, tabular figures, 4 columns so it fits narrow widths; type name truncates. Catalog blurb updated.

## Tests
src/lib/dashboard/type-totals.test.ts (4 tests, pass); glob added to package.json test script. eslint clean; tsc clean except pre-existing RouteContext errors in src/app/api/requirements/[token]/*.

## Not verified
Not viewed in a browser (type-checked and unit-tested only). Note Earned covers the window up to now while Quoted covers the whole window (month's forecast), as before.
Earned and Quoted could overlap only if a deal with an open quote also has earned revenue from a different order; this was already the case in the old table.

## Follow-up: label rename (owner decision)
The Earned column is now labelled Revenue in the dashboard table (header, tooltip, comments) and the catalog blurb. Calculation, field names, queries and other screens unchanged. No tests asserted on the label.
