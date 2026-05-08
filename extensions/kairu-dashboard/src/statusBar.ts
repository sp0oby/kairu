/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCb);

export function activateStatusBar(context: vscode.ExtensionContext): void {
	// AI provider item — left-aligned, low priority so it sits after index status
	const aiItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9);
	aiItem.name = 'Kairu AI';
	aiItem.command = 'kairu.ai.openChat';
	aiItem.tooltip = 'Open Kairu AI chat — click to launch';
	context.subscriptions.push(aiItem);

	const foundryItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 8);
	foundryItem.name = 'Kairu Foundry';
	context.subscriptions.push(foundryItem);

	const updateAi = () => {
		const config = vscode.workspace.getConfiguration('kairu.ai');
		const provider = config.get<string>('provider', '');
		const model = config.get<string>('model', '');
		if (provider && model) {
			const shortModel = model.length > 20 ? model.slice(0, 20) + '…' : model;
			aiItem.text = `$(comment-discussion) ${shortModel}`;
			aiItem.tooltip = `Kairu AI: ${provider} · ${model}\nClick to open chat`;
		} else {
			aiItem.text = '$(comment-discussion) Kairu AI';
			aiItem.tooltip = 'Kairu AI not configured. Click to set up.';
			aiItem.command = 'kairu.ai.setup';
		}
		aiItem.show();
	};

	const updateFoundry = async () => {
		try {
			const { stdout } = await exec('forge --version', { timeout: 4000 });
			const version = stdout.trim().split('\n')[0].split(' ').pop() || 'forge';
			foundryItem.text = `$(check) forge ${version}`;
			foundryItem.tooltip = `Foundry detected: ${stdout.trim().split('\n')[0]}\nClick for Foundry diagnostics`;
			foundryItem.command = 'kairu.foundry.checkInstall';
		} catch {
			foundryItem.text = '$(warning) forge missing';
			foundryItem.tooltip = 'Foundry not on PATH. Click for install info.';
			foundryItem.command = 'kairu.foundry.checkInstall';
		}
		foundryItem.show();
	};

	updateAi();
	updateFoundry();

	// Refresh AI item when config changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('kairu.ai')) {
				updateAi();
			}
		})
	);

	// Refresh Foundry detection every 30 seconds (in case user installs while running)
	const interval = setInterval(updateFoundry, 30000);
	context.subscriptions.push({ dispose: () => clearInterval(interval) });
}
