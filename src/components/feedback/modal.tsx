"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";

/**
 * The dialog a record's actions open.
 *
 * Built on the Radix primitive rather than on `components/ui/dialog.tsx` for
 * the same reason `Notice` was built fresh: that file is inherited shadcn kit
 * with its own palette and its own sizing, and bending it to the v2 tokens
 * leaves a component that looks like the kit and behaves like neither. What is
 * worth keeping from Radix is the part nobody hand-rolls correctly — the focus
 * trap, the escape key, the scroll lock, the labelled overlay — so that is what
 * is used, and nothing else.
 *
 * Every dialog here asks a question that changes the order. The footer is
 * therefore always the same shape: the consequence on the left where it can be
 * read, the way out and the way on at the right where the pointer already is.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  blurb,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One line saying what confirming will do. */
  blurb?: React.ReactNode;
  children?: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-card bg-panel shadow-lg outline-none"
        >
          <header className="flex items-start gap-3 px-4 pt-4">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-card-title">
                {title}
              </DialogPrimitive.Title>
              {blurb ? (
                <DialogPrimitive.Description className="mt-1 text-detail text-balance text-ink-muted">
                  {blurb}
                </DialogPrimitive.Description>
              ) : (
                // Radix warns without one, and a dialog with no description is
                // still a dialog — it just has nothing more to say than its title.
                <DialogPrimitive.Description className="sr-only">
                  {title}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              aria-label="Close"
              className="-mr-1 -mt-1 flex-none rounded-well p-1 text-ink-faint hover:bg-row-hover hover:text-ink"
            >
              <X className="size-4" aria-hidden />
            </DialogPrimitive.Close>
          </header>

          {children ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
          ) : (
            <div className="h-3" />
          )}

          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-hairline px-4 py-3">
            {footer}
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** The button that commits a dialog. One per dialog, always on the right. */
export function ModalConfirm({
  children,
  disabled,
  onClick,
  tone = "accent",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  /** `danger` for the moves that end an order rather than advance it. */
  tone?: "accent" | "danger";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`h-9 rounded-pill px-4 text-pill disabled:opacity-50 ${
        tone === "danger"
          ? "bg-destructive text-destructive-foreground"
          : "bg-accent-solid text-accent-on-solid"
      }`}
    >
      {children}
    </button>
  );
}

export function ModalCancel({ children = "Cancel" }: { children?: React.ReactNode }) {
  return (
    <DialogPrimitive.Close className="h-9 rounded-pill bg-sunken px-4 text-pill text-ink hover:bg-row-hover">
      {children}
    </DialogPrimitive.Close>
  );
}
