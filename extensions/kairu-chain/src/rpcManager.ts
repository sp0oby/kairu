/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CHAINS } from './explorer';

const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';`;

interface RpcEndpoint {
	id: string;
	name: string;
	chainId: string;
	url: string;
	latency?: number;
	blockNumber?: number;
	status?: 'online' | 'offline' | 'checking';
}

export function openRpcManager(context: vscode.ExtensionContext): void {
	const panel = vscode.window.createWebviewPanel(
		'kairuRpcManager',
		'Kairu · RPC Manager',
		vscode.ViewColumn.Beside,
		{ enableScripts: true, retainContextWhenHidden: true }
	);

	const savedEndpoints = context.globalState.get<RpcEndpoint[]>('kairu.rpc.endpoints', []);
	const endpoints: RpcEndpoint[] = savedEndpoints.length > 0 ? savedEndpoints : getDefaultEndpoints();

	panel.webview.html = rpcManagerHtml();

	// Send initial state
	panel.webview.postMessage({ type: 'init', endpoints, chains: CHAINS });

	panel.webview.onDidReceiveMessage(async msg => {
		if (msg.type === 'add') {
			const ep: RpcEndpoint = {
				id: Date.now().toString(),
				name: msg.name,
				chainId: msg.chainId,
				url: msg.url,
				status: 'checking',
			};
			endpoints.push(ep);
			await context.globalState.update('kairu.rpc.endpoints', endpoints);
			panel.webview.postMessage({ type: 'endpoints', endpoints });
			// Health check
			const result = await checkRpc(ep.url);
			ep.latency = result.latency;
			ep.blockNumber = result.blockNumber;
			ep.status = result.ok ? 'online' : 'offline';
			await context.globalState.update('kairu.rpc.endpoints', endpoints);
			panel.webview.postMessage({ type: 'endpoints', endpoints });
		}

		if (msg.type === 'remove') {
			const idx = endpoints.findIndex(e => e.id === msg.id);
			if (idx !== -1) { endpoints.splice(idx, 1); }
			await context.globalState.update('kairu.rpc.endpoints', endpoints);
			panel.webview.postMessage({ type: 'endpoints', endpoints });
		}

		if (msg.type === 'check') {
			const ep = endpoints.find(e => e.id === msg.id);
			if (!ep) { return; }
			ep.status = 'checking';
			panel.webview.postMessage({ type: 'endpoints', endpoints });
			const result = await checkRpc(ep.url);
			ep.latency = result.latency;
			ep.blockNumber = result.blockNumber;
			ep.status = result.ok ? 'online' : 'offline';
			await context.globalState.update('kairu.rpc.endpoints', endpoints);
			panel.webview.postMessage({ type: 'endpoints', endpoints });
		}

		if (msg.type === 'checkAll') {
			for (const ep of endpoints) { ep.status = 'checking'; }
			panel.webview.postMessage({ type: 'endpoints', endpoints });
			await Promise.all(endpoints.map(async ep => {
				const result = await checkRpc(ep.url);
				ep.latency = result.latency;
				ep.blockNumber = result.blockNumber;
				ep.status = result.ok ? 'online' : 'offline';
			}));
			await context.globalState.update('kairu.rpc.endpoints', endpoints);
			panel.webview.postMessage({ type: 'endpoints', endpoints });
		}

		if (msg.type === 'setDefault') {
			const ep = endpoints.find(e => e.id === msg.id);
			if (ep) {
				await vscode.workspace.getConfiguration('kairu.chain').update('defaultRpc', ep.url, vscode.ConfigurationTarget.Global);
				vscode.window.showInformationMessage(`Kairu: Default RPC set to ${ep.name} (${ep.url})`);
			}
		}

		if (msg.type === 'copy') {
			vscode.env.clipboard.writeText(msg.text);
		}
	}, undefined, context.subscriptions);
}

async function checkRpc(url: string): Promise<{ ok: boolean; latency?: number; blockNumber?: number }> {
	const start = Date.now();
	try {
		const resp = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
			signal: AbortSignal.timeout(5000),
		});
		const latency = Date.now() - start;
		const json = await resp.json() as { result?: string };
		const blockNumber = json.result ? parseInt(json.result, 16) : undefined;
		return { ok: true, latency, blockNumber };
	} catch {
		return { ok: false };
	}
}

function getDefaultEndpoints(): RpcEndpoint[] {
	return [
		// Local
		{ id: 'local', name: 'Local (Anvil)', chainId: '31337', url: 'http://localhost:8545', status: 'checking' },

		// Mainnets
		{ id: 'mainnet-cf', name: 'Ethereum Mainnet', chainId: '1',     url: 'https://cloudflare-eth.com',          status: 'checking' },
		{ id: 'base',       name: 'Base',             chainId: '8453',  url: 'https://mainnet.base.org',            status: 'checking' },
		{ id: 'arb',        name: 'Arbitrum One',     chainId: '42161', url: 'https://arb1.arbitrum.io/rpc',        status: 'checking' },
		{ id: 'op',         name: 'Optimism',         chainId: '10',    url: 'https://mainnet.optimism.io',         status: 'checking' },
		{ id: 'polygon',    name: 'Polygon',          chainId: '137',   url: 'https://polygon-rpc.com',             status: 'checking' },

		// Testnets — most common for dev/testing
		{ id: 'sepolia',           name: 'Sepolia',          chainId: '11155111', url: 'https://ethereum-sepolia-rpc.publicnode.com', status: 'checking' },
		{ id: 'holesky',           name: 'Holesky',          chainId: '17000',    url: 'https://ethereum-holesky-rpc.publicnode.com', status: 'checking' },
		{ id: 'base-sepolia',      name: 'Base Sepolia',     chainId: '84532',    url: 'https://sepolia.base.org',                    status: 'checking' },
		{ id: 'arb-sepolia',       name: 'Arbitrum Sepolia', chainId: '421614',   url: 'https://sepolia-rollup.arbitrum.io/rpc',      status: 'checking' },
		{ id: 'op-sepolia',        name: 'Optimism Sepolia', chainId: '11155420', url: 'https://sepolia.optimism.io',                 status: 'checking' },
		{ id: 'polygon-amoy',      name: 'Polygon Amoy',     chainId: '80002',    url: 'https://rpc-amoy.polygon.technology',         status: 'checking' },
	];
}

function rpcManagerHtml(): string {
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
input[type=text] { padding: 7px 10px; background: var(--input-bg); color: var(--fg); border: 1px solid var(--input-border); border-radius: 6px; font-family: inherit; font-size: 12px; outline: none; }
input:focus { border-color: var(--accent); }
button { padding: 5px 10px; border: none; border-radius: 5px; background: var(--accent); color: #0e0e10; font-size: 11px; font-weight: 600; cursor: pointer; }
button:hover { opacity: .85; }
.btn-sm { padding: 3px 8px; font-size: 10px; }
.btn-ghost { background: transparent; color: var(--muted); border: 1px solid var(--border); }
.btn-ghost:hover { color: var(--accent); border-color: var(--accent); }
.btn-danger { background: var(--red); color: #fff; }
.card { background: var(--input-bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 6px; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
label { font-size: 11px; color: var(--muted); white-space: nowrap; }
.mono { font-family: inherit; font-size: 11px; color: var(--muted); }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.dot-online { background: var(--green); box-shadow: 0 0 4px var(--green); }
.dot-offline { background: var(--red); }
.dot-checking { background: var(--gold); animation: blink 1s ease-in-out infinite; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:.4} }
.ep-name { font-weight: 700; }
.ep-url { color: var(--muted); font-size: 11px; }
.latency { font-size: 10px; color: var(--muted); margin-left: 4px; }
</style>
<title>RPC Manager</title>
</head>
<body>
<h1>⬡ RPC Manager</h1>
<div class="card">
  <h2 style="margin-top:0">Add Endpoint</h2>
  <div class="row">
    <label>Name:</label>
    <input type="text" id="add-name" placeholder="My Alchemy Node" style="width:140px">
    <label>Chain ID:</label>
    <input type="text" id="add-chain" placeholder="1" style="width:60px">
    <label>URL:</label>
    <input type="text" id="add-url" placeholder="https://..." style="flex:1;min-width:200px">
    <button onclick="addEndpoint()">Add</button>
  </div>
</div>
<div class="row" style="margin-top:0">
  <button class="btn-ghost" onclick="checkAll()">Check All Health</button>
</div>
<h2>Endpoints</h2>
<div id="endpoint-list"></div>

<script>
const vscode = acquireVsCodeApi();
let endpoints = [];

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'init' || msg.type === 'endpoints') {
    endpoints = msg.endpoints || [];
    renderEndpoints();
  }
});

function addEndpoint() {
  const name = document.getElementById('add-name').value.trim();
  const chainId = document.getElementById('add-chain').value.trim();
  const url = document.getElementById('add-url').value.trim();
  if (!name || !url) return;
  vscode.postMessage({ type: 'add', name, chainId: chainId || '1', url });
  document.getElementById('add-name').value = '';
  document.getElementById('add-url').value = '';
}

function removeEndpoint(id) { vscode.postMessage({ type: 'remove', id }); }
function checkEndpoint(id) { vscode.postMessage({ type: 'check', id }); }
function checkAll() { vscode.postMessage({ type: 'checkAll' }); }
function setDefault(id) { vscode.postMessage({ type: 'setDefault', id }); }
function copyUrl(url) { vscode.postMessage({ type: 'copy', text: url }); }

function renderEndpoints() {
  if (endpoints.length === 0) {
    document.getElementById('endpoint-list').innerHTML = '<p style="color:var(--muted);font-size:12px">No endpoints configured.</p>';
    return;
  }
  document.getElementById('endpoint-list').innerHTML = endpoints.map(ep => {
    const dotClass = ep.status === 'online' ? 'dot-online' : ep.status === 'offline' ? 'dot-offline' : 'dot-checking';
    const latency = ep.latency !== undefined ? '<span class="latency">' + ep.latency + 'ms</span>' : '';
    const block = ep.blockNumber !== undefined ? '<span class="latency">block #' + ep.blockNumber.toLocaleString() + '</span>' : '';
    return '<div class="card"><div class="row" style="margin-bottom:4px"><span class="dot ' + dotClass + '"></span><span class="ep-name">' + escHtml(ep.name) + '</span><span style="font-size:10px;color:var(--muted)">chain:' + escHtml(ep.chainId) + '</span>' + latency + block + '<div style="margin-left:auto;display:flex;gap:6px"><button class="btn-sm btn-ghost" onclick="setDefault(\'' + ep.id + '\')">Set default</button><button class="btn-sm btn-ghost" onclick="checkEndpoint(\'' + ep.id + '\')">Ping</button><button class="btn-sm btn-ghost" onclick="copyUrl(\'' + escHtml(ep.url) + '\')">Copy</button><button class="btn-sm btn-danger" onclick="removeEndpoint(\'' + ep.id + '\')">✕</button></div></div><div class="ep-url">' + escHtml(ep.url) + '</div></div>';
  }).join('');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
</script>
</body>
</html>`;
}
