/**
 * The card every record screen is built from.
 *
 * Written for the reservation record and extracted when the rest of the records
 * landed, the same way `components/list` was extracted from the Reservations
 * hub. A record is a header plus a column of these; the cluster-specific cards
 * (an order's lines, a client's credit position) compose `Card` rather than
 * reinventing the chrome, so a record in Revenue and a record in Inventory read
 * as the same screen.
 *
 * `CardSkeleton` takes the row count so the placeholder occupies the height the
 * real card will — a card that loads and then pushes everything below it down is
 * worse than one that takes a moment.
 */

export function Card({
  title,
  meta,
  action,
  children,
  className = "",
}: {
  title: string;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm ${className}`}
    >
      <header className="flex items-center gap-2 px-4 pb-3">
        <h2 className="text-card-title">{title}</h2>
        {meta ? <span className="text-detail text-ink-muted">{meta}</span> : null}
        {action ? <span className="ml-auto">{action}</span> : null}
      </header>
      {children}
    </section>
  );
}

export function CardSkeleton({
  title,
  rows = 6,
}: {
  title: string;
  rows?: number;
}) {
  return (
    <section className="flex min-h-0 flex-col rounded-card bg-panel pt-[14px] shadow-sm">
      <div className="px-4 pb-3">
        <h2 className="text-card-title text-ink-muted">{title}</h2>
      </div>
      <div className="flex flex-col gap-[2px] px-2 pb-3">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="h-[30px] animate-pulse rounded-row bg-row-alt"
          />
        ))}
      </div>
    </section>
  );
}

/**
 * What a card says when it has nothing to show. Never "No data" — the build
 * plan's rule is that an empty state names the next action, and the caller
 * passes that sentence.
 */
export function CardEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 pb-4 text-body text-balance text-ink-muted">{children}</p>
  );
}

/** Label over value, the unit a record header's detail grid is made of. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <span className="text-body">{children}</span>
    </div>
  );
}

/** An unset value, so a blank cell never reads as a rendering fault. */
export function Unset({ children = "—" }: { children?: React.ReactNode }) {
  return <span className="text-ink-faint">{children}</span>;
}
