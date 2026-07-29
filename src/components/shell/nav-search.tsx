"use client";

/**
 * The rail's search well. It isn't an input — it opens the command palette,
 * which is where typing actually happens.
 */
export function NavSearch({
  onOpen,
  ref,
}: {
  onOpen: () => void;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      className="flex w-full cursor-pointer items-center rounded-well bg-sunken px-[10px] py-2 text-left"
    >
      <span className="text-[12px] text-ink-muted">Search or scan</span>
      <span
        aria-hidden
        className="ml-auto text-[10px] font-bold text-ink-faint"
      >
        ⌘K
      </span>
    </button>
  );
}
