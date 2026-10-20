import Link from "next/link";

/** Shown by the entity layout when requireEntity refuses: no grant, a deactivated entity, or a wrong slug. */
export function EntityDenied({ message }: { message: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-ground p-3">
      <section className="max-w-md rounded-card bg-panel p-6 text-center shadow-sm">
        <p className="text-micro uppercase text-ink-muted">Entity</p>
        <h1 className="mt-1 text-page-title">You can’t open this entity</h1>
        <p className="mt-2 text-body text-ink-muted">{message}</p>
        <Link
          href="/dashboard"
          className="mt-4 inline-block rounded-bubble bg-accent-solid px-4 py-2 text-body font-bold text-accent-on-solid"
        >
          Back to VFXnow
        </Link>
      </section>
    </div>
  );
}
