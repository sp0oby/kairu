/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Provides "Fix with Kairu AI" code actions on diagnostics whose source is "Kairu Security".
 * The action opens the AI chat with a structured prompt: file context + finding + ask for a fix.
 */
export class KairuSecurityCodeActionProvider implements vscode.CodeActionProvider {
	static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

	provideCodeActions(
		document: vscode.TextDocument,
		_range: vscode.Range,
		context: vscode.CodeActionContext,
	): vscode.CodeAction[] {
		const kairuDiagnostics = context.diagnostics.filter(d => d.source === 'Kairu Security');
		if (kairuDiagnostics.length === 0) {
			return [];
		}

		const actions: vscode.CodeAction[] = [];

		for (const diag of kairuDiagnostics) {
			const action = new vscode.CodeAction(`◇ Fix "${String(diag.code)}" with Kairu AI`, vscode.CodeActionKind.QuickFix);
			action.diagnostics = [diag];
			action.isPreferred = diag.severity === vscode.DiagnosticSeverity.Error;
			action.command = {
				title: 'Kairu: Ask AI to fix this finding',
				command: 'kairu.security.askAIToFix',
				arguments: [{
					file: document.uri.fsPath,
					line: diag.range.start.line + 1,
					code: String(diag.code),
					message: diag.message,
					severity: vscode.DiagnosticSeverity[diag.severity],
					snippet: document.getText(new vscode.Range(
						Math.max(0, diag.range.start.line - 2), 0,
						Math.min(document.lineCount - 1, diag.range.end.line + 2), 9999,
					)),
				}],
			};
			actions.push(action);
		}

		// Bulk action when there are multiple findings
		if (kairuDiagnostics.length > 1) {
			const bulk = new vscode.CodeAction(`◇ Audit all ${kairuDiagnostics.length} Kairu findings with AI`, vscode.CodeActionKind.QuickFix);
			bulk.diagnostics = kairuDiagnostics;
			bulk.command = {
				title: 'Kairu: Audit all findings',
				command: 'kairu.security.auditAllFindingsWithAI',
				arguments: [{
					file: document.uri.fsPath,
					findings: kairuDiagnostics.map(d => ({
						line: d.range.start.line + 1,
						code: String(d.code),
						message: d.message,
					})),
				}],
			};
			actions.push(bulk);
		}

		return actions;
	}
}

interface AskAIArgs {
	file: string;
	line: number;
	code: string;
	message: string;
	severity: string;
	snippet: string;
}

interface AuditAllArgs {
	file: string;
	findings: Array<{ line: number; code: string; message: string }>;
}

export async function askAIToFix(args: AskAIArgs): Promise<void> {
	const fileName = args.file.split(/[\\/]/).pop() ?? args.file;
	const prompt = `A Kairu Security pattern check flagged a ${args.severity.toLowerCase()} issue. Fix it.

File: ${fileName}
Line: ${args.line}
Finding: ${args.code} — ${args.message}

Code context (with the flagged line):
\`\`\`solidity
${args.snippet}
\`\`\`

Please:
1. Explain the vulnerability in 1-2 sentences
2. Show the precise diff that fixes it (before / after)
3. Note any side-effects of the fix (gas cost, behavior change, missing tests)
4. If you can, propose a Foundry test that proves the fix works

Use the edit_file tool to apply the change directly if you're confident. Otherwise show the diff and let the user apply manually.`;

	await vscode.env.clipboard.writeText(prompt);
	await vscode.commands.executeCommand('kairu.ai.openChat');
	vscode.window.showInformationMessage(
		`Kairu: prompt copied for ${args.code}. Paste in the AI chat (or wait — agent loop will auto-apply if Anthropic + tools enabled).`
	);
}

export async function auditAllFindingsWithAI(args: AuditAllArgs): Promise<void> {
	const fileName = args.file.split(/[\\/]/).pop() ?? args.file;
	const findingsList = args.findings.map(f => `  - line ${f.line} [${f.code}] ${f.message}`).join('\n');
	const prompt = `Kairu Security found multiple issues in ${fileName}. Audit them as a batch.

Findings:
${findingsList}

Steps:
1. Use read_file to load the full file contents
2. Group findings by root cause if any are related
3. For each finding (or group): explain → propose fix → apply via edit_file if confident
4. After edits, run forge_build to verify it still compiles
5. If tests exist, run forge_test to verify behavior
6. Summarize what you changed at the end`;

	await vscode.env.clipboard.writeText(prompt);
	await vscode.commands.executeCommand('kairu.ai.openChat');
	vscode.window.showInformationMessage(
		`Kairu: batch audit prompt copied. Paste in chat to start the agent loop.`
	);
}
