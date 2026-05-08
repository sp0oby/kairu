/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCb);

interface DiagnosticEntry {
	name: string;
	status: 'ok' | 'warn' | 'fail';
	detail: string;
}

export async function runDiagnostics(): Promise<void> {
	const channel = vscode.window.createOutputChannel('Kairu Diagnostics');
	channel.clear();
	channel.show(true);

	channel.appendLine('Kairu Studio — Diagnostics');
	channel.appendLine('─'.repeat(60));
	channel.appendLine('');

	const results: DiagnosticEntry[] = [];

	// 1. Check Kairu extensions are loaded
	const kairuExtensions = ['kairu.kairu-ai', 'kairu.kairu-web3-tools', 'kairu.kairu-foundry', 'kairu.kairu-security', 'kairu.kairu-chain', 'kairu.kairu-dashboard'];
	for (const id of kairuExtensions) {
		const ext = vscode.extensions.getExtension(id);
		if (ext) {
			results.push({ name: `Extension ${id.replace('kairu.', '')}`, status: 'ok', detail: `loaded${ext.isActive ? ', active' : ''}` });
		} else {
			results.push({ name: `Extension ${id.replace('kairu.', '')}`, status: 'fail', detail: 'NOT LOADED' });
		}
	}

	// 2. Check JuanBlanco Solidity is installed
	const solidityExt = vscode.extensions.getExtension('JuanBlanco.solidity');
	results.push({
		name: 'Solidity language extension',
		status: solidityExt ? 'ok' : 'warn',
		detail: solidityExt ? 'JuanBlanco.solidity loaded' : 'not found — install from Extensions',
	});

	// 3. Check AI provider configuration
	const config = vscode.workspace.getConfiguration('kairu.ai');
	const provider = config.get<string>('provider', '');
	const model = config.get<string>('model', '');
	if (!provider) {
		results.push({ name: 'AI provider', status: 'warn', detail: 'not configured — run "Kairu: Open AI Chat" to set up' });
	} else if (!model) {
		results.push({ name: 'AI provider', status: 'warn', detail: `provider=${provider}, no model selected` });
	} else {
		results.push({ name: 'AI provider', status: 'ok', detail: `${provider} / ${model}` });
	}

	// 4. Check Foundry CLI tools
	const checkBin = async (bin: string): Promise<string | null> => {
		try {
			const { stdout } = await exec(`${bin} --version`, { timeout: 5000 });
			return stdout.trim().split('\n')[0];
		} catch {
			return null;
		}
	};

	const forgeV = await checkBin('forge');
	results.push(forgeV
		? { name: 'Foundry (forge)', status: 'ok', detail: forgeV }
		: { name: 'Foundry (forge)', status: 'warn', detail: 'not on PATH — Foundry features disabled. Install: https://book.getfoundry.sh' });

	const anvilV = await checkBin('anvil');
	results.push(anvilV
		? { name: 'Anvil', status: 'ok', detail: anvilV }
		: { name: 'Anvil', status: 'warn', detail: 'not on PATH — fork manager unavailable' });

	const castV = await checkBin('cast');
	results.push(castV
		? { name: 'Cast', status: 'ok', detail: castV }
		: { name: 'Cast', status: 'warn', detail: 'not on PATH' });

	// 5. Check Slither (optional)
	const slitherV = await checkBin('slither');
	results.push(slitherV
		? { name: 'Slither', status: 'ok', detail: slitherV }
		: { name: 'Slither', status: 'warn', detail: 'not on PATH (optional). Install: pip install slither-analyzer' });

	// 6. Check Etherscan API key
	const etherscanKey = vscode.workspace.getConfiguration('kairu.chain').get<string>('etherscanApiKey', '');
	results.push({
		name: 'Etherscan API key',
		status: etherscanKey ? 'ok' : 'warn',
		detail: etherscanKey ? 'configured' : 'not set — contract lookup and tx analyzer require this',
	});

	// 7. Workspace folder
	const ws = vscode.workspace.workspaceFolders;
	results.push({
		name: 'Workspace',
		status: ws && ws.length > 0 ? 'ok' : 'warn',
		detail: ws && ws.length > 0 ? ws[0].uri.fsPath : 'no folder open',
	});

	// 8. Foundry project detection
	if (ws && ws.length > 0) {
		try {
			await vscode.workspace.fs.stat(vscode.Uri.joinPath(ws[0].uri, 'foundry.toml'));
			results.push({ name: 'Foundry project', status: 'ok', detail: 'foundry.toml detected' });
		} catch {
			results.push({ name: 'Foundry project', status: 'warn', detail: 'no foundry.toml — run "Kairu: Initialize Foundry Project"' });
		}
	}

	// Print results
	let okCount = 0;
	let warnCount = 0;
	let failCount = 0;
	for (const r of results) {
		const icon = r.status === 'ok' ? '✓' : r.status === 'warn' ? '⚠' : '✖';
		channel.appendLine(`${icon}  ${r.name.padEnd(34)} ${r.detail}`);
		if (r.status === 'ok') { okCount++; }
		else if (r.status === 'warn') { warnCount++; }
		else { failCount++; }
	}

	channel.appendLine('');
	channel.appendLine('─'.repeat(60));
	channel.appendLine(`Results: ${okCount} OK, ${warnCount} warning(s), ${failCount} failure(s)`);
	channel.appendLine('');

	if (failCount === 0 && warnCount === 0) {
		vscode.window.showInformationMessage('Kairu: All systems green ✓');
	} else if (failCount === 0) {
		vscode.window.showWarningMessage(`Kairu: ${warnCount} item(s) need attention. See "Kairu Diagnostics" output.`);
	} else {
		vscode.window.showErrorMessage(`Kairu: ${failCount} extension(s) failed to load. See "Kairu Diagnostics" output.`);
	}
}
