import ts from "typescript";

/**
 * Pure import-graph logic behind `npm run check:entities`. Entity gear must never reach
 * VFXnow's numbers, which holds only while main-app code cannot load the entity client, so
 * the check follows VALUE imports transitively (type-only imports are erased and load nothing).
 *
 * The check must fail closed: a missing sealed file, an import it cannot resolve, or a
 * dynamic import it cannot read outside the entity zones is a failure, never a silent pass.
 */

export type DynamicUse = { line: number };

export type SourceInfo = {
  /** Raw specifiers of value imports, re-exports, import-equals, require() and import() with a literal. */
  imports: string[];
  /** import()/require() calls whose argument is not a plain literal, so cannot be followed. */
  dynamic: DynamicUse[];
  directive: "use client" | "use server" | null;
};

const isLiteral = (n: ts.Node): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);

/** Read the value-import specifiers and the file's module directive out of source text. */
export function extractImports(source: string, fileName = "x.tsx"): SourceInfo {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, /x$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports: string[] = [];
  const dynamic: DynamicUse[] = [];
  let directive: SourceInfo["directive"] = null;
  for (const st of sf.statements) {
    if (ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression)) {
      if (st.expression.text === "use client" || st.expression.text === "use server") directive = st.expression.text;
      continue;
    }
    break;
  }
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const c = node.importClause;
      const named = c?.namedBindings;
      const allTypeNamed = !!named && ts.isNamedImports(named) && !c?.name && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly);
      if (!c?.isTypeOnly && !allTypeNamed) imports.push(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
      if (!node.isTypeOnly) imports.push(node.moduleReference.expression.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const allTypeNamed = !!node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every((e) => e.isTypeOnly);
      if (!node.isTypeOnly && !allTypeNamed) imports.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isImport || isRequire) {
        const arg = node.arguments[0];
        if (arg && isLiteral(arg)) imports.push(arg.text);
        else dynamic.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { imports, dynamic, directive };
}

/** A tsconfig `paths` entry, reduced to what resolution needs. Targets are relative to the repo root. */
export type Alias = { key: string; wildcard: boolean; targets: string[] };

const stripDot = (p: string) => p.replace(/^\.\//, "");

/** Turn tsconfig compilerOptions.paths into aliases. Reading them (not hard-coding `@/*`) means a new alias cannot be ignored. */
export function aliasesFromPaths(paths: Record<string, string[]> | undefined): Alias[] {
  return Object.entries(paths ?? {}).map(([key, targets]) => {
    const wildcard = key.endsWith("*");
    return { key: wildcard ? key.slice(0, -1) : key, wildcard, targets: targets.map((t) => stripDot(wildcard ? t.replace(/\*$/, "") : t)) };
  });
}

export const DEFAULT_ALIASES: Alias[] = aliasesFromPaths({ "@/*": ["./src/*"] });

const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];
const JS_SUFFIX = /\.(?:[cm]?js|jsx)$/;

/** Specifiers for assets and data: not code, so never part of the graph. */
export const ASSET_RE = /\.(?:css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|ico|json|woff2?|ttf|otf|eot|md|mdx|txt|csv|pdf|mp4|webm|mp3|wasm)$/i;

function bases(spec: string, from: string, aliases: Alias[]): string[] {
  if (spec.startsWith(".")) {
    const parts = from.split("/").slice(0, -1);
    for (const seg of spec.split("/")) {
      if (seg === "." || seg === "") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    return [parts.join("/")];
  }
  const out: string[] = [];
  for (const a of aliases) {
    if (a.wildcard ? spec.startsWith(a.key) : spec === a.key) {
      for (const t of a.targets) out.push(a.wildcard ? t + spec.slice(a.key.length) : t);
    }
  }
  return out;
}

/** True for specifiers that point into the repo (alias or relative), as opposed to packages. */
export function isLocalSpecifier(spec: string, aliases: Alias[]): boolean {
  return spec.startsWith(".") || aliases.some((a) => (a.wildcard ? spec.startsWith(a.key) : spec === a.key));
}

/** Resolve a specifier from `from` to a key of `files`, or null (packages, unknown files). */
export function resolveSpecifier(spec: string, from: string, files: ReadonlySet<string>, aliases: Alias[] = DEFAULT_ALIASES): string | null {
  for (const base of bases(spec, from, aliases)) {
    const stems = [base];
    if (JS_SUFFIX.test(base)) stems.push(base.replace(JS_SUFFIX, ""));
    for (const stem of stems) {
      for (const cand of [stem, ...EXTS.map((e) => stem + e), ...EXTS.map((e) => `${stem}/index${e}`)]) {
        if (files.has(cand)) return cand;
      }
    }
  }
  return null;
}

export type Graph = Map<string, string[]>;
export type Unresolved = { file: string; spec: string };
export type GraphStats = { specifiers: number; resolved: number; unresolved: Unresolved[] };

export function buildGraph(imports: Record<string, string[]>, aliases: Alias[] = DEFAULT_ALIASES): { graph: Graph; stats: GraphStats } {
  const files = new Set(Object.keys(imports));
  const graph: Graph = new Map();
  const stats: GraphStats = { specifiers: 0, resolved: 0, unresolved: [] };
  for (const [file, specs] of Object.entries(imports)) {
    const out: string[] = [];
    for (const s of specs) {
      if (!isLocalSpecifier(s, aliases) || ASSET_RE.test(s)) continue;
      stats.specifiers++;
      const r = resolveSpecifier(s, file, files, aliases);
      if (r) { out.push(r); stats.resolved++; } else stats.unresolved.push({ file, spec: s });
    }
    graph.set(file, out);
  }
  return { graph, stats };
}

const ENTITY_CLIENT = "src/lib/entities/client.ts";
const GENERATED_PREFIX = "src/generated/entity-prisma/";
const sealedByPath = (file: string) => file === ENTITY_CLIENT || file.startsWith(GENERATED_PREFIX);
export const SEALED = sealedByPath;

/**
 * Sealed by path (client.ts, the generated entity client) AND by content: any file that
 * value-imports the generated entity client is itself a way to reach it, so moving or
 * renaming client.ts, or adding a second wrapper, is still caught.
 */
export function sealedFiles(g: Graph): Set<string> {
  const s = new Set<string>();
  for (const [f, outs] of g) if (sealedByPath(f) || outs.some((o) => o.startsWith(GENERATED_PREFIX))) s.add(f);
  return s;
}

/** Errors for a scan that cannot be trusted because the sealed files are not there. */
export function sealedPresenceErrors(files: Iterable<string>): string[] {
  const list = [...files];
  const errs: string[] = [];
  if (!list.includes(ENTITY_CLIENT)) errs.push(`${ENTITY_CLIENT} was not scanned; the check would pass vacuously.`);
  if (!list.some((f) => f.startsWith(GENERATED_PREFIX))) errs.push(`No file under ${GENERATED_PREFIX} was scanned. Run \`npm run db:generate\` first.`);
  return errs;
}

const ALLOWED_PREFIXES = [
  "src/lib/entities/",
  "src/app/entity/",
  "src/components/entities/",
  "src/lib/queries/entity-inventory.ts",
  "src/lib/queries/entity-screens.ts",
  "src/generated/",
];
export const inAllowedZone = (file: string) => ALLOWED_PREFIXES.some((p) => file.startsWith(p)) || /^src\/lib\/actions\/entity-[^/]*\.ts$/.test(file);

/**
 * Files that sit in an allowed zone but must NOT reach the sealed files, because main-app
 * code imports them: membership.ts (shell layout, switch-entity menu), url.ts and provision.ts
 * and create.ts (Settings -> Entities creates databases), save-access.ts, access.ts, gate.ts
 * and access-input.ts (Settings -> Users and the entity grants), naming.ts, modules.ts,
 * dates.ts, schemas.ts (shared pure helpers used by both sides), entity-input.ts (Settings ->
 * Entities form), and entities-registry.ts (the Settings -> Entities server actions). A leak
 * here would reach the main app through them, so it is caught at the cause, not only at the
 * consequence in the main file.
 */
export const MUST_STAY_CLEAN: string[] = [
  "src/lib/entities/membership.ts",
  "src/lib/entities/url.ts",
  "src/lib/entities/access.ts",
  "src/lib/entities/access-input.ts",
  "src/lib/entities/gate.ts",
  "src/lib/entities/naming.ts",
  "src/lib/entities/provision.ts",
  "src/lib/entities/create.ts",
  "src/lib/entities/entity-input.ts",
  "src/lib/entities/save-access.ts",
  "src/lib/entities/modules.ts",
  "src/lib/entities/dates.ts",
  "src/lib/entities/schemas.ts",
  "src/lib/actions/entities-registry.ts",
];

/**
 * Shortest chain from each file that reaches a target (the target itself gets a one-file chain).
 * `barrier(f)`: do not propagate through f to its importers.
 */
function chainsTo(g: Graph, targets: Set<string>, barrier: (f: string) => boolean = () => false): Map<string, string[]> {
  const rev = new Map<string, string[]>();
  for (const [a, outs] of g) for (const b of outs) (rev.get(b) ?? rev.set(b, []).get(b)!).push(a);
  const next = new Map<string, string>();
  const seen = new Set<string>(targets);
  const queue = [...targets];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (barrier(cur)) continue;
    for (const parent of rev.get(cur) ?? []) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      next.set(parent, cur);
      queue.push(parent);
    }
  }
  const out = new Map<string, string[]>();
  for (const f of seen) {
    const chain = [f];
    while (next.has(chain[chain.length - 1])) chain.push(next.get(chain[chain.length - 1])!);
    out.set(f, chain);
  }
  return out;
}

export type Violation = { file: string; chain: string[] };
const byFile = (a: Violation, b: Violation) => a.file.localeCompare(b.file);

/**
 * SECTION 1. Files outside the allowed zones that can load the entity client, with the
 * shortest chain. Deliberately ignores "use server": a server component that imports a
 * "use server" module loads it, so the module's code (and its imports) run in the main app.
 */
export function findTaintViolations(imports: Record<string, string[]>, aliases: Alias[] = DEFAULT_ALIASES): Violation[] {
  const { graph } = buildGraph(imports, aliases);
  const chains = chainsTo(graph, sealedFiles(graph));
  return [...chains].filter(([f]) => !inAllowedZone(f)).map(([file, chain]) => ({ file, chain })).sort(byFile);
}

/** The MUST_STAY_CLEAN files that nonetheless reach a sealed file. */
export function findCleanListViolations(imports: Record<string, string[]>, aliases: Alias[] = DEFAULT_ALIASES, list: string[] = MUST_STAY_CLEAN): Violation[] {
  const { graph } = buildGraph(imports, aliases);
  const chains = chainsTo(graph, sealedFiles(graph));
  return list.filter((f) => chains.has(f)).map((file) => ({ file, chain: chains.get(file)! })).sort(byFile);
}

/** Dynamic import()/require() that cannot be read, in files outside the allowed zones. */
export function findDynamicViolations(dynamicByFile: Record<string, DynamicUse[]>): { file: string; line: number }[] {
  return Object.entries(dynamicByFile)
    .filter(([f]) => !inAllowedZone(f))
    .flatMap(([file, uses]) => uses.map((u) => ({ file, line: u.line })))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

const PRISMA_MAIN = "src/lib/prisma.ts";

/**
 * SECTION 2. Client components (and anything they bundle) must not reach a Prisma client.
 * Unlike section 1, a "use server" file IS a boundary here: the client bundle gets a
 * reference to it, not its code.
 */
export function findClientBundleViolations(
  imports: Record<string, string[]>,
  directives: Record<string, SourceInfo["directive"]>,
  scope: (file: string) => boolean,
  aliases: Alias[] = DEFAULT_ALIASES,
): Violation[] {
  const { graph } = buildGraph(imports, aliases);
  const targets = sealedFiles(graph);
  if (graph.has(PRISMA_MAIN)) targets.add(PRISMA_MAIN);
  const chains = chainsTo(graph, targets, (f) => directives[f] === "use server");
  return [...chains]
    .filter(([f]) => directives[f] === "use client" && scope(f))
    .map(([file, chain]) => ({ file, chain }))
    .sort(byFile);
}
