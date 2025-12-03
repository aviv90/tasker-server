// @ts-check

/* eslint-disable @typescript-eslint/no-require-imports */

const tseslint = require("typescript-eslint");
const eslint = require("@eslint/js");

module.exports = tseslint.config(
    { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"] },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
            "no-console": "warn",
            "no-undef": "off" // TypeScript handles this
        }
    }
);
