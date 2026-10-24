/* Ada's AI Natural Language Translator — Start Speaking stays active until Translate. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const speakButton = byId('speakTabBtn');
  const textButton = byId('textModeBtn');
  const stopButton = byId('stopVoiceBtn');
  const textCard = byId('textModeCard');
  const voiceCard = byId('speakModeCard');
  const input = byId('inputText');
  const source = byId('sourceLanguage');
  const privacy = byId('voicePrivacy');
  const status = byId('status');
  const buttonLabel = byId('speakButtonLabel');
  if (!speakButton || !input) return;

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const locales = {
    en: 'en-US', zh: 'zh-CN', yue: 'zh-HK', de: 'de-DE', fr: 'fr-FR',
    es: 'es-ES', it: 'it-IT', pt: 'pt-PT', ja: 'ja-JP', ko: 'ko-KR',
    ar: 'ar-SA', hi: 'hi-IN', ru: 'ru-RU'
  };

  let recognition = null;
  let listeningRequested = false;
  let locked = false;
  let baseText = '';
  let committedSpeech = '';
  let finalPart = '';
  let interimPart = '';
  let restartTimer = null;
  let sessionNumber = 0;
  let finishing = false;
  let finishResolve = null;

  function message(text, kind = 'idle') {
    if (status) { status.textContent = text; status.dataset.state = kind; }
  }
  function updateButton() {
    speakButton.disabled = locked || listeningRequested || finishing;
    if (stopButton) stopButton.disabled = !listeningRequested || finishing || locked;
    speakButton.setAttribute('aria-pressed', String(listeningRequested));
    speakButton.setAttribute('aria-label', 'Start Speaking');
    speakButton.title = listeningRequested ? 'Listening until Translate is clicked' : 'Start voice-to-text recognition';
    if (buttonLabel) buttonLabel.textContent = 'Start Speaking'; // NEVER show Stop Speaking.
    voiceCard?.classList.toggle('is-listening', listeningRequested);
    voiceCard?.classList.toggle('is-selected', listeningRequested);
    textCard?.classList.toggle('is-selected', !listeningRequested);
    textButton?.setAttribute('aria-pressed', String(!listeningRequested));
  }
  function renderText() {
    const speech = [committedSpeech, finalPart, interimPart].filter(Boolean).join(' ').trim();
    const separator = baseText.trim() && speech ? (baseText.endsWith('\n') ? '' : '\n') : '';
    const max = input.maxLength > 0 ? input.maxLength : 10000;
    input.value = (baseText + separator + speech).slice(0, max);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function clearTimer() {
    if (restartTimer !== null) { clearTimeout(restartTimer); restartTimer = null; }
  }
  function settleFinish(ok) {
    if (finishResolve) { const resolve = finishResolve; finishResolve = null; resolve(ok); }
  }
  function commitCurrentSession() {
    // Interim words are preliminary. Only commit final recognized results across restarts.
    if (finalPart.trim()) committedSpeech = [committedSpeech, finalPart.trim()].filter(Boolean).join(' ');
    finalPart = '';
    interimPart = '';
    renderText();
  }
  function startSession() {
    if (!listeningRequested || finishing || recognition) return;
    if (!Recognition) { listeningRequested = false; updateButton(); message('Speech recognition is unavailable. Try Chrome or Edge.', 'error'); return; }
    const currentNumber = ++sessionNumber;
    const session = new Recognition();
    recognition = session;
    session.lang = source?.value === 'auto' ? (navigator.language || 'en-US') : (locales[source?.value] || 'en-US');
    session.continuous = true;  // Retain recognition across pauses when the browser supports it.
    session.interimResults = true;
    session.maxAlternatives = 1;
    finalPart = '';
    interimPart = '';
    session.onstart = () => {
      if (recognition === session && listeningRequested) message('Listening… Speak naturally. Click Translate when finished.', 'loading');
    };
    session.onresult = event => {
      if (recognition !== session || currentNumber !== sessionNumber) return;
      let finalText = '', interimText = '';
      for (let i = 0; i < event.results.length; i++) {
        const value = event.results[i][0]?.transcript || '';
        if (event.results[i].isFinal) finalText += value + ' ';
        else interimText += value + ' ';
      }
      finalPart = finalText.trim();
      interimPart = interimText.trim();
      renderText();
    };
    session.onerror = event => {
      if (recognition !== session) return;
      if (event.error === 'no-speech') return; // Some browsers end idle sessions; restart below.
      const problems = {
        'not-allowed': 'Microphone permission was denied. Choose Allow in the browser prompt or site settings.',
        'service-not-allowed': 'The browser blocked the speech-recognition service.',
        'audio-capture': 'No working microphone was found.',
        'network': 'Speech recognition has a network problem. Check your connection.',
        'language-not-supported': 'Speech recognition does not support this language.'
      };
      if (problems[event.error]) {
        listeningRequested = false; // Do not repeatedly ask for permission or spin on persistent errors.
        message(problems[event.error], 'error');
        updateButton();
      }
    };
    session.onend = () => {
      if (recognition !== session) return;
      recognition = null;
      commitCurrentSession();
      if (finishing) {
        finishing = false;
        listeningRequested = false;
        updateButton();
        settleFinish(true);
      } else if (listeningRequested) {
        // Browsers can end sessions after silence or time limits, even with continuous=true.
        // Retry while user still wants speech, without adding a Stop button.
        message('Listening… You may continue speaking. Click Translate when finished.', 'loading');
        restartTimer = setTimeout(() => { restartTimer = null; startSession(); }, 250);
      } else {
        updateButton();
      }
    };
    try { session.start(); }
    catch (err) {
      recognition = null;
      listeningRequested = false;
      finishing = false;
      updateButton();
      message(`Unable to start microphone: ${err.message}`, 'error');
      settleFinish(false);
    }
  }
  function startSpeaking() {
    if (listeningRequested || finishing || locked) return;
    if (!Recognition) { message('Speech recognition is unavailable in this browser.', 'error'); return; }
    baseText = input.value;
    committedSpeech = '';
    finalPart = '';
    interimPart = '';
    listeningRequested = true;
    updateButton();
    message('Starting microphone… Allow access if the browser asks.', 'loading');
    startSession();
  }
  function finishBeforeTranslate() {
    if (!listeningRequested && !recognition && !finishing) return Promise.resolve(true);
    clearTimer();
    listeningRequested = false;
    finishing = true;
    updateButton();
    return new Promise(resolve => {
      finishResolve = resolve;
      if (recognition) {
        message('Finishing speech recognition before translating…', 'loading');
        try { recognition.stop(); }
        catch (_) { recognition = null; commitCurrentSession(); finishing = false; updateButton(); settleFinish(true); }
      } else {
        // We were in the short interval between recognition sessions.
        commitCurrentSession();
        finishing = false;
        updateButton();
        settleFinish(true);
      }
    });
  }
  function cancelRecording() {
    clearTimer();
    listeningRequested = false;
    finishing = false;
    sessionNumber++;
    const session = recognition;
    recognition = null;
    if (session) { try { session.abort(); } catch (_) {} }
    baseText = '';
    committedSpeech = '';
    finalPart = '';
    interimPart = '';
    updateButton();
    settleFinish(false);
  }
  speakButton.addEventListener('click', startSpeaking);
  stopButton?.addEventListener('click', async () => {
    if (!listeningRequested || finishing) return;
    const completed = await finishBeforeTranslate();
    if (completed) {
      message('Voice recognition stopped. You can now edit your text or click Translate.', 'success');
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
  // Switching to typing also finishes recognition, preserving editable text.
  textButton?.addEventListener('click', () => { if (listeningRequested) void finishBeforeTranslate(); });
  if (privacy) privacy.hidden = false;
  updateButton();
  window.nltVoice = {
    finishBeforeTranslate,
    cancelRecording,
    lockModes(value) { locked = Boolean(value); updateButton(); }
  };
})();
