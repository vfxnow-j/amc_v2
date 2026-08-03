import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardSkeleton } from "@/components/record/record-card";
import {
  HubSpotForm,
  ZapierSecret,
} from "@/components/settings/integrations-panel";
import {
  SettingsDenied,
  SettingsHeader,
} from "@/components/settings/settings-chrome";
import { getIntegrationState } from "@/lib/queries/settings";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";

export const metadata = { title: "Integrations" };

/**
 * Settings → Integrations.
 *
 * What v1 kept here was five tabs: API keys, an API reference, QuickBooks,
 * Zapier and HubSpot. Two of those have moved — keys are a credential into this
 * system and sit beside Users, and QuickBooks is the only integration that
 * moves money records and has its own screen. What is left is the two that push
 * and pull sales data.
 *
 * The screen distinguishes an integration that works from one that is merely
 * configurable, because in v2 those are not the same thing. HubSpot's outbound
 * half is live — `actions/reservations` calls `syncReservationDeal` whenever an
 * order is created, quoted or confirmed — so a token set here has an immediate
 * effect. Zapier is inbound only, and the handler that would receive it has not
 * been carried across (cross-cutting workstream X4). Setting a secret for a
 * receiver that does not exist is the kind of thing that looks configured for a
 * year, so it says so.
 *
 * No credential is rendered. Both HubSpot fields are write-only and blank means
 * keep; the Zapier secret is shown once, when it is generated.
 */
export default async function IntegrationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role))
    return <SettingsDenied id="integrations" role={user.title} />;

  return (
    <>
      <SettingsHeader id="integrations" />

      <div className="grid min-h-0 flex-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Suspense fallback={<CardSkeleton title="HubSpot" rows={6} />}>
          <HubSpotCard />
        </Suspense>

        <div className="flex flex-col gap-3">
          <Suspense fallback={<CardSkeleton title="Zapier" rows={3} />}>
            <ZapierCard />
          </Suspense>

          <Card title="Elsewhere">
            <ul className="flex flex-col gap-px px-2 pb-3">
              <Elsewhere
                href="/dashboard/settings/quickbooks"
                label="QuickBooks"
                detail="Customers, invoices and payments. Its own screen — it is the only integration that moves money records."
              />
              <Elsewhere
                href="/dashboard/settings/api-keys"
                label="API keys"
                detail="Credentials into this system, for a machine calling it without a session."
              />
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function Elsewhere({
  href,
  label,
  detail,
}: {
  href: string;
  label: string;
  detail: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="block rounded-row px-2 py-[7px] transition-colors duration-[160ms] hover:bg-row-hover"
      >
        <span className="block text-body font-bold">{label}</span>
        <span className="block text-detail text-ink-muted">{detail}</span>
      </Link>
    </li>
  );
}

async function HubSpotCard() {
  const state = await getIntegrationState();

  return (
    <Card
      title="HubSpot"
      meta={
        state.hubspot.enabled
          ? state.hubspot.hasToken
            ? "pushing deals"
            : "on, but no token"
          : "off"
      }
    >
      {state.hubspot.enabled && !state.hubspot.hasToken ? (
        <p className="mx-4 mb-3 rounded-well bg-destructive/10 p-2 text-detail text-destructive">
          Pushing is switched on with no token stored, so every deal write fails
          silently. Either add a token or switch it off.
        </p>
      ) : null}
      <HubSpotForm state={state.hubspot} />
    </Card>
  );
}

async function ZapierCard() {
  const state = await getIntegrationState();

  return (
    <Card
      title="Zapier"
      meta={state.zapier.hasSecret ? "secret set" : "not set up"}
    >
      <p className="mx-4 mb-3 rounded-well bg-sunken p-2 text-detail text-ink-muted">
        Zapier only sends <span className="text-ink">into</span> this system —
        it files leads. The handler that receives them has not been rebuilt in
        v2 yet, so a secret set here has nothing listening for it. Worth setting
        anyway if the endpoint is coming; worth knowing it is not live.
      </p>
      <ZapierSecret present={state.zapier.hasSecret} />
    </Card>
  );
}
