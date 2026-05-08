/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { forgeGasSnapshotFromFile, getWorkspaceRoot, GasSnapshot } from '../foundry';

const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';`;

export function openGasPanel(context: vscode.ExtensionContext): void {
	const panel = vscode.window.createWebviewPanel(
		'kairuGasSnapshot',
		'Kairu · Gas Snapshot',
		vscode.ViewColumn.Beside,
		{ enableScripts: true, retainContextWhenHidden: true }
	);

	panel.webview.html = gasPanelHtml([]);

	panel.webview.onDidReceiveMessage(async msg => {
		if (msg.type === 'load') {
			const cwd = getWorkspaceRoot();
			if (!cwd) {
				panel.webview.postMessage({ type: 'error', text: 'No workspace folder open.' });
				return;
			}
			panel.webview.postMessage({ type: 'loading' });
			const snapshots = await forgeGasSnapshotFromFile(cwd);
			panel.webview.postMessage({ type: 'result', snapshots });
		}

		if (msg.type === 'optimize') {
			const prompt = `This Foundry test is using ${msg.gas.toLocaleString()} gas:

  ${msg.contract}.${msg.test}

Show me how to reduce gas usage in the underlying contract function this test exercises. For each suggestion:
1. Explain the optimization (cold storage → cached, struct packing, error vs require, etc.)
2. Show the before / after diff
3. Estimate gas saved
4. Note any tradeoffs (readability, security)

Use the active file in the editor as context.`;
			await vscode.env.clipboard.writeText(prompt);
			await vscode.commands.executeCommand('kairu.ai.openChat');
			vscode.window.showInformationMessage(
				`Gas optimization prompt copied. Paste it in the Kairu AI chat.`
			);
		}
	}, undefined, context.subscriptions);
}

function gasPanelHtml(_snapshots: GasSnapshot[]): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>
:root {
  --bg: var(--vscode-editor-background, #0e0e10);
  --fg: var(--vscode-editor-foreground, #cdd6f4);
  --border: var(--vscode-panel-border, #2a2a3a);
  --input-bg: var(--vscode-input-background, #1a1a2a);
  --accent: #82aaff;
  --green: #a8d89b;
  --red: #f78c6c;
  --gold: #ffcb6b;
  --muted: #5a5d63;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family, monospace); font-size: 13px; background: var(--bg); color: var(--fg); padding: 16px; }
h1 { font-size: 15px; font-weight: 600; color: var(--accent); margin-bottom: 16px; }
h2 { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin: 16px 0 8px; }
button { padding: 7px 14px; border: none; border-radius: 6px; background: var(--accent); color: #0e0e10; font-size: 12px; font-weight: 600; cursor: pointer; }
button:hover { opacity: .85; }
input[type=text] { padding: 7px 10px; background: var(--input-bg); color: var(--fg); border: 1px solid var(--border); border-radius: 6px; font-family: inherit; font-size: 12px; outline: none; width: 100%; }
input:focus { border-color: var(--accent); }
.card { background: var(--input-bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 8px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 11px; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--border); cursor: pointer; user-select: none; }
th:hover { color: var(--accent); }
td { padding: 6px 8px; border-bottom: 1px solid var(--border); font-size: 12px; }
tr:last-child td { border-bottom: none; }
.gas-bar { height: 6px; border-radius: 3px; background: var(--accent); display: inline-block; min-width: 2px; }
.gas-high { background: var(--red); }
.gas-mid { background: var(--gold); }
.gas-low { background: var(--green); }
.mono { font-family: inherit; color: var(--muted); }
.err { color: var(--red); font-size: 12px; }
.row { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
.ai-btn {
  padding: 2px 7px; font-size: 11px;
  background: rgba(130, 170, 255, 0.08);
  color: var(--accent);
  border: 1px solid var(--border); border-radius: 4px;
  cursor: pointer; font-family: inherit;
}
.ai-btn:hover { border-color: var(--accent); }
</style>
<title>Gas Snapshot</title>
</head>
<body>
<h1>⬡ Gas Snapshot</h1>
<p style="color:var(--muted);font-size:12px;margin-bottom:12px">Shows gas usage from your latest <code>forge snapshot</code> or <code>.gas-snapshot</code> file.</p>

<div class="row">
  <button onclick="load()">Load Gas Snapshot</button>
  <input type="text" id="filter" placeholder="Filter by contract or test name..." oninput="renderTable()">
</div>

<div id="output"></div>

<script>
const vscode = acquireVsCodeApi();
let allSnapshots = [];
let sortCol = 'gas';
let sortDir = -1;

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'loading') { document.getElementById('output').innerHTML = '<p style="color:var(--muted)">Running forge snapshot...</p>'; }
  if (msg.type === 'error') { document.getElementById('output').innerHTML = '<p class="err">✖ ' + msg.text + '</p>'; }
  if (msg.type === 'result') {
    allSnapshots = msg.snapshots;
    renderTable();
  }
});

function load() {
  vscode.postMessage({ type: 'load' });
}

function sortBy(col) {
  if (sortCol === col) { sortDir *= -1; } else { sortCol = col; sortDir = -1; }
  renderTable();
}

function renderTable() {
  if (allSnapshots.length === 0) {
    document.getElementById('output').innerHTML = '<div class="card mono" style="text-align:center;padding:24px">No gas snapshot data. Run <b>forge snapshot</b> in your project first.</div>';
    return;
  }

  const filter = document.getElementById('filter').value.toLowerCase();
  let rows = allSnapshots.filter(s => !filter || s.contract.toLowerCase().includes(filter) || s.test.toLowerCase().includes(filter));

  rows = rows.slice().sort((a, b) => {
    const av = sortCol === 'gas' ? a.gas : (sortCol === 'contract' ? a.contract : a.test);
    const bv = sortCol === 'gas' ? b.gas : (sortCol === 'contract' ? b.contract : b.test);
    if (av < bv) return -sortDir;
    if (av > bv) return sortDir;
    return 0;
  });

  const maxGas = Math.max(...allSnapshots.map(s => s.gas));

  const tableRows = rows.map(s => {
    const pct = maxGas > 0 ? (s.gas / maxGas) : 0;
    const barW = Math.max(2, Math.round(pct * 120));
    const cls = pct > 0.75 ? 'gas-high' : pct > 0.4 ? 'gas-mid' : 'gas-low';
    const optBtn = pct > 0.4
      ? '<button class="ai-btn" onclick="optimize(' + JSON.stringify(s).replace(/\\"/g, '&quot;') + ')" title="Ask AI to optimize">◇</button>'
      : '';
    return '<tr><td>' + escHtml(s.contract) + '</td><td>' + escHtml(s.test) + '</td><td style="text-align:right"><span class="mono">' + s.gas.toLocaleString() + '</span></td><td><span class="gas-bar ' + cls + '" style="width:' + barW + 'px"></span></td><td>' + optBtn + '</td></tr>';
  }).join('');

  const arrow = dir => dir === -1 ? ' ↓' : ' ↑';
  document.getElementById('output').innerHTML = '<div style="overflow:auto"><table><thead><tr><th onclick="sortBy(\'contract\')">Contract' + (sortCol==='contract'?arrow(sortDir):'') + '</th><th onclick="sortBy(\'test\')">Test' + (sortCol==='test'?arrow(sortDir):'') + '</th><th onclick="sortBy(\'gas\')" style="text-align:right">Gas' + (sortCol==='gas'?arrow(sortDir):'') + '</th><th>Relative</th><th></th></tr></thead><tbody>' + tableRows + '</tbody></table></div><p class="mono" style="margin-top:8px">' + rows.length + ' / ' + allSnapshots.length + ' entries · ◇ = ask AI to optimize</p>';
}

function optimize(s) {
  vscode.postMessage({ type: 'optimize', contract: s.contract, test: s.test, gas: s.gas });
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
</script>
</body>
</html>`;
}
