import Link from "next/link";

/**
 * Rendered when a page calls notFound() (gateEntityPage does, for a role that
 * may not open a write screen, or after a grant is revoked mid-session). It is a
 * segment-level file, so Next renders it inside this segment's layout: the
 * entity rail stays and only the content column shows this message.
 */
export default function EntityNotFound() {
  return (
    <section className="max-w-md rounded-card bg-panel p-6 shadow-sm">
      <p className="text-micro uppercase text-ink-muted">Entity</p>
      <h1 className="mt-1 text-page-title">That isn’t available</h1>
      <p className="mt-2 text-body text-ink-muted">
        The page doesn’t exist, or your access doesn’t include it.
      </p>
      <Link
        href="/dashboard"
        className="mt-4 inline-block rounded-bubble bg-accent-solid px-4 py-2 text-body font-bold text-accent-on-solid"
      >
        Back to VFXnow
      </Link>
    </section>
  );
}
