# Kairu Studio

**The Web3 IDE.** A purpose-built code editor for smart contract developers — built on VS Code, shipping Foundry, security analysis, and an AI agent that can actually read and modify your code.

> Early access · Work in progress · Feedback welcome

---

## What makes it different

Most AI coding tools are general-purpose chat with syntax highlighting bolted on. Kairu is built around the Web3 development loop:

- **Write** — Solidity/Vyper syntax, 31 snippets, ghost-text completions for common patterns (pragma, contract, function, mappings, etc.)
- **Test** — Foundry integration with inline `▶ Run` / `◇ Debug with AI` buttons above every test function
- **Audit** — Vulnerability scanner runs on every save, inline squiggles, "Fix with AI" lightbulb on each finding
- **Ship** — AI-generated commit messages, AI diff review before you push

---

## AI Features

### Agent loop — not just chat
The AI calls tools in a loop: reads your files, edits them, runs `forge build`, checks if it compiled, and iterates. 13 built-in tools:

`read_file` · `edit_file` · `write_file` · `list_files` · `forge_build` · `forge_test` · `slither_audit` · `pattern_audit` · `etherscan_contract` · `etherscan_tx` · `eth_call` · `find_contract` · `search_workspace`

### Free models via OpenRouter
No credit card required — sign up at [openrouter.ai](https://openrouter.ai) and use:
- `meta-llama/llama-3.3-70b-instruct:free`
- `qwen/qwen2.5-coder-32b-instruct:free`
- `deepseek/deepseek-r1:free`
- `google/gemma-3-27b-it:free`

Also supports Anthropic Claude, OpenAI, Google Gemini, and local Ollama.

### Right-click context menus
Right-click any `.sol` file → **Kairu AI** submenu: Explain, Find Vulnerabilities, Generate Foundry Tests, Generate NatSpec, Optimize Gas, Explain Error.

### Review changes before pushing
`Kairu: Review Changes with AI` — scans staged/unstaged diffs for reentrancy, access control, integer overflow, unchecked calls, and gas problems. Results stream into the chat.

---

## Foundry Integration

- **Test runner panel** — visual pass/fail/skip with per-test gas
- **CodeLens** — `▶ Run`, `◇ Debug with AI`, `-vvvv` inline above every `test*` / `invariant*` function
- **Coverage panel** — line-level gutters
- **Anvil fork manager**
- **Gas snapshot** and **trace viewer**

---

## Security

- 10-pattern vulnerability scanner on every save (reentrancy, tx.origin, unchecked transfers, selfdestruct, delegatecall, timestamp dependence...)
- Slither integration (`pip install slither-analyzer`)
- Inline squiggles + Problems panel
- **"Fix with AI"** code action lightbulb on each finding
- Secret detection in `.env` files

---

## Chain Tools

- Etherscan source + ABI fetcher (Mainnet, Base, Arbitrum, Optimism, Polygon)
- Transaction decoder
- `eth_call` against any RPC endpoint
- RPC manager

---

## Getting Started

### Prerequisites

- macOS (primary target)
- Node.js 18+

```bash
git clone https://github.com/sp0oby/kairu
cd kairu
./scripts/kairu-setup.sh   # installs deps + compiles all extensions (~5 min first run)
./scripts/code.sh           # launch
```

### Set up AI

On first launch, the chat panel shows a **Setup AI (free with OpenRouter)** button. Pick a free model and start building.

---

## Extension Architecture

| Extension | What it does |
|---|---|
| `kairu-ai` | Chat panel, AI agent loop, inline completions, commit message generation, diff review |
| `kairu-foundry` | forge/cast/anvil integration, test panels, CodeLens on test functions |
| `kairu-security` | Pattern scanner, Slither, audit panel, "Fix with AI" code actions |
| `kairu-chain` | Etherscan, RPC manager, transaction analyzer |
| `kairu-dashboard` | Status bar with AI/Foundry connectivity indicators, diagnostics |
| `kairu-web3-tools` | Auto-templates for new `.sol` / `.t.sol` / `.s.sol` / `.vy` files |
| `kairu-snippets` | 31 Solidity snippets (ERC20, EIP712, permit, merkle, ECDSA, diamond proxy, etc.) |

---

## Roadmap

- [ ] Semantic code index (contract graph + function-level search)
- [ ] Multi-file agent edits
- [ ] Exploit replay / PoC generator
- [ ] Protocol memory across sessions
- [ ] Packaged `.dmg` installer

---

## License

MIT — same as VS Code. Built on [Code - OSS](https://github.com/microsoft/vscode).
