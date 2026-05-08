/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'openai-compatible';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface ChatRequest {
	model: string;
	messages: ChatMessage[];
	maxTokens?: number;
	signal?: AbortSignal;
}

export interface ChatChunk {
	delta: string;
}

export interface AIProvider {
	readonly id: ProviderId;
	readonly displayName: string;
	readonly requiresApiKey: boolean;

	listModels(): Promise<string[]>;
	chat(request: ChatRequest): AsyncIterable<ChatChunk>;
}

export class ProviderError extends Error {
	override readonly cause?: unknown;
	constructor(message: string, cause?: unknown) {
		super(message);
		this.name = 'ProviderError';
		this.cause = cause;
	}
}
