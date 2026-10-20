# Branding: favicon and share previews

## Assets chosen
- Favicon / app icons: public/brand/vfxnow-mark.png (the cyan ring, with the white "VFX" inside) on the brand ink tile #14222a (--color-brand-text), the same tile the old tab icon used. The old src/app/icon.svg carried a "v2" dev badge; it is replaced (removed) so the tab shows the logo.
- Share image: the app's own lockup, as rendered by src/components/shell/brand-lockup.tsx (sign-in page and rail header): public/brand/VFXnow-Logo-AllWhite-Vector.png, a hairline rule, and "AMC", on solid #14222a (opaque, so it reads on light and dark chat backgrounds). A cyan "VFXnow | AMC" line sits beneath it. The AMC label uses Liberation Sans bold because the app's lockup uses the UI font and it is not installed locally; swap if exact type matters.
- Question for owner: "main page" was read as the app's own sign-in/rail lockup. If the public marketing site (vfxnow.com) lockup was meant, it could not be fetched from here.

## Files
- scripts/build-brand-assets.mjs (regenerates everything; uses sharp, already a dependency; NO new dependencies; the ICO is written by hand with PNG-embedded 16/32/48)
- src/app/favicon.ico (3.5KB, 16/32/48), icon.png (512x512, 26KB), apple-icon.png (180x180, 6.7KB, full-bleed), opengraph-image.png and twitter-image.png (1200x630, 11.9KB each), plus .alt.txt for both ("VFXnow | AMC logo on a dark background")
- src/app/robots.ts (disallow all), src/app/layout.tsx, src/app/quote/layout.tsx, src/app/requirements/layout.tsx, src/proxy.ts (/robots.txt made reachable without a session)

## Metadata decisions
- layout.tsx: openGraph (website, siteName and title "VFXnow | AMC", generic description), twitter summary_large_image, applicationName, robots noindex/nofollow. In-app tab title template "%s · AMC v2" and the description are kept (description text now says "VFXnow", not "VFXNow", for brand consistency).
- `icons` key not set: the file conventions emit favicon, icon and apple-touch-icon links automatically (verified in rendered HTML).
- Quote portal tab titles are now absolute and static: "Your quote · VFXnow", "Your documents · VFXnow". Link unfurls use the root openGraph, so they show "VFXnow | AMC" with the generic description. Login's unfurl is the same (its tab title stays "Sign in · AMC v2").
- robots: nothing existed. Added metadata robots plus robots.txt. Unfurlers ignore both.

## metadataBase
Reuses existing APP_URL, then NEXTAUTH_URL (the same pair src/lib/email/client.ts uses; .env.example already lists both; nothing added to any env file). Unset: development falls back to http://localhost:3001; production omits metadataBase. Trade-off: omitting avoids baking in a wrong host, but then the og:image URL is not correct for outside scrapers, so previews will have no image until APP_URL is set to the real public host. The owner must supply that production URL.

## Privacy review
All generateMetadata functions that interpolate data live under the signed-in (shell) group (invoices, units, leads, etc.); none under src/app/quote or src/app/requirements. quote/[token] and quote/preview/[id] inherit static metadata only. No dynamic OG images. Share text and image are static.

## Verification
- tsc: only the known RouteContext errors in src/app/api/requirements/[token]/{agreement,sign,upload}/route.ts. eslint clean on touched files.
- Image dimensions/format/sizes checked with `file` and sharp (above). Viewed the share image and icon visually.
- Production `next build` run inside the worktree (dummy DATABASE_URL pointing at an unreachable port, dummy auth secrets, APP_URL=https://amc.example.test, none written to disk), `next start -p 3999`: /login and /quote/abc heads show the favicon/icon/apple-touch links, og:* and twitter:* tags with absolute image URLs, robots noindex,nofollow; /robots.txt returns Disallow: /; /opengraph-image.png returns 200 unauthenticated. Server stopped, .next and the symlinks removed.
- Not verified: real unfurls in chat apps (needs a public host), a real quote page (no DB), and the unset-APP_URL production case beyond reading the code.
