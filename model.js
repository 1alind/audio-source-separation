(() => {
  "use strict";
  const MODEL_URL = "https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx";
  const DB_NAME = "stemlab-model-storage";
  const STORE_NAME = "models";
  const MODEL_KEY = "htdemucs-fp16-v1";
  const $ = (id) => document.getElementById(id);
  const button = $("download-button");
  let downloading = false;

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("This browser does not support IndexedDB."));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("Could not open browser storage."));
    });
  }
  async function getSaved() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(MODEL_KEY);
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror = () => { db.close(); reject(req.error || new Error("Could not check saved model.")); };
    });
  }
  async function save(bytes) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(bytes, MODEL_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error("Browser storage rejected the model.")); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error("Saving was interrupted. Check available browser storage.")); };
    });
  }
  function formatBytes(n) {
    return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : (n / 1024).toFixed(0) + " KB";
  }
  function progress(title, detail, percent) {
    $("progress-title").textContent = title;
    $("progress-detail").textContent = detail;
    $("progress-percent").textContent = Math.round(percent) + "%";
    $("progress-fill").style.width = Math.max(0, Math.min(100, percent)) + "%";
  }
  function setSaved() {
    $("state-dot").classList.add("good");
    $("state-title").textContent = "Model saved in this browser";
    $("state-subtitle").textContent = "HTDemucs is ready to use. No repeat download needed.";
    button.textContent = "✓ Model already saved";
    button.disabled = false;
  }
  function showError(err) {
    const message = err && err.message ? err.message : String(err);
    $("error-box").hidden = false;
    $("error-box").textContent = "Download/save failed: " + message + " Check your internet connection, then try again. If storage is full, free some browser storage space.";
    progress("Something went wrong", message, 0);
    button.textContent = "↻ Try again";
    button.disabled = false;
  }
  async function download() {
    if (downloading) return;
    downloading = true;
    button.disabled = true;
    $("error-box").hidden = true;
    try {
      const existing = await getSaved();
      if (existing) {
        setSaved();
        progress("Already saved", "Found the model in browser storage (" + formatBytes(existing.byteLength || existing.length || 0) + ").", 100);
        return;
      }
      progress("Connecting to model host", "Requesting the HTDemucs model from Hugging Face…", 1);
      const response = await fetch(MODEL_URL, {cache:"no-store"});
      if (!response.ok) throw new Error("Model host returned HTTP " + response.status + ".");
      if (!response.body || !response.body.getReader) throw new Error("This browser cannot stream the download, so progress cannot be displayed.");
      const total = Number(response.headers.get("content-length")) || 0;
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        chunks.push(part.value);
        received += part.value.byteLength;
        const pct = total ? Math.min(95, received / total * 95) : 0;
        progress("Downloading model", formatBytes(received) + (total ? " of " + formatBytes(total) : " downloaded"), pct);
      }
      if (!received) throw new Error("The model host returned an empty file.");
      progress("Preparing browser storage", "Download complete. Combining " + formatBytes(received) + " before saving…", 96);
      const combined = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
      progress("Saving model", "Writing " + formatBytes(received) + " into IndexedDB. Please keep this page open.", 98);
      await save(combined.buffer);
      setSaved();
      progress("Complete", formatBytes(received) + " saved successfully in this browser.", 100);
    } catch (err) {
      console.error("StemLab model storage:", err);
      showError(err);
    } finally {
      downloading = false;
    }
  }
  button.addEventListener("click", download);
  getSaved().then((saved) => {
    if (saved) {
      setSaved();
      progress("Already saved", "Found " + formatBytes(saved.byteLength || saved.length || 0) + " in browser storage.", 100);
    } else {
      $("state-title").textContent = "Model not saved yet";
      $("state-subtitle").textContent = "Download it once to keep it in this browser.";
      button.textContent = "↓ Download and save model";
      button.disabled = false;
      progress("Ready", "Press the button to begin downloading the approximately 166 MB model.", 0);
    }
  }).catch((err) => {
    $("state-title").textContent = "Browser storage unavailable";
    $("state-subtitle").textContent = err.message || String(err);
    button.textContent = "↓ Download and save model";
    button.disabled = false;
    progress("Storage check failed", "You can try the download, but saving may fail.", 0);
  });
})();