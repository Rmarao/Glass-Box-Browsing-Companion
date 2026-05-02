'use strict';

let apiBase = localStorage.getItem('aiConciergeApiBase') || 'http://localhost:8000';

const chatViewport = document.getElementById('chat-viewport');
const roomView = document.getElementById('room-view');
const inputDock = document.getElementById('input-dock');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const emptyState = document.getElementById('empty-state');
const sessionDivider = document.getElementById('session-divider');
const contextBadge = document.getElementById('context-badge');
const pageCtxLabel = document.getElementById('page-context-label');
const suggestionsEl = document.getElementById('suggestions-strip');
const researchTabsBtn = document.getElementById('research-tabs-btn');
const researchStatus = document.getElementById('research-status');
const chatTab = document.getElementById('chat-tab');
const roomTab = document.getElementById('room-tab');
const memberNameInput = document.getElementById('member-name');
const roomIdInput = document.getElementById('room-id');
const serverUrlInput = document.getElementById('server-url');
const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const refreshRoomBtn = document.getElementById('refresh-room-btn');
const roomStatus = document.getElementById('room-status');
const roomSummary = document.getElementById('room-summary');
const roomFeed = document.getElementById('room-feed');

let isBusy = false;
let firstMessage = true;
let lastTabContext = null;
let lastExchange = null;
let currentRoom = null;
let roomPoller = null;
let researchAllTabs = false;

function chatEndpoint() {
  return `${apiBase}/chat`;
}

function researchEndpoint() {
  return `${apiBase}/research-tabs`;
}

function roomEndpoint(path = '') {
  return `${apiBase}/rooms${path}`;
}

function saveServerUrl() {
  apiBase = (serverUrlInput.value.trim() || 'http://localhost:8000').replace(/\/+$/, '');
  serverUrlInput.value = apiBase;
  localStorage.setItem('aiConciergeApiBase', apiBase);
}

function loadSavedRoom() {
  const saved = localStorage.getItem('aiConciergeRoom');
  if (!saved) return;
  try {
    currentRoom = JSON.parse(saved);
    memberNameInput.value = currentRoom.member_name || '';
    roomIdInput.value = currentRoom.room_id || '';
    updateRoomStatus();
    refreshRoom();
  } catch {
    localStorage.removeItem('aiConciergeRoom');
  }
}

function saveRoom(room) {
  currentRoom = room;
  memberNameInput.value = room.member_name || '';
  roomIdInput.value = room.room_id || '';
  localStorage.setItem('aiConciergeRoom', JSON.stringify(room));
  updateRoomStatus();
}

function updateRoomStatus(message) {
  if (message) {
    roomStatus.textContent = message;
    return;
  }
  if (!currentRoom) {
    roomStatus.textContent = 'Not joined';
    return;
  }
  roomStatus.textContent = `${currentRoom.member_name} in ${currentRoom.room_id}`;
}

function switchMode(mode) {
  const isRoom = mode === 'room';
  chatTab.classList.toggle('active', !isRoom);
  roomTab.classList.toggle('active', isRoom);
  chatViewport.classList.toggle('active', !isRoom);
  roomView.classList.toggle('active', isRoom);
  inputDock.style.display = isRoom ? 'none' : '';
  if (isRoom) {
    refreshRoom();
    startRoomPolling();
  } else {
    stopRoomPolling();
  }
}

function startRoomPolling() {
  stopRoomPolling();
  if (!currentRoom) return;
  roomPoller = setInterval(refreshRoom, 7000);
}

function stopRoomPolling() {
  if (roomPoller) {
    clearInterval(roomPoller);
    roomPoller = null;
  }
}

function scrollToBottom(smooth = true) {
  chatViewport.scrollTo({
    top: chatViewport.scrollHeight,
    behavior: smooth ? 'smooth' : 'instant',
  });
}

function setInputBusy(busy) {
  isBusy = busy;
  sendBtn.disabled = busy;
  chatInput.disabled = busy;
}

function autoGrow() {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname.length > 1 ? u.pathname.slice(0, 20) : '');
  } catch {
    return String(url || '').slice(0, 30);
  }
}

function normaliseReasoning(raw) {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split(/\n+|\.\s{2,}/)
      .map(s => s.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean);
  }
  return [];
}

function extractAnswerFieldFromText(value) {
  const text = String(value || '').trim();
  const answerKey = text.match(/"answer"\s*:\s*"/);
  if (!answerKey) return '';

  let result = '';
  let escaped = false;
  for (let index = answerKey.index + answerKey[0].length; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      if (char === 'n') result += '\n';
      else if (char === 't') result += '\t';
      else result += char;
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '"') {
      return result.trim();
    } else {
      result += char;
    }
  }
  return result.trim();
}

function normaliseAnswerPayload(data) {
  if (typeof data === 'string') {
    const trimmed = data.trim();
    try {
      return normaliseAnswerPayload(JSON.parse(trimmed));
    } catch {
      const extractedAnswer = extractAnswerFieldFromText(trimmed);
      if (extractedAnswer) return extractedAnswer;
      return trimmed;
    }
  }

  if (!data || typeof data !== 'object') {
    return String(data ?? '');
  }

  const answer = data.answer ?? data.result ?? data.message ?? data.response;
  if (typeof answer === 'string') {
    const trimmed = answer.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        return normaliseAnswerPayload(JSON.parse(trimmed));
      } catch {
        const extractedAnswer = extractAnswerFieldFromText(trimmed);
        if (extractedAnswer) return extractedAnswer;
        return trimmed;
      }
    }
    return trimmed;
  }

  if (answer != null) {
    return String(answer);
  }

  return 'I received a response, but it did not include an answer.';
}

function extractTabContext() {
  const normalise = value => String(value || '').replace(/\s+/g, ' ').trim();
  const blockedSelectors = 'script, style, noscript, svg, canvas, iframe, nav, footer, aside, [aria-hidden="true"]';
  const clone = document.body ? document.body.cloneNode(true) : null;

  if (clone) {
    clone.querySelectorAll(blockedSelectors).forEach(el => el.remove());
  }

  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, [role="heading"]'))
    .map(el => normalise(el.innerText || el.textContent || ''))
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .slice(0, 80);

  const main = clone
    ? (clone.querySelector('main, article, [role="main"]') || clone)
    : null;
  const text = normalise(main ? (main.innerText || main.textContent || '') : '');

  return {
    url: window.location.href,
    title: document.title || window.location.href,
    headings,
    text: text.slice(0, 12000),
  };
}

function scrollPageToTopic(topic) {
  const normalise = value => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const target = normalise(topic);
  if (!target) return { found: false, reason: 'No topic was provided.' };
  const targetWords = target
    .split(' ')
    .map(word => word.replace(/[^\w-]/g, ''))
    .filter(word => word.length > 2);

  const isVisible = (el) => {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };

  const selector = [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    '[role="heading"]',
    'main', 'section', 'article',
    'p', 'li', 'dt', 'dd',
    'caption', 'figcaption',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    '[id]', '[name]', '[aria-label]', '[data-mw-section-id]',
  ].join(',');

  const candidates = Array.from(document.querySelectorAll(selector))
    .filter(isVisible)
    .map((el, index) => {
      const visibleText = normalise(el.innerText || el.textContent || '');
      const labelledText = normalise([
        el.id,
        el.getAttribute('name'),
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
      ].filter(Boolean).join(' '));
      const combinedText = `${visibleText} ${labelledText}`.trim();
      if (!combinedText) return null;

      const isHeading = /^H[1-6]$/.test(el.tagName) || el.getAttribute('role') === 'heading';
      const isTableSignal = ['CAPTION', 'TH', 'TD', 'TR', 'TABLE'].includes(el.tagName);
      const searchableText = combinedText.length > 3000 ? combinedText.slice(0, 3000) : combinedText;
      let score = 0;
      if (searchableText === target) score = 140;
      else if (searchableText.startsWith(target)) score = 115;
      else if (searchableText.includes(target)) score = 95;
      else {
        const matchedWords = targetWords.filter(word => searchableText.includes(word)).length;
        if (targetWords.length > 1 && matchedWords === targetWords.length) score = 70;
        else if (targetWords.length > 2 && matchedWords >= Math.ceil(targetWords.length * 0.7)) score = 45;
      }

      if (!score) return null;
      if (isHeading) score += 45;
      if (isTableSignal) score += 14;
      if (labelledText.includes(target)) score += 20;
      score -= Math.min(Math.floor(searchableText.length / 300), 14);
      score -= Math.min(index / 1000, 8);
      return { el, score, text: visibleText || labelledText };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  const match = candidates[0];
  if (!match) {
    return { found: false, reason: `I could not find "${topic}" on this page.` };
  }

  const highlightEl = match.el.closest('h1, h2, h3, h4, h5, h6, tr, table, section, article, p, li') || match.el;
  highlightEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

  const previousOutline = highlightEl.style.outline;
  const previousBoxShadow = highlightEl.style.boxShadow;
  const previousBackground = highlightEl.style.backgroundColor;
  const previousTransition = highlightEl.style.transition;
  const previousScrollMargin = highlightEl.style.scrollMarginTop;
  highlightEl.style.scrollMarginTop = '96px';
  highlightEl.style.transition = 'outline 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease';
  highlightEl.style.outline = '3px solid #34d399';
  highlightEl.style.boxShadow = '0 0 0 8px rgba(52, 211, 153, 0.18)';
  highlightEl.style.backgroundColor = 'rgba(52, 211, 153, 0.10)';

  window.setTimeout(() => {
    highlightEl.style.outline = previousOutline;
    highlightEl.style.boxShadow = previousBoxShadow;
    highlightEl.style.backgroundColor = previousBackground;
    highlightEl.style.transition = previousTransition;
    highlightEl.style.scrollMarginTop = previousScrollMargin;
  }, 3600);

  return {
    found: true,
    topic,
    snippet: match.text.slice(0, 220),
    url: window.location.href,
  };
}

function scrollPageByPosition(position) {
  const normalized = String(position || '').toLowerCase();
  if (normalized === 'top') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (normalized === 'bottom') {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  } else {
    const direction = normalized === 'up' ? -1 : 1;
    window.scrollBy({ top: window.innerHeight * 0.75 * direction, behavior: 'smooth' });
  }

  return {
    found: true,
    position: normalized || 'down',
    url: window.location.href,
  };
}

function highlightSelectedContent() {
  const selection = window.getSelection();
  const selectedText = String(selection || '').replace(/\s+/g, ' ').trim();

  if (!selection || selection.rangeCount === 0 || !selectedText) {
    return {
      found: false,
      reason: 'Select text on the page first, then ask me to highlight selected content.',
      url: window.location.href,
    };
  }

  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  const highlightEl = container?.closest?.('h1, h2, h3, h4, h5, h6, tr, table, section, article, p, li, div')
    || container;

  if (!highlightEl) {
    return {
      found: false,
      reason: 'I could not locate the selected text on the page.',
      url: window.location.href,
    };
  }

  if (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function') {
    const styleId = 'ai-concierge-highlight-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = '::highlight(ai-concierge-selected) { background: rgba(251, 191, 36, 0.55); color: inherit; }';
      document.head.appendChild(style);
    }

    CSS.highlights.delete('ai-concierge-selected');
    CSS.highlights.set('ai-concierge-selected', new Highlight(range.cloneRange()));
    highlightEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

    window.setTimeout(() => {
      CSS.highlights.delete('ai-concierge-selected');
    }, 9000);

    return {
      found: true,
      selectedText: selectedText.slice(0, 220),
      url: window.location.href,
    };
  }

  highlightEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

  const previousOutline = highlightEl.style.outline;
  const previousBoxShadow = highlightEl.style.boxShadow;
  const previousBackground = highlightEl.style.backgroundColor;
  const previousTransition = highlightEl.style.transition;
  const previousScrollMargin = highlightEl.style.scrollMarginTop;
  highlightEl.style.scrollMarginTop = '96px';
  highlightEl.style.transition = 'outline 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease';
  highlightEl.style.outline = '3px solid #fbbf24';
  highlightEl.style.boxShadow = '0 0 0 8px rgba(251, 191, 36, 0.20)';
  highlightEl.style.backgroundColor = 'rgba(251, 191, 36, 0.16)';

  window.setTimeout(() => {
    highlightEl.style.outline = previousOutline;
    highlightEl.style.boxShadow = previousBoxShadow;
    highlightEl.style.backgroundColor = previousBackground;
    highlightEl.style.transition = previousTransition;
    highlightEl.style.scrollMarginTop = previousScrollMargin;
  }, 4200);

  return {
    found: true,
    selectedText: selectedText.slice(0, 220),
    url: window.location.href,
  };
}

function extractScrollCommand(query) {
  const stripFiller = value => value
    .replace(/\b(?:this|that|the)\s+(?:content|section|topic|part|heading)\b/ig, '')
    .replace(/\b(?:content|section|topic|part|heading)\b/ig, '')
    .replace(/\b(?:please|kindly)\b/ig, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'`:-]+|[\s"'`:-]+$/g, '')
    .trim();

  const cleaned = query
    .trim()
    .replace(/[?.!]+$/, '')
    .replace(/^(?:can|could|will|would)\s+you\s+/i, '')
    .replace(/^(?:please\s+)?(?:can|could|will|would)\s+you\s+/i, '')
    .trim();

  const lower = cleaned.toLowerCase();
  if (
    /\b(highlight|locate|show|scroll(?:\s+to)?)\b/.test(lower) &&
    /\b(selected|selection|highlighted)\s+(?:text|content|part|section)?\b/.test(lower)
  ) {
    return { kind: 'selection' };
  }

  const hasNavigationIntent =
    /\b(scroll|jump|navigate|move|highlight|locate)\b/.test(lower) ||
    /\bgo\s+(?:to|near|into|towards?)\b/.test(lower) ||
    /\b(?:take me|bring me|open)\s+(?:to|near|into)\b/.test(lower) ||
    /\b(?:find|show me)\s+(?:the\s+)?(?:section|topic|part|heading)\b/.test(lower);

  const topicBeforeIntentPatterns = [
    /^(.+?)\s+(?:please\s+)?(?:can|could|will|would)?\s*(?:you\s+)?(?:scroll|jump|go|navigate|move|highlight|locate|take me|bring me|open)\s+(?:down\s+|up\s+)?(?:to|into|near|towards?)?\s*(?:this|that|the)?\s*(?:content|section|topic|part|heading)?$/i,
    /^(.+?)\s+(?:please\s+)?(?:scroll|jump|go|navigate|move|highlight|locate)\s*(?:me)?\s*(?:there|here)?$/i,
  ];

  for (const pattern of topicBeforeIntentPatterns) {
    const match = cleaned.match(pattern);
    if (match && match[1]) {
      const topic = stripFiller(match[1]);
      if (topic) return { kind: 'topic', topic };
    }
  }

  if (/^(?:please\s+)?(?:scroll|move)\s+down$/i.test(cleaned)) {
    return { kind: 'position', position: 'down' };
  }
  if (/^(?:please\s+)?(?:scroll|move)\s+up$/i.test(cleaned)) {
    return { kind: 'position', position: 'up' };
  }
  if (/^(?:please\s+)?(?:scroll|go|jump|move)\s+(?:to\s+)?(?:the\s+)?top$/i.test(cleaned)) {
    return { kind: 'position', position: 'top' };
  }
  if (/^(?:please\s+)?(?:scroll|go|jump|move)\s+(?:to\s+)?(?:the\s+)?bottom$/i.test(cleaned)) {
    return { kind: 'position', position: 'bottom' };
  }

  const patterns = [
    /^(?:please\s+)?(?:scroll|jump|go|navigate|move|highlight|locate)\s+(?:down\s+|up\s+)?(?:to|into|near|towards?)?\s+(?:the\s+)?(?:section|topic|part|heading|content)?\s*(?:about|on|for)?\s*(.+)$/i,
    /^(?:please\s+)?(?:take me|bring me|open)\s+(?:to|near|into)\s+(?:the\s+)?(?:section|topic|part|heading)?\s*(?:about|on|for)?\s*(.+)$/i,
    /^(?:please\s+)?(?:find|show me)\s+(?:the\s+)?(?:section|topic)\s+(?:about|on|for)?\s*(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match && match[1]) {
      const topic = match[1]
        .replace(/^(?:the\s+)?(?:section|topic|part|heading)\s+(?:about|on|for)?\s*/i, '')
        .trim();
      return topic ? { kind: 'topic', topic } : { kind: 'intent' };
    }
  }

  return hasNavigationIntent ? { kind: 'intent' } : null;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active browser tab found.');
  return tab;
}

async function fetchTabContext() {
  const tab = await getActiveTab();
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractTabContext,
  });

  lastTabContext = result;
  const display = shortUrl(result.url);
  contextBadge.textContent = display;
  contextBadge.title = result.url;
  pageCtxLabel.textContent = result.url;
  contextBadge.classList.add('active');
  return result;
}

async function scrollActiveTabToTopic(topic) {
  const tab = await getActiveTab();
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: scrollPageToTopic,
    args: [topic],
  });
  return result;
}

async function scrollActiveTabByPosition(position) {
  const tab = await getActiveTab();
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: scrollPageByPosition,
    args: [position],
  });
  return result;
}

async function highlightActiveTabSelection() {
  const tab = await getActiveTab();
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: highlightSelectedContent,
  });
  return result;
}

function updateResearchMode() {
  researchTabsBtn.classList.toggle('active', researchAllTabs);
  researchTabsBtn.setAttribute('aria-pressed', String(researchAllTabs));
  researchStatus.textContent = researchAllTabs ? 'All readable tabs in this window' : 'Current tab';
  chatInput.placeholder = researchAllTabs
    ? 'Ask across all open tabs...'
    : 'Ask anything about this page...';
}

async function fetchAllTabsContext() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const readableTabs = tabs
    .filter(tab => tab.id && /^https?:\/\//i.test(tab.url || ''))
    .slice(0, 8);

  if (readableTabs.length === 0) {
    throw new Error('No readable web tabs found in this window.');
  }

  const contexts = [];
  for (const tab of readableTabs) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractTabContext,
      });
      contexts.push({
        title: result.title || tab.title || result.url || 'Untitled tab',
        url: result.url || tab.url || '',
        text: result.text || '',
      });
    } catch {
      contexts.push({
        title: tab.title || tab.url || 'Unreadable tab',
        url: tab.url || '',
        text: '',
      });
    }
  }

  const readableCount = contexts.filter(ctx => ctx.text.trim()).length;
  contextBadge.textContent = `${contexts.length} tabs`;
  contextBadge.title = contexts.map(ctx => ctx.url).filter(Boolean).join('\n');
  pageCtxLabel.textContent = `Researching ${contexts.length} tabs (${readableCount} readable)`;
  contextBadge.classList.toggle('active', readableCount > 0);
  researchStatus.textContent = `${contexts.length} tabs captured`;
  return contexts;
}

function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function appendUserBubble(text) {
  const row = makeEl('div', 'msg-row user');
  row.appendChild(makeEl('div', 'msg-label', 'You'));
  row.appendChild(makeEl('div', 'bubble', text));
  chatViewport.appendChild(row);
  scrollToBottom();
}

function appendTypingIndicator() {
  const row = makeEl('div', 'msg-row ai');
  row.id = 'typing-row';
  row.appendChild(makeEl('div', 'msg-label', 'AI Concierge'));

  const bubble = makeEl('div', 'bubble');
  const indicator = makeEl('div', 'typing-indicator');
  for (let i = 0; i < 3; i += 1) {
    indicator.appendChild(makeEl('span', 'typing-dot'));
  }
  bubble.appendChild(indicator);
  row.appendChild(bubble);
  chatViewport.appendChild(row);
  scrollToBottom();
  return row;
}

function appendAIResponse(answer, reasoning, exchange, sources = []) {
  const row = makeEl('div', 'msg-row ai');
  row.appendChild(makeEl('div', 'msg-label', 'AI Concierge'));

  const bubble = makeEl('div', 'bubble');
  bubble.textContent = answer;
  const sourceLinks = sources
    .map(source => String(source || '').trim())
    .filter(source => /^https?:\/\//i.test(source));

  if (sourceLinks.length > 0) {
    const sourcesWrap = makeEl('div', 'source-links');
    sourcesWrap.appendChild(makeEl('div', 'source-links-title', 'Sources'));
    sourceLinks.slice(0, 8).forEach((source, idx) => {
      const link = makeEl('a', 'source-link', `${idx + 1}. ${shortUrl(source)}`);
      link.href = source;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.title = source;
      sourcesWrap.appendChild(link);
    });
    bubble.appendChild(sourcesWrap);
  }

  row.appendChild(bubble);
  chatViewport.appendChild(row);

  const actionRow = makeEl('div', 'ai-actions');
  const shareBtn = makeEl('button', 'share-room-btn', currentRoom ? 'Share to Room' : 'Join Room to Share');
  shareBtn.disabled = !currentRoom;
  shareBtn.addEventListener('click', () => shareLastExchange(exchange, shareBtn));
  actionRow.appendChild(shareBtn);
  chatViewport.appendChild(actionRow);

  if (reasoning && reasoning.length > 0) {
    const treeId = `dt-steps-${Date.now()}`;
    const treeWrap = makeEl('div', 'decision-tree');
    const toggle = makeEl('button', 'dt-toggle');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', treeId);
    toggle.appendChild(makeEl('span', 'dt-icon', 'i'));
    toggle.appendChild(makeEl('span', 'dt-label', `Evidence Steps - ${reasoning.length}`));
    toggle.appendChild(makeEl('span', 'dt-chevron', '>'));

    const stepsEl = makeEl('div', 'dt-steps');
    stepsEl.id = treeId;
    stepsEl.setAttribute('role', 'list');

    reasoning.forEach((step, idx) => {
      const stepEl = makeEl('div', 'dt-step');
      stepEl.setAttribute('role', 'listitem');
      stepEl.appendChild(makeEl('span', 'dt-step-num', String(idx + 1)));
      stepEl.appendChild(makeEl('span', 'dt-step-text', step));
      stepsEl.appendChild(stepEl);
    });

    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      stepsEl.classList.toggle('open', !expanded);
      window.requestAnimationFrame(() => {
        if (!expanded) {
          treeWrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
          scrollToBottom();
        }
      });
    });

    treeWrap.appendChild(toggle);
    treeWrap.appendChild(stepsEl);
    chatViewport.appendChild(treeWrap);
  }

  scrollToBottom();
}

function appendErrorBubble(message) {
  const row = makeEl('div', 'msg-row ai');
  row.appendChild(makeEl('div', 'msg-label', 'System'));
  const bubble = makeEl('div', 'bubble');
  bubble.classList.add('error-bubble');
  bubble.textContent = message;
  row.appendChild(bubble);
  chatViewport.appendChild(row);
  scrollToBottom();
}

function activateChat() {
  if (!firstMessage) return;
  firstMessage = false;
  emptyState.style.display = 'none';
  sessionDivider.style.display = '';
  suggestionsEl.style.display = 'none';
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `HTTP ${response.status}`);
  }
  return data;
}

async function handleSend() {
  const query = chatInput.value.trim();
  if (!query || isBusy) return;

  chatInput.value = '';
  chatInput.style.height = 'auto';
  activateChat();
  setInputBusy(true);
  appendUserBubble(query);
  const typingRow = appendTypingIndicator();

  try {
    const scrollCommand = researchAllTabs ? null : extractScrollCommand(query);
    if (scrollCommand) {
      let result = null;
      let answer = '';
      let reasoning = [];

      if (scrollCommand.kind === 'position') {
        result = await scrollActiveTabByPosition(scrollCommand.position);
        answer = `Done. I scrolled ${scrollCommand.position}.`;
        reasoning = [
          'Detected this as a page scrolling command.',
          'Handled it locally in the active browser tab without calling Gemini.',
        ];
      } else if (scrollCommand.kind === 'selection') {
        result = await highlightActiveTabSelection();
        answer = result?.found
          ? `Highlighted the selected content: "${result.selectedText}"`
          : (result?.reason || 'Select text on the page first, then ask me to highlight it.');
        reasoning = result?.found
          ? [
              'Detected this as a selected-content highlight request.',
              'Read the current browser selection from the active tab.',
              'Scrolled to the selected content and applied a temporary highlight.',
            ]
          : [
              'Detected this as a selected-content highlight request.',
              'Checked the active tab for selected text.',
              'No selected page text was available to highlight.',
            ];
      } else if (scrollCommand.kind === 'topic') {
        result = await scrollActiveTabToTopic(scrollCommand.topic);
        answer = result?.found
          ? `I found "${scrollCommand.topic}" on this page and scrolled to it.`
          : (result?.reason || `I could not find "${scrollCommand.topic}" on this page.`);
        reasoning = result?.found
          ? [
              'Detected this as a page navigation request.',
              'Searched visible headings, sections, labels, and text on the active tab.',
              'Scrolled to the best matching section and highlighted it briefly.',
            ]
          : [
              'Detected this as a page navigation request.',
              'Searched the active tab for matching visible page text.',
              'No strong visible match was found.',
            ];
      } else {
        answer = 'I can scroll locally. Tell me the topic or direction, for example: "scroll to awards", "scroll down", or "go to the top".';
        reasoning = [
          'Detected this as a page navigation request.',
          'Did not call Gemini because browser scrolling is handled locally.',
          'The request needs a topic or direction to execute.',
        ];
      }

      typingRow.remove();

      lastExchange = {
        user_query: query,
        ai_answer: answer,
        url: result?.url || lastTabContext?.url || '',
      };

      appendAIResponse(answer, reasoning, lastExchange, result?.url ? [result.url] : []);
      return;
    }

    let response;
    let exchangeUrl = '';

    if (researchAllTabs) {
      const tabContexts = await fetchAllTabsContext();
      exchangeUrl = tabContexts.map(ctx => ctx.url).filter(Boolean).join(', ');
      response = await fetch(researchEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_query: query,
          tabs: tabContexts,
        }),
      });
    } else {
      let context;
      try {
        context = await fetchTabContext();
      } catch {
        context = { url: '', text: '' };
        contextBadge.textContent = 'no access';
        contextBadge.classList.remove('active');
      }
      exchangeUrl = context.url;
      response = await fetch(chatEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_query: query,
          url: context.url,
          page_context: context.text,
          page_headings: context.headings || [],
        }),
      });
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Backend responded with HTTP ${response.status}`);
    }

    const data = await response.json();
    typingRow.remove();

    const answer = normaliseAnswerPayload(data);
    const rawReasoning = data.reasoning ?? data.chain_of_thought ?? data.steps ?? data.thought_process ?? null;
    const reasoning = rawReasoning ? normaliseReasoning(rawReasoning) : [];
    const sources = Array.isArray(data.sources) ? data.sources : [];

    lastExchange = {
      user_query: query,
      ai_answer: String(answer),
      url: exchangeUrl,
    };
    appendAIResponse(String(answer), reasoning, lastExchange, sources);
  } catch (err) {
    typingRow.remove();
    let friendlyMsg = err.message;
    if (friendlyMsg.includes('Failed to fetch') || friendlyMsg.toLowerCase().includes('network')) {
      friendlyMsg = `Cannot reach the AI backend at ${chatEndpoint()}. Make sure FastAPI is running.`;
    }
    appendErrorBubble(friendlyMsg);
  } finally {
    setInputBusy(false);
    chatInput.focus();
  }
}

async function createRoom() {
  const memberName = memberNameInput.value.trim() || 'Guest';
  const roomId = roomIdInput.value.trim();
  updateRoomStatus('Creating room...');
  try {
    saveServerUrl();
    const room = await postJson(roomEndpoint(), {
      room_id: roomId || null,
      room_name: 'Team Room',
      member_name: memberName,
    });
    saveRoom(room);
    await refreshRoom();
  } catch (err) {
    updateRoomStatus(`Error: ${err.message}`);
  }
}

async function joinRoom() {
  const memberName = memberNameInput.value.trim() || 'Guest';
  const roomId = roomIdInput.value.trim();
  if (!roomId) {
    updateRoomStatus('Enter a Room ID to join');
    return;
  }
  updateRoomStatus('Joining room...');
  try {
    saveServerUrl();
    const room = await postJson(roomEndpoint(`/${encodeURIComponent(roomId)}/join`), {
      member_name: memberName,
    });
    saveRoom(room);
    await refreshRoom();
  } catch (err) {
    updateRoomStatus(`Error: ${err.message}`);
  }
}

async function shareLastExchange(exchange, button) {
  if (!currentRoom || !exchange) return;
  button.disabled = true;
  button.textContent = 'Sharing...';
  try {
    await postJson(roomEndpoint(`/${encodeURIComponent(currentRoom.room_id)}/events`), {
      member_name: currentRoom.member_name,
      user_query: exchange.user_query,
      ai_answer: exchange.ai_answer,
      url: exchange.url || '',
    });
    button.textContent = 'Shared';
    await refreshRoom();
  } catch (err) {
    button.textContent = `Error: ${err.message}`;
  }
}

async function refreshRoom() {
  if (!currentRoom) {
    renderSummary(null);
    renderFeed([]);
    updateRoomStatus();
    return;
  }
  try {
    const response = await fetch(
      `${roomEndpoint(`/${encodeURIComponent(currentRoom.room_id)}`)}?member_name=${encodeURIComponent(currentRoom.member_name)}`
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
    renderSummary(data.summary);
    renderFeed(data.events || []);
    updateRoomStatus();
  } catch (err) {
    updateRoomStatus(`Error: ${err.message}`);
  }
}

function renderSummary(summary) {
  roomSummary.replaceChildren();
  if (!summary || !summary.summary_points || summary.summary_points.length === 0) {
    roomSummary.className = 'room-summary empty-room-text';
    roomSummary.textContent = currentRoom ? 'No shared summary yet. Share an AI answer from Chat.' : 'Join a room to see team summary points.';
    return;
  }

  roomSummary.className = 'room-summary';
  addListBlock(roomSummary, 'Summary', summary.summary_points);
  addListBlock(roomSummary, 'Action Items', summary.action_items || []);
  addListBlock(roomSummary, 'Member Activity', summary.member_activity || []);
}

function addListBlock(parent, title, items) {
  if (!items || items.length === 0) return;
  const block = makeEl('div', 'room-list-block');
  block.appendChild(makeEl('div', 'room-list-title', title));
  const list = makeEl('ul', 'room-list');
  items.forEach(item => list.appendChild(makeEl('li', '', item)));
  block.appendChild(list);
  parent.appendChild(block);
}

function renderFeed(events) {
  roomFeed.replaceChildren();
  if (!events || events.length === 0) {
    roomFeed.className = 'room-feed empty-room-text';
    roomFeed.textContent = currentRoom ? 'No team activity yet.' : 'Shared AI discoveries will appear here.';
    return;
  }

  roomFeed.className = 'room-feed';
  events.slice().reverse().forEach(event => {
    const item = makeEl('article', 'room-event');
    const meta = makeEl('div', 'room-event-meta', `${event.member_name} shared`);
    const question = makeEl('div', 'room-event-question', event.user_query);
    const answer = makeEl('div', 'room-event-answer', event.ai_answer);
    item.appendChild(meta);
    item.appendChild(question);
    item.appendChild(answer);
    if (event.url) item.appendChild(makeEl('div', 'room-event-url', shortUrl(event.url)));
    roomFeed.appendChild(item);
  });
}

sendBtn.addEventListener('click', handleSend);
chatInput.addEventListener('input', autoGrow);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

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

chatTab.addEventListener('click', () => switchMode('chat'));
roomTab.addEventListener('click', () => switchMode('room'));
createRoomBtn.addEventListener('click', createRoom);
joinRoomBtn.addEventListener('click', joinRoom);
refreshRoomBtn.addEventListener('click', refreshRoom);
researchTabsBtn.addEventListener('click', () => {
  researchAllTabs = !researchAllTabs;
  updateResearchMode();
});
serverUrlInput.addEventListener('change', () => {
  saveServerUrl();
  refreshRoom();
});

(async () => {
  serverUrlInput.value = apiBase;
  updateResearchMode();
  loadSavedRoom();
  try {
    await fetchTabContext();
  } catch {
    contextBadge.textContent = 'idle';
  }
})();
