/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';`;

interface StateVar {
	name: string;
	type: string;
	visibility: string;
	isConstant: boolean;
	isImmutable: boolean;
	sizeBytes: number;
}

interface SlotEntry {
	slot: number;
	offset: number;
	size: number;
	vars: StateVar[];
	notes?: string;
}

// Solidity type → byte size (for packing logic). Returns 32 for "takes whole slot" types.
function typeSize(type: string): number {
	const t = type.trim();
	if (t === 'bool') { return 1; }
	if (t === 'address' || t === 'address payable') { return 20; }
	if (t.startsWith('uint') || t.startsWith('int')) {
		const bits = parseInt(t.replace(/^[ui]nt/, '')) || 256;
		return Math.ceil(bits / 8);
	}
	if (t.startsWith('bytes')) {
		const n = parseInt(t.replace('bytes', ''));
		if (!isNaN(n) && n >= 1 && n <= 32) { return n; }
		// dynamic bytes/string → takes a whole slot (length pointer)
		return 32;
	}
	if (t.startsWith('mapping') || t.startsWith('struct')) { return 32; }
	if (t.endsWith(']')) { return 32; }
	if (t === 'string' || t === 'bytes') { return 32; }
	// User-defined types (contract names, enums) — assume reference type, 1 word
	// Enums in practice fit in 1 byte but we can't tell from the regex alone
	return 32;
}

export function computeStorageLayout(stateVars: StateVar[]): SlotEntry[] {
	// Filter out constants/immutables — they don't occupy slots
	const slottedVars = stateVars.filter(v => !v.isConstant && !v.isImmutable);

	const slots: SlotEntry[] = [];
	let currentSlot = 0;
	let currentOffset = 0;

	for (const v of slottedVars) {
		const size = v.sizeBytes;

		// Big types (32 bytes) start a fresh slot if current slot has anything
		if (size === 32) {
			if (currentOffset > 0) {
				currentSlot++;
				currentOffset = 0;
			}
			slots.push({ slot: currentSlot, offset: 0, size: 32, vars: [v] });
			currentSlot++;
			currentOffset = 0;
			continue;
		}

		// Try to pack into current slot
		if (currentOffset + size > 32) {
			currentSlot++;
			currentOffset = 0;
		}

		// Find or create slot entry
		let entry = slots.find(s => s.slot === currentSlot);
		if (!entry) {
			entry = { slot: currentSlot, offset: 0, size: 0, vars: [] };
			slots.push(entry);
		}
		entry.vars.push({ ...v, sizeBytes: size });
		entry.size = currentOffset + size;
		currentOffset += size;
	}

	return slots;
}

interface ParsedContract {
	name: string;
	stateVars: StateVar[];
}

function parseContractStateVars(source: string): ParsedContract[] {
	// Strip comments first
	const stripped = source
		.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
		.replace(/\/\/.*$/gm, '');

	const results: ParsedContract[] = [];
	const contractRe = /\b(?:abstract\s+)?(?:contract|library)\s+(\w+)[^{]*\{/g;
	let cm: RegExpExecArray | null;

	while ((cm = contractRe.exec(stripped)) !== null) {
		const contractName = cm[1];
		const start = cm.index + cm[0].length;
		// Find matching }
		let depth = 1;
		let end = start;
		for (; end < stripped.length && depth > 0; end++) {
			if (stripped[end] === '{') { depth++; }
			else if (stripped[end] === '}') { depth--; }
		}
		const body = stripped.slice(start, end - 1);

		const stateVars = extractStateVarsForLayout(body);
		results.push({ name: contractName, stateVars });
	}

	return results;
}

function extractStateVarsForLayout(body: string): StateVar[] {
	const vars: StateVar[] = [];
	// Match state variable declarations at the contract scope (not inside functions)
	// We approximate "contract scope" by skipping content between { and matching }
	let depth = 0;
	let buf = '';
	const segments: string[] = [];
	for (let i = 0; i < body.length; i++) {
		const c = body[i];
		if (c === '{') {
			if (depth === 0) {
				if (buf.trim()) { segments.push(buf); }
				buf = '';
			}
			depth++;
			continue;
		}
		if (c === '}') {
			depth--;
			continue;
		}
		if (depth === 0) {
			buf += c;
		}
	}
	if (buf.trim()) { segments.push(buf); }

	const text = segments.join(';');
	// Match: type [visibility] [constant|immutable] name [= ...];
	const re = /(?:^|;)\s*((?:mapping\s*\([^)]+\)|address(?:\s+payable)?|bytes\d*|uint\d*|int\d*|bool|string|bytes|[A-Z]\w*)(?:\[\s*\d*\s*\])*)\s+(public|private|internal|external\b)?\s*(constant|immutable)?\s*(\w+)\s*(?:=|;)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		const type = m[1].trim();
		const visibility = (m[2] || 'internal').trim();
		const modifier = (m[3] || '').trim();
		const name = m[4];

		// Skip reserved words / keywords that look like names
		if (['if', 'for', 'while', 'return', 'require', 'revert', 'emit', 'new', 'delete', 'function', 'modifier', 'event', 'error', 'using', 'pragma', 'import', 'struct', 'enum'].includes(name)) {
			continue;
		}

		vars.push({
			name,
			type,
			visibility,
			isConstant: modifier === 'constant',
			isImmutable: modifier === 'immutable',
			sizeBytes: typeSize(type),
		});
	}
	return vars;
}

export function openStorageLayoutPanel(context: vscode.ExtensionContext, initialSource?: string): void {
	const panel = vscode.window.createWebviewPanel(
		'kairuStorageLayout',
		'Kairu · Storage Layout',
		vscode.ViewColumn.Beside,
		{ enableScripts: true, retainContextWhenHidden: true }
	);

	panel.webview.html = storageLayoutHtml(initialSource || '');

	panel.webview.onDidReceiveMessage(msg => {
		if (msg.type === 'parse') {
			const contracts = parseContractStateVars(msg.text);
			if (contracts.length === 0) {
				panel.webview.postMessage({ type: 'error', text: 'No contracts found. Paste Solidity source with at least one contract or library.' });
				return;
			}
			const result = contracts.map(c => ({
				name: c.name,
				slots: computeStorageLayout(c.stateVars),
				stateVars: c.stateVars,
			}));
			panel.webview.postMessage({ type: 'result', contracts: result });
		}
		if (msg.type === 'copy') {
			vscode.env.clipboard.writeText(msg.text);
		}
	}, undefined, context.subscriptions);
}

function storageLayoutHtml(initial: string): string {
	const escaped = initial.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>Storage Layout</title>
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
body { font-family: var(--vscode-font-family, monospace); font-size: 13px; background: var(--bg); color: var(--fg); padding: 16px; line-height: 1.5; }
h1 { font-size: 15px; font-weight: 600; color: var(--accent); margin-bottom: 16px; }
h2 { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin: 18px 0 8px; }
textarea { width: 100%; padding: 8px; background: var(--input-bg); color: var(--fg); border: 1px solid var(--input-border); border-radius: 6px; font-family: inherit; font-size: 12px; resize: vertical; outline: none; }
textarea:focus { border-color: var(--accent); }
button { padding: 7px 14px; border: none; border-radius: 6px; background: var(--accent); color: #0e0e10; font-size: 12px; font-weight: 600; cursor: pointer; margin-top: 8px; }
button:hover { opacity: 0.85; }
label { font-size: 11px; color: var(--muted); display: block; margin-bottom: 4px; }
.card { background: var(--input-bg); border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin-bottom: 14px; }
.contract-name { color: var(--accent); font-weight: 700; margin-bottom: 4px; }
.slot {
  display: grid; grid-template-columns: 60px 1fr; gap: 12px;
  padding: 8px 0; border-top: 1px dashed var(--border);
}
.slot:first-of-type { border-top: none; }
.slot-num { font-family: inherit; font-size: 11px; color: var(--muted); padding-top: 2px; }
.slot-num b { color: var(--gold); display: block; font-size: 13px; }
.bar-row { display: flex; flex-direction: column; gap: 4px; }
.byte-bar {
  display: flex; height: 20px; border-radius: 3px; overflow: hidden;
  background: rgba(255,255,255,0.04); border: 1px solid var(--border);
}
.byte-cell {
  font-size: 9px; color: #0e0e10; padding: 0 4px;
  display: flex; align-items: center; justify-content: center;
  font-weight: 600; overflow: hidden; white-space: nowrap;
}
.byte-empty { background: transparent; color: var(--muted); }
.var-list { display: flex; flex-direction: column; gap: 2px; font-size: 11px; }
.var-list b { color: var(--fg); }
.var-list .vis { color: var(--purple); font-size: 10px; }
.var-list .ty { color: var(--gold); }
.var-list .sz { color: var(--muted); font-size: 10px; }
.constants {
  margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border);
  font-size: 11px; color: var(--muted);
}
.constants .item { padding: 2px 0; }
.constants b { color: var(--fg); }
.legend { display: flex; gap: 12px; flex-wrap: wrap; font-size: 10px; color: var(--muted); margin-top: 6px; }
.legend-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
.err { color: var(--orange); padding: 12px; }
.empty { color: var(--muted); text-align: center; padding: 24px; font-size: 12px; }
.tip {
  background: rgba(130, 170, 255, 0.06); border: 1px solid rgba(130, 170, 255, 0.2);
  border-radius: 6px; padding: 10px; font-size: 11px; margin-top: 14px; color: var(--muted);
}
.tip b { color: var(--accent); }
.warn-pack { color: var(--gold); font-size: 11px; margin-top: 6px; }
</style>
</head>
<body>
<h1>⬡ Storage Layout</h1>
<label>Paste Solidity source:</label>
<textarea id="src" rows="6" placeholder="// SPDX-License-Identifier: MIT&#10;pragma solidity ^0.8.24;&#10;&#10;contract Token { ... }">${initial ? escaped : ''}</textarea>
<button onclick="parse()">Compute Layout</button>
<div id="output"></div>

<div class="tip" style="margin-top:24px">
  <b>How EVM storage works:</b>
  Each storage slot is 32 bytes (256 bits). Solidity packs multiple state variables into the same slot when they fit (right-to-left). Constants and immutables don't take slots. <code>mapping</code>, <code>string</code>, <code>bytes</code>, and dynamic arrays each take a full slot. Inheritance order matters — parent contract slots come first.
</div>

<script>
const vscode = acquireVsCodeApi();

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'error') { document.getElementById('output').innerHTML = '<p class="err">✖ ' + msg.text + '</p>'; }
  if (msg.type === 'result') { renderLayout(msg.contracts); }
});

function parse() {
  vscode.postMessage({ type: 'parse', text: document.getElementById('src').value });
}

function copy(text) { vscode.postMessage({ type: 'copy', text }); }

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

const COLORS = ['#82aaff', '#a8d89b', '#c792ea', '#ffcb6b', '#f78c6c'];

function renderLayout(contracts) {
  const out = [];
  for (const c of contracts) {
    out.push('<div class="card"><div class="contract-name">' + escHtml(c.name) + '</div>');

    if (c.slots.length === 0) {
      const constants = c.stateVars.filter(v => v.isConstant || v.isImmutable);
      if (constants.length === 0) {
        out.push('<p class="empty">No state variables.</p>');
      }
    } else {
      for (const slot of c.slots) {
        const cells = [];
        let used = 0;
        for (let i = 0; i < slot.vars.length; i++) {
          const v = slot.vars[i];
          const widthPct = (v.sizeBytes / 32) * 100;
          const color = COLORS[i % COLORS.length];
          const label = v.name + ' (' + v.sizeBytes + 'B)';
          cells.push('<div class="byte-cell" style="background:' + color + ';width:' + widthPct + '%;" title="' + escHtml(v.type) + ' ' + escHtml(v.name) + ' — ' + v.sizeBytes + ' bytes">' + escHtml(label) + '</div>');
          used += v.sizeBytes;
        }
        if (used < 32) {
          const pct = ((32 - used) / 32) * 100;
          cells.push('<div class="byte-cell byte-empty" style="width:' + pct + '%;">' + (32 - used) + 'B free</div>');
        }
        const slotHex = '0x' + slot.slot.toString(16).padStart(2, '0');
        const varDescriptions = slot.vars.map(v =>
          '<div><b>' + escHtml(v.name) + '</b> ' +
          '<span class="vis">' + escHtml(v.visibility) + '</span> ' +
          '<span class="ty">' + escHtml(v.type) + '</span> ' +
          '<span class="sz">offset ' + (v.offset || 0) + ', ' + v.sizeBytes + ' bytes</span>' +
          '<button class="byte-cell" onclick="copy(\\'' + slotHex + '\\')" style="margin-left:6px;background:transparent;color:var(--muted);border:1px solid var(--border);padding:1px 6px;font-weight:normal;">copy slot</button>' +
          '</div>'
        ).join('');
        const packWarn = slot.vars.length > 1
          ? '<div class="warn-pack">⚡ ' + slot.vars.length + ' vars packed in this slot — be careful when reordering or upgrading.</div>'
          : '';
        out.push(
          '<div class="slot">' +
            '<div class="slot-num">slot<br><b>' + slot.slot + '</b><br>' + slotHex + '</div>' +
            '<div class="bar-row"><div class="byte-bar">' + cells.join('') + '</div>' +
            '<div class="var-list">' + varDescriptions + '</div>' + packWarn + '</div>' +
          '</div>'
        );
      }
    }

    const constants = c.stateVars.filter(v => v.isConstant || v.isImmutable);
    if (constants.length > 0) {
      out.push('<div class="constants"><b>Constants &amp; immutables (no storage cost):</b>');
      for (const v of constants) {
        out.push('<div class="item">' + (v.isConstant ? 'constant' : 'immutable') + ' ' + escHtml(v.type) + ' <b>' + escHtml(v.name) + '</b></div>');
      }
      out.push('</div>');
    }

    out.push('</div>'); // card
  }
  document.getElementById('output').innerHTML = out.join('');
}

if (document.getElementById('src').value.trim()) { parse(); }
</script>
</body>
</html>`;
}
