import { notFound } from "next/navigation";
import { EntityAccessError, requireEntity } from "@/lib/entities/context";

/**
 * Every entity page calls this itself. A layout does not re-render when you
 * navigate between its pages, so the layout's check alone would let a grant
 * revoked mid-session ride on the old shell. Denial here is a 404; the layout
 * has already shown the explanatory screen on a full load.
 */
export async function gateEntityPage(slug: string, opts: { write?: boolean } = {}) {
  try {
    return await requireEntity(slug, opts);
  } catch (error) {
    if (error instanceof EntityAccessError) notFound();
    throw error;
  }
}
