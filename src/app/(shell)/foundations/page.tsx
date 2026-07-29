import { PageHeader } from "@/components/shell/page-header";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Foundations preview: renders every semantic token in both themes so the token
 * layer can be checked on the test instance. Not part of the six-cluster IA —
 * it's a development surface, reachable at /foundations only.
 */

export const metadata = { title: "Design tokens" };

const SURFACES = [
  { token: "--ground", swatch: "bg-ground", use: "App background" },
  { token: "--panel", swatch: "bg-panel", use: "Cards, nav panel" },
  { token: "--sunken", swatch: "bg-sunken", use: "Search, user pod, wells" },
  { token: "--row-alt", swatch: "bg-row-alt", use: "Table zebra" },
  { token: "--hairline", swatch: "bg-hairline", use: "Dividers" },
];

const TYPE = [
  { name: "Page title", className: "text-page-title", sample: "Overview" },
  { name: "Card title", className: "text-card-title", sample: "Due back today" },
  { name: "KPI value", className: "text-kpi", sample: "78.4%" },
  { name: "Body", className: "text-body", sample: "42 open orders · $1.24M booked" },
  { name: "Detail", className: "text-detail", sample: "7 of 14 shown · scroll for the rest" },
  {
    name: "Micro-label",
    className: "text-micro uppercase",
    sample: "Units on rent",
  },
  {
    name: "Nav cluster",
    className: "text-nav-cluster",
    sample: "Service center",
  },
];

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card bg-panel p-[14px] shadow-sm">
      <h2 className="text-card-title mb-3">{title}</h2>
      {children}
    </section>
  );
}

export default function Foundations() {
  return (
    <>
      <PageHeader
        eyebrow="Foundations"
        title="Design tokens"
        blurb="Steps 1–2 of 6 · the Overview screen comes next"
        actions={<ThemeToggle />}
      />

      <div className="grid gap-3 md:grid-cols-2">
        <Card title="Surfaces">
          <ul className="flex flex-col gap-[2px]">
            {SURFACES.map((surface) => (
              <li
                key={surface.token}
                className="flex items-center gap-[9px] rounded-row p-2 odd:bg-row-alt"
              >
                <span
                  className={`size-6 rounded-tile ${surface.swatch} ring-1 ring-hairline`}
                />
                <code className="text-body">{surface.token}</code>
                <span className="ml-auto text-detail text-ink-faint">
                  {surface.use}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Accent roles">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-pill bg-accent-solid px-4 py-2 text-pill text-accent-on-solid"
            >
              Open the desk
            </button>
            <button
              type="button"
              className="rounded-pill bg-sunken px-[14px] py-2 text-pill text-ink"
            >
              Export
            </button>
            <span className="rounded-pill bg-accent-tint-strong px-2 py-px text-pill text-accent-on-tint">
              7 late
            </span>
            <a href="#" className="text-body text-accent-text underline">
              Open the desk →
            </a>
          </div>
          <div className="mt-3 rounded-bubble bg-accent-tint p-[14px]">
            <p className="text-micro uppercase text-accent-on-tint">Overdue</p>
            <p className="text-kpi text-accent-text">7 units</p>
            <p className="text-detail text-accent-on-tint">$465 in fees</p>
          </div>
          <p className="mt-3 text-detail text-ink-faint">
            Brand cyan never carries white text — light uses accent-700 for fills
            and accent body text, dark fills with full cyan and inks it dark.
          </p>
        </Card>

        <Card title="Type scale">
          <ul className="flex flex-col gap-[2px]">
            {TYPE.map((row) => (
              <li
                key={row.name}
                className="flex items-baseline gap-[9px] rounded-row p-2 odd:bg-row-alt"
              >
                <span className="w-28 shrink-0 text-detail text-ink-faint">
                  {row.name}
                </span>
                <span className={row.className}>{row.sample}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Radii">
          <ul className="flex flex-col gap-[6px]">
            {[
              { name: "Card, nav panel", className: "rounded-card", size: "16px" },
              { name: "Bubble, inner well", className: "rounded-bubble", size: "14px" },
              { name: "Search, user pod", className: "rounded-well", size: "12px" },
              { name: "Table row, chip", className: "rounded-row", size: "10px" },
              { name: "Mark tile, avatar", className: "rounded-tile", size: "9px" },
              { name: "Button, badge", className: "rounded-pill", size: "20px" },
            ].map((radius) => (
              <li key={radius.name} className="flex items-center gap-[9px]">
                <span
                  className={`size-8 shrink-0 bg-sunken ${radius.className}`}
                />
                <span className="text-body">{radius.name}</span>
                <span className="ml-auto text-detail text-ink-faint">
                  {radius.size}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Ported primitives">
          <p className="mb-3 text-detail text-ink-faint">
            shadcn/ui components carried over from v1, reading the v2 token layer
            — no second palette. Check these in both themes.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">Primary</Button>
            <Button size="sm" variant="secondary">
              Secondary
            </Button>
            <Button size="sm" variant="outline">
              Outline
            </Button>
            <Button size="sm" variant="ghost">
              Ghost
            </Button>
            <Button size="sm" variant="destructive">
              Destructive
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge>Confirmed</Badge>
            <Badge variant="secondary">Draft</Badge>
            <Badge variant="outline">Archived</Badge>
            <Badge variant="destructive">Overdue</Badge>
          </div>
          <Input className="mt-3" placeholder="Search units by serial…" />
        </Card>
      </div>
    </>
  );
}
