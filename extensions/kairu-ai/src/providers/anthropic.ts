/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { AIProvider, ChatChunk, ChatMessage, ChatRequest, MessageContentBlock, ProviderError, ProviderId } from './types';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const KNOWN_MODELS = [
	'claude-opus-4-7',
	'claude-sonnet-4-6',
	'claude-haiku-4-5-20251001'
];

interface AnthropicSSEEvent {
	type: string;
	index?: number;
	delta?: {
		type: string;
		text?: string;
		partial_json?: string;
		stop_reason?: string;
	};
	content_block?: {
		type: string;
		id?: string;
		name?: string;
		input?: Record<string, unknown>;
	};
	error?: { type: string; message: string };
}

// Convert our generic ChatMessage into the Anthropic Messages API shape.
// Anthropic accepts `content` as either a string (simple text) or an array of blocks.
function toAnthropicMessage(msg: ChatMessage): { role: string; content: unknown } | null {
	if (msg.role === 'system') {
		return null; // system goes in top-level `system` field
	}

	if (msg.role === 'tool') {
		// Tool results are sent as user-role messages with tool_result content blocks
		return {
			role: 'user',
			content: [{
				type: 'tool_result',
				tool_use_id: msg.toolUseId ?? '',
				content: typeof msg.content === 'string' ? msg.content : '',
			}],
		};
	}

	if (typeof msg.content === 'string') {
		return { role: msg.role, content: msg.content };
	}

	// content is already an array of blocks (assistant turns with tool_use, etc.)
	return { role: msg.role, content: msg.content };
}

export class AnthropicProvider implements AIProvider {
	readonly id: ProviderId = 'anthropic';
	readonly displayName = 'Anthropic Claude';
	readonly requiresApiKey = true;
	readonly supportsTools = true;

	constructor(private readonly apiKey: string) {}

	async listModels(): Promise<string[]> {
		return KNOWN_MODELS;
	}

	async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
		const systemMessage = request.messages.find(m => m.role === 'system');
		const systemContent = typeof systemMessage?.content === 'string' ? systemMessage.content : undefined;

		const conversation = request.messages
			.filter(m => m.role !== 'system')
			.map(toAnthropicMessage)
			.filter((m): m is { role: string; content: unknown } => m !== null);

		const body: Record<string, unknown> = {
			model: request.model,
			max_tokens: request.maxTokens ?? 4096,
			messages: conversation,
			stream: true,
		};
		if (systemContent) {
			body.system = systemContent;
		}
		if (request.tools && request.tools.length > 0) {
			body.tools = request.tools;
		}

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

		// Track tool_use blocks while streaming. Each content_block_start with type=tool_use
		// begins a tool call; subsequent input_json_delta events accumulate the JSON.
		const toolBlocks = new Map<number, { id: string; name: string; jsonBuf: string }>();

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

					if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
						toolBlocks.set(parsed.index ?? 0, {
							id: parsed.content_block.id ?? '',
							name: parsed.content_block.name ?? '',
							jsonBuf: '',
						});
					} else if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta' && parsed.delta.text) {
						yield { delta: parsed.delta.text };
					} else if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'input_json_delta' && parsed.delta.partial_json !== undefined) {
						const block = toolBlocks.get(parsed.index ?? 0);
						if (block) {
							block.jsonBuf += parsed.delta.partial_json;
						}
					} else if (parsed.type === 'content_block_stop') {
						const block = toolBlocks.get(parsed.index ?? 0);
						if (block) {
							let input: Record<string, unknown> = {};
							try {
								input = block.jsonBuf ? JSON.parse(block.jsonBuf) : {};
							} catch {
								input = { __raw: block.jsonBuf };
							}
							yield { toolCall: { id: block.id, name: block.name, input } };
							toolBlocks.delete(parsed.index ?? 0);
						}
					} else if (parsed.type === 'message_delta' && parsed.delta?.stop_reason) {
						const reason = parsed.delta.stop_reason;
						if (reason === 'tool_use' || reason === 'end_turn' || reason === 'max_tokens' || reason === 'stop_sequence') {
							yield { stop: reason };
						} else {
							yield { stop: 'other' };
						}
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

// Helper: re-export so callers can build assistant turns containing tool_use blocks
export type AnthropicMessageContent = MessageContentBlock;
