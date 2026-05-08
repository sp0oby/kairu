/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PatternFinding, Severity } from './patterns';
import { SlitherResult } from './slither';

const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';`;

export function openAuditPanel(
	context: vscode.ExtensionContext,
	patternFindings: PatternFinding[],
	slitherResult?: SlitherResult,
	fileName?: string
): void {
	const panel = vscode.window.createWebviewPanel(
		'kairuSecurityAudit',
		`Kairu · Security Audit${fileName ? ' — ' + fileName : ''}`,
		vscode.ViewColumn.Beside,
		{ enableScripts: true, retainContextWhenHidden: true }
	);

	panel.webview.html = auditPanelHtml(patternFindings, slitherResult, fileName);

	panel.webview.onDidReceiveMessage(msg => {
		if (msg.type === 'goToLine') {
			const editors = vscode.window.visibleTextEditors;
			const editor = editors.find(e => e.document.fileName.endsWith(msg.file || '')) || vscode.window.activeTextEditor;
			if (editor) {
				const line = Math.max(0, (msg.line as number) - 1);
				const pos = new vscode.Position(line, 0);
				editor.selection = new vscode.Selection(pos, pos);
				editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
				vscode.window.showTextDocument(editor.document);
			}
		}
		if (msg.type === 'copy') {
			vscode.env.clipboard.writeText(msg.text);
		}
	}, undefined, context.subscriptions);
}

function severityColor(sev: Severity | string): string {
	switch (sev) {
		case 'critical': return '#ff4444';
		case 'High': case 'high': return '#f78c6c';
		case 'Medium': case 'medium': return '#ffcb6b';
		case 'Low': case 'low': return '#82aaff';
		case 'Informational': case 'info': return '#5a5d63';
		case 'Optimization': return '#a8d89b';
		default: return '#5a5d63';
	}
}

function severityLabel(sev: Severity | string): string {
	const s = String(sev).toLowerCase();
	switch (s) {
		case 'critical': return 'CRITICAL';
		case 'high': return 'HIGH';
		case 'medium': return 'MEDIUM';
		case 'low': return 'LOW';
		case 'info': case 'informational': return 'INFO';
		case 'optimization': return 'OPT';
		default: return String(sev).toUpperCase();
	}
}

function escHtml(s: string): string {
	return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function auditPanelHtml(
	patternFindings: PatternFinding[],
	slitherResult?: SlitherResult,
	fileName?: string
): string {
	const critical = patternFindings.filter(f => f.severity === 'critical').length;
	const high = patternFindings.filter(f => f.severity === 'high').length
		+ (slitherResult?.findings.filter(f => f.impact === 'High').length || 0);
	const medium = patternFindings.filter(f => f.severity === 'medium').length
		+ (slitherResult?.findings.filter(f => f.impact === 'Medium').length || 0);
	const total = patternFindings.length + (slitherResult?.findings.length || 0);

	const patternCards = patternFindings.map(f => {
		const color = severityColor(f.severity);
		const label = severityLabel(f.severity);
		return `<div class="finding-card" style="border-left:3px solid ${color}">
  <div class="finding-header">
    <span class="badge" style="background:${color}22;color:${color}">${label}</span>
    <span class="finding-id">${escHtml(f.id)}</span>
    <b>${escHtml(f.title)}</b>
    ${f.line ? `<button class="goto-btn" onclick="goTo(${f.line})">Line ${f.line}</button>` : ''}
  </div>
  <div class="finding-desc">${escHtml(f.description)}</div>
  ${f.snippet ? `<pre>${escHtml(f.snippet)}</pre>` : ''}
  <div class="finding-rec"><b>Recommendation:</b> ${escHtml(f.recommendation)}</div>
</div>`;
	}).join('');

	const slitherCards = slitherResult?.findings.map(f => {
		const color = severityColor(f.impact);
		const label = severityLabel(f.impact);
		const sourceLines: number[] = f.elements.flatMap(e => e.source_mapping?.lines || []);
		const firstLine = sourceLines[0];
		return `<div class="finding-card" style="border-left:3px solid ${color}">
  <div class="finding-header">
    <span class="badge" style="background:${color}22;color:${color}">${label}</span>
    <span class="finding-id">slither:${escHtml(f.check)}</span>
    <b>${escHtml(f.check)}</b>
    ${firstLine ? `<button class="goto-btn" onclick="goTo(${firstLine})">Line ${firstLine}</button>` : ''}
    <span class="confidence">confidence: ${escHtml(f.confidence)}</span>
  </div>
  <div class="finding-desc">${escHtml(f.description)}</div>
</div>`;
	}).join('') || '';

	const slitherSection = slitherResult
		? slitherResult.success
			? slitherResult.findings.length === 0
				? '<div class="section"><h2>Slither Analysis</h2><p class="clean">✓ Slither found no issues.</p></div>'
				: `<div class="section"><h2>Slither Analysis (${slitherResult.findings.length})</h2>${slitherCards}</div>`
			: `<div class="section"><h2>Slither Analysis</h2><p class="warn">⚠ ${escHtml(slitherResult.error || 'Slither failed')} — <a onclick="installSlither()">install slither</a></p></div>`
		: '';

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>Kairu Security Audit</title>
<style>
:root {
  --bg: var(--vscode-editor-background, #0e0e10);
  --fg: var(--vscode-editor-foreground, #cdd6f4);
  --border: var(--vscode-panel-border, #2a2a3a);
  --input-bg: var(--vscode-input-background, #1a1a2a);
  --accent: #82aaff;
  --muted: #5a5d63;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family, monospace); font-size: 13px; background: var(--bg); color: var(--fg); padding: 16px; line-height: 1.6; }
h1 { font-size: 15px; font-weight: 600; color: var(--accent); margin-bottom: 8px; }
h2 { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin: 20px 0 8px; }
.summary { display: flex; gap: 20px; margin-bottom: 20px; padding: 12px; background: var(--input-bg); border-radius: 8px; border: 1px solid var(--border); }
.stat { text-align: center; }
.stat .n { font-size: 22px; font-weight: 700; }
.stat .l { font-size: 10px; color: var(--muted); }
.finding-card { background: var(--input-bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 8px; }
.finding-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; }
.finding-id { font-size: 10px; color: var(--muted); }
.finding-desc { font-size: 12px; color: var(--fg); margin: 6px 0; }
.finding-rec { font-size: 11px; color: var(--muted); margin-top: 6px; }
pre { background: #111; border-radius: 4px; padding: 8px; font-size: 11px; overflow: auto; color: var(--muted); margin: 6px 0; }
.goto-btn { background: transparent; color: var(--accent); border: 1px solid var(--accent); border-radius: 4px; padding: 2px 7px; font-size: 10px; cursor: pointer; margin-left: auto; }
.goto-btn:hover { background: var(--accent); color: #0e0e10; }
.confidence { font-size: 10px; color: var(--muted); }
.clean { color: #a8d89b; font-size: 12px; padding: 8px 0; }
.warn { color: #ffcb6b; font-size: 12px; padding: 8px 0; }
.warn a { color: var(--accent); cursor: pointer; text-decoration: underline; }
.empty { color: var(--muted); text-align: center; padding: 24px; font-size: 12px; }
.section { margin-bottom: 16px; }
</style>
</head>
<body>
<h1>⬡ Security Audit${fileName ? ` — ${escHtml(fileName)}` : ''}</h1>

<div class="summary">
  <div class="stat"><div class="n" style="color:#ff4444">${critical}</div><div class="l">Critical</div></div>
  <div class="stat"><div class="n" style="color:#f78c6c">${high}</div><div class="l">High</div></div>
  <div class="stat"><div class="n" style="color:#ffcb6b">${medium}</div><div class="l">Medium</div></div>
  <div class="stat"><div class="n" style="color:#82aaff">${total}</div><div class="l">Total</div></div>
</div>

${patternFindings.length > 0
		? `<div class="section"><h2>Pattern Analysis (${patternFindings.length})</h2>${patternCards}</div>`
		: '<div class="section"><h2>Pattern Analysis</h2><p class="clean">✓ No common vulnerability patterns detected.</p></div>'
	}

${slitherSection}

<script>
const vscode = acquireVsCodeApi();
function goTo(line) { vscode.postMessage({ type: 'goToLine', line }); }
function installSlither() { vscode.postMessage({ type: 'copy', text: 'pip install slither-analyzer' }); }
</script>
</body>
</html>`;
}

export function buildDiagnostics(findings: PatternFinding[], collection: vscode.DiagnosticCollection, doc: vscode.TextDocument): void {
	const diagnostics: vscode.Diagnostic[] = findings.map(f => {
		const line = Math.max(0, f.line - 1);
		const lineText = doc.lineAt(Math.min(line, doc.lineCount - 1));
		const range = new vscode.Range(line, 0, line, lineText.text.length);
		const sev = f.severity === 'critical' || f.severity === 'high'
			? vscode.DiagnosticSeverity.Error
			: f.severity === 'medium'
				? vscode.DiagnosticSeverity.Warning
				: vscode.DiagnosticSeverity.Information;
		const d = new vscode.Diagnostic(range, `[${f.id}] ${f.title}: ${f.description}`, sev);
		d.source = 'Kairu Security';
		d.code = f.id;
		return d;
	});
	collection.set(doc.uri, diagnostics);
}
