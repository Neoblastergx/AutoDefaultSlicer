import path from "node:path";
import { fileURLToPath } from "node:url";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import powerbiVisuals from "eslint-plugin-powerbi-visuals";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const recommended = powerbiVisuals.configs.recommended;

export default [
    {
        ignores: ["node_modules/**", ".tmp/**", "dist/**", "eslint.config.mjs"]
    },
    {
        // Microsoft's recommended rules for custom visuals (no innerHTML,
        // no insecure random, no http:// strings, ...). The plugin ships
        // tsconfigRootDir: "." which ESLint 9 rejects, so we pin it here.
        ...recommended,
        files: ["src/**/*.ts"],
        languageOptions: {
            ...recommended.languageOptions,
            parser: tsParser,
            parserOptions: {
                project: "./tsconfig.json",
                tsconfigRootDir: rootDir
            }
        }
    },
    {
        files: ["src/**/*.ts"],
        plugins: {
            "@typescript-eslint": tsPlugin
        },
        rules: {
            "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }]
        }
    }
];
