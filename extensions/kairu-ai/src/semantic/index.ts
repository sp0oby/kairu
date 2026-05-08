/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { extractSolidityFile, SolidityFile, SolidityContract } from './extractor';

export interface IndexEntry {
	file: SolidityFile;
	uri: string;
	lastModified: number;
}

export class SemanticIndex {
	private readonly entries = new Map<string, IndexEntry>();
	private readonly statusBar: vscode.StatusBarItem;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
		this.statusBar.name = 'Kairu Semantic Index';
		context.subscriptions.push(this.statusBar);
	}

	async startWatching(): Promise<void> {
		await this.indexWorkspace();

		// Watch for changes
		const watcher = vscode.workspace.createFileSystemWatcher('**/*.sol');
		this.context.subscriptions.push(
			watcher,
			watcher.onDidChange(uri => this.indexFile(uri)),
			watcher.onDidCreate(uri => this.indexFile(uri)),
			watcher.onDidDelete(uri => { this.entries.delete(uri.toString()); this.updateStatus(); }),
			vscode.workspace.onDidOpenTextDocument(doc => {
				if (doc.languageId === 'solidity') {
					this.indexDocument(doc);
				}
			}),
			vscode.workspace.onDidSaveTextDocument(doc => {
				if (doc.languageId === 'solidity') {
					this.indexDocument(doc);
				}
			}),
		);
	}

	private async indexWorkspace(): Promise<void> {
		this.statusBar.text = '$(loading~spin) Kairu: indexing Solidity...';
		this.statusBar.show();

		// Index already-open documents first
		for (const doc of vscode.workspace.textDocuments) {
			if (doc.languageId === 'solidity') {
				this.indexDocument(doc);
			}
		}

		// Find all .sol files in workspace
		const files = await vscode.workspace.findFiles('**/*.sol', '{**/node_modules/**,**/lib/**,**/cache/**}', 500);
		for (const uri of files) {
			if (!this.entries.has(uri.toString())) {
				await this.indexFile(uri);
			}
		}

		this.updateStatus();
	}

	private indexDocument(doc: vscode.TextDocument): void {
		const uri = doc.uri.toString();
		const text = doc.getText();
		try {
			const file = extractSolidityFile(doc.uri.fsPath, text);
			this.entries.set(uri, { file, uri, lastModified: Date.now() });
		} catch {
			// Silently skip files that fail to parse
		}
		this.updateStatus();
	}

	private async indexFile(uri: vscode.Uri): Promise<void> {
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const text = new TextDecoder().decode(bytes);
			const file = extractSolidityFile(uri.fsPath, text);
			this.entries.set(uri.toString(), { file, uri: uri.toString(), lastModified: Date.now() });
		} catch {
			// Silently skip
		}
		this.updateStatus();
	}

	private updateStatus(): void {
		const count = this.entries.size;
		if (count === 0) {
			this.statusBar.hide();
		} else {
			this.statusBar.text = `$(symbol-namespace) ${count} contracts indexed`;
			this.statusBar.tooltip = 'Kairu Semantic Index — Solidity files parsed for AI context';
			this.statusBar.show();
		}
	}

	getAll(): IndexEntry[] {
		return Array.from(this.entries.values());
	}

	getByUri(uri: string): IndexEntry | undefined {
		return this.entries.get(uri);
	}

	getContractByName(name: string): SolidityContract | undefined {
		for (const entry of this.entries.values()) {
			for (const c of entry.file.contracts) {
				if (c.name === name) { return c; }
			}
		}
		return undefined;
	}

	search(query: string): IndexEntry[] {
		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
		const results: Array<{ entry: IndexEntry; score: number }> = [];

		for (const entry of this.entries.values()) {
			let score = 0;
			const text = serializeEntry(entry).toLowerCase();
			for (const term of terms) {
				const count = (text.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
				score += count;
			}
			if (score > 0) {
				results.push({ entry, score });
			}
		}

		return results.sort((a, b) => b.score - a.score).slice(0, 5).map(r => r.entry);
	}

	size(): number {
		return this.entries.size;
	}
}

function serializeEntry(entry: IndexEntry): string {
	const parts: string[] = [entry.file.filePath];
	for (const c of entry.file.contracts) {
		parts.push(c.name, c.kind, ...c.inherits);
		for (const fn of c.functions) {
			parts.push(fn.name, fn.visibility, fn.stateMutability, fn.params, fn.returns, ...fn.modifiers);
		}
		for (const ev of c.events) { parts.push(ev.name, ev.params); }
		for (const er of c.errors) { parts.push(er.name, er.params); }
		for (const sv of c.stateVars) { parts.push(sv.name, sv.type); }
	}
	return parts.join(' ');
}
