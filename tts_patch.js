(() => {
  let playToken = 0;
  let cachedVoice = null;

  function toastSafe(message) {
    try {
      if (typeof window.toast === "function") window.toast(message);
    } catch (_) {}
  }

  function pickVoice() {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    if (!voices.length) return null;

    const preferred = [
      "Google US English",
      "Microsoft Aria Online (Natural) - English (United States)",
      "Microsoft Aria - English (United States)",
      "Samantha",
    ];

    for (const name of preferred) {
      const voice = voices.find(v => v.name === name);
      if (voice) return voice;
    }

    return (
      voices.find(v => /^en-US$/i.test(v.lang)) ||
      voices.find(v => /^en-/i.test(v.lang)) ||
      null
    );
  }

  function splitLongPart(part, maxLen) {
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

  function splitText(text, maxLen = 220) {
    const cleaned = String(text || "")
      .replace(/\r/g, " ")
      .replace(/\n+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned) return [];

    const sentences = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleaned];
    const chunks = [];
    let current = "";

    for (const sentenceRaw of sentences) {
      const sentence = sentenceRaw.trim();
      if (!sentence) continue;

      if (sentence.length > maxLen) {
        if (current) {
          chunks.push(current.trim());
          current = "";
        }
        chunks.push(...splitLongPart(sentence, maxLen));
        continue;
      }

      const candidate = current ? `${current} ${sentence}` : sentence;
      if (candidate.length <= maxLen) {
        current = candidate;
      } else {
        if (current) chunks.push(current.trim());
        current = sentence;
      }
    }

    if (current) chunks.push(current.trim());
    return chunks.filter(Boolean);
  }

  window.stopSpeech = function stopSpeech() {
    playToken += 1;
    try {
      window.speechSynthesis.cancel();
    } catch (_) {}
  };

  window.speak = function speak(text) {
    if (!text) return;

    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      toastSafe("這個瀏覽器不支援語音播放");
      return;
    }

    playToken += 1;
    const myToken = playToken;
    const chunks = splitText(text);

    if (!chunks.length) return;

    try {
      window.speechSynthesis.cancel();
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    } catch (_) {}

    cachedVoice = pickVoice() || cachedVoice;
    let index = 0;
    toastSafe(chunks.length > 1 ? `開始播放文章（${chunks.length} 段）` : "開始播放");

    const speakNext = () => {
      if (myToken !== playToken || index >= chunks.length) return;

      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      index += 1;
      utterance.lang = "en-US";
      utterance.rate = 0.92;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      const voice = pickVoice() || cachedVoice;
      if (voice) {
        utterance.voice = voice;
        cachedVoice = voice;
      }

      utterance.onend = () => {
        if (myToken !== playToken) return;
        window.setTimeout(speakNext, 60);
      };

      utterance.onerror = event => {
        if (event?.error === "canceled" || myToken !== playToken) return;
        toastSafe("語音播放失敗，請再按一次");
      };

      try {
        window.speechSynthesis.speak(utterance);
      } catch (_) {
        toastSafe("語音播放失敗，請再按一次");
      }
    };

    // Android Chrome can report an empty voice list immediately after page load.
    // The default engine still works, but a short delay after cancel() is more reliable.
    window.setTimeout(speakNext, 80);
  };

  try {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", () => {
      cachedVoice = pickVoice() || cachedVoice;
    });
  } catch (_) {}
})();
