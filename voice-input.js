
/*

  Ada's AI Natural Language Translator
  Improved voice recognition for mobile and desktop.

  Uses the browser Web Speech API.
  No API keys are stored in this file.
*/

(() => {
  "use strict";

  const byId = id => document.getElementById(id);

  const speakButton = byId("speakTabBtn");
  const textButton = byId("textModeBtn");
  const stopButton = byId("stopVoiceBtn");
  const textCard = byId("textModeCard");
  const voiceCard = byId("speakModeCard");
  const input = byId("inputText");
  const source = byId("sourceLanguage");
  const privacy = byId("voicePrivacy");
  const status = byId("status");
  const buttonLabel = byId("speakButtonLabel");

  if (!speakButton || !input) return;

  // ---------- 1. Browser recognition support ----------

  const Recognition =
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

  // ---------- 2. Browser-specific settings ----------

  function getSpeechSettings() {
    const ua = navigator.userAgent || "";

    const platform = /Android/i.test(ua)
      ? "android"
      : /iPhone|iPad|iPod/i.test(ua)
      ? "ios"
      : "desktop";

    switch (platform) {
      case "android":
        return {
          continuous: false,
          interimResults: true,
          restartDelay: 900,
          autoRestart: true
        };

      case "ios":
        return {
          continuous: false,
          interimResults: true,
          restartDelay: 0,
          autoRestart: false
        };

      default:
        return {
          continuous: true,
          interimResults: true,
          restartDelay: 700,
          autoRestart: true
        };
    }
  }

  const config = getSpeechSettings();

  // ---------- 3. Recognition state ----------

  let recognition = null;
  let listeningRequested = false;
  let locked = false;

  let baseText = "";
  let committedSpeech = "";
  let finalPart = "";
  let interimPart = "";

  let restartTimer = null;
  let sessionNumber = 0;
  let finishing = false;
  let finishResolve = null;

  // ---------- 4. Status and buttons ----------

  function message(text, kind = "idle") {
    if (status) {
      status.textContent = text;
      status.dataset.state = kind;
    }
  }

  function updateButton() {
    speakButton.disabled =
      locked || listeningRequested || finishing;

    if (stopButton) {
      stopButton.disabled =
        !listeningRequested || finishing || locked;
    }

    speakButton.setAttribute(
      "aria-pressed",
      String(listeningRequested)
    );

    speakButton.setAttribute(
      "aria-label",
      "Start Speaking"
    );

    speakButton.title = listeningRequested
      ? "Listening until Stop or Translate"
      : "Start voice-to-text recognition";

    if (buttonLabel) {
      buttonLabel.textContent = "Start Speaking";
    }

    voiceCard?.classList.toggle(
      "is-listening",
      listeningRequested
    );

    voiceCard?.classList.toggle(
      "is-selected",
      listeningRequested
    );

    textCard?.classList.toggle(
      "is-selected",
      !listeningRequested
    );

    textButton?.setAttribute(
      "aria-pressed",
      String(!listeningRequested)
    );
  }

  // ---------- 5. Merge overlapping speech ----------

  function mergeSpeech(previous, next) {
    const a = String(previous || "").trim();
    const b = String(next || "").trim();

    if (!a) return b;
    if (!b) return a;

    const normalize = text =>
      text.toLocaleLowerCase().replace(
        /[.,!?;:，。！？；：]+$/u,
        ""
      );

    // Handle speech in Chinese, Japanese, or Korean
    // when the recognized text has no spaces.

    if (
      !/\s/u.test(a + b) &&
      /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(a + b)
    ) {
      if (b.startsWith(a)) return b;
      if (a.endsWith(b)) return a;

      for (
        let count = Math.min(a.length, b.length);
        count >= 2;
        count--
      ) {
        if (a.endsWith(b.slice(0, count))) {
          return a + b.slice(count);
        }
      }

      return a + b;
    }

    const left = a.split(/\s+/u);
    const right = b.split(/\s+/u);

    const equal = (x, y) =>
      normalize(x) === normalize(y);

    // If the new result extends the previous one,
    // use the newer complete version.

    if (
      left.length <= right.length &&
      left.every((word, i) => equal(word, right[i]))
    ) {
      return b;
    }

    // If the new result repeats the ending
    // of a previous result, do not append it.

    if (
      right.length <= left.length &&
      right.every((word, i) =>
        equal(
          word,
          left[left.length - right.length + i]
        )
      )
    ) {
      return a;
    }

    // Remove overlapping words between sessions.
    // Avoid aggressive single-word merging so that
    // intentional repetitions can still be recognized.

    for (
      let n = Math.min(left.length, right.length);
      n >= 1;
      n--
    ) {
      if (
        n === 1 &&
        left.length > 1 &&
        right.length > 1
      ) {
        continue;
      }

      const matching = left
        .slice(-n)
        .every((word, i) => equal(word, right[i]));

      if (matching) {
        return (
          a + " " + right.slice(n).join(" ")
        ).trim();
      }
    }

    return `${a} ${b}`;
  }

  // ---------- 6. Display speech in textarea ----------

  function renderText() {
    const speech = mergeSpeech(
      mergeSpeech(committedSpeech, finalPart),
      interimPart
    );

    const separator =
      baseText.trim() && speech
        ? baseText.endsWith("\n")
          ? ""
          : "\n"
        : "";

    const max =
      input.maxLength > 0
        ? input.maxLength
        : 10000;

    input.value = (
      baseText + separator + speech
    ).slice(0, max);

    input.dispatchEvent(
      new Event("input", { bubbles: true })
    );
  }

  function clearTimer() {
    if (restartTimer !== null) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
  }

  function settleFinish(ok) {
    if (finishResolve) {
      const resolve = finishResolve;
      finishResolve = null;
      resolve(ok);
    }
  }

  function commitCurrentSession() {
    // Save only final recognized words.
    // Interim words may change while speaking.

    committedSpeech = mergeSpeech(
      committedSpeech,
      finalPart
    );

    finalPart = "";
    interimPart = "";

    renderText();
  }

  // ---------- 7. Start recognition session ----------

  function startSession() {
    if (
      !listeningRequested ||
      finishing ||
      recognition
    ) {
      return;
    }

    if (!Recognition) {
      listeningRequested = false;
      updateButton();

      message(
        "Speech recognition is unavailable. Try Chrome or Edge.",
        "error"
      );
      return;
    }

    const currentNumber = ++sessionNumber;
    const session = new Recognition();

    
    const session = new Recognition();
    // Enable built-in punctuation when supported
    if ("unspokenPunctuation" in session) {
    session.unspokenPunctuation = true;
    }

    recognition = session;

    session.lang =
      source?.value === "auto"
        ? navigator.language || "en-US"
        : locales[source?.value] || "en-US";

    session.continuous = config.continuous;
    session.interimResults = config.interimResults;
    session.maxAlternatives = 1;

    finalPart = "";
    interimPart = "";

    session.onstart = () => {
      if (
        recognition === session &&
        listeningRequested
      ) {
        message(
          "Listening… Speak naturally. Click Stop or Translate when finished.",
          "loading"
        );
      }
    };

    // ---------- 8. Process recognition results ----------

    session.onresult = event => {
      if (
        recognition !== session ||
        currentNumber !== sessionNumber
      ) {
        return;
      }

      let finals = "";
      let interims = "";

      // Reconstruct the current session results.
      // Do not append the entire result list again
      // every time the browser fires onresult.

      for (
        let i = 0;
        i < event.results.length;
        i++
      ) {
        const value = (
          event.results[i][0]?.transcript || ""
        ).trim();

        if (!value) continue;

        if (event.results[i].isFinal) {
          finals = mergeSpeech(finals, value);
        } else {
          interims = mergeSpeech(interims, value);
        }
      }

      finalPart = finals;
      interimPart = interims;

      renderText();
    };

    // ---------- 9. Recognition errors ----------

    session.onerror = event => {
      if (recognition !== session) return;

      if (event.error === "no-speech") {
        return;
      }

      const problems = {
        "not-allowed":
          "Microphone permission denied. Allow microphone access in browser settings.",

        "service-not-allowed":
          "The browser blocked the speech-recognition service.",

        "audio-capture":
          "No working microphone was found.",

        "network":
          "Speech recognition has a network problem. Check your connection.",

        "language-not-supported":
          "Speech recognition does not support this language."
      };

      if (problems[event.error]) {
        listeningRequested = false;

        message(
          problems[event.error],
          "error"
        );

        updateButton();
      }
    };

    // ---------- 10. Recognition session ending ----------

    session.onend = () => {
      if (recognition !== session) return;

      recognition = null;

      commitCurrentSession();

      if (finishing) {
        finishing = false;
        listeningRequested = false;

        updateButton();
        settleFinish(true);

      } else if (
        listeningRequested &&
        config.autoRestart
      ) {
        // A controlled restart helps avoid
        // overlapping mobile recognition sessions.

        message(
          "Listening… You may continue speaking. Click Stop when finished.",
          "loading"
        );

        restartTimer = setTimeout(() => {
          restartTimer = null;
          startSession();
        }, config.restartDelay);

      } else {
        // Some mobile browsers need another
        // user action to begin the next session.

        listeningRequested = false;
        updateButton();
      }
    };

    try {
      session.start();
    } catch (err) {
      recognition = null;
      listeningRequested = false;
      finishing = false;

      updateButton();

      message(
        `Unable to start microphone: ${err.message}`,
        "error"
      );

      settleFinish(false);
    }
  }

  // ---------- 11. Start Speaking button ----------

  function startSpeaking() {
    if (
      listeningRequested ||
      finishing ||
      locked
    ) {
      return;
    }

    if (!Recognition) {
      message(
        "Speech recognition is unavailable in this browser.",
        "error"
      );
      return;
    }

    baseText = input.value;

    committedSpeech = "";
    finalPart = "";
    interimPart = "";

    listeningRequested = true;

    updateButton();

    message(
      "Starting microphone… Allow access if the browser asks.",
      "loading"
    );

    startSession();
  }

  // ---------- 12. Stop recognition ----------

  function finishBeforeTranslate() {
    if (
      !listeningRequested &&
      !recognition &&
      !finishing
    ) {
      return Promise.resolve(true);
    }

    clearTimer();

    listeningRequested = false;
    finishing = true;

    updateButton();

    return new Promise(resolve => {
      finishResolve = resolve;

      if (recognition) {
        message(
          "Finishing speech recognition before translating…",
          "loading"
        );

        try {
          recognition.stop();
        } catch (_) {
          recognition = null;
          commitCurrentSession();
          finishing = false;

          updateButton();
          settleFinish(true);
        }

      } else {
        commitCurrentSession();
        finishing = false;

        updateButton();
        settleFinish(true);
      }
    });
  }

  // ---------- 13. Clear or cancel recording ----------

  function cancelRecording() {
    clearTimer();

    listeningRequested = false;
    finishing = false;

    sessionNumber++;

    const session = recognition;
    recognition = null;

    if (session) {
      try {
        session.abort();
      } catch (_) {}
    }

    baseText = "";
    committedSpeech = "";
    finalPart = "";
    interimPart = "";

    updateButton();
    settleFinish(false);
  }

  // ---------- 14. Button event handlers ----------

  speakButton.addEventListener(
    "click",
    startSpeaking
  );

  stopButton?.addEventListener(
    "click",
    async () => {
      if (
        !listeningRequested ||
        finishing
      ) {
        return;
      }

      const completed =
        await finishBeforeTranslate();

      if (completed) {
        message(
          "Voice recognition stopped. You can edit the text or click Translate.",
          "success"
        );

        // Do not automatically focus the textarea.
        // On Android that would open the keyboard
        // and cover the Translate button.
      }
    }
  );

  textButton?.addEventListener(
    "click",
    () => {
      if (listeningRequested) {
        void finishBeforeTranslate();
      }
    }
  );

  if (privacy) {
    privacy.hidden = false;
  }

  updateButton();

  // ---------- 15. Interface for app.js ----------

  window.nltVoice = {
    finishBeforeTranslate,
    cancelRecording,

    lockModes(value) {
      locked = Boolean(value);
      updateButton();
    }
  };
})();
