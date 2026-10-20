/**
 * Entity gear must never reach VFXnow's numbers. This walks every value import under src/
 * and fails if main-app code can load the entity client, and if a client component can
 * bundle a Prisma client. Run: npm run check:entities
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { extractImports, findClientBundleViolations, findTaintViolations, type SourceInfo } from "../src/lib/entities/isolation";

const root = process.cwd();

function walk(dir: string, out: string[]) {
  for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(rel);
  }
}

const files: string[] = [];
walk("src", files);

const imports: Record<string, string[]> = {};
const directives: Record<string, SourceInfo["directive"]> = {};
for (const f of files) {
  const info = extractImports(readFileSync(path.join(root, f), "utf8"), f);
  imports[f] = info.imports;
  directives[f] = info.directive;
}

const fmt = (chain: string[]) => chain.join("\n      -> ");

const taint = findTaintViolations(imports);
const bundle = findClientBundleViolations(
  imports,
  directives,
  (f) => f.startsWith("src/app/entity/") || f.startsWith("src/components/entities/"),
);

console.log(`Scanned ${files.length} files under src/.`);
console.log("\n[1] Main-app code that can load the entity client");
if (taint.length === 0) console.log("  none");
for (const v of taint) console.log(`  ${v.file}\n      -> ${fmt(v.chain.slice(1))}`);
console.log("\n[2] Entity client components that can bundle a Prisma client");
if (bundle.length === 0) console.log("  none");
for (const v of bundle) console.log(`  ${v.file}\n      -> ${fmt(v.chain.slice(1))}`);

if (taint.length || bundle.length) {
  console.error("\nFAILED: entity isolation violated.");
  process.exit(1);
}
console.log("\nOK: entity isolation holds.");
