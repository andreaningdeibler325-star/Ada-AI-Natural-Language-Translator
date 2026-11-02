/* =========================================================
   AI Language Translator — frontend logic (presentation layer only)

   Structure:
   1. Configuration
   2. DOM references
   3. Helpers (status, UI state)
   4. API layer
   5. Main action: translateText()
   6. Other event handlers (swap, clear, copy, counter)
   7. Initialisation

   NOTE: No API keys or secrets belong in this file. The browser only talks to
   your own backend: Frontend -> Node.js/TypeScript API -> LLM
   ========================================================= */

"use strict";

/* ---------- 1. Configuration ---------- */

const API_ENDPOINT = "/api/translate";
const USE_PLACEHOLDER = false;
let translationBusy = false;
let operationVersion = 0;
let translationController = null;

// Single source of truth for the language lists. `code` is what the API receives.

const LANGUAGES = [
  { code: "ar", name: "Arabic" },
  { code: "bn", name: "Bengali" },
  { code: "bg", name: "Bulgarian" },
  { code: "my", name: "Burmese (Myanmar)" },
  { code: "yue", name: "Cantonese (廣東話)" },
  { code: "zh", name: "Chinese (Mandarin)" },
  { code: "co", name: "Corsican" },
  { code: "hr", name: "Croatian" },
  { code: "cs", name: "Czech" },
  { code: "da", name: "Danish" },
  { code: "nl", name: "Dutch" },
  { code: "en", name: "English" },
  { code: "fj", name: "Fijian" },
  { code: "fil", name: "Filipino" },
  { code: "fi", name: "Finnish" },
  { code: "fr", name: "French" },
  { code: "ka", name: "Georgian" },
  { code: "de", name: "German" },
  { code: "el", name: "Greek" },
  { code: "gu", name: "Gujarati" },
  { code: "ht", name: "Haitian Creole" },
  { code: "ha", name: "Hausa" },
  { code: "hi", name: "Hindi" },
  { code: "nan", name: "Hokkien (Southern Min)" },
  { code: "id", name: "Indonesian" },
  { code: "ga", name: "Irish" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "km", name: "Khmer" },
  { code: "ko", name: "Korean" },
  { code: "lo", name: "Lao" },
  { code: "ms", name: "Malay" },
  { code: "ml", name: "Malayalam" },
  { code: "mt", name: "Maltese" },
  { code: "mr", name: "Marathi" },
  { code: "mn", name: "Mongolian" },
  { code: "fa", name: "Persian (Farsi)" },
  { code: "pl", name: "Polish" },
  { code: "pt", name: "Portuguese" },
  { code: "pa", name: "Punjabi" },
  { code: "ro", name: "Romanian" },
  { code: "ru", name: "Russian" },
  { code: "sk", name: "Slovak" },
  { code: "es", name: "Spanish" },
  { code: "es-419", name: "Spanish (Latin America)" },
  { code: "es-CO", name: "Spanish (Colombia)" },
  { code: "es-MX", name: "Spanish (Mexico)" },
  { code: "es-PE", name: "Spanish (Peru)" },
  { code: "es-SV", name: "Spanish (El Salvador)" },
  { code: "es-ES", name: "Spanish (Spain)" },
  { code: "es-US", name: "Spanish (United States)" },
  { code: "sw", name: "Swahili" },
  { code: "sv", name: "Swedish" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "th", name: "Thai" },
  { code: "bo", name: "Tibetan" },
  { code: "to", name: "Tongan" },
  { code: "tr", name: "Turkish" },
  { code: "uk", name: "Ukrainian" },
  { code: "ur", name: "Urdu" },
  { code: "vi", name: "Vietnamese" }
].sort((a, b) =>
  a.name.localeCompare(b.name, "en", {
    sensitivity: "base"
  })
);



/* ---------- 2. DOM references ---------- */

const el = {
  source: document.getElementById("sourceLanguage"),
  target: document.getElementById("targetLanguage"),
  tone: document.getElementById("tone"),
  input: document.getElementById("inputText"),
  charCount: document.getElementById("charCount"),
  charMax: document.getElementById("charMax"),
  counter: document.querySelector(".counter"),
  translateBtn: document.getElementById("translateBtn"),
  clearBtn: document.getElementById("clearBtn"),
  swapBtn: document.getElementById("swapBtn"),
  copyBtn: document.getElementById("copyBtn"),
  output: document.getElementById("outputText"),
  detected: document.getElementById("detectedLanguage"),
  targetLabel: document.getElementById("targetLanguageLabel"),
  status: document.getElementById("status"),
};

/* ---------- 3. Helpers ---------- */

/**
 * Show a message in the status area.
 * @param {string} message  Text to display ("" clears it).
 * @param {"idle"|"loading"|"success"|"error"} state  Controls the colour/indicator.
 */
function setStatus(message, state = "idle") {
  el.status.textContent = message;
  el.status.dataset.state = state;
}

/** Disable controls while a request is running to prevent double submits. */
function setBusy(isBusy) {
  translationBusy = isBusy;
  el.translateBtn.disabled = isBusy;
  el.translateBtn.textContent = isBusy ? "Working…" : "Translate";
  if (el.swapBtn) el.swapBtn.disabled = isBusy;
  if (el.source) el.source.disabled = isBusy;
  if (el.target) el.target.disabled = isBusy;
  if (el.tone) el.tone.disabled = isBusy;
  window.nltVoice?.lockModes(isBusy);
}

/** Render the translation and its metadata in the result panel. */
function showResult({ translation, detectedLanguage, targetLanguage }) {
  el.output.textContent = translation; // textContent (not innerHTML) avoids injecting markup
  el.detected.textContent = detectedLanguage || "-";
  el.targetLabel.textContent = targetLanguage || "-";
  el.copyBtn.disabled = !translation;
}

/** Return the result panel to its empty state. */
function resetResult() {
  el.output.innerHTML = '<span class="output-placeholder">Your translation will appear here.</span>';
  el.detected.textContent = "-";
  el.targetLabel.textContent = "-";
  el.copyBtn.disabled = true;
}

/** Look up a display name from a language code. */
function languageName(code) {
  const match = LANGUAGES.find((l) => l.code === code);
  return match ? match.name : code;
}

/* ---------- 4. API layer ---------- */

/**
 * Send a translation request.
 *
 * Request body:  { text, sourceLanguage, targetLanguage, tone }
 * Response body: { success, detectedLanguage, targetLanguage, translation }
 *
 * While USE_PLACEHOLDER is true, no network request is made.
 */
async function requestTranslation(payload, signal) {
  if (USE_PLACEHOLDER) {
    await new Promise((resolve) => setTimeout(resolve, 600)); // simulate latency
    return {
      success: true,
      detectedLanguage: payload.sourceLanguage === "auto" ? "Auto-detected (placeholder)" : languageName(payload.sourceLanguage),
      targetLanguage: languageName(payload.targetLanguage),
      translation:
        "[Placeholder] The translation will appear here once the backend is connected.\n\n" +
        `Request that would be sent to POST ${API_ENDPOINT}:\n` +
        JSON.stringify(payload, null, 2),
    };
  }

  const response = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Server responded with ${response.status}`);
  }
  return response.json();
}

/* ---------- 5. Main action ---------- */

async function translateText() {
  if (translationBusy) return;

  const myVersion = ++operationVersion;
  setBusy(true);
  setStatus("Preparing your translation…", "loading");

  try {
    // If recording, Translate automatically stops it, transcribes audio,
    // and only then translates the recognized words.
    const ready = await window.nltVoice?.finishBeforeTranslate();
    if (myVersion !== operationVersion) return;
    if (ready === false) {
      setStatus("Speech transcription did not complete. Please try recording again.", "error");
      return;
    }

    const text = el.input.value.trim();
    if (!text) {
      setStatus("Enter text or record your voice before translating.", "error");
      el.input.focus();
      return;
    }
    if (el.source.value !== "auto" && el.source.value === el.target.value) {
      setStatus("Source and target languages are the same. Choose a different target.", "error");
      return;
    }

    const payload = {
      text,
      sourceLanguage: el.source.value,
      targetLanguage: el.target.value,
      tone: el.tone.value,
    };

    setStatus("Translating…", "loading");
    const controller = new AbortController();
    translationController = controller;
    const data = await requestTranslation(payload, controller.signal);
    if (myVersion !== operationVersion) return;
    if (!data.success) throw new Error("The server could not complete the translation.");
    showResult(data);
    setStatus("Translation complete.", "success");
  } catch (error) {
    if (myVersion !== operationVersion || error?.name === "AbortError") return;
    console.error(error);
    setStatus("Translation failed. Please try again.", "error");
  } finally {
    if (myVersion === operationVersion) {
      translationController = null;
      setBusy(false);
    }
  }
}

/* ---------- 6. Other event handlers ---------- */

/** Swap source and target. Not possible while source is "Auto Detect". */
function swapLanguages() {
  if (el.source.value === "auto") {
    setStatus("Choose a source language before swapping.", "error");
    return;
  }
  [el.source.value, el.target.value] = [el.target.value, el.source.value];
  setStatus("");
}

/** Reset inputs, result, and status. Language and tone choices are kept. */
function clearAll() {
  // Cancel an active recording or pending transcription before clearing text.
  operationVersion += 1;
  translationController?.abort();
  translationController = null;
  window.nltVoice?.cancelRecording();
  setBusy(false);
  el.input.value = "";
  updateCounter();
  resetResult();
  setStatus("");
  el.input.focus();
}

/** Copy the current translation to the clipboard. */
async function copyTranslation() {
  const text = el.output.textContent.trim();
  if (!text || el.copyBtn.disabled) return;

  try {
    await navigator.clipboard.writeText(text);
    setStatus("Translation copied to clipboard.", "success");
  } catch (error) {
    console.error(error);
    setStatus("Could not copy. Select the text and copy it manually.", "error");
  }
}

/** Update the character counter under the textarea. */
function updateCounter() {
  const length = el.input.value.length;
  const max = el.input.maxLength;
  el.charCount.textContent = length;
  el.counter.classList.toggle("is-limit", length >= max);
}

/* ---------- 7. Initialisation ---------- */

function init() {
  // Fill both dropdowns from the shared LANGUAGES list
  LANGUAGES.forEach(({ code, name }) => {
    el.source.add(new Option(name, code));
    el.target.add(new Option(name, code));
  });
  el.target.value = "en"; // sensible default target

  el.charMax.textContent = el.input.maxLength;

  el.input.addEventListener("input", updateCounter);
  el.translateBtn.addEventListener("click", translateText);
  el.clearBtn.addEventListener("click", clearAll);
  el.swapBtn.addEventListener("click", swapLanguages);
  el.copyBtn.addEventListener("click", copyTranslation);

  // Ctrl/Cmd + Enter submits from the textarea
  el.input.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") translateText();
  });

  updateCounter();
}

document.addEventListener("DOMContentLoaded", init);
