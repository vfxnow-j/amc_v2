import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MUST_STAY_CLEAN,
  aliasesFromPaths,
  buildGraph,
  extractImports,
  findCleanListViolations,
  findClientBundleViolations,
  findDynamicViolations,
  findTaintViolations,
  resolveSpecifier,
  sealedPresenceErrors,
} from "@/lib/entities/isolation";

const CLIENT = "src/lib/entities/client.ts";

describe("isolation: taint", () => {
  it("flags a main file that imports the client directly", () => {
    const v = findTaintViolations({ [CLIENT]: [], "src/lib/queries/dashboard.ts": ["@/lib/entities/client"] });
    assert.deepEqual(v, [{ file: "src/lib/queries/dashboard.ts", chain: ["src/lib/queries/dashboard.ts", CLIENT] }]);
  });

  it("flags a transitive chain through an allowed-zone file and names the chain", () => {
    const v = findTaintViolations({
      [CLIENT]: [],
      "src/lib/entities/context.ts": ["./client"],
      "src/app/(shell)/layout.tsx": ["@/lib/entities/context"],
    });
    assert.deepEqual(v.map((x) => x.chain), [["src/app/(shell)/layout.tsx", "src/lib/entities/context.ts", CLIENT]]);
  });

  it("flags imports of the generated entity client", () => {
    const v = findTaintViolations({ "src/generated/entity-prisma/client.ts": [], "src/lib/foo.ts": ["@/generated/entity-prisma/client"] });
    assert.equal(v.length, 1);
    assert.equal(v[0].file, "src/lib/foo.ts");
  });

  it("passes an untainted allowed-zone file that touches nothing sealed", () => {
    const v = findTaintViolations({
      [CLIENT]: [],
      "src/lib/entities/membership.ts": ["@/lib/entities/gate", "@/lib/prisma"],
      "src/lib/entities/gate.ts": [],
      "src/lib/prisma.ts": [],
      "src/app/(shell)/layout.tsx": ["@/lib/entities/membership"],
    });
    assert.deepEqual(v, []);
  });

  it("allows tainted files inside the allowed zones", () => {
    const v = findTaintViolations({
      [CLIENT]: [],
      "src/lib/entities/ledger.ts": ["./client"],
      "src/lib/actions/entity-inventory.ts": ["@/lib/entities/ledger"],
      "src/lib/queries/entity-screens.ts": ["@/lib/entities/client"],
      "src/app/entity/[slug]/page.tsx": ["@/lib/actions/entity-inventory"],
    });
    assert.deepEqual(v, []);
  });

  it("resolves aliases, relative paths, index files and extensions", () => {
    const files = new Set(["src/a/b.ts", "src/a/c/index.tsx", "src/lib/x.tsx"]);
    assert.equal(resolveSpecifier("@/lib/x", "src/a/b.ts", files), "src/lib/x.tsx");
    assert.equal(resolveSpecifier("./c", "src/a/b.ts", files), "src/a/c/index.tsx");
    assert.equal(resolveSpecifier("../lib/x", "src/a/b.ts", files), "src/lib/x.tsx");
    assert.equal(resolveSpecifier("react", "src/a/b.ts", files), null);
  });

  it("follows a relative path and an index file to the client", () => {
    const v = findTaintViolations({ [CLIENT]: [], "src/lib/entities/index.ts": ["./client"], "src/lib/other/y.ts": ["../entities"] });
    assert.deepEqual(v.map((x) => x.file), ["src/lib/other/y.ts"]);
  });
});

describe("isolation: extractImports", () => {
  it("ignores type-only imports and re-exports but keeps values and dynamic imports", () => {
    const src = `
      import type { A } from "@/lib/entities/client";
      import { type B } from "@/lib/entities/client2";
      import { C } from "@/lib/c";
      import D, { type E } from "@/lib/d";
      export type { F } from "@/lib/f";
      export { G } from "@/lib/g";
      export * from "@/lib/h";
      const x = () => import("@/lib/i");
    `;
    assert.deepEqual(extractImports(src).imports, ["@/lib/c", "@/lib/d", "@/lib/g", "@/lib/h", "@/lib/i"]);
  });

  it("reads the module directive", () => {
    assert.equal(extractImports(`"use client";\nimport x from "y";`).directive, "use client");
    assert.equal(extractImports(`'use server'\nexport async function a() {}`).directive, "use server");
    assert.equal(extractImports(`import x from "y";`).directive, null);
  });

  it("a type-only import does not taint", () => {
    const info = extractImports(`import type { EntityDb } from "@/lib/entities/client";`);
    const v = findTaintViolations({ [CLIENT]: [], "src/lib/q.ts": info.imports });
    assert.deepEqual(v, []);
  });
});

describe("isolation: client bundles", () => {
  const scope = (f: string) => f.startsWith("src/components/entities/");
  it("flags a client component that reaches the main prisma client", () => {
    const v = findClientBundleViolations(
      { "src/lib/prisma.ts": [], "src/lib/entities/helper.ts": ["@/lib/prisma"], "src/components/entities/a.tsx": ["@/lib/entities/helper"] },
      { "src/components/entities/a.tsx": "use client" },
      scope,
    );
    assert.deepEqual(v.map((x) => x.chain), [["src/components/entities/a.tsx", "src/lib/entities/helper.ts", "src/lib/prisma.ts"]]);
  });
  it("treats a use-server file as a boundary and ignores server components", () => {
    const v = findClientBundleViolations(
      { "src/lib/prisma.ts": [], "src/lib/actions/entity-x.ts": ["@/lib/prisma"], "src/components/entities/a.tsx": ["@/lib/actions/entity-x"], "src/components/entities/s.tsx": ["@/lib/prisma"] },
      { "src/components/entities/a.tsx": "use client", "src/lib/actions/entity-x.ts": "use server" },
      scope,
    );
    assert.deepEqual(v, []);
  });
});

const GEN = "src/generated/entity-prisma/client.ts";

describe("isolation: fails closed", () => {
  it("reports a missing client.ts or generated client", () => {
    assert.equal(sealedPresenceErrors([CLIENT, GEN]).length, 0);
    assert.match(sealedPresenceErrors([GEN]).join(), /client\.ts was not scanned/);
    assert.match(sealedPresenceErrors([CLIENT]).join(), /db:generate/);
  });

  it("catches a client moved elsewhere, by what it imports", () => {
    const v = findTaintViolations({ [GEN]: [], "src/lib/db/entity-pool.ts": ["@/generated/entity-prisma/client"], "src/lib/queries/q.ts": ["@/lib/db/entity-pool"] });
    assert.deepEqual(v.map((x) => x.file), ["src/lib/db/entity-pool.ts", "src/lib/queries/q.ts"]);
  });

  it("catches a second wrapper outside the allowed zone, including a relative import of the generated client", () => {
    const v = findTaintViolations({ [GEN]: [], "src/lib/wrapper.ts": ["../generated/entity-prisma/client"] });
    assert.deepEqual(v.map((x) => x.file), ["src/lib/wrapper.ts"]);
  });

  it("flags an explicit .js suffix on the client import", () => {
    const v = findTaintViolations({ [CLIENT]: [], "src/lib/queries/q.ts": ["@/lib/entities/client.js"] });
    assert.deepEqual(v.map((x) => x.file), ["src/lib/queries/q.ts"]);
  });

  it("resolves .jsx/.mjs suffixes and directory index files", () => {
    const files = new Set(["src/a.tsx", "src/b/index.ts", "src/c.mjs"]);
    assert.equal(resolveSpecifier("@/a.jsx", "src/x.ts", files), "src/a.tsx");
    assert.equal(resolveSpecifier("@/b", "src/x.ts", files), "src/b/index.ts");
    assert.equal(resolveSpecifier("@/c.mjs", "src/x.ts", files), "src/c.mjs");
  });

  it("counts unresolved local specifiers but not packages or assets", () => {
    const { stats } = buildGraph({ "src/a.ts": ["@/nope", "./gone", "react", "@/styles/x.css", "./logo.svg", "@/lib/b"], "src/lib/b.ts": [] });
    assert.equal(stats.specifiers, 3);
    assert.equal(stats.resolved, 1);
    assert.deepEqual(stats.unresolved.map((u) => u.spec), ["@/nope", "./gone"]);
  });

  it("a new tsconfig alias is resolved, not ignored", () => {
    const aliases = aliasesFromPaths({ "@/*": ["./src/*"], "~lib/*": ["./src/lib/*"], "$exact": ["./src/lib/entities/client.ts"] });
    const v = findTaintViolations({ [CLIENT]: [], "src/lib/q.ts": ["~lib/entities/client"], "src/lib/r.ts": ["$exact"] }, aliases);
    assert.deepEqual(v.map((x) => x.file), ["src/lib/q.ts", "src/lib/r.ts"]);
  });
});

describe("isolation: invisible import forms", () => {
  it("sees import-equals, require() and template-literal import()", () => {
    const src = [
      'import x = require("@/a");',
      'const y = require("@/b");',
      "const z = import(`@/c`);",
      'const w = require(`@/d`);',
    ].join("\n");
    assert.deepEqual(extractImports(src, "f.ts").imports, ["@/a", "@/b", "@/c", "@/d"]);
  });

  it("each form taints", () => {
    for (const src of ['import x = require("@/lib/entities/client");', 'require("@/lib/entities/client");', "import(`@/lib/entities/client`);"]) {
      const info = extractImports(src, "q.ts");
      const v = findTaintViolations({ [CLIENT]: [], "src/lib/q.ts": info.imports });
      assert.equal(v.length, 1, src);
    }
  });

  it("records non-literal import()/require() with a line, and only flags them outside the allowed zones", () => {
    const info = extractImports('const a = 1;\nconst b = import(`@/lib/${name}`);\nrequire(path);', "f.ts");
    assert.deepEqual(info.dynamic, [{ line: 2 }, { line: 3 }]);
    const v = findDynamicViolations({ "src/lib/queries/q.ts": info.dynamic, "src/lib/entities/ledger.ts": info.dynamic });
    assert.deepEqual(v, [{ file: "src/lib/queries/q.ts", line: 2 }, { file: "src/lib/queries/q.ts", line: 3 }]);
  });
});

describe("isolation: must-stay-clean list", () => {
  it("names the shared files and flags one that leaks, at the cause", () => {
    assert.ok(MUST_STAY_CLEAN.includes("src/lib/entities/membership.ts"));
    assert.ok(MUST_STAY_CLEAN.includes("src/lib/actions/entities-registry.ts"));
    const v = findCleanListViolations({ [CLIENT]: [], "src/lib/entities/provision.ts": ["./client"], "src/lib/entities/create.ts": ["./provision"], "src/lib/entities/ledger.ts": ["./client"] });
    assert.deepEqual(v.map((x) => x.file), ["src/lib/entities/create.ts", "src/lib/entities/provision.ts"]);
  });
  it("passes when they are clean", () => {
    assert.deepEqual(findCleanListViolations({ [CLIENT]: [], "src/lib/entities/provision.ts": ["./url"], "src/lib/entities/url.ts": [] }), []);
  });
});
