import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Design references, not application code: prototypes with their own
    // preview runtime (see design/README.md).
    "design/**",
    // Prisma's generated client.
    "src/generated/**",
  ]),

  // Code ported from v1. v1's eslint config is identical to this one, so these
  // violations are inherited, not introduced by the port — they are held at
  // their existing level rather than rewritten wholesale, while new v2 code
  // stays on the stricter defaults above. Burn these down per module as each
  // screen is rebuilt.
  {
    files: [
      "src/lib/actions/**",
      "src/lib/analytics/**",
      "src/lib/email/**",
      "src/lib/integrations/**",
      "src/lib/market-prices/**",
      "src/lib/pricing/**",
      "src/lib/quickbooks/**",
      "src/lib/utils/**",
      "src/lib/{api-auth,auth,auth-utils,cloud-products,excel,export-types,mfa-trust,totp,types,utils}.ts",
      "src/components/ui/**",
      "src/components/data-table/**",
      "src/components/documents/**",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/incompatible-library": "warn",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  {
    // @react-pdf/renderer's <Image> is not an HTML img — it has no alt.
    files: ["src/components/documents/*-pdf.tsx"],
    rules: { "jsx-a11y/alt-text": "off" },
  },
]);

export default eslintConfig;
