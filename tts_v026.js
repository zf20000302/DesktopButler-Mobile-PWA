(() => {
  "use strict";

  const synth = window.speechSynthesis;
  const Utterance = window.SpeechSynthesisUtterance;
  let seq = 0;
  let voiceCache = null;
  let state = freshState();

  function freshState() {
    return {
      active: false,
      paused: false,
      chunks: [],
      index: 0,
      utterance: null,
      timer: null,
    };
  }

  function toastSafe(text) {
    try { if (typeof window.toast === "function") window.toast(text); } catch (_) {}
  }

  function chooseVoice() {
    try {
      const voices = synth?.getVoices?.() || [];
      const exact = [
        "Google US English",
        "Microsoft Aria Online (Natural) - English (United States)",
        "Microsoft Aria - English (United States)",
        "Samantha",
      ];
      for (const name of exact) {
        const v = voices.find(x => x.name === name);
        if (v) return v;
      }
      return voices.find(v => /^en-US$/i.test(v.lang)) ||
             voices.find(v => /^en-/i.test(v.lang)) || null;
    } catch (_) {
      return null;
    }
  }

  function normalizeText(text) {
    return String(text || "")
      .replace(/\r/g, " ")
      .replace(/\n+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function splitLong(part, maxLen) {
    const out = [];
    let rest = part.trim();
    while (rest.length > maxLen) {
      let cut = rest.lastIndexOf(" ", maxLen);
      if (cut < Math.floor(maxLen * 0.55)) cut = maxLen;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
    return out;
  }

  function splitText(text, maxLen = 175) {
    const cleaned = normalizeText(text);
    if (!cleaned) return [];
    const sentences = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleaned];
    const chunks = [];
    let current = "";

    for (const raw of sentences) {
      const sentence = raw.trim();
      if (!sentence) continue;
      if (sentence.length > maxLen) {
        if (current) chunks.push(current);
        current = "";
        chunks.push(...splitLong(sentence, maxLen));
        continue;
      }
      const combined = current ? `${current} ${sentence}` : sentence;
      if (combined.length <= maxLen) current = combined;
      else {
        if (current) chunks.push(current);
        current = sentence;
      }
    }
    if (current) chunks.push(current);
    return chunks.filter(Boolean);
  }

  function clearTimer() {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  function hardCancel() {
    try {
      if (synth?.paused) synth.resume();
      synth?.cancel();
    } catch (_) {}
  }

  function detail() {
    const total = state.chunks.length;
    const index = total ? Math.min(state.index + 1, total) : 0;
    return {
      status: !state.active ? "idle" : state.paused ? "paused" : "playing",
      index,
      total,
    };
  }

  function updateControls() {
    const d = detail();
    document.querySelectorAll(".db-speech-pause").forEach(btn => {
      btn.disabled = d.status === "idle";
      btn.textContent = d.status === "paused" ? "▶ 繼續" : "⏸ 暫停";
    });
    document.querySelectorAll(".db-speech-stop").forEach(btn => {
      btn.disabled = d.status === "idle";
    });
    document.querySelectorAll(".db-speech-status").forEach(el => {
      if (d.status === "playing") el.textContent = d.total > 1 ? `播放中 · ${d.index}/${d.total} 段` : "播放中";
      else if (d.status === "paused") el.textContent = d.total > 1 ? `已暫停 · ${d.index}/${d.total} 段` : "已暫停";
      else el.textContent = "尚未播放";
    });
    try { window.dispatchEvent(new CustomEvent("desktopbutler:speechstate", {detail:d})); } catch (_) {}
  }

  function scheduleChunk(token, delay = 45) {
    clearTimer();
    state.timer = setTimeout(() => playCurrentChunk(token), delay);
  }

  function playCurrentChunk(token) {
    state.timer = null;
    if (token !== seq || !state.active || state.paused) return;
    if (state.index >= state.chunks.length) {
      state = freshState();
      updateControls();
      return;
    }

    let u;
    try {
      u = new Utterance(state.chunks[state.index]);
    } catch (_) {
      toastSafe("語音引擎無法啟動");
      window.stopSpeech({silent:true});
      return;
    }

    state.utterance = u;
    u.lang = "en-US";
    u.rate = 0.92;
    u.pitch = 1;
    u.volume = 1;
    const v = chooseVoice() || voiceCache;
    if (v) {
      u.voice = v;
      voiceCache = v;
    }

    u.onstart = () => {
      if (token === seq && state.active && !state.paused) updateControls();
    };
    u.onend = () => {
      if (token !== seq || !state.active || state.paused) return;
      state.utterance = null;
      state.index += 1;
      updateControls();
      scheduleChunk(token, 55);
    };
    u.onerror = ev => {
      if (token !== seq) return;
      const e = ev?.error || "";
      if (e === "canceled" || e === "interrupted") return;
      toastSafe("語音播放失敗，請再按一次");
      window.stopSpeech({silent:true});
    };

    try {
      synth.speak(u);
    } catch (_) {
      toastSafe("語音播放失敗，請再按一次");
      window.stopSpeech({silent:true});
    }
  }

  window.stopSpeech = function stopSpeech(options = {}) {
    seq += 1;
    clearTimer();
    hardCancel();
    state = freshState();
    updateControls();
    if (!options.silent) toastSafe("已停止播放");
  };

  window.pauseSpeech = function pauseSpeech() {
    if (!state.active || state.paused) return;
    seq += 1;
    clearTimer();
    hardCancel();
    state.paused = true;
    state.utterance = null;
    updateControls();
  };

  window.resumeSpeech = function resumeSpeech() {
    if (!state.active || !state.paused || !state.chunks.length) return;
    seq += 1;
    const token = seq;
    state.paused = false;
    updateControls();
    scheduleChunk(token, 60);
  };

  window.toggleSpeechPause = function toggleSpeechPause() {
    if (state.active && state.paused) window.resumeSpeech();
    else if (state.active) window.pauseSpeech();
  };

  window.getSpeechState = () => ({...detail(), chunkIndex: state.index});

  window.speak = function speak(text) {
    if (!text) return;
    if (!synth || !Utterance) {
      toastSafe("這個瀏覽器不支援語音播放");
      return;
    }

    seq += 1;
    clearTimer();
    hardCancel();
    const chunks = splitText(text);
    if (!chunks.length) return;

    state = {
      active: true,
      paused: false,
      chunks,
      index: 0,
      utterance: null,
      timer: null,
    };
    voiceCache = chooseVoice() || voiceCache;
    updateControls();
    toastSafe(chunks.length > 1 ? `開始播放文章（${chunks.length} 段）` : "開始播放");
    const token = seq;
    scheduleChunk(token, 65);
  };

  function installControls() {
    let inserted = false;
    document.querySelectorAll("#practice-body .card.big-center").forEach(card => {
      if (card.querySelector(".db-speech-controls")) return;
      const playButton = [...card.querySelectorAll("button")].find(b => /播放(英文|句子|文章)?/.test(b.textContent || ""));
      if (!playButton) return;

      const row = document.createElement("div");
      row.className = "row wrap db-speech-controls";
      row.style.justifyContent = "center";
      row.style.marginTop = "10px";

      const pause = document.createElement("button");
      pause.type = "button";
      pause.className = "btn secondary db-speech-pause";
      pause.textContent = "⏸ 暫停";
      pause.disabled = true;
      pause.addEventListener("click", e => {
        e.preventDefault(); e.stopPropagation(); window.toggleSpeechPause();
      });

      const stop = document.createElement("button");
      stop.type = "button";
      stop.className = "btn secondary db-speech-stop";
      stop.textContent = "■ 停止";
      stop.disabled = true;
      stop.addEventListener("click", e => {
        e.preventDefault(); e.stopPropagation(); window.stopSpeech();
      });

      const status = document.createElement("div");
      status.className = "tiny muted db-speech-status";
      status.style.marginTop = "8px";
      status.textContent = "尚未播放";

      row.append(pause, stop);
      card.append(row, status);
      inserted = true;
    });
    if (inserted) updateControls();
  }

  function shouldStopForButton(btn) {
    if (!btn) return false;
    if (btn.classList.contains("db-speech-pause") || btn.classList.contains("db-speech-stop")) return false;
    if (/播放(英文|句子|文章)?/.test(btn.textContent || "")) return false;
    if (btn.dataset?.route) return true;
    const code = btn.getAttribute("onclick") || "";
    return /(leaveSession|finishForRating|commitRating|route\(|realStartSentences|realNextSentence|startSession|startModule|startCommute|startTodayReview|logout|resetProgress)/.test(code);
  }

  document.addEventListener("click", ev => {
    const btn = ev.target?.closest?.("button");
    if (shouldStopForButton(btn)) window.stopSpeech({silent:true});
  }, true);

  window.addEventListener("hashchange", () => window.stopSpeech({silent:true}));
  window.addEventListener("pagehide", () => window.stopSpeech({silent:true}));
  window.addEventListener("beforeunload", () => window.stopSpeech({silent:true}));

  const observer = new MutationObserver(() => installControls());
  const startObserver = () => {
    installControls();
    observer.observe(document.body, {childList:true, subtree:true});
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startObserver, {once:true});
  else startObserver();

  try {
    synth?.getVoices?.();
    synth?.addEventListener?.("voiceschanged", () => {
      voiceCache = chooseVoice() || voiceCache;
    });
  } catch (_) {}

  updateControls();
})();
