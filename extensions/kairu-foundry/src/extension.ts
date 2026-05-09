/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
	checkFoundryInstall,
	forgeBuild,
	forgeTest,
	castDecodeCalldata,
	getWorkspaceRoot,
} from './foundry';
import { openTestPanel } from './panels/testPanel';
import { openAnvilPanel } from './panels/anvilPanel';
import { openGasPanel } from './panels/gasPanel';
import { openCoveragePanel, clearCoverageDecorations } from './panels/coveragePanel';
import { openTracePanel } from './panels/tracePanel';
import { FoundryTestCodeLensProvider } from './codeLens';

export function activate(context: vscode.ExtensionContext): void {
	// CodeLens: Run / Debug with AI / -vvvv buttons on test functions
	const codeLensProvider = new FoundryTestCodeLensProvider();
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider(
			[{ language: 'solidity', pattern: '**/*.t.sol' }, { language: 'solidity', pattern: '**/*.test.sol' }],
			codeLensProvider
		)
	);

	// Background install check on activation
	checkFoundryInstall().then(install => {
		if (!install.forge) {
			vscode.window.showWarningMessage(
				'Kairu Foundry: forge not found on PATH. Install Foundry to use test runner, build, and gas tools.',
				'Install Instructions'
			).then(choice => {
				if (choice === 'Install Instructions') {
					vscode.env.openExternal(vscode.Uri.parse('https://book.getfoundry.sh/getting-started/installation'));
				}
			});
		}
	});

	context.subscriptions.push(

		vscode.commands.registerCommand('kairu.foundry.checkInstall', async () => {
			const install = await checkFoundryInstall();
			const lines: string[] = [
				`forge: ${install.forge ? '✓ ' + (install.forgeVersion || 'installed') : '✖ not found'}`,
				`cast: ${install.cast ? '✓ installed' : '✖ not found'}`,
				`anvil: ${install.anvil ? '✓ ' + (install.anvilVersion || 'installed') : '✖ not found'}`,
			];
			vscode.window.showInformationMessage('Kairu Foundry: ' + lines.join(' | '));
		}),

		vscode.commands.registerCommand('kairu.foundry.build', async () => {
			const cwd = getWorkspaceRoot();
			if (!cwd) {
				vscode.window.showWarningMessage('Open a Foundry project folder first.');
				return;
			}
			const channel = vscode.window.createOutputChannel('Kairu Foundry');
			channel.show();
			channel.appendLine('$ forge build --force\n');
			const result = await forgeBuild(cwd, line => channel.appendLine(line));
			channel.appendLine(result.success ? '\n✓ Build succeeded.' : '\n✖ Build failed.');
			if (!result.success) {
				vscode.window.showErrorMessage(`Forge build failed — ${result.errors.length} error(s). See output panel.`);
			} else {
				vscode.window.showInformationMessage('Forge build succeeded.');
			}
		}),

		vscode.commands.registerCommand('kairu.foundry.test', async () => {
			const cwd = getWorkspaceRoot();
			if (!cwd) {
				vscode.window.showWarningMessage('Open a Foundry project folder first.');
				return;
			}
			const channel = vscode.window.createOutputChannel('Kairu Foundry Tests');
			channel.show();
			channel.appendLine('$ forge test\n');
			const results = await forgeTest(cwd, undefined, line => channel.appendLine(line));
			const pass = results.filter(r => r.status === 'pass').length;
			const fail = results.filter(r => r.status === 'fail').length;
			channel.appendLine(`\n${pass} passed, ${fail} failed`);
			if (fail > 0) {
				vscode.window.showErrorMessage(`${fail} test(s) failed. Open Test Runner for details.`);
			} else if (results.length > 0) {
				vscode.window.showInformationMessage(`All ${pass} test(s) passed.`);
			}
		}),

		vscode.commands.registerCommand('kairu.foundry.testFile', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) { return; }
			const fileName = editor.document.fileName.split(/[\\/]/).pop()?.replace('.sol', '') ?? '';
			const cwd = getWorkspaceRoot();
			if (!cwd || !fileName) { return; }
			const channel = vscode.window.createOutputChannel('Kairu Foundry Tests');
			channel.show();
			channel.appendLine(`$ forge test --match-contract ${fileName}\n`);
			const results = await forgeTest(cwd, undefined, line => channel.appendLine(line));
			const pass = results.filter(r => r.status === 'pass').length;
			const fail = results.filter(r => r.status === 'fail').length;
			channel.appendLine(`\n${pass} passed, ${fail} failed`);
		}),

		vscode.commands.registerCommand('kairu.foundry.testFunction', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) { return; }
			const pos = editor.selection.active;
			const text = editor.document.getText();
			// Find nearest function name above cursor
			const lines = text.split('\n').slice(0, pos.line + 1).reverse();
			const fnLine = lines.find(l => /\bfunction\s+(test\w+)/.test(l));
			const fnName = fnLine?.match(/\bfunction\s+(test\w+)/)?.[1];
			if (!fnName) {
				vscode.window.showWarningMessage('Place cursor inside a test function (starts with "test").');
				return;
			}
			const cwd = getWorkspaceRoot();
			if (!cwd) { return; }
			const channel = vscode.window.createOutputChannel('Kairu Foundry Tests');
			channel.show();
			channel.appendLine(`$ forge test --match-test ${fnName}\n`);
			await forgeTest(cwd, fnName, line => channel.appendLine(line));
		}),

		vscode.commands.registerCommand('kairu.foundry.openTestPanel', () => {
			openTestPanel(context);
		}),

		vscode.commands.registerCommand('kairu.foundry.openAnvilPanel', () => {
			openAnvilPanel(context);
		}),

		vscode.commands.registerCommand('kairu.foundry.openGasPanel', () => {
			openGasPanel(context);
		}),

		vscode.commands.registerCommand('kairu.foundry.openCoverage', () => {
			openCoveragePanel(context);
		}),

		vscode.commands.registerCommand('kairu.foundry.clearCoverageDecorations', () => {
			clearCoverageDecorations();
		}),

		vscode.commands.registerCommand('kairu.foundry.openTraceViewer', () => {
			openTracePanel(context);
		}),

		// CodeLens commands — fired by the inline Run/Debug buttons
		vscode.commands.registerCommand('kairu.foundry.runTestByName', async (fnName: string) => {
			const cwd = getWorkspaceRoot();
			if (!cwd) { return; }
			const channel = vscode.window.createOutputChannel('Kairu Foundry Tests');
			channel.show();
			channel.appendLine(`$ forge test --match-test ^${fnName}$\n`);
			const results = await forgeTest(cwd, fnName, line => channel.appendLine(line));
			const r = results.find(r => r.name === fnName);
			if (r?.status === 'pass') {
				vscode.window.showInformationMessage(`✓ ${fnName} passed (gas: ${r.gasUsed?.toLocaleString() ?? '?'})`);
			} else if (r?.status === 'fail') {
				vscode.window.showErrorMessage(`✖ ${fnName} failed: ${r.reason ?? 'see output'}`);
			}
		}),

		vscode.commands.registerCommand('kairu.foundry.runTestVerbose', async (fnName: string) => {
			const cwd = getWorkspaceRoot();
			if (!cwd) { return; }
			const channel = vscode.window.createOutputChannel('Kairu Foundry Tests');
			channel.show();
			channel.appendLine(`$ forge test --match-test ^${fnName}$ -vvvv\n`);
			// Run with verbose flag using raw spawn
			const { spawn } = require('child_process') as typeof import('child_process');
			const child = spawn('forge', ['test', '--match-test', `^${fnName}$`, '-vvvv'], { cwd, shell: false });
			child.stdout.on('data', (d: Buffer) => channel.append(d.toString()));
			child.stderr.on('data', (d: Buffer) => channel.append(d.toString()));
			child.on('close', (code: number) => channel.appendLine(`\n[exited ${code}]`));
		}),

		vscode.commands.registerCommand('kairu.foundry.runTestsByContract', async (contractName: string) => {
			const cwd = getWorkspaceRoot();
			if (!cwd) { return; }
			const channel = vscode.window.createOutputChannel('Kairu Foundry Tests');
			channel.show();
			channel.appendLine(`$ forge test --match-contract ${contractName}\n`);
			const results = await forgeTest(cwd, undefined, line => channel.appendLine(line));
			const contractResults = results.filter(r => r.contract === contractName);
			const pass = contractResults.filter(r => r.status === 'pass').length;
			const fail = contractResults.filter(r => r.status === 'fail').length;
			if (fail > 0) {
				vscode.window.showErrorMessage(`${contractName}: ${fail} test(s) failed. See output.`);
			} else if (contractResults.length > 0) {
				vscode.window.showInformationMessage(`${contractName}: all ${pass} test(s) passed.`);
			}
		}),

		vscode.commands.registerCommand('kairu.foundry.debugTestWithAI', async (fnName: string, filePath: string) => {
			const cwd = getWorkspaceRoot();
			// First run the test to get the actual failure reason
			let failureReason = '';
			if (cwd) {
				const results = await forgeTest(cwd, fnName, () => {});
				const r = results.find(r => r.name === fnName);
				if (r?.status === 'fail') {
					failureReason = r.reason ?? '';
				}
			}

			// Open the test file in the editor if not already open
			if (filePath) {
				const doc = await vscode.workspace.openTextDocument(filePath);
				await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
			}

			// Send to AI chat with structured prompt
			const prompt = failureReason
				? `The Foundry test \`${fnName}\` just failed.\n\nRevert reason: ${failureReason}\n\nPlease:\n1. Explain why this test is failing based on the code and the revert message\n2. Show the exact fix\n3. Verify the fix compiles by calling forge_build`
				: `Analyze the Foundry test \`${fnName}\` in the active file.\n\nPlease:\n1. Explain what this test is checking\n2. Identify any edge cases it might miss\n3. Suggest improvements or additional assertions`;

			await vscode.commands.executeCommand('kairu.ai.openChat');
			// Small delay to let the chat panel open before sending
			await new Promise(resolve => setTimeout(resolve, 400));
			// Use the importApiKey command as a message bus isn't ideal — use a dedicated command
			await vscode.commands.executeCommand('kairu.ai.sendMessage', prompt);
		}),

		vscode.commands.registerCommand('kairu.foundry.cast', async () => {
			const input = await vscode.window.showInputBox({
				prompt: 'cast decode-calldata — enter function signature',
				placeHolder: 'transfer(address,uint256)',
				ignoreFocusOut: true,
			});
			if (!input) { return; }
			const calldata = await vscode.window.showInputBox({
				prompt: 'Enter calldata hex',
				placeHolder: '0xa9059cbb...',
				ignoreFocusOut: true,
			});
			if (!calldata) { return; }
			try {
				const result = await castDecodeCalldata(input, calldata);
				const doc = await vscode.workspace.openTextDocument({
					content: result,
					language: 'plaintext',
				});
				vscode.window.showTextDocument(doc);
			} catch (err) {
				vscode.window.showErrorMessage(`cast error: ${(err as Error).message}`);
			}
		}),

	);
}

export function deactivate(): void {
	// nothing to clean up
}
