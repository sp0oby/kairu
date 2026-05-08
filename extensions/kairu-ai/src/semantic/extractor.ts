/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

export interface SolidityFunction {
	name: string;
	visibility: string;
	stateMutability: string;
	params: string;
	returns: string;
	modifiers: string[];
	lineStart: number;
	body?: string;
	externalCalls?: ExternalCall[];
	accessControlChecks?: AccessControlCheck[];
}

export interface SolidityModifier {
	name: string;
	params: string;
	lineStart: number;
	body: string;
}

export interface ExternalCall {
	kind: 'call' | 'staticcall' | 'delegatecall' | 'transfer' | 'send' | 'highLevel';
	target?: string;
	functionName?: string;
	hasValue?: boolean;
	line: number;
	snippet: string;
}

export interface AccessControlCheck {
	kind: 'onlyOwner' | 'onlyRole' | 'msgSender' | 'requireAuth' | 'modifier';
	expression?: string;
	line: number;
	snippet: string;
}

export interface SolidityEvent {
	name: string;
	params: string;
	lineStart: number;
}

export interface SolidityError {
	name: string;
	params: string;
	lineStart: number;
}

export interface SolidityStateVar {
	name: string;
	type: string;
	visibility: string;
	isImmutable: boolean;
	isConstant: boolean;
	lineStart: number;
}

export interface SolidityContract {
	name: string;
	kind: 'contract' | 'interface' | 'library' | 'abstract';
	inherits: string[];
	functions: SolidityFunction[];
	modifiers: SolidityModifier[];
	events: SolidityEvent[];
	errors: SolidityError[];
	stateVars: SolidityStateVar[];
	lineStart: number;
}

export interface SolidityFile {
	pragma?: string;
	imports: string[];
	contracts: SolidityContract[];
	filePath: string;
}

// Strip line comments and block comments from Solidity source while preserving line count
function stripComments(src: string): string {
	let result = '';
	let i = 0;
	while (i < src.length) {
		if (src[i] === '/' && src[i + 1] === '/') {
			// line comment — skip to end of line
			while (i < src.length && src[i] !== '\n') {
				result += ' ';
				i++;
			}
		} else if (src[i] === '/' && src[i + 1] === '*') {
			// block comment — skip to */
			i += 2;
			while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
				result += src[i] === '\n' ? '\n' : ' ';
				i++;
			}
			i += 2;
		} else if (src[i] === '"' || src[i] === "'") {
			// string literal — preserve
			const q = src[i];
			result += src[i++];
			while (i < src.length && src[i] !== q) {
				if (src[i] === '\\') { result += src[i++]; }
				result += src[i++];
			}
			if (i < src.length) { result += src[i++]; }
		} else {
			result += src[i++];
		}
	}
	return result;
}

function getLineNumber(src: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset && i < src.length; i++) {
		if (src[i] === '\n') { line++; }
	}
	return line;
}

// Find the matching closing brace from an opening brace offset
function findMatchingBrace(src: string, openAt: number): number {
	let depth = 0;
	for (let i = openAt; i < src.length; i++) {
		if (src[i] === '{') { depth++; }
		else if (src[i] === '}') {
			depth--;
			if (depth === 0) { return i; }
		}
	}
	return -1;
}

export function extractSolidityFile(filePath: string, rawSrc: string): SolidityFile {
	const src = stripComments(rawSrc);

	const pragma = (rawSrc.match(/pragma\s+solidity\s+([^;]+);/) || [])[1]?.trim();
	const imports: string[] = [];
	for (const m of rawSrc.matchAll(/import\s+(?:{[^}]+}\s+from\s+)?["']([^"']+)["']/g)) {
		imports.push(m[1]);
	}

	const contracts: SolidityContract[] = [];
	const contractRe = /\b(abstract\s+contract|contract|interface|library)\s+(\w+)([^{]*)\{/g;
	let cm: RegExpExecArray | null;

	while ((cm = contractRe.exec(src)) !== null) {
		const kindRaw = cm[1].replace('abstract ', '').trim() as SolidityContract['kind'];
		const kind: SolidityContract['kind'] = cm[1].startsWith('abstract') ? 'abstract' : kindRaw;
		const name = cm[2];
		const header = cm[3];
		const openBrace = cm.index + cm[0].length - 1;
		const closeBrace = findMatchingBrace(src, openBrace);
		if (closeBrace === -1) { continue; }

		const body = src.slice(openBrace + 1, closeBrace);
		const bodyRaw = rawSrc.slice(openBrace + 1, closeBrace);
		const lineStart = getLineNumber(src, cm.index);

		// Parse inheritance
		const inherits: string[] = [];
		const isMatch = header.match(/is\s+(.+)/);
		if (isMatch) {
			inherits.push(...isMatch[1].split(',').map(s => s.trim().split('(')[0].trim()).filter(Boolean));
		}

		const functions = extractFunctions(body, bodyRaw, openBrace + 1, src);
		const modifiers = extractModifiers(body, openBrace + 1, src);
		const events = extractEvents(body, openBrace + 1, src);
		const errors = extractErrors(body, openBrace + 1, src);
		const stateVars = extractStateVars(body, openBrace + 1, src);

		// Enrich functions with external calls + access control checks (function-body analysis)
		for (const fn of functions) {
			const fnBody = extractFunctionBody(body, fn);
			if (fnBody) {
				fn.externalCalls = extractExternalCalls(fnBody, fn.lineStart);
				fn.accessControlChecks = extractAccessControlChecks(fnBody, fn.modifiers, fn.lineStart);
			}
		}

		contracts.push({ name, kind, inherits, functions, modifiers, events, errors, stateVars, lineStart });
	}

	return { pragma, imports, contracts, filePath };
}

function extractFunctions(body: string, _bodyRaw: string, bodyOffset: number, fullSrc: string): SolidityFunction[] {
	const fns: SolidityFunction[] = [];
	// Match function declarations including receive/fallback
	const fnRe = /\b(function\s+(\w+)|receive|fallback)\s*(\([^)]*\))\s*([^{;]*?)(?:\{|;)/g;
	let m: RegExpExecArray | null;

	while ((m = fnRe.exec(body)) !== null) {
		const isSpecial = m[1] === 'receive' || m[1] === 'fallback';
		const name = isSpecial ? m[1] : m[2];
		const params = m[3].slice(1, -1).trim();
		const trailer = m[4].trim();

		const visibility = (trailer.match(/\b(public|private|internal|external)\b/) || [])[1] || 'internal';
		const stateMutability = (trailer.match(/\b(pure|view|payable|nonpayable)\b/) || [])[1] || 'nonpayable';
		const modifiers: string[] = [];
		for (const mm of trailer.matchAll(/\b(\w+)\s*(?:\([^)]*\))?\s*/g)) {
			if (!['public', 'private', 'internal', 'external', 'pure', 'view', 'payable', 'nonpayable', 'virtual', 'override', 'returns'].includes(mm[1])) {
				modifiers.push(mm[1]);
			}
		}

		const returnsMatch = trailer.match(/returns\s*\(([^)]*)\)/);
		const returns = returnsMatch ? returnsMatch[1].trim() : '';

		const lineStart = getLineNumber(fullSrc, bodyOffset + m.index);
		fns.push({ name, visibility, stateMutability, params, returns, modifiers, lineStart });
	}

	return fns;
}

function extractEvents(body: string, bodyOffset: number, fullSrc: string): SolidityEvent[] {
	const events: SolidityEvent[] = [];
	const re = /\bevent\s+(\w+)\s*(\([^)]*\))/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(body)) !== null) {
		events.push({
			name: m[1],
			params: m[2].slice(1, -1).trim(),
			lineStart: getLineNumber(fullSrc, bodyOffset + m.index),
		});
	}
	return events;
}

function extractErrors(body: string, bodyOffset: number, fullSrc: string): SolidityError[] {
	const errors: SolidityError[] = [];
	const re = /\berror\s+(\w+)\s*(\([^)]*\))/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(body)) !== null) {
		errors.push({
			name: m[1],
			params: m[2].slice(1, -1).trim(),
			lineStart: getLineNumber(fullSrc, bodyOffset + m.index),
		});
	}
	return errors;
}

function extractStateVars(body: string, bodyOffset: number, fullSrc: string): SolidityStateVar[] {
	const vars: SolidityStateVar[] = [];
	// Match state variable declarations (not inside function bodies)
	// Pattern: type [visibility] [constant/immutable] name [= value];
	const re = /^[ \t]*((?:mapping\s*\([^)]+\)|address(?:\s+payable)?|bytes\d*|uint\d*|int\d*|bool|string|bytes|[A-Z]\w*)(?:\[\d*\])*)\s+(public|private|internal|)?\s*(constant|immutable)?\s*(\w+)\s*(?:=|;)/gm;
	let m: RegExpExecArray | null;
	while ((m = re.exec(body)) !== null) {
		const type = m[1].trim();
		const visibility = m[2]?.trim() || 'internal';
		const modifier = m[3]?.trim() || '';
		const name = m[4];
		// Skip if name looks like a keyword or control flow
		if (['if', 'for', 'while', 'return', 'require', 'revert', 'emit', 'new', 'delete'].includes(name)) { continue; }
		vars.push({
			name,
			type,
			visibility,
			isConstant: modifier === 'constant',
			isImmutable: modifier === 'immutable',
			lineStart: getLineNumber(fullSrc, bodyOffset + m.index),
		});
	}
	return vars;
}

function extractModifiers(body: string, bodyOffset: number, fullSrc: string): SolidityModifier[] {
	const modifiers: SolidityModifier[] = [];
	const re = /\bmodifier\s+(\w+)\s*(\([^)]*\))?\s*\{/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(body)) !== null) {
		const name = m[1];
		const params = (m[2] || '()').slice(1, -1).trim();
		const openBrace = m.index + m[0].length - 1;
		const closeBrace = findMatchingBrace(body, openBrace);
		const modBody = closeBrace !== -1 ? body.slice(openBrace + 1, closeBrace).trim() : '';
		modifiers.push({
			name, params,
			lineStart: getLineNumber(fullSrc, bodyOffset + m.index),
			body: modBody,
		});
	}
	return modifiers;
}

// Locate function body in already-stripped contract body. Best-effort match by name+params.
function extractFunctionBody(contractBody: string, fn: SolidityFunction): string | null {
	const escapedName = fn.name === 'receive' || fn.name === 'fallback' ? fn.name : `function\\s+${fn.name}`;
	const re = new RegExp(`\\b${escapedName}\\s*\\([^)]*\\)[^{;]*\\{`, 'g');
	const m = re.exec(contractBody);
	if (!m) { return null; }
	const openBrace = m.index + m[0].length - 1;
	const closeBrace = findMatchingBrace(contractBody, openBrace);
	if (closeBrace === -1) { return null; }
	return contractBody.slice(openBrace + 1, closeBrace);
}

function extractExternalCalls(fnBody: string, baseLine: number): ExternalCall[] {
	const calls: ExternalCall[] = [];

	// Low-level calls: <addr>.call{value: x}(data) / .call(data) / .staticcall(data) / .delegatecall(data)
	const lowLevelRe = /(\w+(?:\[[^\]]+\])?)\s*\.\s*(call|staticcall|delegatecall)\s*(\{[^}]*\})?\s*\(/g;
	let m: RegExpExecArray | null;
	while ((m = lowLevelRe.exec(fnBody)) !== null) {
		const lineOffset = fnBody.slice(0, m.index).split('\n').length - 1;
		const lineSnippet = fnBody.split('\n')[lineOffset]?.trim() || m[0];
		calls.push({
			kind: m[2] as ExternalCall['kind'],
			target: m[1],
			hasValue: !!m[3] && m[3].includes('value'),
			line: baseLine + lineOffset,
			snippet: lineSnippet,
		});
	}

	// transfer / send (deprecated but still common): <addr>.transfer(amount) / .send(amount)
	const transferRe = /(\w+(?:\[[^\]]+\])?)\s*\.\s*(transfer|send)\s*\(/g;
	while ((m = transferRe.exec(fnBody)) !== null) {
		const lineOffset = fnBody.slice(0, m.index).split('\n').length - 1;
		const lineSnippet = fnBody.split('\n')[lineOffset]?.trim() || m[0];
		calls.push({
			kind: m[2] as ExternalCall['kind'],
			target: m[1],
			hasValue: true,
			line: baseLine + lineOffset,
			snippet: lineSnippet,
		});
	}

	// High-level external calls: ContractName(addr).func() or IInterface(addr).func()
	// Heuristic: detect ContractType(...).method( pattern outside of low-level calls
	const highLevelRe = /\b([A-Z]\w*)\s*\(([^)]+)\)\s*\.\s*(\w+)\s*\(/g;
	while ((m = highLevelRe.exec(fnBody)) !== null) {
		const lineOffset = fnBody.slice(0, m.index).split('\n').length - 1;
		const lineSnippet = fnBody.split('\n')[lineOffset]?.trim() || m[0];
		// Skip casts that don't look like interfaces (e.g. uint256(x))
		if (['uint256', 'uint128', 'uint64', 'uint32', 'uint16', 'uint8', 'int256', 'address', 'bytes32', 'bool', 'bytes'].some(t => m![1].toLowerCase() === t)) {
			continue;
		}
		calls.push({
			kind: 'highLevel',
			target: `${m[1]}(${m[2].trim()})`,
			functionName: m[3],
			line: baseLine + lineOffset,
			snippet: lineSnippet,
		});
	}

	return calls;
}

function extractAccessControlChecks(fnBody: string, modifiers: string[], baseLine: number): AccessControlCheck[] {
	const checks: AccessControlCheck[] = [];

	// Modifier-based: any "auth-looking" modifier
	for (const mod of modifiers) {
		if (/owner|admin|role|auth|allowed|whitelist|gov/i.test(mod)) {
			checks.push({
				kind: mod.toLowerCase().includes('role') ? 'onlyRole' :
					mod.toLowerCase().includes('owner') ? 'onlyOwner' : 'modifier',
				expression: mod,
				line: baseLine,
				snippet: mod,
			});
		}
	}

	// require(msg.sender == owner / addr) / require(owner == msg.sender)
	const reqMsgSenderRe = /require\s*\(\s*([^,)]*msg\.sender[^,)]*)/g;
	let m: RegExpExecArray | null;
	while ((m = reqMsgSenderRe.exec(fnBody)) !== null) {
		const lineOffset = fnBody.slice(0, m.index).split('\n').length - 1;
		checks.push({
			kind: 'requireAuth',
			expression: m[1].trim(),
			line: baseLine + lineOffset,
			snippet: m[0],
		});
	}

	// if (msg.sender != owner) revert
	const ifRevertRe = /if\s*\(\s*([^)]*msg\.sender[^)]*)\)\s*\{?\s*revert/g;
	while ((m = ifRevertRe.exec(fnBody)) !== null) {
		const lineOffset = fnBody.slice(0, m.index).split('\n').length - 1;
		checks.push({
			kind: 'requireAuth',
			expression: m[1].trim(),
			line: baseLine + lineOffset,
			snippet: m[0],
		});
	}

	return checks;
}
