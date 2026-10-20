import ts from "typescript";

/**
 * Pure import-graph logic behind `npm run check:entities`. Entity gear must never reach
 * VFXnow's numbers, which holds only while main-app code cannot load the entity client, so
 * the check follows VALUE imports transitively (type-only imports are erased and load nothing).
 */

export type SourceInfo = {
  /** Raw specifiers of value imports, re-exports and dynamic import() calls. */
  imports: string[];
  directive: "use client" | "use server" | null;
};

/** Read the value-import specifiers and the file's module directive out of source text. */
export function extractImports(source: string, fileName = "x.tsx"): SourceInfo {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports: string[] = [];
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
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const allTypeNamed = !!node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every((e) => e.isTypeOnly);
      if (!node.isTypeOnly && !allTypeNamed) imports.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { imports, directive };
}

const EXTS = [".ts", ".tsx"];

/** Resolve a specifier from `from` to a key of `files`, or null (packages, unknown files). */
export function resolveSpecifier(spec: string, from: string, files: ReadonlySet<string>): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = "src/" + spec.slice(2);
  else if (spec.startsWith(".")) {
    const parts = from.split("/").slice(0, -1);
    for (const seg of spec.split("/")) {
      if (seg === "." || seg === "") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    base = parts.join("/");
  } else return null;
  for (const cand of [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => `${base}/index${e}`)]) {
    if (files.has(cand)) return cand;
  }
  return null;
}

export type Graph = Map<string, string[]>;

export function buildGraph(imports: Record<string, string[]>): Graph {
  const files = new Set(Object.keys(imports));
  const g: Graph = new Map();
  for (const [file, specs] of Object.entries(imports)) {
    const out: string[] = [];
    for (const s of specs) {
      const r = resolveSpecifier(s, file, files);
      if (r) out.push(r);
    }
    g.set(file, out);
  }
  return g;
}

export const SEALED = (file: string) => file === "src/lib/entities/client.ts" || file.startsWith("src/generated/entity-prisma/");

const ALLOWED_PREFIXES = [
  "src/lib/entities/",
  "src/app/entity/",
  "src/components/entities/",
  "src/lib/queries/entity-inventory.ts",
  "src/lib/queries/entity-screens.ts",
  "src/generated/",
];
export const inAllowedZone = (file: string) => ALLOWED_PREFIXES.some((p) => file.startsWith(p)) || /^src\/lib\/actions\/entity-[^/]*\.ts$/.test(file);

/** Shortest chain from each file that reaches a target, via the first hop that gets closest. */
function chainsTo(g: Graph, isTarget: (f: string) => boolean, barrier: (f: string) => boolean = () => false): Map<string, string[]> {
  const rev = new Map<string, string[]>();
  for (const [a, outs] of g) for (const b of outs) (rev.get(b) ?? rev.set(b, []).get(b)!).push(a);
  const next = new Map<string, string>();
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const f of g.keys()) if (isTarget(f)) { seen.add(f); queue.push(f); }
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    for (const parent of rev.get(cur) ?? []) {
      if (seen.has(parent) || barrier(cur)) continue;
      seen.add(parent);
      next.set(parent, cur);
      queue.push(parent);
    }
  }
  const out = new Map<string, string[]>();
  for (const f of seen) {
    if (isTarget(f)) continue;
    const chain = [f];
    while (next.has(chain[chain.length - 1])) chain.push(next.get(chain[chain.length - 1])!);
    out.set(f, chain);
  }
  return out;
}

export type Violation = { file: string; chain: string[] };

/** Files outside the allowed zones that can load the entity client, with the shortest chain. */
export function findTaintViolations(imports: Record<string, string[]>): Violation[] {
  const g = buildGraph(imports);
  const chains = chainsTo(g, SEALED);
  return [...chains].filter(([f]) => !inAllowedZone(f)).map(([file, chain]) => ({ file, chain })).sort((a, b) => a.file.localeCompare(b.file));
}

const PRISMA_MAIN = "src/lib/prisma.ts";

/**
 * Client components (and anything they bundle) must not reach a Prisma client. A "use server"
 * file is a boundary: the client gets a reference to it, not its code.
 */
export function findClientBundleViolations(
  imports: Record<string, string[]>,
  directives: Record<string, SourceInfo["directive"]>,
  scope: (file: string) => boolean,
): Violation[] {
  const g = buildGraph(imports);
  const isTarget = (f: string) => SEALED(f) || f === PRISMA_MAIN;
  const chains = chainsTo(g, isTarget, (f) => directives[f] === "use server");
  return [...chains]
    .filter(([f]) => directives[f] === "use client" && scope(f))
    .map(([file, chain]) => ({ file, chain }))
    .sort((a, b) => a.file.localeCompare(b.file));
}
