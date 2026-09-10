import { PageHeader } from "@/components/shell/page-header";
import { ScanSession } from "@/components/scan/scan-session";

export const metadata = { title: "Scan" };

/**
 * Scan. Renamed from Mobile scan and moved off /dashboard/mobile, 2026-09-09.
 *
 * "Mobile" named the device rather than the job, and the job is the same at a
 * packing desk with a gun as it is on a phone in the aisle. Reached from the
 * dashboard's Scan button rather than the rail, on the owner's call — a thing
 * you go and do, not a place in the information architecture.
 *
 * It was a GET form until now: type a code, submit, get a whole page back. That
 * worked with JavaScript off, which was the point, and it cost a navigation per
 * scan and could only ever hold one answer at a time. A session that keeps a
 * receipt of forty scans cannot be a page reload, so the surface below is a
 * client component — and `?code=` still works, seeded into the session on
 * mount, because deep links to it exist and the ⌘K palette makes them.
 *
 * What it does is unchanged: identify a unit. The gain is underneath — a field
 * a barcode gun cannot outrun. Check-out, return and scan-list modes are the
 * rest of this track, and they land on a primitive already proven against real
 * hardware rather than one written the afternoon they need it.
 */
export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const params = await searchParams;
  const code = params.code?.trim();

  return (
    <>
      <PageHeader
        eyebrow="Operate"
        title="Scan"
        blurb="What a thing is, whose it is, and when it is due back"
      />

      <ScanSession initialCode={code || undefined} />
    </>
  );
}
