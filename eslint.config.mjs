import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import next from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "dist/**",
    "out/**",
    "build/**",
    "outputs/**",
    ".wrangler/**",
    ".cache/**",
    "storybook-static/**",
    "**/.venv/**",
    "**/.forecast-venv/**",
    "**/.autogluon-venv/**",
    ".litellm_cache/**",
    "next-env.d.ts",
  ]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs.flat["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  next.configs["core-web-vitals"],
  {
    // These recoverable reference components use local assets and are byte-frozen.
    files: ["components/neo-demo/prototype.tsx", "components/neo-demo/shell.tsx"],
    rules: {"@next/next/no-img-element": "off"},
  },
  {
    rules: {
      // Rest destructuring intentionally removes fields from persisted/public copies.
      "@typescript-eslint/no-unused-vars": ["error", {ignoreRestSiblings: true}],
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
]);

export default eslintConfig;
