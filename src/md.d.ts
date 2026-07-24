// Markdown files import as plain text (esbuild `loader: { ".md": "text" }`).
declare module "*.md" {
	const content: string;
	export default content;
}
