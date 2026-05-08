/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { spawnAnvil } from '../foundry';

const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src http://localhost:* http://127.0.0.1:*;`;

async function runRpc(port: number, method: string, params: unknown[]): Promise<unknown> {
	const resp = await fetch(`http://localhost:${port}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
		signal: AbortSignal.timeout(8000),
	});
	const json = await resp.json() as { result?: unknown; error?: { message: string } };
	if (json.error) { throw new Error(json.error.message); }
	return json.result;
}

interface AnvilInstance {
	port: number;
	forkUrl?: string;
	blockNumber?: string;
	kill: () => void;
	log: string[];
}

export function openAnvilPanel(context: vscode.ExtensionContext): void {
	const panel = vscode.window.createWebviewPanel(
		'kairuAnvil',
		'Kairu · Anvil Fork Manager',
		vscode.ViewColumn.Beside,
		{ enableScripts: true, retainContextWhenHidden: true }
	);

	const instances: Map<number, AnvilInstance> = new Map();

	panel.webview.html = anvilPanelHtml();

	panel.webview.onDidReceiveMessage(async msg => {
		if (msg.type === 'start') {
			const port: number = msg.port || 8545;
			if (instances.has(port)) {
				panel.webview.postMessage({ type: 'error', text: `Port ${port} is already running.` });
				return;
			}

			const instance: AnvilInstance = {
				port,
				forkUrl: msg.forkUrl || undefined,
				blockNumber: msg.blockNumber || undefined,
				kill: () => {},
				log: [],
			};

			panel.webview.postMessage({ type: 'starting', port });

			const handle = spawnAnvil(port, instance.forkUrl, instance.blockNumber, line => {
				instance.log.push(line);
				if (instance.log.length > 200) { instance.log.shift(); }
				panel.webview.postMessage({ type: 'log', port, line });
			});

			instance.kill = handle.kill;
			instances.set(port, instance);

			try {
				await handle.ready;
				panel.webview.postMessage({ type: 'started', port, forkUrl: instance.forkUrl, blockNumber: instance.blockNumber });
			} catch (err) {
				instances.delete(port);
				panel.webview.postMessage({ type: 'error', text: `Failed to start anvil on port ${port}: ${(err as Error).message}` });
			}
		}

		if (msg.type === 'stop') {
			const port: number = msg.port;
			const instance = instances.get(port);
			if (instance) {
				instance.kill();
				instances.delete(port);
				panel.webview.postMessage({ type: 'stopped', port });
			}
		}

		if (msg.type === 'copyRpc') {
			const port: number = msg.port;
			vscode.env.clipboard.writeText(`http://localhost:${port}`);
			vscode.window.showInformationMessage(`Copied: http://localhost:${port}`);
		}

		if (msg.type === 'cheatcode') {
			const port: number = msg.port;
			if (!instances.has(port)) {
				panel.webview.postMessage({ type: 'cheatResult', port, ok: false, text: 'Anvil not running on this port.' });
				return;
			}
			try {
				const result = await runRpc(port, msg.method, msg.params || []);
				panel.webview.postMessage({ type: 'cheatResult', port, ok: true, method: msg.method, result });
			} catch (err) {
				panel.webview.postMessage({ type: 'cheatResult', port, ok: false, method: msg.method, text: (err as Error).message });
			}
		}
	}, undefined, context.subscriptions);

	panel.onDidDispose(() => {
		// Kill all running instances when panel closes
		for (const instance of instances.values()) {
			instance.kill();
		}
		instances.clear();
	}, undefined, context.subscriptions);
}

function anvilPanelHtml(): string {
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
input[type=text], input[type=number] { padding: 7px 10px; background: var(--input-bg); color: var(--fg); border: 1px solid var(--input-border); border-radius: 6px; font-family: inherit; font-size: 12px; outline: none; }
input:focus { border-color: var(--accent); }
button { padding: 7px 14px; border: none; border-radius: 6px; background: var(--accent); color: #0e0e10; font-size: 12px; font-weight: 600; cursor: pointer; }
button:hover { opacity: .85; }
.btn-stop { background: var(--red); color: #fff; }
.btn-copy { background: transparent; color: var(--muted); border: 1px solid var(--border); font-size: 10px; padding: 3px 8px; }
.btn-copy:hover { color: var(--accent); border-color: var(--accent); }
.card { background: var(--input-bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 8px; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
label { font-size: 11px; color: var(--muted); white-space: nowrap; }
.mono { font-family: inherit; font-size: 11px; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; }
.status-running { background: var(--green); box-shadow: 0 0 4px var(--green); }
.status-stopped { background: var(--muted); }
pre { background: #111; border-radius: 6px; padding: 10px; font-size: 10px; overflow: auto; color: var(--muted); max-height: 150px; margin-top: 8px; }
.err { color: var(--red); font-size: 12px; margin-top: 8px; }
.rpc-url { color: var(--green); font-weight: 700; }
.known-rpcs { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
.rpc-preset { background: var(--input-bg); border: 1px solid var(--border); border-radius: 4px; padding: 3px 8px; font-size: 11px; cursor: pointer; color: var(--fg); }
.rpc-preset:hover { border-color: var(--accent); }
.cheatcodes { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border); }
.cheat-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin-bottom: 6px; }
.cheat-row { display: flex; gap: 4px; flex-wrap: wrap; }
.btn-cheat {
  padding: 3px 8px; font-size: 10px;
  background: rgba(130, 170, 255, 0.08);
  color: var(--accent);
  border: 1px solid var(--border); border-radius: 4px;
  cursor: pointer; font-family: inherit;
}
.btn-cheat:hover { border-color: var(--accent); background: rgba(130, 170, 255, 0.15); }
.cheat-out { margin-top: 6px; font-size: 11px; min-height: 14px; }
.cheat-out .pass { color: var(--green); }
.cheat-out .err { color: var(--red); }
</style>
<title>Anvil Fork Manager</title>
</head>
<body>
<h1>⬡ Anvil Fork Manager</h1>

<div class="card">
  <h2 style="margin-top:0">Launch New Instance</h2>
  <div class="row">
    <label>Port:</label>
    <input type="number" id="port" value="8545" style="width:80px">
    <label>Fork URL (optional):</label>
    <input type="text" id="forkUrl" placeholder="https://eth-mainnet.alchemyapi.io/v2/..." style="flex:1">
  </div>
  <div class="row">
    <label>Block # (optional):</label>
    <input type="text" id="blockNumber" placeholder="latest or 20000000" style="width:160px">
    <button onclick="startAnvil()">Start Anvil</button>
  </div>
  <div>
    <label>Quick fork presets:</label>
    <div class="known-rpcs">
      <span class="rpc-preset" onclick="setPreset('mainnet')">Mainnet (Alchemy)</span>
      <span class="rpc-preset" onclick="setPreset('base')">Base</span>
      <span class="rpc-preset" onclick="setPreset('arbitrum')">Arbitrum One</span>
      <span class="rpc-preset" onclick="setPreset('polygon')">Polygon</span>
      <span class="rpc-preset" onclick="setPreset('optimism')">Optimism</span>
    </div>
  </div>
</div>

<div id="err"></div>
<h2>Running Instances</h2>
<div id="instances"><p style="color:var(--muted);font-size:12px">No instances running.</p></div>

<script>
const vscode = acquireVsCodeApi();
const instances = {};
const presets = {
  mainnet: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY',
  base: 'https://mainnet.base.org',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
  polygon: 'https://polygon-rpc.com',
  optimism: 'https://mainnet.optimism.io',
};

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'error') { showErr(msg.text); }
  if (msg.type === 'starting') { markStarting(msg.port); }
  if (msg.type === 'started') { markStarted(msg.port, msg.forkUrl, msg.blockNumber); }
  if (msg.type === 'stopped') { markStopped(msg.port); }
  if (msg.type === 'log') { appendLog(msg.port, msg.line); }
  if (msg.type === 'cheatResult') { showCheatResult(msg); }
});

function showCheatResult(msg) {
  const el = document.getElementById('cheat-out-' + msg.port);
  if (!el) return;
  if (msg.ok) {
    let display = msg.result;
    if (typeof display === 'object') display = JSON.stringify(display);
    el.innerHTML = '<div class="pass">✓ ' + (msg.method || 'ok') + (display !== undefined && display !== null && display !== '' ? ' → ' + escHtml(String(display)) : '') + '</div>';
  } else {
    el.innerHTML = '<div class="err">✖ ' + (msg.method ? msg.method + ': ' : '') + escHtml(msg.text || 'failed') + '</div>';
  }
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function rpc(port, method, params) {
  vscode.postMessage({ type: 'cheatcode', port, method, params: params || [] });
}

function mineBlocks(port) {
  const n = prompt('Mine how many blocks?', '1');
  if (!n) return;
  const hex = '0x' + parseInt(n).toString(16);
  rpc(port, 'anvil_mine', [hex]);
}

function snapshot(port) {
  rpc(port, 'evm_snapshot', []);
}

function revert(port) {
  const id = prompt('Revert to snapshot ID:', '0x1');
  if (!id) return;
  rpc(port, 'evm_revert', [id]);
}

function setBalance(port) {
  const addr = prompt('Address to fund:', '0x');
  if (!addr) return;
  const eth = prompt('Balance in ETH:', '100');
  if (!eth) return;
  const wei = BigInt(Math.floor(parseFloat(eth) * 1e18)).toString(16);
  rpc(port, 'anvil_setBalance', [addr, '0x' + wei]);
}

function setStorageAt(port) {
  const addr = prompt('Contract address:', '0x');
  if (!addr) return;
  const slot = prompt('Storage slot (hex):', '0x0');
  if (!slot) return;
  const value = prompt('Value (32-byte hex):', '0x0000000000000000000000000000000000000000000000000000000000000001');
  if (!value) return;
  rpc(port, 'anvil_setStorageAt', [addr, slot, value]);
}

function impersonate(port) {
  const addr = prompt('Address to impersonate:', '0x');
  if (!addr) return;
  rpc(port, 'anvil_impersonateAccount', [addr]);
}

function stopImpersonating(port) {
  const addr = prompt('Address to stop impersonating:', '0x');
  if (!addr) return;
  rpc(port, 'anvil_stopImpersonatingAccount', [addr]);
}

function setBlockTimestamp(port) {
  const sec = prompt('Increase next block timestamp by (seconds):', '3600');
  if (!sec) return;
  const hex = '0x' + parseInt(sec).toString(16);
  rpc(port, 'evm_increaseTime', [hex]);
}

function showErr(text) {
  document.getElementById('err').innerHTML = '<p class="err">✖ ' + text + '</p>';
  setTimeout(() => { document.getElementById('err').innerHTML = ''; }, 6000);
}

function startAnvil() {
  const port = parseInt(document.getElementById('port').value) || 8545;
  const forkUrl = document.getElementById('forkUrl').value.trim();
  const blockNumber = document.getElementById('blockNumber').value.trim();
  vscode.postMessage({ type: 'start', port, forkUrl, blockNumber });
}

function stopAnvil(port) {
  vscode.postMessage({ type: 'stop', port });
}

function copyRpc(port) {
  vscode.postMessage({ type: 'copyRpc', port });
}

function setPreset(name) {
  document.getElementById('forkUrl').value = presets[name] || '';
}

function markStarting(port) {
  instances[port] = { status: 'starting', forkUrl: null, log: [] };
  renderInstances();
}

function markStarted(port, forkUrl, blockNumber) {
  if (!instances[port]) instances[port] = {};
  instances[port].status = 'running';
  instances[port].forkUrl = forkUrl;
  instances[port].blockNumber = blockNumber;
  renderInstances();
}

function markStopped(port) {
  delete instances[port];
  renderInstances();
}

function appendLog(port, line) {
  if (!instances[port]) return;
  if (!instances[port].log) instances[port].log = [];
  instances[port].log.push(line);
  if (instances[port].log.length > 100) instances[port].log.shift();
  const el = document.getElementById('log-' + port);
  if (el) { el.textContent = instances[port].log.join(''); el.scrollTop = el.scrollHeight; }
}

function renderInstances() {
  const ports = Object.keys(instances);
  if (ports.length === 0) {
    document.getElementById('instances').innerHTML = '<p style="color:var(--muted);font-size:12px">No instances running.</p>';
    return;
  }
  const html = ports.map(p => {
    const inst = instances[p];
    const dot = inst.status === 'running' ? '<span class="status-dot status-running"></span>' : '<span class="status-dot status-stopped"></span>';
    const rpcLine = inst.status === 'running' ? '<div class="row" style="margin-top:6px"><span class="mono rpc-url">http://localhost:' + p + '</span><button class="btn-copy" onclick="copyRpc(' + p + ')">copy RPC</button></div>' : '';
    const forkLine = inst.forkUrl ? '<div class="mono" style="margin-top:4px;color:var(--muted)">fork: ' + inst.forkUrl + (inst.blockNumber ? ' @ ' + inst.blockNumber : '') + '</div>' : '<div class="mono" style="margin-top:4px;color:var(--muted)">local devnet (no fork)</div>';
    const status = inst.status === 'starting' ? '⏳ Starting...' : '';
    const cheatcodes = inst.status === 'running'
      ? '<div class="cheatcodes">' +
          '<div class="cheat-label">Cheatcodes</div>' +
          '<div class="cheat-row">' +
            '<button class="btn-cheat" onclick="mineBlocks(' + p + ')">Mine blocks</button>' +
            '<button class="btn-cheat" onclick="snapshot(' + p + ')">Snapshot</button>' +
            '<button class="btn-cheat" onclick="revert(' + p + ')">Revert</button>' +
            '<button class="btn-cheat" onclick="setBalance(' + p + ')">Set balance</button>' +
            '<button class="btn-cheat" onclick="setStorageAt(' + p + ')">Set storage</button>' +
            '<button class="btn-cheat" onclick="impersonate(' + p + ')">Impersonate</button>' +
            '<button class="btn-cheat" onclick="stopImpersonating(' + p + ')">Stop impersonating</button>' +
            '<button class="btn-cheat" onclick="setBlockTimestamp(' + p + ')">Increase time</button>' +
          '</div>' +
          '<div id="cheat-out-' + p + '" class="cheat-out"></div>' +
        '</div>'
      : '';
    return '<div class="card"><div class="row">' + dot + '<b>anvil :' + p + '</b>' + (status ? ' <span style="color:var(--gold)">' + status + '</span>' : '') + '<button class="btn-stop" onclick="stopAnvil(' + p + ')" style="margin-left:auto">Stop</button></div>' + forkLine + rpcLine + cheatcodes + '<pre id="log-' + p + '"></pre></div>';
  });
  document.getElementById('instances').innerHTML = html.join('');
}
</script>
</body>
</html>`;
}
