/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { parseAbi, encodeSelector, encodeEventTopic, calldataDecode, computeStorageSlot, AbiItem } from './abi';

const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';`;

function baseHtml(title: string, body: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${title}</title>
<style>
  :root {
    --bg: var(--vscode-editor-background, #0e0e10);
    --fg: var(--vscode-editor-foreground, #cdd6f4);
    --border: var(--vscode-panel-border, #2a2a3a);
    --input-bg: var(--vscode-input-background, #1a1a2a);
    --input-border: var(--vscode-input-border, #3a3a5a);
    --accent: #82aaff;
    --green: #a8d89b;
    --purple: #c792ea;
    --orange: #f78c6c;
    --gold: #ffcb6b;
    --muted: #5a5d63;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family, 'Geist Mono', monospace);
    font-size: 13px;
    background: var(--bg);
    color: var(--fg);
    padding: 16px;
    line-height: 1.5;
  }
  h1 { font-size: 15px; font-weight: 600; color: var(--accent); margin-bottom: 16px; letter-spacing: 0.04em; }
  h2 { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin: 16px 0 8px; }
  textarea, input[type=text], input[type=number], select {
    width: 100%; padding: 8px 10px;
    background: var(--input-bg); color: var(--fg);
    border: 1px solid var(--input-border); border-radius: 6px;
    font-family: inherit; font-size: 12px;
    resize: vertical; outline: none;
  }
  textarea:focus, input:focus, select:focus { border-color: var(--accent); }
  button {
    padding: 7px 14px; border: none; border-radius: 6px;
    background: var(--accent); color: #0e0e10;
    font-size: 12px; font-weight: 600; cursor: pointer; margin-top: 8px;
  }
  button:hover { opacity: 0.85; }
  .row { display: flex; gap: 8px; align-items: flex-start; }
  .row > * { flex: 1; }
  .card {
    background: var(--input-bg); border: 1px solid var(--border);
    border-radius: 8px; padding: 12px; margin-bottom: 8px;
  }
  .tag {
    display: inline-block; padding: 2px 7px; border-radius: 4px;
    font-size: 11px; font-weight: 600; margin-right: 4px;
  }
  .tag-fn { background: #82aaff22; color: var(--accent); }
  .tag-event { background: #c792ea22; color: var(--purple); }
  .tag-error { background: #f78c6c22; color: var(--orange); }
  .tag-ctor { background: #a8d89b22; color: var(--green); }
  .tag-view { background: #ffcb6b22; color: var(--gold); }
  .tag-payable { background: #f78c6c22; color: var(--orange); }
  .mono { font-family: inherit; font-size: 11px; color: var(--muted); word-break: break-all; }
  .selector { color: var(--accent); font-weight: 600; }
  .fn-name { font-weight: 700; font-size: 13px; }
  .params { color: var(--muted); font-size: 11px; margin-top: 2px; }
  #output { margin-top: 16px; }
  .empty { color: var(--muted); font-size: 12px; text-align: center; padding: 24px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; color: var(--muted); padding: 4px 8px; border-bottom: 1px solid var(--border); }
  td { padding: 6px 8px; border-bottom: 1px solid var(--border); font-size: 12px; word-break: break-all; }
  tr:last-child td { border-bottom: none; }
  .err { color: var(--orange); margin-top: 8px; font-size: 12px; }
  label { font-size: 11px; color: var(--muted); display: block; margin-bottom: 4px; }
  .gap { margin-top: 12px; }
  .copy-btn {
    background: transparent; color: var(--muted); border: 1px solid var(--border);
    padding: 2px 8px; font-size: 10px; margin-top: 0; margin-left: 6px;
    vertical-align: middle;
  }
  .copy-btn:hover { color: var(--accent); border-color: var(--accent); }
  .section-header { display: flex; align-items: center; justify-content: space-between; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

// ── ABI Viewer ────────────────────────────────────────────────────────────────

export function openAbiViewer(context: vscode.ExtensionContext, initialText?: string): void {
	const panel = vscode.window.createWebviewPanel(
		'kairuAbiViewer',
		'Kairu · ABI Viewer',
		vscode.ViewColumn.Beside,
		{ enableScripts: true, retainContextWhenHidden: true }
	);
	panel.webview.html = abiViewerHtml(initialText || '');

	panel.webview.onDidReceiveMessage(msg => {
		if (msg.type === 'parse') {
			const items = parseAbi(msg.text);
			if (!items) {
				panel.webview.postMessage({ type: 'error', text: 'Invalid ABI — expected a JSON array or artifact with an "abi" field.' });
			} else {
				const enriched = items.map(item => ({
					...item,
					selector: item.type === 'function' ? encodeSelector(item) : '',
					topic: item.type === 'event' ? encodeEventTopic(item) : '',
				}));
				panel.webview.postMessage({ type: 'result', items: enriched });
			}
		}
		if (msg.type === 'copy') {
			vscode.env.clipboard.writeText(msg.text);
		}
	}, undefined, context.subscriptions);
}

function abiViewerHtml(initial: string): string {
	const escaped = initial.replace(/`/g, '\\`').replace(/\\/g, '\\\\').replace(/\$/g, '\\$');
	return baseHtml('ABI Viewer', `
<h1>⬡ ABI Viewer</h1>
<label>Paste ABI JSON or Foundry/Hardhat artifact:</label>
<textarea id="abiInput" rows="7" placeholder='[{"type":"function","name":"transfer",...}]'>${initial ? escaped : ''}</textarea>
<button onclick="parseAbi()">Parse ABI</button>
<div id="output"></div>
<script>
const vscode = acquireVsCodeApi();
window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'error') {
    document.getElementById('output').innerHTML = '<p class="err">✖ ' + msg.text + '</p>';
  }
  if (msg.type === 'result') {
    renderAbi(msg.items);
  }
});
function parseAbi() {
  vscode.postMessage({ type: 'parse', text: document.getElementById('abiInput').value });
}
function copy(text) {
  vscode.postMessage({ type: 'copy', text });
}
function renderAbi(items) {
  const fns = items.filter(i => i.type === 'function');
  const events = items.filter(i => i.type === 'event');
  const errors = items.filter(i => i.type === 'error');
  const ctor = items.filter(i => i.type === 'constructor');
  const fallbacks = items.filter(i => i.type === 'receive' || i.type === 'fallback');
  let html = '';
  if (ctor.length || fallbacks.length) {
    html += '<h2>Special</h2>';
    [...ctor, ...fallbacks].forEach(item => {
      html += renderItem(item);
    });
  }
  if (fns.length) {
    html += '<h2>Functions (' + fns.length + ')</h2>';
    fns.forEach(item => html += renderItem(item));
  }
  if (events.length) {
    html += '<h2>Events (' + events.length + ')</h2>';
    events.forEach(item => html += renderItem(item));
  }
  if (errors.length) {
    html += '<h2>Errors (' + errors.length + ')</h2>';
    errors.forEach(item => html += renderItem(item));
  }
  document.getElementById('output').innerHTML = html || '<p class="empty">No items found.</p>';
}
function renderItem(item) {
  const typeTag = item.type === 'function' ? (item.stateMutability === 'view' || item.stateMutability === 'pure' ? 'tag-view' : item.stateMutability === 'payable' ? 'tag-payable' : 'tag-fn')
    : item.type === 'event' ? 'tag-event'
    : item.type === 'error' ? 'tag-error'
    : 'tag-ctor';
  const label = item.type === 'function' ? (item.stateMutability || 'nonpayable') : item.type;
  const inputs = (item.inputs || []).map(i => i.type + (i.name ? ' ' + i.name : '')).join(', ');
  const outputs = (item.outputs || []).map(i => i.type + (i.name ? ' ' + i.name : '')).join(', ');
  let sig = '';
  let sigLine = '';
  if (item.type === 'function' && item.selector) {
    sig = item.name + '(' + (item.inputs || []).map(i => i.type).join(',') + ')';
    sigLine = '<div class="mono" style="margin-top:4px">sig: <span class="selector">' + item.selector + '</span><button class="copy-btn" onclick="copy(\'' + item.selector + '\')">copy</button></div>';
    sigLine += '<div class="mono">fn: ' + sig + '<button class="copy-btn" onclick="copy(\'' + sig + '\')">copy</button></div>';
  }
  if (item.type === 'event' && item.topic) {
    sig = item.name + '(' + (item.inputs || []).map(i => i.type).join(',') + ')';
    sigLine = '<div class="mono" style="margin-top:4px">topic0: <span class="selector">' + item.topic + '</span><button class="copy-btn" onclick="copy(\'' + item.topic + '\')">copy</button></div>';
  }
  return \`<div class="card">
    <div><span class="tag \${typeTag}">\${label}</span><span class="fn-name">\${item.name || '(unnamed)'}</span></div>
    <div class="params">inputs: \${inputs || '—'}</div>
    \${outputs ? '<div class="params">outputs: ' + outputs + '</div>' : ''}
    \${sigLine}
  </div>\`;
}
// Auto-parse if content pre-loaded
if (document.getElementById('abiInput').value.trim()) { parseAbi(); }
</script>`);
}

// ── Calldata Decoder ──────────────────────────────────────────────────────────

export function openCalldataDecoder(context: vscode.ExtensionContext, initialHex?: string): void {
	const panel = vscode.window.createWebviewPanel(
		'kairuCalldataDecoder',
		'Kairu · Calldata Decoder',
		vscode.ViewColumn.Beside,
		{ enableScripts: true, retainContextWhenHidden: true }
	);
	panel.webview.html = calldataDecoderHtml(initialHex || '');

	let currentAbi: AbiItem[] = [];

	panel.webview.onDidReceiveMessage(msg => {
		if (msg.type === 'setAbi') {
			const parsed = parseAbi(msg.text);
			if (!parsed) {
				panel.webview.postMessage({ type: 'abiError', text: 'Invalid ABI JSON.' });
			} else {
				currentAbi = parsed;
				panel.webview.postMessage({ type: 'abiOk', count: parsed.length });
			}
		}
		if (msg.type === 'decode') {
			const result = calldataDecode(msg.hex, currentAbi);
			if (!result) {
				panel.webview.postMessage({ type: 'decodeError', text: currentAbi.length === 0 ? 'No ABI loaded. Paste an ABI above first.' : 'Selector not found in ABI. Is the calldata for this contract?' });
			} else {
				panel.webview.postMessage({ type: 'decodeResult', fn: result.fn, decoded: result.decoded });
			}
		}
		if (msg.type === 'copy') {
			vscode.env.clipboard.writeText(msg.text);
		}
	}, undefined, context.subscriptions);
}

function calldataDecoderHtml(initial: string): string {
	return baseHtml('Calldata Decoder', `
<h1>⬡ Calldata Decoder</h1>
<label>ABI (optional — required to decode params):</label>
<textarea id="abiInput" rows="4" placeholder='[{"type":"function","name":"transfer",...}]'></textarea>
<button onclick="setAbi()">Load ABI</button>
<span id="abiStatus" style="font-size:11px;color:var(--muted);margin-left:8px;"></span>
<div class="gap">
  <label>Calldata hex:</label>
  <textarea id="hexInput" rows="4" placeholder="0xa9059cbb000000000000000000000000...">${initial}</textarea>
  <button onclick="decode()">Decode</button>
</div>
<div id="output"></div>
<script>
const vscode = acquireVsCodeApi();
window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'abiError') { document.getElementById('abiStatus').textContent = '✖ ' + msg.text; document.getElementById('abiStatus').style.color = 'var(--orange)'; }
  if (msg.type === 'abiOk') { document.getElementById('abiStatus').textContent = '✓ ' + msg.count + ' items loaded'; document.getElementById('abiStatus').style.color = 'var(--green)'; }
  if (msg.type === 'decodeError') { document.getElementById('output').innerHTML = '<p class="err">✖ ' + msg.text + '</p>'; }
  if (msg.type === 'decodeResult') { renderDecoded(msg.fn, msg.decoded); }
});
function setAbi() {
  vscode.postMessage({ type: 'setAbi', text: document.getElementById('abiInput').value });
}
function decode() {
  vscode.postMessage({ type: 'decode', hex: document.getElementById('hexInput').value });
}
function copy(text) { vscode.postMessage({ type: 'copy', text }); }
function renderDecoded(fn, decoded) {
  const hex = document.getElementById('hexInput').value.replace(/^0x/,'').slice(0,8);
  const inputs = (fn.inputs || []).map(i => i.type + (i.name ? ' ' + i.name : '')).join(', ');
  let rows = '';
  for (const [k, v] of Object.entries(decoded)) {
    rows += '<tr><td><b>' + k + '</b></td><td class="mono">' + v + '<button class="copy-btn" onclick="copy(' + JSON.stringify(v) + ')">copy</button></td></tr>';
  }
  document.getElementById('output').innerHTML = \`
    <div class="card">
      <div><span class="tag tag-fn">function</span><span class="fn-name">\${fn.name}</span></div>
      <div class="params">signature: \${fn.name}(\${inputs})</div>
      <div class="mono" style="margin-top:4px">selector: <span class="selector">0x\${hex}</span></div>
    </div>
    <h2>Decoded Parameters</h2>
    <div class="card" style="padding:0">
      <table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody>\${rows || '<tr><td colspan="2" class="empty">No parameters</td></tr>'}</tbody></table>
    </div>\`;
}
</script>`);
}

// ── Storage Slot Calculator ───────────────────────────────────────────────────

export function openStorageCalculator(context: vscode.ExtensionContext): void {
	const panel = vscode.window.createWebviewPanel(
		'kairuStorageCalc',
		'Kairu · Storage Slot Calculator',
		vscode.ViewColumn.Beside,
		{ enableScripts: true, retainContextWhenHidden: true }
	);
	panel.webview.html = storageCalcHtml();

	panel.webview.onDidReceiveMessage(msg => {
		if (msg.type === 'compute') {
			const slot = computeStorageSlot(msg.index, msg.mappingKey, msg.mappingKeyType);
			panel.webview.postMessage({ type: 'result', slot });
		}
		if (msg.type === 'copy') {
			vscode.env.clipboard.writeText(msg.text);
		}
	}, undefined, context.subscriptions);
}

function storageCalcHtml(): string {
	return baseHtml('Storage Slot Calculator', `
<h1>⬡ Storage Slot Calculator</h1>
<p style="color:var(--muted);font-size:12px;margin-bottom:16px">Compute the EVM storage slot for state variables and mapping keys.</p>

<label>Variable / slot index:</label>
<input type="number" id="slotIndex" value="0" min="0">

<div class="gap">
  <label>Mapping key (optional — leave blank for plain slot):</label>
  <input type="text" id="mappingKey" placeholder="0xAddress or uint256 value">
  <div class="gap">
    <label>Mapping key type:</label>
    <select id="mappingKeyType">
      <option value="address">address</option>
      <option value="uint256">uint256</option>
      <option value="bytes32">bytes32</option>
    </select>
  </div>
</div>

<button onclick="compute()">Compute Slot</button>

<div id="output"></div>

<div class="card" style="margin-top:24px">
  <h2 style="margin-top:0">How slots work</h2>
  <div class="mono" style="line-height:1.8">
    Plain var at index N:  slot = N (padded to 32 bytes)<br>
    mapping[key] at index N:  slot = keccak256(key ‖ N)<br>
    Dynamic array at N:  base = N, element i: keccak256(N) + i<br>
    Packed structs:  multiple vars share one slot
  </div>
</div>

<script>
const vscode = acquireVsCodeApi();
window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'result') { renderSlot(msg.slot); }
});
function compute() {
  vscode.postMessage({
    type: 'compute',
    index: Number(document.getElementById('slotIndex').value),
    mappingKey: document.getElementById('mappingKey').value.trim(),
    mappingKeyType: document.getElementById('mappingKeyType').value,
  });
}
function copy(text) { vscode.postMessage({ type: 'copy', text }); }
function renderSlot(slot) {
  const decimal = BigInt(slot).toString();
  document.getElementById('output').innerHTML = \`
    <div class="card">
      <h2 style="margin-top:0">Result</h2>
      <div style="margin-bottom:8px">
        <label>Hex slot:</label>
        <div class="mono"><span class="selector">\${slot}</span><button class="copy-btn" onclick="copy('\${slot}')">copy</button></div>
      </div>
      <div>
        <label>Decimal:</label>
        <div class="mono">\${decimal}<button class="copy-btn" onclick="copy('\${decimal}')">copy</button></div>
      </div>
    </div>\`;
}
</script>`);
}

// ── Contract Metadata ─────────────────────────────────────────────────────────

export function openContractMetadata(context: vscode.ExtensionContext, text?: string): void {
	const panel = vscode.window.createWebviewPanel(
		'kairuContractMeta',
		'Kairu · Contract Metadata',
		vscode.ViewColumn.Beside,
		{ enableScripts: true, retainContextWhenHidden: true }
	);
	panel.webview.html = contractMetaHtml(text || '');

	panel.webview.onDidReceiveMessage(msg => {
		if (msg.type === 'parse') {
			const result = extractMetadata(msg.text);
			panel.webview.postMessage({ type: 'result', ...result });
		}
		if (msg.type === 'copy') {
			vscode.env.clipboard.writeText(msg.text);
		}
	}, undefined, context.subscriptions);
}

interface MetadataResult {
	contractName?: string;
	compilerVersion?: string;
	optimization?: boolean;
	optimizationRuns?: number;
	evmVersion?: string;
	bytecodeSize?: number;
	deployedBytecodeSize?: number;
	abiCount?: { fns: number; events: number; errors: number };
	foundryTomlFields?: Record<string, string>;
	warnings: string[];
}

function extractMetadata(text: string): MetadataResult {
	const warnings: string[] = [];
	try {
		const obj = JSON.parse(text);

		// Foundry/Hardhat compiled artifact
		if (obj.abi || obj.bytecode) {
			const abi: AbiItem[] = Array.isArray(obj.abi) ? obj.abi : [];
			const fns = abi.filter(i => i.type === 'function').length;
			const events = abi.filter(i => i.type === 'event').length;
			const errors = abi.filter(i => i.type === 'error').length;
			const bc = (typeof obj.bytecode === 'string' ? obj.bytecode : obj.bytecode?.object || '') as string;
			const dbc = (typeof obj.deployedBytecode === 'string' ? obj.deployedBytecode : obj.deployedBytecode?.object || '') as string;

			const meta = obj.metadata ? (typeof obj.metadata === 'string' ? JSON.parse(obj.metadata) : obj.metadata) : null;
			const compilerVersion = meta?.compiler?.version || obj.compiler?.version;
			const optimizationRuns = meta?.settings?.optimizer?.runs;
			const optimization = meta?.settings?.optimizer?.enabled;
			const evmVersion = meta?.settings?.evmVersion;

			if (bc && bc.replace('0x', '').length > 24000 * 2) {
				warnings.push('Bytecode exceeds 24KB — may hit EIP-170 contract size limit on deployment.');
			}

			return {
				contractName: obj.contractName || obj.name,
				compilerVersion,
				optimization,
				optimizationRuns,
				evmVersion,
				bytecodeSize: bc ? Math.floor(bc.replace(/^0x/, '').length / 2) : undefined,
				deployedBytecodeSize: dbc ? Math.floor(dbc.replace(/^0x/, '').length / 2) : undefined,
				abiCount: { fns, events, errors },
				warnings,
			};
		}

		// Raw metadata.json (solc output)
		if (obj.compiler?.version || obj.settings) {
			return {
				compilerVersion: obj.compiler?.version,
				optimization: obj.settings?.optimizer?.enabled,
				optimizationRuns: obj.settings?.optimizer?.runs,
				evmVersion: obj.settings?.evmVersion,
				warnings,
			};
		}

		warnings.push('Unrecognized format — expected a Hardhat/Foundry artifact or solc metadata.json.');
		return { warnings };
	} catch {
		// Try TOML-like foundry.toml parsing (basic key=value)
		const fields = parseFoundryToml(text);
		if (Object.keys(fields).length > 0) {
			return { foundryTomlFields: fields, warnings: validateFoundryToml(fields) };
		}
		return { warnings: ['Could not parse input as JSON or foundry.toml.'] };
	}
}

function parseFoundryToml(text: string): Record<string, string> {
	const result: Record<string, string> = {};
	const lines = text.split('\n');
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) { continue; }
		const eq = trimmed.indexOf('=');
		if (eq === -1) { continue; }
		const key = trimmed.slice(0, eq).trim();
		const val = trimmed.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
		result[key] = val;
	}
	return result;
}

function validateFoundryToml(fields: Record<string, string>): string[] {
	const warnings: string[] = [];
	if (fields['solc_version'] && !fields['solc_version'].match(/^\d+\.\d+\.\d+$/)) {
		warnings.push('solc_version format looks incorrect — expected semver like 0.8.24.');
	}
	if (fields['via_ir'] === 'true' && !fields['optimizer']) {
		warnings.push('via_ir is enabled — optimizer is recommended when using via_ir for reliable output.');
	}
	if (!fields['src'] && !fields['out']) {
		warnings.push('foundry.toml is missing src/out paths — may be incomplete.');
	}
	return warnings;
}

function contractMetaHtml(initial: string): string {
	const escaped = initial.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
	return baseHtml('Contract Metadata', `
<h1>⬡ Contract Metadata</h1>
<label>Paste Hardhat/Foundry artifact JSON, solc metadata.json, or foundry.toml:</label>
<textarea id="input" rows="8" placeholder='{"contractName":"MyToken","abi":[...],"bytecode":...}'>${initial ? escaped : ''}</textarea>
<button onclick="parse()">Parse</button>
<div id="output"></div>
<script>
const vscode = acquireVsCodeApi();
window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'result') { renderMeta(msg); }
});
function parse() {
  vscode.postMessage({ type: 'parse', text: document.getElementById('input').value });
}
function copy(text) { vscode.postMessage({ type: 'copy', text }); }
function row(label, value, extra) {
  if (value === undefined || value === null) return '';
  return '<tr><td style="color:var(--muted);width:160px">' + label + '</td><td class="mono">' + value + (extra || '') + '</td></tr>';
}
function renderMeta(m) {
  let html = '';
  const warnings = m.warnings || [];

  if (m.foundryTomlFields) {
    html += '<h2>foundry.toml Settings</h2><div class="card" style="padding:0"><table><tbody>';
    for (const [k, v] of Object.entries(m.foundryTomlFields)) {
      html += row(k, v);
    }
    html += '</tbody></table></div>';
  } else {
    html += '<div class="card" style="padding:0"><table><tbody>';
    html += row('Contract', m.contractName || '—');
    html += row('Compiler', m.compilerVersion || '—');
    html += row('Optimization', m.optimization === undefined ? '—' : (m.optimization ? 'enabled' : 'disabled'));
    if (m.optimizationRuns !== undefined) html += row('Optimizer runs', m.optimizationRuns);
    html += row('EVM target', m.evmVersion || '—');
    if (m.bytecodeSize !== undefined) {
      const pct = Math.round(m.bytecodeSize / 24576 * 100);
      html += row('Bytecode size', m.bytecodeSize + ' bytes (' + pct + '% of 24KB limit)');
    }
    if (m.deployedBytecodeSize !== undefined) {
      const pct = Math.round(m.deployedBytecodeSize / 24576 * 100);
      html += row('Deployed size', m.deployedBytecodeSize + ' bytes (' + pct + '% of limit)');
    }
    if (m.abiCount) {
      html += row('Functions', m.abiCount.fns);
      html += row('Events', m.abiCount.events);
      html += row('Errors', m.abiCount.errors);
    }
    html += '</tbody></table></div>';
  }

  if (warnings.length) {
    html += '<h2>Warnings</h2>';
    warnings.forEach(w => { html += '<p class="err">⚠ ' + w + '</p>'; });
  }

  document.getElementById('output').innerHTML = html || '<p class="empty">No metadata extracted.</p>';
}
if (document.getElementById('input').value.trim()) { parse(); }
</script>`);
}
