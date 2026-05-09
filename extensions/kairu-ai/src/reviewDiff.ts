/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCb);

/**
 * Generates a git diff (staged + unstaged by default) and sends it to the
 * Kairu AI chat for security and correctness review.
 *
 * Distinct from commit message generation — this is about catching issues
 * before they ship, not summarizing what changed.
 */
export async function reviewDiffWithAI(): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!root) {
		vscode.window.showWarningMessage('Open a git repository folder first.');
		return;
	}

	const target = await vscode.window.showQuickPick(
		[
			{ label: '$(git-commit) Staged changes (git diff --cached)', value: '--cached', description: 'Changes staged for the next commit' },
			{ label: '$(git-pull-request) All working changes (git diff HEAD)', value: 'HEAD', description: 'Staged + unstaged vs HEAD' },
			{ label: '$(history) Last commit (git diff HEAD~1 HEAD)', value: 'LAST_COMMIT', description: 'What changed in the previous commit' },
		],
		{ placeHolder: 'Which changes should Kairu review?', ignoreFocusOut: true }
	);
	if (!target) { return; }

	let diff = '';
	let changedFiles: string[] = [];

	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'Kairu: reading diff...' },
		async () => {
			try {
				let diffCmd: string;
				let nameCmd: string;
				if (target.value === 'LAST_COMMIT') {
					diffCmd = 'git diff HEAD~1 HEAD';
					nameCmd = 'git diff --name-only HEAD~1 HEAD';
				} else {
					diffCmd = `git diff ${target.value}`;
					nameCmd = `git diff --name-only ${target.value}`;
				}
				const { stdout: names } = await exec(nameCmd, { cwd: root, timeout: 10000 });
				changedFiles = names.trim().split('\n').filter(Boolean);

				if (changedFiles.length === 0) {
					return;
				}

				const { stdout: raw } = await exec(diffCmd, { cwd: root, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
				diff = raw.length > 40000 ? raw.slice(0, 40000) + '\n\n... (diff truncated at 40k chars)' : raw;
			} catch (err) {
				vscode.window.showErrorMessage(`Kairu: git diff failed — ${(err as Error).message}`);
			}
		}
	);

	if (changedFiles.length === 0) {
		vscode.window.showInformationMessage('No changes found. Nothing to review.');
		return;
	}

	const solidityFiles = changedFiles.filter(f => f.endsWith('.sol'));
	const hasSolidity = solidityFiles.length > 0;

	const filesList = changedFiles.length <= 15
		? changedFiles.join('\n')
		: changedFiles.slice(0, 15).join('\n') + `\n... (+${changedFiles.length - 15} more)`;

	const focusNote = hasSolidity
		? `This diff includes ${solidityFiles.length} Solidity file(s). Focus your review on the smart contract changes.`
		: 'This diff does not include Solidity files, but review for correctness and security issues regardless.';

	const prompt = `Review the following git diff for security vulnerabilities, correctness issues, and gas inefficiencies.

${focusNote}

**Changed files:**
${filesList}

**Diff:**
\`\`\`diff
${diff}
\`\`\`

**Review checklist (cover what's relevant):**
- Reentrancy, access control, integer overflow/underflow
- Unchecked external call results
- Missing input validation at trust boundaries
- Logic errors (off-by-one, wrong condition direction)
- Gas: storage writes that could be avoided, unbounded loops
- Anything that could be exploited or cause unexpected behavior

Format your response as a prioritized list of findings. For each finding:
1. Severity (Critical / High / Medium / Low / Info)
2. What the issue is and which line(s) it affects
3. The recommended fix

If no issues are found, say so clearly.`;

	await vscode.commands.executeCommand('kairu.ai.openChat');
	await new Promise(resolve => setTimeout(resolve, 300));
	await vscode.commands.executeCommand('kairu.ai.sendMessage', prompt);
}
