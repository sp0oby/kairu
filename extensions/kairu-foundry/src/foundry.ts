/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec as execCb } from 'child_process';

const exec = promisify(execCb);

export interface FoundryInstall {
	forge: boolean;
	cast: boolean;
	anvil: boolean;
	forgeVersion?: string;
	anvilVersion?: string;
}

export async function checkFoundryInstall(): Promise<FoundryInstall> {
	const check = async (bin: string): Promise<string | undefined> => {
		try {
			const { stdout } = await exec(`${bin} --version`, { timeout: 5000 });
			return stdout.trim().split('\n')[0];
		} catch {
			return undefined;
		}
	};

	const [forgeV, castV, anvilV] = await Promise.all([
		check('forge'), check('cast'), check('anvil')
	]);

	return {
		forge: !!forgeV,
		cast: !!castV,
		anvil: !!anvilV,
		forgeVersion: forgeV,
		anvilVersion: anvilV,
	};
}

export function getWorkspaceRoot(): string | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export interface TestResult {
	suite: string;
	contract: string;
	name: string;
	status: 'pass' | 'fail' | 'skip';
	gasUsed?: number;
	duration?: number;
	trace?: string;
	reason?: string;
}

export interface BuildResult {
	success: boolean;
	errors: BuildError[];
	warnings: BuildWarning[];
	output: string;
}

export interface BuildError {
	file?: string;
	line?: number;
	col?: number;
	message: string;
}

export interface BuildWarning {
	file?: string;
	line?: number;
	col?: number;
	message: string;
}

export interface GasSnapshot {
	contract: string;
	test: string;
	gas: number;
}

// Run forge build and parse output
export async function forgeBuild(
	cwd: string,
	onOutput: (line: string) => void
): Promise<BuildResult> {
	return new Promise(resolve => {
		const child = spawn('forge', ['build', '--force'], { cwd, shell: false });
		const lines: string[] = [];
		const errors: BuildError[] = [];
		const warnings: BuildWarning[] = [];
		let success = true;

		const handleLine = (line: string) => {
			lines.push(line);
			onOutput(line);
			parseBuildLine(line, errors, warnings);
		};

		child.stdout.on('data', (d: Buffer) => d.toString().split('\n').forEach(l => l && handleLine(l)));
		child.stderr.on('data', (d: Buffer) => d.toString().split('\n').forEach(l => l && handleLine(l)));
		child.on('close', code => {
			if (code !== 0) { success = false; }
			resolve({ success, errors, warnings, output: lines.join('\n') });
		});
		child.on('error', err => {
			resolve({ success: false, errors: [{ message: err.message }], warnings: [], output: err.message });
		});
	});
}

function parseBuildLine(line: string, errors: BuildError[], warnings: BuildWarning[]): void {
	// Error: --> src/MyContract.sol:10:5:
	const errMatch = line.match(/Error\s*(?:\((\d+)\))?.*?-->\s*(.+?):(\d+):(\d+):/);
	if (errMatch) {
		errors.push({
			file: errMatch[2],
			line: parseInt(errMatch[3]),
			col: parseInt(errMatch[4]),
			message: line.trim(),
		});
		return;
	}
	const warnMatch = line.match(/Warning\s*(?:\((\d+)\))?.*?-->\s*(.+?):(\d+):(\d+):/);
	if (warnMatch) {
		warnings.push({
			file: warnMatch[2],
			line: parseInt(warnMatch[3]),
			col: parseInt(warnMatch[4]),
			message: line.trim(),
		});
	}
}

// Run forge test and parse JSON output
export async function forgeTest(
	cwd: string,
	filter?: string,
	onOutput?: (line: string) => void
): Promise<TestResult[]> {
	return new Promise(resolve => {
		const args = ['test', '--json'];
		if (filter) { args.push('--match-test', filter); }

		const child = spawn('forge', args, { cwd, shell: false });
		let jsonBuf = '';
		const results: TestResult[] = [];

		child.stdout.on('data', (d: Buffer) => {
			const text = d.toString();
			jsonBuf += text;
			onOutput?.(text);
		});
		child.stderr.on('data', (d: Buffer) => {
			onOutput?.(d.toString());
		});

		child.on('close', () => {
			try {
				// forge test --json outputs one JSON object per line or a single object
				const lines = jsonBuf.trim().split('\n').filter(l => l.trim().startsWith('{'));
				for (const line of lines) {
					try {
						const obj = JSON.parse(line);
						results.push(...parseTestJson(obj));
					} catch { /* skip malformed lines */ }
				}
				if (results.length === 0 && jsonBuf.trim().startsWith('{')) {
					const obj = JSON.parse(jsonBuf.trim());
					results.push(...parseTestJson(obj));
				}
			} catch { /* fall through with empty results */ }
			resolve(results);
		});

		child.on('error', () => resolve([]));
	});
}

function parseTestJson(obj: Record<string, unknown>): TestResult[] {
	const results: TestResult[] = [];
	// Forge JSON format: { "ContractName": { "test_name": { success, gas, reason } } }
	for (const [contractName, tests] of Object.entries(obj)) {
		if (typeof tests !== 'object' || tests === null) { continue; }
		for (const [testName, result] of Object.entries(tests as Record<string, unknown>)) {
			if (typeof result !== 'object' || result === null) { continue; }
			const r = result as Record<string, unknown>;
			results.push({
				suite: contractName,
				contract: contractName,
				name: testName,
				status: r.success === true ? 'pass' : r.success === false ? 'fail' : 'skip',
				gasUsed: typeof r.gas === 'number' ? r.gas : undefined,
				reason: typeof r.reason === 'string' ? r.reason : undefined,
			});
		}
	}
	return results;
}

// Run forge snapshot and parse output
export async function forgeGasSnapshot(cwd: string): Promise<GasSnapshot[]> {
	return new Promise(resolve => {
		const child = spawn('forge', ['snapshot', '--no-match-test', 'NOTHING_MATCH'], { cwd, shell: false });
		const lines: string[] = [];
		child.stdout.on('data', (d: Buffer) => lines.push(...d.toString().split('\n')));
		child.stderr.on('data', (d: Buffer) => lines.push(...d.toString().split('\n')));
		child.on('close', () => resolve(parseGasSnapshot(lines)));
		child.on('error', () => resolve([]));
	});
}

export async function forgeGasSnapshotFromFile(cwd: string): Promise<GasSnapshot[]> {
	try {
		const { stdout } = await exec('cat .gas-snapshot 2>/dev/null || forge snapshot --check 2>&1 || forge snapshot 2>&1', { cwd, timeout: 60000 });
		return parseGasSnapshot(stdout.split('\n'));
	} catch {
		return [];
	}
}

function parseGasSnapshot(lines: string[]): GasSnapshot[] {
	const results: GasSnapshot[] = [];
	// Format: ContractName:testFunctionName() (gas: 12345)
	for (const line of lines) {
		const m = line.match(/^(\w+):(\w+)\(\)\s*\(gas:\s*(\d+)\)$/);
		if (m) {
			results.push({ contract: m[1], test: m[2], gas: parseInt(m[3]) });
		}
	}
	return results;
}

export interface AnvilInstance {
	port: number;
	forkUrl?: string;
	blockNumber?: string;
	pid?: number;
}

export type AnvilChild = ReturnType<typeof spawnAnvil>;

export function spawnAnvil(
	port: number,
	forkUrl?: string,
	blockNumber?: string,
	onOutput?: (line: string) => void
): { kill: () => void; ready: Promise<void> } {
	const args = ['--port', String(port), '--block-time', '1'];
	if (forkUrl) {
		args.push('--fork-url', forkUrl);
		if (blockNumber) { args.push('--fork-block-number', blockNumber); }
	}

	const child = spawn('anvil', args, { shell: false });
	let resolve!: () => void;
	let reject!: (e: Error) => void;
	const ready = new Promise<void>((res, rej) => { resolve = res; reject = rej; });

	child.stdout.on('data', (d: Buffer) => {
		const text = d.toString();
		onOutput?.(text);
		if (text.includes('Listening on') || text.includes('Listening at')) {
			resolve();
		}
	});

	child.stderr.on('data', (d: Buffer) => {
		onOutput?.(d.toString());
	});

	child.on('error', err => {
		reject(err);
	});

	child.on('close', code => {
		if (code !== 0) {
			reject(new Error(`anvil exited with code ${code}`));
		}
	});

	// Timeout after 10s
	const timeout = setTimeout(() => reject(new Error('anvil did not start in time')), 10000);
	ready.finally(() => clearTimeout(timeout));

	return {
		kill: () => { child.kill(); },
		ready,
	};
}

export async function castCall(rpcUrl: string, to: string, calldata: string): Promise<string> {
	const { stdout } = await exec(`cast call --rpc-url ${rpcUrl} ${to} "${calldata}"`, { timeout: 10000 });
	return stdout.trim();
}

export async function castSend(rpcUrl: string, to: string, calldata: string, privateKey: string): Promise<string> {
	const { stdout } = await exec(`cast send --rpc-url ${rpcUrl} --private-key ${privateKey} ${to} "${calldata}"`, { timeout: 30000 });
	return stdout.trim();
}

export async function castDecodeCalldata(sig: string, calldata: string): Promise<string> {
	const { stdout } = await exec(`cast decode-calldata "${sig}" ${calldata}`, { timeout: 5000 });
	return stdout.trim();
}

