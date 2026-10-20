"use client";

import Link from "next/link";

/**
 * Shown when something under an entity page throws, most likely because the
 * entity's own database cannot be reached. The main app is unaffected; this
 * keeps the failure inside the entity route.
 */
export default function EntityError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-ground p-3">
      <section className="max-w-md rounded-card bg-panel p-6 text-center shadow-sm">
        <p className="text-micro uppercase text-ink-muted">Entity</p>
        <h1 className="mt-1 text-page-title">This entity isn’t responding</h1>
        <p className="mt-2 text-body text-ink-muted">Its records could not be loaded just now. Nothing was changed. Try again, and if it keeps failing tell an administrator.</p>
        <div className="mt-4 flex items-center justify-center gap-3">
          <button type="button" onClick={reset} className="rounded-bubble bg-accent-solid px-4 py-2 text-body font-bold text-accent-on-solid">Try again</button>
          <Link href="/dashboard" className="text-body text-ink-muted hover:text-ink">Back to VFXnow</Link>
        </div>
      </section>
    </div>
  );
}
