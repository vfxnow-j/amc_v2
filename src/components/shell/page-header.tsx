/**
 * The page header card every route renders at the top of the content column:
 * cluster name as an eyebrow, the page title, an optional one-line context
 * blurb, and right-aligned controls (a segmented pill, the primary action).
 */
export function PageHeader({
  eyebrow,
  title,
  blurb,
  actions,
}: {
  eyebrow?: string;
  title: string;
  /** Real context — "42 open orders · $1.24M booked" — never filler. */
  blurb?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex items-center gap-[14px] rounded-card bg-panel px-4 py-3 shadow-sm">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-micro uppercase text-ink-muted">{eyebrow}</p>
        ) : null}
        <h1 className="text-page-title truncate">{title}</h1>
        {blurb ? <p className="text-body text-ink-muted">{blurb}</p> : null}
      </div>
      {actions ? (
        <div className="ml-auto flex flex-none items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
