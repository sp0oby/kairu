/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { openRpcManager } from './rpcManager';
import { openTxAnalyzer } from './txAnalyzer';
import { openOnChainDataPanel, ethCallApi } from './onChainData';
import { CHAINS, fetchContractInfo } from './explorer';

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(

		vscode.commands.registerCommand('kairu.chain.openRpcManager', () => {
			openRpcManager(context);
		}),

		vscode.commands.registerCommand('kairu.chain.openTxAnalyzer', () => {
			openTxAnalyzer(context);
		}),

		vscode.commands.registerCommand('kairu.chain.openOnChainData', () => {
			openOnChainDataPanel(context);
		}),

		// Cross-extension API: used by kairu-ai's eth_call tool
		vscode.commands.registerCommand('kairu.chain.ethCallAPI', (args: { rpcUrl: string; to: string; signature: string; args?: string[]; returnType?: string }) => {
			return ethCallApi(args);
		}),

		vscode.commands.registerCommand('kairu.chain.lookupContract', async () => {
			const config = vscode.workspace.getConfiguration('kairu.chain');
			const apiKey = config.get<string>('etherscanApiKey', '');

			if (!apiKey) {
				vscode.window.showWarningMessage(
					'Kairu Chain: Set your Etherscan API key in settings (kairu.chain.etherscanApiKey) to use contract lookup.',
					'Open Settings'
				).then(choice => {
					if (choice === 'Open Settings') {
						vscode.commands.executeCommand('workbench.action.openSettings', 'kairu.chain.etherscanApiKey');
					}
				});
				return;
			}

			const address = await vscode.window.showInputBox({
				prompt: 'Enter contract address',
				placeHolder: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
				ignoreFocusOut: true,
				validateInput: val => /^0x[0-9a-fA-F]{40}$/.test(val.trim()) ? null : 'Invalid Ethereum address',
			});
			if (!address) { return; }

			const chainItems = Object.entries(CHAINS).map(([id, c]) => ({ label: c.name, id }));
			const chain = await vscode.window.showQuickPick(chainItems, { placeHolder: 'Select chain' });
			if (!chain) { return; }

			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: `Looking up ${address}...` },
				async () => {
					const info = await fetchContractInfo(address.trim(), chain.id, apiKey);
					if (!info) {
						vscode.window.showErrorMessage('Could not fetch contract info. Check address, chain, and API key.');
						return;
					}

					const lines: string[] = [
						`Contract: ${info.name}`,
						`Address: ${info.address}`,
						`Verified: ${info.verified ? 'Yes' : 'No'}`,
					];
					if (info.compiler) { lines.push(`Compiler: ${info.compiler}`); }
					if (info.optimized !== undefined) { lines.push(`Optimized: ${info.optimized ? 'Yes' : 'No'}`); }
					if (info.proxy) { lines.push(`Proxy: Yes${info.implementation ? ` → ${info.implementation}` : ''}`); }

					const choice = await vscode.window.showInformationMessage(
						lines.join(' | '),
						info.abi ? 'Open ABI' : '',
						info.sourceCode ? 'Open Source' : ''
					);

					if (choice === 'Open ABI' && info.abi) {
						const doc = await vscode.workspace.openTextDocument({
							content: JSON.stringify(JSON.parse(info.abi), null, 2),
							language: 'json',
						});
						vscode.window.showTextDocument(doc);
					}
					if (choice === 'Open Source' && info.sourceCode) {
						const doc = await vscode.workspace.openTextDocument({
							content: info.sourceCode,
							language: 'solidity',
						});
						vscode.window.showTextDocument(doc);
					}
				}
			);
		}),

		vscode.commands.registerCommand('kairu.chain.openExploitReplay', () => {
			// Exploit replay: combines tx analyzer + anvil fork
			// Show a quick pick to open tx analyzer or anvil fork manager
			vscode.window.showQuickPick([
				{ label: '$(search) Transaction Analyzer', description: 'Decode and analyze any transaction' },
				{ label: '$(play) Anvil Fork Manager', description: 'Fork a chain to replay at a specific block' },
			], { placeHolder: 'Exploit Replay — choose a tool' }).then(choice => {
				if (!choice) { return; }
				if (choice.label.includes('Transaction')) {
					openTxAnalyzer(context);
				} else {
					vscode.commands.executeCommand('kairu.foundry.openAnvilPanel');
				}
			});
		}),

		vscode.commands.registerCommand('kairu.chain.openPocGenerator', () => {
			// PoC generator: prompt AI to create a Foundry test based on vulnerability
			vscode.window.showInputBox({
				prompt: 'Describe the vulnerability or paste a Slither finding',
				placeHolder: 'Reentrancy in withdraw() — attacker can drain funds via callback',
				ignoreFocusOut: true,
			}).then(description => {
				if (!description) { return; }
				const prompt = `Generate a Foundry proof-of-concept exploit test for this vulnerability:

${description}

Requirements:
1. Use forge-std/Test.sol
2. Fork a real chain using vm.createFork() if needed, or use a minimal mock
3. setUp() function deploys the vulnerable contract and attacker contract
4. exploit() test function demonstrates the attack
5. Assertions prove the exploit succeeded (e.g., attacker gained funds)
6. Comments explain each step of the attack
7. Output a complete, compilable .t.sol file

Scaffold the PoC now:`;
				vscode.commands.executeCommand('kairu.ai.openChat');
				// Small delay to let chat panel open, then auto-send
				setTimeout(() => {
					vscode.commands.executeCommand('kairu.ai.explainSelection');
				}, 500);
				vscode.env.clipboard.writeText(prompt);
				vscode.window.showInformationMessage('PoC prompt copied to clipboard. Paste it in the Kairu AI chat.');
			});
		}),

	);
}

export function deactivate(): void {
	// nothing to clean up
}
