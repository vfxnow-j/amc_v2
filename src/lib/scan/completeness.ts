// Pure rules of the barcode + serial cross-check. No Prisma: client components import this.

export type UnitFacts = {
  barcode: string | null;
  serialNumber: string | null;
  requiresSerial: boolean;
};

export type Gap = "MISSING_SERIAL" | "MISSING_BARCODE";

export function normalizeSerial(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toUpperCase();
}

const blank = (v: string | null) => v === null || v.trim() === "";

/** A barcode is always required; a serial only when the catalog item says so. */
export function checkUnit(u: UnitFacts): { complete: true } | { complete: false; gap: Gap } {
  if (blank(u.barcode)) return { complete: false, gap: "MISSING_BARCODE" };
  if (u.requiresSerial && blank(u.serialNumber)) {
    return { complete: false, gap: "MISSING_SERIAL" };
  }
  return { complete: true };
}

/** Does the serial label just scanned belong to the unit its barcode resolved to? */
export function checkMatch(
  unitSerial: string | null,
  scanned: string,
): "match" | "mismatch" | "unknown" {
  if (blank(unitSerial)) return "unknown";
  return normalizeSerial(unitSerial as string) === normalizeSerial(scanned)
    ? "match"
    : "mismatch";
}
