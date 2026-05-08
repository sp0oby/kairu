/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface PatternFinding {
	id: string;
	severity: Severity;
	title: string;
	description: string;
	line: number;
	snippet: string;
	recommendation: string;
}

interface VulnPattern {
	id: string;
	severity: Severity;
	title: string;
	description: string;
	recommendation: string;
	detect: (src: string, lines: string[]) => Array<{ line: number; snippet: string }>;
}

const PATTERNS: VulnPattern[] = [
	{
		id: 'SWC-107',
		severity: 'critical',
		title: 'Reentrancy: ETH transfer before state update',
		description: 'An external call (msg.sender.call) appears before a state variable update. This is the classic reentrancy pattern that led to The DAO hack.',
		recommendation: 'Apply the Checks-Effects-Interactions pattern: update all state before making external calls. Consider using OpenZeppelin ReentrancyGuard.',
		detect: (src, lines) => {
			const findings: Array<{ line: number; snippet: string }> = [];
			const callRe = /\.call\{value:/g;
			let m: RegExpExecArray | null;
			while ((m = callRe.exec(src)) !== null) {
				const lineNum = src.slice(0, m.index).split('\n').length;
				// Look back 10 lines for state assignments
				const before = lines.slice(Math.max(0, lineNum - 10), lineNum).join('\n');
				// Look ahead 5 lines for state assignments
				const after = lines.slice(lineNum, Math.min(lines.length, lineNum + 5)).join('\n');
				if (after.match(/\w+\[.+?\]\s*[+-]?=/) || after.match(/\w+\s*[+-]?=\s*(?!new)/)) {
					findings.push({ line: lineNum, snippet: lines[lineNum - 1]?.trim() || '' });
				} else if (!before.match(/\w+\[.+?\]\s*[+-]?=/) && !before.match(/balances\[/)) {
					// No state update before the call — flag it
					findings.push({ line: lineNum, snippet: lines[lineNum - 1]?.trim() || '' });
				}
			}
			return findings;
		},
	},
	{
		id: 'SWC-115',
		severity: 'high',
		title: 'tx.origin Authentication',
		description: 'tx.origin is used for authorization. This allows phishing attacks where a malicious contract can trigger this code on behalf of the original transaction sender.',
		recommendation: 'Replace tx.origin with msg.sender for access control checks.',
		detect: (_src, lines) => {
			const findings: Array<{ line: number; snippet: string }> = [];
			lines.forEach((line, i) => {
				if (/tx\.origin/.test(line) && /==|!=|require|if/.test(line)) {
					findings.push({ line: i + 1, snippet: line.trim() });
				}
			});
			return findings;
		},
	},
	{
		id: 'SWC-104',
		severity: 'medium',
		title: 'Unchecked Transfer Return Value',
		description: 'transfer() on IERC20 may return false on failure (non-reverting tokens like USDT). Unchecked returns silently swallow failures.',
		recommendation: 'Use SafeERC20.safeTransfer() from OpenZeppelin instead of raw IERC20.transfer().',
		detect: (_src, lines) => {
			const findings: Array<{ line: number; snippet: string }> = [];
			lines.forEach((line, i) => {
				if (/\.transfer\(/.test(line) && !/safeTransfer/.test(line) && !/SafeERC20/.test(line) && !/bool\s+\w+\s*=/.test(line) && !/require\(/.test(line)) {
					findings.push({ line: i + 1, snippet: line.trim() });
				}
			});
			return findings;
		},
	},
	{
		id: 'SWC-101',
		severity: 'high',
		title: 'Integer Overflow / Underflow Risk',
		description: 'Arithmetic operations without SafeMath on Solidity < 0.8.0 can overflow/underflow silently. Even on 0.8.x, unchecked{} blocks disable overflow protection.',
		recommendation: 'Use Solidity 0.8.x with default overflow checks. Avoid unchecked{} blocks unless you have mathematically proven the bounds.',
		detect: (src, lines) => {
			const findings: Array<{ line: number; snippet: string }> = [];
			const pragmaMatch = src.match(/pragma solidity\s+([^;]+)/);
			const isOld = pragmaMatch && (pragmaMatch[1].includes('0.6') || pragmaMatch[1].includes('0.7') || pragmaMatch[1].includes('0.5') || pragmaMatch[1].includes('^0.6') || pragmaMatch[1].includes('^0.7'));
			if (isOld) {
				lines.forEach((line, i) => {
					if (/[+-]\s*\d/.test(line) && !/\/\//.test(line) && !/SafeMath/.test(line)) {
						findings.push({ line: i + 1, snippet: line.trim() });
					}
				});
			}
			// Check for unchecked blocks on any Solidity version
			lines.forEach((line, i) => {
				if (/\bunchecked\s*\{/.test(line)) {
					findings.push({ line: i + 1, snippet: line.trim() });
				}
			});
			return findings;
		},
	},
	{
		id: 'SWC-105',
		severity: 'medium',
		title: 'Unprotected Self-destruct',
		description: 'selfdestruct() is callable. If not properly access-controlled, any attacker can permanently destroy this contract.',
		recommendation: 'Add strict access control (onlyOwner or role-based) to any function containing selfdestruct. Consider removing selfdestruct entirely — it is deprecated post-EIP-6780.',
		detect: (_src, lines) => {
			const findings: Array<{ line: number; snippet: string }> = [];
			lines.forEach((line, i) => {
				if (/\bselfdestruct\b/.test(line)) {
					findings.push({ line: i + 1, snippet: line.trim() });
				}
			});
			return findings;
		},
	},
	{
		id: 'SWC-135',
		severity: 'low',
		title: 'Code With No Effects',
		description: 'Comparison operations (== or !=) used as statements without assignments or require() have no effect.',
		recommendation: 'Wrap in require() or remove. Example: require(x == y, "mismatch").',
		detect: (_src, lines) => {
			const findings: Array<{ line: number; snippet: string }> = [];
			lines.forEach((line, i) => {
				const trimmed = line.trim();
				if (/^\w.*==.*;\s*$/.test(trimmed) && !/require|if|return|bool/.test(trimmed)) {
					findings.push({ line: i + 1, snippet: trimmed });
				}
			});
			return findings;
		},
	},
	{
		id: 'KAIRU-001',
		severity: 'medium',
		title: 'Missing Zero-Address Check',
		description: 'A function takes an address parameter but does not check that it is non-zero. Sending tokens or setting a role to address(0) is an irreversible mistake.',
		recommendation: 'Add: require(addr != address(0), "zero address"); at the start of functions that accept addresses.',
		detect: (_src, lines) => {
			const findings: Array<{ line: number; snippet: string }> = [];
			let inFn = false;
			let hasAddressParam = false;
			let hasZeroCheck = false;
			let fnStartLine = 0;
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (/\bfunction\s+\w+\s*\([^)]*address[^)]*\)/.test(line)) {
					inFn = true;
					hasAddressParam = true;
					hasZeroCheck = false;
					fnStartLine = i + 1;
				}
				if (inFn && /address\(0\)|address(0x0)/.test(line)) {
					hasZeroCheck = true;
				}
				if (inFn && /^\s*\}/.test(line)) {
					if (hasAddressParam && !hasZeroCheck) {
						findings.push({ line: fnStartLine, snippet: lines[fnStartLine - 1]?.trim() || '' });
					}
					inFn = false;
					hasAddressParam = false;
				}
			}
			return findings;
		},
	},
	{
		id: 'KAIRU-002',
		severity: 'high',
		title: 'Delegatecall to Untrusted Contract',
		description: 'delegatecall executes code from another contract in the context of this contract, giving it full control over storage. If the target is not trusted/hardcoded, this is a critical vulnerability.',
		recommendation: 'Only delegatecall to audited, hardcoded implementation addresses. Never delegatecall to user-supplied addresses.',
		detect: (_src, lines) => {
			const findings: Array<{ line: number; snippet: string }> = [];
			lines.forEach((line, i) => {
				if (/\.delegatecall\(/.test(line)) {
					findings.push({ line: i + 1, snippet: line.trim() });
				}
			});
			return findings;
		},
	},
	{
		id: 'KAIRU-003',
		severity: 'medium',
		title: 'Block Timestamp Dependence',
		description: 'block.timestamp is used for game logic, randomness, or time-sensitive decisions. Miners can manipulate timestamps by ±15 seconds.',
		recommendation: 'Avoid using block.timestamp for randomness. For time-locks, 15-second manipulation is acceptable; for shorter windows, use block.number instead.',
		detect: (_src, lines) => {
			const findings: Array<{ line: number; snippet: string }> = [];
			lines.forEach((line, i) => {
				if (/block\.timestamp/.test(line) && /==|<|>|%|rand|seed|random/i.test(line)) {
					findings.push({ line: i + 1, snippet: line.trim() });
				}
			});
			return findings;
		},
	},
	{
		id: 'KAIRU-004',
		severity: 'info',
		title: 'Missing Event Emission',
		description: 'State-changing functions (public/external nonpayable functions with assignments) should emit events to enable off-chain indexing and monitoring.',
		recommendation: 'Add an event emit after every significant state change.',
		detect: (_src, lines) => {
			const findings: Array<{ line: number; snippet: string }> = [];
			let inPublicFn = false;
			let hasStateChange = false;
			let hasEmit = false;
			let fnLine = 0;
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (/\bfunction\s+\w+[^)]*\)\s*(public|external)\b/.test(line) && !/view|pure/.test(line)) {
					inPublicFn = true;
					hasStateChange = false;
					hasEmit = false;
					fnLine = i + 1;
				}
				if (inPublicFn) {
					if (/\[\w+\]\s*=|\w+\s*=\s*(?!new\s)/.test(line) && !/emit|\/\//.test(line)) {
						hasStateChange = true;
					}
					if (/\bemit\b/.test(line)) {
						hasEmit = true;
					}
					if (/^\s*\}/.test(line)) {
						if (hasStateChange && !hasEmit) {
							findings.push({ line: fnLine, snippet: lines[fnLine - 1]?.trim() || '' });
						}
						inPublicFn = false;
					}
				}
			}
			return findings;
		},
	},
];

export function runPatternChecks(src: string): PatternFinding[] {
	const lines = src.split('\n');
	const findings: PatternFinding[] = [];

	for (const pattern of PATTERNS) {
		const matches = pattern.detect(src, lines);
		for (const m of matches) {
			findings.push({
				id: pattern.id,
				severity: pattern.severity,
				title: pattern.title,
				description: pattern.description,
				line: m.line,
				snippet: m.snippet,
				recommendation: pattern.recommendation,
			});
		}
	}

	// Sort by severity
	const severityOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
	return findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}
