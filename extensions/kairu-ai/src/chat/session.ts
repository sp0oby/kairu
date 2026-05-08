/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { ChatMessage } from '../providers/types';

export interface SessionMessage extends ChatMessage {
	id: string;
	timestamp: number;
}

export class ChatSession {
	private messages: SessionMessage[] = [];

	getMessages(): readonly SessionMessage[] {
		return this.messages;
	}

	getChatMessages(): ChatMessage[] {
		return this.messages.map(({ role, content }) => ({ role, content }));
	}

	add(role: ChatMessage['role'], content: string): SessionMessage {
		const message: SessionMessage = {
			id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			role,
			content,
			timestamp: Date.now()
		};
		this.messages.push(message);
		return message;
	}

	appendToLast(delta: string): SessionMessage | undefined {
		const last = this.messages[this.messages.length - 1];
		if (!last || last.role !== 'assistant') {
			return undefined;
		}
		last.content += delta;
		return last;
	}

	clear(): void {
		this.messages = [];
	}
}
