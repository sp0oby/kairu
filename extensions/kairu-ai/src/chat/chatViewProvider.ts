/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { buildProvider, PROVIDER_DISPLAY_NAMES } from '../providers/registry';
import { ChatMessage, MessageContentBlock, ProviderError, ProviderId, ToolCall } from '../providers/types';
import { SecretsManager } from '../secrets';
import { isSetupComplete, runSetupWizard } from '../setupWizard';
import { ChatSession } from './session';
import { SemanticIndex } from '../semantic/index';
import { buildSemanticContext } from '../semantic/contextBuilder';
import { BUILTIN_TOOLS, getToolByName } from '../tools/builtin';
import { ToolContext } from '../tools/types';

interface InboundMessage {
	type: 'send' | 'cancel' | 'clear' | 'requestState' | 'pickProvider' | 'pickModel' | 'setApiKey' | 'insert' | 'setup';
	text?: string;
}

interface OutboundMessage {
	type: 'state' | 'append' | 'streamStart' | 'streamEnd' | 'error' | 'cleared' | 'toolStart' | 'toolEnd';
	state?: {
		provider: string;
		model: string;
		messages: { role: string; content: string }[];
		busy: boolean;
		context: { fileName: string; lang: string; isSelection: boolean; lineRange?: string } | null;
		/** True when provider+model+key are all configured and ready */
		ready: boolean;
	};
	delta?: string;
	error?: string;
	tool?: { name: string; input?: Record<string, unknown>; result?: string; isError?: boolean };
}

const MAX_AGENT_ITERATIONS = 8;

export class KairuChatViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'kairu.chat';

	private view: vscode.WebviewView | undefined;
	private session = new ChatSession();
	private currentRequest: AbortController | undefined;
	private busy = false;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly secrets: SecretsManager,
		private readonly semanticIndex?: SemanticIndex
	) {}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;

		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
		};

		view.webview.html = this.renderHtml(view.webview);

		view.webview.onDidReceiveMessage((msg: InboundMessage) => this.handleMessage(msg));
		view.onDidDispose(() => {
			this.currentRequest?.abort();
		});

		this.postState();
	}

	private async handleMessage(msg: InboundMessage): Promise<void> {
		switch (msg.type) {
			case 'send':
				if (msg.text) {
					await this.sendUserMessage(msg.text);
				}
				return;
			case 'cancel':
				this.currentRequest?.abort();
				return;
			case 'clear':
				this.session.clear();
				this.post({ type: 'cleared' });
				this.postState();
				return;
			case 'setup':
				await vscode.commands.executeCommand('kairu.ai.setup');
				this.postState();
				return;
			case 'requestState':
				this.postState();
				return;
			case 'pickProvider':
				await vscode.commands.executeCommand('kairu.ai.selectProvider');
				this.postState();
				return;
			case 'pickModel':
				await vscode.commands.executeCommand('kairu.ai.selectModel');
				this.postState();
				return;
			case 'setApiKey':
				await vscode.commands.executeCommand('kairu.ai.setApiKey');
				this.postState();
				return;
			case 'insert':
				if (msg.text) {
					await this.insertAtCursor(msg.text);
				}
				return;
		}
	}

	private async insertAtCursor(text: string): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage('No active editor to insert into.');
			return;
		}
		await editor.edit(builder => {
			for (const sel of editor.selections) {
				builder.replace(sel, text);
			}
		});
	}

	private async sendUserMessage(text: string): Promise<void> {
		if (this.busy) {
			return;
		}

		// First-run setup: walk user through provider + model + key if needed
		if (!(await isSetupComplete(this.secrets))) {
			const ok = await runSetupWizard(this.secrets);
			if (!ok) {
				this.post({
					type: 'error',
					error: 'Kairu AI setup was cancelled. Click the provider or model pill to retry.'
				});
				return;
			}
		}

		const config = vscode.workspace.getConfiguration('kairu.ai');
		const model = config.get<string>('model', '');
		if (!model) {
			this.post({
				type: 'error',
				error: 'No model configured. Click the model pill to pick one.'
			});
			return;
		}

		// Build conversation
		const systemPrompt = config.get<string>('systemPrompt', '');
		const includeActiveFile = config.get<boolean>('includeActiveFile', true);
		const maxTokens = config.get<number>('maxTokens', 4096);

		const messages: ChatMessage[] = [];
		if (systemPrompt) {
			messages.push({ role: 'system', content: systemPrompt });
		}

		const editorContext = includeActiveFile ? this.collectEditorContext() : '';
		const semanticCtx = this.semanticIndex
			? buildSemanticContext(
				this.semanticIndex,
				vscode.window.activeTextEditor?.document.uri.toString(),
				text
			)
			: null;
		const contextParts = [editorContext, semanticCtx?.summary].filter(Boolean);
		const userContent = contextParts.length > 0 ? `${contextParts.join('\n\n')}\n\n${text}` : text;

		// Persist what the user sees (without the embedded context)
		this.session.add('user', text);

		// But send the full content (with context) to the model
		messages.push(...this.session.getChatMessages().slice(0, -1));
		messages.push({ role: 'user', content: userContent });

		this.session.add('assistant', '');
		this.postState();
		this.post({ type: 'streamStart' });

		this.busy = true;
		this.currentRequest = new AbortController();

		try {
			const provider = await buildProvider(this.secrets);
			const toolsEnabled = provider.supportsTools && config.get<boolean>('toolsEnabled', true);
			const toolDefinitions = toolsEnabled ? BUILTIN_TOOLS.map(t => t.definition) : undefined;

			const toolCtx: ToolContext = {
				workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
				...(this.semanticIndex ? { semanticIndex: this.semanticIndex } : {}),
			};

			// Agent loop: call provider, collect text + tool_use, run tools, continue until end_turn or max iterations
			let iteration = 0;
			while (iteration < MAX_AGENT_ITERATIONS) {
				iteration++;
				const collectedText: string[] = [];
				const collectedToolCalls: ToolCall[] = [];
				let stopReason: string | undefined;

				for await (const chunk of provider.chat({
					model,
					messages,
					maxTokens,
					...(toolDefinitions ? { tools: toolDefinitions } : {}),
					signal: this.currentRequest.signal,
				})) {
					if (chunk.delta) {
						collectedText.push(chunk.delta);
						this.session.appendToLast(chunk.delta);
						this.post({ type: 'append', delta: chunk.delta });
					}
					if (chunk.toolCall) {
						collectedToolCalls.push(chunk.toolCall);
					}
					if (chunk.stop) {
						stopReason = chunk.stop;
					}
				}

				// If no tool calls were made (or tools disabled), we're done
				if (collectedToolCalls.length === 0) {
					break;
				}

				// Build the assistant message with text + tool_use blocks (Anthropic-shaped content array)
				const assistantBlocks: MessageContentBlock[] = [];
				const text = collectedText.join('');
				if (text.trim()) {
					assistantBlocks.push({ type: 'text', text });
				}
				for (const tc of collectedToolCalls) {
					assistantBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
				}
				messages.push({ role: 'assistant', content: assistantBlocks });

				// Execute each tool sequentially and gather results
				const toolResultBlocks: MessageContentBlock[] = [];
				for (const tc of collectedToolCalls) {
					this.post({ type: 'toolStart', tool: { name: tc.name, input: tc.input } });
					this.session.appendToLast(`\n\n_◇ ${tc.name}(${JSON.stringify(tc.input).slice(0, 100)})_`);
					this.post({ type: 'append', delta: `\n\n◇ ${tc.name}(${JSON.stringify(tc.input).slice(0, 100)})\n` });

					const tool = getToolByName(tc.name);
					let resultText: string;
					let isError = false;
					if (!tool) {
						resultText = `Unknown tool: ${tc.name}`;
						isError = true;
					} else {
						try {
							resultText = await tool.execute(tc.input, toolCtx);
						} catch (err) {
							resultText = `Tool error: ${(err as Error).message}`;
							isError = true;
						}
					}

					toolResultBlocks.push({
						type: 'tool_result',
						tool_use_id: tc.id,
						content: resultText,
						is_error: isError,
					});

					const preview = resultText.length > 200 ? resultText.slice(0, 200) + '…' : resultText;
					this.session.appendToLast(`\n  ${isError ? '✖' : '✓'} ${preview.split('\n').join('\n  ')}\n`);
					this.post({ type: 'append', delta: `  ${isError ? '✖' : '✓'} ${preview}\n` });
					this.post({ type: 'toolEnd', tool: { name: tc.name, result: resultText, isError } });
				}

				// Send tool results back as a user-role message with tool_result blocks
				messages.push({ role: 'user', content: toolResultBlocks });

				// Visible separator between tool batch and model continuation
				this.session.appendToLast('\n');
				this.post({ type: 'append', delta: '\n' });

				// If the provider explicitly told us we're done, break
				if (stopReason && stopReason !== 'tool_use') {
					break;
				}
			}

			if (iteration >= MAX_AGENT_ITERATIONS) {
				this.session.appendToLast(`\n\n_(stopped after ${MAX_AGENT_ITERATIONS} agent iterations)_`);
				this.post({ type: 'append', delta: `\n\n_(stopped after ${MAX_AGENT_ITERATIONS} agent iterations)_` });
			}
		} catch (err) {
			let message = err instanceof ProviderError ? err.message : (err as Error).message;
			const providerId = vscode.workspace.getConfiguration('kairu.ai').get<ProviderId>('provider', 'ollama');
			if (providerId === 'ollama' && /Cannot reach Ollama|fetch failed|ECONNREFUSED/i.test(message)) {
				message += '\n\nTry: install Ollama (`brew install ollama && ollama serve`), or switch to a cloud provider via the provider pill.';
			} else if (/401|403|invalid api key/i.test(message)) {
				message += '\n\nYour API key was rejected. Run "Kairu: Set AI Provider API Key" to update it.';
			}
			this.session.appendToLast(`\n\n_Error: ${message}_`);
			this.post({ type: 'error', error: message });
		} finally {
			this.busy = false;
			this.currentRequest = undefined;
			this.post({ type: 'streamEnd' });
			this.postState();
		}
	}

	private collectEditorContext(): string {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return '';
		}
		const doc = editor.document;
		const selection = editor.selection;
		const fileName = doc.fileName.split(/[\\/]/).pop() ?? doc.fileName;
		const lang = doc.languageId;

		if (!selection.isEmpty) {
			const text = doc.getText(selection);
			return `[Selection from ${fileName} (${lang}), lines ${selection.start.line + 1}-${selection.end.line + 1}]\n\`\`\`${lang}\n${text}\n\`\`\``;
		}
		// Inject only a reasonable slice if file is huge
		const fullText = doc.getText();
		const truncated = fullText.length > 8000 ? fullText.slice(0, 8000) + '\n\n... (file truncated) ...' : fullText;
		return `[Active file: ${fileName} (${lang})]\n\`\`\`${lang}\n${truncated}\n\`\`\``;
	}

	private postState(): void {
		this.post({ type: 'state', state: this.buildStatePayload() });
	}

	updateContext(): void {
		// Called when active editor or selection changes
		this.postState();
	}

	private post(msg: OutboundMessage): void {
		this.view?.webview.postMessage(msg);
	}

	clearSession(): void {
		this.session.clear();
		this.post({ type: 'cleared' });
		this.postState();
	}

	async sendMessageProgrammatic(text: string): Promise<void> {
		await this.sendUserMessage(text);
	}

	private buildStatePayload() {
		const config = vscode.workspace.getConfiguration('kairu.ai');
		const provider = config.get<ProviderId>('provider', 'ollama');
		const model = config.get<string>('model', '');
		const includeActiveFile = config.get<boolean>('includeActiveFile', true);
		let context: { fileName: string; lang: string; isSelection: boolean; lineRange?: string } | null = null;
		if (includeActiveFile) {
			const editor = vscode.window.activeTextEditor;
			if (editor) {
				const fileName = editor.document.fileName.split(/[\\/]/).pop() ?? editor.document.fileName;
				const isSelection = !editor.selection.isEmpty;
				context = {
					fileName, lang: editor.document.languageId, isSelection,
					lineRange: isSelection ? `L${editor.selection.start.line + 1}-${editor.selection.end.line + 1}` : undefined
				};
			}
		}
		return {
			provider: PROVIDER_DISPLAY_NAMES[provider] ?? provider,
			model: model || '(no model)',
			messages: this.session.getMessages().map(m => ({ role: m.role, content: m.content })),
			busy: this.busy,
			context,
			ready: Boolean(model),
		};
	}

	explainSelection(): void {
		this.runQuickPrompt(
			'Explain what the selected code does, including any risks or non-obvious behavior.',
			'Explain what the active file does.'
		);
	}

	findVulnerabilities(): void {
		this.runQuickPrompt(
			'Audit the selected code for security vulnerabilities. Cover: reentrancy, access control, integer arithmetic, oracle/price manipulation, unchecked external calls, and any pattern matching known exploits. Rank findings by severity.',
			'Audit the active file for security vulnerabilities. Cover: reentrancy, access control, integer arithmetic, oracle/price manipulation, unchecked external calls, and any pattern matching known exploits. Rank findings by severity.'
		);
	}

	generateFoundryTests(): void {
		this.runQuickPrompt(
			'Generate Foundry tests for the selected code. Use forge-std/Test.sol, include setUp(), happy-path tests, edge cases, and at least one fuzz test. Output a complete .t.sol file.',
			'Generate Foundry tests for the active file. Use forge-std/Test.sol, include setUp(), happy-path tests, edge cases, and at least one fuzz test. Output a complete .t.sol file.'
		);
	}

	optimizeGas(): void {
		this.runQuickPrompt(
			'Analyze the selected code for gas optimization opportunities. For each suggestion: explain the saving, show the before/after diff, and note any tradeoffs (readability, security).',
			'Analyze the active file for gas optimization opportunities. For each suggestion: explain the saving, show the before/after diff, and note any tradeoffs (readability, security).'
		);
	}

	explainError(): void {
		this.runQuickPrompt(
			'The selected text is an error message or stack trace. Explain what it means, what likely caused it, and how to fix it.',
			'There may be an error visible in the active file. Explain what it means, what likely caused it, and how to fix it.'
		);
	}

	generateNatSpec(): void {
		this.runQuickPrompt(
			'Generate complete NatSpec documentation for the selected code. Include @notice, @dev, @param, @return, and @custom:security tags where relevant. Output the documented code in full.',
			'Generate complete NatSpec documentation for the active file. Include @notice, @dev, @param, @return, and @custom:security tags where relevant. Output the documented code in full.'
		);
	}

	summarizeFunction(): void {
		this.runQuickPrompt(
			'Summarize the selected function in 2-3 sentences. State what it does, any side effects, and access control. Then list each external call it makes.',
			'Summarize each function in the active file in one sentence each. Group by access level (public/external/internal/private).'
		);
	}

	private runQuickPrompt(withSelection: string, withoutSelection: string): void {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage('Open a file first — Kairu needs context to work with.');
			return;
		}
		this.view?.show?.(true);
		const text = editor.selection.isEmpty ? withoutSelection : withSelection;
		this.sendUserMessage(text);
	}

	private renderHtml(webview: vscode.Webview): string {
		const csp = [
			`default-src 'none'`,
			`style-src ${webview.cspSource} 'unsafe-inline'`,
			`script-src ${webview.cspSource} 'unsafe-inline'`,
			`font-src ${webview.cspSource}`
		].join('; ');

		const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'chat.css'));
		const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'chat.js'));

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<link rel="stylesheet" href="${cssUri}">
	<title>Kairu AI</title>
</head>
<body>
	<header class="kairu-header">
		<button class="kairu-pill" id="provider-pill" title="Switch provider"></button>
		<button class="kairu-pill" id="model-pill" title="Switch model"></button>
		<div class="kairu-header-spacer"></div>
		<button class="kairu-icon-btn" id="clear-btn" title="Clear conversation">
			<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
				<path d="M3 4h10M5.5 4V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1M4 4l1 9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l1-9"/>
			</svg>
		</button>
	</header>
	<main id="messages" class="kairu-messages"></main>
	<footer class="kairu-input-bar">
		<div id="context-bar" class="kairu-context-bar" hidden></div>
		<div class="kairu-input-wrap">
			<textarea id="input" class="kairu-input" placeholder="Ask Kairu about your code..." rows="1"></textarea>
			<button class="kairu-send" id="send-btn" title="Send (↵)">
				<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
					<path d="M8 13V3M3 8l5-5 5 5"/>
				</svg>
			</button>
		</div>
		<div class="kairu-input-hint">
			<span id="hint-context">No file open</span>
			<span><kbd>↵</kbd> send · <kbd>⇧↵</kbd> newline</span>
		</div>
	</footer>
	<script src="${jsUri}"></script>
</body>
</html>`;
	}
}
