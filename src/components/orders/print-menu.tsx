"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Printer } from "lucide-react";

/**
 * Print, beside "View online quote": each document the order can produce,
 * rendered from the order as it stands (api/orders/[id]/print) and opened in a
 * new tab. A Flow order carries contract values the priced documents would
 * misrender, so it offers its quote and the unpriced asset list only.
 */
export function PrintMenu({ id, flow = false }: { id: string; flow?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const href = (query: string) => `/api/orders/${id}/print?${query}`;
  const items: { label: string; hint: string; query: string }[] = [
    { label: "Quote", hint: "What the client approves", query: "doc=quote" },
    ...(flow
      ? []
      : [
          { label: "Order detail", hint: "Lines, totals, shipping and return", query: "doc=order-detail" },
          { label: "Delivery note", hint: "For the box, with a signature line", query: "doc=delivery-note" },
        ]),
    { label: "Asset list", hint: "Gear and asset tags, with shipping", query: "doc=asset-list" },
    { label: "Asset list with serials", hint: "Adds each unit's serial number", query: "doc=asset-list&serials=1" },
  ];

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1 rounded-pill bg-sunken px-3 py-1 text-pill text-ink transition-colors hover:bg-row-hover"
      >
        <Printer className="size-3" aria-hidden />
        Print
        <ChevronDown className="size-3" aria-hidden />
      </button>
      {open ? (
        <ul
          role="menu"
          className="absolute left-0 z-20 mt-1 w-64 rounded-well border border-line bg-panel p-1 shadow-lg"
        >
          {items.map((item) => (
            <li key={item.query} role="none">
              <a
                role="menuitem"
                href={href(item.query)}
                target="_blank"
                rel="noopener"
                onClick={() => setOpen(false)}
                className="block rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
              >
                <span className="block font-bold">{item.label}</span>
                <span className="block text-ink-faint">{item.hint}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
