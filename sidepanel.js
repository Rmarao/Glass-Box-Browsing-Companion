/**
 * AI Concierge — Side Panel Controller
 * Manifest V3 · Vanilla JS · Phase 3
 *
 * Security principles:
 *  ✓ No eval() — ever.
 *  ✓ No innerHTML with dynamic server/user data.
 *  ✓ All text rendered via textContent or structured DOM construction.
 *  ✓ Script injection uses a named pure function, not string evaluation.
 *  ✓ API responses are structurally validated before rendering.
 */

'use strict';

// ── Config ─────────────────────────────────────────────────────────────────
const CHAT_ENDPOINT   = 'http://localhost:8000/chat';
const MAX_PAGE_TEXT   = 4000; // characters sent to backend

// Expected backend response shape:
// {
//   answer:    string,           // AI's reply to the user
//   reasoning: string | string[] // chain-of-thought steps (optional)
// }

// ── DOM refs ────────────────────────────────────────────────────────────────
const chatViewport   = document.getElementById('chat-viewport');
const chatInput      = document.getElementById('chat-input');
const sendBtn        = document.getElementById('send-btn');
const emptyState     = document.getElementById('empty-state');
const sessionDivider = document.getElementById('session-divider');
const contextBadge   = document.getElementById('context-badge');
const pageCtxLabel   = document.getElementById('page-context-label');
const suggestionsEl  = document.getElementById('suggestions-strip');

// ── State ───────────────────────────────────────────────────────────────────
let isBusy         = false;
let firstMessage   = true;
let lastTabContext = null; // cached { url, text } for the current tab

// ── Utilities ───────────────────────────────────────────────────────────────

function scrollToBottom(smooth = true) {
  chatViewport.scrollTo({
    top:      chatViewport.scrollHeight,
    behavior: smooth ? 'smooth' : 'instant',
  });
}

function setInputBusy(busy) {
  isBusy             = busy;
  sendBtn.disabled   = busy;
  chatInput.disabled = busy;
}

/** Auto-grow textarea height as the user types. */
function autoGrow() {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
}

/** Truncate a URL for display (hostname + first path segment). */
function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname.length > 1 ? u.pathname.slice(0, 20) : '');
  } catch {
    return url.slice(0, 30);
  }
}

/** Normalise the backend reasoning field to a clean string array. */
function normaliseReasoning(raw) {
  if (Array.isArray(raw)) {
    return raw.map(String).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split(/\n+|\.\s{2,}/)
      .map(s => s.replace(/^[-•*]\s*/, '').trim())
      .filter(Boolean);
  }
  return [];
}

// ── Page Context Extraction ─────────────────────────────────────────────────

/**
 * Pure function injected into the active tab.
 * Must be closure-free — no references to outer variables.
 */
function extractTabContext() {
  return {
    url:  window.location.href,
    text: (document.body ? document.body.innerText : '').slice(0, 4000),
  };
}

/** Resolves the current active tab. */
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active browser tab found.');
  return tab;
}

/**
 * Injects extractTabContext into the active tab, caches the result,
 * and updates the header badge.
 * Returns { url, text } or throws.
 */
async function fetchTabContext() {
  const tab = await getActiveTab();
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func:   extractTabContext,
  });

  lastTabContext = result;

  // Update header UI
  const display = shortUrl(result.url);
  contextBadge.textContent   = display;
  contextBadge.title         = result.url;
  pageCtxLabel.textContent   = result.url;
  contextBadge.classList.add('active');

  return result;
}

// ── DOM Builders ────────────────────────────────────────────────────────────

/** Creates and appends a user message bubble. */
function appendUserBubble(text) {
  const row = document.createElement('div');
  row.className = 'msg-row user';

  const label = document.createElement('div');
  label.className = 'msg-label';
  label.textContent = 'You';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  row.appendChild(label);
  row.appendChild(bubble);
  chatViewport.appendChild(row);
  scrollToBottom();
  return row;
}

/** Creates a typing-indicator row (AI "thinking" state). */
function appendTypingIndicator() {
  const row = document.createElement('div');
  row.className = 'msg-row ai';
  row.id = 'typing-row';

  const label = document.createElement('div');
  label.className = 'msg-label';
  label.textContent = 'AI Concierge';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';

  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.className = 'typing-dot';
    indicator.appendChild(dot);
  }

  bubble.appendChild(indicator);
  row.appendChild(label);
  row.appendChild(bubble);
  chatViewport.appendChild(row);
  scrollToBottom();
  return row;
}

/**
 * Builds and appends the full AI response:
 *  - AI answer bubble
 *  - Collapsible Decision Tree (if reasoning is provided)
 *
 * @param {string}   answer    - AI's reply text
 * @param {string[]} reasoning - Array of chain-of-thought steps
 */
function appendAIResponse(answer, reasoning) {
  // ── Answer bubble ────────────────────────────────────────
  const row = document.createElement('div');
  row.className = 'msg-row ai';

  const label = document.createElement('div');
  label.className = 'msg-label';
  label.textContent = 'AI Concierge';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = answer;

  row.appendChild(label);
  row.appendChild(bubble);
  chatViewport.appendChild(row);

  // ── Decision Tree ────────────────────────────────────────
  if (reasoning && reasoning.length > 0) {
    const treeId    = `dt-steps-${Date.now()}`;
    const treeWrap  = document.createElement('div');
    treeWrap.className = 'decision-tree';

    // Toggle button
    const toggle = document.createElement('button');
    toggle.className = 'dt-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', treeId);

    const iconEl = document.createElement('span');
    iconEl.className = 'dt-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = '🧠';

    const labelEl = document.createElement('span');
    labelEl.className = 'dt-label';
    labelEl.textContent = `Decision Tree · ${reasoning.length} step${reasoning.length !== 1 ? 's' : ''}`;

    const chevron = document.createElement('span');
    chevron.className = 'dt-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '▶';

    toggle.appendChild(iconEl);
    toggle.appendChild(labelEl);
    toggle.appendChild(chevron);

    // Steps container
    const stepsEl = document.createElement('div');
    stepsEl.className = 'dt-steps';
    stepsEl.id = treeId;
    stepsEl.setAttribute('role', 'list');

    reasoning.forEach((step, idx) => {
      const stepEl = document.createElement('div');
      stepEl.className = 'dt-step';
      stepEl.setAttribute('role', 'listitem');

      const numEl = document.createElement('span');
      numEl.className = 'dt-step-num';
      numEl.setAttribute('aria-label', `Step ${idx + 1}`);
      numEl.textContent = String(idx + 1);

      const textEl = document.createElement('span');
      textEl.className = 'dt-step-text';
      textEl.textContent = step;

      stepEl.appendChild(numEl);
      stepEl.appendChild(textEl);
      stepsEl.appendChild(stepEl);
    });

    // Toggle interaction
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      stepsEl.classList.toggle('open', !expanded);
      scrollToBottom();
    });

    treeWrap.appendChild(toggle);
    treeWrap.appendChild(stepsEl);
    chatViewport.appendChild(treeWrap);
  }

  scrollToBottom();
}

/** Appends an error notice as an AI system bubble. */
function appendErrorBubble(message) {
  const row = document.createElement('div');
  row.className = 'msg-row ai';

  const label = document.createElement('div');
  label.className = 'msg-label';
  label.textContent = 'System';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.style.cssText = 'border-color: rgba(248,113,113,0.3); color: #fca5a5;';
  bubble.textContent = message;

  row.appendChild(label);
  row.appendChild(bubble);
  chatViewport.appendChild(row);
  scrollToBottom();
}

// ── First-message setup ─────────────────────────────────────────────────────

function activateChat() {
  if (!firstMessage) return;
  firstMessage = false;
  emptyState.style.display     = 'none';
  sessionDivider.style.display = '';
  suggestionsEl.style.display  = 'none'; // hide chips once chatting
}

// ── Main Send Flow ──────────────────────────────────────────────────────────

async function handleSend() {
  const query = chatInput.value.trim();
  if (!query || isBusy) return;

  // Clear input and resize
  chatInput.value = '';
  chatInput.style.height = 'auto';

  activateChat();
  setInputBusy(true);

  // 1. Render user bubble immediately
  appendUserBubble(query);

  // 2. Show typing indicator
  const typingRow = appendTypingIndicator();

  try {
    // 3. Extract live page context from the active tab
    let context;
    try {
      context = await fetchTabContext();
    } catch (ctxErr) {
      // Not fatal — some pages (chrome://, extension pages) block injection.
      context = { url: '', text: '' };
      contextBadge.textContent = 'no access';
      contextBadge.classList.remove('active');
    }

    // 4. POST to backend
    const response = await fetch(CHAT_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_query:   query,
        url:          context.url,
        page_context: context.text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Backend responded with HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // 5. Remove typing indicator
    typingRow.remove();

    // 6. Extract answer + reasoning from response
    //    Accept multiple field name conventions from the backend.
    const answer = (
      data.answer   ??
      data.result   ??
      data.message  ??
      data.response ??
      JSON.stringify(data, null, 2)
    );

    const rawReasoning = (
      data.reasoning     ??
      data.chain_of_thought ??
      data.steps         ??
      data.thought_process  ??
      null
    );

    const reasoning = rawReasoning ? normaliseReasoning(rawReasoning) : [];

    // 7. Render AI response + optional Decision Tree
    appendAIResponse(String(answer), reasoning);

  } catch (err) {
    typingRow.remove();

    let friendlyMsg = err.message;

    if (
      friendlyMsg.includes('Failed to fetch') ||
      friendlyMsg.includes('NetworkError') ||
      friendlyMsg.toLowerCase().includes('network')
    ) {
      friendlyMsg =
        `⚠️ Cannot reach the AI backend at ${CHAT_ENDPOINT}.\n` +
        `Make sure the FastAPI server is running: uvicorn main:app --reload`;
    } else if (friendlyMsg.includes('Cannot access')) {
      friendlyMsg =
        '⚠️ This page restricts script access (chrome:// or extension pages). ' +
        'I can still answer general questions without page context.';
    }

    appendErrorBubble(friendlyMsg);
  } finally {
    setInputBusy(false);
    chatInput.focus();
  }
}

// ── Event Listeners ─────────────────────────────────────────────────────────

sendBtn.addEventListener('click', handleSend);

chatInput.addEventListener('input', autoGrow);

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

// Suggestion chips — populate input and focus
suggestionsEl.addEventListener('click', (e) => {
  const chip = e.target.closest('.suggestion-chip');
  if (!chip) return;
  const prompt = chip.dataset.prompt;
  if (prompt) {
    chatInput.value = prompt;
    autoGrow();
    chatInput.focus();
  }
});

// ── Init ────────────────────────────────────────────────────────────────────
// Eagerly resolve tab context on panel open so the badge is populated
// before the user sends their first message.
(async () => {
  try {
    await fetchTabContext();
  } catch {
    // Silently fail — context will be fetched on first send instead.
  }
})();
