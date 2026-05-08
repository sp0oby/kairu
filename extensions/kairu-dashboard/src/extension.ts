/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { KairuDashboardViewProvider } from './dashboardView';
import { runDiagnostics } from './diagnostics';
import { activateStatusBar } from './statusBar';

export function activate(context: vscode.ExtensionContext): void {
	const dashboardProvider = new KairuDashboardViewProvider(context.extensionUri);

	activateStatusBar(context);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(KairuDashboardViewProvider.viewType, dashboardProvider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),

		vscode.commands.registerCommand('kairu.dashboard.open', async () => {
			await vscode.commands.executeCommand('kairu.dashboard.home.focus');
		}),

		vscode.commands.registerCommand('kairu.dashboard.welcome', async () => {
			await vscode.commands.executeCommand('kairu.dashboard.home.focus');
		}),

		vscode.commands.registerCommand('kairu.dashboard.runDiagnostics', async () => {
			await runDiagnostics();
		}),
	);

	// Show dashboard automatically on first launch only
	const isFirstLaunch = context.globalState.get<boolean>('kairu.dashboard.shownOnce', false) === false;
	if (isFirstLaunch) {
		setTimeout(() => {
			vscode.commands.executeCommand('kairu.dashboard.home.focus');
			context.globalState.update('kairu.dashboard.shownOnce', true);
		}, 1500);
	}
}

export function deactivate(): void {
	// nothing to clean up
}
