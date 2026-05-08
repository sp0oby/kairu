/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { runPatternChecks } from './patterns';
import { checkSlitherInstalled, runSlither } from './slither';
import { openAuditPanel, buildDiagnostics } from './auditPanel';
import { activateSecretDetection } from './secretDetector';
import { runEnvImport } from './envImport';
import { KairuSecurityCodeActionProvider, askAIToFix, auditAllFindingsWithAI } from './codeActions';

export function activate(context: vscode.ExtensionContext): void {
	const diagnosticCollection = vscode.languages.createDiagnosticCollection('kairu-security');
	context.subscriptions.push(diagnosticCollection);

	// Secret detection (Phase 11A)
	activateSecretDetection(context);

	// "Fix with Kairu AI" code action provider (lightbulb on diagnostics)
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			{ language: 'solidity' },
			new KairuSecurityCodeActionProvider(),
			{ providedCodeActionKinds: KairuSecurityCodeActionProvider.providedCodeActionKinds },
		)
	);

	// Auto-check on save (pattern analysis only, no Slither on save)
	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument(doc => {
			if (doc.languageId !== 'solidity') { return; }
			const findings = runPatternChecks(doc.getText());
			buildDiagnostics(findings, diagnosticCollection, doc);
		})
	);

	// Also check on open
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(doc => {
			if (doc.languageId !== 'solidity') { return; }
			const findings = runPatternChecks(doc.getText());
			buildDiagnostics(findings, diagnosticCollection, doc);
		})
	);

	// Check already-open docs at activation
	for (const doc of vscode.workspace.textDocuments) {
		if (doc.languageId === 'solidity') {
			const findings = runPatternChecks(doc.getText());
			buildDiagnostics(findings, diagnosticCollection, doc);
		}
	}

	context.subscriptions.push(

		vscode.commands.registerCommand('kairu.security.checkPatterns', () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== 'solidity') {
				vscode.window.showWarningMessage('Open a Solidity file first.');
				return;
			}
			const src = editor.document.getText();
			const findings = runPatternChecks(src);
			buildDiagnostics(findings, diagnosticCollection, editor.document);
			const critical = findings.filter(f => f.severity === 'critical').length;
			const high = findings.filter(f => f.severity === 'high').length;
			if (findings.length === 0) {
				vscode.window.showInformationMessage('Kairu Security: No vulnerability patterns detected.');
			} else {
				vscode.window.showWarningMessage(
					`Kairu Security: ${findings.length} finding(s) — ${critical} critical, ${high} high. Open Audit Panel for details.`,
					'Open Audit Panel'
				).then(choice => {
					if (choice === 'Open Audit Panel') {
						const fileName = editor.document.fileName.split(/[\\/]/).pop();
						openAuditPanel(context, findings, undefined, fileName);
					}
				});
			}
		}),

		vscode.commands.registerCommand('kairu.security.audit', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== 'solidity') {
				vscode.window.showWarningMessage('Open a Solidity file first.');
				return;
			}
			const src = editor.document.getText();
			const fileName = editor.document.fileName.split(/[\\/]/).pop();

			// Run pattern checks
			const patternFindings = runPatternChecks(src);
			buildDiagnostics(patternFindings, diagnosticCollection, editor.document);

			// Try Slither if installed
			let slitherResult = undefined;
			const hasSlither = await checkSlitherInstalled();
			if (hasSlither) {
				await vscode.window.withProgress(
					{ location: vscode.ProgressLocation.Notification, title: 'Kairu: Running Slither analysis...' },
					async () => {
						const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || editor.document.uri.fsPath.replace(/\/[^/]+$/, '');
						slitherResult = await runSlither(editor.document.uri.fsPath, cwd);
					}
				);
			}

			openAuditPanel(context, patternFindings, slitherResult, fileName);
		}),

		vscode.commands.registerCommand('kairu.security.auditSelection', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.selection.isEmpty) {
				vscode.window.showWarningMessage('Select some Solidity code first.');
				return;
			}
			const src = editor.document.getText(editor.selection);
			const findings = runPatternChecks(src);
			const fileName = editor.document.fileName.split(/[\\/]/).pop() + ' (selection)';
			openAuditPanel(context, findings, undefined, fileName);
		}),

		vscode.commands.registerCommand('kairu.security.openAuditPanel', async () => {
			const editor = vscode.window.activeTextEditor;
			const src = editor?.document.languageId === 'solidity' ? editor.document.getText() : '';
			const findings = src ? runPatternChecks(src) : [];
			const fileName = editor?.document.fileName.split(/[\\/]/).pop();
			openAuditPanel(context, findings, undefined, fileName);
		}),

		vscode.commands.registerCommand('kairu.security.importEnv', async () => {
			await runEnvImport();
		}),

		// Cross-extension API: returns pattern findings for arbitrary source text
		// Used by kairu-ai's pattern_audit tool
		vscode.commands.registerCommand('kairu.security.checkPatternsAPI', (src: string) => {
			return runPatternChecks(src);
		}),

		// Code action callbacks (lightbulb → "Fix with AI")
		vscode.commands.registerCommand('kairu.security.askAIToFix', askAIToFix),
		vscode.commands.registerCommand('kairu.security.auditAllFindingsWithAI', auditAllFindingsWithAI),

		vscode.commands.registerCommand('kairu.security.runSlither', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== 'solidity') {
				vscode.window.showWarningMessage('Open a Solidity file first.');
				return;
			}
			const hasSlither = await checkSlitherInstalled();
			if (!hasSlither) {
				vscode.window.showErrorMessage(
					'Slither not found. Install with: pip install slither-analyzer',
					'Copy Install Command'
				).then(choice => {
					if (choice === 'Copy Install Command') {
						vscode.env.clipboard.writeText('pip install slither-analyzer');
					}
				});
				return;
			}
			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Kairu: Running Slither...' },
				async () => {
					const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
						|| editor.document.uri.fsPath.replace(/\/[^/]+$/, '');
					const slitherResult = await runSlither(editor.document.uri.fsPath, cwd);
					const patternFindings = runPatternChecks(editor.document.getText());
					const fileName = editor.document.fileName.split(/[\\/]/).pop();
					openAuditPanel(context, patternFindings, slitherResult, fileName);
				}
			);
		}),

	);
}

export function deactivate(): void {
	// nothing to clean up
}
