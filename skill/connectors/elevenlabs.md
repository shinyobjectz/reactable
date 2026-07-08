### ElevenLabs (voice generation)

---
source: https://elevenlabs.io/docs/api-reference/text-to-speech
fetched: 2026-07-07
auth: xi-api-key (server-injected)
---

List voices (find a voice_id):
```tool
{"name":"connector","args":{"provider":"elevenlabs","method":"GET","path":"/v1/voices","params":{}}}
```

Generate speech straight into assets (body is MP3 bytes):
```tool
{"name":"connector","args":{"provider":"elevenlabs","method":"POST","path":"/v1/text-to-speech/<voice_id>","params":{"text":"Welcome to the demo.","model_id":"eleven_multilingual_v2"},"save_to":"assets/vo-intro.mp3"}}
```
Local free alternative: `reactable tts speak --text "…" -o assets/vo.wav` (Kokoro, offline).
