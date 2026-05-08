/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const SECRET_PATTERNS: Array<{ id: string; name: string; pattern: RegExp }> = [
	{ id: 'eth-privkey', name: 'Ethereum Private Key', pattern: /\b(0x)?[0-9a-fA-F]{64}\b/ },
	{ id: 'mnemonic', name: 'BIP-39 Mnemonic', pattern: /\b(abandon|ability|able|about|above|absent|absorb|abstract|absurd|abuse)\s+\w+\s+\w+\s+\w+\s+\w+\s+\w+\s+\w+\s+\w+\s+\w+\s+\w+\s+\w+\s+\w+\b/i },
	{ id: 'anthropic-key', name: 'Anthropic API Key', pattern: /sk-ant-[a-zA-Z0-9-_]{90,}/ },
	{ id: 'openai-key', name: 'OpenAI API Key', pattern: /sk-(?:proj-)?[a-zA-Z0-9_-]{40,}/ },
	{ id: 'alchemy-key', name: 'Alchemy API Key', pattern: /[a-zA-Z0-9_-]{32}(?=.*alchemyapi|.*alchemy\.com)/i },
	{ id: 'infura-key', name: 'Infura Project ID', pattern: /infura\.io\/v3\/([a-f0-9]{32})/i },
	{ id: 'private-key-env', name: 'Private Key in Environment', pattern: /PRIVATE_KEY\s*=\s*["']?0x[0-9a-fA-F]{64}["']?/ },
];

const DANGEROUS_FILES = ['.env', '.env.local', '.env.production', '.env.development', 'keystore.json'];

let diagnosticCollection: vscode.DiagnosticCollection | undefined;

export function activateSecretDetection(context: vscode.ExtensionContext): void {
	diagnosticCollection = vscode.languages.createDiagnosticCollection('kairu-secrets');
	context.subscriptions.push(diagnosticCollection);

	// Check already-open documents
	for (const doc of vscode.workspace.textDocuments) {
		checkDocument(doc);
	}

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(checkDocument),
		vscode.workspace.onDidChangeTextDocument(e => checkDocument(e.document)),
	);

	// Watch for dangerous files being added to workspace
	const watcher = vscode.workspace.createFileSystemWatcher('**/{.env,.env.*,keystore.json}');
	context.subscriptions.push(
		watcher,
		watcher.onDidCreate(uri => {
			const fileName = uri.fsPath.split(/[\\/]/).pop() || '';
			if (DANGEROUS_FILES.some(f => fileName === f || fileName.startsWith('.env'))) {
				vscode.window.showWarningMessage(
					`⚠ Kairu: ${fileName} detected. Make sure it is in your .gitignore and never committed!`,
					'Add to .gitignore'
				).then(choice => {
					if (choice === 'Add to .gitignore') {
						addToGitignore(fileName, uri);
					}
				});
			}
		})
	);
}

function checkDocument(doc: vscode.TextDocument): void {
	if (!diagnosticCollection) { return; }

	const fileName = doc.fileName.split(/[\\/]/).pop() || '';
	// Skip binary files and large files
	if (doc.isClosed || doc.uri.scheme !== 'file') { return; }
	if (doc.getText().length > 500000) { return; }

	// Skip our own extension files
	if (doc.fileName.includes('kairu-security') || doc.fileName.includes('node_modules')) { return; }

	const text = doc.getText();
	const diagnostics: vscode.Diagnostic[] = [];

	// Check if this is a dangerous file type
	const isDangerousFile = DANGEROUS_FILES.some(f => fileName === f || fileName.startsWith('.env'));

	for (const { id, name, pattern } of SECRET_PATTERNS) {
		const re = new RegExp(pattern.source, pattern.flags + 'g');
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) {
			// Skip test files and mock data
			if (doc.fileName.includes('.test.') || doc.fileName.includes('.spec.') ||
				doc.fileName.includes('test/') || doc.fileName.includes('mock')) {
				continue;
			}
			// Skip if clearly a comment
			const lineStart = text.lastIndexOf('\n', m.index) + 1;
			const linePrefix = text.slice(lineStart, m.index).trimStart();
			if (linePrefix.startsWith('//') || linePrefix.startsWith('*') || linePrefix.startsWith('#')) {
				continue;
			}

			const startPos = doc.positionAt(m.index);
			const endPos = doc.positionAt(m.index + m[0].length);
			const range = new vscode.Range(startPos, endPos);

			const d = new vscode.Diagnostic(
				range,
				`[KAIRU-SEC] Possible ${name} detected in source code. Never commit secrets!`,
				isDangerousFile ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
			);
			d.source = 'Kairu Security';
			d.code = id;
			diagnostics.push(d);
		}
	}

	diagnosticCollection.set(doc.uri, diagnostics.length > 0 ? diagnostics : undefined);

	if (diagnostics.length > 0) {
		vscode.window.showWarningMessage(
			`⚠ Kairu: Possible secret detected in ${fileName}. Check the Problems panel.`,
			'View Problems'
		).then(choice => {
			if (choice === 'View Problems') {
				vscode.commands.executeCommand('workbench.actions.view.problems');
			}
		});
	}
}

async function addToGitignore(fileName: string, _fileUri: vscode.Uri): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root) { return; }
	const gitignoreUri = vscode.Uri.joinPath(root, '.gitignore');
	let existing = '';
	try {
		const bytes = await vscode.workspace.fs.readFile(gitignoreUri);
		existing = new TextDecoder().decode(bytes);
	} catch { /* doesn't exist */ }
	if (!existing.includes(fileName)) {
		await vscode.workspace.fs.writeFile(gitignoreUri, new TextEncoder().encode(existing + (existing.endsWith('\n') ? '' : '\n') + fileName + '\n'));
		vscode.window.showInformationMessage(`Added ${fileName} to .gitignore`);
	}
}
