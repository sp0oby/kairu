/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { AIProvider, ChatChunk, ChatRequest, ProviderError, ProviderId } from './types';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const KNOWN_MODELS = [
	'claude-opus-4-7',
	'claude-sonnet-4-6',
	'claude-haiku-4-5-20251001'
];

interface AnthropicSSEEvent {
	type: string;
	delta?: { type: string; text?: string };
	error?: { type: string; message: string };
}

export class AnthropicProvider implements AIProvider {
	readonly id: ProviderId = 'anthropic';
	readonly displayName = 'Anthropic Claude';
	readonly requiresApiKey = true;

	constructor(private readonly apiKey: string) {}

	async listModels(): Promise<string[]> {
		// Anthropic does not expose a stable list-models endpoint for all keys;
		// return the known set. Users can also type any model id manually.
		return KNOWN_MODELS;
	}

	async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
		const systemMessage = request.messages.find(m => m.role === 'system')?.content;
		const conversation = request.messages.filter(m => m.role !== 'system');

		const body = {
			model: request.model,
			max_tokens: request.maxTokens ?? 4096,
			system: systemMessage,
			messages: conversation.map(m => ({ role: m.role, content: m.content })),
			stream: true
		};

		let res: Response;
		try {
			res = await fetch(ANTHROPIC_API, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': this.apiKey,
					'anthropic-version': ANTHROPIC_VERSION
				},
				body: JSON.stringify(body),
				signal: request.signal
			});
		} catch (err) {
			throw new ProviderError(`Anthropic request failed: ${(err as Error).message}`, err);
		}

		if (!res.ok || !res.body) {
			const errText = await res.text();
			throw new ProviderError(`Anthropic returned ${res.status}: ${errText}`);
		}

		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			const { value, done } = await reader.read();
			if (done) {
				break;
			}
			buffer += decoder.decode(value, { stream: true });

			let eventBoundary: number;
			while ((eventBoundary = buffer.indexOf('\n\n')) !== -1) {
				const rawEvent = buffer.slice(0, eventBoundary);
				buffer = buffer.slice(eventBoundary + 2);

				const dataLines = rawEvent
					.split('\n')
					.filter(line => line.startsWith('data: '))
					.map(line => line.slice('data: '.length));

				for (const dataLine of dataLines) {
					if (dataLine === '[DONE]') {
						return;
					}
					let parsed: AnthropicSSEEvent;
					try {
						parsed = JSON.parse(dataLine) as AnthropicSSEEvent;
					} catch {
						continue;
					}
					if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta' && parsed.delta.text) {
						yield { delta: parsed.delta.text };
					} else if (parsed.type === 'message_stop') {
						return;
					} else if (parsed.type === 'error' && parsed.error) {
						throw new ProviderError(`Anthropic error: ${parsed.error.message}`);
					}
				}
			}
		}
	}
}
