/**
 * What a super admin may submit for one user's entity access, and what the card on the user's
 * record shows for each role. Plain module (no next/auth/prisma) so the action and the tests
 * share it; a "use server" file may not export a schema.
 */
import { z } from "zod";

export const entityAccessSchema = z.strictObject({
  entityAccess: z.boolean(),
  scope: z.enum(["ALL", "SELECTED"]),
  entityIds: z.array(z.string().min(1).max(64)).max(100),
});
export type EntityAccessInput = z.infer<typeof entityAccessSchema>;

export const userIdSchema = z.string().min(1).max(64);

export type AccessCardMode =
  | { kind: "everything"; text: string }
  | { kind: "refused"; text: string }
  | { kind: "controls" };

/** SUPER_ADMIN opens every entity; FLOW_USER can never be given access; everyone else gets controls. */
export function accessCardMode(role: string): AccessCardMode {
  if (role === "SUPER_ADMIN") return { kind: "everything", text: "Super admins can open every entity." };
  if (role === "FLOW_USER") return { kind: "refused", text: "Flow users can't be given entity access." };
  return { kind: "controls" };
}
