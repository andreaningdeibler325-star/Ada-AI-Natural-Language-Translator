

/*
 Ada's AI Natural Language Translator
 Voice recognition + automatic punctuation
*/

(() => {
  "use strict";

  const get = id => document.getElementById(id);

  const speakButton = get("speakTabBtn");
  const stopButton = get("stopVoiceBtn");
  const textButton = get("textModeBtn");
  const input = get("inputText");
  const source = get("sourceLanguage");
  const status = get("status");
  const label = get("speakButtonLabel");
  const textCard = get("textModeCard");
  const voiceCard = get("speakModeCard");
  const privacy = get("voicePrivacy");

  if (!speakButton || !input) return;

  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  const locales = {
    en: "en-US",
    zh: "zh-CN",
    yue: "zh-HK",
    de: "de-DE",
    fr: "fr-FR",
    es: "es-ES",
    it: "it-IT",
    pt: "pt-PT",
    ja: "ja-JP",
    ko: "ko-KR",
    ar: "ar-SA",
    hi: "hi-IN",
    ru: "ru-RU",
    te: 'te-IN', // Telugu
    bn: 'bn-IN', // Bengali
    ta: 'ta-IN', // Tamil
    ur: 'ur-PK', // Urdu
    pa: 'pa-IN', // Punjabi
    mr: 'mr-IN', // Marathi
    gu: 'gu-IN', // Gujarati
    ml: 'ml-IN', // Malayalam
    th: 'th-TH', // Thai
    vi: 'vi-VN'  // Vietnamese
};
                   
   function settings() {
    const ua = navigator.userAgent || "";

    const device = /Android/i.test(ua)
      ? "android"
      : /iPhone|iPad|iPod/i.test(ua)
      ? "ios"
      : "desktop";

    switch (device) {
      case "android":
        return {
          continuous: false,
          autoRestart: true,
          restartDelay: 900
        };

      case "ios":
        return {
          continuous: false,
          autoRestart: false,
          restartDelay: 0
        };

      default:
        return {
          continuous: true,
          autoRestart: true,
          restartDelay: 700
        };
    }
  }

  const config = settings();

  const CJK =
    /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u;

  const MAX_SILENT_SESSIONS = 3;
  const STOP_TIMEOUT_MS = 3000;

  let recognition = null;
  let listening = false;
  let stopping = false;
  let locked = false;

  let baseText = "";
  let completedText = "";
  let sessionFinal = "";
  let sessionInterim = "";

  let silentSessions = 0;
  let restartTimer = null;
  let stopTimer = null;

  let finishPromise = null;
  let resolveFinish = null;

  // Automatic punctuation state

  let punctuationNeeded = false;
  let punctuationPromise = null;
  let punctuationVersion = 0;
  let polishing = false;

  function setStatus(text, state = "idle") {
    if (!status) return;

    status.textContent = text;
    status.dataset.state = state;
  }

  function updateButtons() {
    speakButton.disabled =
      locked ||
      listening ||
      stopping ||
      polishing ||
      !SpeechRecognition;

    speakButton.setAttribute(
      "aria-pressed",
      String(listening)
    );

    speakButton.setAttribute(
      "aria-label",
      "Start Speaking"
    );

    speakButton.title =
      "Start voice-to-text recognition";

    if (label) {
      label.textContent = "Start Speaking";
    }

    if (stopButton) {
      stopButton.disabled =
        locked || !listening || stopping || polishing;
    }

    textButton?.setAttribute(
      "aria-pressed",
      String(!listening)
    );

    voiceCard?.classList.toggle(
      "is-listening",
      listening
    );

    voiceCard?.classList.toggle(
      "is-selected",
      listening
    );

    textCard?.classList.toggle(
      "is-selected",
      !listening
    );
  }

  // Join recognized fragments

  function joinText(...parts) {
    return parts.reduce((result, part) => {
      const text = String(part || "").trim();

      if (!text) return result;
      if (!result) return text;

      const last = result[result.length - 1];

      return CJK.test(last) && CJK.test(text[0])
        ? result + text
        : result + " " + text;
    }, "");
  }

  // Handle overlapping browser sessions

  function appendSession(previous, next) {
    const a = String(previous || "").trim();
    const b = String(next || "").trim();

    if (!a) return b;
    if (!b) return a;

    if (!/\s/u.test(a + b) && CJK.test(a + b)) {
      for (
        let n = Math.min(a.length, b.length);
        n >= 2;
        n--
      ) {
        if (a.slice(-n) === b.slice(0, n)) {
          return a + b.slice(n);
        }
      }

      return joinText(a, b);
    }

    const left = a.split(/\s+/u);
    const right = b.split(/\s+/u);

    const clean = word =>
      word.toLocaleLowerCase().replace(
        /[.,!?;:，。！？；：]+$/u,
        ""
      );

    for (
      let n = Math.min(left.length, right.length);
      n >= 2;
      n--
    ) {
      const matching = left
        .slice(-n)
        .every(
          (word, i) =>
            clean(word) === clean(right[i])
        );

      if (matching) {
        return joinText(
          a,
          right.slice(n).join(" ")
        );
      }
    }

    return joinText(a, b);
  }

  function currentSessionText() {
    return joinText(sessionFinal, sessionInterim);
  }

  function renderText() {
    const transcript = appendSession(
      completedText,
      currentSessionText()
    );

    const separator =
      baseText.trim() && transcript
        ? baseText.endsWith("\n")
          ? ""
          : "\n"
        : "";

    const limit =
      input.maxLength > 0
        ? input.maxLength
        : 10000;

    const next = (
      baseText + separator + transcript
    ).slice(0, limit);

    if (input.value !== next) {
      input.value = next;

      input.dispatchEvent(
        new Event("input", {
          bubbles: true
        })
      );
    }
  }

  function commitSession() {
    completedText = appendSession(
      completedText,
      currentSessionText()
    );

    sessionFinal = "";
    sessionInterim = "";

    renderText();
  }

  function clearRestart() {
    if (restartTimer !== null) {
      clearTimeout(restartTimer);
    }

    restartTimer = null;
  }

  function clearStopTimer() {
    if (stopTimer !== null) {
      clearTimeout(stopTimer);
    }

    stopTimer = null;
  }

  function completeStop(success) {
    clearStopTimer();

    stopping = false;
    listening = false;

    updateButtons();

    if (resolveFinish) {
      const done = resolveFinish;

      resolveFinish = null;
      finishPromise = null;

      done(success);
    }
  }

  // Start the browser speech-recognition session

  function startSession() {
    if (
      !listening ||
      stopping ||
      recognition ||
      !SpeechRecognition
    ) {
      return;
    }

    let session;

    try {
      session = new SpeechRecognition();
    } catch (error) {
      listening = false;
      updateButtons();

      setStatus(
        `Could not open voice recognition: ${error.message}`,
        "error"
      );

      return;
    }

    recognition = session;

    sessionFinal = "";
    sessionInterim = "";

    session.lang =
      source?.value === "auto"
        ? navigator.language || "en-US"
        : locales[source?.value] || "en-US";

    session.continuous = config.continuous;
    session.interimResults = true;
    session.maxAlternatives = 1;

    session.onstart = () => {
      if (recognition === session && listening) {
        setStatus(
          "Listening… Speak naturally, then tap Stop.",
          "loading"
        );
      }
    };

    session.onresult = event => {
      if (recognition !== session) return;

      const finals = [];
      const interims = [];

      for (
        let i = 0;
        i < event.results.length;
        i++
      ) {
        const result = event.results[i];

        const words = (
          result[0]?.transcript || ""
        ).trim();

        if (!words) continue;

        if (result.isFinal) {
          finals.push(words);
        } else {
          interims.push(words);
        }
      }

      sessionFinal = joinText(...finals);
      sessionInterim = joinText(...interims);

      if (sessionFinal || sessionInterim) {
        silentSessions = 0;
        punctuationNeeded = true;
      }

      renderText();
    };

    session.onerror = event => {
      if (recognition !== session) return;

      if (
        event.error === "no-speech" ||
        event.error === "aborted"
      ) {
        return;
      }

      const errors = {
        "not-allowed":
          "Microphone blocked. Allow access in browser settings.",

        "service-not-allowed":
          "The browser blocked its speech service.",

        "audio-capture":
          "Microphone not available.",

        network:
          "Speech recognition network error.",

        "language-not-supported":
          "Speech recognition does not support this language."
      };

      setStatus(
        errors[event.error] ||
          `Voice error: ${event.error}`,
        "error"
      );

      listening = false;
      updateButtons();
    };

    session.onend = () => {
      if (recognition !== session) return;

      recognition = null;

      const heardSpeech = Boolean(
        currentSessionText()
      );

      commitSession();

      if (stopping) {
        completeStop(true);
        return;
      }

      if (!listening) {
        updateButtons();
        return;
      }

      if (!config.autoRestart) {
        listening = false;
        updateButtons();

        setStatus(
          "Recognition paused. Tap Start Speaking to continue."
        );

        return;
      }

      silentSessions = heardSpeech
        ? 0
        : silentSessions + 1;

      if (
        silentSessions >= MAX_SILENT_SESSIONS
      ) {
        listening = false;
        updateButtons();

        setStatus(
          "No speech detected. Tap Start Speaking to try again."
        );

        return;
      }

      setStatus(
        "Listening… You may continue speaking.",
        "loading"
      );

      clearRestart();

      restartTimer = setTimeout(() => {
        restartTimer = null;
        startSession();
      }, config.restartDelay);
    };

    try {
      session.start();
    } catch (error) {
      recognition = null;
      listening = false;

      updateButtons();

      setStatus(
        `Could not start microphone: ${error.message}`,
        "error"
      );
    }
  }

  function startSpeaking() {
    if (locked || listening || stopping) return;

    if (!SpeechRecognition) {
      setStatus(
        "Speech recognition is not supported in this browser.",
        "error"
      );

      return;
    }

    clearRestart();

    punctuationVersion++;
    punctuationNeeded = false;

    baseText = input.value;
    completedText = "";
    sessionFinal = "";
    sessionInterim = "";

    silentSessions = 0;
    listening = true;

    updateButtons();

    setStatus(
      "Starting microphone…",
      "loading"
    );

    startSession();
  }

  // Stop browser recognition

  function finishBeforeTranslate() {
    if (finishPromise) return finishPromise;

    if (
      !listening &&
      !recognition &&
      restartTimer === null
    ) {
      return Promise.resolve(true);
    }

    listening = false;
    stopping = true;

    clearRestart();
    updateButtons();

    finishPromise = new Promise(resolve => {
      resolveFinish = resolve;
    });

    if (!recognition) {
      commitSession();
      completeStop(true);

      return finishPromise ||
        Promise.resolve(true);
    }

    try {
      recognition.stop();
    } catch (_) {
      recognition = null;

      commitSession();
      completeStop(true);
    }

    if (stopping) {
      stopTimer = setTimeout(() => {
        const old = recognition;
        recognition = null;

        if (old) {
          try {
            old.abort();
          } catch (_) {}
        }

        commitSession();
        completeStop(true);
      }, STOP_TIMEOUT_MS);
    }

    return finishPromise ||
      Promise.resolve(true);
  }

  // Basic punctuation if the AI service
  // is temporarily unavailable

  function simplePunctuation(raw) {
    let value = String(raw || "").trim();

    if (!value) return value;

    value = value.replace(
      /^(\p{Ll})/u,
      first => first.toLocaleUpperCase()
    );

    if (!/[.!?。！？]$/u.test(value)) {
      const lang = source?.value || "auto";

      value += (
        lang === "zh" ||
        lang === "yue" ||
        lang === "ja"
      ) ? "。" : ".";
    }

    return value;
  }

  // Verify that the punctuation model
  // has preserved the recognized words

  function sameWords(before, after) {
    const normalize = value =>
      String(value || "")
        .normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/[\p{P}\p{S}\s]/gu, "");

    return normalize(before) === normalize(after);
  }

  // Automatic punctuation after Stop

  async function punctuateAfterStop() {
    if (punctuationPromise) {
      return punctuationPromise;
    }

    if (
      !punctuationNeeded ||
      !completedText.trim()
    ) {
      return;
    }

    const version = punctuationVersion;
    const raw = completedText.trim();

    const expectedOriginal = baseText + (
      baseText.trim() &&
      raw &&
      !baseText.endsWith("\n")
        ? "\n"
        : ""
    ) + raw;

    punctuationNeeded = false;

    const limit =
      input.maxLength > 0
        ? input.maxLength
        : 10000;

    // Never overwrite text the user edited

    if (
      input.value !==
      expectedOriginal.slice(0, limit)
    ) {
      return;
    }

    const expected = input.value;

    polishing = true;
    updateButtons();

    setStatus(
      "Adding punctuation…",
      "loading"
    );

    punctuationPromise = (async () => {
      let formatted = "";
      let usedAI = false;

      try {
        const controller = new AbortController();

        const timeout = setTimeout(
          () => controller.abort(),
          12000
        );

        let data;

        try {
          const response = await fetch(
            "/api/punctuate",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                text: raw,
                language: source?.value || "auto"
              }),
              signal: controller.signal
            }
          );

          if (!response.ok) {
            throw new Error(
              `HTTP ${response.status}`
            );
          }

          data = await response.json();
        } finally {
          clearTimeout(timeout);
        }

        const candidate = String(
          data.text || ""
        ).trim();

        if (
          !candidate ||
          !sameWords(raw, candidate)
        ) {
          throw new Error(
            "Punctuation service changed the recognized words"
          );
        }

        formatted = candidate;
        usedAI = true;

      } catch (error) {
        console.warn(
          "NLT punctuation fallback:",
          error
        );

        formatted = simplePunctuation(raw);
      }

      if (
        version === punctuationVersion &&
        input.value === expected
      ) {
        completedText = formatted;
        renderText();

        setStatus(
          usedAI
            ? "Punctuation added. Review text or tap Translate."
            : "Basic punctuation added (AI unavailable). Review the text.",
          usedAI ? "success" : "idle"
        );
      }
    })().finally(() => {
      if (version === punctuationVersion) {
        polishing = false;
        punctuationPromise = null;

        updateButtons();
      }
    });

    return punctuationPromise;
  }

  // Stop recognition, then add punctuation

  async function finishAndPunctuate() {
    const finished = await finishBeforeTranslate();

    if (!finished) return false;

    await punctuateAfterStop();

    return true;
  }

  function cancelRecording() {
    punctuationVersion++;
    punctuationNeeded = false;
    polishing = false;
    punctuationPromise = null;

    clearRestart();
    clearStopTimer();

    listening = false;
    stopping = false;

    const old = recognition;
    recognition = null;

    if (old) {
      try {
        old.abort();
      } catch (_) {}
    }

    baseText = "";
    completedText = "";
    sessionFinal = "";
    sessionInterim = "";

    silentSessions = 0;

    completeStop(false);
  }

  // Start Speaking button

  speakButton.addEventListener(
    "click",
    startSpeaking
  );

  // Stop button

  stopButton?.addEventListener(
    "click",
    async () => {
      if (!listening || stopping) return;

      await finishAndPunctuate();
    }
  );

  // Enter Text button

  textButton?.addEventListener(
    "click",
    async () => {
      if (listening || stopping) {
        await finishAndPunctuate();
      }

      input.focus();
    }
  );

  if (privacy) {
    privacy.hidden = false;
  }

  updateButtons();

  // Interface used by app.js

  window.nltVoice = {
    finishBeforeTranslate: finishAndPunctuate,
    cancelRecording,

    lockModes(value) {
      locked = Boolean(value);
      updateButtons();
    }
  };
})();
