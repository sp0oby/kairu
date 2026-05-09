/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

export interface ChainInfo {
	name: string;
	explorer: string;
	apiBase: string;
	rpc: string;
	isTestnet?: boolean;
}

export const CHAINS: Record<string, ChainInfo> = {
	// ── Mainnets ──────────────────────────────────────────────────────────
	'1':     { name: 'Ethereum Mainnet', explorer: 'https://etherscan.io', apiBase: 'https://api.etherscan.io/api', rpc: 'https://cloudflare-eth.com' },
	'10':    { name: 'Optimism', explorer: 'https://optimistic.etherscan.io', apiBase: 'https://api-optimistic.etherscan.io/api', rpc: 'https://mainnet.optimism.io' },
	'8453':  { name: 'Base', explorer: 'https://basescan.org', apiBase: 'https://api.basescan.org/api', rpc: 'https://mainnet.base.org' },
	'42161': { name: 'Arbitrum One', explorer: 'https://arbiscan.io', apiBase: 'https://api.arbiscan.io/api', rpc: 'https://arb1.arbitrum.io/rpc' },
	'137':   { name: 'Polygon', explorer: 'https://polygonscan.com', apiBase: 'https://api.polygonscan.com/api', rpc: 'https://polygon-rpc.com' },
	'56':    { name: 'BSC', explorer: 'https://bscscan.com', apiBase: 'https://api.bscscan.com/api', rpc: 'https://bsc-dataseed.binance.org' },
	'43114': { name: 'Avalanche', explorer: 'https://snowtrace.io', apiBase: 'https://api.snowtrace.io/api', rpc: 'https://api.avax.network/ext/bc/C/rpc' },
	'534352':{ name: 'Scroll', explorer: 'https://scrollscan.com', apiBase: 'https://api.scrollscan.com/api', rpc: 'https://rpc.scroll.io' },
	'324':   { name: 'zkSync Era', explorer: 'https://explorer.zksync.io', apiBase: 'https://block-explorer-api.mainnet.zksync.io/api', rpc: 'https://mainnet.era.zksync.io' },

	// ── Testnets ──────────────────────────────────────────────────────────
	'11155111': { name: 'Sepolia',           explorer: 'https://sepolia.etherscan.io',         apiBase: 'https://api-sepolia.etherscan.io/api',         rpc: 'https://ethereum-sepolia-rpc.publicnode.com', isTestnet: true },
	'17000':    { name: 'Holesky',           explorer: 'https://holesky.etherscan.io',         apiBase: 'https://api-holesky.etherscan.io/api',         rpc: 'https://ethereum-holesky-rpc.publicnode.com', isTestnet: true },
	'84532':    { name: 'Base Sepolia',      explorer: 'https://sepolia.basescan.org',         apiBase: 'https://api-sepolia.basescan.org/api',         rpc: 'https://sepolia.base.org',                    isTestnet: true },
	'11155420': { name: 'Optimism Sepolia',  explorer: 'https://sepolia-optimism.etherscan.io', apiBase: 'https://api-sepolia-optimistic.etherscan.io/api', rpc: 'https://sepolia.optimism.io',          isTestnet: true },
	'421614':   { name: 'Arbitrum Sepolia',  explorer: 'https://sepolia.arbiscan.io',          apiBase: 'https://api-sepolia.arbiscan.io/api',          rpc: 'https://sepolia-rollup.arbitrum.io/rpc',      isTestnet: true },
	'80002':    { name: 'Polygon Amoy',      explorer: 'https://amoy.polygonscan.com',         apiBase: 'https://api-amoy.polygonscan.com/api',         rpc: 'https://rpc-amoy.polygon.technology',         isTestnet: true },
	'97':       { name: 'BSC Testnet',       explorer: 'https://testnet.bscscan.com',          apiBase: 'https://api-testnet.bscscan.com/api',          rpc: 'https://data-seed-prebsc-1-s1.binance.org:8545', isTestnet: true },
	'43113':    { name: 'Avalanche Fuji',    explorer: 'https://testnet.snowtrace.io',         apiBase: 'https://api-testnet.snowtrace.io/api',         rpc: 'https://api.avax-test.network/ext/bc/C/rpc',  isTestnet: true },
	'534351':   { name: 'Scroll Sepolia',    explorer: 'https://sepolia.scrollscan.com',       apiBase: 'https://api-sepolia.scrollscan.com/api',       rpc: 'https://sepolia-rpc.scroll.io',               isTestnet: true },

	// ── Local ─────────────────────────────────────────────────────────────
	'31337':    { name: 'Anvil (local)',     explorer: '',                                      apiBase: '',                                              rpc: 'http://localhost:8545',                       isTestnet: true },
};

export interface ContractInfo {
	address: string;
	name: string;
	verified: boolean;
	abi?: string;
	sourceCode?: string;
	compiler?: string;
	optimized?: boolean;
	proxy?: boolean;
	implementation?: string;
}

export interface TxInfo {
	hash: string;
	from: string;
	to: string;
	value: string;
	input: string;
	blockNumber: number;
	status?: number;
	gasUsed?: number;
}

// Etherscan V2 API: one base URL, one API key, all chains.
// https://docs.etherscan.io/etherscan-v2/getting-started/v2-quickstart
const ETHERSCAN_V2_API = 'https://api.etherscan.io/v2/api';

function v2Url(chainId: string, params: Record<string, string>, apiKey: string): string {
	const qs = new URLSearchParams({
		chainid: chainId,
		...params,
		apikey: apiKey,
	});
	return `${ETHERSCAN_V2_API}?${qs.toString()}`;
}

export async function fetchContractInfo(
	address: string,
	chainId: string,
	apiKey: string
): Promise<ContractInfo | null> {
	if (!CHAINS[chainId]) { return null; }

	const url = v2Url(chainId, {
		module: 'contract',
		action: 'getsourcecode',
		address,
	}, apiKey);
	try {
		const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
		const json = await resp.json() as { status: string; message?: string; result: Array<Record<string, string>> | string };
		if (typeof json.result === 'string') {
			console.warn('Etherscan V2 error:', json.message, json.result);
			return null;
		}
		if (json.status !== '1' || !json.result?.[0]) { return null; }
		const r = json.result[0];
		return {
			address,
			name: r['ContractName'] || 'Unknown',
			verified: !!r['ABI'] && r['ABI'] !== 'Contract source code not verified',
			abi: r['ABI'] !== 'Contract source code not verified' ? r['ABI'] : undefined,
			sourceCode: r['SourceCode'],
			compiler: r['CompilerVersion'],
			optimized: r['OptimizationUsed'] === '1',
			proxy: r['Proxy'] === '1',
			implementation: r['Implementation'],
		};
	} catch (err) {
		console.warn('fetchContractInfo failed:', err);
		return null;
	}
}

export async function fetchTxInfo(
	txHash: string,
	chainId: string,
	apiKey: string
): Promise<TxInfo | null> {
	if (!CHAINS[chainId]) { return null; }

	const url = v2Url(chainId, {
		module: 'proxy',
		action: 'eth_getTransactionByHash',
		txhash: txHash,
	}, apiKey);
	try {
		const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
		const json = await resp.json() as { result?: Record<string, string> | null };
		const r = json.result;
		if (!r) { return null; }
		return {
			hash: r['hash'] || txHash,
			from: r['from'] || '',
			to: r['to'] || '',
			value: BigInt(r['value'] || '0x0').toString(),
			input: r['input'] || '0x',
			blockNumber: parseInt(r['blockNumber'] || '0', 16),
		};
	} catch {
		return null;
	}
}

export async function fetchTxReceipt(
	txHash: string,
	chainId: string,
	apiKey: string
): Promise<{ status: number; gasUsed: number } | null> {
	if (!CHAINS[chainId]) { return null; }
	const url = v2Url(chainId, {
		module: 'proxy',
		action: 'eth_getTransactionReceipt',
		txhash: txHash,
	}, apiKey);
	try {
		const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
		const json = await resp.json() as { result?: Record<string, string> | null };
		const r = json.result;
		if (!r) { return null; }
		return {
			status: parseInt(r['status'] || '0x1', 16),
			gasUsed: parseInt(r['gasUsed'] || '0x0', 16),
		};
	} catch {
		return null;
	}
}

// Look up 4byte selector from 4byte.directory
export async function lookup4Byte(selector: string): Promise<string | null> {
	try {
		const url = `https://www.4byte.directory/api/v1/signatures/?hex_signature=${selector}`;
		const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
		const json = await resp.json() as { results?: Array<{ text_signature: string }> };
		return json.results?.[0]?.text_signature ?? null;
	} catch {
		return null;
	}
}
