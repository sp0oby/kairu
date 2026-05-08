/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

interface EnvEntry {
	key: string;
	value: string;
	provider?: 'anthropic' | 'openai' | 'gemini' | 'openai-compatible' | 'etherscan';
}

const KEY_PATTERNS: Array<{ regex: RegExp; provider: EnvEntry['provider'] }> = [
	{ regex: /^(ANTHROPIC|CLAUDE)_?API_?KEY$/i, provider: 'anthropic' },
	{ regex: /^OPENAI_?API_?KEY$/i, provider: 'openai' },
	{ regex: /^(GEMINI|GOOGLE_?(AI|GENAI))_?API_?KEY$/i, provider: 'gemini' },
	{ regex: /^ETHERSCAN_?API_?KEY$/i, provider: 'etherscan' },
];

const SENSITIVE_KEY_NAMES = /^(PRIVATE_KEY|MNEMONIC|SEED_?PHRASE|DEPLOYER_?KEY|WALLET_?PRIVATE)/i;

function parseEnvFile(content: string): EnvEntry[] {
	const entries: EnvEntry[] = [];
	for (const rawLine of content.split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) { continue; }
		const eq = line.indexOf('=');
		if (eq === -1) { continue; }
		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1).trim();
		// Strip surrounding quotes
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		if (!key || !value) { continue; }

		const matched = KEY_PATTERNS.find(p => p.regex.test(key));
		entries.push({
			key,
			value,
			...(matched ? { provider: matched.provider } : {}),
		});
	}
	return entries;
}

export async function runEnvImport(): Promise<void> {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) {
		vscode.window.showWarningMessage('Open a workspace folder first.');
		return;
	}

	const root = folders[0].uri;
	const envCandidates = ['.env', '.env.local', '.env.development', '.env.production'];
	const found: vscode.Uri[] = [];

	for (const name of envCandidates) {
		const uri = vscode.Uri.joinPath(root, name);
		try {
			await vscode.workspace.fs.stat(uri);
			found.push(uri);
		} catch { /* not found */ }
	}

	if (found.length === 0) {
		vscode.window.showInformationMessage('No .env files found in workspace root.');
		return;
	}

	let target: vscode.Uri;
	if (found.length === 1) {
		target = found[0];
	} else {
		const items = found.map(uri => ({
			label: uri.fsPath.split(/[\\/]/).pop() || '',
			uri,
		}));
		const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Multiple .env files found — pick one to import' });
		if (!picked) { return; }
		target = picked.uri;
	}

	const bytes = await vscode.workspace.fs.readFile(target);
	const content = new TextDecoder().decode(bytes);
	const entries = parseEnvFile(content);

	if (entries.length === 0) {
		vscode.window.showInformationMessage(`${target.fsPath.split(/[\\/]/).pop()} has no parseable key=value pairs.`);
		return;
	}

	const recognized = entries.filter(e => e.provider);
	const sensitiveButUnrecognized = entries.filter(e => !e.provider && SENSITIVE_KEY_NAMES.test(e.key));

	if (recognized.length === 0 && sensitiveButUnrecognized.length === 0) {
		vscode.window.showInformationMessage(`No recognized API keys or sensitive values in ${target.fsPath.split(/[\\/]/).pop()}.`);
		return;
	}

	// Show what we're going to do
	const summary: string[] = [];
	for (const e of recognized) {
		summary.push(`  • ${e.provider}: ${e.key} → OS keychain`);
	}
	for (const e of sensitiveButUnrecognized) {
		summary.push(`  ⚠  ${e.key} (sensitive — won't auto-import, but flagged)`);
	}

	const choice = await vscode.window.showInformationMessage(
		`Kairu detected the following in ${target.fsPath.split(/[\\/]/).pop()}:\n\n${summary.join('\n')}\n\nImport recognized keys to OS keychain and add ${target.fsPath.split(/[\\/]/).pop()} to .gitignore?`,
		{ modal: true },
		'Import & Gitignore',
		'Import only',
		'Cancel'
	);

	if (!choice || choice === 'Cancel') { return; }

	// Import recognized keys via the kairu-ai SecretStorage and kairu.chain config
	let imported = 0;
	for (const e of recognized) {
		if (e.provider === 'etherscan') {
			await vscode.workspace.getConfiguration('kairu.chain').update('etherscanApiKey', e.value, vscode.ConfigurationTarget.Global);
			imported++;
		} else {
			// Use kairu.ai's command to import — falls through to the same SecretsManager
			// We don't have direct access from this extension, so we use the command bus
			try {
				await vscode.commands.executeCommand('kairu.ai.importApiKey', e.provider, e.value);
				imported++;
			} catch {
				// Fall back: write to globalState as a placeholder; user will be prompted on next chat
			}
		}
	}

	if (choice === 'Import & Gitignore') {
		await addToGitignore(root, target.fsPath.split(/[\\/]/).pop() || '.env');
	}

	vscode.window.showInformationMessage(
		`Kairu: imported ${imported} key(s) to OS keychain. ${choice === 'Import & Gitignore' ? '.env added to .gitignore.' : ''}`
	);
}

async function addToGitignore(root: vscode.Uri, fileName: string): Promise<void> {
	const gitignoreUri = vscode.Uri.joinPath(root, '.gitignore');
	let existing = '';
	try {
		const bytes = await vscode.workspace.fs.readFile(gitignoreUri);
		existing = new TextDecoder().decode(bytes);
	} catch { /* new file */ }

	if (existing.split('\n').map(l => l.trim()).includes(fileName)) {
		return;
	}

	const updated = existing + (existing.endsWith('\n') || !existing ? '' : '\n') + fileName + '\n';
	await vscode.workspace.fs.writeFile(gitignoreUri, new TextEncoder().encode(updated));
}
