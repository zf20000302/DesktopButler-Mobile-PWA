(() => {
  "use strict";

  let generation = 0;
  let cachedVoice = null;
  let player = {
    status: "idle",
    chunks: [],
    nextIndex: 0,
    currentIndex: -1,
    replayIndex: 0,
  };

  function toastSafe(message) {
    try {
      if (typeof window.toast === "function") window.toast(message);
    } catch (_) {}
  }

  function pickVoice() {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    const preferred = [
      "Google US English",
      "Microsoft Aria Online (Natural) - English (United States)",
      "Microsoft Aria - English (United States)",
      "Samantha",
    ];
    for (const name of preferred) {
      const v = voices.find(x => x.name === name);
      if (v) return v;
    }
    return voices.find(v => /^en-US$/i.test(v.lang)) ||
           voices.find(v => /^en-/i.test(v.lang)) || null;
  }

  function splitLong(text, maxLen) {
    const out = [];
    let rest = text.trim();
    while (rest.length > maxLen) {
      let cut = rest.lastIndexOf(" ", maxLen);
      if (cut < Math.floor(maxLen * 0.55)) cut = maxLen;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
    return out;
  }

  function splitText(text, maxLen = 190) {
    const cleaned = String(text || "")
      .replace(/\r/g, " ")
      .replace(/\n+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return [];

    const sentences = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleaned];
    const chunks = [];
    let current = "";

    for (const raw of sentences) {
      const sentence = raw.trim();
      if (!sentence) continue;
      if (sentence.length > maxLen) {
        if (current) chunks.push(current.trim());
        current = "";
        chunks.push(...splitLong(sentence, maxLen));
        continue;
      }
      const candidate = current ? `${current} ${sentence}` : sentence;
      if (candidate.length <= maxLen) current = candidate;
      else {
        if (current) chunks.push(current.trim());
        current = sentence;
      }
    }
    if (current) chunks.push(current.trim());
    return chunks.filter(Boolean);
  }

  function hardCancel() {
    try {
      if (window.speechSynthesis?.paused) window.speechSynthesis.resume();
      window.speechSynthesis?.cancel();
    } catch (_) {}
  }

  function resetPlayer() {
    player = {status:"idle", chunks:[], nextIndex:0, currentIndex:-1, replayIndex:0};
  }

  function stateDetail() {
    const total = player.chunks.length;
    let index = 0;
    if (total) {
      if (player.status === "paused") index = Math.min(player.replayIndex + 1, total);
      else if (player.currentIndex >= 0) index = player.currentIndex + 1;
      else index = Math.min(player.nextIndex + 1, total);
    }
    return {status: player.status, index, total};
  }

  function updateControls() {
    const s = stateDetail();
    try {
      document.querySelectorAll(".speech-pause-btn").forEach(btn => {
        btn.disabled = s.status === "idle";
        btn.textContent = s.status === "paused" ? "▶ 繼續" : "⏸ 暫停";
      });
      document.querySelectorAll(".speech-status").forEach(el => {
        if (s.status === "playing") {
          el.textContent = s.total > 1 ? `播放中 · ${s.index}/${s.total} 段` : "播放中";
        } else if (s.status === "paused") {
          el.textContent = s.total > 1 ? `已暫停 · ${s.index}/${s.total} 段` : "已暫停";
        } else {
          el.textContent = "尚未播放";
        }
      });
      window.dispatchEvent(new CustomEvent("desktopbutler:speechstate", {detail:s}));
    } catch (_) {}
  }

  function speakNext(myGeneration) {
    if (myGeneration !== generation || player.status !== "playing") return;
    if (player.nextIndex >= player.chunks.length) {
      resetPlayer();
      updateControls();
      return;
    }

    const idx = player.nextIndex;
    player.currentIndex = idx;
    player.nextIndex = idx + 1;

    const u = new SpeechSynthesisUtterance(player.chunks[idx]);
    u.lang = "en-US";
    u.rate = 0.92;
    u.pitch = 1;
    u.volume = 1;
    const voice = pickVoice() || cachedVoice;
    if (voice) {
      u.voice = voice;
      cachedVoice = voice;
    }

    u.onstart = () => {
      if (myGeneration === generation) updateControls();
    };
    u.onend = () => {
      if (myGeneration !== generation || player.status !== "playing") return;
      player.currentIndex = -1;
      updateControls();
      setTimeout(() => speakNext(myGeneration), 55);
    };
    u.onerror = e => {
      if (myGeneration !== generation || e?.error === "canceled" || e?.error === "interrupted") return;
      resetPlayer();
      updateControls();
      toastSafe("語音播放失敗，請再按一次");
    };

    try { window.speechSynthesis.speak(u); }
    catch (_) {
      resetPlayer();
      updateControls();
      toastSafe("語音播放失敗，請再按一次");
    }
  }

  window.stopSpeech = function(options = {}) {
    generation += 1;
    hardCancel();
    resetPlayer();
    updateControls();
    if (!options.silent) toastSafe("已停止播放");
  };

  window.pauseSpeech = function() {
    if (player.status !== "playing") return;
    player.replayIndex = player.currentIndex >= 0
      ? player.currentIndex
      : Math.min(player.nextIndex, Math.max(0, player.chunks.length - 1));
    generation += 1;
    hardCancel();
    player.status = "paused";
    player.currentIndex = -1;
    player.nextIndex = player.replayIndex;
    updateControls();
  };

  window.resumeSpeech = function() {
    if (player.status !== "paused" || !player.chunks.length) return;
    generation += 1;
    const g = generation;
    player.status = "playing";
    player.currentIndex = -1;
    updateControls();
    setTimeout(() => speakNext(g), 80);
  };

  window.toggleSpeechPause = function() {
    if (player.status === "playing") window.pauseSpeech();
    else if (player.status === "paused") window.resumeSpeech();
  };

  window.getSpeechState = () => ({...stateDetail(), nextIndex:player.nextIndex});

  window.speak = function(text) {
    if (!text) return;
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      toastSafe("這個瀏覽器不支援語音播放");
      return;
    }

    generation += 1;
    const g = generation;
    hardCancel();
    const chunks = splitText(text);
    if (!chunks.length) {
      resetPlayer();
      updateControls();
      return;
    }

    player = {status:"playing", chunks, nextIndex:0, currentIndex:-1, replayIndex:0};
    cachedVoice = pickVoice() || cachedVoice;
    updateControls();
    toastSafe(chunks.length > 1 ? `開始播放文章（${chunks.length} 段）` : "開始播放");
    setTimeout(() => speakNext(g), 80);
  };

  function stopForNavigation() {
    try { window.stopSpeech({silent:true}); } catch (_) {}
  }

  function wrapStopBefore(name) {
    try {
      const original = window[name];
      if (typeof original !== "function" || original.__dbAudioWrapped) return;
      const wrapped = function(...args) {
        stopForNavigation();
        return original.apply(this, args);
      };
      wrapped.__dbAudioWrapped = true;
      window[name] = wrapped;
    } catch (_) {}
  }

  [
    "route", "leaveSession", "finishForRating", "commitRating",
    "realStartSentences", "realNextSentence", "startSession",
    "renderSessionDone", "logout", "resetProgress"
  ].forEach(wrapStopBefore);

  function addListeningControls(body) {
    try {
      if (!body || body.querySelector(".db-listening-controls")) return;
      const card = body.querySelector(".card.big-center");
      if (!card) return;

      const row = document.createElement("div");
      row.className = "row wrap db-listening-controls";
      row.style.justifyContent = "center";
      row.style.marginTop = "10px";

      const pause = document.createElement("button");
      pause.className = "btn secondary speech-pause-btn";
      pause.textContent = "⏸ 暫停";
      pause.disabled = true;
      pause.addEventListener("click", () => window.toggleSpeechPause());

      const stop = document.createElement("button");
      stop.className = "btn secondary";
      stop.textContent = "■ 停止";
      stop.addEventListener("click", () => window.stopSpeech());

      const status = document.createElement("div");
      status.className = "tiny muted speech-status";
      status.style.marginTop = "8px";
      status.textContent = "尚未播放";

      row.appendChild(pause);
      row.appendChild(stop);
      card.appendChild(row);
      card.appendChild(status);
      updateControls();
    } catch (_) {}
  }

  try {
    const r1 = window.renderListening;
    if (typeof r1 === "function") {
      window.renderListening = function(...args) {
        const result = r1.apply(this, args);
        addListeningControls(args[0]);
        return result;
      };
    }
    const r2 = window.renderListeningSentence;
    if (typeof r2 === "function") {
      window.renderListeningSentence = function(...args) {
        const result = r2.apply(this, args);
        addListeningControls(args[0]);
        return result;
      };
    }
  } catch (_) {}

  window.addEventListener("hashchange", stopForNavigation);
  window.addEventListener("pagehide", stopForNavigation);
  window.addEventListener("beforeunload", stopForNavigation);

  try {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", () => {
      cachedVoice = pickVoice() || cachedVoice;
    });
  } catch (_) {}

  updateControls();
})();
