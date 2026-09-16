import type { AskCategory, EnvSection } from "@/generated/prisma/client";

/**
 * The environment profile's vocabulary (docs/client-tracker.md, Phase 3).
 *
 * Prisma-free and type-only on the generated client, like `labels.ts` beside
 * it, so the editor form can import it without dragging the pg driver into the
 * browser.
 *
 * The profile answers one question per section: **what do they run, what of it
 * do we supply, and what have they asked us for.** Only the first column is
 * stored (`EnvironmentItem`). The second is read off the account's real order
 * lines and the third off `ClientAsk`, which is why both stay true without
 * anybody maintaining them — and why the vocabulary here has to reconcile three
 * different naming schemes: this file is where they meet.
 */

export const ENV_SECTIONS: EnvSection[] = [
  "WORKSTATION",
  "STORAGE",
  "NETWORK",
  "SOFTWARE",
  "SERVICES",
];

export const ENV_SECTION_LABEL: Record<EnvSection, string> = {
  WORKSTATION: "Workstations & GPUs",
  STORAGE: "Storage & NAS",
  NETWORK: "Network & remote access",
  SOFTWARE: "Software & pipeline",
  SERVICES: "Services",
};

/** What belongs in each section, for the empty state and the add form. */
export const ENV_SECTION_BLURB: Record<EnvSection, string> = {
  WORKSTATION: "Seats, GPUs, monitors — vendor and model, OS, and when they are due for refresh.",
  STORAGE: "NAS, servers and arrays — capacity, how full, protocol and how it is backed up.",
  NETWORK: "Switching, internet, VPN and remote desktop — how fast, and how people get in.",
  SOFTWARE: "DCC apps, render managers, farm and cloud use, license servers.",
  SERVICES: "Pro services, managed services and logistics — who does this for them today.",
};

/**
 * Which optional columns each section shows. `EnvironmentItem` carries a
 * superset of them; a form that offered all thirteen everywhere would ask a
 * storage array for its GPU.
 */
export type EnvField =
  | "vendor"
  | "quantity"
  | "os"
  | "gpu"
  | "capacityTb"
  | "percentUsed"
  | "protocol"
  | "backup"
  | "speed"
  | "refreshAt";

export const ENV_SECTION_FIELDS: Record<EnvSection, EnvField[]> = {
  WORKSTATION: ["vendor", "quantity", "os", "gpu", "refreshAt"],
  STORAGE: ["vendor", "quantity", "capacityTb", "percentUsed", "protocol", "backup", "refreshAt"],
  NETWORK: ["vendor", "quantity", "speed", "protocol", "refreshAt"],
  SOFTWARE: ["vendor", "quantity", "refreshAt"],
  SERVICES: ["vendor", "quantity", "refreshAt"],
};

export const ENV_FIELD_LABEL: Record<EnvField, string> = {
  vendor: "Vendor",
  quantity: "How many",
  os: "OS",
  gpu: "GPU",
  capacityTb: "Capacity (TB)",
  percentUsed: "% used",
  protocol: "Protocol",
  backup: "Backup",
  speed: "Speed",
  refreshAt: "Refresh due",
};

/** Placeholders, so the form says what kind of answer it wants. */
export const ENV_FIELD_HINT: Partial<Record<EnvField, string>> = {
  vendor: "Dell, Synology, Cisco…",
  os: "Windows 11, Rocky 9…",
  gpu: "RTX 6000 Ada",
  protocol: "SMB, NFS, iSCSI…",
  backup: "LTO-8, cloud, none",
  speed: "10GbE, 1Gb fibre…",
};

/** The name the add form asks for first, per section. */
export const ENV_NAME_HINT: Record<EnvSection, string> = {
  WORKSTATION: "Precision 7960",
  STORAGE: "RS4021xs+",
  NETWORK: "Catalyst 9300",
  SOFTWARE: "Nuke 15",
  SERVICES: "On-site support contract",
};

/**
 * Where an ask lands in the grid.
 *
 * `OTHER` goes to Services because that is what the spec calls that section:
 * "pro services, logistics, managed services, **and anything else** in the
 * VFXNow or GPL catalogue". An ask with nowhere to sit would simply vanish from
 * the profile, which is the one outcome worth avoiding here.
 */
export const ASK_SECTION: Record<AskCategory, EnvSection> = {
  WORKSTATION: "WORKSTATION",
  GPU: "WORKSTATION",
  STORAGE: "STORAGE",
  NETWORK: "NETWORK",
  REMOTE_ACCESS: "NETWORK",
  SOFTWARE: "SOFTWARE",
  CLOUD: "SOFTWARE",
  PRO_SERVICES: "SERVICES",
  MANAGED_SERVICES: "SERVICES",
  LOGISTICS: "SERVICES",
  OTHER: "SERVICES",
};

/**
 * Inventory's category names, mapped into the five sections.
 *
 * `AssetCategory` is a table a person edits, not an enum, so this cannot be
 * exhaustive and must not pretend to be. Every category on the instance today
 * is named outright; anything added later falls through to the keyword pass,
 * and anything that pass cannot place returns null and is counted under "other
 * kit we supply" rather than being silently filed in the wrong section.
 *
 * **Nothing maps to SOFTWARE on purpose.** This business rents hardware; no
 * asset category is a licence. So the supplied column of the Software section
 * is empty, and that is a true statement about the catalogue rather than a gap
 * in this table.
 */
const CATEGORY_SECTION: Record<string, EnvSection> = {
  "Workstations": "WORKSTATION",
  "Laptops": "WORKSTATION",
  "Desktops": "WORKSTATION",
  "Graphics Cards": "WORKSTATION",
  "Monitors": "WORKSTATION",
  "Color Monitors": "WORKSTATION",
  "Motherboards": "WORKSTATION",
  "RAM: 64GB": "WORKSTATION",
  "RAM: 128GB": "WORKSTATION",
  "System Upgrades": "WORKSTATION",
  "Peripherals": "WORKSTATION",
  "Accessories": "WORKSTATION",
  "A/V Hardware": "WORKSTATION",
  "Audio Equipment": "WORKSTATION",
  "Cameras": "WORKSTATION",

  "Storage": "STORAGE",
  "Storage Servers": "STORAGE",
  "External Storage": "STORAGE",
  "Internal Storage": "STORAGE",
  "Servers": "STORAGE",
  "Server Racks": "STORAGE",
  "8TB M.2 NVMe SSD": "STORAGE",

  "Networking": "NETWORK",
  "Network Equipment": "NETWORK",
  "Network Adapters": "NETWORK",
  "Cables": "NETWORK",
  "Power": "NETWORK",

  "Services": "SERVICES",
  "Managed Services (Monthly)": "SERVICES",
};

/** Checked in order — the first hit wins, so "Storage Servers" is storage. */
const CATEGORY_KEYWORDS: [string, EnvSection][] = [
  ["storage", "STORAGE"],
  ["nas", "STORAGE"],
  ["ssd", "STORAGE"],
  ["drive", "STORAGE"],
  ["server", "STORAGE"],
  ["network", "NETWORK"],
  ["switch", "NETWORK"],
  ["cable", "NETWORK"],
  ["router", "NETWORK"],
  ["service", "SERVICES"],
  ["workstation", "WORKSTATION"],
  ["laptop", "WORKSTATION"],
  ["desktop", "WORKSTATION"],
  ["gpu", "WORKSTATION"],
  ["graphics", "WORKSTATION"],
  ["monitor", "WORKSTATION"],
  ["ram", "WORKSTATION"],
];

export function sectionForCategory(name: string | null | undefined): EnvSection | null {
  if (!name) return null;
  const exact = CATEGORY_SECTION[name];
  if (exact) return exact;
  const lower = name.toLowerCase();
  for (const [word, section] of CATEGORY_KEYWORDS) {
    if (lower.includes(word)) return section;
  }
  return null;
}
