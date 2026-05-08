/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { AIProvider, ChatChunk, ChatRequest, ProviderError, ProviderId } from './types';

interface OpenAISSEEvent {
	choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
	error?: { message: string; type?: string };
}

interface OpenAIModelsResponse {
	data?: Array<{ id: string }>;
}

export class OpenAIProvider implements AIProvider {
	readonly id: ProviderId;
	readonly displayName: string;
	readonly requiresApiKey: boolean;

	constructor(
		id: ProviderId,
		private readonly endpoint: string,
		private readonly apiKey: string | undefined
	) {
		this.id = id;
		this.displayName = id === 'openai' ? 'OpenAI' : 'OpenAI-compatible';
		this.requiresApiKey = id === 'openai';
	}

	async listModels(): Promise<string[]> {
		const url = this.normalize(`${this.endpoint}/models`);
		try {
			const res = await fetch(url, {
				method: 'GET',
				headers: this.authHeaders()
			});
			if (!res.ok) {
				return [];
			}
			const data = (await res.json()) as OpenAIModelsResponse;
			return (data.data ?? []).map(m => m.id).sort();
		} catch {
			return [];
		}
	}

	async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
		const url = this.normalize(`${this.endpoint}/chat/completions`);
		const body = {
			model: request.model,
			messages: request.messages.map(m => ({ role: m.role, content: m.content })),
			max_tokens: request.maxTokens,
			stream: true
		};

		let res: Response;
		try {
			res = await fetch(url, {
				method: 'POST',
				headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal: request.signal
			});
		} catch (err) {
			throw new ProviderError(`OpenAI request failed: ${(err as Error).message}`, err);
		}

		if (!res.ok || !res.body) {
			throw new ProviderError(`OpenAI returned ${res.status}: ${await res.text()}`);
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
					let parsed: OpenAISSEEvent;
					try {
						parsed = JSON.parse(dataLine) as OpenAISSEEvent;
					} catch {
						continue;
					}
					if (parsed.error) {
						throw new ProviderError(`OpenAI error: ${parsed.error.message}`);
					}
					const delta = parsed.choices?.[0]?.delta?.content;
					if (delta) {
						yield { delta };
					}
					if (parsed.choices?.[0]?.finish_reason) {
						return;
					}
				}
			}
		}
	}

	private authHeaders(): Record<string, string> {
		return this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {};
	}

	private normalize(url: string): string {
		return url.replace(/([^:]\/)\/+/g, '$1');
	}
}
