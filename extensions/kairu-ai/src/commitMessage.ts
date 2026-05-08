/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { buildProvider } from './providers/registry';
import { SecretsManager } from './secrets';

const exec = promisify(execCb);

export async function generateCommitMessage(secrets: SecretsManager): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!root) {
		vscode.window.showWarningMessage('Open a git repository folder first.');
		return;
	}

	let diff = '';
	let stagedFiles: string[] = [];

	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'Kairu: reading staged changes...' },
		async () => {
			try {
				// Get list of staged files (works whether or not CWD is repo root)
				const { stdout: filesOut } = await exec('git diff --cached --name-only', { cwd: root, timeout: 10000 });
				stagedFiles = filesOut.trim().split('\n').filter(Boolean);

				if (stagedFiles.length === 0) {
					return;
				}

				// Get the diff. Cap at ~30k chars to fit in context.
				const { stdout: diffOut } = await exec('git diff --cached', { cwd: root, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
				diff = diffOut.length > 30000 ? diffOut.slice(0, 30000) + '\n\n... (diff truncated)' : diffOut;
			} catch (err) {
				vscode.window.showErrorMessage(`Kairu: git diff failed — ${(err as Error).message}`);
			}
		}
	);

	if (stagedFiles.length === 0) {
		vscode.window.showInformationMessage('No staged changes. Run `git add` first, then try again.');
		return;
	}

	const config = vscode.workspace.getConfiguration('kairu.ai');
	const model = config.get<string>('model', '');
	if (!model) {
		vscode.window.showWarningMessage('No AI model configured. Open Kairu AI chat first to set one up.');
		return;
	}

	const systemPrompt = `You write concise, conventional git commit messages.

Rules:
- First line: ≤72 chars, imperative mood ("Add X", "Fix Y", not "Added"/"Fixes")
- Blank line after subject
- Body: 1-3 short paragraphs explaining the WHY (not the WHAT — diff shows that). Wrap at 72 chars.
- No bullet points unless the change really has multiple distinct parts
- No "co-authored-by" trailers
- No markdown — plain text only
- No fences, no quotes, no commentary outside the message itself

Output ONLY the commit message, nothing else.`;

	const filesList = stagedFiles.length <= 20
		? stagedFiles.join('\n')
		: stagedFiles.slice(0, 20).join('\n') + `\n... (+${stagedFiles.length - 20} more)`;

	const userPrompt = `Files changed:
${filesList}

Diff:
${diff}

Write the commit message.`;

	let message = '';
	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'Kairu: generating commit message...' },
		async () => {
			try {
				const provider = await buildProvider(secrets);
				for await (const chunk of provider.chat({
					model,
					messages: [
						{ role: 'system', content: systemPrompt },
						{ role: 'user', content: userPrompt },
					],
					maxTokens: 600,
				})) {
					if (chunk.delta) {
						message += chunk.delta;
					}
				}
			} catch (err) {
				vscode.window.showErrorMessage(`Kairu: AI generation failed — ${(err as Error).message}`);
			}
		}
	);

	if (!message.trim()) {
		return;
	}

	const cleaned = message.replace(/^```[\w]*\n/, '').replace(/\n```\s*$/, '').trim();

	// Show in a quick pick: edit, copy to clipboard, write to commit editor
	const action = await vscode.window.showInformationMessage(
		`Generated commit message:\n\n${cleaned.slice(0, 200)}${cleaned.length > 200 ? '…' : ''}`,
		{ modal: true },
		'Copy to clipboard',
		'Open in editor',
		'Use as commit (git commit -m)',
	);

	if (action === 'Copy to clipboard') {
		await vscode.env.clipboard.writeText(cleaned);
		vscode.window.showInformationMessage('Commit message copied.');
	} else if (action === 'Open in editor') {
		const doc = await vscode.workspace.openTextDocument({
			content: cleaned,
			language: 'git-commit',
		});
		await vscode.window.showTextDocument(doc);
	} else if (action === 'Use as commit (git commit -m)') {
		try {
			// Use stdin to pass the message safely (no shell escaping)
			await new Promise<void>((resolve, reject) => {
				const child = require('child_process').spawn('git', ['commit', '-F', '-'], { cwd: root });
				child.stdin.write(cleaned);
				child.stdin.end();
				let stderr = '';
				child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
				child.on('close', (code: number) => {
					if (code === 0) { resolve(); }
					else { reject(new Error(stderr || `git exited with code ${code}`)); }
				});
				child.on('error', (err: Error) => reject(err));
			});
			vscode.window.showInformationMessage('Commit created.');
		} catch (err) {
			vscode.window.showErrorMessage(`Commit failed: ${(err as Error).message}`);
		}
	}
}
