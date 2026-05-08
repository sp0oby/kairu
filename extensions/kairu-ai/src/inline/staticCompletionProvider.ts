/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Static (non-AI) inline completion provider.
 *
 * Surfaces common Solidity patterns as ghost text — like Copilot's "lightly hint"
 * feel but without any API calls. Free, instant, deterministic.
 *
 * Triggers when the user types a recognizable keyword/prefix at a position where
 * a known pattern is the obvious completion. Examples:
 *   - "pragma"   → "pragma solidity ^0.8.24;"
 *   - "// SPDX"  → "// SPDX-License-Identifier: MIT"
 *   - "mapping(" → "mapping(address => uint256)"
 *   - "function" → "function name() public { }"
 *
 * Designed to be conservative — only fires when the suggestion is the most
 * likely intent. Never fires mid-identifier.
 */

interface StaticPattern {
	/** Regex matched against the line text from start of line up to the cursor */
	match: RegExp;
	/** The completion to render as ghost text (will be inserted at cursor) */
	completion: string;
	/** Optional language filter (defaults to all) */
	languages?: string[];
	/** Optional context test — only fire if predicate returns true */
	when?: (doc: vscode.TextDocument, position: vscode.Position) => boolean;
}

// True when the file does not yet contain any contract/library/interface
// declaration — the boilerplate will give them one.
function isTopOfBareFile(doc: vscode.TextDocument, _position: vscode.Position): boolean {
	const fullText = stripCommentsAndStrings(doc.getText());
	return !/\b(contract|library|interface|abstract\s+contract)\s+\w/.test(fullText);
}

// Quick comment/string stripper so a comment "// contract MyContract" doesn't
// fool the boilerplate gate. Best-effort.
function stripCommentsAndStrings(src: string): string {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/[^\n]*/g, '')
		.replace(/"[^"\n]*"/g, '""')
		.replace(/'[^'\n]*'/g, "''");
}

const FULL_BOILERPLATE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MyContract {
    constructor() {

    }
}`;

/**
 * Special pre-pattern handler: when typing `pragma` (or `// SPDX`) at the top
 * of a file that has no SPDX line yet, replace the typed text + everything
 * before it on the file with the full boilerplate (SPDX + pragma + contract).
 *
 * This lets us prepend SPDX above the cursor — something a normal
 * InlineCompletionItem with `Range(position, position)` cannot do.
 *
 * Returns the InlineCompletionItem if applicable, or undefined to fall through
 * to the standard pattern matcher.
 */
function tryFullBoilerplate(
	doc: vscode.TextDocument,
	position: vscode.Position,
	linePrefix: string,
): vscode.InlineCompletionItem | undefined {
	// Only fire when typing `pragma` or `// SPDX` at start of a line
	const isPragmaTrigger = /^\s*pragma$/.test(linePrefix);
	const isSpdxTrigger = /^\s*\/\/\s*SPDX$/.test(linePrefix);
	if (!isPragmaTrigger && !isSpdxTrigger) { return undefined; }

	if (!isTopOfBareFile(doc, position)) { return undefined; }

	// Get content from doc start up to the start of this line.
	// If it already has SPDX, fall through (the bare-pragma pattern will complete).
	const lineStart = new vscode.Position(position.line, 0);
	const beforeCurrentLine = doc.getText(new vscode.Range(new vscode.Position(0, 0), lineStart));
	if (/SPDX-License-Identifier/.test(beforeCurrentLine)) { return undefined; }

	// Only safe to replace the file head if it's whitespace/comments only — don't
	// blow away imports, type declarations, etc.
	const stripped = stripCommentsAndStrings(beforeCurrentLine).trim();
	if (stripped.length > 0) { return undefined; }

	// Replace from doc start to current cursor with the full boilerplate.
	// Tab-to-accept will replace the typed text + any whitespace lines above it.
	return new vscode.InlineCompletionItem(
		FULL_BOILERPLATE,
		new vscode.Range(new vscode.Position(0, 0), position),
	);
}

const SOLIDITY_PATTERNS: StaticPattern[] = [
	// SPDX line completions
	{ match: /^\s*\/\/\s*SPDX$/, completion: '-License-Identifier: MIT' },
	{ match: /^\s*\/\/\s*SPDX-?L?i?c?e?n?s?e?-?I?d?e?n?t?i?f?i?e?r?:?$/, completion: ' MIT' },

	// pragma — bare line completion (when boilerplate path didn't fire)
	{ match: /^\s*pragma$/, completion: ' solidity ^0.8.24;' },
	{ match: /^\s*pragma\s+solidity$/, completion: ' ^0.8.24;' },

	// import patterns
	{ match: /^\s*import\s*$/, completion: ' {} from "";' },
	{ match: /^\s*import\s*\{[^}]*\}\s*from\s*$/, completion: ' "";' },

	// contract / interface / library declarations on an empty body
	{ match: /^\s*contract\s+\w+$/, completion: ' {\n    \n}' },
	{ match: /^\s*contract\s+\w+\s+is\s+\w+$/, completion: ' {\n    \n}' },
	{ match: /^\s*abstract\s+contract\s+\w+$/, completion: ' {\n    \n}' },
	{ match: /^\s*interface\s+\w+$/, completion: ' {\n    \n}' },
	{ match: /^\s*library\s+\w+$/, completion: ' {\n    \n}' },

	// constructor
	{ match: /^\s*constructor$/, completion: '() {\n    \n}' },

	// function declarations
	{ match: /^\s*function\s+\w+$/, completion: '() public {\n    \n}' },
	{ match: /^\s*function\s+\w+\(\)$/, completion: ' public {\n    \n}' },
	{ match: /^\s*function\s+\w+\([^)]*\)$/, completion: ' public {\n    \n}' },
	{ match: /^\s*function\s+\w+\([^)]*\)\s+public$/, completion: ' {\n    \n}' },
	{ match: /^\s*function\s+\w+\([^)]*\)\s+(public|external|internal|private)\s+(view|pure|payable)$/, completion: ' {\n    \n}' },

	// receive / fallback
	{ match: /^\s*receive$/, completion: '() external payable {\n    \n}' },
	{ match: /^\s*fallback$/, completion: '() external payable {\n    \n}' },

	// mapping types — hint at common patterns
	{ match: /^\s*mapping$/, completion: '(address => uint256)' },
	{ match: /^\s*mapping\($/, completion: 'address => uint256)' },

	// state variable visibility shortcuts
	{ match: /^\s*address$/, completion: ' public ' },
	{ match: /^\s*uint256$/, completion: ' public ' },

	// error declarations
	{ match: /^\s*error\s+\w+$/, completion: '();' },

	// event declarations
	{ match: /^\s*event\s+\w+$/, completion: '();' },

	// modifier declarations
	{ match: /^\s*modifier\s+\w+$/, completion: '() {\n    _;\n}' },
	{ match: /^\s*modifier\s+\w+\(\)$/, completion: ' {\n    _;\n}' },

	// require / revert / emit on a fresh line
	{ match: /^\s*require$/, completion: '(condition, "message");' },
	{ match: /^\s*revert$/, completion: '("message");' },
	{ match: /^\s*emit$/, completion: ' Event();' },

	// for / while loops
	{ match: /^\s*for$/, completion: ' (uint256 i = 0; i < length; i++) {\n    \n}' },
	{ match: /^\s*while$/, completion: ' (condition) {\n    \n}' },

	// if / else
	{ match: /^\s*if$/, completion: ' (condition) {\n    \n}' },
	{ match: /^\s*else$/, completion: ' {\n    \n}' },

	// using
	{ match: /^\s*using$/, completion: ' SafeERC20 for IERC20;' },

	// assembly
	{ match: /^\s*assembly$/, completion: ' {\n    \n}' },

	// unchecked
	{ match: /^\s*unchecked$/, completion: ' {\n    \n}' },
];

const VYPER_PATTERNS: StaticPattern[] = [
	{ match: /^\s*#\s*@version$/, completion: ' ^0.4.0' },
	{ match: /^\s*@external$/, completion: '\ndef function_name():\n    pass' },
	{ match: /^\s*@view$/, completion: '\ndef function_name() -> uint256:\n    return 0' },
	{ match: /^\s*def\s+\w+$/, completion: '():\n    pass' },
];

const TS_JS_PATTERNS: StaticPattern[] = [
	// Common viem / wagmi setups
	{ match: /^\s*import.*from\s+['"]viem$/, completion: '\';' },
	{ match: /^\s*import.*from\s+['"]wagmi$/, completion: '\';' },
];

const ALL_PATTERNS: Record<string, StaticPattern[]> = {
	'solidity': SOLIDITY_PATTERNS,
	'vyper': VYPER_PATTERNS,
	'typescript': TS_JS_PATTERNS,
	'javascript': TS_JS_PATTERNS,
};

// VSCode snippet body uses ${1:placeholder} / $0 / etc tokens. For ghost text
// we want plain readable text, so strip those tokens (replace ${N:label} with label).
function snippetBodyToGhostText(body: string[]): string {
	return body
		.join('\n')
		.replace(/\$\{(\d+):([^}]*)\}/g, '$2')   // ${1:foo} → foo
		.replace(/\$\{(\d+)\}/g, '')              // ${1} → empty
		.replace(/\$(\d+)/g, '');                 // $0 → empty
}

interface SnippetEntry {
	prefix: string;
	body: string;
}

let cachedSnippets: SnippetEntry[] | undefined;

// VSCode snippets come in two formats:
//   1. Flat: { "snippet name": { prefix, body } }                    (kairu-snippets style)
//   2. Scoped: { ".source.lang": { "snippet name": { prefix, body } } }  (JuanBlanco style)
// This recursively walks until it finds objects with a "prefix" field.
function collectFromSnippetTree(node: unknown, into: SnippetEntry[]): void {
	if (!node || typeof node !== 'object') { return; }
	const obj = node as Record<string, unknown>;

	// Looks like an actual snippet entry
	if ('prefix' in obj && 'body' in obj) {
		const prefixes = Array.isArray(obj.prefix) ? obj.prefix : [obj.prefix];
		const bodyArr = Array.isArray(obj.body) ? obj.body : [String(obj.body || '')];
		const body = snippetBodyToGhostText(bodyArr.map(String));
		for (const prefix of prefixes) {
			if (typeof prefix === 'string' && prefix.length > 0 && body) {
				into.push({ prefix, body });
			}
		}
		return;
	}

	// Otherwise recurse into children (scoped containers like ".source.solidity")
	for (const value of Object.values(obj)) {
		collectFromSnippetTree(value, into);
	}
}

function loadSnippets(): SnippetEntry[] {
	if (cachedSnippets) { return cachedSnippets; }

	const snippets: SnippetEntry[] = [];

	// Look for snippet JSONs in built-in extension folders.
	const extensionsRoot = path.resolve(__dirname, '..', '..', '..');
	const candidates = [
		path.join(extensionsRoot, 'kairu-snippets', 'snippets', 'solidity-kairu.json'),
		path.join(extensionsRoot, 'solidity', 'snippets', 'solidity.json'),
	];

	for (const file of candidates) {
		try {
			if (!fs.existsSync(file)) { continue; }
			const raw = fs.readFileSync(file, 'utf8');
			const parsed = JSON.parse(raw);
			collectFromSnippetTree(parsed, snippets);
		} catch {
			// Ignore unreadable snippet files — best effort
		}
	}

	cachedSnippets = snippets;
	return snippets;
}

export class KairuStaticCompletionProvider implements vscode.InlineCompletionItemProvider {
	provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		_context: vscode.InlineCompletionContext,
		_token: vscode.CancellationToken,
	): vscode.InlineCompletionItem[] | undefined {
		const config = vscode.workspace.getConfiguration('kairu.ai');
		if (!config.get<boolean>('staticCompletions.enabled', true)) {
			return undefined;
		}

		// Get the line text up to the cursor position
		const lineText = document.lineAt(position.line).text;
		const linePrefix = lineText.slice(0, position.character);

		// Don't fire if there's non-whitespace content after the cursor on the same line
		const lineSuffix = lineText.slice(position.character);
		if (lineSuffix.trim().length > 0) { return undefined; }

		// 0. Special-case: full boilerplate when starting a bare file.
		//    Replaces the typed `pragma` (or `// SPDX`) + any preceding whitespace
		//    with SPDX + pragma + contract scaffold all at once.
		if (document.languageId === 'solidity') {
			const boilerplate = tryFullBoilerplate(document, position, linePrefix);
			if (boilerplate) { return [boilerplate]; }
		}

		// 1. Try snippet expansions (if user typed a snippet prefix at start of line / after whitespace)
		if (document.languageId === 'solidity') {
			const snippetMatch = linePrefix.match(/(?:^|\s)([a-z][a-z0-9_-]*)$/i);
			if (snippetMatch && snippetMatch[1].length >= 2) {
				const typedPrefix = snippetMatch[1];
				const snippets = loadSnippets();

				// Exact match wins
				const exact = snippets.find(s => s.prefix === typedPrefix);
				if (exact) {
					const wordStart = position.translate(0, -typedPrefix.length);
					return [new vscode.InlineCompletionItem(exact.body, new vscode.Range(wordStart, position))];
				}

				// Otherwise, find the shortest prefix-match (most likely intent)
				const candidates = snippets
					.filter(s => s.prefix.startsWith(typedPrefix) && s.prefix !== typedPrefix)
					.sort((a, b) => a.prefix.length - b.prefix.length);
				if (candidates.length > 0) {
					const best = candidates[0];
					// Replace the typed prefix word with the full snippet body (Tab-to-accept replaces "kt" → full ktest body)
					const wordStart = position.translate(0, -typedPrefix.length);
					return [new vscode.InlineCompletionItem(best.body, new vscode.Range(wordStart, position))];
				}
			}
		}

		// 2. Hardcoded language patterns (pragma, contract, function, etc.)
		const patterns = ALL_PATTERNS[document.languageId];
		if (!patterns) { return undefined; }

		const matches: Array<{ pattern: StaticPattern; matchLen: number }> = [];
		for (const pattern of patterns) {
			const m = pattern.match.exec(linePrefix);
			if (m && m[0].length === linePrefix.length) {
				if (pattern.when && !pattern.when(document, position)) { continue; }
				matches.push({ pattern, matchLen: m[0].length });
			}
		}
		if (matches.length === 0) { return undefined; }

		matches.sort((a, b) => {
			if (b.matchLen !== a.matchLen) { return b.matchLen - a.matchLen; }
			// Tiebreak: longer completion wins (more specific / "boilerplate" version
			// trumps the bare line completion when both apply)
			return b.pattern.completion.length - a.pattern.completion.length;
		});
		const best = matches[0].pattern;
		return [new vscode.InlineCompletionItem(best.completion, new vscode.Range(position, position))];
	}
}
