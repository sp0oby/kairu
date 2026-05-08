/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { buildProvider } from '../providers/registry';
import { SecretsManager } from '../secrets';

const SUPPORTED_LANGUAGES = ['solidity', 'vyper', 'typescript', 'javascript', 'json', 'rust'];

interface CacheEntry {
	prefix: string;
	suffix: string;
	completion: string;
	timestamp: number;
}

/**
 * Inline AI completion provider — produces "ghost text" suggestions as the user types.
 *
 * Behavior:
 *  - Triggers on InvokeAutomatic; debounced ~500ms by VSCode + cancel token
 *  - Sends the surrounding code (prefix + suffix) to the configured AI provider
 *  - Returns the FIM-style completion as an InlineCompletionItem
 *  - Cached per-position to avoid re-firing while user is idle
 *
 * Disabled by default (`kairu.ai.inlineCompletions.enabled`); user must opt in.
 */
export class KairuInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
	private cache: CacheEntry | undefined;
	private inFlight: AbortController | undefined;

	constructor(private readonly secrets: SecretsManager) {}

	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		_context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	): Promise<vscode.InlineCompletionItem[] | undefined> {
		const config = vscode.workspace.getConfiguration('kairu.ai');
		if (!config.get<boolean>('inlineCompletions.enabled', true)) {
			return undefined;
		}

		// Cancel any in-flight request from a previous keystroke
		this.inFlight?.abort();
		this.inFlight = new AbortController();

		// Debounce: wait briefly after typing stops before firing the AI request.
		// If the cancellation token fires (user typed again), bail out before sending.
		const debounceMs = config.get<number>('inlineCompletions.debounceMs', 350);
		await new Promise(resolve => setTimeout(resolve, debounceMs));
		if (token.isCancellationRequested) {
			return undefined;
		}

		// Don't fire mid-word — wait for a natural break (space, newline, dot, paren, etc.)
		const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
		const lastChar = linePrefix.slice(-1);
		if (/[A-Za-z0-9_$]/.test(lastChar)) {
			return undefined;
		}

		// Bail if file is huge or unsupported
		if (!SUPPORTED_LANGUAGES.includes(document.languageId)) {
			return undefined;
		}
		const fullText = document.getText();
		if (fullText.length > 200000) {
			return undefined;
		}

		const offset = document.offsetAt(position);
		const PREFIX_BUDGET = 4000;
		const SUFFIX_BUDGET = 1500;
		const prefix = fullText.slice(Math.max(0, offset - PREFIX_BUDGET), offset);
		const suffix = fullText.slice(offset, Math.min(fullText.length, offset + SUFFIX_BUDGET));

		// Quick cache check — if user hasn't moved and prefix/suffix unchanged, reuse
		if (this.cache && this.cache.prefix === prefix && this.cache.suffix === suffix && Date.now() - this.cache.timestamp < 30000) {
			return [new vscode.InlineCompletionItem(this.cache.completion, new vscode.Range(position, position))];
		}

		// Hook the cancellation token to abort our in-flight provider call
		token.onCancellationRequested(() => {
			this.inFlight?.abort();
		});

		try {
			const provider = await buildProvider(this.secrets);
			const model = config.get<string>('inlineCompletions.model', '') || config.get<string>('model', '');
			if (!model) {
				return undefined;
			}

			const maxTokens = config.get<number>('inlineCompletions.maxTokens', 200);
			const systemPrompt = `You are a code completion engine. Given a code prefix and suffix, output ONLY the code that should fill the gap. No explanations, no markdown fences, no backticks. Just raw code. Preserve indentation. If the cursor is at end of line, complete the line. If the cursor is on a new line, complete the next statement(s).`;

			const userPrompt = `Language: ${document.languageId}

<prefix>
${prefix}
</prefix>

<cursor>HERE</cursor>

<suffix>
${suffix}
</suffix>

Output only the code that goes at <cursor>HERE</cursor>. No fences, no commentary.`;

			let completion = '';
			for await (const chunk of provider.chat({
				model,
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userPrompt },
				],
				maxTokens,
				signal: this.inFlight.signal,
			})) {
				if (token.isCancellationRequested) {
					return undefined;
				}
				if (chunk.delta) {
					completion += chunk.delta;
					if (completion.length > maxTokens * 4) {
						break; // safety: don't generate forever
					}
				}
			}

			completion = stripCodeFences(completion).trimEnd();
			if (!completion) {
				return undefined;
			}

			this.cache = { prefix, suffix, completion, timestamp: Date.now() };
			return [new vscode.InlineCompletionItem(completion, new vscode.Range(position, position))];
		} catch (err) {
			// Silent failure — inline completions are best-effort. Don't spam the user.
			if ((err as Error).name !== 'AbortError') {
				console.error('Kairu inline completion failed:', err);
			}
			return undefined;
		}
	}
}

function stripCodeFences(s: string): string {
	// Strip ```lang ... ``` if the model insisted on fences despite the prompt
	const fenceMatch = s.match(/^```\w*\n([\s\S]*?)\n```/);
	if (fenceMatch) {
		return fenceMatch[1];
	}
	return s.replace(/^```\w*\n?/, '').replace(/\n?```\s*$/, '');
}
