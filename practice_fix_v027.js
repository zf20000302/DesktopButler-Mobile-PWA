(() => {
  "use strict";

  function normalizePracticeState() {
    const base = (typeof initialState === "function") ? initialState() : {
      version:2, updatedAt:new Date().toISOString(), memory:{}, cycles:{},
      today:{date:(new Date()).toISOString().slice(0,10), completed:{}},
      stats:{totalSeconds:0, byModule:{}}, settings:{reviewRatio:0.4, commuteMinutes:10}
    };
    const x = (typeof state !== "undefined" && state && typeof state === "object") ? state : {};
    x.memory = (x.memory && typeof x.memory === "object") ? x.memory : {};
    x.cycles = (x.cycles && typeof x.cycles === "object") ? x.cycles : {};
    x.today = (x.today && typeof x.today === "object") ? x.today : {date:base.today.date, completed:{}};
    x.today.date = x.today.date || base.today.date;
    x.today.completed = (x.today.completed && typeof x.today.completed === "object") ? x.today.completed : {};
    x.stats = (x.stats && typeof x.stats === "object") ? x.stats : {totalSeconds:0, byModule:{}};
    x.stats.totalSeconds = Number.isFinite(Number(x.stats.totalSeconds)) ? Number(x.stats.totalSeconds) : 0;
    x.stats.byModule = (x.stats.byModule && typeof x.stats.byModule === "object") ? x.stats.byModule : {};
    x.settings = {...base.settings, ...((x.settings && typeof x.settings === "object") ? x.settings : {})};
    if (typeof state !== "undefined") state = x;
    return x;
  }

  try { normalizePracticeState(); } catch (_) {}

  window.pickMixed = function(module, count) {
    normalizePracticeState();
    const items = moduleItems(module);
    if (!items.length) return [];
    const c = cycleFor(module);
    const seenSet = new Set(c.seen || []);
    const due = items.filter(x => isDue(module, itemId(x)));
    const dueIds = new Set(due.map(itemId));
    const unseen = items.filter(x => !seenSet.has(itemId(x)) && !dueIds.has(itemId(x)));
    const old = items.filter(x => seenSet.has(itemId(x)) && !dueIds.has(itemId(x)));

    due.sort((a,b) => (memFor(module)[itemId(a)]?.nextReview || "").localeCompare(memFor(module)[itemId(b)]?.nextReview || ""));
    unseen.sort(() => Math.random() - .5);
    old.sort((a,b) => (memFor(module)[itemId(a)]?.lastReviewed || "").localeCompare(memFor(module)[itemId(b)]?.lastReviewed || ""));

    const reviewSlots = Math.min(due.length, Math.round(count * (state.settings.reviewRatio || .4)));
    const chosen = [];
    const chosenIds = new Set();
    const addUnique = x => {
      if (!x) return;
      const id = itemId(x);
      if (chosenIds.has(id)) return;
      chosenIds.add(id);
      chosen.push(x);
    };

    unseen.slice(0, Math.max(0, count - reviewSlots)).forEach(addUnique);
    due.slice(0, reviewSlots).forEach(addUnique);
    if (chosen.length < count) {
      for (const x of [...due.slice(reviewSlots), ...unseen, ...old]) {
        addUnique(x);
        if (chosen.length >= count) break;
      }
    }

    const d = chosen.filter(x => isDue(module, itemId(x)));
    const n = chosen.filter(x => !isDue(module, itemId(x)));
    const result = [];
    while (n.length || d.length) {
      if (n.length) result.push(n.shift());
      if (n.length && result.length % 3 !== 0) result.push(n.shift());
      if (d.length) result.push(d.shift());
    }
    return result.slice(0, count);
  };

  const originalMarkComplete = window.markComplete;
  window.markComplete = function(...args) {
    normalizePracticeState();
    return originalMarkComplete.apply(this, args);
  };

  window.finishForRating = function() {
    clearInterval(runtime.timer);
    try { window.stopSpeech?.({silent:true}); } catch (_) {}
    const step = currentStep();
    if (!step) return;
    const sec = secondsElapsed();
    runtime.ratingBusy = false;
    const body = document.querySelector("#practice-body");
    if (!body) return;
    body.innerHTML = `<section class="card">
      <div class="big-center">
        <div class="tiny muted">本題用時</div><div class="metric" style="margin:7px">${fmtTime(sec)}</div>
        <h2>這題現在記得多熟？</h2>
        <div id="rating-feedback" class="tiny muted" style="min-height:18px;margin-top:6px">選擇後會立即記錄並前往下一題</div>
      </div>
      <div class="rating-grid">
        <button data-rating class="btn danger" onclick="commitRating('hard',${sec})">😣 不熟 · 明天再出現</button>
        <button data-rating class="btn warn" onclick="commitRating('normal',${sec})">🙂 普通 · 正常間隔</button>
        <button data-rating class="btn good" onclick="commitRating('easy',${sec})">✓ 熟悉 · 拉長間隔</button>
      </div>
    </section>`;
  };

  window.commitRating = function(rating, sec) {
    if (runtime.ratingBusy) return;
    const step = currentStep();
    if (!step) {
      toast("這題已經完成");
      return;
    }
    runtime.ratingBusy = true;
    try { window.stopSpeech?.({silent:true}); } catch (_) {}

    const labels = {hard:"不熟", normal:"普通", easy:"熟悉"};
    document.querySelectorAll("[data-rating]").forEach(btn => btn.disabled = true);
    const feedback = document.querySelector("#rating-feedback");
    if (feedback) feedback.textContent = `已記錄「${labels[rating] || rating}」，載入下一題…`;

    try {
      normalizePracticeState();
      markComplete(step.module, step.item, rating, sec, {sameDayOnly:!!step.sameDay});
      runtime.index += 1;
      setTimeout(() => {
        runtime.ratingBusy = false;
        renderCurrentItem();
        try { window.scrollTo({top:0, behavior:"smooth"}); } catch (_) {}
      }, 90);
    } catch (err) {
      runtime.ratingBusy = false;
      document.querySelectorAll("[data-rating]").forEach(btn => btn.disabled = false);
      if (feedback) feedback.textContent = "記錄失敗，請再按一次";
      toast("記錄失敗：" + (err?.message || "未知錯誤"));
    }
  };
})();
