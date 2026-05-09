/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { AIProvider, ChatChunk, ChatMessage, ChatRequest, MessageContentBlock, ProviderError, ProviderId, ToolCall } from './types';

interface OpenAISSEEvent {
	choices?: Array<{
		delta?: {
			content?: string | null;
			tool_calls?: Array<{
				index?: number;
				id?: string;
				type?: string;
				function?: { name?: string; arguments?: string };
			}>;
		};
		finish_reason?: string | null;
	}>;
	error?: { message: string; type?: string };
}

interface OpenAIModelsResponse {
	data?: Array<{ id: string }>;
}

// Convert a ChatMessage (which may have Anthropic-style content blocks) to OpenAI wire format.
// Returns one or more OpenAI message objects (tool results need to become separate tool messages).
function toOpenAIMessages(msgs: ChatMessage[]): unknown[] {
	const out: unknown[] = [];
	for (const msg of msgs) {
		if (typeof msg.content === 'string') {
			out.push({ role: msg.role, content: msg.content });
			continue;
		}
		// Content is MessageContentBlock[]
		const blocks = msg.content as MessageContentBlock[];

		if (msg.role === 'user') {
			// May be a mix of text and tool_result blocks
			const toolResultBlocks = blocks.filter(b => b.type === 'tool_result');
			const textBlocks = blocks.filter(b => b.type === 'text');
			if (toolResultBlocks.length > 0) {
				// OpenAI: each tool result is a separate message with role='tool'
				for (const b of toolResultBlocks) {
					if (b.type === 'tool_result') {
						out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.content ?? '' });
					}
				}
			}
			if (textBlocks.length > 0) {
				const text = textBlocks.map(b => b.type === 'text' ? b.text : '').join('');
				if (text.trim()) {
					out.push({ role: 'user', content: text });
				}
			}
		} else if (msg.role === 'assistant') {
			// May have text + tool_use blocks
			const textBlocks = blocks.filter(b => b.type === 'text');
			const toolUseBlocks = blocks.filter(b => b.type === 'tool_use');
			const text = textBlocks.map(b => b.type === 'text' ? b.text : '').join('') || null;
			if (toolUseBlocks.length > 0) {
				out.push({
					role: 'assistant',
					content: text,
					tool_calls: toolUseBlocks
						.filter(b => b.type === 'tool_use')
						.map(b => {
							if (b.type !== 'tool_use') { return undefined; }
							return {
								id: b.id,
								type: 'function',
								function: {
									name: b.name,
									arguments: JSON.stringify(b.input),
								},
							};
						})
						.filter(Boolean),
				});
			} else {
				out.push({ role: 'assistant', content: text ?? '' });
			}
		} else {
			// system or other — pass through
			const text = blocks.map(b => b.type === 'text' ? b.text : '').join('');
			out.push({ role: msg.role, content: text });
		}
	}
	return out;
}

export class OpenAIProvider implements AIProvider {
	readonly id: ProviderId;
	readonly displayName: string;
	readonly requiresApiKey: boolean;
	readonly supportsTools = true;

	constructor(
		id: ProviderId,
		private readonly endpoint: string,
		private readonly apiKey: string | undefined
	) {
		this.id = id;
		this.displayName = id === 'openai' ? 'OpenAI' : id === 'openrouter' ? 'OpenRouter' : 'OpenAI-compatible';
		this.requiresApiKey = id === 'openai' || id === 'openrouter';
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

		const body: Record<string, unknown> = {
			model: request.model,
			messages: toOpenAIMessages(request.messages),
			max_tokens: request.maxTokens,
			stream: true,
		};

		if (request.tools && request.tools.length > 0) {
			body.tools = request.tools.map(t => ({
				type: 'function',
				function: {
					name: t.name,
					description: t.description,
					parameters: t.input_schema,
				},
			}));
			body.tool_choice = 'auto';
		}

		// OpenRouter requires specific headers
		const headers: Record<string, string> = {
			...this.authHeaders(),
			'Content-Type': 'application/json',
		};
		if (this.id === 'openrouter') {
			headers['HTTP-Referer'] = 'https://kairu.studio';
			headers['X-Title'] = 'Kairu Studio';
		}

		let res: Response;
		try {
			res = await fetch(url, {
				method: 'POST',
				headers,
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

		// Accumulate streaming tool call arguments (keyed by index)
		const toolCallAccum: Map<number, { id: string; name: string; argsJson: string }> = new Map();

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
						// Emit any accumulated tool calls before returning
						for (const [, tc] of toolCallAccum) {
							let input: Record<string, unknown> = {};
							try { input = JSON.parse(tc.argsJson); } catch { /* leave empty */ }
							const toolCall: ToolCall = { id: tc.id, name: tc.name, input };
							yield { toolCall };
						}
						yield { stop: 'tool_use' as const };
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
					const choice = parsed.choices?.[0];
					if (!choice) { continue; }

					const delta = choice.delta;
					if (delta?.content) {
						yield { delta: delta.content };
					}

					// Accumulate streaming tool call fragments
					if (delta?.tool_calls) {
						for (const tc of delta.tool_calls) {
							const idx = tc.index ?? 0;
							if (!toolCallAccum.has(idx)) {
								toolCallAccum.set(idx, { id: '', name: '', argsJson: '' });
							}
							const acc = toolCallAccum.get(idx)!;
							if (tc.id) { acc.id = tc.id; }
							if (tc.function?.name) { acc.name = tc.function.name; }
							if (tc.function?.arguments) { acc.argsJson += tc.function.arguments; }
						}
					}

					const finishReason = choice.finish_reason;
					if (finishReason === 'tool_calls') {
						// Emit all accumulated tool calls
						for (const [, tc] of toolCallAccum) {
							let input: Record<string, unknown> = {};
							try { input = JSON.parse(tc.argsJson); } catch { /* leave empty */ }
							const toolCall: ToolCall = { id: tc.id, name: tc.name, input };
							yield { toolCall };
						}
						toolCallAccum.clear();
						yield { stop: 'tool_use' as const };
					} else if (finishReason === 'stop' || finishReason === 'length') {
						yield { stop: finishReason === 'stop' ? 'end_turn' : 'max_tokens' };
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
