// Regenerates the favicon, app icons and share image from public/brand/*.
// Run: node scripts/build-brand-assets.mjs   (uses sharp, already a dependency)
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const INK = "#14222a"; // --color-brand-text, the brand ink
const out = (f) => `src/app/${f}`;

// Icon tile: the ring mark (cyan) on the brand ink, rounded like the old tab icon.
async function tile(size, { round = true } = {}) {
  const pad = Math.round(size * 0.2);
  const ring = await sharp("public/brand/vfxnow-mark.png")
    .resize(size - pad * 2, size - pad * 2, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const r = round ? Math.round(size * 0.22) : 0;
  const bg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="${INK}"/></svg>`,
  );
  return sharp(bg).composite([{ input: ring, left: pad, top: pad }]).png({ compressionLevel: 9 }).toBuffer();
}

// ICO with PNG-embedded 16/32/48 images.
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map((s) => tile(s)));
const head = Buffer.alloc(6);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dir = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s;
  e[1] = s;
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});
writeFileSync(out("favicon.ico"), Buffer.concat([head, ...dir, ...pngs]));
writeFileSync(out("icon.png"), await tile(512));
// Apple masks its own corners; give it a full-bleed square.
writeFileSync(
  out("apple-icon.png"),
  await sharp(await tile(180, { round: false })).flatten({ background: INK }).png({ compressionLevel: 9 }).toBuffer(),
);

// Share image 1200x630: the app's lockup (white logo | AMC) on solid brand ink.
const W = 1200;
const H = 630;
const logoH = 280;
const FONT = "Liberation Sans, Helvetica, Arial, sans-serif";
const logo = await sharp("public/brand/VFXnow-Logo-AllWhite-Vector.png").resize({ height: logoH }).png().toBuffer();
const lw = (await sharp(logo).metadata()).width;
const labelW = 260;
const label = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${labelW}" height="${logoH}"><text x="0" y="${logoH / 2}" dominant-baseline="central" font-family="${FONT}" font-size="90" font-weight="700" letter-spacing="16" fill="#b8c4cc">AMC</text></svg>`,
);
const rule = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="130"><rect width="4" height="130" fill="#5d6a74"/></svg>`);
const gap = 44;
const total = lw + gap + 4 + gap + labelW - 20;
const x0 = Math.round((W - total) / 2);
const y0 = 110;
const tag = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="60"><text x="${W / 2}" y="30" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-size="34" font-weight="700" fill="#00d0ff">VFXnow | AMC</text></svg>`,
);
const share = await sharp({ create: { width: W, height: H, channels: 3, background: INK } })
  .composite([
    { input: logo, left: x0, top: y0 },
    { input: rule, left: x0 + lw + gap, top: y0 + (logoH - 130) / 2 },
    { input: label, left: x0 + lw + gap + 4 + gap, top: y0 },
    { input: tag, left: 0, top: y0 + logoH + 40 },
  ])
  .png({ compressionLevel: 9, palette: true, quality: 90 })
  .toBuffer();
writeFileSync(out("opengraph-image.png"), share);
writeFileSync(out("twitter-image.png"), share);
