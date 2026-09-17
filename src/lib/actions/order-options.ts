"use server";

import { revalidatePath } from "next/cache";
import {
  createPackage,
  deletePackage,
  duplicatePackage,
  setActivePackage,
  updatePackage,
} from "@/lib/actions/reservations";

/**
 * Quote options on an order — v1's packages, back on the order record.
 *
 * One order can offer the client several options side by side (23 of v1's 151
 * orders do); the online quote lets them pick one and approving it makes that
 * option the order. Every action was ported and none was reachable. These wrap
 * them in the one result shape the record renders, and nothing more: the
 * editable-status rule, the last-option and active-option guards and the
 * repricing all stay where they were.
 */

export type OptionOutcome =
  | { status: "ok"; message: string; optionId?: string }
  | { status: "error"; message: string };

const failed = (error: unknown): OptionOutcome => ({
  status: "error",
  message: error instanceof Error ? error.message : "That did not work. Try again.",
});

function touch(reservationId: string) {
  revalidatePath(`/dashboard/orders/${reservationId}`);
  revalidatePath("/dashboard/packages");
}

export async function addOption(reservationId: string, name: string): Promise<OptionOutcome> {
  try {
    const created = (await createPackage(reservationId, name.trim())) as { id?: string };
    touch(reservationId);
    return { status: "ok", message: `Option “${name.trim()}” added — add lines to it.`, optionId: created?.id };
  } catch (error) {
    return failed(error);
  }
}

export async function copyOption(
  reservationId: string,
  sourceId: string,
  name: string,
): Promise<OptionOutcome> {
  try {
    const created = (await duplicatePackage(sourceId, name.trim())) as { id?: string };
    touch(reservationId);
    return { status: "ok", message: `Copied as “${name.trim()}”.`, optionId: created?.id };
  } catch (error) {
    return failed(error);
  }
}

export async function renameOption(
  reservationId: string,
  optionId: string,
  name: string,
): Promise<OptionOutcome> {
  try {
    await updatePackage(optionId, { name: name.trim() });
    touch(reservationId);
    return { status: "ok", message: "Renamed." };
  } catch (error) {
    return failed(error);
  }
}

export async function removeOption(reservationId: string, optionId: string): Promise<OptionOutcome> {
  try {
    await deletePackage(optionId);
    touch(reservationId);
    return { status: "ok", message: "Option removed." };
  } catch (error) {
    return failed(error);
  }
}

/** Make this option the order: its lines become the order's lines and total. */
export async function chooseOption(reservationId: string, optionId: string): Promise<OptionOutcome> {
  try {
    await setActivePackage(reservationId, optionId);
    touch(reservationId);
    return { status: "ok", message: "This option is now the order. The total follows it." };
  } catch (error) {
    return failed(error);
  }
}
