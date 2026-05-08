/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ToolDefinition } from '../providers/types';

export interface ToolContext {
	workspaceRoot: string | undefined;
	semanticIndex?: import('../semantic/index').SemanticIndex;
}

export interface ToolExecutor {
	definition: ToolDefinition;
	/** Run the tool. Throw on error. Return a string the model will see as the tool result. */
	execute(input: Record<string, unknown>, context: ToolContext): Promise<string>;
	/** Whether this tool mutates state. Mutating tools may need user confirmation. */
	mutates?: boolean;
}

export function getWorkspaceRoot(): string | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
