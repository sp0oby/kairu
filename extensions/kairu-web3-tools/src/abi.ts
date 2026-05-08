/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kairu Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

export interface AbiInput {
	name: string;
	type: string;
	internalType?: string;
	components?: AbiInput[];
	indexed?: boolean;
}

export interface AbiItem {
	type: 'function' | 'constructor' | 'receive' | 'fallback' | 'event' | 'error';
	name?: string;
	inputs?: AbiInput[];
	outputs?: AbiInput[];
	stateMutability?: 'pure' | 'view' | 'nonpayable' | 'payable';
	anonymous?: boolean;
}

export function parseAbi(raw: string): AbiItem[] | null {
	try {
		const parsed = JSON.parse(raw);
		// Handle both raw ABI arrays and compiled artifact objects
		if (Array.isArray(parsed)) {
			return parsed as AbiItem[];
		}
		if (parsed && typeof parsed === 'object') {
			// Hardhat/Foundry artifact: { abi: [...] }
			if (Array.isArray(parsed.abi)) {
				return parsed.abi as AbiItem[];
			}
			// Truffle artifact: { abi: [...] }
			if (Array.isArray(parsed.contractName) && Array.isArray(parsed.abi)) {
				return parsed.abi as AbiItem[];
			}
		}
		return null;
	} catch {
		return null;
	}
}

export function encodeSelector(item: AbiItem): string {
	if (!item.name || item.type === 'event') {
		return '';
	}
	const sig = `${item.name}(${(item.inputs || []).map(flattenType).join(',')})`;
	return keccak256Selector(sig);
}

export function encodeEventTopic(item: AbiItem): string {
	if (item.type !== 'event' || !item.name) {
		return '';
	}
	const sig = `${item.name}(${(item.inputs || []).map(flattenType).join(',')})`;
	return keccak256Full(sig);
}

function flattenType(input: AbiInput): string {
	if (input.type === 'tuple' && input.components) {
		return `(${input.components.map(flattenType).join(',')})`;
	}
	if (input.type.startsWith('tuple[') && input.components) {
		const suffix = input.type.slice('tuple'.length);
		return `(${input.components.map(flattenType).join(',')})${suffix}`;
	}
	return input.type;
}

// Minimal keccak256 for 4-byte selector computation.
// We implement a pure-JS keccak256 to avoid external deps in the extension host.

function keccak256Selector(sig: string): string {
	const hash = keccak256Full(sig);
	return '0x' + hash.slice(0, 8);
}

function keccak256Full(sig: string): string {
	const bytes = strToBytes(sig);
	return keccakHash(bytes);
}

function strToBytes(s: string): Uint8Array {
	return new TextEncoder().encode(s);
}

// Keccak-256 implementation (FIPS 202 SHA-3 variant with rate=1088, capacity=512)
function keccakHash(data: Uint8Array): string {
	const RATE = 136; // bytes (1088 bits)
	const OUTPUT = 32; // bytes

	// State as 25 64-bit lanes stored as pairs of 32-bit ints [lo, hi]
	const state = new Uint32Array(50);

	// Padding: multi-rate padding with 0x01 delimiter (Keccak, not SHA-3)
	const msgLen = data.length;
	const blocks = Math.ceil((msgLen + 1) / RATE);
	const padded = new Uint8Array(blocks * RATE);
	padded.set(data);
	padded[msgLen] = 0x01;
	padded[padded.length - 1] |= 0x80;

	// Absorb
	for (let b = 0; b < blocks; b++) {
		const block = padded.subarray(b * RATE, (b + 1) * RATE);
		for (let i = 0; i < RATE / 8; i++) {
			const lo = block[i * 8] | (block[i * 8 + 1] << 8) | (block[i * 8 + 2] << 16) | (block[i * 8 + 3] << 24);
			const hi = block[i * 8 + 4] | (block[i * 8 + 5] << 8) | (block[i * 8 + 6] << 16) | (block[i * 8 + 7] << 24);
			state[i * 2] ^= lo;
			state[i * 2 + 1] ^= hi;
		}
		keccakF(state);
	}

	// Squeeze
	const out: string[] = [];
	for (let i = 0; i < OUTPUT / 4; i++) {
		out.push(state[i].toString(16).padStart(8, '0').replace(/(..)/g, (_, b) => b));
	}
	// Fix endianness per lane
	const bytes: number[] = [];
	for (let i = 0; i < OUTPUT / 4; i++) {
		const word = state[i];
		bytes.push(word & 0xff, (word >> 8) & 0xff, (word >> 16) & 0xff, (word >> 24) & 0xff);
	}
	return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

const RC: [number, number][] = [
	[0x00000001, 0x00000000], [0x00008082, 0x00000000], [0x0000808A, 0x80000000], [0x80008000, 0x80000000],
	[0x0000808B, 0x00000000], [0x80000001, 0x00000000], [0x80008081, 0x80000000], [0x00008009, 0x80000000],
	[0x0000008A, 0x00000000], [0x00000088, 0x00000000], [0x80008009, 0x00000000], [0x8000000A, 0x00000000],
	[0x8000808B, 0x00000000], [0x0000008B, 0x80000000], [0x00008089, 0x80000000], [0x00008003, 0x80000000],
	[0x00008002, 0x80000000], [0x00000080, 0x80000000], [0x0000800A, 0x00000000], [0x8000000A, 0x80000000],
	[0x80008081, 0x80000000], [0x00008080, 0x80000000], [0x80000001, 0x00000000], [0x80008008, 0x80000000],
];

const RHO: number[] = [
	0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43,
	25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
];

const PI: number[] = [
	0, 10, 20, 5, 15, 16, 1, 11, 21, 6, 7, 17, 2,
	12, 22, 23, 8, 18, 3, 13, 14, 24, 9, 19, 4,
];

function rot64(lo: number, hi: number, n: number): [number, number] {
	if (n === 0) { return [lo, hi]; }
	if (n === 32) { return [hi, lo]; }
	if (n < 32) {
		return [(lo << n) | (hi >>> (32 - n)), (hi << n) | (lo >>> (32 - n))];
	}
	n -= 32;
	return [(hi << n) | (lo >>> (32 - n)), (lo << n) | (hi >>> (32 - n))];
}

function keccakF(s: Uint32Array): void {
	const bc = new Uint32Array(10);

	for (let r = 0; r < 24; r++) {
		// Theta
		for (let x = 0; x < 5; x++) {
			bc[x * 2] = s[x * 2] ^ s[(x + 5) * 2] ^ s[(x + 10) * 2] ^ s[(x + 15) * 2] ^ s[(x + 20) * 2];
			bc[x * 2 + 1] = s[x * 2 + 1] ^ s[(x + 5) * 2 + 1] ^ s[(x + 10) * 2 + 1] ^ s[(x + 15) * 2 + 1] ^ s[(x + 20) * 2 + 1];
		}
		for (let x = 0; x < 5; x++) {
			const nx = (x + 1) % 5;
			const [rlo, rhi] = rot64(bc[nx * 2], bc[nx * 2 + 1], 1);
			const tlo = bc[((x + 4) % 5) * 2] ^ rlo;
			const thi = bc[((x + 4) % 5) * 2 + 1] ^ rhi;
			for (let y = 0; y < 5; y++) {
				s[(y * 5 + x) * 2] ^= tlo;
				s[(y * 5 + x) * 2 + 1] ^= thi;
			}
		}
		// Rho + Pi
		const tmp = new Uint32Array(50);
		for (let x = 0; x < 25; x++) {
			const [rlo, rhi] = rot64(s[x * 2], s[x * 2 + 1], RHO[x]);
			tmp[PI[x] * 2] = rlo;
			tmp[PI[x] * 2 + 1] = rhi;
		}
		// Chi
		for (let y = 0; y < 5; y++) {
			for (let x = 0; x < 5; x++) {
				const i = (y * 5 + x) * 2;
				const ni = (y * 5 + (x + 1) % 5) * 2;
				const nni = (y * 5 + (x + 2) % 5) * 2;
				s[i] = tmp[i] ^ (~tmp[ni] & tmp[nni]);
				s[i + 1] = tmp[i + 1] ^ (~tmp[ni + 1] & tmp[nni + 1]);
			}
		}
		// Iota
		s[0] ^= RC[r][0];
		s[1] ^= RC[r][1];
	}
}

export function calldataDecode(hex: string, abi: AbiItem[]): { fn: AbiItem; decoded: Record<string, string> } | null {
	const clean = hex.trim().replace(/^0x/, '');
	if (clean.length < 8) { return null; }
	const selector = clean.slice(0, 8).toLowerCase();

	const fn = abi.find(item =>
		item.type === 'function' &&
		item.name &&
		encodeSelector(item).slice(2) === selector
	);
	if (!fn) { return null; }

	const data = clean.slice(8);
	const decoded: Record<string, string> = {};
	const inputs = fn.inputs || [];

	// Simple ABI decode for basic types (uint256, address, bool, bytes32, string, bytes)
	let offset = 0;
	for (const input of inputs) {
		const word = data.slice(offset, offset + 64);
		offset += 64;
		decoded[input.name || `param${offset / 64}`] = decodeWord(word, input.type, data);
	}

	return { fn, decoded };
}

function decodeWord(word: string, type: string, fullData: string): string {
	if (!word) { return '(empty)'; }
	if (type === 'address') {
		return '0x' + word.slice(24);
	}
	if (type === 'bool') {
		return BigInt('0x' + word) === 0n ? 'false' : 'true';
	}
	if (type.startsWith('uint') || type.startsWith('int')) {
		return BigInt('0x' + word).toString();
	}
	if (type.startsWith('bytes') && type !== 'bytes') {
		return '0x' + word.replace(/0+$/, '');
	}
	if (type === 'bytes' || type === 'string') {
		// Dynamic type: word is offset into fullData
		try {
			const off = Number(BigInt('0x' + word)) * 2;
			const lenWord = fullData.slice(off, off + 64);
			const len = Number(BigInt('0x' + lenWord));
			const raw = fullData.slice(off + 64, off + 64 + len * 2);
			if (type === 'string') {
				return new TextDecoder().decode(hexToBytes(raw));
			}
			return '0x' + raw;
		} catch {
			return '0x' + word;
		}
	}
	return '0x' + word;
}

function hexToBytes(hex: string): Uint8Array {
	const arr = new Uint8Array(hex.length / 2);
	for (let i = 0; i < arr.length; i++) {
		arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return arr;
}

export function computeStorageSlot(varIndex: number, mappingKey?: string, mappingKeyType?: string): string {
	if (mappingKey !== undefined && mappingKey !== '') {
		// mapping slot: keccak256(key . slot)
		const keyBytes = encodeAbiValue(mappingKey, mappingKeyType || 'address');
		const slotBytes = numToBytes32(varIndex);
		const combined = new Uint8Array(keyBytes.length + slotBytes.length);
		combined.set(keyBytes);
		combined.set(slotBytes, keyBytes.length);
		const hash = keccakHash(combined);
		return '0x' + hash;
	}
	return '0x' + Array.from(numToBytes32(varIndex)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function numToBytes32(n: number): Uint8Array {
	const arr = new Uint8Array(32);
	let val = n;
	for (let i = 31; i >= 0 && val > 0; i--) {
		arr[i] = val & 0xff;
		val = Math.floor(val / 256);
	}
	return arr;
}

function encodeAbiValue(val: string, type: string): Uint8Array {
	const arr = new Uint8Array(32);
	if (type === 'address') {
		const clean = val.replace(/^0x/, '').padStart(64, '0');
		const bytes = hexToBytes(clean.slice(-64));
		arr.set(bytes, 32 - bytes.length);
		return arr;
	}
	if (type.startsWith('uint') || type.startsWith('int')) {
		let n: bigint;
		try { n = BigInt(val); } catch { n = 0n; }
		const hex = (n < 0n ? (2n ** 256n + n) : n).toString(16).padStart(64, '0');
		arr.set(hexToBytes(hex));
		return arr;
	}
	// Default: treat as bytes32
	const clean = val.replace(/^0x/, '').padStart(64, '0').slice(0, 64);
	arr.set(hexToBytes(clean));
	return arr;
}
