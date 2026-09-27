import { Card, CardEmpty, Field } from "@/components/record/record-card";
import { dayYear } from "@/lib/format";
import { getPortalAccountPanelData } from "@/lib/actions/portal-accounts";
import { PortalAccountRelink } from "@/components/clients/portal-account-relink";

/**
 * Client record → "Portal account" (Phase 1 chunk D, docs/portal-api.md §3).
 *
 * A client's link to the client portal, when it has one: the portal's own
 * account id, verification, credit tier and sites. Staff never see cost or
 * pricing detail here — that's the same DTO discipline the /v1 routes use,
 * just pointed inward. `createdHere: false` is the one thing worth a staff
 * member's attention: it means someone re-linked this account onto a client
 * that already existed, so the portal's company/contact writes on this
 * client stopped mirroring (src/lib/portal/accounts.ts, "provenance marker").
 */

const VERIFICATION_LABEL: Record<string, string> = {
  none: "None",
  id_verified: "ID verified",
  agreement_and_coi: "Agreement + COI",
};

export async function PortalAccountCard({
  clientId,
  canRelink,
}: {
  clientId: string;
  canRelink: boolean;
}) {
  const panel = await getPortalAccountPanelData(clientId);

  if (panel.kind === "none") {
    return (
      <Card title="Portal account">
        <CardEmpty>Not linked to the client portal.</CardEmpty>
      </Card>
    );
  }

  if (panel.kind === "origin_only") {
    return (
      <Card title="Portal account">
        <CardEmpty>
          Created via the client portal — its account has since been
          re-linked to a different client.
        </CardEmpty>
      </Card>
    );
  }

  return (
    <Card title="Portal account" meta={panel.portalClientName}>
      <div className="grid grid-cols-2 gap-3 px-4 pb-3">
        <Field label="Portal account id">{panel.portalAccountId}</Field>
        <Field label="Verification">
          {VERIFICATION_LABEL[panel.verificationLevel] ?? panel.verificationLevel}
        </Field>
        <Field label="Credit tier">{panel.creditTier}</Field>
        <Field label="Since">{dayYear(panel.createdAt)}</Field>
      </div>

      <p className="mx-4 mb-3 text-detail text-ink-muted">
        {panel.createdHere
          ? "Created by the client portal — its company and contact fields mirror here on every PUT."
          : "Re-linked to this client by staff — the portal's company and contact fields are stored on the account only, and are no longer written onto this client."}
      </p>

      {panel.sites.length ? (
        <ul className="mx-4 mb-3 flex flex-col gap-1 text-detail">
          {panel.sites.map((site) => (
            <li key={site.externalSiteId} className="rounded-well bg-sunken px-2 py-1">
              <span className="font-medium text-ink">{site.label}</span>
              {site.isDefault ? (
                <span className="ml-2 rounded-pill bg-accent-tint px-2 py-[1px] text-pill text-accent-on-tint">
                  Default
                </span>
              ) : null}
              {site.address ? (
                <span className="block text-ink-muted">{site.address}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <CardEmpty>No sites on file.</CardEmpty>
      )}

      {canRelink ? <PortalAccountRelink accountId={panel.id} /> : null}
    </Card>
  );
}
