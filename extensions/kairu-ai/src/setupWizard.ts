/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { GeminiProvider } from './providers/gemini';
import { OllamaProvider } from './providers/ollama';
import { OpenAIProvider } from './providers/openai';
import { ProviderId } from './providers/types';
import { SecretsManager } from './secrets';

const KNOWN_ANTHROPIC_MODELS = [
	'claude-opus-4-7',
	'claude-sonnet-4-6',
	'claude-haiku-4-5-20251001'
];

const KNOWN_OPENAI_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini'];

const KNOWN_GEMINI_MODELS = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'];

const PROVIDER_KEY_HELP: Record<string, { url: string; placeholder: string; label: string }> = {
	anthropic: { url: 'https://console.anthropic.com/settings/keys', placeholder: 'sk-ant-...', label: 'Anthropic Console' },
	openai: { url: 'https://platform.openai.com/api-keys', placeholder: 'sk-...', label: 'OpenAI Dashboard' },
	gemini: { url: 'https://aistudio.google.com/app/apikey', placeholder: 'AIza...', label: 'Google AI Studio' }
};

/**
 * Guided AI setup. Walks the user through:
 *   1. Pick local (Ollama) or cloud (Anthropic / OpenAI / compatible)
 *   2. If cloud: enter API key
 *   3. Pick a model
 *
 * Returns true if setup completed (provider + model are valid).
 */
export async function runSetupWizard(secrets: SecretsManager): Promise<boolean> {
	const config = vscode.workspace.getConfiguration('kairu.ai');

	const providerChoice = await vscode.window.showQuickPick(
		[
			{
				label: '$(sparkle) Anthropic Claude',
				description: 'Recommended · Best for code reasoning and audits',
				detail: 'Get a key: console.anthropic.com',
				id: 'anthropic' as ProviderId
			},
			{
				label: '$(symbol-event) OpenAI',
				description: 'GPT-4o, o1 — broad model lineup',
				detail: 'Get a key: platform.openai.com/api-keys',
				id: 'openai' as ProviderId
			},
			{
				label: '$(symbol-color) Google Gemini',
				description: '2.5 Pro / Flash — fast, generous free tier',
				detail: 'Get a key: aistudio.google.com/app/apikey',
				id: 'gemini' as ProviderId
			},
			{
				label: '$(server) OpenAI-compatible (custom)',
				description: 'Self-hosted vLLM, OpenRouter, LM Studio, etc.',
				detail: 'For enterprise / custom deployments',
				id: 'openai-compatible' as ProviderId
			},
			{
				label: '$(home) Ollama — Local (advanced)',
				description: 'Run models on your machine — fully offline',
				detail: 'Heavy: requires Ollama install + GBs of model downloads',
				id: 'ollama' as ProviderId
			}
		],
		{ placeHolder: 'Connect Kairu AI — which model provider?', ignoreFocusOut: true }
	);
	if (!providerChoice) {
		return false;
	}

	const providerId = providerChoice.id;
	await config.update('provider', providerId, vscode.ConfigurationTarget.Global);

	// Cloud providers need an API key
	if (providerId === 'anthropic' || providerId === 'openai' || providerId === 'gemini') {
		const help = PROVIDER_KEY_HELP[providerId];
		const existingKey = await secrets.get(providerId);
		let key = existingKey;
		if (!key) {
			const action = await vscode.window.showInformationMessage(
				`To use ${providerChoice.label.replace(/\$\([^)]+\)\s?/, '')}, paste your API key (it's stored encrypted in your macOS Keychain — never sent anywhere except the API).`,
				{ modal: false },
				'Paste API Key',
				`Open ${help.label}`,
				'Cancel'
			);
			if (action === `Open ${help.label}`) {
				vscode.env.openExternal(vscode.Uri.parse(help.url));
				// give them a chance to come back with the key
				const retry = await vscode.window.showInformationMessage(
					'Once you have the key copied, click below to paste it.',
					{ modal: false },
					'Paste API Key',
					'Cancel'
				);
				if (retry !== 'Paste API Key') {
					return false;
				}
			} else if (action !== 'Paste API Key') {
				return false;
			}

			key = await vscode.window.showInputBox({
				prompt: `Paste ${providerChoice.label.replace(/\$\([^)]+\)\s?/, '')} API key`,
				placeHolder: help.placeholder,
				password: true,
				ignoreFocusOut: true,
				validateInput: v => v.trim().length === 0 ? 'API key required' : null
			});
			if (!key) {
				return false;
			}
			await secrets.set(providerId, key);
		}
	}

	if (providerId === 'openai-compatible') {
		const endpoint = await vscode.window.showInputBox({
			prompt: 'Enter your OpenAI-compatible endpoint URL',
			placeHolder: 'https://your-server.example.com/v1',
			ignoreFocusOut: true,
			validateInput: v => v.trim().length === 0 ? 'Endpoint required' : null
		});
		if (!endpoint) {
			return false;
		}
		await config.update('openaiCompatible.endpoint', endpoint, vscode.ConfigurationTarget.Global);

		const needsKey = await vscode.window.showQuickPick(
			[
				{ label: 'Yes — endpoint requires an API key', value: true },
				{ label: 'No — no auth required', value: false }
			],
			{ placeHolder: 'Does this endpoint require an API key?', ignoreFocusOut: true }
		);
		if (needsKey?.value) {
			const key = await vscode.window.showInputBox({
				prompt: 'API key',
				password: true,
				ignoreFocusOut: true
			});
			if (key) {
				await secrets.set('openai-compatible', key);
			}
		}
	}

	// Pick a model
	const model = await pickModel(providerId, secrets);
	if (!model) {
		return false;
	}
	await config.update('model', model, vscode.ConfigurationTarget.Global);

	vscode.window.showInformationMessage(
		`Kairu AI ready: ${providerChoice.label.replace(/\$\([^)]+\)\s?/, '')} · ${model}`
	);
	return true;
}

async function pickModel(providerId: ProviderId, secrets: SecretsManager): Promise<string | undefined> {
	const config = vscode.workspace.getConfiguration('kairu.ai');
	let suggestions: string[] = [];

	if (providerId === 'ollama') {
		const endpoint = config.get<string>('ollama.endpoint', 'http://localhost:11434');
		try {
			suggestions = await new OllamaProvider(endpoint).listModels();
		} catch {
			const choice = await vscode.window.showWarningMessage(
				`Ollama is not running on ${endpoint}.`,
				{ modal: false },
				'Open Ollama Download',
				"I'm running it — retry",
				'Cancel'
			);
			if (choice === 'Open Ollama Download') {
				vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download'));
				return undefined;
			}
			if (choice === "I'm running it — retry") {
				try {
					suggestions = await new OllamaProvider(endpoint).listModels();
				} catch {
					vscode.window.showErrorMessage('Still cannot reach Ollama. Run `ollama serve` in a terminal.');
					return undefined;
				}
			} else {
				return undefined;
			}
		}

		// Ollama running but no models pulled — offer to pull one
		if (suggestions.length === 0) {
			return pullOllamaModelInteractive(endpoint);
		}
	} else if (providerId === 'anthropic') {
		suggestions = KNOWN_ANTHROPIC_MODELS;
	} else if (providerId === 'gemini') {
		const key = await secrets.get('gemini');
		if (key) {
			try {
				suggestions = await new GeminiProvider(key).listModels();
				suggestions = suggestions.filter(m => /^gemini/.test(m));
			} catch {
				suggestions = KNOWN_GEMINI_MODELS;
			}
		}
		if (suggestions.length === 0) {
			suggestions = KNOWN_GEMINI_MODELS;
		}
	} else if (providerId === 'openai') {
		const key = await secrets.get('openai');
		if (key) {
			try {
				suggestions = await new OpenAIProvider('openai', 'https://api.openai.com/v1', key).listModels();
				suggestions = suggestions.filter(m => /^gpt|^o\d|^chatgpt/.test(m));
			} catch {
				suggestions = KNOWN_OPENAI_MODELS;
			}
		}
		if (suggestions.length === 0) {
			suggestions = KNOWN_OPENAI_MODELS;
		}
	} else if (providerId === 'openai-compatible') {
		const endpoint = config.get<string>('openaiCompatible.endpoint', '');
		const key = await secrets.get('openai-compatible');
		try {
			suggestions = await new OpenAIProvider('openai-compatible', endpoint, key).listModels();
		} catch {
			// fall through to manual entry
		}
	}

	if (suggestions.length > 0) {
		const items: vscode.QuickPickItem[] = [
			...suggestions.map(name => ({ label: name })),
			{ label: '$(edit) Enter custom model name...' }
		];
		const choice = await vscode.window.showQuickPick(items, {
			placeHolder: 'Pick a model',
			ignoreFocusOut: true
		});
		if (!choice) {
			return undefined;
		}
		if (choice.label.startsWith('$(edit)')) {
			return (await vscode.window.showInputBox({ prompt: 'Model identifier', ignoreFocusOut: true }))?.trim() || undefined;
		}
		return choice.label;
	}

	const typed = await vscode.window.showInputBox({
		prompt: 'Model identifier',
		ignoreFocusOut: true
	});
	return typed?.trim() || undefined;
}

const RECOMMENDED_OLLAMA_MODELS = [
	{ label: 'qwen2.5-coder:7b', description: '~4.4 GB · Recommended for Solidity', detail: 'Strong code reasoning for its size; good default if you have ≥ 8GB RAM.' },
	{ label: 'qwen2.5-coder:14b', description: '~9 GB · Larger, better reasoning', detail: 'Best free option if you have ≥ 16GB RAM.' },
	{ label: 'deepseek-coder-v2:16b', description: '~9 GB · Strong code model', detail: 'Alternative to Qwen.' },
	{ label: 'llama3.2:3b', description: '~2 GB · Fast, lightweight', detail: 'Fallback for low-memory machines.' }
];

async function pullOllamaModelInteractive(endpoint: string): Promise<string | undefined> {
	const items: vscode.QuickPickItem[] = [
		...RECOMMENDED_OLLAMA_MODELS,
		{ label: '$(edit) Type a different model name…' }
	];
	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: 'No Ollama models found. Pick one to download (or pick a custom name)',
		ignoreFocusOut: true
	});
	if (!picked) {
		return undefined;
	}

	let modelName = picked.label;
	if (modelName.startsWith('$(edit)')) {
		const typed = await vscode.window.showInputBox({
			prompt: 'Model name (Ollama will pull it)',
			placeHolder: 'qwen2.5-coder:7b',
			ignoreFocusOut: true
		});
		if (!typed) {
			return undefined;
		}
		modelName = typed.trim();
	}

	const ok = await pullOllamaModel(endpoint, modelName);
	return ok ? modelName : undefined;
}

async function pullOllamaModel(endpoint: string, modelName: string): Promise<boolean> {
	return await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Downloading ${modelName}`,
			cancellable: true
		},
		async (progress, token) => {
			try {
				const controller = new AbortController();
				token.onCancellationRequested(() => controller.abort());

				const res = await fetch(`${endpoint.replace(/\/+$/, '')}/api/pull`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name: modelName, stream: true }),
					signal: controller.signal
				});

				if (!res.ok || !res.body) {
					vscode.window.showErrorMessage(`Pull failed: ${res.status} ${await res.text()}`);
					return false;
				}

				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				let buffer = '';
				let lastPercent = 0;

				while (true) {
					const { value, done } = await reader.read();
					if (done) {
						break;
					}
					buffer += decoder.decode(value, { stream: true });
					let nl: number;
					while ((nl = buffer.indexOf('\n')) !== -1) {
						const line = buffer.slice(0, nl).trim();
						buffer = buffer.slice(nl + 1);
						if (!line) {
							continue;
						}
						let evt: { status?: string; total?: number; completed?: number; error?: string };
						try {
							evt = JSON.parse(line);
						} catch {
							continue;
						}
						if (evt.error) {
							vscode.window.showErrorMessage(`Pull error: ${evt.error}`);
							return false;
						}
						if (evt.total && evt.completed !== undefined) {
							const percent = Math.floor((evt.completed / evt.total) * 100);
							const inc = percent - lastPercent;
							if (inc > 0) {
								progress.report({
									increment: inc,
									message: `${evt.status ?? 'downloading'} · ${percent}%`
								});
								lastPercent = percent;
							}
						} else if (evt.status) {
							progress.report({ message: evt.status });
						}
					}
				}
				return true;
			} catch (err) {
				if ((err as Error).name === 'AbortError') {
					vscode.window.showInformationMessage('Model download cancelled.');
					return false;
				}
				vscode.window.showErrorMessage(`Pull failed: ${(err as Error).message}`);
				return false;
			}
		}
	);
}

/**
 * Returns true if the user has finished AI setup (provider + model + key if needed).
 */
export async function isSetupComplete(secrets: SecretsManager): Promise<boolean> {
	const config = vscode.workspace.getConfiguration('kairu.ai');
	const provider = config.get<ProviderId>('provider', 'ollama');
	const model = config.get<string>('model', '');
	if (!model) {
		return false;
	}
	if (provider === 'anthropic') {
		return Boolean(await secrets.get('anthropic'));
	}
	if (provider === 'openai') {
		return Boolean(await secrets.get('openai'));
	}
	if (provider === 'openai-compatible') {
		const endpoint = config.get<string>('openaiCompatible.endpoint', '');
		return Boolean(endpoint);
	}
	return true; // ollama
}
