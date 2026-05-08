/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CHAINS, fetchTxInfo, fetchTxReceipt, lookup4Byte } from './explorer';

const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src https://www.4byte.directory https://api.etherscan.io https://api-optimistic.etherscan.io https://api.basescan.org https://api.arbiscan.io https://api.polygonscan.com http://localhost:* http://127.0.0.1:*;`;

interface SimulationResult {
	success: boolean;
	gasUsed?: number;
	output?: string;
	revertReason?: string;
	traceSummary?: string;
	error?: string;
}

async function simulateTx(rpcUrl: string, from: string, to: string, value: string, data: string, blockNumber?: string): Promise<SimulationResult> {
	try {
		// Use eth_call for the simulation (read-only, doesn't change state)
		// For more complete simulation, use debug_traceCall on a node that supports it
		const callParams: Record<string, unknown> = {
			from, to, data,
		};
		if (value && value !== '0' && value !== '0x0') {
			callParams.value = value.startsWith('0x') ? value : '0x' + BigInt(value).toString(16);
		}

		const block = blockNumber || 'latest';
		const result = await fetch(rpcUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [callParams, block] }),
			signal: AbortSignal.timeout(15000),
		});
		const json = await result.json() as { result?: string; error?: { message: string; data?: string } };

		if (json.error) {
			// eth_call returns errors for reverts via the error.data field on most RPCs
			let revertReason: string | undefined;
			if (json.error.data) {
				revertReason = decodeRevertReason(json.error.data);
			}
			return { success: false, revertReason: revertReason || json.error.message, error: json.error.message };
		}

		// Estimate gas separately
		let gasUsed: number | undefined;
		try {
			const gasResp = await fetch(rpcUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_estimateGas', params: [callParams, block] }),
				signal: AbortSignal.timeout(10000),
			});
			const gasJson = await gasResp.json() as { result?: string };
			if (gasJson.result) { gasUsed = parseInt(gasJson.result, 16); }
		} catch { /* gas estimation optional */ }

		return { success: true, output: json.result, gasUsed };
	} catch (err) {
		return { success: false, error: (err as Error).message };
	}
}

function decodeRevertReason(data: string): string {
	// Standard Error(string) revert: 0x08c379a0 + abi-encoded string
	const clean = data.replace(/^0x/, '');
	if (clean.startsWith('08c379a0')) {
		try {
			const lenWord = clean.slice(8 + 64, 8 + 128);
			const len = parseInt(lenWord, 16);
			const hexStr = clean.slice(8 + 128, 8 + 128 + len * 2);
			return new TextDecoder().decode(hexToBytes(hexStr));
		} catch { return data; }
	}
	// Panic(uint256): 0x4e487b71 + uint256
	if (clean.startsWith('4e487b71')) {
		const code = parseInt(clean.slice(8, 8 + 64), 16);
		return `Panic(0x${code.toString(16).padStart(2, '0')})`;
	}
	// Custom error — first 4 bytes is selector
	return `Custom error: ${data.slice(0, 10)}`;
}

function hexToBytes(hex: string): Uint8Array {
	const arr = new Uint8Array(hex.length / 2);
	for (let i = 0; i < arr.length; i++) { arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); }
	return arr;
}

export function openTxAnalyzer(context: vscode.ExtensionContext): void {
	const panel = vscode.window.createWebviewPanel(
		'kairuTxAnalyzer',
		'Kairu · Transaction Analyzer',
		vscode.ViewColumn.Beside,
		{ enableScripts: true, retainContextWhenHidden: true }
	);

	panel.webview.html = txAnalyzerHtml();

	panel.webview.onDidReceiveMessage(async msg => {
		if (msg.type === 'analyze') {
			const config = vscode.workspace.getConfiguration('kairu.chain');
			const apiKey = config.get<string>('etherscanApiKey', '');
			const chainId = msg.chainId as string;

			panel.webview.postMessage({ type: 'loading' });

			const [tx, receipt] = await Promise.all([
				fetchTxInfo(msg.hash, chainId, apiKey),
				fetchTxReceipt(msg.hash, chainId, apiKey),
			]);

			if (!tx) {
				panel.webview.postMessage({ type: 'error', text: 'Transaction not found. Check the hash and chain.' });
				return;
			}

			// Decode calldata selector
			let funcSig: string | null = null;
			const selector = tx.input.slice(0, 10);
			if (selector.length === 10 && selector !== '0x') {
				funcSig = await lookup4Byte(selector);
			}

			// ERC20 approval detection
			const approvalWarnings: string[] = [];
			if (selector === '0x095ea7b3') { // approve(address,uint256)
				const amountHex = tx.input.slice(74);
				const amount = amountHex ? BigInt('0x' + amountHex) : 0n;
				if (amount === 2n ** 256n - 1n || amount > BigInt('10000000000000000000000')) {
					approvalWarnings.push('⚠ Unlimited or very large token approval. This contract will be able to spend all your tokens of this type.');
				}
			}

			panel.webview.postMessage({
				type: 'result',
				tx: { ...tx, status: receipt?.status, gasUsed: receipt?.gasUsed },
				funcSig,
				approvalWarnings,
				chainName: CHAINS[chainId]?.name || chainId,
				explorerBase: CHAINS[chainId]?.explorer || '',
			});
		}
		if (msg.type === 'simulate') {
			const rpcUrl = msg.rpcUrl || vscode.workspace.getConfiguration('kairu.chain').get<string>('defaultRpc', 'http://localhost:8545');
			panel.webview.postMessage({ type: 'simulating' });
			const result = await simulateTx(
				rpcUrl,
				msg.from || '0x0000000000000000000000000000000000000000',
				msg.to,
				msg.value || '0',
				msg.input || '0x',
				msg.blockNumber,
			);
			panel.webview.postMessage({ type: 'simulationResult', result });
		}

		if (msg.type === 'copy') {
			vscode.env.clipboard.writeText(msg.text);
		}
	}, undefined, context.subscriptions);
}

function txAnalyzerHtml(): string {
	const chainOptions = Object.entries(CHAINS).map(([id, c]) => `<option value="${id}">${c.name} (${id})</option>`).join('');

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
  --input-border: var(--vscode-input-border, #3a3a5a);
  --accent: #82aaff;
  --green: #a8d89b;
  --red: #f78c6c;
  --gold: #ffcb6b;
  --muted: #5a5d63;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family, monospace); font-size: 13px; background: var(--bg); color: var(--fg); padding: 16px; line-height: 1.5; }
h1 { font-size: 15px; font-weight: 600; color: var(--accent); margin-bottom: 16px; }
h2 { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin: 16px 0 8px; }
input[type=text] { width: 100%; padding: 7px 10px; background: var(--input-bg); color: var(--fg); border: 1px solid var(--input-border); border-radius: 6px; font-family: inherit; font-size: 12px; outline: none; }
input:focus { border-color: var(--accent); }
select { padding: 7px 10px; background: var(--input-bg); color: var(--fg); border: 1px solid var(--input-border); border-radius: 6px; font-family: inherit; font-size: 12px; outline: none; }
select:focus { border-color: var(--accent); }
button { padding: 7px 14px; border: none; border-radius: 6px; background: var(--accent); color: #0e0e10; font-size: 12px; font-weight: 600; cursor: pointer; }
button:hover { opacity: .85; }
.btn-copy { background: transparent; color: var(--muted); border: 1px solid var(--border); padding: 2px 8px; font-size: 10px; }
.btn-copy:hover { color: var(--accent); border-color: var(--accent); }
.card { background: var(--input-bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 8px; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
label { font-size: 11px; color: var(--muted); white-space: nowrap; }
.mono { font-family: inherit; font-size: 11px; color: var(--muted); word-break: break-all; }
.pass { color: var(--green); }
.fail { color: var(--red); }
.warn { color: var(--gold); }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 11px; color: var(--muted); padding: 4px 8px; border-bottom: 1px solid var(--border); }
td { padding: 6px 8px; border-bottom: 1px solid var(--border); font-size: 12px; word-break: break-all; }
tr:last-child td { border-bottom: none; }
pre { background: #111; border-radius: 6px; padding: 10px; font-size: 10px; overflow: auto; color: var(--muted); max-height: 200px; margin-top: 4px; word-break: break-all; white-space: pre-wrap; }
.err { color: var(--red); font-size: 12px; margin-top: 8px; }
a { color: var(--accent); cursor: pointer; }
</style>
<title>Transaction Analyzer</title>
</head>
<body>
<h1>⬡ Transaction Analyzer</h1>

<div class="card">
  <div class="row">
    <label>Chain:</label>
    <select id="chainId">
      ${chainOptions}
    </select>
  </div>
  <div class="row">
    <label>Tx Hash:</label>
    <input type="text" id="txHash" placeholder="0x1234...">
  </div>
  <div class="row">
    <button onclick="analyze()">Analyze</button>
    <span style="font-size:11px;color:var(--muted)">Requires Etherscan API key in Kairu Chain settings</span>
  </div>
</div>

<div id="err"></div>
<div id="output"></div>

<script>
const vscode = acquireVsCodeApi();

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'loading') { document.getElementById('output').innerHTML = '<p style="color:var(--muted)">Loading...</p>'; }
  if (msg.type === 'error') { document.getElementById('err').innerHTML = '<p class="err">✖ ' + msg.text + '</p>'; document.getElementById('output').innerHTML = ''; }
  if (msg.type === 'result') { renderTx(msg); }
  if (msg.type === 'simulating') { document.getElementById('simOut').innerHTML = '<div class="mono">Simulating...</div>'; }
  if (msg.type === 'simulationResult') { renderSim(msg.result); }
});

function renderSim(r) {
  if (!r.success) {
    const reason = r.revertReason || r.error || 'unknown';
    document.getElementById('simOut').innerHTML = '<div class="fail">✖ Reverted: ' + escHtml(reason) + '</div>';
    return;
  }
  const gas = r.gasUsed !== undefined ? r.gasUsed.toLocaleString() : '—';
  const out = (r.output || '0x').slice(0, 200);
  document.getElementById('simOut').innerHTML =
    '<div class="pass">✓ Simulation succeeded</div>' +
    '<div class="mono" style="margin-top:4px">Gas estimate: <b>' + gas + '</b></div>' +
    '<div class="mono">Return data: ' + escHtml(out) + (r.output && r.output.length > 200 ? '…' : '') + '</div>';
}

function analyze() {
  const hash = document.getElementById('txHash').value.trim();
  const chainId = document.getElementById('chainId').value;
  if (!hash) return;
  document.getElementById('err').innerHTML = '';
  vscode.postMessage({ type: 'analyze', hash, chainId });
}

function copy(text) { vscode.postMessage({ type: 'copy', text }); }

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderTx(msg) {
  const tx = msg.tx;
  const status = tx.status !== undefined ? (tx.status === 1 ? '<span class="pass">✓ Success</span>' : '<span class="fail">✖ Reverted</span>') : '—';
  const value = tx.value ? (BigInt(tx.value) / BigInt('1000000000000000000')).toString() + ' ETH (approx)' : '0 ETH';
  const warnings = (msg.approvalWarnings || []).map(w => '<div class="warn" style="margin:8px 0">⚠ ' + escHtml(w) + '</div>').join('');

  const explorerLink = msg.explorerBase ? '<a onclick="openExplorer(\'' + escHtml(tx.hash) + '\',\'' + escHtml(msg.explorerBase) + '\')">View on ' + escHtml(msg.chainName) + ' Explorer</a>' : '';

  document.getElementById('output').innerHTML = \`
    <h2>Transaction — \${escHtml(msg.chainName)}</h2>
    \${warnings}
    <div class="card" style="padding:0">
      <table>
        <tr><th>Hash</th><td class="mono">\${escHtml(tx.hash)}<button class="btn-copy" onclick="copy('\${escHtml(tx.hash)}')">copy</button></td></tr>
        <tr><th>Status</th><td>\${status}</td></tr>
        <tr><th>From</th><td class="mono">\${escHtml(tx.from)}<button class="btn-copy" onclick="copy('\${escHtml(tx.from)}')">copy</button></td></tr>
        <tr><th>To</th><td class="mono">\${escHtml(tx.to || '(contract creation)')}<button class="btn-copy" onclick="copy('\${escHtml(tx.to || '')}')">copy</button></td></tr>
        <tr><th>Value</th><td>\${escHtml(value)}</td></tr>
        <tr><th>Block</th><td>\${tx.blockNumber || '—'}</td></tr>
        \${tx.gasUsed !== undefined ? '<tr><th>Gas Used</th><td>' + tx.gasUsed.toLocaleString() + '</td></tr>' : ''}
      </table>
    </div>
    <h2>Calldata</h2>
    <div class="card">
      \${msg.funcSig ? '<div style="margin-bottom:6px"><b>Function:</b> <span style="color:var(--accent)">' + escHtml(msg.funcSig) + '</span></div>' : '<div style="margin-bottom:6px;color:var(--muted)">Selector: ' + escHtml(tx.input.slice(0,10)) + ' (unknown — paste into ABI viewer to decode)</div>'}
      <pre>\${escHtml(tx.input)}</pre>
      <button class="btn-copy" onclick="copy('\${escHtml(tx.input)}')">Copy calldata</button>
    </div>
    \${explorerLink ? '<div style="margin-top:8px">' + explorerLink + '</div>' : ''}
    <h2>Simulate on local fork</h2>
    <div class="card">
      <div class="row">
        <label style="width:60px">RPC:</label>
        <input type="text" id="simRpc" placeholder="http://localhost:8545" value="http://localhost:8545" style="flex:1">
      </div>
      <div class="row" style="margin-top:6px">
        <label style="width:60px">Block:</label>
        <input type="text" id="simBlock" placeholder="latest or 0x... (defaults to latest)" style="flex:1">
        <button onclick="simulate()">Simulate</button>
      </div>
      <div id="simOut" style="margin-top:8px"></div>
      <div style="font-size:10px;color:var(--muted);margin-top:6px">Tip: Start an Anvil fork at the tx's block first (Kairu Foundry → Anvil Fork Manager) to replay against pre-tx state.</div>
    </div>
  \`;

  // Stash tx data on window for simulation
  window.__kairuTx = tx;
}

function simulate() {
  const tx = window.__kairuTx;
  if (!tx) { return; }
  const rpcUrl = document.getElementById('simRpc').value.trim();
  const blockNumber = document.getElementById('simBlock').value.trim() || undefined;
  document.getElementById('simOut').innerHTML = '<div class="mono">Simulating...</div>';
  vscode.postMessage({
    type: 'simulate', rpcUrl,
    from: tx.from, to: tx.to, value: tx.value, input: tx.input,
    blockNumber,
  });
}

function openExplorer(hash, base) {
  vscode.postMessage({ type: 'copy', text: base + '/tx/' + hash });
}
</script>
</body>
</html>`;
}
