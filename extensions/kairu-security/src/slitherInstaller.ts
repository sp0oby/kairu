/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { exec as execCb, spawn } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCb);

const KEY_DECLINED = 'kairu.slither.installDeclined';

/** Detect if a binary is on PATH. */
async function which(bin: string): Promise<string | null> {
	try {
		const { stdout } = await exec(`command -v ${bin}`, { timeout: 3000 });
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

/** Find the best available Python 3 binary on the system. */
async function findPython(): Promise<string | null> {
	for (const candidate of ['python3', 'python']) {
		const found = await which(candidate);
		if (!found) { continue; }
		try {
			const { stdout } = await exec(`${candidate} --version`, { timeout: 3000 });
			if (stdout.match(/Python 3/)) { return candidate; }
		} catch { /* fall through */ }
	}
	return null;
}

/** Find a usable pip / pipx for installing Python packages. */
async function findInstaller(python: string): Promise<{ cmd: string; args: string[]; label: string } | null> {
	// Prefer pipx (isolated env, recommended for CLI tools)
	if (await which('pipx')) {
		return { cmd: 'pipx', args: ['install', 'slither-analyzer'], label: 'pipx install slither-analyzer' };
	}
	// Try pip3 with --user (no sudo needed)
	if (await which('pip3')) {
		return { cmd: 'pip3', args: ['install', '--user', 'slither-analyzer'], label: 'pip3 install --user slither-analyzer' };
	}
	// Fall back to python -m pip
	return { cmd: python, args: ['-m', 'pip', 'install', '--user', 'slither-analyzer'], label: `${python} -m pip install --user slither-analyzer` };
}

/**
 * If Slither isn't on PATH, prompt the user once per session to install it.
 * Run quietly via a background spawn with progress shown.
 */
export async function ensureSlitherInstalled(context: vscode.ExtensionContext, force = false): Promise<boolean> {
	// Already installed? Done.
	if (await which('slither')) { return true; }

	// User previously declined (and we're not forcing) — stay silent.
	if (!force && context.globalState.get<boolean>(KEY_DECLINED, false)) {
		return false;
	}

	const python = await findPython();
	if (!python) {
		const action = await vscode.window.showWarningMessage(
			'Kairu Security: Python 3 is not installed. Slither requires Python to run.',
			'Install Python (open guide)',
			'Skip',
		);
		if (action === 'Install Python (open guide)') {
			vscode.env.openExternal(vscode.Uri.parse('https://www.python.org/downloads/'));
		} else {
			context.globalState.update(KEY_DECLINED, true);
		}
		return false;
	}

	const installer = await findInstaller(python);
	if (!installer) { return false; }

	const choice = await vscode.window.showInformationMessage(
		'Kairu Security: install Slither for static security analysis? (Free, ~30 sec, ~50MB.)',
		{ modal: false },
		'Install Slither',
		'Not now',
		'Don\'t ask again',
	);

	if (choice === 'Don\'t ask again') {
		await context.globalState.update(KEY_DECLINED, true);
		return false;
	}
	if (choice !== 'Install Slither') {
		return false;
	}

	const ok = await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Installing Slither',
			cancellable: false,
		},
		async progress => {
			progress.report({ message: installer.label });
			return new Promise<boolean>(resolve => {
				const child = spawn(installer.cmd, installer.args, { shell: false });
				let output = '';
				child.stdout.on('data', (d: Buffer) => {
					output += d.toString();
					const lastLine = output.trim().split('\n').pop() || '';
					progress.report({ message: lastLine.slice(0, 80) });
				});
				child.stderr.on('data', (d: Buffer) => {
					output += d.toString();
				});
				child.on('close', code => {
					resolve(code === 0);
				});
				child.on('error', () => resolve(false));
			});
		}
	);

	if (!ok) {
		const retry = await vscode.window.showErrorMessage(
			`Slither install failed. You can install it manually with:\n\n${installer.label}`,
			'Copy install command',
			'Retry',
			'Skip',
		);
		if (retry === 'Copy install command') {
			await vscode.env.clipboard.writeText(installer.label);
		} else if (retry === 'Retry') {
			return ensureSlitherInstalled(context, true);
		}
		return false;
	}

	// Re-check (pip --user installs to ~/.local/bin which may not be on PATH yet)
	if (await which('slither')) {
		vscode.window.showInformationMessage('✓ Slither installed and ready.');
		return true;
	}

	// Installed but not on PATH — common on macOS with pip --user
	vscode.window.showWarningMessage(
		'Slither installed but not on PATH. Add ~/.local/bin to your shell PATH, then restart the IDE.',
		'Show PATH fix',
	).then(action => {
		if (action === 'Show PATH fix') {
			const shell = process.env.SHELL || '';
			const rc = shell.includes('zsh') ? '~/.zshrc' : '~/.bash_profile';
			vscode.env.clipboard.writeText(`echo 'export PATH="$HOME/.local/bin:$PATH"' >> ${rc} && source ${rc}`);
			vscode.window.showInformationMessage(`Command copied. Paste in your terminal then restart Kairu.`);
		}
	});
	return false;
}
