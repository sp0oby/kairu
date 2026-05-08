/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { forgeBuild, forgeTest, getWorkspaceRoot, BuildResult } from '../foundry';

const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';`;

const BASE_CSS = `
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
button { padding: 7px 14px; border: none; border-radius: 6px; background: var(--accent); color: #0e0e10; font-size: 12px; font-weight: 600; cursor: pointer; }
button:hover { opacity: .85; }
button:disabled { opacity: .4; cursor: default; }
.btn-danger { background: var(--red); }
input[type=text] { width: 100%; padding: 7px 10px; background: var(--input-bg); color: var(--fg); border: 1px solid var(--input-border); border-radius: 6px; font-family: inherit; font-size: 12px; outline: none; }
input:focus { border-color: var(--accent); }
.card { background: var(--input-bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 8px; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
label { font-size: 11px; color: var(--muted); }
.mono { font-family: inherit; font-size: 11px; color: var(--muted); word-break: break-all; }
.pass { color: var(--green); }
.fail { color: var(--red); }
.skip { color: var(--gold); }
.badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; }
.badge-pass { background: #a8d89b22; color: var(--green); }
.badge-fail { background: #f78c6c22; color: var(--red); }
.badge-skip { background: #ffcb6b22; color: var(--gold); }
pre { background: #111; border-radius: 6px; padding: 10px; font-size: 11px; overflow: auto; color: var(--muted); max-height: 200px; margin-top: 4px; }
.summary { display: flex; gap: 16px; margin-bottom: 16px; }
.summary-stat { text-align: center; }
.summary-stat .num { font-size: 24px; font-weight: 700; }
.summary-stat .lbl { font-size: 10px; color: var(--muted); }
#log { max-height: 300px; overflow: auto; }
.gap { margin-top: 12px; }
.ai-btn {
  display: inline-flex; align-items: center; gap: 4px;
  margin-top: 8px;
  padding: 4px 10px; font-size: 11px;
  background: rgba(130, 170, 255, 0.08);
  color: var(--accent);
  border: 1px solid var(--accent); border-radius: 4px;
  cursor: pointer; font-family: inherit; font-weight: 500;
}
.ai-btn:hover { background: var(--accent); color: #0e0e10; }
</style>`;

export function openTestPanel(context: vscode.ExtensionContext): void {
	const panel = vscode.window.createWebviewPanel(
		'kairuFoundryTest',
		'Kairu · Foundry Test Runner',
		vscode.ViewColumn.Beside,
		{ enableScripts: true, retainContextWhenHidden: true }
	);

	panel.webview.html = testPanelHtml();

	let running = false;

	panel.webview.onDidReceiveMessage(async msg => {
		if (running && msg.type !== 'cancel') { return; }

		if (msg.type === 'build') {
			const cwd = getWorkspaceRoot();
			if (!cwd) {
				panel.webview.postMessage({ type: 'error', text: 'No workspace folder open.' });
				return;
			}
			running = true;
			panel.webview.postMessage({ type: 'buildStart' });
			const result = await forgeBuild(cwd, line => {
				panel.webview.postMessage({ type: 'log', line });
			});
			running = false;
			panel.webview.postMessage({ type: 'buildResult', result });
		}

		if (msg.type === 'test') {
			const cwd = getWorkspaceRoot();
			if (!cwd) {
				panel.webview.postMessage({ type: 'error', text: 'No workspace folder open.' });
				return;
			}
			running = true;
			panel.webview.postMessage({ type: 'testStart' });
			const results = await forgeTest(cwd, msg.filter || undefined, line => {
				panel.webview.postMessage({ type: 'log', line });
			});
			running = false;
			panel.webview.postMessage({ type: 'testResult', results });
		}

		if (msg.type === 'explainFailure') {
			const prompt = `A Foundry test just failed. Explain why it failed and how to fix it.

Test: ${msg.contract}.${msg.name}
Revert reason: ${msg.reason || '(no revert message)'}
Gas used: ${msg.gasUsed || 'unknown'}

Steps:
1. Diagnose the most likely cause based on the revert reason and test name
2. Suggest the specific code change to fix it
3. Note any related risks or invariants that might also be violated

Use the active file in the editor as context if it's a Solidity test or contract.`;
			await vscode.env.clipboard.writeText(prompt);
			await vscode.commands.executeCommand('kairu.ai.openChat');
			vscode.window.showInformationMessage(
				`Test failure prompt copied. Paste it in the Kairu AI chat.`
			);
		}
	}, undefined, context.subscriptions);
}

function testPanelHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
${BASE_CSS}
<title>Foundry Test Runner</title>
</head>
<body>
<h1>⬡ Foundry Test Runner</h1>

<div class="card">
  <div class="row">
    <button id="build-btn" onclick="runBuild()">forge build</button>
    <button id="test-btn" onclick="runTests()">forge test</button>
  </div>
  <div class="row" style="margin-top:10px">
    <label style="width:80px">Filter test:</label>
    <input type="text" id="filter" placeholder="test_transfer (--match-test)">
  </div>
</div>

<div id="summary" class="summary" style="display:none">
  <div class="summary-stat"><div class="num pass" id="sum-pass">0</div><div class="lbl">passed</div></div>
  <div class="summary-stat"><div class="num fail" id="sum-fail">0</div><div class="lbl">failed</div></div>
  <div class="summary-stat"><div class="num skip" id="sum-skip">0</div><div class="lbl">skipped</div></div>
</div>

<div id="results"></div>

<h2>Output Log</h2>
<pre id="log"></pre>

<script>
const vscode = acquireVsCodeApi();
let busy = false;

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'buildStart') { setBusy(true); log('Running forge build...\\n'); }
  if (msg.type === 'testStart') { setBusy(true); log('Running forge test --json...\\n'); document.getElementById('results').innerHTML = ''; document.getElementById('summary').style.display = 'none'; }
  if (msg.type === 'log') { log(msg.line + '\\n'); }
  if (msg.type === 'error') { setBusy(false); log('Error: ' + msg.text + '\\n'); }
  if (msg.type === 'buildResult') {
    setBusy(false);
    const r = msg.result;
    log((r.success ? '✓ Build succeeded\\n' : '✖ Build failed\\n'));
    renderBuildResult(r);
  }
  if (msg.type === 'testResult') {
    setBusy(false);
    renderTestResults(msg.results);
  }
});

function setBusy(b) {
  busy = b;
  document.getElementById('build-btn').disabled = b;
  document.getElementById('test-btn').disabled = b;
}

function log(text) {
  const el = document.getElementById('log');
  el.textContent += text;
  el.scrollTop = el.scrollHeight;
}

function runBuild() {
  if (busy) return;
  document.getElementById('log').textContent = '';
  vscode.postMessage({ type: 'build' });
}

function runTests() {
  if (busy) return;
  document.getElementById('log').textContent = '';
  const filter = document.getElementById('filter').value.trim();
  vscode.postMessage({ type: 'test', filter });
}

function renderBuildResult(r) {
  const out = [];
  if (r.errors.length) {
    out.push('<h2>Errors</h2>');
    r.errors.forEach(e => {
      out.push('<div class="card"><span class="fail">✖ ' + escHtml(e.message) + '</span></div>');
    });
  }
  if (r.warnings.length) {
    out.push('<h2>Warnings (' + r.warnings.length + ')</h2>');
    r.warnings.slice(0, 10).forEach(w => {
      out.push('<div class="card"><span style="color:var(--gold)">⚠ ' + escHtml(w.message) + '</span></div>');
    });
  }
  if (!r.errors.length && !r.warnings.length) {
    out.push('<div class="card pass">✓ Clean build — no errors or warnings.</div>');
  }
  document.getElementById('results').innerHTML = out.join('');
}

function renderTestResults(results) {
  if (!results || results.length === 0) {
    document.getElementById('results').innerHTML = '<div class="card mono">No test results. Is this a Foundry project with forge tests?</div>';
    return;
  }
  const pass = results.filter(r => r.status === 'pass').length;
  const fail = results.filter(r => r.status === 'fail').length;
  const skip = results.filter(r => r.status === 'skip').length;

  document.getElementById('sum-pass').textContent = pass;
  document.getElementById('sum-fail').textContent = fail;
  document.getElementById('sum-skip').textContent = skip;
  document.getElementById('summary').style.display = 'flex';

  // Group by contract
  const byContract = {};
  results.forEach(r => {
    if (!byContract[r.contract]) byContract[r.contract] = [];
    byContract[r.contract].push(r);
  });

  const out = [];
  for (const [contract, tests] of Object.entries(byContract)) {
    const cPass = tests.filter(t => t.status === 'pass').length;
    const cFail = tests.filter(t => t.status === 'fail').length;
    out.push('<h2>' + escHtml(contract) + ' <span class="mono">(' + cPass + '/' + tests.length + ' pass)</span></h2>');
    tests.forEach(t => {
      const badge = '<span class="badge badge-' + t.status + '">' + t.status.toUpperCase() + '</span>';
      const gas = t.gasUsed !== undefined ? ' <span class="mono">gas: ' + t.gasUsed.toLocaleString() + '</span>' : '';
      const reason = t.reason ? '<pre>' + escHtml(t.reason) + '</pre>' : '';
      const explainBtn = t.status === 'fail'
        ? '<button class="ai-btn" onclick=\'explainFailure(' + JSON.stringify(t).replace(/\'/g, "&#39;") + ')\'>◇ Ask AI to explain</button>'
        : '';
      out.push('<div class="card">' + badge + ' <b>' + escHtml(t.name) + '</b>' + gas + reason + explainBtn + '</div>');
    });
  }
  document.getElementById('results').innerHTML = out.join('');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function explainFailure(t) {
  vscode.postMessage({ type: 'explainFailure', contract: t.contract, name: t.name, reason: t.reason, gasUsed: t.gasUsed });
}
</script>
</body>
</html>`;
}

export function openBuildOutput(_context: vscode.ExtensionContext, result: BuildResult): void {
	const channel = vscode.window.createOutputChannel('Kairu Foundry Build');
	channel.clear();
	channel.appendLine(result.output);
	channel.show();
}
