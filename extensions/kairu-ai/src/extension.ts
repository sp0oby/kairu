/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { KairuChatViewProvider } from './chat/chatViewProvider';
import { ALL_PROVIDER_IDS, PROVIDER_DISPLAY_NAMES } from './providers/registry';
import { OllamaProvider } from './providers/ollama';
import { OpenAIProvider } from './providers/openai';
import { GeminiProvider } from './providers/gemini';
import { ProviderId } from './providers/types';
import { SecretsManager } from './secrets';
import { runSetupWizard } from './setupWizard';
import { SemanticIndex } from './semantic/index';
import { KairuInlineCompletionProvider } from './inline/completionProvider';
import { KairuStaticCompletionProvider } from './inline/staticCompletionProvider';
import { generateCommitMessage } from './commitMessage';

export function activate(context: vscode.ExtensionContext): void {
	const secrets = new SecretsManager(context.secrets);
	const semanticIndex = new SemanticIndex(context);
	const chatProvider = new KairuChatViewProvider(context.extensionUri, secrets, semanticIndex);

	// Start semantic indexing in the background (non-blocking)
	semanticIndex.startWatching().catch(() => { /* silently ignore startup errors */ });

	const completionLanguages = [
		{ language: 'solidity' },
		{ language: 'vyper' },
		{ language: 'typescript' },
		{ language: 'javascript' },
		{ language: 'json' },
		{ language: 'rust' },
	];

	// Static (non-AI) inline completions — patterns like "pragma" → "pragma solidity ^0.8.24;"
	// On by default, free, instant. Acts as the first-class "Copilot lite" feel.
	context.subscriptions.push(
		vscode.languages.registerInlineCompletionItemProvider(
			completionLanguages,
			new KairuStaticCompletionProvider()
		)
	);

	// AI ghost-text inline completions (opt-in, costs API tokens per fire).
	// Off by default — user explicitly enables via `Kairu: Toggle Inline AI Completions`.
	context.subscriptions.push(
		vscode.languages.registerInlineCompletionItemProvider(
			completionLanguages,
			new KairuInlineCompletionProvider(secrets)
		)
	);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(KairuChatViewProvider.viewType, chatProvider, {
			webviewOptions: { retainContextWhenHidden: true }
		}),

		vscode.window.onDidChangeActiveTextEditor(() => chatProvider.updateContext()),
		vscode.window.onDidChangeTextEditorSelection(() => chatProvider.updateContext()),
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('kairu.ai')) {
				chatProvider.updateContext();
			}
		}),

		vscode.commands.registerCommand('kairu.ai.openChat', async () => {
			await vscode.commands.executeCommand('kairu.chat.focus');
		}),

		vscode.commands.registerCommand('kairu.ai.setup', async () => {
			await runSetupWizard(secrets);
		}),

		vscode.commands.registerCommand('kairu.ai.generateCommitMessage', async () => {
			await generateCommitMessage(secrets);
		}),

		vscode.commands.registerCommand('kairu.ai.toggleInlineCompletions', async () => {
			const config = vscode.workspace.getConfiguration('kairu.ai');
			const current = config.get<boolean>('inlineCompletions.enabled', false);
			await config.update('inlineCompletions.enabled', !current, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`Kairu inline completions: ${!current ? 'enabled' : 'disabled'}`);
		}),

		vscode.commands.registerCommand('kairu.ai.clearChat', () => {
			chatProvider.clearSession();
		}),

		vscode.commands.registerCommand('kairu.ai.explainSelection', () => chatProvider.explainSelection()),
		vscode.commands.registerCommand('kairu.ai.findVulnerabilities', () => chatProvider.findVulnerabilities()),
		vscode.commands.registerCommand('kairu.ai.generateFoundryTests', () => chatProvider.generateFoundryTests()),
		vscode.commands.registerCommand('kairu.ai.optimizeGas', () => chatProvider.optimizeGas()),
		vscode.commands.registerCommand('kairu.ai.explainError', () => chatProvider.explainError()),
		vscode.commands.registerCommand('kairu.ai.generateNatSpec', () => chatProvider.generateNatSpec()),
		vscode.commands.registerCommand('kairu.ai.summarizeFunction', () => chatProvider.summarizeFunction()),

		vscode.commands.registerCommand('kairu.ai.selectProvider', async () => {
			const items = ALL_PROVIDER_IDS.map(id => ({ label: PROVIDER_DISPLAY_NAMES[id], id }));
			const picked = await vscode.window.showQuickPick(items, {
				placeHolder: 'Select Kairu AI provider'
			});
			if (!picked) {
				return;
			}
			await vscode.workspace
				.getConfiguration('kairu.ai')
				.update('provider', picked.id, vscode.ConfigurationTarget.Global);
			// Reset model since it was provider-specific
			await vscode.workspace
				.getConfiguration('kairu.ai')
				.update('model', '', vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`Kairu provider: ${picked.label}`);
		}),

		vscode.commands.registerCommand('kairu.ai.selectModel', async () => {
			const config = vscode.workspace.getConfiguration('kairu.ai');
			const providerId = config.get<ProviderId>('provider', 'ollama');
			let suggestions: string[] = [];

			try {
				if (providerId === 'ollama') {
					const endpoint = config.get<string>('ollama.endpoint', 'http://localhost:11434');
					suggestions = await new OllamaProvider(endpoint).listModels();
				} else if (providerId === 'anthropic') {
					suggestions = ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
				} else if (providerId === 'gemini') {
					const key = await secrets.get('gemini');
					if (key) {
						suggestions = await new GeminiProvider(key).listModels();
					}
					if (suggestions.length === 0) {
						suggestions = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'];
					}
				} else if (providerId === 'openai') {
					const key = await secrets.get('openai');
					if (key) {
						suggestions = await new OpenAIProvider('openai', 'https://api.openai.com/v1', key).listModels();
					}
					if (suggestions.length === 0) {
						suggestions = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];
					}
				} else if (providerId === 'openai-compatible') {
					const endpoint = config.get<string>('openaiCompatible.endpoint', '');
					if (endpoint) {
						const key = await secrets.get('openai-compatible');
						suggestions = await new OpenAIProvider('openai-compatible', endpoint, key).listModels();
					}
				}
			} catch (err) {
				vscode.window.showWarningMessage(`Could not list models: ${(err as Error).message}`);
			}

			let picked: string | undefined;
			if (suggestions.length > 0) {
				const items: vscode.QuickPickItem[] = [
					...suggestions.map(name => ({ label: name })),
					{ label: '$(edit) Enter custom model name...' }
				];
				const choice = await vscode.window.showQuickPick(items, {
					placeHolder: `Select model for ${PROVIDER_DISPLAY_NAMES[providerId]}`
				});
				if (!choice) {
					return;
				}
				if (choice.label.startsWith('$(edit)')) {
					picked = await vscode.window.showInputBox({ prompt: 'Model identifier' });
				} else {
					picked = choice.label;
				}
			} else {
				picked = await vscode.window.showInputBox({
					prompt: `Model identifier for ${PROVIDER_DISPLAY_NAMES[providerId]}`
				});
			}

			if (picked) {
				await vscode.workspace
					.getConfiguration('kairu.ai')
					.update('model', picked, vscode.ConfigurationTarget.Global);
				vscode.window.showInformationMessage(`Kairu model: ${picked}`);
			}
		}),

		vscode.commands.registerCommand('kairu.ai.setApiKey', async () => {
			const items = (['anthropic', 'openai', 'gemini', 'openai-compatible'] as ProviderId[]).map(id => ({
				label: PROVIDER_DISPLAY_NAMES[id],
				id
			}));
			const picked = await vscode.window.showQuickPick(items, {
				placeHolder: 'Select provider to set API key for'
			});
			if (!picked) {
				return;
			}
			const key = await vscode.window.showInputBox({
				prompt: `Enter API key for ${picked.label}`,
				password: true,
				ignoreFocusOut: true
			});
			if (!key) {
				return;
			}
			await secrets.set(picked.id, key);
			vscode.window.showInformationMessage(
				`Kairu: API key for ${picked.label} stored in OS keychain.`
			);
		}),

		vscode.commands.registerCommand('kairu.ai.importApiKey', async (provider: string, value: string) => {
			if (!provider || !value) { return; }
			const valid: ProviderId[] = ['anthropic', 'openai', 'gemini', 'openai-compatible'];
			if (!valid.includes(provider as ProviderId)) { return; }
			await secrets.set(provider as ProviderId, value);
		}),

		vscode.commands.registerCommand('kairu.ai.deleteApiKey', async () => {
			const items = (['anthropic', 'openai', 'gemini', 'openai-compatible'] as ProviderId[]).map(id => ({
				label: PROVIDER_DISPLAY_NAMES[id],
				id
			}));
			const picked = await vscode.window.showQuickPick(items, {
				placeHolder: 'Select provider whose API key to delete'
			});
			if (!picked) {
				return;
			}
			await secrets.delete(picked.id);
			vscode.window.showInformationMessage(
				`Kairu: API key for ${picked.label} removed from OS keychain.`
			);
		})
	);
}

export function deactivate(): void {
	// nothing to clean up
}
