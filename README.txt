Ada’s AI Natural Language Translator — Start + Small Stop

Replace index.html, style.css, app.js and voice-input.js with these files in your frontend folder. Keep the backend unchanged.

Start Speaking: starts continuous recognition.
Small Stop: finishes recognition without translating, preserves transcribed text and focuses the text area for editing.
Translate: finishes recognition automatically if still active, then translates.
Clear: cancels recognition and clears text.

In Chrome, allow microphone access when prompted. The browser controls microphone permissions.
The frontend still connects to http://localhost:3001/api/translate so your Node server must be running.
