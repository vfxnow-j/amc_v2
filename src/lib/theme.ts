/**
 * Appearance for the v2 shell: five independent choices, each persisted on the
 * `User` record with a localStorage mirror to avoid a flash before hydration.
 *
 * - **mode** — light / dark / system. `prefers-color-scheme` decides the first
 *   load before any choice exists, and the app defaults to dark for STAFF
 *   (warehouse lighting) and light for admin and finance.
 * - **theme** — which of the six palettes is loaded. A theme is not an accent:
 *   it sets every surface, every ink and the accent, so it repaints the app
 *   rather than tinting the buttons. Each has a light and a dark face, so six
 *   themes are twelve complete looks and the mode switch still means what it
 *   says.
 * - **surface, nav, tile** — grain rather than look: how far the page sits
 *   below its panels, and what the rail and the dashboard tiles are made of.
 *   Every value they can take is a stop on the current theme's own ramp, so
 *   they cost the other five themes nothing and a seventh nothing.
 *
 * Each resolves to one attribute on <html> — `data-mode`, `data-theme`,
 * `data-surface`, `data-nav`, `data-tile` — and all five are set before first
 * paint by ThemeScript.
 *
 * The names, keys, columns, options and defaults are one list, `AXES`, at the
 * bottom of this file. Read the note there before adding a sixth: the point of
 * that list is that a sixth is one row rather than an edit in five files.
 *
 * This module is imported by both server and client code and must stay pure —
 * nothing here may reach `lib/prisma`.
 */

export type ColorMode = "light" | "dark" | "system";
export type ResolvedMode = "light" | "dark";

export function isColorMode(value: unknown): value is ColorMode {
  return value === "light" || value === "dark" || value === "system";
}

export function systemMode(): ResolvedMode {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function resolveMode(mode: ColorMode): ResolvedMode {
  return mode === "system" ? systemMode() : mode;
}

/* -------------------------------------------------------------------------
   Themes
------------------------------------------------------------------------- */

export type ThemeId = string;

export type Theme = {
  id: ThemeId;
  label: string;
  blurb: string;
  /**
   * The three colours the picker shows per mode — ground, panel and accent.
   * A theme is more than one colour now, so a single dot could not say what
   * you are choosing. These are read straight off the generated ramps, so the
   * chip is the theme rather than an impression of it.
   */
  swatch: {
    light: { ground: string; panel: string; accent: string };
    dark: { ground: string; panel: string; accent: string };
  };
};

/**
 * The six themes.
 *
 * Each is two ramps in `globals.css` — fourteen surface stops and nine accent
 * stops — and nothing else. Every role in the app (`--ground`, `--panel`,
 * `--ink`, `--hairline`, the nav bubbles, the focus ring, the wordmark) is
 * mapped from those stops once per mode, so a theme never has to know a role
 * exists and a seventh is two ramps and a row here.
 *
 * The surface ramps are generated from the VFXnow ramp's own lightness curve
 * with a hue applied, so all six share a rhythm and differ in colour, and
 * every stop that carries text was checked at 4.5:1 against the surface it
 * sits on in both modes. Two stops needed correcting; both are recorded in the
 * comment above the theme blocks.
 */
export const THEMES: Theme[] = [
  {
    id: "vfxnow",
    label: "VFXnow",
    blurb: "The house palette — cool greys under the brand cyan.",
    swatch: {
      light: { ground: "#f1f4f6", panel: "#ffffff", accent: "#0081a1" },
      dark: { ground: "#0c1418", panel: "#15222a", accent: "#00d0ff" },
    },
  },
  {
    id: "graphite",
    label: "Graphite",
    blurb: "No hue anywhere, so colour only ever means status.",
    swatch: {
      light: { ground: "#f3f3f3", panel: "#ffffff", accent: "#48545d" },
      dark: { ground: "#121212", panel: "#202020", accent: "#78868f" },
    },
  },
  {
    id: "midnight",
    label: "Midnight",
    blurb: "Deep blue surfaces and indigo. The darkest of the six.",
    swatch: {
      light: { ground: "#f0f1f7", panel: "#ffffff", accent: "#4335a8" },
      dark: { ground: "#090d1b", panel: "#10162f", accent: "#8d84ff" },
    },
  },
  {
    id: "forest",
    label: "Forest",
    blurb: "Green-shifted greys and emerald.",
    swatch: {
      light: { ground: "#f1f6f4", panel: "#ffffff", accent: "#096b43" },
      dark: { ground: "#0b1912", panel: "#132c20", accent: "#16a86a" },
    },
  },
  {
    id: "ember",
    label: "Ember",
    blurb: "Warm surfaces and orange — easiest of the six in low light.",
    swatch: {
      light: { ground: "#f6f3f1", panel: "#ffffff", accent: "#9e4c00" },
      dark: { ground: "#18110c", panel: "#2a1e15", accent: "#ee7c15" },
    },
  },
  {
    id: "plum",
    label: "Plum",
    blurb: "Purple-shifted greys and violet.",
    swatch: {
      light: { ground: "#f5f1f6", panel: "#ffffff", accent: "#6430a6" },
      dark: { ground: "#150b19", panel: "#25132c", accent: "#9a5cf5" },
    },
  },
];

/** The house palette, and what everyone gets before they choose. */
export const DEFAULT_THEME: ThemeId = "vfxnow";

const THEME_IDS = new Set(THEMES.map((theme) => theme.id));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_IDS.has(value);
}

export function themeById(id: ThemeId): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

/* -------------------------------------------------------------------------
   The axes
------------------------------------------------------------------------- */

/**
 * Every appearance choice, as data.
 *
 * There are five places that have to know about an appearance choice: the
 * pre-paint script, the client store, the provider that writes the attributes,
 * the read from the User row and the write back to it. When mode and theme were
 * the only two, each of those five named both fields by hand — ten hardcoded
 * mentions of two ideas, and a sixth axis would have meant five more edits in
 * five files, one of which is a string of JavaScript.
 *
 * So the axes are a list, and all five walk it. Adding one is a row in `AXES`,
 * a nullable column on `User`, and — if it needs one — a rule in `globals.css`.
 * Nothing else changes.
 *
 * The pre-paint script is the reason this matters more than tidiness: it
 * inlines its own copy of the validation, because it has to run before any
 * module does. If its idea of a valid value ever differed from the store's, the
 * two would disagree for one frame and the app would flash. They cannot differ
 * now: both read this list.
 */
export type AxisId = "mode" | "theme" | "surface" | "nav" | "tile";

export type AxisOption = {
  value: string;
  label: string;
  /** One line of plain English — the picker's helper text and title. */
  hint: string;
};

export type Axis = {
  id: AxisId;
  /** What lands on <html>. */
  attribute: string;
  /** The localStorage mirror, which is what beats the round trip to the row. */
  storageKey: string;
  /** The `User` column that persists it. Nullable everywhere: unset is valid. */
  column: "colorMode" | "themeName" | "groundShade" | "navShade" | "tileStyle";
  /** Fieldset legend on the Appearance card. */
  label: string;
  /** What the axis is for, under the control. */
  blurb: string;
  options: AxisOption[];
  /** What an unset, unknown or hand-edited value falls back to. */
  fallback: string;
  /**
   * The one axis whose stored value is not what reaches the attribute: 'system'
   * has to ask the OS first. Flagged rather than special-cased by id, so the
   * pre-paint script and the store branch on the same fact.
   */
  asksTheDevice?: boolean;
};

/**
 * The three grain axes are all one CSS rule each, and every value they can take
 * is a stop on the current theme's ramp — see the "Appearance axes" block in
 * globals.css for why that is the whole design rather than an implementation
 * detail. Nothing here names a colour, so a seventh theme gets all three free.
 */
export const AXES: Axis[] = [
  {
    id: "mode",
    attribute: "data-mode",
    storageKey: "vfxnow-amc-mode",
    column: "colorMode",
    label: "Surfaces",
    blurb: "",
    fallback: "system",
    asksTheDevice: true,
    options: [
      { value: "light", label: "Light", hint: "Always the light surfaces." },
      {
        value: "system",
        label: "System",
        hint: "Follows this device's appearance setting.",
      },
      { value: "dark", label: "Dark", hint: "Always the dark surfaces." },
    ],
  },
  {
    id: "theme",
    attribute: "data-theme",
    storageKey: "vfxnow-amc-theme",
    column: "themeName",
    label: "Theme",
    blurb:
      "A theme repaints everything — backgrounds, cards, wells, rules, text and the accent — and each one has a light and a dark face, so the setting above still does what it says. Status colors are the exception: overdue, paid and damaged never follow the theme, so red keeps meaning red in all six.",
    fallback: DEFAULT_THEME,
    options: THEMES.map((theme) => ({
      value: theme.id,
      label: theme.label,
      hint: theme.blurb,
    })),
  },
  {
    id: "surface",
    attribute: "data-surface",
    storageKey: "vfxnow-amc-surface",
    column: "groundShade",
    label: "Page",
    blurb:
      "How far the page sits below the cards on it. Nothing but the background moves — the cards, the text and the accent are the theme's.",
    fallback: "soft",
    options: [
      {
        value: "flat",
        label: "Flat",
        hint: "Barely below the cards. Edges do the separating.",
      },
      { value: "soft", label: "Soft", hint: "The house setting." },
      {
        value: "deep",
        label: "Deep",
        hint: "Further below the cards, so they lift off the page.",
      },
    ],
  },
  {
    id: "nav",
    attribute: "data-nav",
    storageKey: "vfxnow-amc-nav",
    column: "navShade",
    label: "Navigation rail",
    blurb:
      "What the rail down the left is made of. The bubbles, the search field and the user pod keep their own shades on top of it.",
    fallback: "panel",
    options: [
      { value: "panel", label: "Card", hint: "The same surface as a card." },
      { value: "flush", label: "Flush", hint: "The page's own colour." },
      { value: "sunken", label: "Well", hint: "Recessed, like the search field." },
      { value: "tinted", label: "Tinted", hint: "A wash of the theme's accent." },
    ],
  },
  {
    id: "tile",
    attribute: "data-tile",
    storageKey: "vfxnow-amc-tile",
    column: "tileStyle",
    label: "Dashboard tiles",
    blurb:
      "What a tile on the dashboard is made of. Same four choices as the rail, because it is the same question about a different surface.",
    fallback: "panel",
    options: [
      { value: "panel", label: "Card", hint: "The same surface as a card." },
      { value: "flush", label: "Flush", hint: "The page's own colour." },
      { value: "sunken", label: "Well", hint: "Recessed, like a well." },
      { value: "tinted", label: "Tinted", hint: "A wash of the theme's accent." },
    ],
  },
];

/** One chosen value per axis. Every consumer passes the whole set around. */
export type AppearanceValues = Record<AxisId, string>;

export function axisById(id: AxisId): Axis {
  const axis = AXES.find((candidate) => candidate.id === id);
  if (!axis) throw new Error(`Unknown appearance axis: ${id}`);
  return axis;
}

/** True only for a value this axis actually offers. */
export function isAxisValue(axis: Axis, value: unknown): value is string {
  return (
    typeof value === "string" &&
    axis.options.some((option) => option.value === value)
  );
}

/**
 * What the app looks like when nobody has chosen anything. The mode's fallback
 * is overridden per role by the caller — dark for STAFF, light for admin and
 * finance — which is why this is a function of overrides rather than a
 * constant.
 */
export function appearanceDefaults(
  overrides: Partial<AppearanceValues> = {},
): AppearanceValues {
  const values = {} as AppearanceValues;
  for (const axis of AXES) {
    const override = overrides[axis.id];
    values[axis.id] = isAxisValue(axis, override) ? override : axis.fallback;
  }
  return values;
}

/**
 * Coerce anything — a User row, a localStorage read, a hand-edited value — into
 * a complete set. Unrecognised values fall back rather than being trusted onto
 * the attribute, where they would select a rule that does not exist.
 */
export function normalizeAppearance(
  input: Partial<Record<AxisId, unknown>>,
  defaults: AppearanceValues,
): AppearanceValues {
  const values = {} as AppearanceValues;
  for (const axis of AXES) {
    const value = input[axis.id];
    values[axis.id] = isAxisValue(axis, value) ? value : defaults[axis.id];
  }
  return values;
}

/**
 * The stored value, resolved to what actually goes on the attribute. Only the
 * mode differs from what was chosen, and only when it is 'system'.
 */
export function attributeValue(axis: Axis, value: string): string {
  return axis.asksTheDevice ? resolveMode(value as ColorMode) : value;
}
