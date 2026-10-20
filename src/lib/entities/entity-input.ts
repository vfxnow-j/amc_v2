/**
 * What the Settings → Entities form may send. Pure (zod + the module registry), so it is
 * tested without a session. The first problem becomes the message shown.
 */
import { z } from "zod";
import { MODULES } from "@/lib/entities/modules";
import { slugify } from "@/lib/entities/naming";

const AVAILABLE = new Set<string>(MODULES.filter((m) => m.available).map((m) => m.key));

const optional = (max: number, what: string) =>
  z
    .string()
    .trim()
    .max(max, `${what} is too long (${max} characters at most).`)
    .nullish()
    .transform((v) => (v ? v : null));

export const entityInputSchema = z.strictObject({
  name: z
    .string("Give the entity a name.")
    .trim()
    .min(1, "Give the entity a name.")
    .max(120, "The name is too long (120 characters at most)."),
  contactName: optional(120, "The contact name is"),
  email: z
    .string()
    .trim()
    .max(200, "The email is too long (200 characters at most).")
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "That email address doesn't look right."),
  phone: optional(40, "The phone number is"),
  address: optional(300, "The address is"),
  notes: optional(2000, "The notes are"),
  modules: z.array(z.string().max(40)).max(20, "Too many modules."),
});

export type EntityFormInput = {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  modules: string[];
};

export type EntityData = Omit<z.infer<typeof entityInputSchema>, "modules"> & { modules: string[]; slug: string };

/** Inventory is always on; a module that is not built yet is dropped, never stored. */
export function cleanModules(modules: string[]): string[] {
  return [...new Set(["INVENTORY", ...modules.filter((m) => AVAILABLE.has(m))])];
}

export function checkEntityInput(
  input: unknown,
): { ok: true; data: EntityData } | { ok: false; message: string } {
  const r = entityInputSchema.safeParse(input);
  if (!r.success) {
    const issue = r.error.issues[0];
    if (issue?.code === "unrecognized_keys") return { ok: false, message: `Unexpected field: ${issue.keys[0]}.` };
    return { ok: false, message: issue?.message ?? "That input isn't valid." };
  }
  const slug = slugify(r.data.name);
  if (!slug) return { ok: false, message: "Give the entity a name with letters or numbers in it." };
  // `zz` is reserved for throwaway test databases (vfxnow_ent_zz_*), which the
  // backup scripts deliberately skip; a real entity must never match that.
  if (slug === "zz" || slug.startsWith("zz-")) {
    return { ok: false, message: "Names starting with “zz” are reserved for tests. Choose another name." };
  }
  return { ok: true, data: { ...r.data, modules: cleanModules(r.data.modules), slug } };
}

/** The slug a name will get, for the live preview ("" until the name has a letter or number). */
export function slugPreview(name: string): string {
  return slugify(name);
}
