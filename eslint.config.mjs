// Flat ESLint config: TypeScript + the Obsidian community-review ruleset.
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
	{ ignores: ["main.js", "node_modules/**", "graphify-out/**"] },
	...tseslint.configs.recommended,
	...obsidianmd.configs.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"obsidianmd/ui/sentence-case": [
				"warn",
				{
					// Proper nouns and acronyms this plugin's UI legitimately capitalizes.
					brands: ["Task Tree", "Kanban", "Obsidian", "Markdown"],
					acronyms: ["OKF", "WIP", "ID", "QA", "YAML", "DNS"],
					// Literal syntax the rule shouldn't re-case: ^ids, tt- fields, e.g. examples.
					ignoreRegex: ["\\^id", "tt-", "e\\.g\\."],
				},
			],
		},
	},
	{
		files: ["*.mjs", "tests/**/*.mjs"],
		languageOptions: {
			parserOptions: { projectService: false },
		},
	},
);
