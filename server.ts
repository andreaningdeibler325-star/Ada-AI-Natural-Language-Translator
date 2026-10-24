import express from "express";
import cors from "cors";
import { openai } from "./openai-client";
import { toFile } from "openai";

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "Ada's AI Natural Language Translator backend is running."
  });
});


app.post("/api/translate", async (req, res) => {
  try {
    const {
      text,
      sourceLanguage,
      targetLanguage,
      tone
    } = req.body;

    const response = await openai.responses.create({
      model: "gpt-6-luna",
      input: `
Translate the following text.

Source language: ${sourceLanguage === "yue" ? "Cantonese (廣東話)" : sourceLanguage}
Target language: ${targetLanguage === "yue" ? "Cantonese (colloquial written Cantonese in Traditional Chinese)" : targetLanguage}
Tone: ${tone}

Text:
${text}

Return only the translated text.
      `
    });

    res.json({
      success: true,
      detectedLanguage: sourceLanguage,
      targetLanguage: targetLanguage,
      translation: response.output_text.trim()
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Translation failed."
    });
  }
});

/* ---------- V2: voice-to-text (record -> OpenAI -> editable text) ----------
   A raw media request avoids adding a multipart dependency. In production,
   restrict CORS, authenticate callers and add rate limits. */
const AUDIO_FORMATS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};
const ALLOWED_SPEECH_LANGUAGES = new Set([
  "auto", "en", "zh", "yue", "de", "fr", "es", "it", "pt", "ja", "ko", "ar", "hi", "ru"
]);

app.post(
  "/api/transcribe",
  express.raw({ type: () => true, limit: "12mb" }),
  async (req, res) => {
    const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const extension = AUDIO_FORMATS[contentType];
    if (!extension || !Buffer.isBuffer(req.body) || !req.body.length) {
      res.status(415).json({ success: false, message: "Unsupported or empty audio. Please record again." });
      return;
    }
    const language = typeof req.query.language === "string" ? req.query.language : "auto";
    if (!ALLOWED_SPEECH_LANGUAGES.has(language)) {
      res.status(400).json({ success: false, message: "Unsupported source language." });
      return;
    }
    try {
      // Prompt guides orthography; it cannot guarantee dialect accuracy.
      const prompt = language === "yue"
        ? "This is spoken Cantonese (廣東話). Transcribe what is spoken in Traditional Chinese, preserving Cantonese words, grammar, and colloquial characters such as 佢, 喺, 冇, and 嘅. Do not rewrite into Mandarin or translate."
        : language === "hi"
          ? "This is spoken Hindi. Transcribe faithfully in Devanagari. Do not translate."
          : language === "zh"
            ? "This is spoken Mandarin Chinese. Transcribe faithfully in Chinese. Do not translate."
            : "Transcribe the spoken words faithfully in the original language. Do not translate.";
      const transcript = await openai.audio.transcriptions.create({
        file: await toFile(req.body as Buffer, `nlt-recording.${extension}`, { type: contentType }),
        model: "gpt-4o-transcribe",
        prompt,
        // Audio API accepts ISO-639-1 languages. Cantonese is separately
        // hinted via prompt; 'yue' is NOT sent as language=.
        ...(language !== "auto" && language !== "yue" ? { language } : {}),
      });
      res.json({ success: true, text: transcript.text });
    } catch (error) {
      console.error("Audio transcription failed:", error);
      res.status(502).json({ success: false, message: "Speech transcription service failed. Please retry." });
    }
  }
);

// Report oversize audio as JSON rather than an HTML error page.
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error?.type === "entity.too.large") {
    res.status(413).json({ success: false, message: "Audio is too large. Record a shorter clip." });
    return;
  }
  console.error("Request parsing error:", error);
  res.status(400).json({ success: false, message: "Invalid request body." });
});

app.listen(PORT, () => {
  console.log(
    `Ada's AI Natural Language Translator backend is running at http://localhost:${PORT}`
  );
});