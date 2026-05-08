/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { getWorkspaceRoot } from '../foundry';

const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';`;

export interface TraceCall {
	depth: number;
	type: 'call' | 'staticcall' | 'delegatecall' | 'create' | 'create2' | 'return' | 'revert' | 'log' | 'unknown';
	target?: string;
	function?: string;
	value?: string;
	gasUsed?: number;
	output?: string;
	revertReason?: string;
	raw: string;
}

// Parse forge test verbose trace output (text-based, indented).
// forge outputs traces like:
//   [PASS] testName() (gas: 12345)
//   Traces:
//     [123] MyContract::testName()
//       ├─ [456] OtherContract::doThing(arg1, arg2)
//       │   └─ ← (returndata)
//       └─ ← (success)
export function parseTextTrace(output: string): TraceCall[] {
	const lines = output.split('\n');
	const calls: TraceCall[] = [];
	let inTrace = false;

	for (const rawLine of lines) {
		// Detect trace section start
		if (/^\s*Traces:\s*$/.test(rawLine)) {
			inTrace = true;
			continue;
		}

		// Detect trace section end (next test, summary, etc.)
		if (inTrace && /^(Test result|Suite result|Ran \d+|Logs:|\[PASS\]|\[FAIL\]|Failing tests:)/.test(rawLine.trim())) {
			inTrace = false;
			continue;
		}

		if (!inTrace) { continue; }

		// Count tree-drawing chars to determine depth
		const treeMatch = rawLine.match(/^\s*((?:[│├└─\s]+)?)/);
		const depth = treeMatch ? Math.floor((treeMatch[0].length) / 4) : 0;

		const line = rawLine.trim()
			.replace(/^[│├└─\s]+/, '');

		if (!line) { continue; }

		// Match: [gas] Contract::function(args)
		const callMatch = line.match(/^\[(\d+)\]\s+(\S+?)::(\S+?)\(([^)]*)\)/);
		if (callMatch) {
			calls.push({
				depth,
				type: 'call',
				gasUsed: parseInt(callMatch[1]),
				target: callMatch[2],
				function: `${callMatch[3]}(${callMatch[4]})`,
				raw: rawLine,
			});
			continue;
		}

		// Match: ← (output) or ← Revert: reason
		const returnMatch = line.match(/^←\s*(.*)/);
		if (returnMatch) {
			const content = returnMatch[1];
			if (content.includes('Revert') || content.toLowerCase().includes('revert')) {
				calls.push({
					depth, type: 'revert', revertReason: content.replace(/Revert:?\s*/, ''),
					raw: rawLine,
				});
			} else {
				calls.push({ depth, type: 'return', output: content, raw: rawLine });
			}
			continue;
		}

		// Match: emit Event(...)
		const emitMatch = line.match(/^emit\s+(\w+)\((.*)\)/);
		if (emitMatch) {
			calls.push({
				depth, type: 'log',
				function: `${emitMatch[1]}(${emitMatch[2]})`,
				raw: rawLine,
			});
			continue;
		}

		// Match: → new ContractName@0xaddr
		if (line.match(/→\s*new\s+(\w+)/)) {
			const m = line.match(/→\s*new\s+(\w+)/);
			calls.push({
				depth, type: 'create',
				target: m![1],
				raw: rawLine,
			});
			continue;
		}

		// Other tracelines we don't recognize — keep as raw
		if (line.length > 0) {
			calls.push({ depth, type: 'unknown', raw: rawLine });
		}
	}

	return calls;
}

async function runForgeTest(cwd: string, filter: string | undefined, onProgress: (line: string) => void): Promise<string> {
	return new Promise((resolve, reject) => {
		const args = ['test', '-vvvv'];
		if (filter) { args.push('--match-test', filter); }
		const child = spawn('forge', args, { cwd, shell: false });
		let buf = '';
		child.stdout.on('data', (d: Buffer) => {
			const text = d.toString();
			buf += text;
			onProgress(text);
		});
		child.stderr.on('data', (d: Buffer) => {
			const text = d.toString();
			buf += text;
			onProgress(text);
		});
		child.on('close', () => resolve(buf));
		child.on('error', err => reject(err));
	});
}

export function openTracePanel(context: vscode.ExtensionContext): void {
	const panel = vscode.window.createWebviewPanel(
		'kairuTrace',
		'Kairu · Foundry Trace Viewer',
		vscode.ViewColumn.Beside,
		{ enableScripts: true, retainContextWhenHidden: true }
	);

	panel.webview.html = traceHtml();

	panel.webview.onDidReceiveMessage(async msg => {
		if (msg.type === 'run') {
			const cwd = getWorkspaceRoot();
			if (!cwd) {
				panel.webview.postMessage({ type: 'error', text: 'No workspace folder open.' });
				return;
			}
			panel.webview.postMessage({ type: 'running' });
			try {
				const output = await runForgeTest(cwd, msg.filter || undefined, line => {
					panel.webview.postMessage({ type: 'log', line });
				});
				const calls = parseTextTrace(output);
				panel.webview.postMessage({ type: 'result', calls, raw: output });
			} catch (err) {
				panel.webview.postMessage({ type: 'error', text: (err as Error).message });
			}
		}

		if (msg.type === 'parsePasted') {
			const calls = parseTextTrace(msg.text);
			panel.webview.postMessage({ type: 'result', calls, raw: msg.text });
		}

		if (msg.type === 'copy') {
			vscode.env.clipboard.writeText(msg.text);
		}

		if (msg.type === 'aiExplain') {
			const prompt = `Explain this Foundry test trace in plain English:

\`\`\`
${msg.text}
\`\`\`

Cover:
1. What does the call sequence do?
2. Where (if anywhere) did it revert and why?
3. Are there any suspicious calls (delegatecall, unexpected external calls, large value transfers)?
4. What's the gas hot-path?`;
			await vscode.env.clipboard.writeText(prompt);
			await vscode.commands.executeCommand('kairu.ai.openChat');
			vscode.window.showInformationMessage('Trace explanation prompt copied. Paste it in the Kairu AI chat.');
		}
	}, undefined, context.subscriptions);
}

function traceHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>Trace Viewer</title>
<style>
:root {
  --bg: var(--vscode-editor-background, #0e0e10);
  --fg: var(--vscode-editor-foreground, #cdd6f4);
  --border: var(--vscode-panel-border, #2a2a3a);
  --input-bg: var(--vscode-input-background, #1a1a2a);
  --accent: #82aaff;
  --green: #a8d89b;
  --purple: #c792ea;
  --red: #f78c6c;
  --gold: #ffcb6b;
  --muted: #5a5d63;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family, monospace); font-size: 13px; background: var(--bg); color: var(--fg); padding: 16px; line-height: 1.6; }
h1 { font-size: 15px; font-weight: 600; color: var(--accent); margin-bottom: 16px; }
h2 { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin: 14px 0 6px; }
input[type=text], textarea { width: 100%; padding: 7px 10px; background: var(--input-bg); color: var(--fg); border: 1px solid var(--border); border-radius: 6px; font-family: inherit; font-size: 12px; outline: none; resize: vertical; }
input:focus, textarea:focus { border-color: var(--accent); }
button { padding: 7px 14px; border: none; border-radius: 6px; background: var(--accent); color: #0e0e10; font-size: 12px; font-weight: 600; cursor: pointer; margin-right: 6px; }
button:hover { opacity: .85; }
.btn-ghost { background: transparent; color: var(--fg); border: 1px solid var(--border); }
.btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
label { font-size: 11px; color: var(--muted); }
.tree { font-family: inherit; font-size: 11px; line-height: 1.5; padding: 12px; background: var(--input-bg); border: 1px solid var(--border); border-radius: 6px; overflow: auto; max-height: 500px; }
.call { display: flex; gap: 6px; align-items: baseline; padding: 1px 0; }
.call:hover { background: rgba(255,255,255,0.02); }
.indent { color: var(--muted); white-space: pre; }
.tag { font-size: 9px; padding: 1px 5px; border-radius: 3px; font-weight: 700; flex-shrink: 0; }
.tag-call { background: #82aaff22; color: var(--accent); }
.tag-static { background: #a8d89b22; color: var(--green); }
.tag-delegate { background: #f78c6c22; color: var(--red); }
.tag-create { background: #c792ea22; color: var(--purple); }
.tag-return { background: #5a5d6322; color: var(--muted); }
.tag-revert { background: #f78c6c44; color: var(--red); }
.tag-log { background: #ffcb6b22; color: var(--gold); }
.target { color: var(--purple); font-weight: 600; }
.fn { color: var(--accent); }
.gas { color: var(--muted); font-size: 10px; }
.revert-reason { color: var(--red); }
.event-name { color: var(--gold); }
pre { background: #111; border-radius: 6px; padding: 10px; font-size: 10px; overflow: auto; color: var(--muted); max-height: 200px; }
.err { color: var(--red); padding: 8px 0; }
.empty { color: var(--muted); padding: 12px 0; }
</style>
</head>
<body>
<h1>⬡ Foundry Trace Viewer</h1>

<div class="row">
  <input type="text" id="filter" placeholder="--match-test filter (optional)" style="flex:1;min-width:200px">
  <button onclick="run()">Run forge test -vvvv</button>
</div>

<div class="row">
  <button class="btn-ghost" onclick="togglePaste()">Paste trace manually</button>
  <button class="btn-ghost" onclick="aiExplain()">◇ Ask AI to explain</button>
</div>

<div id="paste-area" style="display:none;margin-bottom:12px">
  <label>Paste trace output (from your terminal):</label>
  <textarea id="paste-text" rows="6"></textarea>
  <button style="margin-top:6px" onclick="parsePasted()">Parse</button>
</div>

<h2>Call Tree</h2>
<div id="tree" class="tree"><div class="empty">Run a test or paste a trace to see the call tree.</div></div>

<h2>Raw Output</h2>
<pre id="raw"></pre>

<script>
const vscode = acquireVsCodeApi();
let currentRaw = '';

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'running') { document.getElementById('tree').innerHTML = '<div class="empty">Running forge test -vvvv...</div>'; document.getElementById('raw').textContent = ''; }
  if (msg.type === 'log') { const el = document.getElementById('raw'); el.textContent += msg.line; el.scrollTop = el.scrollHeight; }
  if (msg.type === 'error') { document.getElementById('tree').innerHTML = '<p class="err">✖ ' + escHtml(msg.text) + '</p>'; }
  if (msg.type === 'result') { renderTree(msg.calls); currentRaw = msg.raw || ''; }
});

function run() {
  const filter = document.getElementById('filter').value.trim();
  vscode.postMessage({ type: 'run', filter });
}

function togglePaste() {
  const el = document.getElementById('paste-area');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function parsePasted() {
  const text = document.getElementById('paste-text').value;
  vscode.postMessage({ type: 'parsePasted', text });
}

function aiExplain() {
  if (!currentRaw) {
    vscode.postMessage({ type: 'parsePasted', text: '' });
    return;
  }
  vscode.postMessage({ type: 'aiExplain', text: currentRaw.slice(0, 8000) });
}

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function renderTree(calls) {
  if (!calls || calls.length === 0) {
    document.getElementById('tree').innerHTML = '<div class="empty">No trace data parsed. The output may not contain a Traces: section — make sure you ran with -vvvv.</div>';
    return;
  }
  const lines = [];
  for (const c of calls) {
    const indent = '│ '.repeat(c.depth);
    let body = '';
    if (c.type === 'call') {
      body = '<span class="tag tag-call">CALL</span><span class="target">' + escHtml(c.target || '') + '</span>::<span class="fn">' + escHtml(c.function || '') + '</span>';
      if (c.gasUsed !== undefined) { body += ' <span class="gas">gas: ' + c.gasUsed.toLocaleString() + '</span>'; }
    } else if (c.type === 'return') {
      body = '<span class="tag tag-return">RET</span><span class="gas">' + escHtml((c.output || '').slice(0, 80)) + '</span>';
    } else if (c.type === 'revert') {
      body = '<span class="tag tag-revert">REVERT</span><span class="revert-reason">' + escHtml(c.revertReason || '') + '</span>';
    } else if (c.type === 'log') {
      body = '<span class="tag tag-log">EMIT</span><span class="event-name">' + escHtml(c.function || '') + '</span>';
    } else if (c.type === 'create') {
      body = '<span class="tag tag-create">CREATE</span><span class="target">' + escHtml(c.target || '') + '</span>';
    } else if (c.type === 'staticcall') {
      body = '<span class="tag tag-static">STATIC</span><span class="target">' + escHtml(c.target || '') + '</span>::<span class="fn">' + escHtml(c.function || '') + '</span>';
    } else if (c.type === 'delegatecall') {
      body = '<span class="tag tag-delegate">DELEGATE</span><span class="target">' + escHtml(c.target || '') + '</span>::<span class="fn">' + escHtml(c.function || '') + '</span>';
    } else {
      body = '<span class="gas">' + escHtml(c.raw.trim().slice(0, 120)) + '</span>';
    }
    lines.push('<div class="call"><span class="indent">' + indent + '</span>' + body + '</div>');
  }
  document.getElementById('tree').innerHTML = lines.join('');
}
</script>
</body>
</html>`;
}
