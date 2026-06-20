// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      // D-09: Forbid console.log (stdout contamination guard — HIGH severity).
      // Only console.warn and console.error are permitted.
      // console.error writes to stderr, which is the correct channel for logging
      // in an MCP stdio server (stdout is exclusively the JSON-RPC protocol channel).
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
);
