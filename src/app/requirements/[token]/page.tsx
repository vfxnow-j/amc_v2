import {
  readRequirementsPortal,
  resolveRequirementToken,
} from "@/lib/requirements/token";
import { RequirementsPortal } from "@/components/requirements/requirements-portal";

/**
 * Clients → the paperwork half of an account, as the customer sees it.
 *
 * The place the link minted by `sendRequirementsRequest` and by
 * `applyOnboardingToLead` finally lands. Both have been minting 30-day tokens
 * into `client_requirement_tokens` for a route that did not exist; this is it.
 *
 * Read on the server and complete on first paint, the same call the quote
 * portal takes: the token stays out of client JavaScript as anything but the
 * URL it already is, and somebody photographing a licence on a phone never
 * watches a spinner resolve a fetch before they can start.
 *
 * `force-dynamic` because the answer changes the moment a file is uploaded, and
 * a cached copy of "we still need your ID" shown to somebody who has just sent
 * it is the one failure that makes a person send it twice.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

export default async function RequirementsPage({ params }: Params) {
  const { token } = await params;

  const grant = await resolveRequirementToken(token);
  if (!grant.ok) {
    return grant.reason === "expired" ? (
      <Closed
        title="This link has expired"
        blurb="Links are good for 30 days. Reply to the email this came in and we will send a fresh one — nothing you sent before is lost."
      />
    ) : (
      <Closed
        title="Link not found"
        blurb="This link is not one of ours, or it has been replaced. Check it came through whole — they are long — or reply to the email it arrived in."
      />
    );
  }

  const portal = await readRequirementsPortal(grant);
  if (!portal) {
    return (
      <Closed
        title="Account unavailable"
        blurb="We cannot find the account this link belongs to. Please reply to the email it came in and we will sort it out."
      />
    );
  }

  return <RequirementsPortal token={token} portal={portal} />;
}

/** The dead ends. One shape, so a refusal never looks like a broken page. */
function Closed({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="rounded-2xl bg-white p-10 text-center shadow-sm">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mx-auto mt-2 max-w-prose text-sm text-[#71717a]">{blurb}</p>
    </div>
  );
}
