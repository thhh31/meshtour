import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "apps/demo/public/tours/**",
      "apps/demo/public/vendor/**",
      "assets-pipeline/scripts/__pycache__/**",
      "docs/media/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    ...reactHooks.configs.flat["recommended-latest"],
    files: ["packages/react/src/**/*.{ts,tsx}", "apps/demo/src/**/*.{ts,tsx}"],
  },
  {
    ...reactRefresh.configs.vite,
    files: ["apps/demo/src/**/*.{ts,tsx}"],
  },
);
