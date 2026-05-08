// Kairu AI chat webview
(function () {
	'use strict';

	const vscode = acquireVsCodeApi();
	const messagesEl = document.getElementById('messages');
	const inputEl = document.getElementById('input');
	const sendBtn = document.getElementById('send-btn');
	const clearBtn = document.getElementById('clear-btn');
	const providerPill = document.getElementById('provider-pill');
	const modelPill = document.getElementById('model-pill');
	const hintContextEl = document.getElementById('hint-context');

	let busy = false;
	let liveAssistantEl = null;
	let messageBuffer = '';

	function escapeHtml(s) {
		return s
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	// Minimal markdown: paragraphs, fenced code blocks, inline code, bold, italic.
	function renderMarkdown(src) {
		const parts = [];
		let cursor = 0;
		const fenceRegex = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)(?:```|$)/g;
		let match;
		while ((match = fenceRegex.exec(src)) !== null) {
			const before = src.slice(cursor, match.index);
			if (before) {
				parts.push({ type: 'text', value: before });
			}
			parts.push({ type: 'code', lang: match[1], value: match[2] });
			cursor = fenceRegex.lastIndex;
		}
		if (cursor < src.length) {
			parts.push({ type: 'text', value: src.slice(cursor) });
		}

		return parts.map(part => {
			if (part.type === 'code') {
				const lang = escapeHtml(part.lang || '');
				const code = escapeHtml(part.value);
				return `<div class="kairu-code-block">
					<div class="kairu-code-header">
						<span class="kairu-code-lang">${lang || 'code'}</span>
						<button class="kairu-code-action" data-action="copy">Copy</button>
						<button class="kairu-code-action" data-action="insert">Insert</button>
					</div>
					<pre><code>${code}</code></pre>
				</div>`;
			}
			let html = escapeHtml(part.value);
			html = html.replace(/`([^`\n]+)`/g, '<code class="kairu-inline-code">$1</code>');
			html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
			html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
			html = html.replace(/\n\n+/g, '</p><p>');
			html = html.replace(/\n/g, '<br>');
			return `<p>${html}</p>`;
		}).join('');
	}

	function clearEmptyState() {
		const empty = messagesEl.querySelector('.kairu-empty');
		if (empty) {
			empty.remove();
		}
	}

	function addMessage(role, content) {
		clearEmptyState();
		const wrapper = document.createElement('div');
		wrapper.className = `kairu-message kairu-message-${role}`;
		wrapper.innerHTML = `
			<div class="kairu-message-role">${role === 'assistant' ? 'Kairu' : 'You'}</div>
			<div class="kairu-message-body">${renderMarkdown(content)}</div>
		`;
		messagesEl.appendChild(wrapper);
		scrollToBottom();
		return wrapper;
	}

	function scrollToBottom() {
		messagesEl.scrollTop = messagesEl.scrollHeight;
	}

	const SUGGESTED_PROMPTS = [
		{ icon: '◆', text: 'Audit this contract for vulnerabilities' },
		{ icon: '◇', text: 'Explain what the active file does' },
		{ icon: '○', text: 'Generate Foundry tests for the selection' },
		{ icon: '◐', text: 'Optimize gas usage in this function' }
	];

	function buildEmptyState(state) {
		const chips = SUGGESTED_PROMPTS.map(p =>
			`<button class="kairu-prompt-chip" data-prompt="${escapeHtml(p.text)}">
				<span class="kairu-prompt-chip-icon">${p.icon}</span>
				<span>${escapeHtml(p.text)}</span>
			</button>`
		).join('');

		const providerLabel = state ? escapeHtml(state.provider) : 'Ollama (local)';
		const modelLabel = state && state.model && state.model !== '(no model)'
			? escapeHtml(state.model)
			: 'no model selected';

		return `<div class="kairu-empty">
			<div class="kairu-empty-mark">K</div>
			<div>
				<h1 class="kairu-empty-title">How can I help with your code?</h1>
				<p class="kairu-empty-sub">Local-first AI for Web3 development. Ask about Solidity, Foundry, security, exploits, or anything in your workspace.</p>
			</div>
			<div class="kairu-prompt-grid">${chips}</div>
			<div class="kairu-status-bar">
				<span class="kairu-status-tag">${providerLabel}</span>
				<span class="kairu-status-tag">${modelLabel}</span>
			</div>
		</div>`;
	}

	function renderState(state) {
		messagesEl.innerHTML = '';
		if (state.messages.length === 0) {
			messagesEl.innerHTML = buildEmptyState(state);
		} else {
			for (const m of state.messages) {
				addMessage(m.role, m.content);
			}
		}
		providerPill.textContent = state.provider;
		modelPill.textContent = state.model;

		// Context indicator in input hint
		if (hintContextEl) {
			if (state.context) {
				const ctx = state.context;
				const label = ctx.isSelection
					? `${ctx.fileName} ${ctx.lineRange} attached`
					: `${ctx.fileName} attached`;
				hintContextEl.textContent = label;
				hintContextEl.title = ctx.isSelection
					? `Selected lines from ${ctx.fileName} will be sent as context`
					: `${ctx.fileName} will be sent as context`;
			} else {
				hintContextEl.textContent = 'No file context';
				hintContextEl.title = '';
			}
		}

		busy = state.busy;
		updateSendButton();
	}

	function updateSendButton() {
		sendBtn.classList.toggle('busy', busy);
		sendBtn.title = busy ? 'Stop' : 'Send (⌘↵)';
	}

	function handleSend() {
		if (busy) {
			vscode.postMessage({ type: 'cancel' });
			return;
		}
		const text = inputEl.value.trim();
		if (!text) {
			return;
		}
		vscode.postMessage({ type: 'send', text });
		inputEl.value = '';
		autosize();
	}

	function autosize() {
		inputEl.style.height = 'auto';
		inputEl.style.height = Math.min(inputEl.scrollHeight, 240) + 'px';
	}

	inputEl.addEventListener('input', autosize);
	inputEl.addEventListener('keydown', e => {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			handleSend();
		} else if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
			e.preventDefault();
			handleSend();
		}
	});
	sendBtn.addEventListener('click', handleSend);
	clearBtn.addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
	providerPill.addEventListener('click', () => vscode.postMessage({ type: 'pickProvider' }));
	modelPill.addEventListener('click', () => vscode.postMessage({ type: 'pickModel' }));

	messagesEl.addEventListener('click', e => {
		const promptChip = e.target.closest('.kairu-prompt-chip');
		if (promptChip) {
			const text = promptChip.dataset.prompt;
			if (text) {
				inputEl.value = text;
				autosize();
				inputEl.focus();
			}
			return;
		}

		const btn = e.target.closest('.kairu-code-action');
		if (!btn) {
			return;
		}
		const codeEl = btn.closest('.kairu-code-block').querySelector('code');
		const text = codeEl.textContent;
		if (btn.dataset.action === 'copy') {
			navigator.clipboard.writeText(text);
			btn.textContent = 'Copied';
			setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
		} else if (btn.dataset.action === 'insert') {
			vscode.postMessage({ type: 'insert', text });
		}
	});

	window.addEventListener('message', event => {
		const msg = event.data;
		switch (msg.type) {
			case 'state':
				renderState(msg.state);
				return;
			case 'streamStart':
				messageBuffer = '';
				liveAssistantEl = addMessage('assistant', '');
				return;
			case 'append':
				if (!liveAssistantEl) {
					liveAssistantEl = addMessage('assistant', '');
				}
				messageBuffer += msg.delta;
				const body = liveAssistantEl.querySelector('.kairu-message-body');
				body.innerHTML = renderMarkdown(messageBuffer);
				scrollToBottom();
				return;
			case 'streamEnd':
				liveAssistantEl = null;
				messageBuffer = '';
				return;
			case 'error':
				if (!liveAssistantEl) {
					addMessage('assistant', `_Error: ${msg.error}_`);
				}
				return;
			case 'cleared':
				messageBuffer = '';
				liveAssistantEl = null;
				return;
		}
	});

	vscode.postMessage({ type: 'requestState' });
})();
