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

export function activate(context: vscode.ExtensionContext): void {
	const secrets = new SecretsManager(context.secrets);
	const chatProvider = new KairuChatViewProvider(context.extensionUri, secrets);

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
