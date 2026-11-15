# StemLab · Audio Source Separation

A static, browser-only HTDemucs audio source separator. It separates music into four WAV stems:

- Drums
- Bass
- Other instruments
- Vocals

## Run

No build step and no backend are required. Serve this folder over HTTPS or localhost:

\`\`\`bash
python -m http.server 8080
\`\`\`

Open http://localhost:8080.

You can also deploy the repository as a static site on Vercel or another HTTPS static host. The included \`vercel.json\` enables cross-origin isolation headers so browsers that support it can use multi-threaded WebAssembly.

## How it works

- Model: \`htdemucs_fp16weights.onnx\` from the open-source StemSplit demucs-onnx model exports.
- Runtime: ONNX Runtime Web (WASM).
- Inference: entirely in the browser. The audio file is never uploaded.
- The ONNX model is downloaded from Hugging Face on first use (about 166 MB) and can then be cached by the browser.
- Audio is decoded/resampled by the browser AudioContext to 44.1 kHz, then processed in overlapping 7.8-second chunks.

## Notes

- The browser needs enough memory for the model, decoded audio, and four output tracks. Shorter tracks are easier on phones.
- Audio format support depends on the browser's built-in decoder. WAV and MP3 are the safest choices.
- Output tracks are 16-bit stereo WAV.
- The first model download requires an internet connection. After that, the browser may reuse its cached copy.
- The project does not include a backend, API key, analytics, or audio upload endpoint.

## Credits

- HTDemucs / Demucs model family: Meta Research.
- ONNX browser export and runtime integration: [StemSplit/demucs-onnx](https://github.com/StemSplit/demucs-onnx).
