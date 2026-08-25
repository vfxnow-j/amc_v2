/**
 * Proposing asset families from the model names that already exist.
 *
 * This module suggests; it never decides. Whether "RTX 5090 32G" and "RTX 5090
 * 32GB OC" are the same product is a judgment about hardware, not a fact
 * recoverable from a string, and the data offers no help: `manufacturer` is
 * filled on 12 of 224 assets and `model` on 9. So the output of this file is
 * something a person reviews, and nothing here writes.
 *
 * Prisma-free, and takes plain rows: the review screen is a client component,
 * and an import reaching `lib/prisma` drags the pg driver into the browser.
 */

export type GroupableAsset = {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  /** Units in the fleet — shown in the review so the weight of a group is visible. */
  units: number;
};

export type FamilySuggestion = {
  /** Proposed family name, in the casing the models actually use. */
  name: string;
  categoryName: string;
  /** How many leading words the members share. Higher means a tighter match. */
  sharedWords: number;
  assets: GroupableAsset[];
};

/**
 * A group this size is almost certainly too broad and gets refined by one more
 * word before being offered. "GeForce RTX" catches 24 models spanning the 2080
 * to the 5090 — four generations of different products — where "GeForce RTX
 * 2080" catches four variants of one.
 */
const MAX_GROUP = 6;

/** Two words is the floor: one word groups every Dell together. */
const MIN_WORDS = 2;

/**
 * Beyond this, the prefix is the whole name and the "family" is one model with
 * a long title.
 */
const MAX_WORDS = 5;

function words(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** The first `count` words of the original name, in its own casing. */
function label(name: string, count: number): string {
  const original = name.split(/\s+/).filter(Boolean);
  // Walk the original tokens until `count` normalised words have been consumed,
  // so punctuation in the source doesn't shift the label off by a word.
  const out: string[] = [];
  let consumed = 0;
  for (const token of original) {
    if (consumed >= count) break;
    out.push(token);
    consumed += words(token).length;
  }
  return out.join(" ");
}

/**
 * Group one category's models, refining a group that comes out too broad.
 *
 * Recursion is what makes both the RTX 5090 case and the Mac Studio case come
 * out right from one rule. Mac Studio's four models share two words and stop
 * there, so they stay one family; GeForce's twenty-four also share two, exceed
 * the ceiling, and split again on the third word into one family per
 * generation.
 */
function groupWithin(
  assets: GroupableAsset[],
  wordCount: number,
  out: FamilySuggestion[],
): void {
  if (wordCount > MAX_WORDS) {
    if (assets.length >= 2) out.push(build(assets, MAX_WORDS));
    return;
  }

  const buckets = new Map<string, GroupableAsset[]>();
  for (const asset of assets) {
    const key = words(asset.name).slice(0, wordCount).join(" ");
    const bucket = buckets.get(key);
    if (bucket) bucket.push(asset);
    else buckets.set(key, [asset]);
  }

  for (const bucket of buckets.values()) {
    // A model with nothing to sit beside is not a family. It stays ungrouped,
    // which is a normal resting state rather than an unfinished one.
    if (bucket.length < 2) continue;
    if (bucket.length > MAX_GROUP && wordCount < MAX_WORDS) {
      groupWithin(bucket, wordCount + 1, out);
      continue;
    }
    out.push(build(bucket, wordCount));
  }
}

function build(assets: GroupableAsset[], wordCount: number): FamilySuggestion {
  // Name off the shortest member: it carries the least model-specific tail, so
  // "Mac Studio" wins over "Mac Studio M1".
  const shortest = [...assets].sort((a, b) => a.name.length - b.name.length)[0];
  return {
    name: label(shortest.name, wordCount),
    categoryName: assets[0].categoryName,
    sharedWords: wordCount,
    assets: [...assets].sort((a, b) => b.units - a.units || a.name.localeCompare(b.name)),
  };
}

/**
 * Every family worth offering, biggest first.
 *
 * Grouping never crosses a category. It is the one signal the data actually
 * has, and without it "EMC Isilon" would merge four models filed under Storage
 * with four under Storage Servers — which may well be right, but is a call for
 * the person reviewing rather than an assumption made on their behalf.
 */
export function suggestFamilies(
  assets: GroupableAsset[],
): FamilySuggestion[] {
  const byCategory = new Map<string, GroupableAsset[]>();
  for (const asset of assets) {
    const bucket = byCategory.get(asset.categoryId);
    if (bucket) bucket.push(asset);
    else byCategory.set(asset.categoryId, [asset]);
  }

  const out: FamilySuggestion[] = [];
  for (const bucket of byCategory.values()) {
    groupWithin(bucket, MIN_WORDS, out);
  }

  return out.sort(
    (a, b) =>
      b.assets.length - a.assets.length ||
      b.assets.reduce((s, x) => s + x.units, 0) -
        a.assets.reduce((s, x) => s + x.units, 0) ||
      a.name.localeCompare(b.name),
  );
}
