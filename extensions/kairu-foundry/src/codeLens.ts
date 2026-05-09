/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * CodeLens provider for Foundry test files.
 *
 * Shows ▶ Run and ◇ Debug with AI above every function that starts with `test`
 * inside a .t.sol file. Clicking Run fires kairu.foundry.testFunction at that
 * line; clicking Debug sends the test + failure context to the AI chat.
 */
export class FoundryTestCodeLensProvider implements vscode.CodeLensProvider {
	private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

	refresh(): void {
		this._onDidChangeCodeLenses.fire();
	}

	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		if (!document.fileName.endsWith('.t.sol') && !document.fileName.endsWith('.test.sol')) {
			return [];
		}

		const lenses: vscode.CodeLens[] = [];
		const text = document.getText();
		const lines = text.split('\n');

		// Match Solidity test functions: function test... or function invariant...
		const testFnRegex = /^\s*function\s+(test\w+|invariant\w+|statefulFuzz\w*)\s*\(/;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const match = testFnRegex.exec(line);
			if (!match) { continue; }

			const fnName = match[1];
			const range = new vscode.Range(i, 0, i, line.length);

			// ▶ Run — runs just this test function
			lenses.push(new vscode.CodeLens(range, {
				title: '▶ Run',
				command: 'kairu.foundry.runTestByName',
				arguments: [fnName],
				tooltip: `forge test --match-test ${fnName}`,
			}));

			// ◇ Debug with AI — sends this test to the Kairu AI chat
			lenses.push(new vscode.CodeLens(range, {
				title: '◇ Debug with AI',
				command: 'kairu.foundry.debugTestWithAI',
				arguments: [fnName, document.uri.fsPath],
				tooltip: 'Send this test to Kairu AI for analysis',
			}));

			// ⌥ Run with -vvv (verbose) — shows traces
			lenses.push(new vscode.CodeLens(range, {
				title: '-vvvv',
				command: 'kairu.foundry.runTestVerbose',
				arguments: [fnName],
				tooltip: `forge test --match-test ${fnName} -vvvv (full trace)`,
			}));
		}

		// Also add a "Run all tests in file" lens at the top (first contract or first test)
		const firstTestLine = lines.findIndex(l => testFnRegex.test(l));
		if (firstTestLine > 0) {
			// Find the contract declaration above the first test
			let contractLine = firstTestLine;
			for (let i = firstTestLine; i >= 0; i--) {
				if (/^\s*contract\s+\w+/.test(lines[i])) {
					contractLine = i;
					break;
				}
			}
			const contractMatch = /^\s*contract\s+(\w+)/.exec(lines[contractLine]);
			if (contractMatch) {
				const contractName = contractMatch[1];
				const range = new vscode.Range(contractLine, 0, contractLine, lines[contractLine].length);
				lenses.push(new vscode.CodeLens(range, {
					title: `▶ Run all ${contractName} tests`,
					command: 'kairu.foundry.runTestsByContract',
					arguments: [contractName],
					tooltip: `forge test --match-contract ${contractName}`,
				}));
			}
		}

		return lenses;
	}
}
