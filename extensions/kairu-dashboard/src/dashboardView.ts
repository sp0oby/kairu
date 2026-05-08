/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

interface CommandLink {
	id: string;
	title: string;
	hint?: string;
	keybinding?: string;
}

interface Section {
	title: string;
	icon: string;
	color: string;
	commands: CommandLink[];
}

const SECTIONS: Section[] = [
	{
		title: 'AI Assistant',
		icon: '◇',
		color: '#82aaff',
		commands: [
			{ id: 'kairu.ai.openChat', title: 'Open AI Chat', hint: 'Tool use enabled — Claude can run forge, Slither, edit files, etc.' },
			{ id: 'kairu.ai.setup', title: 'Run Setup Wizard', hint: 'Connect Anthropic, OpenAI, Gemini, Ollama' },
			{ id: 'kairu.ai.setApiKey', title: 'Set API Key' },
			{ id: 'kairu.ai.selectProvider', title: 'Switch Provider' },
			{ id: 'kairu.ai.selectModel', title: 'Switch Model' },
			{ id: 'kairu.ai.toggleInlineCompletions', title: 'Toggle Inline Completions', hint: 'Ghost text as you type (off by default)' },
			{ id: 'kairu.ai.generateCommitMessage', title: 'Generate Commit Message', hint: 'AI writes commit msg from staged diff' },
			{ id: 'kairu.ai.explainSelection', title: 'Explain Selected Code' },
			{ id: 'kairu.ai.findVulnerabilities', title: 'Find Vulnerabilities' },
			{ id: 'kairu.ai.generateFoundryTests', title: 'Generate Foundry Tests' },
			{ id: 'kairu.ai.optimizeGas', title: 'Optimize Gas Usage' },
			{ id: 'kairu.ai.generateNatSpec', title: 'Generate NatSpec Docs' },
			{ id: 'kairu.ai.summarizeFunction', title: 'Summarize Function' },
		],
	},
	{
		title: 'Smart Contracts',
		icon: '◈',
		color: '#a8d89b',
		commands: [
			{ id: 'kairu.web3.newContract', title: 'New Contract from Template', hint: 'ERC20, ERC721, Vault, Multisig, etc.' },
			{ id: 'kairu.web3.initFoundry', title: 'Initialize Foundry Project' },
		],
	},
	{
		title: 'Web3 Tools',
		icon: '⬡',
		color: '#c792ea',
		commands: [
			{ id: 'kairu.web3.openAbiViewer', title: 'ABI Viewer' },
			{ id: 'kairu.web3.openCalldataDecoder', title: 'Calldata Decoder', keybinding: 'Cmd+Shift+D' },
			{ id: 'kairu.web3.openStorageCalculator', title: 'Storage Slot Calculator' },
			{ id: 'kairu.web3.openStorageLayout', title: 'Storage Layout (slot map)' },
			{ id: 'kairu.web3.openContractMetadata', title: 'Contract Metadata' },
			{ id: 'kairu.web3.openCallGraph', title: 'Contract Call Graph' },
		],
	},
	{
		title: 'Foundry',
		icon: '⚒',
		color: '#ffcb6b',
		commands: [
			{ id: 'kairu.foundry.openTestPanel', title: 'Test Runner Panel' },
			{ id: 'kairu.foundry.test', title: 'Run All Tests', keybinding: 'Cmd+Shift+T' },
			{ id: 'kairu.foundry.build', title: 'Build', keybinding: 'Cmd+Shift+B' },
			{ id: 'kairu.foundry.openGasPanel', title: 'Gas Snapshot' },
			{ id: 'kairu.foundry.openCoverage', title: 'Coverage Panel', hint: 'Run forge coverage with inline gutters' },
			{ id: 'kairu.foundry.openTraceViewer', title: 'Trace Viewer', hint: 'Visualize forge test -vvvv call tree' },
			{ id: 'kairu.foundry.openAnvilPanel', title: 'Anvil Fork Manager' },
			{ id: 'kairu.foundry.cast', title: 'Cast: Decode Calldata' },
			{ id: 'kairu.foundry.checkInstall', title: 'Check Foundry Install' },
		],
	},
	{
		title: 'Security',
		icon: '⚿',
		color: '#f78c6c',
		commands: [
			{ id: 'kairu.security.audit', title: 'AI Audit Current File', keybinding: 'Cmd+Shift+A' },
			{ id: 'kairu.security.openAuditPanel', title: 'Open Audit Panel' },
			{ id: 'kairu.security.checkPatterns', title: 'Check Vulnerability Patterns' },
			{ id: 'kairu.security.runSlither', title: 'Run Slither Analysis' },
			{ id: 'kairu.security.importEnv', title: 'Import .env Keys to Keychain' },
		],
	},
	{
		title: 'Chain Tools',
		icon: '⬢',
		color: '#82aaff',
		commands: [
			{ id: 'kairu.chain.openRpcManager', title: 'RPC Manager' },
			{ id: 'kairu.chain.openTxAnalyzer', title: 'Transaction Analyzer', hint: 'Includes simulation on local fork' },
			{ id: 'kairu.chain.openOnChainData', title: 'On-Chain Data Reader', hint: 'Address lookup + eth_call view fns' },
			{ id: 'kairu.chain.openExploitReplay', title: 'Exploit Replay' },
			{ id: 'kairu.chain.openPocGenerator', title: 'PoC Generator' },
			{ id: 'kairu.chain.lookupContract', title: 'Lookup Contract on Explorer' },
		],
	},
];

export class KairuDashboardViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'kairu.dashboard.home';

	private view: vscode.WebviewView | undefined;

	constructor(private readonly extensionUri: vscode.Uri) {}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
		};
		view.webview.html = this.renderHtml(view.webview);

		view.webview.onDidReceiveMessage(async (msg: { type: string; command?: string; args?: unknown[] }) => {
			if (msg.type === 'run' && msg.command) {
				try {
					await vscode.commands.executeCommand(msg.command, ...(msg.args || []));
				} catch (err) {
					vscode.window.showErrorMessage(`Kairu: command "${msg.command}" failed — ${(err as Error).message}`);
				}
			}
			if (msg.type === 'openSettings') {
				vscode.commands.executeCommand('workbench.action.openSettings', 'kairu');
			}
		});
	}

	private renderHtml(webview: vscode.Webview): string {
		const csp = [
			`default-src 'none'`,
			`style-src ${webview.cspSource} 'unsafe-inline'`,
			`script-src ${webview.cspSource} 'unsafe-inline'`,
			`font-src ${webview.cspSource}`,
		].join('; ');

		const sections = SECTIONS.map(s => {
			const cmds = s.commands.map(c => {
				const kb = c.keybinding ? `<kbd>${c.keybinding}</kbd>` : '';
				const hint = c.hint ? `<div class="cmd-hint">${escHtml(c.hint)}</div>` : '';
				return `<button class="cmd-row" onclick="run('${c.id}')">
				<span class="cmd-title">${escHtml(c.title)}</span>${kb}${hint}
			</button>`;
			}).join('');
			return `<section class="section">
				<header class="section-header"><span class="section-icon" style="color:${s.color}">${s.icon}</span><h2>${escHtml(s.title)}</h2></header>
				<div class="section-cmds">${cmds}</div>
			</section>`;
		}).join('');

		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Kairu</title>
<style>
:root {
	--bg: var(--vscode-sideBar-background, #0e0e10);
	--fg: var(--vscode-sideBar-foreground, #cdd6f4);
	--border: var(--vscode-panel-border, #2a2a3a);
	--input-bg: rgba(255,255,255,0.03);
	--accent: #82aaff;
	--muted: #5a5d63;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family, monospace); font-size: 12px; background: var(--bg); color: var(--fg); padding: 12px 8px; line-height: 1.4; }
.kairu-brand { display: flex; align-items: center; gap: 8px; padding: 4px 8px 14px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
.kairu-mark { width: 18px; height: 18px; }
.kairu-name { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; color: var(--fg); }
.kairu-tag { font-size: 10px; color: var(--muted); margin-left: auto; }
.section { margin-bottom: 14px; }
.section-header { display: flex; align-items: center; gap: 6px; padding: 0 8px 4px; }
.section-icon { font-size: 13px; }
.section h2 { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); }
.section-cmds { display: flex; flex-direction: column; gap: 1px; }
.cmd-row {
	display: flex; align-items: center; gap: 6px;
	padding: 5px 8px;
	background: transparent;
	border: 1px solid transparent;
	border-radius: 4px;
	color: var(--fg);
	font-family: inherit;
	font-size: 12px;
	text-align: left;
	cursor: pointer;
	width: 100%;
	flex-wrap: wrap;
}
.cmd-row:hover { background: var(--input-bg); border-color: var(--border); }
.cmd-title { flex: 1; min-width: 0; }
.cmd-hint { width: 100%; font-size: 10px; color: var(--muted); margin-top: 2px; }
kbd {
	font-family: inherit; font-size: 9px; color: var(--muted);
	border: 1px solid var(--border); border-radius: 3px;
	padding: 1px 5px; white-space: nowrap;
	background: rgba(255,255,255,0.02);
}
.footer { padding: 12px 8px 6px; margin-top: 8px; border-top: 1px solid var(--border); font-size: 10px; color: var(--muted); display: flex; flex-direction: column; gap: 6px; }
.footer a { color: var(--accent); cursor: pointer; text-decoration: none; }
.footer a:hover { text-decoration: underline; }
.diag-btn {
	display: inline-flex; align-items: center; gap: 4px;
	padding: 4px 8px; font-size: 11px;
	background: transparent; border: 1px solid var(--border); border-radius: 4px;
	color: var(--fg); cursor: pointer; font-family: inherit;
	margin-top: 4px;
}
.diag-btn:hover { border-color: var(--accent); color: var(--accent); }
</style>
</head>
<body>
<header class="kairu-brand">
	<svg class="kairu-mark" viewBox="0 0 24 24" fill="none" stroke="${SECTIONS[0].color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
		<path d="M6 4 L6 20"/>
		<path d="M6 12 L18 4"/>
		<path d="M6 12 L18 20"/>
		<path d="M11.5 8.5 L17 14"/>
	</svg>
	<span class="kairu-name">KAIRU STUDIO</span>
	<span class="kairu-tag">v0.1</span>
</header>
${sections}
<div class="footer">
	<button class="diag-btn" onclick="runDiagnostics()">Run Diagnostics</button>
	<a onclick="openSettings()">Open Settings</a>
	<span>The everything IDE for Web3 developers.</span>
</div>
<script>
const vscode = acquireVsCodeApi();
function run(cmd) { vscode.postMessage({ type: 'run', command: cmd }); }
function runDiagnostics() { vscode.postMessage({ type: 'run', command: 'kairu.dashboard.runDiagnostics' }); }
function openSettings() { vscode.postMessage({ type: 'openSettings' }); }
</script>
</body>
</html>`;
	}

	reveal(): void {
		this.view?.show?.(true);
	}
}

function escHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
