let ortRuntime = null;
const ORT_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ortRuntime.min.js";
let ortLoadPromise = null;

function loadOrtRuntime() {
  if (window.ort) return Promise.resolve(window.ort);
  if (ortLoadPromise) return ortLoadPromise;
  ortLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = ORT_URL;
    script.async = true;
    script.onload = () => window.ort
      ? resolve(window.ort)
      : reject(new Error("ONNX Runtime loaded but did not initialize."));
    script.onerror = () => reject(new Error("Could not load ONNX Runtime from jsDelivr. Check your connection or try another browser."));
    document.head.appendChild(script);
  });
  return ortLoadPromise;
}

const MODEL_URL = "https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx";
const MODEL_DB = "stemlab-model-storage";
const MODEL_STORE = "models";
const MODEL_KEY = "htdemucs-fp16-v1";
const SAMPLE_RATE = 44100;
const SEGMENT_SECONDS = 7.8;
const SEGMENT_SAMPLES = Math.round(SEGMENT_SECONDS * SAMPLE_RATE);
const CHANNELS = 2;
const OVERLAP = Math.floor(SEGMENT_SAMPLES / 4);
const STRIDE = SEGMENT_SAMPLES - OVERLAP;
const STEMS = [
  { key: "drums", name: "Drums", description: "Beats, percussion and rhythm", icon: "◉" },
  { key: "bass", name: "Bass", description: "Bass guitar and low frequencies", icon: "▰" },
  { key: "other", name: "Other instruments", description: "Guitars, keys and everything else", icon: "⌁" },
  { key: "vocals", name: "Vocals", description: "Lead and backing voices", icon: "♫" }
];

const $ = (id) => document.getElementById(id);
const fileInput = $("audio-file");
const dropZone = $("drop-zone");
const uploadContent = $("upload-content");
const selectedFile = $("selected-file");
const separateButton = $("separate-button");
const buttonLabel = $("button-label");
const progressPanel = $("progress-panel");
const progressTitle = $("progress-title");
const progressPercent = $("progress-percent");
const progressFill = $("progress-fill");
const progressDetail = $("progress-detail");
const errorBox = $("error-box");
const results = $("results");
const stemGrid = $("stem-grid");

let selectedAudioFile = null;
let decodedAudio = null;
let audioContext = null;
let session = null;
let resultUrls = [];

function openModelDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MODEL_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(MODEL_STORE)) {
        request.result.createObjectStore(MODEL_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open browser storage."));
  });
}

async function readSavedModel() {
  const db = await openModelDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(MODEL_STORE, "readonly").objectStore(MODEL_STORE).get(MODEL_KEY);
    request.onsuccess = () => { db.close(); resolve(request.result || null); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function saveModel(modelBytes) {
  const db = await openModelDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MODEL_STORE, "readwrite");
    transaction.objectStore(MODEL_STORE).put(modelBytes, MODEL_KEY);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error || new Error("Could not save model in browser storage.")); };
    transaction.onabort = () => { db.close(); reject(transaction.error || new Error("Saving the model was cancelled.")); };
  });
}

async function downloadAndStoreModel() {
  const response = await fetch(MODEL_URL);
  if (!response.ok) throw new Error("Model download failed (HTTP " + response.status + ").");
  const total = Number(response.headers.get("content-length")) || 0;
  let received = 0;
  const chunks = [];
  if (response.body && response.body.getReader) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      const percent = total ? Math.min(94, 4 + received / total * 90) : 0;
      setStatus("Downloading HTDemucs model", formatBytes(received) + (total ? " of " + formatBytes(total) : " downloaded"), percent);
    }
  } else {
    const buffer = await response.arrayBuffer();
    chunks.push(new Uint8Array(buffer));
    received = buffer.byteLength;
  }
  const combined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  const bytes = combined.buffer;
  await saveModel(bytes);
  return bytes;
}

async function getModelBytes() {
  const saved = await readSavedModel();
  if (saved) return saved;
  return downloadAndStoreModel();
}

async function downloadModelToBrowser() {
  const button = $("model-download-button");
  button.disabled = true;
  progressPanel.classList.remove("hidden");
  errorBox.classList.add("hidden");
  try {
    const saved = await readSavedModel();
    if (saved) {
      $("model-storage-status").textContent = "Saved in this browser";
      setStatus("Model already saved", "HTDemucs is stored in this browser. You can use it without downloading again.", 100);
      button.textContent = "✓ Model saved";
      return;
    }
    setStatus("Preparing model download", "The model will be stored in this browser's IndexedDB, not in your Downloads folder.", 2);
    await downloadAndStoreModel();
    setStatus("Model saved", "HTDemucs is now stored in this browser and ready to use.", 100);
  } catch (error) {
    showError("Could not save the model: " + (error.message || error) + " Check your connection and browser storage space.");
  } finally {
    button.disabled = false;
  }
}

function setStatus(title, detail, percent) {
  progressTitle.textContent = title;
  progressDetail.textContent = detail;
  progressPercent.textContent = Math.round(percent) + "%";
  progressFill.style.width = Math.max(0, Math.min(100, percent)) + "%";
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function clearResults() {
  resultUrls.forEach((url) => URL.revokeObjectURL(url));
  resultUrls = [];
  stemGrid.replaceChildren();
  results.classList.add("hidden");
}

function resetSelection() {
  selectedAudioFile = null;
  decodedAudio = null;
  fileInput.value = "";
  uploadContent.classList.remove("hidden");
  selectedFile.classList.add("hidden");
  separateButton.disabled = true;
  errorBox.classList.add("hidden");
  progressPanel.classList.add("hidden");
  clearResults();
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins + ":" + String(secs).padStart(2, "0");
}

async function loadAudio(file) {
  if (!file) return;
  if (!file.type.startsWith("audio/") && !/\.(mp3|wav|flac|m4a|ogg|aac)$/i.test(file.name)) {
    showError("Please choose an audio file (MP3, WAV, FLAC, M4A, OGG or AAC).");
    return;
  }
  clearResults();
  errorBox.classList.add("hidden");
  selectedAudioFile = file;
  uploadContent.classList.add("hidden");
  selectedFile.classList.remove("hidden");
  $("file-name").textContent = file.name;
  $("file-meta").textContent = formatBytes(file.size) + " · Decoding audio…";
  separateButton.disabled = true;
  try {
    if (audioContext) await audioContext.close().catch(() => {});
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const arrayBuffer = await file.arrayBuffer();
    decodedAudio = await audioContext.decodeAudioData(arrayBuffer);
    $("file-meta").textContent = formatDuration(decodedAudio.duration) + " · " + decodedAudio.numberOfChannels + " channel(s) · " + decodedAudio.sampleRate + " Hz";
    separateButton.disabled = false;
  } catch (error) {
    decodedAudio = null;
    showError("This browser could not decode that file. Try converting it to WAV or MP3. Details: " + (error.message || error));
  }
}

function makeWindow(length, overlap) {
  const window = new Float32Array(length).fill(1);
  for (let i = 0; i < overlap; i++) {
    const value = i / overlap;
    window[i] = value;
    window[length - 1 - i] = value;
  }
  return window;
}

function encodeWav(stereo, sampleRate) {
  const length = stereo[0].length;
  const buffer = new ArrayBuffer(44 + length * 4);
  const view = new DataView(buffer);
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + length * 4, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, length * 4, true);
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let channel = 0; channel < 2; channel++) {
      const value = Math.max(-1, Math.min(1, stereo[channel][i]));
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
      offset += 2;
    }
  }
  return buffer;
}

function makeStereoMix(audio) {
  const left = audio.getChannelData(0);
  const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : left;
  return [left, right];
}

async function runSeparation(mix) {
  const totalLength = mix[0].length;
  const chunkCount = Math.max(1, Math.ceil(totalLength / STRIDE));
  const outputs = STEMS.map(() => [new Float32Array(totalLength), new Float32Array(totalLength)]);
  const weights = new Float32Array(totalLength);
  const window = makeWindow(SEGMENT_SAMPLES, OVERLAP);
  const chunkBuffer = new Float32Array(CHANNELS * SEGMENT_SAMPLES);

  for (let chunk = 0; chunk < chunkCount; chunk++) {
    const start = chunk * STRIDE;
    const end = Math.min(start + SEGMENT_SAMPLES, totalLength);
    const chunkLength = end - start;
    chunkBuffer.fill(0);
    for (let channel = 0; channel < CHANNELS; channel++) {
      chunkBuffer.subarray(channel * SEGMENT_SAMPLES, channel * SEGMENT_SAMPLES + chunkLength)
        .set(mix[channel].subarray(start, end));
    }

    const tensor = new ortRuntime.Tensor("float32", chunkBuffer, [1, CHANNELS, SEGMENT_SAMPLES]);
    const result = await session.run({ mix: tensor });
    const data = result.stems.data;
    const rowSize = CHANNELS * SEGMENT_SAMPLES;

    for (let stemIndex = 0; stemIndex < STEMS.length; stemIndex++) {
      const stemOffset = stemIndex * rowSize;
      for (let channel = 0; channel < CHANNELS; channel++) {
        const channelOffset = stemOffset + channel * SEGMENT_SAMPLES;
        const output = outputs[stemIndex][channel];
        for (let sample = 0; sample < chunkLength; sample++) {
          output[start + sample] += data[channelOffset + sample] * window[sample];
        }
      }
    }
    for (let sample = 0; sample < chunkLength; sample++) {
      weights[start + sample] += window[sample];
    }

    const percent = 12 + ((chunk + 1) / chunkCount) * 78;
    setStatus("Separating audio", "Processing section " + (chunk + 1) + " of " + chunkCount + " · " + formatDuration(decodedAudio.duration) + " total", percent);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  for (const stereo of outputs) {
    for (let channel = 0; channel < CHANNELS; channel++) {
      const output = stereo[channel];
      for (let sample = 0; sample < totalLength; sample++) {
        output[sample] /= Math.max(weights[sample], 1e-8);
      }
    }
  }
  return outputs;
}

function renderResults(outputs) {
  clearResults();
  const baseName = (selectedAudioFile.name.replace(/\.[^.]+$/, "") || "audio").replace(/[^\w\-]+/g, "_");
  outputs.forEach((stereo, index) => {
    const stem = STEMS[index];
    const wav = encodeWav(stereo, SAMPLE_RATE);
    const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
    resultUrls.push(url);

    const card = document.createElement("article");
    card.className = "stem-card";
    const top = document.createElement("div");
    top.className = "stem-top";
    const icon = document.createElement("div");
    icon.className = "stem-icon";
    icon.textContent = stem.icon;
    const label = document.createElement("div");
    const name = document.createElement("div");
    name.className = "stem-name";
    name.textContent = stem.name;
    const description = document.createElement("div");
    description.className = "stem-desc";
    description.textContent = stem.description;
    label.append(name, description);
    top.append(icon, label);

    const player = document.createElement("audio");
    player.controls = true;
    player.preload = "none";
    player.src = url;

    const download = document.createElement("a");
    download.className = "download-link";
    download.href = url;
    download.download = baseName + "_" + stem.key + ".wav";
    download.textContent = "↓  Download WAV";

    card.append(top, player, download);
    stemGrid.append(card);
  });
  results.classList.remove("hidden");
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function separate() {
  if (!decodedAudio || !selectedAudioFile) return;
  separateButton.disabled = true;
  buttonLabel.textContent = "Separating…";
  progressPanel.classList.remove("hidden");
  errorBox.classList.add("hidden");
  clearResults();

  try {
    if (!ortRuntime) {
      setStatus("Loading AI engine", "Preparing the browser inference engine…", 1);
      ortRuntime = await loadOrtRuntime();
    }
    if (!session) {
      setStatus("Loading HTDemucs AI model", "Checking browser storage for the saved model…", 3);
      const modelBytes = await getModelBytes();
      ortRuntime.env.wasm.numThreads = Math.max(1, Math.min(navigator.hardwareConcurrency || 2, 4));
      session = await ortRuntime.InferenceSession.create(modelBytes, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all"
      });
    }

    setStatus("Preparing audio", "The model is ready. Preparing stereo audio at 44.1 kHz.", 10);
    const mix = makeStereoMix(decodedAudio);
    const outputs = await runSeparation(mix);
    setStatus("Creating WAV files", "Packaging the four separated tracks.", 96);
    renderResults(outputs);
    setStatus("Separation complete", "Your four stems are ready to preview and download.", 100);
  } catch (error) {
    console.error(error);
    showError("Separation failed: " + (error.message || String(error)) + " If this is a memory error, try a shorter audio file or close other tabs.");
  } finally {
    separateButton.disabled = false;
    buttonLabel.textContent = "Separate audio";
  }
}

dropZone.addEventListener("click", (event) => {
  if (event.target.closest("button, label, input")) return;
  if (!selectedAudioFile) fileInput.click();
});
fileInput.addEventListener("change", () => loadAudio(fileInput.files && fileInput.files[0]));
$("remove-file").addEventListener("click", resetSelection);
$("new-audio").addEventListener("click", () => {
  resetSelection();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
separateButton.addEventListener("click", separate);

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragover");
  });
});
["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragover");
  });
});
dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer && event.dataTransfer.files[0];
  if (file) loadAudio(file);
});
