/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { exec as execCb, spawn } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCb);

async function which(bin: string): Promise<string | null> {
	try {
		const { stdout } = await exec(`command -v ${bin}`, { timeout: 3000 });
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

/** Is the Ollama daemon reachable at the configured endpoint? */
async function isOllamaRunning(endpoint: string): Promise<boolean> {
	try {
		const resp = await fetch(`${endpoint.replace(/\/+$/, '')}/api/tags`, {
			signal: AbortSignal.timeout(2000),
		});
		return resp.ok;
	} catch {
		return false;
	}
}

/**
 * One-click Ollama install + start flow.
 *
 * Tries (in order):
 *   1. `brew install ollama` if Homebrew is available
 *   2. Open the official download page
 *
 * After install, attempts to start the daemon (`ollama serve` in background).
 * Returns true if Ollama is reachable at the end.
 */
export async function installOllama(): Promise<boolean> {
	const config = vscode.workspace.getConfiguration('kairu.ai');
	const endpoint = config.get<string>('ollama.endpoint', 'http://localhost:11434');

	// Already running?
	if (await isOllamaRunning(endpoint)) {
		vscode.window.showInformationMessage(`✓ Ollama is already running at ${endpoint}`);
		return true;
	}

	// Already installed but not running? Try to start it.
	if (await which('ollama')) {
		const start = await vscode.window.showInformationMessage(
			'Ollama is installed but not running. Start it now?',
			'Start Ollama',
			'Cancel',
		);
		if (start === 'Start Ollama') {
			return await startOllama(endpoint);
		}
		return false;
	}

	// Not installed — pick install method
	const hasBrew = !!(await which('brew'));
	const items: vscode.QuickPickItem[] = [];
	if (hasBrew) {
		items.push({ label: '$(package) brew install ollama', description: 'Recommended — Homebrew (~30 sec)' });
	}
	items.push({ label: '$(cloud-download) Download Ollama installer', description: 'Open ollama.com/download in browser' });
	items.push({ label: '$(close) Cancel' });

	const pick = await vscode.window.showQuickPick(items, {
		placeHolder: 'How would you like to install Ollama?',
		ignoreFocusOut: true,
	});
	if (!pick || pick.label.includes('Cancel')) { return false; }

	if (pick.label.startsWith('$(package)')) {
		const installed = await installViaBrew();
		if (!installed) { return false; }
		return await startOllama(endpoint);
	}

	// Browser fallback
	vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download'));
	vscode.window.showInformationMessage(
		'Ollama download opened in browser. Run the installer, then return to Kairu and run "Kairu: Install Ollama" again to start the daemon.',
	);
	return false;
}

async function installViaBrew(): Promise<boolean> {
	return await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Installing Ollama via Homebrew',
			cancellable: false,
		},
		async progress => {
			progress.report({ message: 'brew install ollama' });
			return new Promise<boolean>(resolve => {
				const child = spawn('brew', ['install', 'ollama'], { shell: false });
				child.stdout.on('data', (d: Buffer) => {
					const line = d.toString().trim().split('\n').pop() || '';
					if (line) { progress.report({ message: line.slice(0, 80) }); }
				});
				child.stderr.on('data', (d: Buffer) => {
					const line = d.toString().trim().split('\n').pop() || '';
					if (line) { progress.report({ message: line.slice(0, 80) }); }
				});
				child.on('close', code => {
					if (code === 0) {
						vscode.window.showInformationMessage('✓ Ollama installed via Homebrew.');
						resolve(true);
					} else {
						vscode.window.showErrorMessage(
							'brew install ollama failed. Try installing manually from ollama.com/download.',
							'Open Download Page',
						).then(action => {
							if (action === 'Open Download Page') {
								vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download'));
							}
						});
						resolve(false);
					}
				});
				child.on('error', () => resolve(false));
			});
		}
	);
}

async function startOllama(endpoint: string): Promise<boolean> {
	// On macOS, the brew-installed binary needs `ollama serve` running. Start it
	// detached so it survives our process exit.
	return await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Starting Ollama daemon',
			cancellable: false,
		},
		async progress => {
			progress.report({ message: 'ollama serve' });
			const child = spawn('ollama', ['serve'], {
				shell: false,
				detached: true,
				stdio: 'ignore',
			});
			child.unref();

			// Poll up to 10 seconds for the API to become reachable
			for (let i = 0; i < 20; i++) {
				await new Promise(r => setTimeout(r, 500));
				if (await isOllamaRunning(endpoint)) {
					vscode.window.showInformationMessage(`✓ Ollama running at ${endpoint}`);
					return true;
				}
				progress.report({ message: `Waiting for daemon... (${i + 1}/20)` });
			}

			vscode.window.showWarningMessage(
				`Ollama installed but daemon didn't respond. Try opening a terminal and running: ollama serve`,
				'Copy command',
			).then(action => {
				if (action === 'Copy command') {
					vscode.env.clipboard.writeText('ollama serve');
				}
			});
			return false;
		}
	);
}
