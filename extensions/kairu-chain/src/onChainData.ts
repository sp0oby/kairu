/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src http://localhost:* http://127.0.0.1:* https://*;`;

interface OnChainResult {
	balance?: string;
	balanceEth?: string;
	nonce?: number;
	codeSize?: number;
	isContract?: boolean;
	error?: string;
}

async function rpc<T = unknown>(url: string, method: string, params: unknown[]): Promise<T> {
	const resp = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
		signal: AbortSignal.timeout(10000),
	});
	const json = await resp.json() as { result?: T; error?: { message: string } };
	if (json.error) { throw new Error(json.error.message); }
	return json.result as T;
}

async function lookupAddress(rpcUrl: string, address: string): Promise<OnChainResult> {
	try {
		const [balanceHex, nonceHex, codeHex] = await Promise.all([
			rpc<string>(rpcUrl, 'eth_getBalance', [address, 'latest']),
			rpc<string>(rpcUrl, 'eth_getTransactionCount', [address, 'latest']),
			rpc<string>(rpcUrl, 'eth_getCode', [address, 'latest']),
		]);

		const balanceWei = BigInt(balanceHex || '0x0');
		const balanceEth = (Number(balanceWei) / 1e18).toFixed(6);
		const nonce = parseInt(nonceHex || '0x0', 16);
		const code = (codeHex || '0x').replace(/^0x/, '');
		const codeSize = code.length / 2;

		return {
			balance: balanceWei.toString(),
			balanceEth,
			nonce,
			codeSize,
			isContract: codeSize > 0,
		};
	} catch (err) {
		return { error: (err as Error).message };
	}
}

// Encode a function call: function selector + ABI-encoded args (basic types only)
function encodeCallData(signature: string, args: string[]): string {
	const sig = signature.trim();
	const selector = keccak256Selector(sig);

	// Parse arg types from signature: "balanceOf(address)" → ["address"]
	const paramsStart = sig.indexOf('(');
	const paramsEnd = sig.lastIndexOf(')');
	const paramTypes = sig.slice(paramsStart + 1, paramsEnd).split(',').map(s => s.trim()).filter(Boolean);

	if (paramTypes.length !== args.length) {
		throw new Error(`Signature expects ${paramTypes.length} args, got ${args.length}`);
	}

	let encoded = '';
	for (let i = 0; i < paramTypes.length; i++) {
		encoded += encodeArg(paramTypes[i], args[i]);
	}

	return '0x' + selector + encoded;
}

function encodeArg(type: string, value: string): string {
	const v = value.trim();
	if (type === 'address') {
		return v.replace(/^0x/, '').padStart(64, '0').toLowerCase();
	}
	if (type === 'bool') {
		return v === 'true' || v === '1' ? '0'.repeat(63) + '1' : '0'.repeat(64);
	}
	if (type.startsWith('uint') || type.startsWith('int')) {
		let n: bigint;
		try { n = BigInt(v); } catch { n = 0n; }
		const hex = (n < 0n ? (2n ** 256n + n) : n).toString(16);
		return hex.padStart(64, '0');
	}
	if (type.startsWith('bytes') && type !== 'bytes') {
		return v.replace(/^0x/, '').padEnd(64, '0').slice(0, 64);
	}
	// Dynamic types (string, bytes) not supported in this minimal encoder
	throw new Error(`Type "${type}" not supported by basic encoder. Use static types: address, uint, int, bool, bytesN.`);
}

function decodeReturn(type: string, hex: string): string {
	const clean = hex.replace(/^0x/, '');
	if (clean.length === 0) { return '(empty)'; }

	if (type === 'address') {
		return '0x' + clean.slice(-40);
	}
	if (type === 'bool') {
		return BigInt('0x' + clean) === 0n ? 'false' : 'true';
	}
	if (type.startsWith('uint') || type.startsWith('int')) {
		const n = BigInt('0x' + clean);
		return n.toString();
	}
	if (type.startsWith('bytes') && type !== 'bytes') {
		return '0x' + clean.replace(/0+$/, '').padEnd(2, '0');
	}
	if (type === 'string') {
		try {
			// dynamic — first 32B is offset, next 32B is length, then data
			const lenWord = clean.slice(64, 128);
			const len = parseInt(lenWord, 16);
			const data = clean.slice(128, 128 + len * 2);
			return new TextDecoder().decode(hexToBytes(data));
		} catch {
			return '0x' + clean;
		}
	}
	return '0x' + clean;
}

function hexToBytes(hex: string): Uint8Array {
	const arr = new Uint8Array(hex.length / 2);
	for (let i = 0; i < arr.length; i++) {
		arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return arr;
}

// Reuse the keccak from abi.ts via a minimal local copy
function keccak256Selector(sig: string): string {
	const bytes = new TextEncoder().encode(sig);
	return keccakHash(bytes).slice(0, 8);
}

function keccakHash(data: Uint8Array): string {
	const RATE = 136;
	const OUTPUT = 32;
	const state = new Uint32Array(50);
	const msgLen = data.length;
	const blocks = Math.ceil((msgLen + 1) / RATE);
	const padded = new Uint8Array(blocks * RATE);
	padded.set(data);
	padded[msgLen] = 0x01;
	padded[padded.length - 1] |= 0x80;
	for (let b = 0; b < blocks; b++) {
		const block = padded.subarray(b * RATE, (b + 1) * RATE);
		for (let i = 0; i < RATE / 8; i++) {
			const lo = block[i * 8] | (block[i * 8 + 1] << 8) | (block[i * 8 + 2] << 16) | (block[i * 8 + 3] << 24);
			const hi = block[i * 8 + 4] | (block[i * 8 + 5] << 8) | (block[i * 8 + 6] << 16) | (block[i * 8 + 7] << 24);
			state[i * 2] ^= lo;
			state[i * 2 + 1] ^= hi;
		}
		keccakF(state);
	}
	const bytes: number[] = [];
	for (let i = 0; i < OUTPUT / 4; i++) {
		const word = state[i];
		bytes.push(word & 0xff, (word >> 8) & 0xff, (word >> 16) & 0xff, (word >> 24) & 0xff);
	}
	return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

const RC: [number, number][] = [
	[0x00000001, 0x00000000], [0x00008082, 0x00000000], [0x0000808A, 0x80000000], [0x80008000, 0x80000000],
	[0x0000808B, 0x00000000], [0x80000001, 0x00000000], [0x80008081, 0x80000000], [0x00008009, 0x80000000],
	[0x0000008A, 0x00000000], [0x00000088, 0x00000000], [0x80008009, 0x00000000], [0x8000000A, 0x00000000],
	[0x8000808B, 0x00000000], [0x0000008B, 0x80000000], [0x00008089, 0x80000000], [0x00008003, 0x80000000],
	[0x00008002, 0x80000000], [0x00000080, 0x80000000], [0x0000800A, 0x00000000], [0x8000000A, 0x80000000],
	[0x80008081, 0x80000000], [0x00008080, 0x80000000], [0x80000001, 0x00000000], [0x80008008, 0x80000000],
];
const RHO: number[] = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const PI: number[] = [0, 10, 20, 5, 15, 16, 1, 11, 21, 6, 7, 17, 2, 12, 22, 23, 8, 18, 3, 13, 14, 24, 9, 19, 4];
function rot64(lo: number, hi: number, n: number): [number, number] {
	if (n === 0) { return [lo, hi]; }
	if (n === 32) { return [hi, lo]; }
	if (n < 32) { return [(lo << n) | (hi >>> (32 - n)), (hi << n) | (lo >>> (32 - n))]; }
	n -= 32;
	return [(hi << n) | (lo >>> (32 - n)), (lo << n) | (hi >>> (32 - n))];
}
function keccakF(s: Uint32Array): void {
	const bc = new Uint32Array(10);
	for (let r = 0; r < 24; r++) {
		for (let x = 0; x < 5; x++) {
			bc[x * 2] = s[x * 2] ^ s[(x + 5) * 2] ^ s[(x + 10) * 2] ^ s[(x + 15) * 2] ^ s[(x + 20) * 2];
			bc[x * 2 + 1] = s[x * 2 + 1] ^ s[(x + 5) * 2 + 1] ^ s[(x + 10) * 2 + 1] ^ s[(x + 15) * 2 + 1] ^ s[(x + 20) * 2 + 1];
		}
		for (let x = 0; x < 5; x++) {
			const nx = (x + 1) % 5;
			const [rlo, rhi] = rot64(bc[nx * 2], bc[nx * 2 + 1], 1);
			const tlo = bc[((x + 4) % 5) * 2] ^ rlo;
			const thi = bc[((x + 4) % 5) * 2 + 1] ^ rhi;
			for (let y = 0; y < 5; y++) {
				s[(y * 5 + x) * 2] ^= tlo;
				s[(y * 5 + x) * 2 + 1] ^= thi;
			}
		}
		const tmp = new Uint32Array(50);
		for (let x = 0; x < 25; x++) {
			const [rlo, rhi] = rot64(s[x * 2], s[x * 2 + 1], RHO[x]);
			tmp[PI[x] * 2] = rlo;
			tmp[PI[x] * 2 + 1] = rhi;
		}
		for (let y = 0; y < 5; y++) {
			for (let x = 0; x < 5; x++) {
				const i = (y * 5 + x) * 2;
				const ni = (y * 5 + (x + 1) % 5) * 2;
				const nni = (y * 5 + (x + 2) % 5) * 2;
				s[i] = tmp[i] ^ (~tmp[ni] & tmp[nni]);
				s[i + 1] = tmp[i + 1] ^ (~tmp[ni + 1] & tmp[nni + 1]);
			}
		}
		s[0] ^= RC[r][0];
		s[1] ^= RC[r][1];
	}
}

// Cross-extension API for the kairu-ai eth_call tool
export async function ethCallApi(args: {
	rpcUrl: string;
	to: string;
	signature: string;
	args?: string[];
	returnType?: string;
}): Promise<{ ok: boolean; decoded?: string; raw?: string; error?: string }> {
	try {
		const data = encodeCallData(args.signature, args.args ?? []);
		const resultHex = await rpc<string>(args.rpcUrl, 'eth_call', [{ to: args.to, data }, 'latest']);
		const decoded = args.returnType ? decodeReturn(args.returnType, resultHex) : resultHex;
		return { ok: true, raw: resultHex, decoded };
	} catch (err) {
		return { ok: false, error: (err as Error).message };
	}
}

export function openOnChainDataPanel(context: vscode.ExtensionContext): void {
	const panel = vscode.window.createWebviewPanel(
		'kairuOnChain',
		'Kairu · On-Chain Data',
		vscode.ViewColumn.Beside,
		{ enableScripts: true, retainContextWhenHidden: true }
	);

	panel.webview.html = onChainPanelHtml();

	panel.webview.onDidReceiveMessage(async msg => {
		if (msg.type === 'lookup') {
			const result = await lookupAddress(msg.rpcUrl, msg.address);
			panel.webview.postMessage({ type: 'lookupResult', result, address: msg.address });
		}

		if (msg.type === 'call') {
			try {
				const data = encodeCallData(msg.signature, msg.args || []);
				const resultHex = await rpc<string>(msg.rpcUrl, 'eth_call', [{ to: msg.to, data }, 'latest']);

				// Parse return type from signature, e.g. "balanceOf(address)" returns nothing in sig
				// The user provides the return type separately
				const decoded = msg.returnType ? decodeReturn(msg.returnType, resultHex) : resultHex;
				panel.webview.postMessage({
					type: 'callResult',
					ok: true,
					raw: resultHex,
					decoded,
					selector: '0x' + (data.replace(/^0x/, '').slice(0, 8)),
				});
			} catch (err) {
				panel.webview.postMessage({ type: 'callResult', ok: false, error: (err as Error).message });
			}
		}

		if (msg.type === 'copy') {
			vscode.env.clipboard.writeText(msg.text);
		}
	}, undefined, context.subscriptions);
}

function onChainPanelHtml(): string {
	const defaultRpc = vscode.workspace.getConfiguration('kairu.chain').get<string>('defaultRpc', 'http://localhost:8545');
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>On-Chain Data</title>
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
h2 { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin: 18px 0 8px; }
input[type=text] { width: 100%; padding: 7px 10px; background: var(--input-bg); color: var(--fg); border: 1px solid var(--input-border); border-radius: 6px; font-family: inherit; font-size: 12px; outline: none; }
input:focus { border-color: var(--accent); }
button { padding: 7px 14px; border: none; border-radius: 6px; background: var(--accent); color: #0e0e10; font-size: 12px; font-weight: 600; cursor: pointer; }
button:hover { opacity: .85; }
.btn-copy { background: transparent; color: var(--muted); border: 1px solid var(--border); padding: 2px 8px; font-size: 10px; }
.btn-copy:hover { color: var(--accent); border-color: var(--accent); }
.card { background: var(--input-bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 10px; }
label { font-size: 11px; color: var(--muted); display: block; margin-bottom: 4px; }
.row { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; }
.row > div { flex: 1; min-width: 120px; }
.mono { font-family: inherit; font-size: 11px; color: var(--muted); word-break: break-all; }
.tag { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-right: 4px; }
.tag-eoa { background: #82aaff22; color: var(--accent); }
.tag-contract { background: #c792ea22; color: #c792ea; }
.err { color: var(--red); margin-top: 8px; font-size: 12px; }
.pass { color: var(--green); }
table { width: 100%; border-collapse: collapse; }
td { padding: 5px 8px; border-bottom: 1px solid var(--border); font-size: 12px; word-break: break-all; }
td:first-child { color: var(--muted); width: 130px; }
tr:last-child td { border-bottom: none; }
.tip { background: rgba(255, 203, 107, 0.06); border: 1px solid rgba(255, 203, 107, 0.2); border-radius: 6px; padding: 10px; font-size: 11px; color: var(--muted); margin-top: 12px; }
.tip b { color: var(--gold); }
</style>
</head>
<body>
<h1>⬡ On-Chain Data Reader</h1>

<div class="card">
  <label>RPC URL:</label>
  <input type="text" id="rpc" value="${defaultRpc}" placeholder="http://localhost:8545">
</div>

<h2>Address Lookup</h2>
<div class="card">
  <div class="row">
    <div>
      <label>Address:</label>
      <input type="text" id="lookupAddr" placeholder="0x...">
    </div>
    <button onclick="lookup()">Look up</button>
  </div>
  <div id="lookupOut"></div>
</div>

<h2>Call View Function</h2>
<div class="card">
  <div class="row">
    <div>
      <label>Contract address:</label>
      <input type="text" id="callTo" placeholder="0x...">
    </div>
  </div>
  <div class="row" style="margin-top:8px">
    <div>
      <label>Function signature (e.g. balanceOf(address)):</label>
      <input type="text" id="callSig" placeholder="balanceOf(address)">
    </div>
    <div>
      <label>Return type (e.g. uint256, address, bool):</label>
      <input type="text" id="callReturn" placeholder="uint256">
    </div>
  </div>
  <div class="row" style="margin-top:8px">
    <div>
      <label>Args (comma-separated, basic types only — address, uint, int, bool, bytesN):</label>
      <input type="text" id="callArgs" placeholder="0xabc...,123">
    </div>
    <button onclick="callFn()">eth_call</button>
  </div>
  <div id="callOut"></div>
</div>

<div class="tip">
  <b>Heads up:</b> This is a basic JSON-RPC reader. It encodes static types only (address, uint, int, bool, bytesN). Dynamic types (string, bytes, arrays) work for read-only display but cannot be encoded as input. For complex calls, use cast or the Kairu Tx Analyzer.
</div>

<script>
const vscode = acquireVsCodeApi();

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'lookupResult') { renderLookup(msg.result, msg.address); }
  if (msg.type === 'callResult') { renderCall(msg); }
});

function lookup() {
  const addr = document.getElementById('lookupAddr').value.trim();
  const rpcUrl = document.getElementById('rpc').value.trim();
  if (!addr || !rpcUrl) return;
  document.getElementById('lookupOut').innerHTML = '<p class="mono">Querying...</p>';
  vscode.postMessage({ type: 'lookup', address: addr, rpcUrl });
}

function callFn() {
  const rpcUrl = document.getElementById('rpc').value.trim();
  const to = document.getElementById('callTo').value.trim();
  const signature = document.getElementById('callSig').value.trim();
  const returnType = document.getElementById('callReturn').value.trim();
  const argsRaw = document.getElementById('callArgs').value.trim();
  const args = argsRaw ? argsRaw.split(',').map(s => s.trim()) : [];
  if (!rpcUrl || !to || !signature) { return; }
  document.getElementById('callOut').innerHTML = '<p class="mono">Calling...</p>';
  vscode.postMessage({ type: 'call', rpcUrl, to, signature, args, returnType });
}

function copy(text) { vscode.postMessage({ type: 'copy', text }); }

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function renderLookup(r, addr) {
  if (r.error) {
    document.getElementById('lookupOut').innerHTML = '<p class="err">✖ ' + escHtml(r.error) + '</p>';
    return;
  }
  const tag = r.isContract ? '<span class="tag tag-contract">CONTRACT</span>' : '<span class="tag tag-eoa">EOA</span>';
  document.getElementById('lookupOut').innerHTML =
    '<table style="margin-top:10px">' +
    '<tr><td>Address</td><td class="mono">' + tag + escHtml(addr) + ' <button class="btn-copy" onclick="copy(\\'' + escHtml(addr) + '\\')">copy</button></td></tr>' +
    '<tr><td>Balance</td><td>' + r.balanceEth + ' ETH <span class="mono">(' + r.balance + ' wei)</span></td></tr>' +
    '<tr><td>Nonce</td><td>' + r.nonce + '</td></tr>' +
    '<tr><td>Code size</td><td>' + r.codeSize + ' bytes' + (r.codeSize > 24576 ? ' <span style="color:var(--red)">⚠ exceeds 24KB</span>' : '') + '</td></tr>' +
    '</table>';
}

function renderCall(msg) {
  if (!msg.ok) {
    document.getElementById('callOut').innerHTML = '<p class="err">✖ ' + escHtml(msg.error) + '</p>';
    return;
  }
  document.getElementById('callOut').innerHTML =
    '<div style="margin-top:10px"><span class="pass">✓ Call succeeded</span></div>' +
    '<table style="margin-top:6px">' +
    '<tr><td>Selector</td><td class="mono">' + escHtml(msg.selector) + '</td></tr>' +
    '<tr><td>Decoded</td><td><b>' + escHtml(String(msg.decoded)) + '</b> <button class="btn-copy" onclick="copy(\\'' + escHtml(String(msg.decoded)) + '\\')">copy</button></td></tr>' +
    '<tr><td>Raw</td><td class="mono">' + escHtml(msg.raw) + '</td></tr>' +
    '</table>';
}
</script>
</body>
</html>`;
}
