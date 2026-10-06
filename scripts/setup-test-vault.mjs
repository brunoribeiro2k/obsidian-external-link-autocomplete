/*
 * Build the gitignored `test-vault/` from version-controlled fixtures.
 *
 * The scanner, trigger, ranking and index are covered by `npm test`; what
 * unit tests can't reach is the editor itself (popup, suggester precedence,
 * cursor handling, auto-pair). The test-vault is that verification surface:
 * open it in Obsidian and walk through `Checklist.md`. The vault is
 * gitignored; the sample notes live in `test/fixtures/vault/` so they stay in
 * version control. Re-run this any time to refresh the vault and redeploy the
 * latest build into it. Non-destructive: it overwrites the seeded files but
 * leaves anything else in the vault (Obsidian's workspace, your scratch notes)
 * untouched.
 *
 *   npm run setup-vault                 # fixtures + plugin
 *   npm run setup-vault -- --stress     # plus stress/ with 10k generated notes
 */
import { access, copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vaultDir = path.join(repoRoot, "test-vault");
const fixturesDir = path.join(repoRoot, "test", "fixtures", "vault");
const releaseFiles = ["main.js", "manifest.json", "styles.css"];

const manifest = JSON.parse(await readFile(path.join(repoRoot, "manifest.json"), "utf8"));
const pluginDir = path.join(vaultDir, ".obsidian", "plugins", manifest.id);

// Fail loudly rather than deploy a stale or missing bundle.
try {
	await access(path.join(repoRoot, "main.js"));
} catch {
	console.error("main.js not found — run `npm run build` first (or `npm run setup-vault`).");
	process.exit(1);
}

// 1. Seed the sample notes from the committed fixtures, folders included.
await mkdir(vaultDir, { recursive: true });
await cp(fixturesDir, vaultDir, { recursive: true });

// 1b. Optionally generate a stress folder: 10k notes, about 5 links each.
if (process.argv.includes("--stress")) {
	const stressDir = path.join(vaultDir, "stress");
	await mkdir(stressDir, { recursive: true });
	const words = ["alpha", "beta", "gamma", "delta", "jira", "board", "docs", "github", "wiki", "design", "plan", "api"];
	let seed = 1;
	const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
	const word = () => words[Math.floor(random() * words.length)];
	for (let note = 0; note < 10000; note++) {
		const lines = [`# Stress ${note}`, ""];
		for (let link = 0; link < 5; link++) {
			lines.push(
				`Prose before [${word()} ${word()} ${Math.floor(random() * 2000)}](https://${word()}.example.com/${word()}/${note}) and after.`,
				"Filler text so the scanner has something to skip over on every note.",
			);
		}
		await writeFile(path.join(stressDir, `Stress ${note}.md`), `${lines.join("\n")}\n`);
	}
	console.log("Generated 10000 notes in test-vault/stress/");
}

// 2. Deploy the current build into the vault's plugin folder.
await mkdir(pluginDir, { recursive: true });
for (const file of releaseFiles) {
	await copyFile(path.join(repoRoot, file), path.join(pluginDir, file));
}

// 2b. Seed the plugin's settings once, excluding the fixture's `Excluded/`
//     folder. Kept if it exists, so settings you change while testing stick.
const dataPath = path.join(pluginDir, "data.json");
try {
	await access(dataPath);
} catch {
	await writeFile(dataPath, `${JSON.stringify({ excludedFolders: ["Excluded"] }, null, 2)}\n`);
}

// 3. Enable the plugin so the vault works the moment Obsidian opens it.
await writeFile(
	path.join(vaultDir, ".obsidian", "community-plugins.json"),
	`${JSON.stringify([manifest.id], null, 2)}\n`,
);

console.log(`Test vault ready at ${vaultDir}`);
console.log("Open it in Obsidian (Open folder as vault) and walk through Checklist.md.");
