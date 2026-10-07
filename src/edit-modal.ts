import { ButtonComponent, debounce, Modal, Notice, Setting } from "obsidian";
import { excerpt } from "./catalog.ts";
import type ExternalLinkAutocompletePlugin from "./main.ts";
import type { RewritePreview } from "./main.ts";
import { isValidLink, type RewriteSpec } from "./rewrite.ts";
import { formatDestination, stripMarkdown } from "./text.ts";

/** The link the modal opens on: its index keys and its spelling. */
export interface EditTarget {
	key: string;
	urlKey: string;
	text: string;
	url: string;
}

/** Notes listed in the preview; the rest are summarized. */
const MAX_PREVIEW_NOTES = 50;
const PREVIEW_DELAY_MS = 250;

/**
 * Edits a link everywhere it's used: text and URL fields, a live list of
 * the affected notes, and a confirm button stating the count.
 */
export class EditLinkModal extends Modal {
	private text: string;
	private url: string;
	private allTexts = false;
	/** Bumped per preview so a slow one can't overwrite a newer one. */
	private generation = 0;
	private readonly summaryEl: HTMLElement;
	private readonly listEl: HTMLElement;
	private confirm: ButtonComponent | null = null;
	private readonly schedulePreview = debounce(() => void this.preview(), PREVIEW_DELAY_MS, true);

	constructor(
		private readonly plugin: ExternalLinkAutocompletePlugin,
		private readonly target: EditTarget,
	) {
		super(plugin.app);
		this.text = target.text;
		this.url = target.url;
		this.summaryEl = createDiv({ cls: "external-link-edit-summary" });
		this.listEl = createDiv({ cls: "external-link-edit-list" });
	}

	onOpen(): void {
		this.setTitle("Edit link across vault");
		const { contentEl } = this;
		this.modalEl.addClass("external-link-edit-modal");

		new Setting(contentEl).setName("Text").addText((text) =>
			text.setValue(this.text).onChange((value) => {
				this.text = value.trim();
				this.confirm?.setDisabled(true);
				this.schedulePreview();
			}),
		);
		new Setting(contentEl).setName("URL").addText((text) =>
			text.setValue(this.url).onChange((value) => {
				this.url = value.trim();
				this.confirm?.setDisabled(true);
				this.schedulePreview();
			}),
		);

		const others = this.plugin.variantsOfUrl(this.target.urlKey).filter((variant) => variant.key !== this.target.key);
		if (others.length > 0) {
			new Setting(contentEl)
				.setName("Also update other texts for this URL")
				.setDesc(others.map((variant) => `${stripMarkdown(variant.text)} ×${variant.paths.length}`).join(", "))
				.addToggle((toggle) =>
					toggle.setValue(this.allTexts).onChange((value) => {
						this.allTexts = value;
						void this.preview();
					}),
				);
		}

		contentEl.append(this.summaryEl, this.listEl);
		contentEl.createDiv({
			cls: "external-link-edit-warning",
			text: "Notes are saved right away. Until you close Obsidian, \"Undo last link edit\" reverts the links that weren't edited since.",
		});
		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) => {
				this.confirm = button.setDestructive().setCta().setDisabled(true).onClick(() => void this.apply());
			});
		void this.preview();
	}

	onClose(): void {
		this.schedulePreview.cancel();
		this.generation++;
		this.contentEl.empty();
	}

	private spec(): RewriteSpec {
		return {
			key: this.target.key,
			urlKey: this.target.urlKey,
			allTexts: this.allTexts,
			text: this.text,
			url: this.url,
			keep: this.plugin.linkFilter,
		};
	}

	private async preview(): Promise<void> {
		const generation = ++this.generation;
		if (!isValidLink(this.text, this.url)) {
			this.show([], "Enter a text and an http(s) URL that make a valid link.");
			return;
		}
		const previews = await this.plugin.previewRewrite(this.spec());
		if (generation !== this.generation) return;
		this.show(previews, null);
	}

	private show(previews: RewritePreview[], problem: string | null): void {
		const links = previews.reduce((sum, preview) => sum + preview.changes.length, 0);
		this.confirm?.setDisabled(links === 0).setButtonText(links === 1 ? "Update 1 link" : `Update ${links} links`);
		this.summaryEl.empty();
		this.listEl.empty();
		if (problem) {
			this.summaryEl.setText(problem);
			return;
		}
		if (links === 0) {
			this.summaryEl.setText("Nothing to change.");
			return;
		}
		const notes = previews.length === 1 ? "1 note" : `${previews.length} notes`;
		this.summaryEl.appendText(`${links === 1 ? "1 link" : `${links} links`} in ${notes} will become `);
		this.summaryEl.createEl("code", { text: `[${this.text}](${formatDestination(this.url)})` });

		for (const preview of previews.slice(0, MAX_PREVIEW_NOTES)) {
			const note = this.listEl.createDiv({ cls: "external-link-edit-note" });
			note.createDiv({ cls: "external-link-edit-note-title", text: preview.file.basename, attr: { title: preview.file.path } });
			const matches = note.createDiv({ cls: "search-result-file-matches" });
			for (const change of preview.changes) {
				const { before, match, after } = excerpt(preview.lines[change.line], change.start, change.end);
				const row = matches.createDiv({ cls: "search-result-file-match" });
				row.appendText(before);
				row.createSpan({ cls: "search-result-file-matched-text", text: match });
				row.appendText(after);
			}
		}
		const hidden = previews.length - MAX_PREVIEW_NOTES;
		if (hidden > 0) {
			this.listEl.createDiv({
				cls: "external-link-edit-more",
				text: hidden === 1 ? "…and 1 more note" : `…and ${hidden} more notes`,
			});
		}
	}

	private async apply(): Promise<void> {
		this.confirm?.setDisabled(true);
		const { links, notes } = await this.plugin.rewriteLinks(this.spec());
		this.close();
		new Notice(`Updated ${links === 1 ? "1 link" : `${links} links`} in ${notes === 1 ? "1 note" : `${notes} notes`}.`);
	}
}
