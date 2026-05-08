/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { AIProvider, ChatChunk, ChatRequest, ProviderError, ProviderId } from './types';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const KNOWN_MODELS = [
	'gemini-2.5-pro',
	'gemini-2.5-flash',
	'gemini-2.0-flash',
	'gemini-2.0-flash-thinking-exp',
	'gemini-1.5-pro',
	'gemini-1.5-flash'
];

interface GeminiSSEEvent {
	candidates?: Array<{
		content?: { parts?: Array<{ text?: string }> };
		finishReason?: string;
	}>;
	error?: { message?: string; code?: number; status?: string };
}

export class GeminiProvider implements AIProvider {
	readonly id: ProviderId = 'gemini';
	readonly displayName = 'Google Gemini';
	readonly requiresApiKey = true;

	constructor(private readonly apiKey: string) {}

	async listModels(): Promise<string[]> {
		try {
			const res = await fetch(`${GEMINI_API_BASE}/models?key=${encodeURIComponent(this.apiKey)}`);
			if (!res.ok) {
				return KNOWN_MODELS;
			}
			const data = (await res.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
			const models = (data.models ?? [])
				.filter(m => (m.supportedGenerationMethods ?? []).includes('generateContent'))
				.map(m => m.name.replace(/^models\//, ''))
				.sort();
			return models.length > 0 ? models : KNOWN_MODELS;
		} catch {
			return KNOWN_MODELS;
		}
	}

	async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
		const systemMessage = request.messages.find(m => m.role === 'system')?.content;
		const conversation = request.messages.filter(m => m.role !== 'system');

		const body: Record<string, unknown> = {
			contents: conversation.map(m => ({
				role: m.role === 'assistant' ? 'model' : 'user',
				parts: [{ text: m.content }]
			})),
			generationConfig: {
				maxOutputTokens: request.maxTokens ?? 4096
			}
		};
		if (systemMessage) {
			body.systemInstruction = { parts: [{ text: systemMessage }] };
		}

		const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`;

		let res: Response;
		try {
			res = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal: request.signal
			});
		} catch (err) {
			throw new ProviderError(`Gemini request failed: ${(err as Error).message}`, err);
		}

		if (!res.ok || !res.body) {
			throw new ProviderError(`Gemini returned ${res.status}: ${await res.text()}`);
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
					let parsed: GeminiSSEEvent;
					try {
						parsed = JSON.parse(dataLine) as GeminiSSEEvent;
					} catch {
						continue;
					}
					if (parsed.error) {
						throw new ProviderError(`Gemini error: ${parsed.error.message ?? parsed.error.status}`);
					}
					const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
					if (text) {
						yield { delta: text };
					}
					if (parsed.candidates?.[0]?.finishReason) {
						return;
					}
				}
			}
		}
	}
}
