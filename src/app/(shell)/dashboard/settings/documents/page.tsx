import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FilterTabs, type TabOption } from "@/components/list/filter-tabs";
import { ListSearch } from "@/components/list/list-search";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { Card, CardSkeleton } from "@/components/record/record-card";
import {
  AgreementTemplate,
  DocumentRowAction,
  RepairButton,
} from "@/components/settings/document-actions";
import { SettingsHeader } from "@/components/settings/settings-chrome";
import { getAgreementTemplate } from "@/lib/actions/agreement";
import { getDocumentRows, getTrashedDocumentCount } from "@/lib/queries/settings";
import { getSessionUser } from "@/lib/roles";
import { fileSize, stamp } from "@/lib/settings/format";
import { documentTypeLabels, type DocumentType } from "@/lib/types";

export const metadata = { title: "Documents" };

/** The types this system actually generates, in the order it generates them. */
const TYPE_TABS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "PROPOSAL", label: "Quotes" },
  { value: "RENTAL_AGREEMENT", label: "Agreements" },
  { value: "INVOICE", label: "Invoices" },
  { value: "ORDER_DETAIL", label: "Order details" },
  { value: "DELIVERY_NOTE", label: "Delivery notes" },
  { value: "PURCHASE_ORDER", label: "Purchase orders" },
];

const COLUMNS: Column[] = [
  { key: "file", label: "File", width: "minmax(0,1.6fr)" },
  { key: "type", label: "Type", width: "128px" },
  { key: "belongs", label: "Belongs to", width: "minmax(0,1fr)" },
  { key: "signed", label: "Signed", width: "132px" },
  { key: "size", label: "Size", width: "72px", align: "right" },
  { key: "when", label: "Created", width: "148px" },
  { key: "act", label: "", width: "128px", align: "right" },
];

const TRASH_COLUMNS: Column[] = [
  { key: "file", label: "File", width: "minmax(0,1.6fr)" },
  { key: "type", label: "Type", width: "128px" },
  { key: "belongs", label: "Belongs to", width: "minmax(0,1fr)" },
  { key: "reason", label: "Why", width: "minmax(0,1fr)" },
  { key: "when", label: "Trashed", width: "148px" },
  { key: "act", label: "", width: "80px", align: "right" },
];

/**
 * Settings → Documents.
 *
 * Every PDF the system has generated or received, in one place — the only
 * screen that crosses orders, purchase orders and clients, which is why it
 * lives in settings rather than in a cluster.
 *
 * Deletes are soft and the screen says so, because the alternative is somebody
 * destroying a signed rental agreement from a settings table. The row keeps its
 * signer and timestamp, the file moves to `documents/.trash/`, and Restore puts
 * both back.
 *
 * The "File" column reports whether the PDF is actually on disk. On this
 * instance none of them are: v2 is a fresh checkout against a restored
 * database, and the `documents/` tree was never copied across, so every row
 * points at a file that exists only on the machine that made it. That is a
 * data-transfer problem to report, not one to repair — the screen says which of
 * the two situations it is looking at and what rebuilding could actually
 * recover.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; trash?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const search = params.q?.trim() ?? "";
  const type = params.type ?? "all";
  const trash = params.trash === "1";
  const canEdit = user.role !== "VIEWER";

  return (
    <>
      <SettingsHeader
        id="documents"
        blurb={
          trash
            ? "In the trash. Nothing here has been destroyed — restore puts the file back where it was."
            : undefined
        }
        actions={
          <>
            {trash ? null : <ListSearch placeholder="Search filenames" />}
            <Suspense fallback={null}>
              <TrashLink trash={trash} />
            </Suspense>
          </>
        }
      />

      {trash ? null : (
        <FilterTabs
          param="type"
          value={type}
          fallback="all"
          options={TYPE_TABS as TabOption[]}
          label="Document type"
        />
      )}

      <div className="grid min-h-0 flex-1 items-start gap-3 lg:grid-cols-[1fr_minmax(0,320px)]">
        <Suspense
          key={`${type}:${search}:${trash}`}
          fallback={<ListTableSkeleton />}
        >
          <Table
            type={type}
            search={search}
            trash={trash}
            canEdit={canEdit}
          />
        </Suspense>

        {trash ? null : (
          <div className="flex flex-col gap-3">
            <Suspense
              fallback={<CardSkeleton title="Rental agreement template" rows={2} />}
            >
              <TemplateCard canEdit={canEdit} />
            </Suspense>
            <Suspense fallback={null}>
              <MissingCard type={type} search={search} canEdit={canEdit} />
            </Suspense>
          </div>
        )}
      </div>
    </>
  );
}

async function TrashLink({ trash }: { trash: boolean }) {
  const trashed = await getTrashedDocumentCount();

  return (
    <Link
      href={
        trash
          ? "/dashboard/settings/documents"
          : "/dashboard/settings/documents?trash=1"
      }
      className={`rounded-pill px-3 py-1 text-pill transition-colors ${
        trash
          ? "bg-accent-tint-strong text-accent-on-tint"
          : "bg-sunken text-ink-muted hover:bg-row-hover hover:text-ink"
      }`}
    >
      {trash ? "Back to documents" : `Trash${trashed ? ` · ${trashed}` : ""}`}
    </Link>
  );
}

async function TemplateCard({ canEdit }: { canEdit: boolean }) {
  const template = await getAgreementTemplate();

  return (
    <Card
      title="Rental agreement template"
      meta={template ? "on file" : "none uploaded"}
    >
      {canEdit ? (
        <AgreementTemplate template={template} />
      ) : (
        <p className="px-4 pb-4 text-body text-ink-muted">
          {template
            ? `${template.filename} is the PDF clients sign after approving a quote.`
            : "No template uploaded. An administrator has to add one before a client can sign."}
        </p>
      )}
    </Card>
  );
}

async function MissingCard({
  type,
  search,
  canEdit,
}: {
  type: string;
  search: string;
  canEdit: boolean;
}) {
  const { missing, storeMissing } = await getDocumentRows({
    documentType: type === "all" ? undefined : type,
    search: search || undefined,
  });

  if (missing === 0 || !canEdit) return null;

  return (
    <Card title="Files that aren’t there" meta={`${missing} of them`}>
      <RepairButton missing={missing} storeMissing={storeMissing} />
    </Card>
  );
}

async function Table({
  type,
  search,
  trash,
  canEdit,
}: {
  type: string;
  search: string;
  trash: boolean;
  canEdit: boolean;
}) {
  const { rows, missing, storeMissing } = await getDocumentRows({
    documentType: type === "all" ? undefined : type,
    search: search || undefined,
    trash,
  });

  const signed = rows.filter((row) => row.isSigned).length;

  if (trash) {
    return (
      <ListTable
        columns={TRASH_COLUMNS}
        total={rows.length}
        empty={
          <>
            Nothing in the trash. Anything trashed from the documents list lands
            here and can be put back.
          </>
        }
        rows={rows.map((row) => ({
          id: row.id,
          cells: {
            file: <span className="truncate font-bold">{row.filename}</span>,
            type: (
              <span className="text-ink-muted">
                {documentTypeLabels[row.documentType as DocumentType] ??
                  row.documentType}
              </span>
            ),
            belongs: (
              <span className="text-ink-muted">{row.entityLabel}</span>
            ),
            reason: (
              <span className="text-ink-muted">
                {row.deleteReason ?? (
                  <span className="text-ink-faint">No reason given</span>
                )}
              </span>
            ),
            when: (
              <span className="tabular-nums text-ink-muted">
                {row.deletedAt ? stamp(row.deletedAt) : "—"}
              </span>
            ),
            act: canEdit ? (
              <DocumentRowAction id={row.id} filename={row.filename} trashed />
            ) : null,
          },
        }))}
      />
    );
  }

  return (
    <ListTable
      columns={COLUMNS}
      total={rows.length}
      footerNote={
        rows.length ? (
          <>
            {signed} signed
            {missing > 0 ? (
              <>
                {" · "}
                {storeMissing
                  ? "no documents directory on this instance, so no file is readable"
                  : `${missing} with no file on disk`}
              </>
            ) : null}
          </>
        ) : undefined
      }
      empty={
        search || type !== "all" ? (
          <>
            Nothing matches. Documents are filed by type and named after the
            order or purchase order they belong to.
          </>
        ) : (
          <>
            No documents yet. They appear here as quotes, agreements, invoices
            and delivery notes are generated from orders — nothing is uploaded
            here by hand except the agreement template.
          </>
        )
      }
      rows={rows.map((row) => ({
        id: row.id,
        cells: {
          file: (
            <span className="truncate">
              <span className={row.fileExists ? "font-bold" : "text-ink-faint"}>
                {row.filename}
              </span>
              {row.fileExists ? null : (
                <span className="text-destructive"> · no file</span>
              )}
            </span>
          ),
          type: (
            <span className="text-ink-muted">
              {documentTypeLabels[row.documentType as DocumentType] ??
                row.documentType}
            </span>
          ),
          belongs: (
            <span className="text-ink-muted">
              {row.entityLabel}
              {row.entitySubLabel ? (
                <span className="text-ink-faint"> · {row.entitySubLabel}</span>
              ) : null}
            </span>
          ),
          signed: row.isSigned ? (
            <span title={row.signedBy ?? undefined}>
              {row.signedBy ?? "Signed"}
            </span>
          ) : (
            <span className="text-ink-faint">—</span>
          ),
          size: (
            <span className="tabular-nums text-ink-muted">
              {fileSize(row.fileSize)}
            </span>
          ),
          when: (
            <span className="tabular-nums text-ink-muted">
              {stamp(row.createdAt)}
            </span>
          ),
          act: canEdit ? (
            <DocumentRowAction
              id={row.id}
              filename={row.filename}
              trashed={false}
            />
          ) : null,
        },
      }))}
    />
  );
}
