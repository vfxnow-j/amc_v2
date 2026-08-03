"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-utils";
import {
  getHubSpotSettings,
  saveHubSpotSettings,
} from "@/lib/actions/hubspot-settings";
import { generateZapierWebhookSecret } from "@/lib/actions/zapier";

/**
 * Saving integration settings without a blank field wiping a credential.
 *
 * `saveHubSpotSettings` takes the whole object and upserts every key, which is
 * fine for a form that renders the current access token into an input — v1's
 * did. This one does not: a credential that is printed into HTML is a
 * credential in every browser cache, proxy log and screenshot between here and
 * the person reading it. So the token and webhook secret fields are write-only,
 * and blank has to mean "leave it as it was" rather than "set it to nothing".
 *
 * That merge cannot live in the client component — it needs the current values,
 * and sending them to the browser to send back is the thing being avoided. So
 * it happens here, on the server, and the client only ever sends what somebody
 * actually typed.
 */

export type SettingsSaveResult =
  | { status: "ok" }
  | { status: "error"; message: string };

export async function saveHubSpot(input: {
  enabled: boolean;
  /** Empty means "keep what is stored". */
  accessToken: string;
  webhookSecret: string;
  pipelineRental: string;
  pipelineSale: string;
  pipelineRTO: string;
  pipelineCloud: string;
}): Promise<SettingsSaveResult> {
  const auth = await requireAdmin();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Unauthorized" };
  }

  try {
    const current = await getHubSpotSettings();

    await saveHubSpotSettings({
      enabled: input.enabled,
      accessToken: input.accessToken || current.accessToken,
      webhookSecret: input.webhookSecret || current.webhookSecret,
      pipelineRental: input.pipelineRental || "default",
      pipelineSale: input.pipelineSale || "default",
      pipelineRTO: input.pipelineRTO || "default",
      pipelineCloud: input.pipelineCloud || "default",
    });
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "Could not save.",
    };
  }

  revalidatePath("/dashboard/settings/integrations");
  return { status: "ok" };
}

export type ZapierSecretResult =
  | { status: "ok"; secret: string }
  | { status: "error"; message: string };

/**
 * Mint a new inbound webhook secret, and hand it back exactly once.
 *
 * The value is stored in plaintext because `verifyWebhookSecret` compares
 * against it on every inbound call — it is a shared secret, not a password, and
 * there is no hash that would let both sides check it. So the compensating rule
 * is that it is never read back onto a screen: the settings page reports
 * whether one is set, and the only time anybody sees the value is the moment
 * they generate it and paste it into Zapier.
 */
export async function rotateZapierSecret(): Promise<ZapierSecretResult> {
  const auth = await requireAdmin();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Unauthorized" };
  }

  try {
    const secret = await generateZapierWebhookSecret();
    revalidatePath("/dashboard/settings/integrations");
    return { status: "ok", secret };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "Could not generate one.",
    };
  }
}
