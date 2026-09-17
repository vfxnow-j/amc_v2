"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const FIELD =
  "h-9 rounded-well border border-hairline bg-sunken px-2 text-detail text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Ownership and category filters for the register — each change is a new URL, so a filtered view is a link. */
export function FixedAssetFilters({
  ownership,
  categories,
  ownershipOptions,
}: {
  ownership: { value: string; label: string } | null;
  categories: { id: string; name: string; selected: boolean }[];
  ownershipOptions: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        id="fa-ownership"
        aria-label="Ownership"
        value={ownership?.value ?? ""}
        onChange={(event) => set("ownership", event.target.value)}
        className={FIELD}
      >
        <option value="">Any ownership</option>
        {ownershipOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <select
        id="fa-category"
        aria-label="Category"
        value={categories.find((category) => category.selected)?.id ?? ""}
        onChange={(event) => set("category", event.target.value)}
        className={FIELD}
      >
        <option value="">Every category</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
    </div>
  );
}
