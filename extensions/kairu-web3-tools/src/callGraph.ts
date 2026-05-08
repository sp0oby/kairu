/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { parseAbi } from './abi';

export interface GraphNode {
	id: string;
	kind: string;
	functions: string[];
	inherits: string[];
}

const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';`;

export function openCallGraph(context: vscode.ExtensionContext): void {
	const panel = vscode.window.createWebviewPanel(
		'kairuCallGraph',
		'Kairu · Contract Call Graph',
		vscode.ViewColumn.Beside,
		{ enableScripts: true, retainContextWhenHidden: true }
	);

	panel.webview.html = callGraphHtml([]);

	panel.webview.onDidReceiveMessage(msg => {
		if (msg.type === 'parse') {
			const nodes = parseContractGraph(msg.text);
			if (!nodes) {
				panel.webview.postMessage({ type: 'error', text: 'Could not parse contracts. Paste Solidity source or a Foundry artifact JSON.' });
			} else {
				panel.webview.postMessage({ type: 'graph', nodes });
			}
		}
		if (msg.type === 'copy') {
			vscode.env.clipboard.writeText(msg.text);
		}
	}, undefined, context.subscriptions);
}

function parseContractGraph(text: string): GraphNode[] | null {
	// Try JSON artifact first
	const abi = parseAbi(text);
	if (abi) {
		const fns = abi
			.filter(i => i.type === 'function' && i.name)
			.map(i => `${i.name}(${(i.inputs || []).map(x => x.type).join(',')})`);
		return [{ id: 'Contract', kind: 'contract', functions: fns, inherits: [] }];
	}

	// Parse Solidity source
	const nodes: GraphNode[] = [];
	const contractRe = /\b(abstract\s+contract|contract|interface|library)\s+(\w+)([^{]*)\{/g;
	let m: RegExpExecArray | null;

	while ((m = contractRe.exec(text)) !== null) {
		const kind = m[1].startsWith('abstract') ? 'abstract' : m[1].trim() as GraphNode['kind'];
		const name = m[2];
		const header = m[3];

		const inherits: string[] = [];
		const isMatch = header.match(/is\s+(.+)/);
		if (isMatch) {
			inherits.push(...isMatch[1].split(',').map(s => s.trim().split('(')[0].trim()).filter(Boolean));
		}

		const fnRe = /\bfunction\s+(\w+)\s*\(([^)]*)\)/g;
		const functions: string[] = [];
		let fm: RegExpExecArray | null;
		const bodyStart = m.index + m[0].length;
		// Crude body slice — find up to next top-level contract keyword
		const nextContract = contractRe.lastIndex;
		const bodySlice = text.slice(bodyStart, nextContract > 0 ? nextContract : bodyStart + 10000);
		while ((fm = fnRe.exec(bodySlice)) !== null) {
			functions.push(`${fm[1]}(${fm[2].split(',').map(p => p.trim().split(/\s+/)[0]).join(',')})`);
		}

		nodes.push({ id: name, kind, functions, inherits });
	}

	return nodes.length > 0 ? nodes : null;
}

function callGraphHtml(_initialNodes: GraphNode[]): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>Call Graph</title>
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
    --muted: #5a5d63;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family, monospace); font-size: 13px; background: var(--bg); color: var(--fg); padding: 16px; }
  h1 { font-size: 15px; font-weight: 600; color: var(--accent); margin-bottom: 16px; }
  textarea { width: 100%; padding: 8px; background: var(--input-bg); color: var(--fg); border: 1px solid var(--input-border); border-radius: 6px; font-family: inherit; font-size: 12px; resize: vertical; outline: none; }
  textarea:focus { border-color: var(--accent); }
  button { padding: 7px 14px; border: none; border-radius: 6px; background: var(--accent); color: #0e0e10; font-size: 12px; font-weight: 600; cursor: pointer; margin-top: 8px; }
  button:hover { opacity: 0.85; }
  label { font-size: 11px; color: var(--muted); display: block; margin-bottom: 4px; }
  #canvas-wrap { margin-top: 16px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; min-height: 200px; position: relative; }
  svg { width: 100%; min-height: 200px; }
  .node-rect { fill: var(--input-bg); stroke: var(--accent); stroke-width: 1.5; rx: 6; ry: 6; }
  .node-rect.interface { stroke: var(--purple); }
  .node-rect.library { stroke: var(--green); }
  .node-rect.abstract { stroke: var(--orange); }
  .node-label { fill: var(--fg); font-size: 12px; font-weight: 700; font-family: monospace; }
  .node-kind { fill: var(--muted); font-size: 10px; font-family: monospace; }
  .fn-label { fill: var(--muted); font-size: 10px; font-family: monospace; }
  .edge { stroke: var(--muted); stroke-width: 1; fill: none; stroke-dasharray: 4,2; marker-end: url(#arrow); }
  .err { color: var(--orange); margin-top: 8px; font-size: 12px; }
  .empty { color: var(--muted); font-size: 12px; text-align: center; padding: 24px; }
</style>
</head>
<body>
<h1>⬡ Contract Call Graph</h1>
<label>Paste Solidity source or Foundry artifact JSON:</label>
<textarea id="src" rows="6" placeholder="// SPDX-License-Identifier: MIT&#10;pragma solidity ^0.8.24;&#10;&#10;contract MyToken is ERC20 {&#10;  ...&#10;}"></textarea>
<button onclick="parse()">Parse Graph</button>
<div id="err"></div>
<div id="canvas-wrap">
  <svg id="graph"></svg>
</div>
<script>
const vscode = acquireVsCodeApi();
window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'error') { document.getElementById('err').innerHTML = '<p class="err">✖ ' + msg.text + '</p>'; }
  if (msg.type === 'graph') { renderGraph(msg.nodes); }
});
function parse() {
  document.getElementById('err').innerHTML = '';
  vscode.postMessage({ type: 'parse', text: document.getElementById('src').value });
}

function renderGraph(nodes) {
  const svg = document.getElementById('graph');
  svg.innerHTML = '';

  if (!nodes || nodes.length === 0) {
    svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" class="empty">No contracts found.</text>';
    return;
  }

  // Layout: simple grid
  const NODE_W = 200;
  const NODE_PAD = 16;
  const COLS = Math.min(3, nodes.length);
  const HEADER_H = 36;
  const FN_H = 14;

  const positioned = nodes.map((node, i) => {
    const fnCount = Math.min(node.functions.length, 8);
    const h = HEADER_H + fnCount * FN_H + NODE_PAD;
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = col * (NODE_W + 24) + 12;
    const y = row * 200 + 12;
    return { ...node, x, y, w: NODE_W, h };
  });

  const positions = {};
  positioned.forEach(n => { positions[n.id] = n; });

  // SVG defs
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = '<marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#5a5d63"/></marker>';
  svg.appendChild(defs);

  const totalW = COLS * (NODE_W + 24) + 24;
  const totalH = Math.ceil(nodes.length / COLS) * 200 + 24;
  svg.setAttribute('viewBox', '0 0 ' + totalW + ' ' + totalH);
  svg.style.minHeight = totalH + 'px';

  // Draw edges (inheritance)
  positioned.forEach(node => {
    node.inherits.forEach(parentName => {
      const parent = positions[parentName];
      if (!parent) return;
      const x1 = node.x + node.w / 2;
      const y1 = node.y;
      const x2 = parent.x + parent.w / 2;
      const y2 = parent.y + parent.h;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const my = (y1 + y2) / 2;
      path.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + my + ' ' + x2 + ',' + my + ' ' + x2 + ',' + y2);
      path.setAttribute('class', 'edge');
      svg.appendChild(path);
    });
  });

  // Draw nodes
  positioned.forEach(node => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', node.x);
    rect.setAttribute('y', node.y);
    rect.setAttribute('width', node.w);
    rect.setAttribute('height', node.h);
    rect.setAttribute('class', 'node-rect ' + node.kind);
    rect.setAttribute('rx', '6');
    g.appendChild(rect);

    const kindColors = { contract: '#82aaff', interface: '#c792ea', library: '#a8d89b', abstract: '#f78c6c' };
    const kindLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    kindLabel.setAttribute('x', node.x + 8);
    kindLabel.setAttribute('y', node.y + 14);
    kindLabel.setAttribute('class', 'node-kind');
    kindLabel.setAttribute('fill', kindColors[node.kind] || '#82aaff');
    kindLabel.textContent = node.kind;
    g.appendChild(kindLabel);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', node.x + 8);
    label.setAttribute('y', node.y + 28);
    label.setAttribute('class', 'node-label');
    label.textContent = node.id;
    g.appendChild(label);

    const maxFns = Math.min(node.functions.length, 8);
    for (let i = 0; i < maxFns; i++) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', node.x + 8);
      t.setAttribute('y', node.y + HEADER_H + i * FN_H + 4);
      t.setAttribute('class', 'fn-label');
      const fn = node.functions[i];
      t.textContent = '  ' + (fn.length > 26 ? fn.slice(0, 24) + '…' : fn);
      g.appendChild(t);
    }
    if (node.functions.length > 8) {
      const more = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      more.setAttribute('x', node.x + 8);
      more.setAttribute('y', node.y + HEADER_H + 8 * FN_H + 4);
      more.setAttribute('class', 'fn-label');
      more.textContent = '  +' + (node.functions.length - 8) + ' more';
      g.appendChild(more);
    }

    svg.appendChild(g);
  });
}
</script>
</body>
</html>`;
}
