# Static neural narration

The bundled recording reads only the original opening paragraph of **The Signal Room** in `public/data.js`. It is synthetic narration, not a human recording or Microsoft voice. No private library/cache material is used.

## Voice and generation

- Model: [Kokoro-82M v1.0](https://huggingface.co/hexgrad/Kokoro-82M), using the [ONNX conversion](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) at revision `1939ad2a8e416c0acfeecc08a694d14ef25f2231`.
- Voice: `am_michael`, the supplied American-English male voice. No user voice cloning or impersonation was performed.
- Generator: `kokoro-js` 1.2.1, FP32 CPU inference, speed 0.95. Generation occurred locally during development; neither input text nor recording was submitted to a speech service.
- Model SHA-256: `8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb`.
- Voice SHA-256: `1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1`.
- Original generated duration: 25.725 seconds at 24 kHz. Distribution: mono MP3, 96 kbit/s, 24 kHz, seek header, metadata removed, loudness-normalized with a -1.5 dB true-peak ceiling.
- Source asset: `public/assets/signal-room.mp3`, 309,645 bytes, SHA-256 `d70a277915e2a36294261bbfbcdd936c274e69f8a590ff0404f85de7e4e5d6ed`. The build gives it a content-addressed public filename.

## Redistribution basis and attribution

The upstream model card and ONNX conversion identify the model license as **Apache-2.0** and permit deployment of the model in real projects, including commercial applications. The generator is also Apache-2.0. The license notice is retained in [licenses/kokoro-Apache-2.0.txt](licenses/kokoro-Apache-2.0.txt). Only a generated recording of original text is distributed here, not the model weights, voice packs, generator, phonemizer, FFmpeg, or any private application code. The project's MIT notice does not relicense third-party software or models.

Upstream credits include StyleTTS 2 and iSTFTNet. The [model card's training-data notice](https://huggingface.co/hexgrad/Kokoro-82M#creative-commons-attribution) credits Koniwa (CC BY 3.0) and SIWIS (CC BY 4.0); those datasets are not bundled here. Model licensing is the basis for this offline-generation route, not an assertion of ownership over another person's voice or a blanket legal warranty.

Microsoft Edge Read Aloud recordings were not selected because clear public redistribution rights were not established. Microsoft's [Azure TTS product terms](https://www.microsoft.com/licensing/terms/en-US/productoffering/MicrosoftAzure/allprograms) state output-use rights for customers of the paid tier; no paid resource or service charge was authorized or used. The private application's Andrew Neural implementation is untouched.

## Review and timing limits

Independent local speech recognition recovered the complete generated passage; differences were punctuation, “20”/“twenty”, and “traveler”/“traveller”, not omitted narrative. Signal inspection found no clipped samples in the generated waveform. Browser acceptance separately verifies native playback, seeking, speed, pause/resume, reload recovery and sample boundaries.

The development session could not directly hear the artifact. These are transcription/signal/playback checks, not a claimed subjective listening review or guarantee that everyone will prefer this voice. The original full-length candidate was made available for listening during review.

No reliable engine word/phrase timestamps accompany this recording. Highlighting therefore identifies the recorded paragraph as a whole; precise word timings are not invented. Only this opening excerpt is recorded. Changing to a different chapter stops listening; an explicit control opens the recorded excerpt. Completion does not silently narrate another book/chapter. Reading and listening cursors remain separate browser-local state.

The earlier eSpeak recording remains in Git history as original demo content. It is not used in the current build and was not a production audiobook cache.
