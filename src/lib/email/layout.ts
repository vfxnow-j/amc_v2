/**
 * The one layout every outbound email is drawn in, and the pieces it is drawn
 * with.
 *
 * Before this, `templates.ts` had a private `baseLayout` (a dark bar reading
 * "VFXNow AMC" over a white box) and `notifications/digest-email.ts` retyped it
 * because it wasn't exported; every template then hand-wrote its own tables,
 * buttons and callouts in slightly different greys, paddings and blues. Forty
 * messages, forty dialects. This module is the vocabulary they now share, so a
 * quote, an approval ask and the depreciation report read as the same company.
 *
 * Built for mail clients, not browsers — which is why it looks old-fashioned:
 *
 * - **Tables for layout, styles inline.** Gmail strips `<style>` in many
 *   contexts and Outlook's Word engine ignores flexbox, `display:flex`,
 *   `margin:auto` on divs and most of CSS. Every structural element here is a
 *   `<table role="presentation">` with attributes and inline styles.
 * - **A light page.** Dark-mode clients invert a light email tolerably; they
 *   mangle a dark one. The brand's darkest surface is used only for the header
 *   band, where an inversion does no harm.
 * - **One image, the logo, as an inline CID attachment.** A linked `<img>`
 *   can't work: the logo lives at `/brand/...` on an instance whose APP_URL is
 *   localhost, and Gmail blocks data: URIs. So the header references
 *   `cid:vfxnow-logo`, and `send.ts` attaches `public/brand/email-logo-white.png`
 *   (the all-white logo at 192×128, 2× its 96×64 display size, ~8KB) with that
 *   content id to any message whose HTML references it — Gmail, Outlook and
 *   Apple Mail render it with no public URL. PNG, not SVG, which Gmail won't
 *   draw. The `alt` is the wordmark in white, so a client that blocks images
 *   still shows the name. The in-app preview swaps the cid for the `/brand` URL.
 * - **A preheader.** The hidden first line is what the inbox shows beside the
 *   subject; without one it shows whatever text comes first, which was the
 *   header's "VFXNow AMC" on every message.
 *
 * Colours are the default theme's ramps in `app/globals.css` (surface 0–13,
 * accent 500/700, danger/success/warning), copied as literals because CSS
 * variables do not survive a mail client. The CTA fill is accent-700
 * (#0081a1), which carries white text at 4.51:1 — AA, narrowly. The owner has a
 * pending decision to darken that stop to #00718d; if they take it, change
 * `BRAND.accent` here too.
 *
 * Plain module, no Prisma, no `"use server"`: templates are pure functions and
 * the settings screen renders a specimen from here.
 */

import { APP_URL } from './client'

export const BRAND = {
  page: '#f1f4f6', // surface-2
  panel: '#ffffff', // surface-0
  sunken: '#f4f6f8', // surface-1
  hairline: '#e7ebee', // surface-3
  rule: '#d5dbe0', // surface-4
  ink: '#15222a', // surface-12
  inkMuted: '#55606a', // surface-8
  inkFaint: '#6b757e', // surface-7
  band: '#0c1418', // surface-13
  accent: '#0081a1', // accent-700 — text and fills on light
  accentBright: '#00d0ff', // accent-500 — the mark, on the dark band only
  accentTint: '#e2f8ff', // accent-100
  danger: '#b42318',
  dangerTint: '#fef3f2',
  success: '#067647',
  successTint: '#ecfdf3',
  warning: '#b54708',
  warningTint: '#fffaeb',
  font: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  mono: "'SFMono-Regular', Menlo, Consolas, 'Courier New', monospace",
} as const

/** The inline logo's content id; `send.ts` attaches the file when HTML references it. */
export const LOGO_CID = 'vfxnow-logo'

/** Swap the cid for a URL a browser can load — for previews, never for mail. */
export function previewable(html: string, logoUrl = '/brand/email-logo-white.png'): string {
  return html.split(`cid:${LOGO_CID}`).join(logoUrl)
}

export type Tone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning'

const TONE: Record<Tone, { edge: string; fill: string; ink: string }> = {
  neutral: { edge: BRAND.rule, fill: BRAND.sunken, ink: BRAND.ink },
  accent: { edge: BRAND.accent, fill: BRAND.accentTint, ink: BRAND.ink },
  success: { edge: BRAND.success, fill: BRAND.successTint, ink: BRAND.ink },
  danger: { edge: BRAND.danger, fill: BRAND.dangerTint, ink: BRAND.ink },
  warning: { edge: BRAND.warning, fill: BRAND.warningTint, ink: BRAND.ink },
}

/** Text colour for a figure that should read as good, bad or late. */
export function toneInk(tone: Tone): string {
  if (tone === 'neutral' || tone === 'accent') return tone === 'accent' ? BRAND.accent : BRAND.ink
  return TONE[tone].edge
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

const esc = escapeHtml

/** A path inside the app, as an absolute link a mail client can open. */
export function appUrl(path: string): string {
  return path.startsWith('http') ? path : `${APP_URL}${path.startsWith('/') ? '' : '/'}${path}`
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const P = `margin:0 0 14px;font-family:${BRAND.font};font-size:15px;line-height:1.6;color:${BRAND.ink};`

/** A paragraph. `html` is trusted — escape anything user-typed before passing it. */
export function paragraph(html: string, options: { muted?: boolean; small?: boolean; center?: boolean } = {}): string {
  const color = options.muted ? BRAND.inkMuted : BRAND.ink
  const size = options.small ? 13 : 15
  return `<p style="${P}color:${color};font-size:${size}px;${options.center ? 'text-align:center;' : ''}">${html}</p>`
}

/**
 * "Hi Marvin Villa," — the whole name, escaped. Not the first word: half of the
 * names these templates are handed are account names ("A&B Studios"), and
 * "Hi A&B," reads like a mail merge gone wrong.
 */
export function greeting(name: string | null | undefined): string {
  const whole = (name ?? '').trim()
  return paragraph(whole ? `Hi ${esc(whole)},` : 'Hello,')
}

/** Bold, escaped. For names and numbers inside a paragraph. */
export function strong(text: string): string {
  return `<strong style="font-weight:700;color:${BRAND.ink};">${esc(text)}</strong>`
}

export function link(label: string, url: string): string {
  return `<a href="${esc(appUrl(url))}" style="color:${BRAND.accent};text-decoration:underline;">${esc(label)}</a>`
}

/** A section heading inside the body, with a hairline under it. */
export function section(title: string, meta?: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 10px;border-collapse:collapse;">
<tr><td style="padding:0 0 6px;border-bottom:2px solid ${BRAND.ink};font-family:${BRAND.font};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.ink};">${esc(title)}${
    meta ? `<span style="font-weight:400;letter-spacing:0;text-transform:none;color:${BRAND.inkMuted};"> &nbsp;·&nbsp; ${esc(meta)}</span>` : ''
  }</td></tr></table>`
}

export type Fact = {
  label: string
  value: string
  /** Colour the value. */
  tone?: Tone
  /** The value is already-safe HTML (a link, a figure with markup). */
  html?: boolean
}

/** Label on the left, value on the right, hairline between rows. */
export function facts(rows: (Fact | null | undefined | false)[]): string {
  const kept = rows.filter((row): row is Fact => !!row)
  if (kept.length === 0) return ''
  const body = kept
    .map((row, index) => {
      const border = index === 0 ? '' : `border-top:1px solid ${BRAND.hairline};`
      const color = row.tone ? toneInk(row.tone) : BRAND.ink
      return `<tr>
<td style="${border}padding:9px 12px 9px 0;font-family:${BRAND.font};font-size:14px;line-height:1.4;color:${BRAND.inkMuted};vertical-align:top;">${esc(row.label)}</td>
<td align="right" style="${border}padding:9px 0;font-family:${BRAND.font};font-size:14px;line-height:1.4;font-weight:700;color:${color};text-align:right;vertical-align:top;">${row.html ? row.value : esc(row.value)}</td>
</tr>`
    })
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px;border-collapse:collapse;">${body}</table>`
}

/** A tinted box with a coloured left edge. `html` is trusted. */
export function callout(html: string, options: { tone?: Tone; title?: string } = {}): string {
  const tone = TONE[options.tone ?? 'neutral']
  const title = options.title
    ? `<div style="margin:0 0 4px;font-family:${BRAND.font};font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.inkMuted};">${esc(options.title)}</div>`
    : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px;border-collapse:collapse;">
<tr><td style="background:${tone.fill};border-left:4px solid ${tone.edge};padding:12px 16px;font-family:${BRAND.font};font-size:14px;line-height:1.6;color:${tone.ink};">${title}${html}</td></tr></table>`
}

/** Escaped, line breaks kept — for notes and reasons people typed. */
export function quoted(text: string): string {
  return esc(text).replace(/\r?\n/g, '<br>')
}

/** The call to action. A bulletproof button: a table cell, so Outlook paints it. */
export function button(label: string, url: string, options: { secondary?: boolean } = {}): string {
  const fill = options.secondary ? BRAND.panel : BRAND.accent
  const ink = options.secondary ? BRAND.accent : '#ffffff'
  const edge = options.secondary ? `border:1px solid ${BRAND.accent};` : ''
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:24px auto 8px;border-collapse:separate;">
<tr><td align="center" bgcolor="${fill}" style="background:${fill};${edge}border-radius:6px;">
<a href="${esc(appUrl(url))}" style="display:inline-block;padding:13px 30px;font-family:${BRAND.font};font-size:15px;font-weight:700;line-height:1;color:${ink};text-decoration:none;border-radius:6px;">${esc(label)}</a>
</td></tr></table>`
}

/** The URL under a button, for clients that won't render one. */
export function fallbackLink(url: string): string {
  const full = appUrl(url)
  return paragraph(
    `If the button doesn&rsquo;t work, paste this into your browser:<br><a href="${esc(full)}" style="color:${BRAND.accent};word-break:break-all;">${esc(full)}</a>`,
    { muted: true, small: true },
  )
}

export type Column = { label: string; align?: 'left' | 'center' | 'right'; width?: string }

/**
 * A data table. Cells are trusted HTML — build them with `cell()` or escape.
 * `group` rows (a string instead of an array) span the table as a sub-heading.
 */
export function table(columns: Column[], rows: (string[] | { group: string; meta?: string })[], options: { dense?: boolean } = {}): string {
  const pad = options.dense ? '5px 6px' : '8px 8px'
  const size = options.dense ? 12 : 14
  const head = columns
    .map(
      (col) =>
        `<th align="${col.align ?? 'left'}" style="padding:${pad};${col.width ? `width:${col.width};` : ''}border-bottom:1px solid ${BRAND.rule};font-family:${BRAND.font};font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.inkMuted};text-align:${col.align ?? 'left'};">${esc(col.label)}</th>`,
    )
    .join('')
  let stripe = 0
  const body = rows
    .map((row) => {
      if (!Array.isArray(row)) {
        stripe = 0
        return `<tr><td colspan="${columns.length}" style="padding:12px 8px 5px;border-bottom:1px solid ${BRAND.rule};font-family:${BRAND.font};font-size:12px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${BRAND.ink};">${esc(row.group)}${
          row.meta ? `<span style="font-weight:400;letter-spacing:0;text-transform:none;color:${BRAND.inkMuted};"> &nbsp;${esc(row.meta)}</span>` : ''
        }</td></tr>`
      }
      const bg = stripe++ % 2 === 1 ? `background:${BRAND.sunken};` : ''
      return `<tr>${row
        .map(
          (value, index) =>
            `<td align="${columns[index]?.align ?? 'left'}" style="${bg}padding:${pad};border-bottom:1px solid ${BRAND.hairline};font-family:${BRAND.font};font-size:${size}px;line-height:1.4;color:${BRAND.ink};text-align:${columns[index]?.align ?? 'left'};vertical-align:top;">${value}</td>`,
        )
        .join('')}</tr>`
    })
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;border-collapse:collapse;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}

/** A cell: escaped main text, optional muted second line, optional tone. */
export function cell(main: string, options: { sub?: string | null; tone?: Tone; bold?: boolean; mono?: boolean; href?: string; faintZero?: boolean } = {}): string {
  const faint = options.faintZero && (main === '0' || main === '—')
  const color = faint ? BRAND.inkFaint : options.tone ? toneInk(options.tone) : BRAND.ink
  const weight = options.bold ? 'font-weight:700;' : ''
  const family = options.mono ? `font-family:${BRAND.mono};font-size:12px;` : ''
  const text = options.href
    ? `<a href="${esc(appUrl(options.href))}" style="color:${BRAND.accent};text-decoration:none;font-weight:700;">${esc(main)}</a>`
    : `<span style="color:${color};${weight}${family}">${esc(main)}</span>`
  const sub = options.sub ? `<br><span style="font-size:12px;color:${BRAND.inkMuted};">${esc(options.sub)}</span>` : ''
  return text + sub
}

export type Stat = { label: string; value: string; tone?: Tone; sub?: string }

/** A row of headline figures, two to four across. */
export function stats(items: Stat[]): string {
  if (items.length === 0) return ''
  const width = `${Math.floor(100 / items.length)}%`
  const cells = items
    .map(
      (item, index) => `<td width="${width}" valign="top" style="padding:12px 10px;${index > 0 ? `border-left:1px solid ${BRAND.hairline};` : ''}font-family:${BRAND.font};">
<div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.inkMuted};">${esc(item.label)}</div>
<div style="margin-top:4px;font-size:22px;font-weight:700;line-height:1.15;color:${item.tone ? toneInk(item.tone) : BRAND.ink};">${esc(item.value)}</div>
${item.sub ? `<div style="margin-top:3px;font-size:12px;line-height:1.35;color:${BRAND.inkMuted};">${esc(item.sub)}</div>` : ''}
</td>`,
    )
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px;border-collapse:collapse;background:${BRAND.sunken};border-radius:6px;"><tr>${cells}</tr></table>`
}

/** A bulleted list of escaped lines. */
export function bullets(lines: string[]): string {
  if (lines.length === 0) return ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px;border-collapse:collapse;">${lines
    .map(
      (line) =>
        `<tr><td valign="top" style="width:18px;padding:3px 0;font-family:${BRAND.font};font-size:15px;line-height:1.5;color:${BRAND.accent};">&#8226;</td><td style="padding:3px 0;font-family:${BRAND.font};font-size:15px;line-height:1.5;color:${BRAND.ink};">${esc(line)}</td></tr>`,
    )
    .join('')}</table>`
}

/** A one-time code, large and spaced. */
export function code(value: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:20px auto;border-collapse:separate;"><tr><td style="background:${BRAND.sunken};border:1px solid ${BRAND.rule};border-radius:8px;padding:14px 26px;font-family:${BRAND.mono};font-size:30px;font-weight:700;letter-spacing:8px;color:${BRAND.ink};">${esc(value)}</td></tr></table>`
}

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

export type Audience = 'staff' | 'client'

export type EmailFrame = {
  /** The inbox preview line. Say the point; it is read more than the body. */
  preheader: string
  /** Small uppercase label over the title: "Approval", "Report", "Quote". */
  eyebrow?: string
  title: string
  /** Muted line under the title: a record number, a date. */
  subtitle?: string
  /** The body, as trusted HTML built from the blocks above. */
  body: string
  cta?: { label: string; url: string }
  /**
   * Who it is for. Staff mail says where to change what they receive; client
   * mail says who it is from and invites a reply, and never links into the app.
   */
  audience: Audience
  /** Replaces the default footer line. Trusted HTML. */
  footer?: string
  /** Reports carry wide tables. */
  wide?: boolean
}

export type RenderedEmail = { subject: string; html: string; text: string }

/**
 * Draw a message.
 *
 * Returns the HTML only; `email()` below pairs it with a subject and a
 * plain-text alternative, which is what templates return.
 */
export function frame(options: EmailFrame): string {
  const width = options.wide ? 680 : 600
  const footer =
    options.footer ??
    (options.audience === 'staff'
      ? `Sent by VFXNow AMC. Change what you receive in <a href="${esc(appUrl('/dashboard/settings/notifications'))}" style="color:${BRAND.inkMuted};text-decoration:underline;">Settings &rarr; Notifications</a>.`
      : 'VFXNow &middot; Reply to this email and it reaches our team.')
  const eyebrow = options.eyebrow
    ? `<div style="margin:0 0 6px;font-family:${BRAND.font};font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${BRAND.accent};">${esc(options.eyebrow)}</div>`
    : ''
  const subtitle = options.subtitle
    ? `<div style="margin:6px 0 0;font-family:${BRAND.font};font-size:14px;line-height:1.4;color:${BRAND.inkMuted};">${esc(options.subtitle)}</div>`
    : ''

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(options.title)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.page};-webkit-text-size-adjust:100%;">
<!--preheader--><div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${BRAND.page};">${esc(options.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div><!--/preheader-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.page}" style="background:${BRAND.page};border-collapse:collapse;">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="${width}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${width}px;border-collapse:collapse;">
<!--chrome--><tr><td bgcolor="${BRAND.band}" style="background:${BRAND.band};border-radius:10px 10px 0 0;padding:14px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>
<td style="font-family:${BRAND.font};font-size:19px;font-weight:800;letter-spacing:-0.02em;color:#ffffff;line-height:1;"><img src="cid:${LOGO_CID}" width="96" height="64" alt="VFXnow" style="display:block;width:96px;height:64px;border:0;outline:none;text-decoration:none;color:#ffffff;font-family:${BRAND.font};font-size:19px;font-weight:800;"></td>
<td align="right" style="font-family:${BRAND.font};font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#b3bcc4;">${options.audience === 'staff' ? 'Asset management' : 'Equipment &amp; infrastructure'}</td>
</tr></table>
</td></tr>
<tr><td style="height:3px;line-height:3px;font-size:3px;background:${BRAND.accentBright};">&nbsp;</td></tr><!--/chrome-->
<tr><td bgcolor="${BRAND.panel}" style="background:${BRAND.panel};padding:30px 28px 10px;">
${eyebrow}<h1 style="margin:0;font-family:${BRAND.font};font-size:24px;font-weight:800;line-height:1.2;letter-spacing:-0.02em;color:${BRAND.ink};">${esc(options.title)}</h1>${subtitle}
<div style="height:18px;line-height:18px;font-size:18px;">&nbsp;</div>
${options.body}
${options.cta ? button(options.cta.label, options.cta.url) : ''}
<div style="height:18px;line-height:18px;font-size:18px;">&nbsp;</div>
</td></tr>
<tr><td bgcolor="${BRAND.panel}" style="background:${BRAND.panel};border-top:1px solid ${BRAND.hairline};border-radius:0 0 10px 10px;padding:16px 28px 20px;font-family:${BRAND.font};font-size:12px;line-height:1.55;color:${BRAND.inkMuted};">${footer}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

/** A finished message: subject, HTML and its plain-text alternative. */
export function email(subject: string, options: EmailFrame): RenderedEmail {
  const html = frame(options)
  return { subject, html, text: htmlToText(html) }
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#039;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
  '&middot;': '·',
  '&rarr;': '→',
  '&larr;': '←',
  '&mdash;': '—',
  '&ndash;': '–',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
  '&times;': '×',
  '&#8226;': '•',
  '&hellip;': '…',
}

/**
 * The plain-text alternative, derived from the HTML so the two can never say
 * different things.
 *
 * Crude on purpose — it only has to handle what this module emits: the
 * preheader is dropped (it is inbox chrome, not content), rows and blocks
 * become lines, cells are separated, and a link keeps its URL in brackets
 * unless the label already is the URL.
 */
export function htmlToText(html: string): string {
  let text = html
    .replace(/<!--preheader-->[\s\S]*?<!--\/preheader-->/g, '')
    .replace(/<!--chrome-->[\s\S]*?<!--\/chrome-->/g, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    // Source newlines are formatting, not content; only tags make lines.
    .replace(/\s*\n\s*/g, ' ')
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, label: string) => {
      const inner = label.replace(/<[^>]+>/g, '').trim()
      const url = href.replace(/&amp;/g, '&')
      return inner && inner !== url && !inner.includes(url) ? `${inner} (${url})` : url
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h1|h2|h3|tr|div|li|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '  ')
    .replace(/<[^>]+>/g, '')

  text = text.replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity] ?? ' ')

  return text
    .split('\n')
    .map((line) => line.replace(/[ \t ﻿͏]+/g, ' ').trim())
    .filter((line, index, lines) => line !== '' || (index > 0 && lines[index - 1] !== ''))
    .join('\n')
    .trim()
}
