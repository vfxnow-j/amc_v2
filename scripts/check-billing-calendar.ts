/**
 * Checks the business-date convention and billing-anchor math in
 * src/lib/billing/calendar.ts. No test runner in this project, so:
 *   npx tsx scripts/check-billing-calendar.ts   # exits non-zero on a failure
 */
import * as c from "@/lib/billing/calendar";
const A1 = c.DEFAULT_BILLING_ANCHOR, A15 = { monthly: 15 as const, weekly: 1 }, AE = { monthly: "EOM" as const, weekly: 1 };
const d = (s: string) => c.parseDateInput(s)!;
const f = (x: Date) => c.toDateInput(x);
let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(ok ? "ok  " : "FAIL", label, got, ok ? "" : `want ${want}`); };
const s = (t: string, cy: "MONTHLY"|"WEEKLY", a: c.BillingAnchor) => { const r = c.firstBillingStretch(d(t), cy, a); return [f(r.start), f(r.end), Math.round(r.fraction*10000)/10000, f(r.nextBillingDate)]; };
eq("monthly 1st, Sep 20", s("2026-09-20","MONTHLY",A1), ["2026-09-20","2026-09-30",0.3667,"2026-10-01"]);
eq("monthly 1st, Oct 1 whole", s("2026-10-01","MONTHLY",A1), ["2026-10-01","2026-10-31",1,"2026-11-01"]);
eq("monthly 15th, Sep 10", s("2026-09-10","MONTHLY",A15), ["2026-09-10","2026-09-14",0.1613,"2026-09-15"]);
eq("monthly EOM, Feb 10", s("2026-02-10","MONTHLY",AE), ["2026-02-10","2026-02-27",0.6429,"2026-02-28"]);
eq("monthly EOM, Feb 28 → Mar 31", s("2026-02-28","MONTHLY",AE), ["2026-02-28","2026-03-30",1,"2026-03-31"]);
eq("weekly Mon, Wed Sep 16", s("2026-09-16","WEEKLY",A1), ["2026-09-16","2026-09-20",0.7143,"2026-09-21"]);
eq("weekly Mon, Mon Sep 21", s("2026-09-21","WEEKLY",A1), ["2026-09-21","2026-09-27",1,"2026-09-28"]);
eq("period Dec 1", (({start,end}) => [f(start),f(end)])(c.periodFromAnchor(d("2026-12-01"),"MONTHLY",A1)), ["2026-12-01","2026-12-31"]);
eq("intended 00:00Z", f(c.intendedDay(new Date("2026-10-01T00:00:00Z"))), "2026-10-01");
eq("intended v1 07:00Z", f(c.intendedDay(new Date("2026-10-01T07:00:00Z"))), "2026-10-01");
eq("intended v1 08:00Z PST", f(c.intendedDay(new Date("2026-02-01T08:00:00Z"))), "2026-02-01");
eq("intended timestamp 16:30Z", f(c.intendedDay(new Date("2026-08-28T16:30:04.832Z"))), "2026-08-28");
eq("intended evening 03:10Z next UTC day", f(c.intendedDay(new Date("2026-09-17T03:47:00Z"))), "2026-09-16");
eq("today at 8:47pm PDT", f(c.businessToday(new Date("2026-09-17T03:47:00Z"))), "2026-09-16");
eq("stored noon", c.parseDateInput("2026-09-25")!.toISOString(), "2026-09-25T12:00:00.000Z");
eq("display noon in LA", new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric"}).format(d("2026-10-01")), "Oct 1");
const r2 = (n: number) => Math.round(n*10000)/10000;
eq("periods Sep 20→Oct 1", r2(c.billedPeriods(d("2026-09-20"), d("2026-10-01"), "MONTHLY", A1)), 0.3667);
eq("periods Sep 1→Nov 1 (backdated)", r2(c.billedPeriods(d("2026-09-01"), d("2026-11-01"), "MONTHLY", A1)), 2);
eq("periods Sep 20→Nov 1", r2(c.billedPeriods(d("2026-09-20"), d("2026-11-01"), "MONTHLY", A1)), 1.3667);
eq("anchor moved: Oct 1→Oct 15 on 15th", r2(c.billedPeriods(d("2026-10-01"), d("2026-10-15"), "MONTHLY", A15)), 0.4667);
eq("next: future start Sep 20", f(c.nextAnchoredBillingDate(d("2026-09-20"), "MONTHLY", A1, d("2026-09-16"))), "2026-10-01");
eq("next: start on the 1st, Oct 1", f(c.nextAnchoredBillingDate(d("2026-10-01"), "MONTHLY", A1, d("2026-09-16"))), "2026-11-01");
eq("next: past start Aug 3", f(c.nextAnchoredBillingDate(d("2026-08-03"), "MONTHLY", A1, d("2026-09-16"))), "2026-10-01");
eq("next: weekly Wed", f(c.nextAnchoredBillingDate(d("2026-09-16"), "WEEKLY", A1, d("2026-09-16"))), "2026-09-21");
console.log(fail ? `${fail} FAILED` : "all pass"); process.exit(fail ? 1 : 0);
