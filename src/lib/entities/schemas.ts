/**
 * Shape and length rules for every inventory action's input. Pure (zod only), so
 * it is tested without a session. The first problem becomes the message shown.
 */
import { z } from "zod";
import { MAX_QUANTITY, MAX_UNITS_PER_RECEIPT, quantityProblem } from "@/lib/entities/ledger";

const id = z.string().min(1, "Missing id.").max(64, "That id is too long.");
const locId = z.string().min(1, "Choose a location.").max(64, "That id is too long.");
// An unselected <select> sends ""; for an optional place that means "none", and the rules then ask for one.
const optLoc = z.union([z.literal("").transform(() => null), locId]).nullish();
const text = (max: number, what = "That") => z.string().trim().max(max, `${what} is too long (${max} characters at most).`).nullish();
const name = z.string("Name the item.").trim().min(1, "Name the item.").max(200, "The name is too long (200 characters at most).");
const notes = text(2000, "The notes are");
const short = (what: string) => text(200, what);
const date = z.string().max(40, "That date isn't valid.").nullish();

const quantity = z.number({ error: quantityProblem(NaN) ?? "" }).superRefine((q, ctx) => {
  const m = quantityProblem(q);
  if (m) ctx.addIssue({ code: "custom", message: m });
});

const trackingMode = z.enum(["SERIALIZED", "QUANTITY"], "Choose how the item is tracked.");

const itemFields = {
  description: text(2000, "The description is"), manufacturer: short("The manufacturer is"), model: short("The model is"),
  category: text(100, "The category is"), notes,
};
export const itemSchema = z.strictObject({ name, trackingMode, ...itemFields });
export const itemUpdateSchema = z.strictObject({ name, ...itemFields });
export const idSchema = id;

const common = { reference: short("The reference is"), notes, occurredAt: date };
const destination = {
  toLocationId: optLoc,
  newSiteName: text(120, "The site name is"),
  newSiteAddress: text(300, "The site address is"),
};
const handoff = {
  recipient: short("The recipient is"), destination: short("The destination is"), carrier: short("The carrier is"),
  tracking: short("The tracking number is"), finalToOwner: z.boolean().optional(),
};

export const receiveUnitsSchema = z.strictObject({
  ...common,
  itemId: id,
  toLocationId: locId,
  units: z
    .array(
      z.strictObject({
        serial: short("The serial is"), ownerTag: short("The owner tag is"), scanTag: short("The scan tag is"), condition: short("The condition is"),
      }),
      "Add the units as a list.",
    )
    .min(1, "Add at least one unit.")
    .max(MAX_UNITS_PER_RECEIPT, `Receive at most ${MAX_UNITS_PER_RECEIPT} units at a time.`),
});

export const unitMoveSchema = z.strictObject({
  ...common, ...destination, ...handoff,
  unitId: id,
  type: z.enum(["MOVE", "RELEASE", "RETURN"], "Unknown movement."),
});

export const stockMoveSchema = z.strictObject({
  ...common, ...destination, ...handoff,
  itemId: id,
  type: z.enum(["RECEIVE", "MOVE", "RELEASE", "RETURN"], "Unknown movement."),
  quantity,
  fromLocationId: optLoc,
});

export const correctionSchema = z.strictObject({
  movementId: id,
  note: z.string("Say what is being corrected.").trim().min(1, "Say what is being corrected.").max(1000, "The note is too long (1000 characters at most)."),
});

/** The first problem with the input, or the parsed value. */
export function check<S extends z.ZodType>(schema: S, input: unknown): { ok: true; data: z.infer<S> } | { ok: false; message: string } {
  const r = schema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  const issue = r.error.issues[0];
  if (issue?.code === "unrecognized_keys") return { ok: false, message: `Unexpected field: ${issue.keys[0]}.` };
  return { ok: false, message: issue?.message ?? "That input isn't valid." };
}

export { MAX_QUANTITY };
