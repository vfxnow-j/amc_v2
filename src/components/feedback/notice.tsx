import type { ReactNode } from "react";

/**
 * The strip of text a panel shows after it tried something.
 *
 * **This existed already.** `components/auth/auth-shell` had it, with this same
 * `tone` API and the same two colorways — and in the rest of the app the same
 * strip was hand-rolled twenty-five times across fifteen files: settings,
 * leads, reservations, service, inventory. Nobody looking to show an error in a
 * settings panel goes reading the auth shell, which is the whole argument for a
 * shared primitive not living in a cluster folder. The auth copy is gone and
 * its screens import this; they pass the `mb-4` it used to hard-code.
 *
 * Two of the hand-rolled copies had already drifted, which is what the
 * duplication costs: an accent strip with no `role`, so a screen reader was
 * told nothing, and one built as a `<div>` because its contents needed to be.
 *
 * Built fresh rather than on `components/ui/alert.tsx`. That one is inherited
 * shadcn kit — its own palette, its own sizing, a title/description slot none
 * of these need — and bending it to the v2 tokens would leave a component that
 * looks like the kit and behaves like neither.
 *
 * A `<div>`, not a `<p>`: one caller wraps a paragraph and a `<code>` block,
 * and a `<p>` cannot legally hold either. Tailwind's reset removes the default
 * margin, so nothing moved.
 *
 * The tone carries the ARIA role rather than leaving it to each caller. An
 * error that fails silently for a screen reader is the one that most needed
 * announcing, and `role` is exactly the detail that gets forgotten on the
 * twenty-fifth copy.
 */
export function Notice({
  tone,
  className,
  children,
}: {
  /** `error` announces assertively; `ok` announces politely. */
  tone: "error" | "ok";
  /** Spacing only — the caller owns where it sits, not what it looks like. */
  className?: string;
  children: ReactNode;
}) {
  const palette =
    tone === "error"
      ? "bg-destructive/10 text-destructive"
      : "bg-accent-tint text-accent-on-tint";

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-well px-3 py-2 text-detail ${palette}${className ? ` ${className}` : ""}`}
    >
      {children}
    </div>
  );
}
