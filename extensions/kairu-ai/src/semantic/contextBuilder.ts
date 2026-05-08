/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { SemanticIndex, IndexEntry } from './index';
import { SolidityContract, SolidityFunction } from './extractor';

const MAX_CONTEXT_CHARS = 6000;

export interface SemanticContext {
	summary: string;
	relevantContracts: string[];
	tokenEstimate: number;
}

export function buildSemanticContext(
	index: SemanticIndex,
	currentFileUri?: string,
	query?: string
): SemanticContext | null {
	if (index.size() === 0) { return null; }

	const parts: string[] = [];
	const relevantContracts: string[] = [];
	let totalChars = 0;

	// 1. Current file's contracts get highest priority
	if (currentFileUri) {
		const entry = index.getByUri(currentFileUri);
		if (entry && entry.file.contracts.length > 0) {
			const section = formatFileContracts(entry, 'current file');
			if (totalChars + section.length < MAX_CONTEXT_CHARS) {
				parts.push(section);
				totalChars += section.length;
				relevantContracts.push(...entry.file.contracts.map(c => c.name));
			}
		}
	}

	// 2. Query-relevant contracts from other files
	if (query && totalChars < MAX_CONTEXT_CHARS) {
		const related = index.search(query);
		for (const entry of related) {
			const entryUri = entry.uri;
			if (entryUri === currentFileUri) { continue; }
			const section = formatFileContracts(entry, relativePath(entry.file.filePath));
			if (totalChars + section.length > MAX_CONTEXT_CHARS) { break; }
			parts.push(section);
			totalChars += section.length;
			relevantContracts.push(...entry.file.contracts.map(c => c.name));
		}
	}

	if (parts.length === 0) { return null; }

	const summary = `### Workspace Solidity Context\n${parts.join('\n')}\n`;
	return {
		summary,
		relevantContracts,
		tokenEstimate: Math.ceil(totalChars / 4),
	};
}

function formatFileContracts(entry: IndexEntry, label: string): string {
	const lines: string[] = [`\n#### File: ${label}`];
	if (entry.file.pragma) {
		lines.push(`pragma solidity ${entry.file.pragma};`);
	}
	for (const contract of entry.file.contracts) {
		lines.push(formatContract(contract));
	}
	return lines.join('\n');
}

function formatContract(c: SolidityContract): string {
	const lines: string[] = [];
	const inheritance = c.inherits.length > 0 ? ` is ${c.inherits.join(', ')}` : '';
	lines.push(`\n${c.kind} ${c.name}${inheritance} {`);

	if (c.stateVars.length > 0) {
		lines.push('  // State variables');
		for (const sv of c.stateVars) {
			const mods = [sv.isConstant ? 'constant' : '', sv.isImmutable ? 'immutable' : ''].filter(Boolean);
			lines.push(`  ${sv.type} ${sv.visibility}${mods.length ? ' ' + mods.join(' ') : ''} ${sv.name};`);
		}
	}

	if (c.events.length > 0) {
		lines.push('  // Events');
		for (const ev of c.events) {
			lines.push(`  event ${ev.name}(${ev.params});`);
		}
	}

	if (c.errors.length > 0) {
		lines.push('  // Custom errors');
		for (const er of c.errors) {
			lines.push(`  error ${er.name}(${er.params});`);
		}
	}

	if (c.modifiers && c.modifiers.length > 0) {
		lines.push('  // Modifiers');
		for (const mod of c.modifiers) {
			lines.push(`  modifier ${mod.name}(${mod.params});`);
		}
	}

	if (c.functions.length > 0) {
		lines.push('  // Functions');
		for (const fn of c.functions) {
			lines.push(`  ${formatFunction(fn)}`);
			if (fn.externalCalls && fn.externalCalls.length > 0) {
				const summary = fn.externalCalls.slice(0, 3).map(ec =>
					`${ec.kind}${ec.target ? '→' + ec.target : ''}`
				).join(', ');
				lines.push(`    // → external calls: ${summary}`);
			}
			if (fn.accessControlChecks && fn.accessControlChecks.length > 0) {
				const summary = fn.accessControlChecks.map(ac => ac.kind).join(', ');
				lines.push(`    // → access control: ${summary}`);
			}
		}
	}

	lines.push('}');
	return lines.join('\n');
}

function formatFunction(fn: SolidityFunction): string {
	const mods = fn.modifiers.length > 0 ? ' ' + fn.modifiers.join(' ') : '';
	const returns = fn.returns ? ` returns (${fn.returns})` : '';
	const mut = fn.stateMutability !== 'nonpayable' ? ` ${fn.stateMutability}` : '';
	return `function ${fn.name}(${fn.params}) ${fn.visibility}${mut}${mods}${returns};`;
}

export function buildCallGraph(index: SemanticIndex): CallGraphNode[] {
	const nodes: CallGraphNode[] = [];
	const nodeMap = new Map<string, CallGraphNode>();

	for (const entry of index.getAll()) {
		for (const contract of entry.file.contracts) {
			const node: CallGraphNode = {
				id: contract.name,
				kind: contract.kind,
				inherits: [...contract.inherits],
				functions: contract.functions.map(f => ({
					name: f.name,
					visibility: f.visibility,
					stateMutability: f.stateMutability,
				})),
			};
			nodeMap.set(contract.name, node);
			nodes.push(node);
		}
	}

	return nodes;
}

export interface CallGraphNode {
	id: string;
	kind: string;
	inherits: string[];
	functions: Array<{ name: string; visibility: string; stateMutability: string }>;
}

function relativePath(filePath: string): string {
	const parts = filePath.replace(/\\/g, '/').split('/');
	// Return last 2-3 path segments for readability
	return parts.slice(-2).join('/');
}
