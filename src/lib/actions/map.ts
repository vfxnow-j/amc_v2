"use server";

import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/auth-utils";
import { addressKey } from "@/lib/geo/normalize";
import { prisma } from "@/lib/prisma";

/**
 * Pin one address by hand (Inventory → Map). The offline geocoder only knows
 * ZIP and postal-code centroids, so an address with neither ("El Paso
 * Convention Center") needs a person. Stored as a MANUAL geocode, which no
 * geocoding run ever overwrites. Keyed by the address text, so editing the
 * address on its record unpins it — the new text geocodes afresh.
 */
export async function pinAddress(input: {
  address: string;
  lat: number;
  lng: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const authResult = await requireEditor();
  if (!authResult.authorized) return { ok: false, error: authResult.error };

  const address = input.address?.trim();
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (!address) return { ok: false, error: "No address to pin." };
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { ok: false, error: "Latitude must be between -90 and 90." };
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { ok: false, error: "Longitude must be between -180 and 180." };
  }

  const key = addressKey(address);
  const data = {
    addressText: address,
    lat,
    lng,
    status: "OK" as const,
    precision: "MANUAL" as const,
    source: "MANUAL" as const,
  };
  await prisma.geocode.upsert({
    where: { addressKey: key },
    create: { addressKey: key, ...data },
    update: data,
  });
  revalidatePath("/dashboard/map");
  return { ok: true };
}
