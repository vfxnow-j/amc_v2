"use client";

import { Printer } from "lucide-react";

/** Opens the browser's print dialog; "Save as PDF" there makes the file. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="flex items-center gap-1 rounded-pill bg-accent-solid px-3 py-[6px] text-pill text-accent-on-solid"
    >
      <Printer className="size-[13px]" aria-hidden /> Print / Save PDF
    </button>
  );
}
