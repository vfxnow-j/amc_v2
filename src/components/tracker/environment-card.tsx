import { Card, CardEmpty } from "@/components/record/record-card";
import { EnvironmentEditor } from "@/components/tracker/environment-editor";
import { dayYear } from "@/lib/format";
import { getClientEnvironment, type OwnedItem, type SuppliedItem } from "@/lib/queries/environment";
import { ASK_STATUS_LABEL } from "@/lib/tracker/labels";
import {
  ENV_SECTION_BLURB,
  ENV_SECTION_LABEL,
  ENV_SECTION_FIELDS,
  ENV_FIELD_LABEL,
  type EnvField,
} from "@/lib/tracker/environment";

/**
 * What an account runs, what of it we supply, and what they have asked us for
 * (docs/client-tracker.md, "The environment profile").
 *
 * Three columns per section, side by side on purpose: the feature is not the
 * inventory, it is the **gap between the columns**. A section where they own
 * four arrays, we supply none and they have asked twice is a cross-sell
 * opening you can see without reading a word.
 *
 * Only the first column is stored. The second is the account's real order lines
 * and the third is its asks, both read fresh — so neither can be out of date,
 * and neither needs anybody to maintain it.
 */

/** The owned row's detail line: only the fields this section actually asks for. */
function detailOf(item: OwnedItem, fields: EnvField[]): string {
  const parts: string[] = [];
  for (const field of fields) {
    if (field === "quantity" || field === "refreshAt") continue;
    const value = item[field];
    if (value === null || value === undefined || value === "") continue;
    const shown =
      field === "capacityTb"
        ? `${value} TB`
        : field === "percentUsed"
          ? `${value}% used`
          : String(value);
    parts.push(field === "vendor" ? shown : `${ENV_FIELD_LABEL[field]} ${shown}`);
  }
  return parts.join(" · ");
}

function SuppliedRow({ item }: { item: SuppliedItem }) {
  return (
    <li className="rounded-row px-2 py-[3px] text-detail">
      <span className="truncate">
        {item.peak > 1 ? `${item.peak} × ` : ""}
        {item.name}
      </span>
      <span className="block text-micro text-ink-faint">
        {item.live ? (
          <span className="text-accent-text">Out with them now</span>
        ) : (
          `Last ${dayYear(item.lastAt)}`
        )}
        {item.orders > 1 ? ` · ${item.orders} orders` : ""}
      </span>
    </li>
  );
}

function Column({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="mb-[2px] block text-micro uppercase text-ink-muted">{title}</span>
      {empty ? <span className="text-detail text-ink-faint">—</span> : <ul className="flex flex-col">{children}</ul>}
    </div>
  );
}

export async function EnvironmentCard({
  clientId,
  canEdit,
}: {
  clientId: string;
  canEdit: boolean;
}) {
  const profile = await getClientEnvironment(clientId);
  const { counts } = profile;
  const bare = counts.owned === 0 && counts.supplied === 0 && counts.openAsks === 0;

  return (
    <Card
      title="Environment"
      meta={
        bare
          ? undefined
          : [
              counts.owned ? `${counts.owned} on file` : null,
              counts.supplied ? `${counts.supplied} supplied` : null,
              counts.openAsks ? `${counts.openAsks} open ${counts.openAsks === 1 ? "ask" : "asks"}` : null,
            ]
              .filter(Boolean)
              .join(" · ")
      }
    >
      {bare && !canEdit ? (
        <CardEmpty>
          Nothing recorded about what this account runs. An editor can add it
          after the next site visit or call.
        </CardEmpty>
      ) : null}

      <div className="flex flex-col gap-3 px-4 pb-4">
        {profile.sections.map((view) => {
          // A section nobody can fill in and that has nothing in it is noise on
          // a read-only screen; for an editor it is the prompt to fill it in.
          if (view.empty && !canEdit) return null;
          const fields = ENV_SECTION_FIELDS[view.section];

          return (
            <section key={view.section} className="rounded-well bg-sunken/50 p-3">
              <h3 className="text-detail font-bold text-ink">
                {ENV_SECTION_LABEL[view.section]}
              </h3>
              {view.empty ? (
                <p className="mb-2 text-micro text-balance text-ink-faint">
                  {ENV_SECTION_BLURB[view.section]}
                </p>
              ) : (
                <div className="mb-2 mt-2 grid gap-3 sm:grid-cols-3">
                  <Column title="They run" empty={view.owned.length === 0}>
                    {view.owned.map((item) => {
                      const detail = detailOf(item, fields);
                      return (
                        <li key={item.id} className="rounded-row px-2 py-[3px] text-detail">
                          <span className="truncate">
                            {item.quantity && item.quantity > 1 ? `${item.quantity} × ` : ""}
                            {item.name}
                          </span>
                          {detail ? (
                            <span className="block text-micro text-ink-faint">{detail}</span>
                          ) : null}
                          {item.refreshAt ? (
                            <span className="block text-micro text-ink-faint">
                              Refresh due {dayYear(item.refreshAt)}
                            </span>
                          ) : null}
                          {item.notes ? (
                            <span className="block text-micro text-ink-faint">{item.notes}</span>
                          ) : null}
                        </li>
                      );
                    })}
                  </Column>

                  <Column title="We supply" empty={view.supplied.length === 0}>
                    {view.supplied.map((item) => (
                      <SuppliedRow key={item.name} item={item} />
                    ))}
                  </Column>

                  <Column title="They asked" empty={view.asked.length === 0}>
                    {view.asked.map((ask) => (
                      <li key={ask.id} className="rounded-row px-2 py-[3px] text-detail">
                        <span className="truncate">
                          {ask.quantity && ask.quantity > 1 ? `${ask.quantity} × ` : ""}
                          {ask.description}
                        </span>
                        <span
                          className={`block text-micro ${ask.open ? "text-accent-text" : "text-ink-faint"}`}
                        >
                          {ASK_STATUS_LABEL[ask.status]}
                        </span>
                      </li>
                    ))}
                  </Column>
                </div>
              )}

              {canEdit ? (
                <EnvironmentEditor
                  clientId={clientId}
                  section={view.section}
                  items={view.owned}
                />
              ) : null}
            </section>
          );
        })}

        {profile.unplaced.length > 0 ? (
          <section className="rounded-well bg-sunken/50 p-3">
            <h3 className="text-detail font-bold text-ink">Other kit we supply</h3>
            <p className="mb-2 text-micro text-ink-faint">
              Order lines whose inventory category does not belong to a section
              above. Listed rather than dropped.
            </p>
            <ul className="flex flex-col">
              {profile.unplaced.map((item) => (
                <SuppliedRow key={item.name} item={item} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Card>
  );
}
