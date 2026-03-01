// ==UserScript==
// @name         Accessibility Content Reader
// @namespace    https://github.com/Cfomodz/accessibility-reader
// @version      0.2.0
// @description  Reads Open edX course content aloud and navigates unit sequences — Firefox accessibility tool via Tampermonkey
// @author       Cfomodz
// @match        https://*.wgu.edu/learning/course/*
// @match        https://*.wgu.edu/course/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIG — Customize these values
  // ═══════════════════════════════════════════════════════════════════════════

  const CONFIG = {
    // TTS Settings
    TTS_RATE: 1.0,                    // Speech rate (0.5 – 2.0)
    TTS_PITCH: 1.0,                   // Speech pitch (0 – 2.0)
    TTS_PREFERRED_VOICE: '',          // Preferred voice name (e.g., 'Microsoft David'), empty = system default
    TTS_CHUNK_MAX_LENGTH: 3000,       // Max characters per utterance chunk (avoids browser TTS bugs)

    // Navigation
    AUTO_READ_ON_NAVIGATE: true,      // Automatically begin reading after navigating to next page
    LOOP_AT_END: false,               // Loop back to first page when reaching the end

    // UI
    PANEL_POSITION: 'bottom-right',   // Control panel position: 'bottom-right', 'bottom-left', 'top-right', 'top-left'
    PANEL_VISIBLE_ON_START: true,     // Show control panel when script loads

    // Hotkeys (set to '' to disable)
    HOTKEY_NEXT: 'Alt+ArrowRight',
    HOTKEY_PREV: 'Alt+ArrowLeft',
    HOTKEY_PAUSE_RESUME: 'Alt+Space',
    HOTKEY_STOP: 'Alt+KeyS',
    HOTKEY_REREAD: 'Alt+KeyR',
    HOTKEY_TOGGLE_PANEL: 'Alt+KeyM',

    // Content extraction
    CONTENT_LOAD_TIMEOUT: 10000,      // Max ms to wait for content after navigation
    CONTENT_LOAD_POLL_INTERVAL: 200,  // ms between content-ready checks
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // SELECTORS — Open edX / WGU Learning MFE
  //
  // Architecture: The Learning MFE (parent page) embeds course content in an
  // iframe. The content page has class "chromeless" and uses postMessage to
  // communicate with the parent. Two execution contexts:
  //
  //   Parent (MFE):  Has course navigation (sequence bar, outline sidebar)
  //   Content iframe: Has the xblock content (what gets read aloud)
  //
  // The script runs on the parent MFE page and reaches into the content
  // iframe via contentDocument (same-origin).
  // ═══════════════════════════════════════════════════════════════════════════

  const SELECTORS = {
    // ── Content (inside iframe) ──────────────────────────────────────────
    // The content iframe that the MFE embeds
    contentIframe: 'iframe',

    // Main content container inside the iframe
    contentArea: 'main#main',

    // Individual content blocks (vertical units containing xblocks)
    contentBlock: '.vert-mod .vert',

    // The xblock wrapper holding actual course content
    xblock: '.xblock.xblock-student_view',

    // Elements within content area to strip before reading
    contentExclusions: [
      'script',                       // Template scripts and JS
      'iframe',                       // Embedded viewers (PPT, video, etc.)
      '.aria-tooltip',                // "Opens in new tab" tooltip spans
      'figure img',                   // Images (alt text kept via figcaption)
      '.image-modal-tpl',             // Image modal template
      'style',                        // Inline styles
    ],

    // ── Navigation (in parent MFE page) ──────────────────────────────────
    // The Open edX Learning MFE provides a flat sequence navigation bar:
    //   - Unit tabs: <a> tags with title attributes in .sequence-navigation-tabs
    //   - Previous/Next buttons: <a> tags flanking the tab strip
    //   - Active unit: tab with .active class
    // There is no hierarchical sidebar; cross-subsection navigation
    // is handled by the Previous/Next buttons automatically.
    //
    // Open edX hierarchy:  Course > Section > Subsection > Unit (page)
    // The sequence bar shows units within the current subsection.

    menuContainer: 'nav#courseware-sequence-navigation',
    menuCategory: '',                // Not used (flat sequence bar)
    menuSection: '',                 // Not used (flat sequence bar)
    menuPage: '.sequence-navigation-tabs a.btn',
    menuPageLink: '.sequence-navigation-tabs a.btn',
    menuActiveItem: '.sequence-navigation-tabs a.btn.active',

    // Sequence navigation (Previous/Next handle cross-subsection boundaries)
    sequenceNextBtn: 'a.next-btn',
    sequencePrevBtn: 'a.previous-btn',

    // ── Page chrome to always exclude ────────────────────────────────────
    header: 'header',
    footer: 'footer',
    sidebar: 'aside, [role="complementary"]',
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  const STATE = {
    menuItems: [],       // Flat ordered list: [{ category, section, page, url, element }]
    currentIndex: -1,    // Position in menuItems array
    isReading: false,    // TTS currently speaking
    isPaused: false,     // TTS paused by user
    lastUrl: '',         // For detecting navigation changes
    panelVisible: CONFIG.PANEL_VISIBLE_ON_START,
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // LOGGING
  // ═══════════════════════════════════════════════════════════════════════════

  function log(...args) {
    console.log('[A11y Reader]', ...args);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TTS ENGINE — Enhanced Web Speech API wrapper
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Split long text into chunks at sentence boundaries to avoid browser TTS
   * bugs that silently fail on very long utterances.
   */
  function chunkText(text, maxLength = CONFIG.TTS_CHUNK_MAX_LENGTH) {
    if (text.length <= maxLength) return [text];

    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Find last sentence boundary within maxLength
      let splitAt = -1;
      const searchRegion = remaining.substring(0, maxLength);

      // Prefer splitting at sentence endings
      const sentenceEnd = searchRegion.lastIndexOf('. ');
      if (sentenceEnd > maxLength * 0.3) {
        splitAt = sentenceEnd + 2;
      } else {
        // Fall back to last space
        const lastSpace = searchRegion.lastIndexOf(' ');
        splitAt = lastSpace > 0 ? lastSpace + 1 : maxLength;
      }

      chunks.push(remaining.substring(0, splitAt).trim());
      remaining = remaining.substring(splitAt).trim();
    }

    return chunks;
  }

  /**
   * Get the preferred voice object, or null for system default.
   */
  function getPreferredVoice(preferName = CONFIG.TTS_PREFERRED_VOICE) {
    if (!preferName) return null;
    const voices = speechSynthesis.getVoices();
    return voices.find(v => v.name === preferName) ||
           voices.find(v => v.name.includes(preferName)) ||
           null;
  }

  /**
   * Speak a single text chunk. Returns a Promise that resolves when done.
   */
  function speakChunk(text, voice = null) {
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = CONFIG.TTS_RATE;
      utterance.pitch = CONFIG.TTS_PITCH;
      if (voice) utterance.voice = voice;
      utterance.onend = () => resolve();
      utterance.onerror = (e) => reject(e);
      speechSynthesis.speak(utterance);
    });
  }

  /**
   * Speak full text content, chunked for reliability.
   * Respects pause/stop state.
   */
  async function speakContent(text) {
    if (!text || !text.trim()) {
      log('No content to speak');
      return;
    }

    STATE.isReading = true;
    STATE.isPaused = false;
    updatePanelState();

    const voice = getPreferredVoice();
    const chunks = chunkText(text);

    log(`Speaking ${chunks.length} chunk(s), ${text.length} chars total`);

    try {
      for (const chunk of chunks) {
        if (!STATE.isReading) break; // Stopped by user
        await speakChunk(chunk, voice);
      }
    } catch (err) {
      log('TTS error:', err);
    } finally {
      STATE.isReading = false;
      STATE.isPaused = false;
      updatePanelState();
    }
  }

  function pauseTTS() {
    if (STATE.isReading && !STATE.isPaused) {
      speechSynthesis.pause();
      STATE.isPaused = true;
      updatePanelState();
      log('TTS paused');
    }
  }

  function resumeTTS() {
    if (STATE.isReading && STATE.isPaused) {
      speechSynthesis.resume();
      STATE.isPaused = false;
      updatePanelState();
      log('TTS resumed');
    }
  }

  function stopTTS() {
    speechSynthesis.cancel();
    STATE.isReading = false;
    STATE.isPaused = false;
    updatePanelState();
    log('TTS stopped');
  }

  function togglePauseTTS() {
    if (STATE.isPaused) {
      resumeTTS();
    } else if (STATE.isReading) {
      pauseTTS();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTENT EXTRACTION
  //
  // Open edX architecture: the course content is rendered inside an iframe
  // with class "chromeless". The script runs on the parent MFE page and
  // reaches into the iframe's contentDocument for extraction.
  //
  // Content structure inside iframe:
  //   div.content-wrapper#content
  //     div.course-wrapper.chromeless
  //       section.course-content#course-content
  //         main#main
  //           div.xblock[data-block-type="vertical"]
  //             div.vert-mod
  //               div.vert.vert-0 > div.xblock (content block 1)
  //               div.vert.vert-1 > div.xblock (content block 2)
  //               ...
  //
  // Each xblock can be type: html, wgu_image_dams, video, problem, etc.
  // Content elements within xblocks: h3, p, ul/li, ol/li, figure, a
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the document to extract content from.
   * Tries the content iframe first (MFE architecture), falls back to
   * current document (direct page access / non-iframe mode).
   */
  function getContentDocument() {
    if (SELECTORS.contentIframe) {
      const iframe = document.querySelector(SELECTORS.contentIframe);
      if (iframe) {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iframeDoc) return iframeDoc;
        } catch (e) {
          log('Cannot access iframe (cross-origin?):', e.message);
        }
      }
    }
    // Fallback: content is in current document (direct access or non-MFE)
    return document;
  }

  /**
   * Extract readable text content from the main content area,
   * excluding scripts, iframes, tooltips, and other non-content elements.
   */
  function extractContent() {
    const doc = getContentDocument();

    if (!SELECTORS.contentArea) {
      log('SELECTORS.contentArea not configured');
      return '';
    }

    const contentEl = doc.querySelector(SELECTORS.contentArea);
    if (!contentEl) {
      log('Content area not found:', SELECTORS.contentArea);
      return '';
    }

    // Clone to avoid mutating the live DOM
    const clone = contentEl.cloneNode(true);

    // Remove exclusions
    const exclusions = [
      ...SELECTORS.contentExclusions,
      SELECTORS.header,
      SELECTORS.footer,
      SELECTORS.sidebar,
    ].filter(Boolean);

    for (const selector of exclusions) {
      clone.querySelectorAll(selector).forEach(el => el.remove());
    }

    // Extract text, preserving paragraph structure
    const paragraphs = [];
    const treeWalkerRoot = doc.defaultView
      ? doc.createTreeWalker(clone, NodeFilter.SHOW_TEXT, null)
      : document.createTreeWalker(clone, NodeFilter.SHOW_TEXT, null);

    let currentBlock = '';
    let lastParent = null;

    while (treeWalkerRoot.nextNode()) {
      const node = treeWalkerRoot.currentNode;
      const text = node.textContent.trim();
      if (!text) continue;

      // Detect block-level parent changes to insert paragraph breaks
      const blockParent = node.parentElement?.closest('p, div, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dt, dd, figcaption');
      if (blockParent !== lastParent && currentBlock) {
        paragraphs.push(currentBlock.trim());
        currentBlock = '';
      }
      lastParent = blockParent;
      currentBlock += (currentBlock ? ' ' : '') + text;
    }

    if (currentBlock.trim()) {
      paragraphs.push(currentBlock.trim());
    }

    return paragraphs.join('\n\n');
  }

  /**
   * Wait for the content area to appear in the DOM after navigation.
   * Watches both the parent document (for iframe load) and, if accessible,
   * the iframe's document (for content render).
   * Returns a Promise that resolves with the content text, or rejects on timeout.
   */
  function waitForContent() {
    return new Promise((resolve, reject) => {
      // Check immediately
      const immediate = extractContent();
      if (immediate) {
        resolve(immediate);
        return;
      }

      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error('Content load timeout'));
      }, CONFIG.CONTENT_LOAD_TIMEOUT);

      // Watch the parent document for iframe changes
      const observer = new MutationObserver(() => {
        const content = extractContent();
        if (content) {
          clearTimeout(timeout);
          observer.disconnect();
          resolve(content);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      // Also poll for iframe content (MutationObserver doesn't fire for
      // cross-document iframe loads)
      const poll = setInterval(() => {
        const content = extractContent();
        if (content) {
          clearInterval(poll);
          clearTimeout(timeout);
          observer.disconnect();
          resolve(content);
        }
      }, CONFIG.CONTENT_LOAD_POLL_INTERVAL);

      // Clean up poll on timeout
      const origTimeout = timeout;
      setTimeout(() => clearInterval(poll), CONFIG.CONTENT_LOAD_TIMEOUT);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MENU NAVIGATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Parse the sequence navigation bar into a flat ordered list of units.
   * Returns: [{ page, url, element }]
   *
   * The Open edX Learning MFE uses a flat sequence bar with unit tabs.
   * Each tab is an <a> with a title attribute naming the unit and an
   * SVG icon indicating the content type.
   */
  function parseMenu() {
    if (!SELECTORS.menuContainer) {
      log('SELECTORS.menuContainer not configured');
      return [];
    }

    const menuEl = document.querySelector(SELECTORS.menuContainer);
    if (!menuEl) {
      log('Menu container not found:', SELECTORS.menuContainer);
      return [];
    }

    const items = [];
    const tabs = menuEl.querySelectorAll(SELECTORS.menuPage || '.no-match');

    tabs.forEach(tab => {
      items.push({
        page: tab.getAttribute('title') || tab.textContent?.trim() || 'Unknown Unit',
        url: tab.href,
        element: tab,
      });
    });

    log(`Parsed ${items.length} sequence tab(s)`);
    return items;
  }

  /**
   * Determine current position in the menu based on the active tab
   * indicator or URL matching.
   */
  function detectCurrentPosition() {
    // Primary: match by the .active class on a sequence tab
    if (SELECTORS.menuActiveItem) {
      const activeEl = document.querySelector(SELECTORS.menuActiveItem);
      if (activeEl) {
        const activeUrl = activeEl.href || activeEl.closest('a')?.href;
        const idx = STATE.menuItems.findIndex(item => item.url === activeUrl);
        if (idx >= 0) {
          STATE.currentIndex = idx;
          return;
        }
      }
    }

    // Fallback: match by current URL
    const currentUrl = window.location.href;
    const index = STATE.menuItems.findIndex(item => item.url === currentUrl);
    if (index >= 0) {
      STATE.currentIndex = index;
      return;
    }

    log('Could not detect current position in menu');
    STATE.currentIndex = 0;
  }

  /**
   * Wait for the URL to change after triggering navigation.
   * Resolves once window.location.href differs from oldUrl.
   */
  function waitForUrlChange(oldUrl, timeout = 5000) {
    return new Promise((resolve, reject) => {
      if (window.location.href !== oldUrl) { resolve(); return; }
      const start = Date.now();
      const check = setInterval(() => {
        if (window.location.href !== oldUrl) {
          clearInterval(check);
          resolve();
        } else if (Date.now() - start > timeout) {
          clearInterval(check);
          reject(new Error('URL change timeout'));
        }
      }, 100);
    });
  }

  /**
   * Navigate to the next unit by clicking the native "Next" button.
   * The MFE's Next button handles both within-subsection and
   * cross-subsection navigation automatically.
   * Returns true if navigation occurred, false if at the end.
   */
  async function navigateNext() {
    const nextBtn = document.querySelector(SELECTORS.sequenceNextBtn);
    if (!nextBtn) {
      log('Next button not found');
      return false;
    }

    stopTTS();
    const oldUrl = window.location.href;
    log('Navigating to next unit');
    nextBtn.click();

    if (CONFIG.AUTO_READ_ON_NAVIGATE) {
      try {
        await waitForUrlChange(oldUrl);
        // Brief delay for iframe to begin reloading with new content
        await new Promise(r => setTimeout(r, 300));
        const content = await waitForContent();
        await speakContent(content);
      } catch (err) {
        log('Auto-read failed:', err.message);
      }
    }

    // Refresh menu state after MFE re-renders the sequence bar
    STATE.menuItems = parseMenu();
    detectCurrentPosition();
    updatePanelState();

    return true;
  }

  /**
   * Navigate to the previous unit by clicking the native "Previous" button.
   */
  async function navigatePrev() {
    const prevBtn = document.querySelector(SELECTORS.sequencePrevBtn);
    if (!prevBtn) {
      log('Previous button not found');
      return false;
    }

    stopTTS();
    const oldUrl = window.location.href;
    log('Navigating to previous unit');
    prevBtn.click();

    if (CONFIG.AUTO_READ_ON_NAVIGATE) {
      try {
        await waitForUrlChange(oldUrl);
        await new Promise(r => setTimeout(r, 300));
        const content = await waitForContent();
        await speakContent(content);
      } catch (err) {
        log('Auto-read failed:', err.message);
      }
    }

    STATE.menuItems = parseMenu();
    detectCurrentPosition();
    updatePanelState();

    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UI — Reader Control Panel
  // ═══════════════════════════════════════════════════════════════════════════

  let panelEl = null;

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .a11y-reader-panel {
        position: fixed;
        z-index: 999999;
        background: #1e1e2e;
        color: #cdd6f4;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        padding: 12px 16px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        min-width: 280px;
        user-select: none;
        transition: opacity 0.2s ease;
      }

      .a11y-reader-panel.bottom-right { bottom: 20px; right: 20px; }
      .a11y-reader-panel.bottom-left  { bottom: 20px; left: 20px; }
      .a11y-reader-panel.top-right    { top: 20px; right: 20px; }
      .a11y-reader-panel.top-left     { top: 20px; left: 20px; }

      .a11y-reader-panel.hidden {
        opacity: 0;
        pointer-events: none;
      }

      .a11y-reader-nav {
        display: flex;
        gap: 8px;
        margin-bottom: 8px;
      }

      .a11y-reader-btn {
        flex: 1;
        padding: 8px 12px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: transform 0.1s ease, opacity 0.15s ease;
        color: #cdd6f4;
      }

      .a11y-reader-btn:hover {
        transform: scale(1.03);
        opacity: 0.9;
      }

      .a11y-reader-btn:active {
        transform: scale(0.97);
      }

      .a11y-reader-btn-prev,
      .a11y-reader-btn-next {
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
      }

      .a11y-reader-btn-pause {
        background: #45475a;
      }

      .a11y-reader-btn-stop {
        background: #f38ba8;
        color: #1e1e2e;
      }

      .a11y-reader-btn-read {
        background: linear-gradient(135deg, #a6e3a1, #94e2d5);
        color: #1e1e2e;
      }

      .a11y-reader-progress {
        font-size: 11px;
        color: #a6adc8;
        text-align: center;
        margin-top: 4px;
        line-height: 1.4;
      }

      .a11y-reader-progress .breadcrumb {
        color: #cdd6f4;
        font-weight: 500;
      }

      .a11y-reader-actions {
        display: flex;
        gap: 8px;
        margin-top: 8px;
      }

      .a11y-reader-status {
        text-align: center;
        padding: 4px 0;
        font-size: 11px;
        font-weight: 600;
        color: #a6e3a1;
      }

      .a11y-reader-status.idle { color: #a6adc8; }
      .a11y-reader-status.reading { color: #a6e3a1; }
      .a11y-reader-status.paused { color: #f9e2af; }
    `;
    document.head.appendChild(style);
  }

  function createPanel() {
    panelEl = document.createElement('div');
    panelEl.className = `a11y-reader-panel ${CONFIG.PANEL_POSITION.replace('-', '-')}`;
    if (!STATE.panelVisible) panelEl.classList.add('hidden');

    panelEl.innerHTML = `
      <div class="a11y-reader-status idle" data-role="status">Ready</div>
      <div class="a11y-reader-nav">
        <button class="a11y-reader-btn a11y-reader-btn-prev" data-action="prev" title="${CONFIG.HOTKEY_PREV}">◀ Prev</button>
        <button class="a11y-reader-btn a11y-reader-btn-pause" data-action="pause" title="${CONFIG.HOTKEY_PAUSE_RESUME}">⏸ Pause</button>
        <button class="a11y-reader-btn a11y-reader-btn-next" data-action="next" title="${CONFIG.HOTKEY_NEXT}">Next ▶</button>
      </div>
      <div class="a11y-reader-progress" data-role="progress">
        <span class="breadcrumb" data-role="breadcrumb">No menu loaded</span>
      </div>
      <div class="a11y-reader-actions">
        <button class="a11y-reader-btn a11y-reader-btn-read" data-action="read" title="${CONFIG.HOTKEY_REREAD}">▶ Read Page</button>
        <button class="a11y-reader-btn a11y-reader-btn-stop" data-action="stop" title="${CONFIG.HOTKEY_STOP}">■ Stop</button>
      </div>
    `;

    // Button handlers
    panelEl.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;

      switch (action) {
        case 'next': navigateNext(); break;
        case 'prev': navigatePrev(); break;
        case 'pause': togglePauseTTS(); break;
        case 'stop': stopTTS(); break;
        case 'read': readCurrentPage(); break;
      }
    });

    document.body.appendChild(panelEl);
    log('Control panel injected');
  }

  /**
   * Update the panel to reflect current state (reading/paused/idle, position).
   */
  function updatePanelState() {
    if (!panelEl) return;

    const statusEl = panelEl.querySelector('[data-role="status"]');
    const pauseBtn = panelEl.querySelector('[data-action="pause"]');
    const breadcrumbEl = panelEl.querySelector('[data-role="breadcrumb"]');

    // Status text
    if (STATE.isPaused) {
      statusEl.textContent = 'Paused';
      statusEl.className = 'a11y-reader-status paused';
      pauseBtn.textContent = '▶ Resume';
    } else if (STATE.isReading) {
      statusEl.textContent = 'Reading...';
      statusEl.className = 'a11y-reader-status reading';
      pauseBtn.textContent = '⏸ Pause';
    } else {
      statusEl.textContent = 'Ready';
      statusEl.className = 'a11y-reader-status idle';
      pauseBtn.textContent = '⏸ Pause';
    }

    // Breadcrumb / progress — show unit title and position in sequence
    if (STATE.menuItems.length > 0 && STATE.currentIndex >= 0) {
      const item = STATE.menuItems[STATE.currentIndex];
      const position = `${STATE.currentIndex + 1} of ${STATE.menuItems.length}`;
      breadcrumbEl.innerHTML = `${item.page}<br>(${position})`;
    }
  }

  function togglePanel() {
    STATE.panelVisible = !STATE.panelVisible;
    if (panelEl) {
      panelEl.classList.toggle('hidden', !STATE.panelVisible);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // READ CURRENT PAGE
  // ═══════════════════════════════════════════════════════════════════════════

  async function readCurrentPage() {
    stopTTS();
    const content = extractContent();
    if (content) {
      await speakContent(content);
    } else {
      log('No content found on current page');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HOTKEY HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  function matchHotkey(e, hotkeyStr) {
    if (!hotkeyStr) return false;

    const parts = hotkeyStr.split('+');
    const key = parts[parts.length - 1];
    const needAlt = parts.includes('Alt');
    const needCtrl = parts.includes('Ctrl');
    const needShift = parts.includes('Shift');

    return e.code === key &&
           e.altKey === needAlt &&
           e.ctrlKey === needCtrl &&
           e.shiftKey === needShift;
  }

  function handleKeydown(e) {
    if (matchHotkey(e, CONFIG.HOTKEY_NEXT)) {
      e.preventDefault();
      navigateNext();
    } else if (matchHotkey(e, CONFIG.HOTKEY_PREV)) {
      e.preventDefault();
      navigatePrev();
    } else if (matchHotkey(e, CONFIG.HOTKEY_PAUSE_RESUME)) {
      e.preventDefault();
      togglePauseTTS();
    } else if (matchHotkey(e, CONFIG.HOTKEY_STOP)) {
      e.preventDefault();
      stopTTS();
    } else if (matchHotkey(e, CONFIG.HOTKEY_REREAD)) {
      e.preventDefault();
      readCurrentPage();
    } else if (matchHotkey(e, CONFIG.HOTKEY_TOGGLE_PANEL)) {
      e.preventDefault();
      togglePanel();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  function init() {
    log('Initializing Accessibility Content Reader v0.2.0');

    injectStyles();
    createPanel();

    // Parse menu on load
    STATE.menuItems = parseMenu();
    if (STATE.menuItems.length > 0) {
      detectCurrentPosition();
      updatePanelState();
    }

    // Hotkeys
    document.addEventListener('keydown', handleKeydown);

    // Watch for SPA navigation (URL changes without full page reload)
    STATE.lastUrl = window.location.href;
    const urlObserver = setInterval(() => {
      if (window.location.href !== STATE.lastUrl) {
        STATE.lastUrl = window.location.href;
        log('URL changed:', STATE.lastUrl);

        // Re-parse menu in case structure changed
        STATE.menuItems = parseMenu();
        detectCurrentPosition();
        updatePanelState();
      }
    }, 500);

    log('Initialization complete');
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
