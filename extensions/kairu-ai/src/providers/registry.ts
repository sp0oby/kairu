/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SecretsManager } from '../secrets';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { OllamaProvider } from './ollama';
import { OpenAIProvider } from './openai';
import { AIProvider, ProviderError, ProviderId } from './types';

export const PROVIDER_DISPLAY_NAMES: Record<ProviderId, string> = {
	'anthropic': 'Anthropic Claude',
	'openai': 'OpenAI',
	'gemini': 'Google Gemini',
	'ollama': 'Ollama (local)',
	'openai-compatible': 'OpenAI-compatible (custom)',
	'openrouter': 'OpenRouter'
};

export const ALL_PROVIDER_IDS: ProviderId[] = ['anthropic', 'openrouter', 'openai', 'gemini', 'ollama', 'openai-compatible'];

export async function buildProvider(secrets: SecretsManager): Promise<AIProvider> {
	const config = vscode.workspace.getConfiguration('kairu.ai');
	const id = config.get<ProviderId>('provider', 'anthropic');

	switch (id) {
		case 'anthropic': {
			const key = await secrets.get('anthropic');
			if (!key) {
				throw new ProviderError('No Anthropic API key set. Run "Kairu: Setup AI" or "Kairu: Set AI Provider API Key".');
			}
			return new AnthropicProvider(key);
		}
		case 'openai': {
			const key = await secrets.get('openai');
			if (!key) {
				throw new ProviderError('No OpenAI API key set. Run "Kairu: Setup AI".');
			}
			return new OpenAIProvider('openai', 'https://api.openai.com/v1', key);
		}
		case 'gemini': {
			const key = await secrets.get('gemini');
			if (!key) {
				throw new ProviderError('No Google Gemini API key set. Run "Kairu: Setup AI".');
			}
			return new GeminiProvider(key);
		}
		case 'ollama': {
			const endpoint = config.get<string>('ollama.endpoint', 'http://localhost:11434');
			return new OllamaProvider(endpoint);
		}
		case 'openai-compatible': {
			const endpoint = config.get<string>('openaiCompatible.endpoint', '');
			if (!endpoint) {
				throw new ProviderError('No OpenAI-compatible endpoint set. Configure "kairu.ai.openaiCompatible.endpoint".');
			}
			const key = await secrets.get('openai-compatible');
			return new OpenAIProvider('openai-compatible', endpoint, key);
		}
		case 'openrouter': {
			const key = await secrets.get('openrouter');
			if (!key) {
				throw new ProviderError('No OpenRouter API key set. Run "Kairu: Setup AI" or "Kairu: Set AI Provider API Key".');
			}
			return new OpenAIProvider('openrouter', 'https://openrouter.ai/api/v1', key);
		}
		default:
			throw new ProviderError(`Unknown provider: ${id}`);
	}
}
