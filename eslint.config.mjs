// Flat ESLint config for the whole monorepo. Packages add nothing of their own
// unless they need it; rules follow .claude/rules/typescript.md.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "vendor/**",
      ".pob/**",
      "apps/mcp-bridge/server/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      "no-empty": ["error", { allowEmptyCatch: false }],
    },
  },
  {
    files: ["**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ["**/*.{js,mjs,cjs}", "**/*.config.ts", ".claude/hooks/**", "tools/**"],
    languageOptions: { globals: { ...globals.node } },
    rules: { "no-console": "off" },
  },
  {
    // The Windows end-to-end runner reports to the CI log.
    files: ["apps/desktop/e2e/**/*.ts"],
    rules: { "no-console": "off" },
  },
);
