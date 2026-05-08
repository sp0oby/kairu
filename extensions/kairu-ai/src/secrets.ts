/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ProviderId } from './providers/types';

const KEY_PREFIX = 'kairu.ai.apiKey.';

export class SecretsManager {
	constructor(private readonly storage: vscode.SecretStorage) {}

	async get(provider: ProviderId): Promise<string | undefined> {
		return this.storage.get(KEY_PREFIX + provider);
	}

	async set(provider: ProviderId, key: string): Promise<void> {
		await this.storage.store(KEY_PREFIX + provider, key);
	}

	async delete(provider: ProviderId): Promise<void> {
		await this.storage.delete(KEY_PREFIX + provider);
	}

	onDidChange(listener: (provider: ProviderId) => void): vscode.Disposable {
		return this.storage.onDidChange(e => {
			if (e.key.startsWith(KEY_PREFIX)) {
				listener(e.key.slice(KEY_PREFIX.length) as ProviderId);
			}
		});
	}
}
