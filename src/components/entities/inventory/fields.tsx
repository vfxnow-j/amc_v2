export const FIELD =
  "h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
export const AREA =
  "w-full rounded-well border-0 bg-sunken px-3 py-2 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring";
export const PILL = "rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover disabled:opacity-50";
export const PRIMARY = "h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50";

export function Label({ children, text }: { children: React.ReactNode; text: string }) {
  return (
    <label className="flex flex-col gap-[3px]">
      <span className="text-micro uppercase text-ink-muted">{text}</span>
      {children}
    </label>
  );
}

/** Shown when a server action rejects (session expired, network drop) rather than returning an error result. */
export const NETWORK_ERROR = "Couldn't reach the server. Nothing was saved.";
export const READONLY_NOTICE = "Your role can look at this entity but not change it.";
