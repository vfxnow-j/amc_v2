import { PageHeader } from "@/components/shell/page-header";
import { AccountForm } from "@/components/clients/account-form";

export const metadata = { title: "New account" };

/**
 * Clients → Accounts → a new one.
 *
 * v2 shipped able to read every account and edit one, with no way to make one,
 * so a new customer had to be added in v1 and a test order had to be hung off a
 * real restored client. `createClient` had been ported the whole time and was
 * reachable from nothing.
 *
 * The name can be seeded from the query string, so the order builder can hand
 * over what was already typed into its client search instead of asking for it
 * twice.
 */
export default async function NewAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string }>;
}) {
  const { name } = await searchParams;

  return (
    <>
      <PageHeader
        eyebrow="Clients"
        title="New account"
        blurb="Only the name is required — everything else can be filled in on the record once they are in."
      />
      <AccountForm initialName={name?.trim() ?? ""} />
    </>
  );
}
