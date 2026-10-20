/**
 * Entity gear must never reach VFXnow's numbers. This walks every value import under src/
 * and fails if main-app code can load the entity client, if a client component can bundle a
 * Prisma client, or if the scan itself cannot be trusted (sealed file missing, import it
 * cannot resolve, dynamic import it cannot read). Run: npm run check:entities
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  aliasesFromPaths,
  buildGraph,
  extractImports,
  findClientBundleViolations,
  findCleanListViolations,
  findDynamicViolations,
  findTaintViolations,
  sealedPresenceErrors,
  type DynamicUse,
  type SourceInfo,
} from "../src/lib/entities/isolation";

const root = process.cwd();

function walk(dir: string, out: string[]) {
  for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(rel);
  }
}

const files: string[] = [];
walk("src", files);

const cfg = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
if (cfg.error) { console.error("Cannot read tsconfig.json"); process.exit(1); }
const aliases = aliasesFromPaths(cfg.config?.compilerOptions?.paths);
if (aliases.length === 0) { console.error("tsconfig.json has no compilerOptions.paths; the @/ alias cannot be resolved."); process.exit(1); }

const imports: Record<string, string[]> = {};
const directives: Record<string, SourceInfo["directive"]> = {};
const dynamic: Record<string, DynamicUse[]> = {};
let dynamicTotal = 0;
for (const f of files) {
  const info = extractImports(readFileSync(path.join(root, f), "utf8"), f);
  imports[f] = info.imports;
  directives[f] = info.directive;
  if (info.dynamic.length) { dynamic[f] = info.dynamic; dynamicTotal += info.dynamic.length; }
}

const fmt = (chain: string[]) => chain.join("\n      -> ");
let failed = false;
const section = (title: string) => console.log(`\n${title}`);

const presence = sealedPresenceErrors(files);
const { stats } = buildGraph(imports, aliases);
const taint = findTaintViolations(imports, aliases);
const clean = findCleanListViolations(imports, aliases);
const bundle = findClientBundleViolations(imports, directives, (f) => f.startsWith("src/app/entity/") || f.startsWith("src/components/entities/"), aliases);
const dyn = findDynamicViolations(dynamic);

console.log(`Scanned ${files.length} files under src/ (aliases: ${aliases.map((a) => a.key + (a.wildcard ? "*" : "")).join(", ")}).`);

section("[0] Sealed files present");
if (presence.length === 0) console.log("  ok");
for (const e of presence) { console.log(`  ${e}`); failed = true; }

section("[1] Main-app code that can load the entity client");
if (taint.length === 0) console.log("  none");
for (const v of taint) { console.log(`  ${v.file}\n      -> ${fmt(v.chain.slice(1))}`); failed = true; }

section("[1b] Files that must stay clean (imported by main-app code)");
if (clean.length === 0) console.log("  none reach the entity client");
for (const v of clean) { console.log(`  ${v.file}\n      -> ${fmt(v.chain.slice(1))}`); failed = true; }

section("[2] Entity client components that can bundle a Prisma client");
if (bundle.length === 0) console.log("  none");
for (const v of bundle) { console.log(`  ${v.file}\n      -> ${fmt(v.chain.slice(1))}`); failed = true; }

section("[3] Imports the check cannot follow");
if (stats.unresolved.length === 0 && dyn.length === 0) console.log("  none");
for (const u of stats.unresolved) { console.log(`  unresolved: ${u.file} imports "${u.spec}"`); failed = true; }
for (const d of dyn) { console.log(`  non-literal import()/require(): ${d.file}:${d.line}`); failed = true; }

if (failed) {
  console.error("\nFAILED: entity isolation violated or could not be verified.");
  process.exit(1);
}
console.log(
  `\nOK: entity isolation holds. Local specifiers ${stats.specifiers}: resolved ${stats.resolved}, unresolved ${stats.unresolved.length}; dynamic, unverifiable (allowed zones only): ${dynamicTotal}.`,
);
