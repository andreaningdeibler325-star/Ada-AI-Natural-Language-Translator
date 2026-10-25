
/*
  Ada's AI Natural Language Translator
  voice-input.js

  Browser speech recognition for desktop and mobile.
  This file contains no API keys.
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

  if (!speakButton || !input) {
    console.warn(
      "NLT voice: required HTML elements are missing."
    );
    return;
  }

  // 1. Browser speech-recognition support

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
    ru: "ru-RU"
  };

  // 2. Browser-specific configuration

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

  // 3. Recognition state

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

  // 4. Update status display

  function setStatus(text, state = "idle") {
    if (!status) return;

    status.textContent = text;
    status.dataset.state = state;
  }

  // 5. Update Start / Stop controls

  function updateButtons() {
    speakButton.disabled =
      locked ||
      listening ||
      stopping ||
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
        locked || !listening || stopping;
    }

    if (textButton) {
      textButton.setAttribute(
        "aria-pressed",
        String(!listening)
      );
    }

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

  // 6. Join text fragments

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

  // 7. Remove overlapping phrases across sessions
  //
  // Do not remove intentional repeated words
  // within a single recognition session.

  function appendSession(previous, next) {
    const a = String(previous || "").trim();
    const b = String(next || "").trim();

    if (!a) return b;
    if (!b) return a;

    // Chinese, Japanese, Korean text without spaces

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

    // Languages that use spaces between words

    const left = a.split(/\s+/u);
    const right = b.split(/\s+/u);

    const clean = word =>
      word.toLocaleLowerCase().replace(
        /[.,!?;:，。！？；：]+$/u,
        ""
      );

    // Check for overlapping phrases
    // of at least two words.

    for (
      let n = Math.min(left.length, right.length);
      n >= 2;
      n--
    ) {
      const match = left
        .slice(-n)
        .every(
          (word, i) =>
            clean(word) === clean(right[i])
        );

      if (match) {
        return joinText(
          a,
          right.slice(n).join(" ")
        );
      }
    }

    return joinText(a, b);
  }

  // 8. Current recognition session

  function currentSessionText() {
    return joinText(
      sessionFinal,
      sessionInterim
    );
  }

  // 9. Display transcription

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

  // 10. Commit final and interim speech

  function commitSession() {
    // Important Android fix:
    // preserve words even when the browser
    // did not mark the last result as final.

    completedText = appendSession(
      completedText,
      currentSessionText()
    );

    sessionFinal = "";
    sessionInterim = "";

    renderText();
  }

  // 11. Timer helpers

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

  // 12. Complete a Stop operation

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

  // 13. Start a recognition session

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

    // Do not enable experimental
    // unspokenPunctuation here.

    // 14. Microphone begins listening

    session.onstart = () => {
      if (
        recognition === session &&
        listening
      ) {
        setStatus(
          "Listening… Speak naturally, then tap Stop.",
          "loading"
        );
      }
    };

    // 15. Handle transcription results

    session.onresult = event => {
      if (recognition !== session) {
        return;
      }

      const finals = [];
      const interims = [];

      // Reconstruct the current session.
      // Do not repeatedly append the entire
      // browser result list.

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
      }

      renderText();
    };

    // 16. Handle microphone errors

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

      // Do not automatically restart
      // after a microphone or service error.

      listening = false;

      updateButtons();
    };

    // 17. Handle session ending

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

      // Browsers that require manual restart

      if (!config.autoRestart) {
        listening = false;
        updateButtons();

        setStatus(
          "Recognition paused. Tap Start Speaking to continue."
        );

        return;
      }

      // Prevent endless restarts
      // when no speech is detected.

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

    // 18. Activate recognition

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

  // 19. Start Speaking button

  function startSpeaking() {
    if (
      locked ||
      listening ||
      stopping
    ) {
      return;
    }

    if (!SpeechRecognition) {
      setStatus(
        "Speech recognition is not supported in this browser.",
        "error"
      );

      return;
    }

    clearRestart();

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

  // 20. Stop before translating

  function finishBeforeTranslate() {
    if (finishPromise) {
      return finishPromise;
    }

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

    // Some browsers fail to fire onend.
    // Do not leave Translate waiting forever.

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

  // 21. Cancel voice recognition

  function cancelRecording() {
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

  // 22. Connect Start Speaking button

  speakButton.addEventListener(
    "click",
    startSpeaking
  );

  // 23. Connect Stop button

  stopButton?.addEventListener(
    "click",
    async () => {
      if (!listening || stopping) return;

      if (await finishBeforeTranslate()) {
        setStatus(
          "Voice recognition stopped. Review text or tap Translate.",
          "success"
        );
      }
    }
  );

  // 24. Connect Enter Text button

  textButton?.addEventListener(
    "click",
    async () => {
      if (listening || stopping) {
        await finishBeforeTranslate();
      }

      // Move the cursor into the textarea
      // when the user chooses Enter Text.

      input.focus();
    }
  );

  // 25. Show microphone privacy notice

  if (privacy) {
    privacy.hidden = false;
  }

  updateButtons();

  // 26. Interface used by app.js

  window.nltVoice = {
    finishBeforeTranslate,
    cancelRecording,

    lockModes(value) {
      locked = Boolean(value);
      updateButtons();
    }
  };
})();
