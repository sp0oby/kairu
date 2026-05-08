/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { exec as execCb } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCb);

export type SlitherSeverity = 'High' | 'Medium' | 'Low' | 'Informational' | 'Optimization';

export interface SlitherFinding {
	check: string;
	impact: SlitherSeverity;
	confidence: string;
	description: string;
	elements: Array<{
		name: string;
		source_mapping?: {
			filename_relative?: string;
			lines?: number[];
		};
	}>;
}

export interface SlitherResult {
	success: boolean;
	findings: SlitherFinding[];
	error?: string;
}

export async function checkSlitherInstalled(): Promise<boolean> {
	try {
		await exec('slither --version', { timeout: 5000 });
		return true;
	} catch {
		return false;
	}
}

export async function runSlither(filePath: string, cwd: string): Promise<SlitherResult> {
	try {
		const { stdout, stderr } = await exec(
			`slither "${filePath}" --json -`,
			{ cwd, timeout: 120000 }
		);

		// Slither outputs JSON to stdout when --json - is used
		const json = stdout || stderr;
		const parsed = JSON.parse(json);

		if (!parsed.success && !parsed.results) {
			return { success: false, findings: [], error: parsed.error || 'Slither returned no results.' };
		}

		const detectors = parsed.results?.detectors || [];
		const findings: SlitherFinding[] = detectors.map((d: Record<string, unknown>) => ({
			check: String(d.check || ''),
			impact: (d.impact as SlitherSeverity) || 'Low',
			confidence: String(d.confidence || ''),
			description: String(d.description || ''),
			elements: Array.isArray(d.elements) ? d.elements as SlitherFinding['elements'] : [],
		}));

		return { success: true, findings };
	} catch (err) {
		const errMsg = (err as Error).message || String(err);
		if (/not found|No such file|command not found/i.test(errMsg)) {
			return { success: false, findings: [], error: 'slither not found. Install with: pip install slither-analyzer' };
		}
		return { success: false, findings: [], error: errMsg };
	}
}
