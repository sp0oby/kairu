/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { TEMPLATES, ContractTemplate, getTemplatesByCategory } from './library';

export async function openTemplatePicker(): Promise<void> {
	const byCategory = getTemplatesByCategory();

	type QuickPickItem = vscode.QuickPickItem & { template?: ContractTemplate };

	const items: QuickPickItem[] = [];
	for (const [category, templates] of byCategory) {
		items.push({ label: category, kind: vscode.QuickPickItemKind.Separator });
		for (const t of templates) {
			items.push({
				label: t.name,
				description: t.category,
				detail: t.description,
				template: t,
			});
		}
	}

	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select a smart contract template',
		matchOnDetail: true,
	}) as QuickPickItem | undefined;

	if (!picked?.template) { return; }

	const template = picked.template;

	// Ask for custom file name
	const fileName = await vscode.window.showInputBox({
		prompt: 'File name',
		value: template.fileName,
		validateInput: val => {
			if (!val.endsWith('.sol')) { return 'File name must end with .sol'; }
			return null;
		},
	});
	if (!fileName) { return; }

	// Find target directory
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		// No workspace — open as untitled document
		const doc = await vscode.workspace.openTextDocument({
			content: template.source,
			language: 'solidity',
		});
		await vscode.window.showTextDocument(doc);
		return;
	}

	// Prefer src/ directory if it exists in the workspace root
	const root = workspaceFolders[0].uri;
	const srcUri = vscode.Uri.joinPath(root, 'src');
	let targetDir: vscode.Uri;
	try {
		await vscode.workspace.fs.stat(srcUri);
		targetDir = srcUri;
	} catch {
		targetDir = root;
	}

	const fileUri = vscode.Uri.joinPath(targetDir, fileName);

	// Check if file exists
	try {
		await vscode.workspace.fs.stat(fileUri);
		const overwrite = await vscode.window.showWarningMessage(
			`${fileName} already exists. Overwrite?`,
			'Overwrite',
			'Cancel'
		);
		if (overwrite !== 'Overwrite') { return; }
	} catch { /* file doesn't exist — that's fine */ }

	// Write file
	const contractName = fileName.replace('.sol', '');
	const content = template.source.replace(/MyContract|MyToken|MyNFT|MyMultiToken|MyVault|MyUpgradeable|MultiSig|MyGovernor/g, contractName);
	await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(content));

	// Open the file
	const doc = await vscode.workspace.openTextDocument(fileUri);
	await vscode.window.showTextDocument(doc);

	// Also offer to create a test file
	if (!fileName.endsWith('.t.sol') && !fileName.includes('Deploy') && !fileName.includes('Script')) {
		const createTest = await vscode.window.showInformationMessage(
			`Template created: ${fileName}. Create a matching Foundry test file?`,
			'Create Test',
			'Skip'
		);
		if (createTest === 'Create Test') {
			const testTemplate = TEMPLATES.find(t => t.id === 'foundry-test');
			if (testTemplate) {
				// Find or create test directory
				const testDir = vscode.Uri.joinPath(root, 'test');
				try { await vscode.workspace.fs.stat(testDir); } catch {
					await vscode.workspace.fs.createDirectory(testDir);
				}
				const testName = contractName + '.t.sol';
				const testUri = vscode.Uri.joinPath(testDir, testName);
				const testContent = testTemplate.source.replace(/MyContract/g, contractName);
				await vscode.workspace.fs.writeFile(testUri, new TextEncoder().encode(testContent));
				const testDoc = await vscode.workspace.openTextDocument(testUri);
				await vscode.window.showTextDocument(testDoc, vscode.ViewColumn.Beside);
			}
		}
	}
}

export async function openFoundryInit(): Promise<void> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		vscode.window.showWarningMessage('Open a folder first to initialize a Foundry project.');
		return;
	}

	const root = workspaceFolders[0].uri.fsPath;

	// Check if foundry.toml already exists
	try {
		await vscode.workspace.fs.stat(vscode.Uri.joinPath(workspaceFolders[0].uri, 'foundry.toml'));
		vscode.window.showInformationMessage('This folder already has a foundry.toml.');
		return;
	} catch { /* good — doesn't exist */ }

	const confirm = await vscode.window.showInformationMessage(
		`Initialize a new Foundry project in ${root.split('/').pop() || root}?`,
		'Initialize',
		'Cancel'
	);
	if (confirm !== 'Initialize') { return; }

	// Create minimal foundry.toml
	const foundryToml = `[profile.default]
src = "src"
out = "out"
libs = ["lib"]
remappings = [
    "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
    "@openzeppelin/contracts-upgradeable/=lib/openzeppelin-contracts-upgradeable/contracts/",
]

[profile.default.fuzz]
runs = 256

[profile.default.invariant]
runs = 256
`;
	const dirs = ['src', 'test', 'script', 'lib'];
	for (const dir of dirs) {
		try {
			await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceFolders[0].uri, dir));
		} catch { /* already exists */ }
	}

	await vscode.workspace.fs.writeFile(
		vscode.Uri.joinPath(workspaceFolders[0].uri, 'foundry.toml'),
		new TextEncoder().encode(foundryToml)
	);

	// Create .gitignore
	const gitignore = `cache/\nout/\n.env\n`;
	await vscode.workspace.fs.writeFile(
		vscode.Uri.joinPath(workspaceFolders[0].uri, '.gitignore'),
		new TextEncoder().encode(gitignore)
	);

	vscode.window.showInformationMessage(
		'Foundry project initialized. Run "forge install" to add dependencies.',
		'Open foundry.toml'
	).then(choice => {
		if (choice === 'Open foundry.toml') {
			vscode.workspace.openTextDocument(vscode.Uri.joinPath(workspaceFolders[0].uri, 'foundry.toml'))
				.then(doc => vscode.window.showTextDocument(doc));
		}
	});
}
