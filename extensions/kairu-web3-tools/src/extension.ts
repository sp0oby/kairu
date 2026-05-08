/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { openAbiViewer, openCalldataDecoder, openStorageCalculator, openContractMetadata } from './panels';
import { openCallGraph } from './callGraph';
import { openStorageLayoutPanel } from './storageLayout';
import { parseAbi } from './abi';
import { openTemplatePicker, openFoundryInit } from './templates/picker';

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(

		vscode.commands.registerCommand('kairu.web3.openAbiViewer', () => {
			const editor = vscode.window.activeTextEditor;
			let initial = '';
			if (editor) {
				const text = editor.document.getText();
				// Only pre-fill if it looks like an ABI or artifact
				if (text.trimStart().startsWith('[') || (text.includes('"abi"') && text.trimStart().startsWith('{'))) {
					initial = text;
				}
			}
			openAbiViewer(context, initial);
		}),

		vscode.commands.registerCommand('kairu.web3.openCalldataDecoder', () => {
			const editor = vscode.window.activeTextEditor;
			let initial = '';
			if (editor) {
				const sel = editor.selection;
				if (!sel.isEmpty) {
					const text = editor.document.getText(sel).trim();
					if (/^0x[0-9a-fA-F]+$/.test(text)) {
						initial = text;
					}
				}
			}
			openCalldataDecoder(context, initial);
		}),

		vscode.commands.registerCommand('kairu.web3.decodeSelectionCalldata', () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.selection.isEmpty) {
				vscode.window.showWarningMessage('Kairu: Select a hex calldata string first.');
				return;
			}
			const text = editor.document.getText(editor.selection).trim();
			openCalldataDecoder(context, text);
		}),

		vscode.commands.registerCommand('kairu.web3.openStorageCalculator', () => {
			openStorageCalculator(context);
		}),

		vscode.commands.registerCommand('kairu.web3.openCallGraph', () => {
			openCallGraph(context);
		}),

		vscode.commands.registerCommand('kairu.web3.openStorageLayout', () => {
			const editor = vscode.window.activeTextEditor;
			let initial = '';
			if (editor && editor.document.languageId === 'solidity') {
				initial = editor.document.getText();
			}
			openStorageLayoutPanel(context, initial);
		}),

		vscode.commands.registerCommand('kairu.web3.newContract', () => {
			openTemplatePicker();
		}),

		vscode.commands.registerCommand('kairu.web3.initFoundry', () => {
			openFoundryInit();
		}),

		vscode.commands.registerCommand('kairu.web3.openContractMetadata', () => {
			const editor = vscode.window.activeTextEditor;
			let initial = '';
			if (editor) {
				const text = editor.document.getText();
				if (text.trimStart().startsWith('{') || text.includes('[profile')) {
					initial = text;
				}
			}
			openContractMetadata(context, initial);
		}),

	);

	// Auto-open ABI viewer when a .json file looks like an ABI or Foundry artifact
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(doc => {
			if (doc.languageId !== 'json') { return; }
			const text = doc.getText();
			const abi = parseAbi(text);
			if (!abi || abi.length === 0) { return; }
			// Only trigger for files explicitly named *.abi.json or placed in out/ directories
			const path = doc.uri.fsPath;
			if (!path.includes('/out/') && !path.endsWith('.abi.json')) { return; }
			vscode.window.showInformationMessage(
				'Kairu detected a contract ABI. Open ABI Viewer?',
				'Open ABI Viewer',
				'Dismiss'
			).then(choice => {
				if (choice === 'Open ABI Viewer') {
					openAbiViewer(context, text);
				}
			});
		})
	);
}

export function deactivate(): void {
	// nothing to clean up
}
