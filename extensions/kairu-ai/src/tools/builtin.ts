/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { ToolExecutor, ToolContext } from './types';

// ── helpers ────────────────────────────────────────────────────────────────

async function runProcess(cmd: string, args: string[], cwd: string, timeoutMs = 60000): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { cwd, shell: false });
		let stdout = '';
		let stderr = '';
		const timeout = setTimeout(() => {
			child.kill('SIGTERM');
			reject(new Error(`${cmd} ${args.join(' ')} timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
		child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
		child.on('error', err => {
			clearTimeout(timeout);
			reject(err);
		});
		child.on('close', code => {
			clearTimeout(timeout);
			resolve({ stdout, stderr, code: code ?? -1 });
		});
	});
}

function requireWorkspace(ctx: ToolContext): string {
	if (!ctx.workspaceRoot) {
		throw new Error('No workspace folder open. Open a project folder before running this tool.');
	}
	return ctx.workspaceRoot;
}

function truncate(s: string, max = 8000): string {
	return s.length <= max ? s : s.slice(0, max) + `\n... (truncated ${s.length - max} chars)`;
}

// ── tools: workspace / files ───────────────────────────────────────────────

const readFileTool: ToolExecutor = {
	definition: {
		name: 'read_file',
		description: 'Read the contents of a file in the workspace. Returns the full text. Use this to inspect contracts, config, or test files before making changes.',
		input_schema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Path relative to workspace root, e.g. "src/MyToken.sol"' },
			},
			required: ['path'],
		},
	},
	async execute(input, ctx) {
		const root = requireWorkspace(ctx);
		const rel = String(input.path);
		const uri = vscode.Uri.joinPath(vscode.Uri.file(root), rel);
		const bytes = await vscode.workspace.fs.readFile(uri);
		const text = new TextDecoder().decode(bytes);
		return truncate(text, 16000);
	},
};

const editFileTool: ToolExecutor = {
	definition: {
		name: 'edit_file',
		description: 'Make a targeted edit to a file by replacing exact text. The "old_text" must match exactly (whitespace-sensitive). Use this for surgical changes; do not use it to rewrite entire files. To create a new file, use write_file instead.',
		input_schema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Path relative to workspace root' },
				old_text: { type: 'string', description: 'Exact text to find. Include enough context to be unique.' },
				new_text: { type: 'string', description: 'Replacement text' },
			},
			required: ['path', 'old_text', 'new_text'],
		},
	},
	mutates: true,
	async execute(input, ctx) {
		const root = requireWorkspace(ctx);
		const rel = String(input.path);
		const oldText = String(input.old_text);
		const newText = String(input.new_text);
		const uri = vscode.Uri.joinPath(vscode.Uri.file(root), rel);
		const bytes = await vscode.workspace.fs.readFile(uri);
		const text = new TextDecoder().decode(bytes);
		const idx = text.indexOf(oldText);
		if (idx === -1) {
			throw new Error(`old_text not found in ${rel}. The match must be exact, including whitespace.`);
		}
		if (text.indexOf(oldText, idx + 1) !== -1) {
			throw new Error(`old_text appears multiple times in ${rel}. Add more surrounding context to make the match unique.`);
		}
		const updated = text.slice(0, idx) + newText + text.slice(idx + oldText.length);
		await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updated));
		return `Edited ${rel}: replaced 1 occurrence (${oldText.length} → ${newText.length} chars)`;
	},
};

const writeFileTool: ToolExecutor = {
	definition: {
		name: 'write_file',
		description: 'Create a new file or completely overwrite an existing one. Prefer edit_file for changes to existing files.',
		input_schema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Path relative to workspace root' },
				content: { type: 'string', description: 'Full file contents' },
			},
			required: ['path', 'content'],
		},
	},
	mutates: true,
	async execute(input, ctx) {
		const root = requireWorkspace(ctx);
		const rel = String(input.path);
		const content = String(input.content);
		const uri = vscode.Uri.joinPath(vscode.Uri.file(root), rel);
		await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
		return `Wrote ${rel} (${content.length} chars)`;
	},
};

const listFilesTool: ToolExecutor = {
	definition: {
		name: 'list_files',
		description: 'List files matching a glob pattern in the workspace. Use to discover what contracts/tests/configs exist before reading them.',
		input_schema: {
			type: 'object',
			properties: {
				pattern: { type: 'string', description: 'Glob pattern, e.g. "src/**/*.sol" or "test/**/*.t.sol"' },
				exclude: { type: 'string', description: 'Optional exclusion pattern, defaults to node_modules + lib' },
			},
			required: ['pattern'],
		},
	},
	async execute(input, _ctx) {
		const pattern = String(input.pattern);
		const exclude = String(input.exclude ?? '{**/node_modules/**,**/lib/**,**/cache/**,**/out/**}');
		const uris = await vscode.workspace.findFiles(pattern, exclude, 200);
		if (uris.length === 0) { return `(no files matched "${pattern}")`; }
		return uris.map(u => vscode.workspace.asRelativePath(u)).join('\n');
	},
};

// ── tools: foundry ─────────────────────────────────────────────────────────

const forgeBuildTool: ToolExecutor = {
	definition: {
		name: 'forge_build',
		description: 'Run "forge build" to compile all Solidity contracts. Returns success status, error count, and full output. Use this to verify code compiles after edits.',
		input_schema: { type: 'object', properties: {} },
	},
	async execute(_input, ctx) {
		const cwd = requireWorkspace(ctx);
		const { stdout, stderr, code } = await runProcess('forge', ['build'], cwd, 120000);
		const out = stderr + stdout;
		const errors = (out.match(/Error \(/g) || []).length;
		const warnings = (out.match(/Warning \(/g) || []).length;
		const status = code === 0 ? '✓ build succeeded' : `✖ build failed (exit ${code})`;
		return `${status}\nerrors: ${errors}, warnings: ${warnings}\n\n${truncate(out, 6000)}`;
	},
};

const forgeTestTool: ToolExecutor = {
	definition: {
		name: 'forge_test',
		description: 'Run "forge test" with optional filter. Returns pass/fail counts and per-test gas usage. Use this to verify behavior after code changes.',
		input_schema: {
			type: 'object',
			properties: {
				match_test: { type: 'string', description: 'Optional --match-test regex filter' },
				match_contract: { type: 'string', description: 'Optional --match-contract regex filter' },
			},
		},
	},
	async execute(input, ctx) {
		const cwd = requireWorkspace(ctx);
		const args = ['test'];
		if (input.match_test) { args.push('--match-test', String(input.match_test)); }
		if (input.match_contract) { args.push('--match-contract', String(input.match_contract)); }
		const { stdout, stderr, code } = await runProcess('forge', args, cwd, 180000);
		const out = stderr + stdout;
		const passMatch = out.match(/(\d+) passed/);
		const failMatch = out.match(/(\d+) failed/);
		const passed = passMatch ? parseInt(passMatch[1]) : 0;
		const failed = failMatch ? parseInt(failMatch[1]) : 0;
		const status = code === 0 ? '✓ all tests passed' : `✖ ${failed} test(s) failed`;
		return `${status}\npassed: ${passed}, failed: ${failed}\n\n${truncate(out, 8000)}`;
	},
};

// ── tools: security ────────────────────────────────────────────────────────

const slitherTool: ToolExecutor = {
	definition: {
		name: 'slither_audit',
		description: 'Run Slither static analysis on a Solidity file or the whole project. Returns findings grouped by severity. Slither must be installed (pip install slither-analyzer).',
		input_schema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Optional path to a specific .sol file. Omit to scan the whole project.' },
			},
		},
	},
	async execute(input, ctx) {
		const cwd = requireWorkspace(ctx);
		const target = input.path ? String(input.path) : '.';
		const { stdout, stderr, code } = await runProcess('slither', [target, '--json', '-'], cwd, 120000);
		if (code === 127) { return 'Slither is not installed. Install with: pip install slither-analyzer'; }
		try {
			const json = JSON.parse(stdout || stderr);
			const detectors = json.results?.detectors ?? [];
			if (detectors.length === 0) { return '✓ Slither: no findings'; }
			const summary = detectors.slice(0, 20).map((d: Record<string, unknown>) =>
				`[${d.impact}] ${d.check}: ${String(d.description ?? '').split('\n')[0].slice(0, 200)}`
			).join('\n');
			return `Slither found ${detectors.length} finding(s):\n${summary}${detectors.length > 20 ? `\n... (+${detectors.length - 20} more)` : ''}`;
		} catch {
			return truncate(stderr || stdout, 4000);
		}
	},
};

const patternAuditTool: ToolExecutor = {
	definition: {
		name: 'pattern_audit',
		description: 'Run Kairu\'s built-in vulnerability pattern checks on a Solidity file (10 patterns: reentrancy, tx.origin, unchecked transfer, integer overflow, selfdestruct, zero-address, delegatecall, timestamp deps, unprotected events, unused comparisons). Faster than Slither, no install needed.',
		input_schema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Path relative to workspace root' },
			},
			required: ['path'],
		},
	},
	async execute(input, ctx) {
		const root = requireWorkspace(ctx);
		const rel = String(input.path);
		const uri = vscode.Uri.joinPath(vscode.Uri.file(root), rel);
		const bytes = await vscode.workspace.fs.readFile(uri);
		const src = new TextDecoder().decode(bytes);
		// Re-implement minimal pattern check via cross-extension command. Fall back to message if unavailable.
		try {
			const findings = await vscode.commands.executeCommand<unknown[]>('kairu.security.checkPatternsAPI', src);
			if (!findings || findings.length === 0) { return '✓ No vulnerability patterns detected'; }
			return `Found ${findings.length} pattern finding(s):\n${JSON.stringify(findings, null, 2).slice(0, 4000)}`;
		} catch {
			return 'Pattern audit unavailable. Use slither_audit or open the file in the Audit Panel.';
		}
	},
};

// ── tools: chain ───────────────────────────────────────────────────────────

// Etherscan API bases for all supported chains (mainnets + testnets)
const ETHERSCAN_API_BASES: Record<string, string> = {
	// Mainnets
	'1':      'https://api.etherscan.io/api',
	'10':     'https://api-optimistic.etherscan.io/api',
	'8453':   'https://api.basescan.org/api',
	'42161':  'https://api.arbiscan.io/api',
	'137':    'https://api.polygonscan.com/api',
	'56':     'https://api.bscscan.com/api',
	'43114':  'https://api.snowtrace.io/api',
	'534352': 'https://api.scrollscan.com/api',
	// Testnets
	'11155111': 'https://api-sepolia.etherscan.io/api',          // Sepolia
	'17000':    'https://api-holesky.etherscan.io/api',          // Holesky
	'84532':    'https://api-sepolia.basescan.org/api',          // Base Sepolia
	'11155420': 'https://api-sepolia-optimistic.etherscan.io/api', // Optimism Sepolia
	'421614':   'https://api-sepolia.arbiscan.io/api',           // Arbitrum Sepolia
	'80002':    'https://api-amoy.polygonscan.com/api',          // Polygon Amoy
	'97':       'https://api-testnet.bscscan.com/api',           // BSC Testnet
	'43113':    'https://api-testnet.snowtrace.io/api',          // Avalanche Fuji
	'534351':   'https://api-sepolia.scrollscan.com/api',        // Scroll Sepolia
};

const etherscanContractTool: ToolExecutor = {
	definition: {
		name: 'etherscan_contract',
		description: 'Fetch a verified contract\'s ABI and source code from Etherscan-compatible explorers. Supports mainnets (1=Mainnet, 8453=Base, 42161=Arbitrum, 10=Optimism, 137=Polygon, 56=BSC, 43114=Avalanche, 534352=Scroll) AND testnets (11155111=Sepolia, 17000=Holesky, 84532=Base Sepolia, 421614=Arb Sepolia, 11155420=OP Sepolia, 80002=Polygon Amoy). Requires kairu.chain.etherscanApiKey to be set.',
		input_schema: {
			type: 'object',
			properties: {
				address: { type: 'string', description: 'Contract address (0x-prefixed hex)' },
				chain_id: { type: 'string', description: 'Chain ID as string. Common: "1"=Mainnet, "11155111"=Sepolia, "8453"=Base, "84532"=Base Sepolia' },
			},
			required: ['address', 'chain_id'],
		},
	},
	async execute(input, _ctx) {
		const apiKey = vscode.workspace.getConfiguration('kairu.chain').get<string>('etherscanApiKey', '');
		if (!apiKey) { return 'No Etherscan API key configured. Set kairu.chain.etherscanApiKey in settings first.'; }
		const address = String(input.address);
		const chainId = String(input.chain_id);
		const apiBases = ETHERSCAN_API_BASES;
		const apiBase = apiBases[chainId];
		if (!apiBase) { return `Unsupported chain ID "${chainId}". Supported: ${Object.keys(apiBases).join(', ')}`; }
		const url = `${apiBase}?module=contract&action=getsourcecode&address=${address}&apikey=${apiKey}`;
		const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
		const json = await resp.json() as { status: string; result: Array<Record<string, string>> };
		if (json.status !== '1' || !json.result?.[0]) { return `No verified contract found at ${address} on chain ${chainId}.`; }
		const r = json.result[0];
		const verified = r['ABI'] && r['ABI'] !== 'Contract source code not verified';
		if (!verified) { return `Contract at ${address} is NOT verified.`; }
		return `Contract: ${r['ContractName']}\nCompiler: ${r['CompilerVersion']}\nOptimized: ${r['OptimizationUsed'] === '1' ? 'yes' : 'no'}\nProxy: ${r['Proxy'] === '1' ? 'yes' : 'no'}\n\nABI (truncated):\n${truncate(r['ABI'], 4000)}\n\nSource (truncated):\n${truncate(r['SourceCode'] || '(empty)', 4000)}`;
	},
};

const etherscanTxTool: ToolExecutor = {
	definition: {
		name: 'etherscan_tx',
		description: 'Look up a transaction by hash on an Etherscan-compatible explorer. Supports both mainnets and testnets (Sepolia, Holesky, Base Sepolia, Arbitrum Sepolia, Optimism Sepolia, Polygon Amoy). Returns tx info + receipt. Requires kairu.chain.etherscanApiKey.',
		input_schema: {
			type: 'object',
			properties: {
				hash: { type: 'string', description: 'Transaction hash (0x-prefixed)' },
				chain_id: { type: 'string', description: 'Chain ID as string. Common: "1"=Mainnet, "11155111"=Sepolia, "8453"=Base, "84532"=Base Sepolia' },
			},
			required: ['hash', 'chain_id'],
		},
	},
	async execute(input, _ctx) {
		const apiKey = vscode.workspace.getConfiguration('kairu.chain').get<string>('etherscanApiKey', '');
		if (!apiKey) { return 'No Etherscan API key configured.'; }
		const hash = String(input.hash);
		const chainId = String(input.chain_id);
		const apiBases = ETHERSCAN_API_BASES;
		const apiBase = apiBases[chainId];
		if (!apiBase) { return `Unsupported chain ID "${chainId}".`; }
		const txResp = await fetch(`${apiBase}?module=proxy&action=eth_getTransactionByHash&txhash=${hash}&apikey=${apiKey}`, { signal: AbortSignal.timeout(15000) });
		const txJson = await txResp.json() as { result?: Record<string, string> };
		if (!txJson.result) { return `Transaction ${hash} not found on chain ${chainId}.`; }
		const tx = txJson.result;
		const receiptResp = await fetch(`${apiBase}?module=proxy&action=eth_getTransactionReceipt&txhash=${hash}&apikey=${apiKey}`, { signal: AbortSignal.timeout(15000) });
		const receiptJson = await receiptResp.json() as { result?: Record<string, string> };
		const receipt = receiptJson.result;
		return `from: ${tx.from}\nto: ${tx.to}\nvalue: ${BigInt(tx.value || '0x0').toString()} wei\nblock: ${parseInt(tx.blockNumber || '0', 16)}\nstatus: ${receipt?.status === '0x1' ? 'success' : receipt ? 'reverted' : 'unknown'}\ngasUsed: ${receipt ? parseInt(receipt.gasUsed || '0x0', 16) : 'unknown'}\n\ninput: ${truncate(tx.input || '0x', 600)}`;
	},
};

const ethCallTool: ToolExecutor = {
	definition: {
		name: 'eth_call',
		description: 'Call a view function on a deployed contract via JSON-RPC. Returns the decoded result. Use this to read on-chain state. Note: only basic types supported (address, uint, int, bool, bytesN, string return).',
		input_schema: {
			type: 'object',
			properties: {
				rpc_url: { type: 'string', description: 'JSON-RPC endpoint, e.g. "http://localhost:8545"' },
				to: { type: 'string', description: 'Contract address' },
				signature: { type: 'string', description: 'Function signature, e.g. "balanceOf(address)" or "totalSupply()"' },
				args: { type: 'array', items: { type: 'string' }, description: 'Arguments as strings (will be ABI-encoded based on signature)' },
				return_type: { type: 'string', description: 'Expected return type for decoding, e.g. "uint256", "address", "bool", "string"' },
			},
			required: ['rpc_url', 'to', 'signature'],
		},
	},
	async execute(input, _ctx) {
		const rpcUrl = String(input.rpc_url);
		const to = String(input.to);
		const signature = String(input.signature);
		const args = Array.isArray(input.args) ? input.args.map(String) : [];
		// Defer to kairu-chain's command for actual encoding/decoding
		try {
			const result = await vscode.commands.executeCommand<{ ok: boolean; decoded?: string; raw?: string; error?: string }>(
				'kairu.chain.ethCallAPI',
				{ rpcUrl, to, signature, args, returnType: input.return_type }
			);
			if (!result) { return 'eth_call command unavailable.'; }
			if (!result.ok) { return `Call failed: ${result.error}`; }
			return `Decoded: ${result.decoded}\nRaw: ${result.raw}`;
		} catch (err) {
			return `eth_call failed: ${(err as Error).message}`;
		}
	},
};

// ── tools: semantic ────────────────────────────────────────────────────────

const findContractTool: ToolExecutor = {
	definition: {
		name: 'find_contract',
		description: 'Locate a contract by name in the workspace. Returns file path, line, kind (contract/interface/library), inheritance, and function signatures.',
		input_schema: {
			type: 'object',
			properties: {
				name: { type: 'string', description: 'Contract name' },
			},
			required: ['name'],
		},
	},
	async execute(input, ctx) {
		const name = String(input.name);
		if (!ctx.semanticIndex) { return 'Semantic index unavailable.'; }
		const contract = ctx.semanticIndex.getContractByName(name);
		if (!contract) { return `Contract "${name}" not found in workspace.`; }
		const fnList = contract.functions.slice(0, 30).map(f =>
			`  ${f.name}(${f.params}) ${f.visibility} ${f.stateMutability}${f.modifiers.length ? ' ' + f.modifiers.join(' ') : ''}${f.returns ? ' returns(' + f.returns + ')' : ''}`
		).join('\n');
		return `${contract.kind} ${contract.name}${contract.inherits.length ? ' is ' + contract.inherits.join(', ') : ''} (line ${contract.lineStart})\nfunctions:\n${fnList}${contract.functions.length > 30 ? `\n  ... (+${contract.functions.length - 30} more)` : ''}`;
	},
};

const searchWorkspaceTool: ToolExecutor = {
	definition: {
		name: 'search_workspace',
		description: 'Keyword search across all indexed Solidity contracts in the workspace. Returns top contracts that contain the query terms. Use this to discover relevant code before making changes.',
		input_schema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'Keywords to search for, e.g. "withdraw reentrancy" or "totalSupply"' },
			},
			required: ['query'],
		},
	},
	async execute(input, ctx) {
		const query = String(input.query);
		if (!ctx.semanticIndex) { return 'Semantic index unavailable.'; }
		const results = ctx.semanticIndex.search(query);
		if (results.length === 0) { return `No contracts matched "${query}".`; }
		const lines = results.map(entry => {
			const names = entry.file.contracts.map(c => c.name).join(', ');
			return `  ${entry.file.filePath.replace(ctx.workspaceRoot ?? '', '').replace(/^\//, '')} → ${names}`;
		});
		return `Top ${results.length} match(es) for "${query}":\n${lines.join('\n')}`;
	},
};

// ── registry export ────────────────────────────────────────────────────────

export const BUILTIN_TOOLS: ToolExecutor[] = [
	readFileTool,
	editFileTool,
	writeFileTool,
	listFilesTool,
	forgeBuildTool,
	forgeTestTool,
	slitherTool,
	patternAuditTool,
	etherscanContractTool,
	etherscanTxTool,
	ethCallTool,
	findContractTool,
	searchWorkspaceTool,
];

export function getToolByName(name: string): ToolExecutor | undefined {
	return BUILTIN_TOOLS.find(t => t.definition.name === name);
}
