import { notFound, redirect } from "next/navigation";
import { getContractKind } from "@/lib/queries/contract-record";

/**
 * The old contract record served orders and leases from one URL, working out
 * which kind of id it had been handed. That lookup survives here exactly once
 * more — to send each id to the record that now owns it — because links to this
 * URL are in sent quotes and emails and cannot be un-sent.
 */
export default async function ContractRecordRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const kind = await getContractKind(id);
  if (!kind) notFound();
  redirect(
    kind === "lease" ? `/dashboard/leases/${id}` : `/dashboard/orders/${id}`,
  );
}
