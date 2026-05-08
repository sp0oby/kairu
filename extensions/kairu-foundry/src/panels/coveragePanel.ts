/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { getWorkspaceRoot } from '../foundry';

const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';`;

export interface FileCoverage {
	file: string;
	linesCovered: number;
	linesTotal: number;
	functionsCovered: number;
	functionsTotal: number;
	branchesCovered: number;
	branchesTotal: number;
	uncoveredLines: number[];
	coveredLines: number[];
}

export function parseLcov(lcov: string): FileCoverage[] {
	const records = lcov.split(/^end_of_record$/m);
	const results: FileCoverage[] = [];

	for (const rec of records) {
		const lines = rec.split('\n');
		let file = '';
		let linesCovered = 0;
		let linesTotal = 0;
		let functionsCovered = 0;
		let functionsTotal = 0;
		let branchesCovered = 0;
		let branchesTotal = 0;
		const uncoveredLines: number[] = [];
		const coveredLines: number[] = [];

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) { continue; }

			if (trimmed.startsWith('SF:')) {
				file = trimmed.slice(3);
			} else if (trimmed.startsWith('LH:')) {
				linesCovered = parseInt(trimmed.slice(3));
			} else if (trimmed.startsWith('LF:')) {
				linesTotal = parseInt(trimmed.slice(3));
			} else if (trimmed.startsWith('FH:')) {
				functionsCovered = parseInt(trimmed.slice(3));
			} else if (trimmed.startsWith('FNF:')) {
				functionsTotal = parseInt(trimmed.slice(4));
			} else if (trimmed.startsWith('BRH:')) {
				branchesCovered = parseInt(trimmed.slice(4));
			} else if (trimmed.startsWith('BRF:')) {
				branchesTotal = parseInt(trimmed.slice(4));
			} else if (trimmed.startsWith('DA:')) {
				// DA:<line>,<count>
				const parts = trimmed.slice(3).split(',');
				const ln = parseInt(parts[0]);
				const count = parseInt(parts[1]);
				if (!isNaN(ln)) {
					if (count > 0) { coveredLines.push(ln); }
					else { uncoveredLines.push(ln); }
				}
			}
		}

		if (file) {
			results.push({
				file, linesCovered, linesTotal, functionsCovered, functionsTotal,
				branchesCovered, branchesTotal, uncoveredLines, coveredLines,
			});
		}
	}

	return results;
}

async function runForgeCoverage(cwd: string, onProgress: (line: string) => void): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn('forge', ['coverage', '--report', 'lcov'], { cwd, shell: false });
		const lines: string[] = [];
		child.stdout.on('data', (d: Buffer) => {
			const text = d.toString();
			lines.push(text);
			onProgress(text);
		});
		child.stderr.on('data', (d: Buffer) => {
			const text = d.toString();
			onProgress(text);
		});
		child.on('close', async () => {
			// forge coverage writes lcov.info file, also outputs to stdout
			try {
				const lcovUri = vscode.Uri.joinPath(vscode.Uri.file(cwd), 'lcov.info');
				const bytes = await vscode.workspace.fs.readFile(lcovUri);
				resolve(new TextDecoder().decode(bytes));
			} catch {
				// Fall back to stdout if lcov.info not written
				resolve(lines.join(''));
			}
		});
		child.on('error', err => reject(err));
	});
}

let activeDecoration: vscode.TextEditorDecorationType | undefined;
let activeUncoveredDecoration: vscode.TextEditorDecorationType | undefined;

export function clearCoverageDecorations(): void {
	for (const editor of vscode.window.visibleTextEditors) {
		if (activeDecoration) { editor.setDecorations(activeDecoration, []); }
		if (activeUncoveredDecoration) { editor.setDecorations(activeUncoveredDecoration, []); }
	}
	activeDecoration?.dispose();
	activeUncoveredDecoration?.dispose();
	activeDecoration = undefined;
	activeUncoveredDecoration = undefined;
}

export function applyCoverageDecorations(coverage: FileCoverage[]): void {
	clearCoverageDecorations();

	activeDecoration = vscode.window.createTextEditorDecorationType({
		isWholeLine: false,
		gutterIconPath: undefined,
		overviewRulerColor: '#a8d89b',
		overviewRulerLane: vscode.OverviewRulerLane.Left,
		light: { gutterIconSize: 'auto' },
		before: {
			contentText: '✓',
			color: '#a8d89b',
			margin: '0 4px 0 0',
		},
	});

	activeUncoveredDecoration = vscode.window.createTextEditorDecorationType({
		isWholeLine: false,
		overviewRulerColor: '#f78c6c',
		overviewRulerLane: vscode.OverviewRulerLane.Left,
		before: {
			contentText: '✗',
			color: '#f78c6c',
			margin: '0 4px 0 0',
		},
	});

	for (const editor of vscode.window.visibleTextEditors) {
		const path = editor.document.uri.fsPath;
		const match = coverage.find(c => path.endsWith(c.file) || c.file.endsWith(path.replace(/^.*\//, '')));
		if (!match) { continue; }

		const covered = match.coveredLines.map(ln => new vscode.Range(ln - 1, 0, ln - 1, 0));
		const uncovered = match.uncoveredLines.map(ln => new vscode.Range(ln - 1, 0, ln - 1, 0));
		editor.setDecorations(activeDecoration, covered);
		editor.setDecorations(activeUncoveredDecoration, uncovered);
	}
}

export function openCoveragePanel(context: vscode.ExtensionContext): void {
	const panel = vscode.window.createWebviewPanel(
		'kairuCoverage',
		'Kairu · Coverage',
		vscode.ViewColumn.Beside,
		{ enableScripts: true, retainContextWhenHidden: true }
	);

	panel.webview.html = coverageHtml();

	let currentCoverage: FileCoverage[] = [];

	panel.webview.onDidReceiveMessage(async msg => {
		if (msg.type === 'run') {
			const cwd = getWorkspaceRoot();
			if (!cwd) {
				panel.webview.postMessage({ type: 'error', text: 'No workspace folder open.' });
				return;
			}
			panel.webview.postMessage({ type: 'running' });
			try {
				const lcov = await runForgeCoverage(cwd, line => {
					panel.webview.postMessage({ type: 'log', line });
				});
				const coverage = parseLcov(lcov);
				currentCoverage = coverage;
				panel.webview.postMessage({ type: 'result', coverage });
			} catch (err) {
				panel.webview.postMessage({ type: 'error', text: (err as Error).message });
			}
		}

		if (msg.type === 'loadFromFile') {
			const cwd = getWorkspaceRoot();
			if (!cwd) {
				panel.webview.postMessage({ type: 'error', text: 'No workspace folder open.' });
				return;
			}
			try {
				const lcovUri = vscode.Uri.joinPath(vscode.Uri.file(cwd), 'lcov.info');
				const bytes = await vscode.workspace.fs.readFile(lcovUri);
				const lcov = new TextDecoder().decode(bytes);
				const coverage = parseLcov(lcov);
				currentCoverage = coverage;
				panel.webview.postMessage({ type: 'result', coverage });
			} catch {
				panel.webview.postMessage({ type: 'error', text: 'lcov.info not found in workspace root. Run "Kairu: Run Coverage" first.' });
			}
		}

		if (msg.type === 'showDecorations') {
			applyCoverageDecorations(currentCoverage);
			vscode.window.showInformationMessage('Coverage gutters applied to open editors. Use "Kairu: Clear Coverage Decorations" to remove.');
		}

		if (msg.type === 'clearDecorations') {
			clearCoverageDecorations();
		}

		if (msg.type === 'openFile') {
			const cwd = getWorkspaceRoot();
			if (!cwd) { return; }
			const fileUri = vscode.Uri.joinPath(vscode.Uri.file(cwd), msg.file);
			try {
				const doc = await vscode.workspace.openTextDocument(fileUri);
				const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
				if (msg.line) {
					const line = msg.line - 1;
					editor.selection = new vscode.Selection(line, 0, line, 0);
					editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenter);
				}
			} catch (err) {
				vscode.window.showErrorMessage(`Could not open ${msg.file}: ${(err as Error).message}`);
			}
		}
	}, undefined, context.subscriptions);

	panel.onDidDispose(() => {
		clearCoverageDecorations();
	});
}

function coverageHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>Coverage</title>
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
body { font-family: var(--vscode-font-family, monospace); font-size: 13px; background: var(--bg); color: var(--fg); padding: 16px; line-height: 1.5; }
h1 { font-size: 15px; font-weight: 600; color: var(--accent); margin-bottom: 16px; }
h2 { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin: 16px 0 8px; }
button { padding: 7px 14px; border: none; border-radius: 6px; background: var(--accent); color: #0e0e10; font-size: 12px; font-weight: 600; cursor: pointer; margin-right: 6px; }
button:hover { opacity: .85; }
.btn-ghost { background: transparent; color: var(--fg); border: 1px solid var(--border); }
.btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.summary { display: flex; gap: 16px; padding: 12px; background: var(--input-bg); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 16px; }
.stat { text-align: center; flex: 1; }
.stat .n { font-size: 20px; font-weight: 700; }
.stat .l { font-size: 10px; color: var(--muted); margin-top: 2px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 11px; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--border); }
td { padding: 6px 8px; border-bottom: 1px solid var(--border); font-size: 12px; }
tr:last-child td { border-bottom: none; }
.bar { display: inline-block; height: 6px; border-radius: 3px; background: var(--green); }
.bar-bg { display: inline-block; width: 100px; height: 6px; border-radius: 3px; background: var(--input-bg); border: 1px solid var(--border); margin-right: 6px; vertical-align: middle; position: relative; overflow: hidden; }
.file-link { color: var(--accent); cursor: pointer; }
.file-link:hover { text-decoration: underline; }
pre { background: #111; border-radius: 6px; padding: 10px; font-size: 10px; overflow: auto; color: var(--muted); max-height: 150px; margin-top: 8px; }
.err { color: var(--red); font-size: 12px; padding: 8px 0; }
.empty { color: var(--muted); text-align: center; padding: 24px; font-size: 12px; }
.high { color: var(--green); }
.mid { color: var(--gold); }
.low { color: var(--red); }
.uncov-list { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--red); }
.uncov-list span { cursor: pointer; }
.uncov-list span:hover { text-decoration: underline; }
</style>
</head>
<body>
<h1>⬡ Foundry Coverage</h1>

<div class="row">
  <button onclick="run()">Run forge coverage</button>
  <button class="btn-ghost" onclick="loadFromFile()">Load existing lcov.info</button>
  <button class="btn-ghost" onclick="showDeco()">Apply Editor Gutters</button>
  <button class="btn-ghost" onclick="clearDeco()">Clear Gutters</button>
</div>

<div id="output"><p class="empty">Run coverage to see results.</p></div>

<h2>Output Log</h2>
<pre id="log"></pre>

<script>
const vscode = acquireVsCodeApi();
let busy = false;

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'running') { busy = true; document.getElementById('log').textContent = 'forge coverage is slow — typically 30s–2min on small projects, longer on large ones...\\n'; document.getElementById('output').innerHTML = '<p class="empty">Running...</p>'; }
  if (msg.type === 'log') { const el = document.getElementById('log'); el.textContent += msg.line; el.scrollTop = el.scrollHeight; }
  if (msg.type === 'error') { busy = false; document.getElementById('output').innerHTML = '<p class="err">✖ ' + msg.text + '</p>'; }
  if (msg.type === 'result') { busy = false; renderCoverage(msg.coverage); }
});

function run() { if (busy) return; vscode.postMessage({ type: 'run' }); }
function loadFromFile() { vscode.postMessage({ type: 'loadFromFile' }); }
function showDeco() { vscode.postMessage({ type: 'showDecorations' }); }
function clearDeco() { vscode.postMessage({ type: 'clearDecorations' }); }
function openFile(file, line) { vscode.postMessage({ type: 'openFile', file, line }); }

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function renderCoverage(coverage) {
  if (!coverage || coverage.length === 0) {
    document.getElementById('output').innerHTML = '<p class="empty">No coverage data found.</p>';
    return;
  }

  // Filter out test files and dependencies — usually we want src/ files only
  const filtered = coverage.filter(c => !c.file.includes('/test/') && !c.file.includes('/lib/') && !c.file.includes('/node_modules/'));
  const view = filtered.length > 0 ? filtered : coverage;

  let totalLines = 0, coveredLines = 0, totalFns = 0, coveredFns = 0;
  for (const c of view) {
    totalLines += c.linesTotal; coveredLines += c.linesCovered;
    totalFns += c.functionsTotal; coveredFns += c.functionsCovered;
  }
  const linePct = totalLines > 0 ? Math.round((coveredLines / totalLines) * 100) : 0;
  const fnPct = totalFns > 0 ? Math.round((coveredFns / totalFns) * 100) : 0;
  const lineCls = linePct >= 80 ? 'high' : linePct >= 50 ? 'mid' : 'low';
  const fnCls = fnPct >= 80 ? 'high' : fnPct >= 50 ? 'mid' : 'low';

  let html = '<div class="summary">' +
    '<div class="stat"><div class="n ' + lineCls + '">' + linePct + '%</div><div class="l">Lines (' + coveredLines + '/' + totalLines + ')</div></div>' +
    '<div class="stat"><div class="n ' + fnCls + '">' + fnPct + '%</div><div class="l">Functions (' + coveredFns + '/' + totalFns + ')</div></div>' +
    '<div class="stat"><div class="n">' + view.length + '</div><div class="l">Files</div></div>' +
    '</div>';

  html += '<table><thead><tr><th>File</th><th>Lines</th><th>Functions</th><th>Uncovered</th></tr></thead><tbody>';
  for (const c of view.slice().sort((a,b) => (a.linesCovered/Math.max(1,a.linesTotal)) - (b.linesCovered/Math.max(1,b.linesTotal)))) {
    const pct = c.linesTotal > 0 ? Math.round((c.linesCovered / c.linesTotal) * 100) : 0;
    const cls = pct >= 80 ? 'high' : pct >= 50 ? 'mid' : 'low';
    const barW = pct;
    const barColor = cls === 'high' ? 'var(--green)' : cls === 'mid' ? 'var(--gold)' : 'var(--red)';
    const uncov = c.uncoveredLines.slice(0, 6).map(ln =>
      '<span onclick="openFile(\\'' + escHtml(c.file) + '\\',' + ln + ')">' + ln + '</span>'
    ).join(', ');
    const more = c.uncoveredLines.length > 6 ? ' <span style="color:var(--muted)">+' + (c.uncoveredLines.length - 6) + '</span>' : '';
    html += '<tr>' +
      '<td><span class="file-link" onclick="openFile(\\'' + escHtml(c.file) + '\\')">' + escHtml(c.file) + '</span></td>' +
      '<td><span class="bar-bg"><span class="bar" style="width:' + barW + '%;background:' + barColor + '"></span></span><span class="' + cls + '">' + pct + '%</span></td>' +
      '<td>' + c.functionsCovered + '/' + c.functionsTotal + '</td>' +
      '<td class="uncov-list">' + (uncov || '<span style="color:var(--green)">all covered</span>') + more + '</td>' +
      '</tr>';
  }
  html += '</tbody></table>';

  document.getElementById('output').innerHTML = html;
}
</script>
</body>
</html>`;
}
