/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const SOL_PRAGMA = '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n\n';

function getSolidityTemplate(filePath: string): string {
	const fileName = filePath.split(/[\\/]/).pop() || '';
	const baseName = fileName.replace(/\.t\.sol$|\.s\.sol$|\.sol$/, '');
	const safeName = /^[A-Z]/.test(baseName) ? baseName : 'MyContract';

	// Foundry test file (.t.sol)
	if (fileName.endsWith('.t.sol')) {
		return `${SOL_PRAGMA}import {Test, console} from "forge-std/Test.sol";

contract ${safeName} is Test {
    function setUp() public {

    }

    function test_${baseName.replace(/Test$/, '') || 'Behavior'}() public {

    }
}
`;
	}

	// Foundry deploy script (.s.sol)
	if (fileName.endsWith('.s.sol')) {
		return `${SOL_PRAGMA}import {Script, console} from "forge-std/Script.sol";

contract ${safeName} is Script {
    function run() public {
        vm.startBroadcast();

        vm.stopBroadcast();
    }
}
`;
	}

	// Plain contract — guess kind from name
	const isInterface = /^I[A-Z]/.test(safeName);
	const isLibrary = /Lib(rary)?$/.test(safeName) || /Util(s|ities)?$/.test(safeName);

	if (isInterface) {
		return `${SOL_PRAGMA}interface ${safeName} {

}
`;
	}
	if (isLibrary) {
		return `${SOL_PRAGMA}library ${safeName} {

}
`;
	}
	return `${SOL_PRAGMA}contract ${safeName} {
    constructor() {

    }
}
`;
}

function getVyperTemplate(filePath: string): string {
	const fileName = filePath.split(/[\\/]/).pop() || '';
	if (fileName.startsWith('test_')) {
		return `# @version ^0.4.0
# Vyper test file


def test_initial_state():
    pass
`;
	}
	return `# @version ^0.4.0


@external
def __init__():
    pass
`;
}

/**
 * Auto-fill empty Solidity / Vyper files with a sensible starter template
 * the first time they're opened. The user can disable via setting.
 */
export function activateAutoFileTemplates(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(async doc => {
			const config = vscode.workspace.getConfiguration('kairu.web3');
			if (!config.get<boolean>('autoFileTemplate', true)) { return; }

			// Only act on real workspace files, not git diffs / output panels / etc.
			if (doc.uri.scheme !== 'file') { return; }

			const fileName = doc.fileName.split(/[\\/]/).pop() || '';
			const ext = fileName.toLowerCase();

			// Determine if this is a file we know how to template
			let template: string | undefined;
			if (ext.endsWith('.sol')) {
				template = getSolidityTemplate(doc.fileName);
			} else if (ext.endsWith('.vy') || ext.endsWith('.vyper')) {
				template = getVyperTemplate(doc.fileName);
			} else {
				return;
			}

			// Only fill if the file is empty (or whitespace-only)
			if (doc.getText().trim().length > 0) { return; }

			// Apply the edit. Use a workspace edit so it integrates with undo history.
			const edit = new vscode.WorkspaceEdit();
			edit.insert(doc.uri, new vscode.Position(0, 0), template);
			await vscode.workspace.applyEdit(edit);

			// Move cursor inside the contract body for immediate typing
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.uri.toString() === doc.uri.toString()) {
				// Find the first blank line inside the first {} block (or after pragma for vyper)
				const bodyMatch = template.match(/\{\n(\s*\n)?/);
				if (bodyMatch && bodyMatch.index !== undefined) {
					const upToCursor = template.slice(0, bodyMatch.index + bodyMatch[0].length);
					const lineCount = (upToCursor.match(/\n/g) || []).length;
					const pos = new vscode.Position(lineCount, 4);
					editor.selection = new vscode.Selection(pos, pos);
					editor.revealRange(new vscode.Range(pos, pos));
				}
			}
		})
	);
}
