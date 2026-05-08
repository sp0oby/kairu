/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { AIProvider, ChatChunk, ChatRequest, ProviderError, ProviderId } from './types';

interface OllamaChatStreamMessage {
	message?: { role: string; content: string };
	done?: boolean;
	error?: string;
}

interface OllamaTagsResponse {
	models?: Array<{ name: string; size?: number; modified_at?: string }>;
}

export class OllamaProvider implements AIProvider {
	readonly id: ProviderId = 'ollama';
	readonly displayName = 'Ollama (local)';
	readonly requiresApiKey = false;

	constructor(private readonly endpoint: string) {}

	async listModels(): Promise<string[]> {
		const url = this.normalize(`${this.endpoint}/api/tags`);
		try {
			const res = await fetch(url, { method: 'GET' });
			if (!res.ok) {
				throw new ProviderError(`Ollama responded ${res.status}: ${await res.text()}`);
			}
			const data = (await res.json()) as OllamaTagsResponse;
			return (data.models ?? []).map(m => m.name).sort();
		} catch (err) {
			if (err instanceof ProviderError) {
				throw err;
			}
			throw new ProviderError(
				`Cannot reach Ollama at ${this.endpoint}. Is it running? Try: curl ${this.endpoint}/api/tags`,
				err
			);
		}
	}

	async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
		const url = this.normalize(`${this.endpoint}/api/chat`);
		const body = {
			model: request.model,
			messages: request.messages.map(m => ({ role: m.role, content: m.content })),
			stream: true,
			options: request.maxTokens ? { num_predict: request.maxTokens } : undefined
		};

		let res: Response;
		try {
			res = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal: request.signal
			});
		} catch (err) {
			throw new ProviderError(`Ollama request failed: ${(err as Error).message}`, err);
		}

		if (!res.ok || !res.body) {
			throw new ProviderError(`Ollama returned ${res.status}: ${await res.text()}`);
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

			let newlineIndex: number;
			while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				if (!line) {
					continue;
				}
				let parsed: OllamaChatStreamMessage;
				try {
					parsed = JSON.parse(line) as OllamaChatStreamMessage;
				} catch {
					continue;
				}
				if (parsed.error) {
					throw new ProviderError(`Ollama error: ${parsed.error}`);
				}
				if (parsed.message?.content) {
					yield { delta: parsed.message.content };
				}
				if (parsed.done) {
					return;
				}
			}
		}
	}

	private normalize(url: string): string {
		return url.replace(/([^:]\/)\/+/g, '$1');
	}
}
