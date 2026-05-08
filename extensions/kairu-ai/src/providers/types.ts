/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'openai-compatible';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | MessageContentBlock[];
	/** For tool result messages — links the result back to the tool_use id */
	toolUseId?: string;
}

export type MessageContentBlock =
	| { type: 'text'; text: string }
	| { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
	| { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface ToolDefinition {
	/** Tool identifier the model uses */
	name: string;
	/** Human-readable description shown to the model */
	description: string;
	/** JSON schema for the tool's input arguments */
	input_schema: {
		type: 'object';
		properties: Record<string, unknown>;
		required?: string[];
	};
}

export interface ChatRequest {
	model: string;
	messages: ChatMessage[];
	maxTokens?: number;
	signal?: AbortSignal;
	/** Optional list of tools the model can call */
	tools?: ToolDefinition[];
}

export interface ToolCall {
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface ChatChunk {
	/** Text token delta to append to the visible message */
	delta?: string;
	/** A complete tool call the model wants to make */
	toolCall?: ToolCall;
	/** Stop reason when the stream ends ('end_turn' = done, 'tool_use' = caller must run tools and continue) */
	stop?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'other';
}

export interface AIProvider {
	readonly id: ProviderId;
	readonly displayName: string;
	readonly requiresApiKey: boolean;
	/** Whether this provider supports tool/function calling */
	readonly supportsTools?: boolean;

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
