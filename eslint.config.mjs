import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
	{
		// Build output, deps, the generated vault, and runtime data.
		ignores: ["main.js", "node_modules/", "test-vault/", "**/*.map", "data.json"],
	},
	// The official guideline checks: ESLint core, typescript-eslint
	// type-checked rules, and the Obsidian-specific rules the review applies.
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["*.mjs", "scripts/*.mjs"],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		files: ["src/**/*.ts"],
		languageOptions: { globals: { ...globals.browser } },
		rules: {
			"@typescript-eslint/no-explicit-any": "error",
			"no-console": ["error", { allow: ["error"] }],
		},
	},
	{
		// Unit tests, build and helper scripts run under Node, never inside
		// Obsidian: Node built-ins, `.obsidian` paths and logging are fine there.
		files: ["test/**/*.ts", "**/*.mjs"],
		languageOptions: { globals: { ...globals.node } },
		rules: {
			"obsidianmd/rule-custom-message": "off",
			"obsidianmd/no-nodejs-modules": "off",
			"obsidianmd/hardcoded-config-path": "off",
		},
	},
	{
		// node:test's test() returns a promise the runner already tracks.
		files: ["test/**/*.ts"],
		rules: { "@typescript-eslint/no-floating-promises": "off" },
	},
]);
