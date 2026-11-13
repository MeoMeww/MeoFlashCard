/* MeoCards — Chế độ học & trò chơi (hộp "Select Study Mode")
 * Phụ thuộc app.js (window.MeoCards). Route: #/set/:id/mode/:name
 */
(() => {
  "use strict";
  const M = window.MeoCards;
  const { Store, plainText, clozeTexts, esc, shuffle, toast, lsGet, lsSet, now, openDialog, usable, markUsed, $, $$ } = M;

  /* ===================== Tiện ích ===================== */
  const DAY = 86400000;
  const termText = (c) => plainText(c.term);
  const answerOf = (c) => {
    if (c.mc) { const ok = c.choices.filter((x) => x.correct && plainText(x.html)); return ok.map((x) => plainText(x.html)).join(" / "); }
    return plainText(c.definition) || clozeTexts(c.term).join(", ");
  };
  const answerHtml = (c) => {
    if (c.mc) return c.choices.filter((x) => x.correct && plainText(x.html)).map((x) => "✓ " + M.renderRich(x.html)).join("<br>");
    return M.renderRich(c.definition) || `<span class="cloze-reveal">${esc(clozeTexts(c.term).join(", "))}</span>`;
  };
  const promptHtml = (c) => M.renderRich(c.term, "hide");
  const norm = (s) => String(s || "").toLowerCase().normalize("NFC").replace(/[‘’“”]/g, "'").replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();
  const base = (ch) => ch.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
  const isLetter = (ch) => /\p{L}/u.test(ch);
  const sameAnswer = (input, expected) => {
    const a = norm(input);
    if (!a) return false;
    const alts = String(expected).split(/\s*[\/;|]\s*|\s*,\s*/).map(norm).filter(Boolean);
    return a === norm(expected) || alts.includes(a);
  };
  const hasAnswer = (c) => !!answerOf(c);
  const mark = (set, c, ok) => Store.setProgress(set.id, c.id, ok ? "know" : "learning");
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  /* ===================== Study focus (bộ lọc) ===================== */
  const FOCUS = [
    { id: "all", label: "All cards", fn: () => true },
    { id: "hard", label: "Struggling / Hard", fn: (c, p) => p[c.id]?.s === "learning" },
    { id: "new", label: "New / Unseen", fn: (c, p) => !p[c.id] },
    { id: "recent", label: "Recent (7d)", fn: (c, p, set) => (c.createdAt || set.createdAt || 0) > now() - 7 * DAY },
  ];
  const getFocus = () => lsGet("mc-focus", "all");
  const focusFilter = (set, id = getFocus()) => {
    const f = FOCUS.find((x) => x.id === id) || FOCUS[0];
    const p = Store.progress(set.id);
    return (c) => f.fn(c, p, set);
  };
  const focusCards = (set, id) => set.cards.filter(usable).filter(focusFilter(set, id));

  /* ===================== Danh sách chế độ ===================== */
  const STUDY = [
    { id: "flashcards", icon: "🗂", name: "Flashcards", desc: "Lật thẻ cổ điển, đánh dấu đã thuộc / chưa thuộc." },
    { id: "mc", icon: "☑", name: "Multiple Choice", desc: "Trả lời trắc nghiệm để kiểm tra nhanh." },
    { id: "writing", icon: "✎", name: "Writing", desc: "Gõ câu trả lời để nhớ lâu hơn." },
    { id: "match", icon: "☰", name: "Match List", desc: "Ghép thuật ngữ với định nghĩa trong danh sách." },
    { id: "drawing", icon: "🖌", name: "Drawing", desc: "Vẽ câu trả lời — hợp với kanji, hangul, tiếng Ả Rập, công thức." },
    { id: "audio", icon: "🎧", name: "Audio Review", desc: "Nghe thuật ngữ rồi mở đáp án — luyện không cần nhìn." },
    { id: "custom", icon: "📋", name: "Custom Quiz", desc: "Tự tạo bài kiểm tra với hẹn giờ và nhiều dạng câu hỏi." },
  ];
  const GAME = [
    { id: "salad", icon: "A", name: "Word Salad", desc: "Sắp xếp lại các chữ cái bị xáo trộn thành thuật ngữ đúng." },
    { id: "hangman", icon: "⌨", name: "Hangman", desc: "Đoán từng chữ cái của thuật ngữ trước khi hết mạng." },
    { id: "ring", icon: "🔤", name: "Alphabet Ring", desc: "Đoán thuật ngữ theo chữ cái đầu và gợi ý." },
    { id: "attack", icon: "⏱", name: "Time Attack", desc: "Đua với đồng hồ: ghép càng nhiều thuật ngữ – định nghĩa càng tốt." },
  ];
  const ALL = [...STUDY, ...GAME];

  /* ===================== Zen mode ===================== */
  const zenOn = () => !!lsGet("mc-zen", false);
  function applyZen(on) {
    lsSet("mc-zen", on);
    document.body.classList.toggle("zen", on);
    try {
      if (on && !document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
      if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    } catch {}
  }

  /* ===================== Hộp chọn chế độ ===================== */
  function openModeDialog(set) {
    let tab = lsGet("mc-mode-tab", "study");
    let focus = getFocus();
    const list = (arr) => arr.map((m) => `<button class="mode-row" value="mode:${m.id}">
        <span class="mode-ico">${m.icon}</span>
        <span class="mode-txt"><b>${m.name}</b><small>${m.desc}</small></span>
        <span class="mode-arrow">›</span></button>`).join("");
    openDialog(
      `<div class="mode-dialog">
        <div class="row" style="justify-content:space-between"><h2>Select Study Mode</h2><button class="btn small" value="cancel" type="submit">✕</button></div>
        <label class="zen-row"><span>⛶ Zen mode</span><span class="switch"><input type="checkbox" name="zen" ${zenOn() ? "checked" : ""}><span class="slider"></span></span></label>
        <div class="seg seg-wide" id="modeTabs">
          <button type="button" data-t="study" class="${tab === "study" ? "on" : ""}">Study Modes</button>
          <button type="button" data-t="game" class="${tab === "game" ? "on" : ""}">Game Modes</button>
        </div>
        <div class="focus-box">
          <div class="row" style="justify-content:space-between"><b>Study focus</b><span class="chip" id="focusCount"></span></div>
          <div class="row" id="focusChips">${FOCUS.map((f) => `<button type="button" class="focus-chip ${f.id === focus ? "on" : ""}" data-f="${f.id}">${f.label}${f.id === focus ? " ✓" : ""}</button>`).join("")}</div>
        </div>
        <div class="mode-list" id="modeList"></div>
      </div>`,
      (form, action) => {
        if (!action || !action.startsWith("mode:")) return false;
        applyZen(form.zen.checked);
        lsSet("mc-focus", focus);
        lsSet("mc-mode-tab", tab);
        const id = action.slice(5);
        if (!focusCards(set, focus).length) { toast("Không có thẻ nào khớp bộ lọc Study focus"); return false; }
        location.hash = `#/set/${set.id}/mode/${id}`;
      }
    );
    const form = $("#dialogForm");
    $("#dialog").classList.add("tall");
    $("#dialog").addEventListener("close", () => $("#dialog").classList.remove("tall"), { once: true });
    const drawList = () => { $("#modeList", form).innerHTML = list(tab === "study" ? STUDY : GAME); };
    const drawCount = () => { const n = focusCards(set, focus).length; $("#focusCount", form).textContent = `${n} ${n === 1 ? "card" : "cards"}`; };
    $("#modeTabs", form).onclick = (e) => {
      const b = e.target.closest("button[data-t]"); if (!b) return;
      tab = b.dataset.t; $$("#modeTabs button", form).forEach((x) => x.classList.toggle("on", x === b)); drawList();
    };
    $("#focusChips", form).onclick = (e) => {
      const b = e.target.closest("button[data-f]"); if (!b) return;
      focus = b.dataset.f;
      $$("#focusChips button", form).forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.textContent = FOCUS.find((f) => f.id === x.dataset.f).label + (on ? " ✓" : ""); });
      drawCount();
    };
    drawList(); drawCount();
  }
  // Mọi nút có data-modes="<setId>" đều mở hộp chọn chế độ
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-modes]");
    if (!b) return;
    e.preventDefault();
    const set = Store.get(b.dataset.modes);
    if (set) openModeDialog(set);
  });

  /* ===================== Khung chung cho một chế độ ===================== */
  function open(app, set, id) {
    const mode = ALL.find((m) => m.id === id);
    if (!mode) { location.hash = "#/"; return; }
    document.body.classList.toggle("zen", zenOn());
    const filter = focusFilter(set);
    if (id === "flashcards") return M.viewStudy(app, set, filter);
    if (id === "mc") return M.viewQuiz(app, set, null, filter);
    markUsed(set);
    app.classList.add("mode-wide");
    const cards = shuffle(set.cards.filter(usable).filter(filter));
    app.innerHTML = `
      <div class="mode-head">
        <a class="back-btn" href="#/" title="Về thư viện">←</a>
        <div class="mode-head-title"><div class="mode-name">${mode.icon} ${mode.name}</div><div class="mode-set">${esc(set.title || "(Chưa đặt tên)")}</div></div>
        <div class="mode-head-right">
          <div class="mode-progress"><div id="barText">${cards.length} cards</div><div class="progress"><div id="bar"></div></div></div>
          <a class="icon-btn" href="#/set/${set.id}/edit" title="Sửa bộ thẻ">✎</a>
          ${zenOn() ? `<button class="icon-btn" id="btnZenOff" title="Thoát Zen mode">⛶</button>` : ""}
          <button class="icon-btn" data-modes="${set.id}" title="Đổi chế độ">⚙</button>
        </div>
      </div>
      <div id="stage"></div>`;
    if ($("#btnZenOff")) $("#btnZenOff").onclick = () => { applyZen(false); open(app, set, id); };
    const ctx = {
      set, cards, mode, app,
      stage: $("#stage"),
      bar: (i, n) => { const b = $("#bar"), t = $("#barText"); if (b) b.style.width = (n ? (i / n) * 100 : 0) + "%"; if (t) t.textContent = n ? `${Math.min(i + 1, n)} / ${n} cards` : ""; },
      mark: (c, ok) => mark(set, c, ok),
      restart: () => open(app, set, id),
      timers: [],
      after(fn, ms) { const t = setTimeout(fn, ms); this.timers.push(t); return t; },
      every(fn, ms) { const t = setInterval(fn, ms); this.timers.push(t); return t; },
      onKey: null,
    };
    const keyHandler = (e) => {
      if (!ctx.onKey) return;
      // chặn hành vi mặc định của Enter (bấm nút đang focus) để không "nhảy 2 bước" trong cùng một lần bấm
      if (e.key === "Enter" && !(e.shiftKey && e.target.closest("textarea"))) e.preventDefault();
      ctx.onKey(e);
    };
    document.addEventListener("keydown", keyHandler);
    M.setCleanup(() => {
      document.removeEventListener("keydown", keyHandler);
      ctx.timers.forEach(clearInterval);
      if (window.speechSynthesis) speechSynthesis.cancel();
    });
    if (!cards.length) { empty(ctx, "Không có thẻ nào khớp bộ lọc Study focus."); return; }
    MODES[id](ctx);
  }
  function empty(ctx, msg) {
    ctx.stage.innerHTML = `<div class="empty"><div class="big">🧩</div><p>${esc(msg)}</p>
      <div class="row" style="justify-content:center"><button class="btn primary" data-modes="${ctx.set.id}">Chọn chế độ khác</button><a class="btn" href="#/set/${ctx.set.id}/edit">Sửa bộ thẻ</a></div></div>`;
  }
  function result(ctx, { score, total, label = "câu đúng", extra = "", wrong = [] }) {
    ctx.bar(1, 1);
    ctx.onKey = null;
    ctx.stage.innerHTML = `<div class="result-box"><div class="score">${total ? pct(score, total) + "%" : score}</div>
      <p>${total ? `${score}/${total} ${label}` : label}</p>${extra}
      <div class="row" style="justify-content:center">
        <button class="btn primary" id="again">Chơi lại</button>
        <button class="btn" data-modes="${ctx.set.id}">Chế độ khác</button>
        <a class="btn" href="#/">Thư viện</a></div></div>`;
    $("#again").onclick = ctx.restart;
    if (wrong.length) {
      const el = document.createElement("div");
      el.className = "wrong-list";
      el.innerHTML = `<div class="field-label" style="margin:14px 0 6px">Cần ôn lại (${wrong.length})</div>` +
        wrong.map((c) => `<div class="wrong-item"><div class="rich">${M.renderRich(c.term)}</div><div class="rich muted">${answerHtml(c)}</div></div>`).join("");
      $(".result-box").append(el);
    }
  }
  // Bảng "đáp án" + nút tiếp — dùng chung
  const feedback = (ok, c, note = "") => {
    setTimeout(() => fillIPA(c), 0);
    return `<div class="fb ${ok ? "ok" : "bad"}">
      <b>${ok ? "✓ Chính xác!" : "✗ Chưa đúng"}</b> ${note}
      <div class="rich" style="margin-top:6px">${answerHtml(c)}</div>
      <div class="ipa" id="ipaBox"></div>
      <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn primary" id="nextBtn">Tiếp → <small>(Enter)</small></button></div></div>`;
  };

  /* ===================== Phiên âm (IPA) — Free Dictionary API, có cache ===================== */
  const IPA_CACHE_KEY = "mc-ipa-cache";
  const ipaCache = lsGet(IPA_CACHE_KEY, {});
  const saveIpaCache = () => { const keys = Object.keys(ipaCache); if (keys.length > 2000) keys.slice(0, 500).forEach((k) => delete ipaCache[k]); lsSet(IPA_CACHE_KEY, ipaCache); };
  // Mặt nào của thẻ là tiếng Anh (chỉ chữ Latin không dấu) thì tra phiên âm mặt đó, ưu tiên mặt đáp án
  const englishSide = (c) => {
    const isEn = (t) => /^[A-Za-z][A-Za-z' .-]{0,60}$/.test(t) && !/\s(và|là|của|một|những|sự)\s/i.test(t);
    const a = answerOf(c).split(/\s*\/\s*/)[0].trim(), t = termText(c).trim();
    return isEn(a) ? a : isEn(t) ? t : "";
  };
  async function lookupWord(w) {
    const key = w.toLowerCase();
    if (ipaCache[key] !== undefined) return ipaCache[key];
    let res = null;
    try {
      const r = await fetch("https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(key));
      if (r.ok) {
        const j = await r.json();
        const ph = (j[0]?.phonetics || []);
        const text = (ph.find((p) => p.text && p.audio) || ph.find((p) => p.text) || {}).text || j[0]?.phonetic || "";
        const audio = (ph.find((p) => p.audio) || {}).audio || "";
        res = { text, audio };
      } else if (r.status === 404) res = { text: "", audio: "" };
    } catch { return null; } // lỗi mạng: không cache
    if (res) { ipaCache[key] = res; saveIpaCache(); }
    return res;
  }
  // Từ điển thường không có phiên âm cho dạng số nhiều / chia động từ → thử dạng gốc
  const baseForms = (w) => {
    const out = [];
    const l = w.toLowerCase();
    if (/ies$/.test(l)) out.push(l.replace(/ies$/, "y"));
    if (/(ches|shes|xes|sses|zes)$/.test(l)) out.push(l.replace(/es$/, ""));
    if (/es$/.test(l)) out.push(l.replace(/es$/, "e"), l.replace(/es$/, ""));
    if (/s$/.test(l) && !/ss$/.test(l)) out.push(l.replace(/s$/, ""));
    if (/ing$/.test(l)) out.push(l.replace(/ing$/, ""), l.replace(/ing$/, "e"));
    if (/ed$/.test(l)) out.push(l.replace(/ed$/, ""), l.replace(/d$/, ""));
    return [...new Set(out)].filter((x) => x.length >= 3 && x !== l);
  };
  async function lookupWithBase(w) {
    const r = await lookupWord(w);
    if (r && r.text) return r;
    for (const b of baseForms(w)) {
      const rb = await lookupWord(b);
      if (rb && rb.text) return { text: rb.text, audio: rb.audio, note: `(gốc: ${b})` };
    }
    return r;
  }
  async function getIPA(phrase) {
    const words = phrase.split(/\s+/).filter(Boolean);
    if (words.length === 1) return lookupWithBase(phrase);
    const whole = await lookupWord(phrase);
    if (whole && whole.text) return whole;
    if (words.length > 5) return whole;
    const parts = await Promise.all(words.map(lookupWithBase));
    if (parts.some((p) => !p || !p.text)) return whole;
    return { text: "/" + parts.map((p) => p.text.replace(/^\/|\/$/g, "")).join(" ") + "/", audio: "", note: parts.some((p) => p.note) ? "(ghép từng từ)" : "" };
  }
  async function fillIPA(c) {
    const box = document.getElementById("ipaBox");
    if (!box) return;
    const word = englishSide(c);
    if (!word) return;
    box.innerHTML = `<span class="muted" style="font-size:14px">đang tra phiên âm…</span>`;
    const r = await getIPA(word);
    const el = document.getElementById("ipaBox");
    if (!el || el !== box) return;
    // không có phiên âm → vẫn cho nút nghe (giọng máy)
    box.innerHTML = `<span class="ipa-word">${esc(word)}</span> ${r && r.text ? `<span class="ipa-text">${esc(r.text)}</span>` : ""} ${r && r.note ? `<span class="muted" style="font-size:13px">${esc(r.note)}</span>` : ""} <button type="button" class="btn small" id="ipaPlay" title="Nghe phát âm">🔊 Nghe</button>`;
    document.getElementById("ipaPlay").onclick = () => {
      if (r && r.audio) { new Audio(r.audio).play().catch(() => speakEn(word)); } else speakEn(word);
    };
  }
  const speakEn = (t) => { if (!window.speechSynthesis) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = "en-US"; u.rate = 0.9; speechSynthesis.speak(u); };
  const bindNext = (ctx, fn) => { $("#nextBtn").onclick = fn; $("#nextBtn").focus(); ctx.onKey = (e) => { if (e.key === "Enter") { e.preventDefault(); fn(); } }; };

  /* ===================== Các dạng câu hỏi (dùng lại trong Writing & Custom Quiz) ===================== */
  // Mỗi hàm render 1 câu vào `el`, trả Promise<boolean> đúng/sai. opts.timeLimit (giây, 0 = không)
  function withTimer(ctx, el, seconds, onExpire) {
    if (!seconds) return () => {};
    let left = seconds;
    const t = document.createElement("div");
    t.className = "qtimer";
    el.prepend(t);
    const draw = () => { t.textContent = `⏱ ${left}s`; t.classList.toggle("warn", left <= 5); };
    draw();
    const iv = ctx.every(() => { left--; draw(); if (left <= 0) { clearInterval(iv); onExpire(); } }, 1000);
    return () => clearInterval(iv);
  }
  // Khung 2 cột kiểu Flashcards World: trái = thẻ câu hỏi, phải = phần trả lời
  const twoCol = (c, side, label = "Question · Term") => `<div class="w2 quiz-q">
      <div class="w2-card"><div class="w2-label">${label}</div><div class="prompt rich">${promptHtml(c)}</div></div>
      <div class="w2-side">${side}<div id="after"></div></div></div>`;
  function qWriting(ctx, el, c, opts = {}) {
    return new Promise((resolve) => {
      el.innerHTML = twoCol(c, `<div class="w2-title">Your answer:</div>
        <textarea class="text w2-input" id="ans" rows="3" placeholder="Type your answer here..." autocomplete="off"></textarea>
        <button class="btn primary w2-submit" id="chk">Submit →</button>
        <button class="btn w2-giveup" id="giveup">Không biết — hiện đáp án</button>
        <div class="hint">Enter để kiểm tra · Shift + Enter xuống dòng</div>`);
      const inp = $("#ans", el); inp.focus();
      let done = false;
      const finish = (ok, note) => {
        if (done) return; done = true; stop();
        inp.disabled = true; $("#chk", el).disabled = true; $("#giveup", el).disabled = true;
        $("#after", el).innerHTML = feedback(ok, c, note);
        bindNext(ctx, () => resolve(ok));
      };
      const stop = withTimer(ctx, $(".w2-side", el), opts.timeLimit, () => finish(false, "(hết giờ)"));
      $("#chk", el).onclick = () => finish(sameAnswer(inp.value, answerOf(c)), inp.value.trim() ? `Bạn trả lời: <i>${esc(inp.value.trim())}</i>` : "");
      $("#giveup", el).onclick = () => finish(false);
      ctx.onKey = (e) => { if (e.key === "Enter" && !e.shiftKey && !done) { e.preventDefault(); $("#chk", el).click(); } };
    });
  }
  function mcOptions(ctx, c) {
    if (c.mc) {
      const opts = c.choices.filter((x) => plainText(x.html));
      return opts.length >= 2 && opts.some((x) => x.correct) ? shuffle(opts.map((x) => ({ html: M.renderRich(x.html), correct: x.correct }))) : null;
    }
    const ans = answerOf(c);
    if (!ans) return null;
    const seen = new Set([norm(ans)]);
    const d = [];
    for (const o of shuffle(ctx.set.cards.filter(usable))) {
      if (o === c || o.mc) continue;
      const a = answerOf(o); const k = norm(a);
      if (!k || seen.has(k)) continue;
      seen.add(k); d.push({ html: answerHtml(o), correct: false });
      if (d.length >= 3) break;
    }
    if (!d.length) return null;
    return shuffle([{ html: answerHtml(c), correct: true }, ...d]);
  }
  function qMC(ctx, el, c, opts = {}) {
    return new Promise((resolve) => {
      const options = opts.options || mcOptions(ctx, c);
      if (!options) return qWriting(ctx, el, c, opts).then(resolve);
      el.innerHTML = twoCol(c, `<div class="w2-title">Chọn đáp án đúng:</div>
        <div class="quiz-options">${options.map((o, k) => `<button class="quiz-opt rich" data-k="${k}"><b>${k + 1}.</b> ${o.html}</button>`).join("")}</div>`);
      let done = false;
      const finish = (k, note) => {
        if (done) return; done = true; stop();
        const ok = k >= 0 && options[k].correct;
        $$(".quiz-opt", el).forEach((b, j) => { b.disabled = true; if (options[j].correct) b.classList.add("correct"); else if (j === k) b.classList.add("wrong"); });
        $("#after", el).innerHTML = feedback(ok, c, note);
        bindNext(ctx, () => resolve(ok));
      };
      const stop = withTimer(ctx, $(".w2-side", el), opts.timeLimit, () => finish(-1, "(hết giờ)"));
      $$(".quiz-opt", el).forEach((b) => (b.onclick = () => finish(+b.dataset.k)));
      ctx.onKey = (e) => { const n = parseInt(e.key, 10); if (!done && n >= 1 && n <= options.length) finish(n - 1); };
    });
  }
  function qTrueFalse(ctx, el, c, opts = {}) {
    return new Promise((resolve) => {
      const pool = ctx.set.cards.filter((o) => o !== c && usable(o) && hasAnswer(o) && norm(answerOf(o)) !== norm(answerOf(c)));
      const truth = !pool.length || Math.random() < 0.5;
      const shown = truth ? c : pool[Math.floor(Math.random() * pool.length)];
      el.innerHTML = twoCol(c, `<div class="w2-title">Đúng hay sai?</div>
        <div class="tf-def rich">= ${answerHtml(shown)}</div>
        <div class="row" style="margin-top:14px"><button class="btn primary" id="tfT" style="flex:1;justify-content:center">✓ Đúng <small>(1)</small></button><button class="btn" id="tfF" style="flex:1;justify-content:center">✗ Sai <small>(2)</small></button></div>`);
      let done = false;
      const finish = (ans, note) => {
        if (done) return; done = true; stop();
        const ok = ans === truth;
        $("#tfT", el).disabled = $("#tfF", el).disabled = true;
        $("#after", el).innerHTML = feedback(ok, c, note || (truth ? "" : "Định nghĩa đó thuộc thẻ khác."));
        bindNext(ctx, () => resolve(ok));
      };
      const stop = withTimer(ctx, $(".w2-side", el), opts.timeLimit, () => finish(null, "(hết giờ)"));
      $("#tfT", el).onclick = () => finish(true);
      $("#tfF", el).onclick = () => finish(false);
      ctx.onKey = (e) => { if (done) return; if (e.key === "1") finish(true); if (e.key === "2") finish(false); };
    });
  }

  // Chạy tuần tự một danh sách câu hỏi [{card, type}] rồi hiện kết quả
  async function runQuestions(ctx, list, opts = {}) {
    let score = 0; const wrong = [];
    for (let i = 0; i < list.length; i++) {
      ctx.bar(i, list.length);
      const { card, type } = list[i];
      const el = document.createElement("div");
      ctx.stage.innerHTML = "";
      ctx.stage.append(el);
      const fn = type === "mc" ? qMC : type === "tf" ? qTrueFalse : qWriting;
      const ok = await fn(ctx, el, card, opts);
      if (!ctx.stage.isConnected) return; // người dùng đã rời trang
      ctx.mark(card, ok);
      if (ok) score++; else wrong.push(card);
    }
    result(ctx, { score, total: list.length, wrong });
  }

  /* ===================== MODES ===================== */
  const MODES = {};

  // --- Writing ---
  MODES.writing = (ctx) => {
    ctx.stage.classList.add("big-q");
    const list = ctx.cards.filter(hasAnswer).map((card) => ({ card, type: "writing" }));
    if (!list.length) return empty(ctx, "Thẻ cần có Definition (hoặc ô trống [...]) để luyện viết.");
    runQuestions(ctx, list);
  };

  // --- Custom Quiz ---
  MODES.custom = (ctx) => {
    ctx.stage.classList.add("big-q");
    const pool = ctx.cards.filter(hasAnswer);
    if (pool.length < 1) return empty(ctx, "Cần thẻ có Definition để tạo bài kiểm tra.");
    const prev = lsGet("mc-custom", { n: 10, t: 0, mc: true, w: true, tf: true });
    openDialog(
      `<h2>📋 Custom Quiz</h2>
      <label class="field-label">Số câu hỏi (tối đa ${pool.length})</label>
      <input class="text" type="number" name="n" min="1" max="${pool.length}" value="${Math.min(prev.n, pool.length)}">
      <label class="field-label">Thời gian mỗi câu (giây, 0 = không giới hạn)</label>
      <input class="text" type="number" name="t" min="0" max="300" value="${prev.t}">
      <label class="field-label">Dạng câu hỏi</label>
      <label class="row"><input type="checkbox" name="mc" ${prev.mc ? "checked" : ""}> Trắc nghiệm</label>
      <label class="row"><input type="checkbox" name="w" ${prev.w ? "checked" : ""}> Gõ câu trả lời</label>
      <label class="row"><input type="checkbox" name="tf" ${prev.tf ? "checked" : ""}> Đúng / Sai</label>
      <div class="actions"><button class="btn" value="cancel">Huỷ</button><button class="btn primary" value="ok">Bắt đầu</button></div>`,
      (form) => {
        const types = ["mc", "w", "tf"].filter((k) => form[k].checked);
        if (!types.length) { toast("Chọn ít nhất một dạng câu hỏi"); return false; }
        const cfg = { n: Math.max(1, Math.min(pool.length, +form.n.value || 10)), t: Math.max(0, +form.t.value || 0), mc: form.mc.checked, w: form.w.checked, tf: form.tf.checked };
        lsSet("mc-custom", cfg);
        const map = { mc: "mc", w: "writing", tf: "tf" };
        const list = shuffle(pool).slice(0, cfg.n).map((card) => ({ card, type: map[types[Math.floor(Math.random() * types.length)]] }));
        runQuestions(ctx, list, { timeLimit: cfg.t });
      }
    ).then((v) => { if (!v) location.hash = `#/set/${ctx.set.id}/edit`; });
  };

  // --- Match List ---
  MODES.match = (ctx) => {
    const cards = ctx.cards.filter(hasAnswer);
    if (cards.length < 2) return empty(ctx, "Cần ít nhất 2 thẻ có Definition.");
    const ROUND = 6;
    let i = 0, mistakes = 0, matched = 0;
    const t0 = now();
    const wrongSet = new Set();
    const round = () => {
      const group = cards.slice(i, i + ROUND);
      if (!group.length) {
        const secs = Math.round((now() - t0) / 1000);
        return result(ctx, { score: cards.length - wrongSet.size, total: cards.length, label: "cặp ghép đúng ngay lần đầu", extra: `<p class="muted">⏱ ${secs}s · ${mistakes} lần nhầm</p>`, wrong: cards.filter((c) => wrongSet.has(c.id)) });
      }
      ctx.bar(i, cards.length);
      const left = shuffle(group), right = shuffle(group);
      ctx.stage.innerHTML = `<div class="muted" style="font-size:13px;margin-bottom:8px">Ghép ${group.length} cặp · ${i + group.length}/${cards.length}</div>
        <div class="match-grid">
          <div class="match-col">${left.map((c) => `<button class="match-item rich" data-side="t" data-id="${c.id}">${promptHtml(c)}</button>`).join("")}</div>
          <div class="match-col">${right.map((c) => `<button class="match-item rich" data-side="d" data-id="${c.id}">${answerHtml(c)}</button>`).join("")}</div>
        </div>`;
      let sel = null, doneIn = 0;
      ctx.stage.onclick = (e) => {
        const b = e.target.closest(".match-item"); if (!b || b.classList.contains("done")) return;
        if (sel && sel.dataset.side === b.dataset.side) { sel.classList.remove("sel"); sel = b; b.classList.add("sel"); return; }
        if (!sel) { sel = b; b.classList.add("sel"); return; }
        const a = sel; sel = null; a.classList.remove("sel");
        if (a.dataset.id === b.dataset.id) {
          a.classList.add("done"); b.classList.add("done");
          const c = group.find((x) => x.id === a.dataset.id); matched++; doneIn++;
          if (!wrongSet.has(c.id)) ctx.mark(c, true);
          if (doneIn === group.length) { i += group.length; ctx.after(round, 500); }
        } else {
          mistakes++;
          [a, b].forEach((x) => { x.classList.add("bad"); ctx.after(() => x.classList.remove("bad"), 500); });
          const c1 = group.find((x) => x.id === a.dataset.id), c2 = group.find((x) => x.id === b.dataset.id);
          [c1, c2].forEach((c) => { if (!wrongSet.has(c.id)) { wrongSet.add(c.id); ctx.mark(c, false); } });
        }
      };
    };
    round();
  };

  // --- Drawing ---
  MODES.drawing = (ctx) => {
    let i = 0, score = 0; const wrong = [];
    const show = () => {
      if (i >= ctx.cards.length) return result(ctx, { score, total: ctx.cards.length, label: "thẻ tự chấm đúng", wrong });
      const c = ctx.cards[i];
      ctx.bar(i, ctx.cards.length);
      ctx.stage.innerHTML = `<div class="quiz-q"><div class="muted" style="font-size:13px;margin-bottom:8px">Thẻ ${i + 1}/${ctx.cards.length} · Vẽ câu trả lời rồi so với đáp án</div>
        <div class="prompt rich">${promptHtml(c)}</div>
        <canvas id="pad" class="pad"></canvas>
        <div class="row" style="margin-top:10px"><button class="btn" id="clr">🧹 Xoá</button><span class="row" style="font-size:13px">Nét: <input type="range" id="pen" min="2" max="14" value="4"></span><button class="btn primary" id="reveal" style="margin-left:auto">Hiện đáp án</button></div>
        <div id="after"></div></div>`;
      const cv = $("#pad"), cx = cv.getContext("2d");
      const fit = () => { const r = cv.getBoundingClientRect(); cv.width = r.width * devicePixelRatio; cv.height = 280 * devicePixelRatio; cx.scale(devicePixelRatio, devicePixelRatio); cx.lineCap = "round"; cx.lineJoin = "round"; cx.strokeStyle = "#1f2430"; };
      fit();
      let drawing = false, last = null;
      const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      cv.onpointerdown = (e) => { drawing = true; last = pos(e); cv.setPointerCapture(e.pointerId); };
      cv.onpointermove = (e) => { if (!drawing) return; const p = pos(e); cx.lineWidth = +$("#pen").value; cx.beginPath(); cx.moveTo(last.x, last.y); cx.lineTo(p.x, p.y); cx.stroke(); last = p; };
      cv.onpointerup = cv.onpointercancel = () => { drawing = false; };
      $("#clr").onclick = () => cx.clearRect(0, 0, cv.width, cv.height);
      $("#reveal").onclick = () => {
        $("#reveal").disabled = true;
        $("#after").innerHTML = `<div class="fb ok" style="margin-top:12px"><b>Đáp án</b><div class="rich" style="font-size:22px;margin-top:6px">${answerHtml(c)}</div>
          <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn learning" id="no">✗ Tôi vẽ sai <small>(1)</small></button><button class="btn know" id="yes">✓ Tôi vẽ đúng <small>(2)</small></button></div></div>`;
        const grade = (ok) => { ctx.mark(c, ok); if (ok) score++; else wrong.push(c); i++; show(); };
        $("#yes").onclick = () => grade(true); $("#no").onclick = () => grade(false);
        ctx.onKey = (e) => { if (e.key === "2") grade(true); if (e.key === "1") grade(false); };
      };
      ctx.onKey = (e) => { if (e.key === "Enter") $("#reveal").click(); };
    };
    show();
  };

  // --- Audio Review ---
  MODES.audio = (ctx) => {
    if (!window.speechSynthesis) return empty(ctx, "Trình duyệt này không hỗ trợ đọc văn bản (Web Speech).");
    let i = 0, score = 0; const wrong = [];
    let lang = lsGet("mc-tts-lang", "en-US");
    const voices = () => speechSynthesis.getVoices();
    const langs = () => [...new Set(voices().map((v) => v.lang))].sort();
    const speak = (text) => {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      const v = voices().find((x) => x.lang === lang) || voices().find((x) => x.lang.startsWith(lang.split("-")[0]));
      if (v) u.voice = v;
      u.rate = 0.9;
      speechSynthesis.speak(u);
    };
    const show = () => {
      if (i >= ctx.cards.length) return result(ctx, { score, total: ctx.cards.length, label: "thẻ tự chấm đúng", wrong });
      const c = ctx.cards[i];
      ctx.bar(i, ctx.cards.length);
      const ls = langs();
      ctx.stage.innerHTML = `<div class="quiz-q" style="text-align:center">
        <div class="row" style="justify-content:space-between"><span class="muted" style="font-size:13px">Thẻ ${i + 1}/${ctx.cards.length}</span>
          <label class="row" style="font-size:13px">Giọng đọc <select class="text" id="lang" style="width:auto;padding:4px 8px">${(ls.length ? ls : [lang]).map((l) => `<option ${l === lang ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
        <div style="font-size:64px;margin:24px 0 10px">🎧</div>
        <button class="btn primary" id="play">🔊 Nghe lại <small>(Space)</small></button>
        <div class="muted" style="font-size:13px;margin:8px 0 16px">Nghe thuật ngữ, nhớ câu trả lời rồi mở đáp án.</div>
        <button class="btn" id="reveal">Hiện đáp án <small>(Enter)</small></button>
        <div id="after" style="text-align:left"></div></div>`;
      $("#lang").onchange = (e) => { lang = e.target.value; lsSet("mc-tts-lang", lang); speak(termText(c)); };
      $("#play").onclick = () => speak(termText(c));
      $("#reveal").onclick = () => {
        $("#reveal").disabled = true;
        $("#after").innerHTML = `<div class="fb ok" style="margin-top:12px"><div class="rich" style="font-size:20px"><b>${M.renderRich(c.term)}</b></div><div class="rich" style="font-size:20px;margin-top:6px">${answerHtml(c)}</div>
          <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn learning" id="no">✗ Chưa thuộc <small>(1)</small></button><button class="btn know" id="yes">✓ Đã thuộc <small>(2)</small></button></div></div>`;
        const grade = (ok) => { ctx.mark(c, ok); if (ok) score++; else wrong.push(c); i++; show(); };
        $("#yes").onclick = () => grade(true); $("#no").onclick = () => grade(false);
        ctx.onKey = (e) => { if (e.key === "2") grade(true); else if (e.key === "1") grade(false); else if (e.code === "Space") { e.preventDefault(); speak(termText(c)); } };
      };
      ctx.onKey = (e) => { if (e.key === "Enter") $("#reveal").click(); else if (e.code === "Space") { e.preventDefault(); speak(termText(c)); } };
      ctx.after(() => speak(termText(c)), 300);
    };
    if (!voices().length) speechSynthesis.onvoiceschanged = () => { if (i === 0) show(); };
    show();
  };

  // --- Word Salad ---
  MODES.salad = (ctx) => {
    const cards = ctx.cards.filter((c) => termText(c).replace(/[^\p{L}\p{N}]/gu, "").length >= 2);
    if (!cards.length) return empty(ctx, "Cần thẻ có Term là chữ (ít nhất 2 ký tự).");
    let i = 0, score = 0; const wrong = [];
    const show = () => {
      if (i >= cards.length) return result(ctx, { score, total: cards.length, wrong });
      const c = cards[i];
      ctx.bar(i, cards.length);
      const words = termText(c).split(/\s+/);
      const letters = shuffle(words.join("").split("").filter((ch) => /[\p{L}\p{N}]/u.test(ch)).map((ch, k) => ({ ch, k })));
      let picked = [];
      ctx.stage.innerHTML = `<div class="quiz-q"><div class="muted" style="font-size:13px;margin-bottom:8px">Câu ${i + 1}/${cards.length} · Sắp xếp các chữ cái thành thuật ngữ</div>
        <div class="muted rich" style="margin-bottom:10px">Gợi ý: ${answerHtml(c) || "<i>(không có)</i>"} <span class="chip">${words.map((w) => w.length).join(" + ")} chữ</span></div>
        <div class="salad-answer" id="sa"></div>
        <div class="salad-pool" id="sp"></div>
        <div class="row" style="margin-top:10px"><button class="btn" id="undo">⌫ Xoá <small>(Backspace)</small></button><button class="btn" id="clear">Xoá hết</button><button class="btn primary" id="chk" style="margin-left:auto">Kiểm tra <small>(Enter)</small></button><button class="btn" id="giveup">Bỏ qua</button></div>
        <div id="after"></div></div>`;
      const draw = () => {
        $("#sa").innerHTML = picked.map((p) => `<button class="tile on" data-k="${p.k}">${esc(p.ch)}</button>`).join("") || `<span class="muted">Bấm các chữ cái bên dưới…</span>`;
        $("#sp").innerHTML = letters.map((p) => `<button class="tile ${picked.includes(p) ? "used" : ""}" data-k="${p.k}" ${picked.includes(p) ? "disabled" : ""}>${esc(p.ch)}</button>`).join("");
      };
      draw();
      let done = false;
      $("#sp").onclick = (e) => { const b = e.target.closest(".tile"); if (!b || done) return; picked.push(letters.find((p) => p.k === +b.dataset.k)); draw(); };
      $("#sa").onclick = (e) => { const b = e.target.closest(".tile"); if (!b || done) return; picked = picked.filter((p) => p.k !== +b.dataset.k); draw(); };
      $("#undo").onclick = () => { picked.pop(); draw(); };
      $("#clear").onclick = () => { picked = []; draw(); };
      const finish = (ok) => {
        if (done) return; done = true;
        ctx.mark(c, ok); if (ok) score++; else wrong.push(c);
        $("#after").innerHTML = feedback(ok, c, `Thuật ngữ: <b>${esc(termText(c))}</b>`);
        bindNext(ctx, () => { i++; show(); });
      };
      $("#chk").onclick = () => finish(norm(picked.map((p) => p.ch).join("")) === norm(words.join("")));
      $("#giveup").onclick = () => finish(false);
      ctx.onKey = (e) => {
        if (done) return;
        if (e.key === "Enter") $("#chk").click();
        else if (e.key === "Backspace") { e.preventDefault(); $("#undo").click(); }
        else if (e.key.length === 1) { const p = letters.find((x) => !picked.includes(x) && base(x.ch) === base(e.key)); if (p) { picked.push(p); draw(); } }
      };
    };
    show();
  };

  // --- Hangman ---
  MODES.hangman = (ctx) => {
    const guessable = (ch) => /^[a-z]$/.test(base(ch));
    const cards = ctx.cards.filter((c) => [...termText(c)].some(guessable));
    if (!cards.length) return empty(ctx, "Cần thẻ có Term chứa chữ cái A–Z.");
    const KEYS = "abcdefghijklmnopqrstuvwxyz".split("");
    const LIVES = 6;
    const PARTS = ["😀", "😐", "😟", "😨", "😰", "😱", "💀"];
    let i = 0, score = 0; const wrong = [];
    const show = () => {
      if (i >= cards.length) return result(ctx, { score, total: cards.length, label: "từ đoán đúng", wrong });
      const c = cards[i];
      ctx.bar(i, cards.length);
      const word = termText(c);
      const guessed = new Set();
      let lives = LIVES, done = false;
      ctx.stage.innerHTML = `<div class="quiz-q" style="text-align:center"><div class="muted" style="font-size:13px;margin-bottom:8px;text-align:left">Từ ${i + 1}/${cards.length}</div>
        <div class="muted rich" style="text-align:left">Gợi ý: ${answerHtml(c) || "<i>(không có)</i>"}</div>
        <div class="hang-face" id="face"></div><div class="muted" id="lives"></div>
        <div class="hang-word" id="word"></div>
        <div class="keys" id="keys">${KEYS.map((k) => `<button class="key" data-k="${k}">${k.toUpperCase()}</button>`).join("")}</div>
        <div id="after" style="text-align:left"></div></div>`;
      const revealed = () => [...word].map((ch) => !guessable(ch) || guessed.has(base(ch)) ? ch : "_");
      const draw = () => {
        $("#word").innerHTML = revealed().map((ch) => `<span class="hw ${ch === " " ? "sp" : ""}">${ch === " " ? "" : esc(ch)}</span>`).join("");
        $("#face").textContent = PARTS[LIVES - lives];
        $("#lives").textContent = "❤".repeat(lives) + "♡".repeat(LIVES - lives);
        $$("#keys .key").forEach((b) => { const k = b.dataset.k; if (guessed.has(k)) { b.disabled = true; b.classList.add([...word].some((ch) => base(ch) === k) ? "hit" : "miss"); } });
      };
      const finish = (ok) => {
        done = true; ctx.mark(c, ok); if (ok) score++; else wrong.push(c);
        $$("#keys .key").forEach((b) => (b.disabled = true));
        $("#word").innerHTML = [...word].map((ch) => `<span class="hw ${ch === " " ? "sp" : ""}">${ch === " " ? "" : esc(ch)}</span>`).join("");
        $("#after").innerHTML = feedback(ok, c, ok ? `Còn ${lives} mạng` : "Hết mạng rồi!");
        bindNext(ctx, () => { i++; show(); });
      };
      const guess = (k) => {
        if (done || guessed.has(k) || !KEYS.includes(k)) return;
        guessed.add(k);
        if (![...word].some((ch) => base(ch) === k)) lives--;
        draw();
        if (!revealed().includes("_")) finish(true);
        else if (lives <= 0) finish(false);
      };
      $("#keys").onclick = (e) => { const b = e.target.closest(".key"); if (b) guess(b.dataset.k); };
      ctx.onKey = (e) => { if (!done && e.key.length === 1) guess(base(e.key)); };
      draw();
    };
    show();
  };

  // --- Alphabet Ring ---
  MODES.ring = (ctx) => {
    const cards = ctx.cards.filter((c) => hasAnswer(c) && /[a-z]/.test(base(termText(c)[0] || "")));
    if (!cards.length) return empty(ctx, "Cần thẻ có Term bắt đầu bằng chữ cái (A–Z) và có Definition.");
    const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
    const byL = {};
    cards.forEach((c) => { const l = base(termText(c)[0]); (byL[l] ||= []).push(c); });
    const order = LETTERS.filter((l) => byL[l]);
    const state = {}; // l -> ok/bad
    let i = 0, score = 0; const wrong = [];
    const show = () => {
      if (i >= order.length) return result(ctx, { score, total: order.length, label: "chữ cái đúng", wrong });
      const l = order[i];
      const c = byL[l][Math.floor(Math.random() * byL[l].length)];
      ctx.bar(i, order.length);
      ctx.stage.innerHTML = `<div class="quiz-q">
        <div class="ring">${LETTERS.map((x) => `<span class="rl ${!byL[x] ? "none" : ""} ${state[x] || ""} ${x === l ? "cur" : ""}">${x.toUpperCase()}</span>`).join("")}</div>
        <div class="muted" style="font-size:13px;margin:12px 0 6px">Thuật ngữ bắt đầu bằng chữ <b style="font-size:18px">${l.toUpperCase()}</b> · ${termText(c).length} ký tự</div>
        <div class="prompt rich">${answerHtml(c)}</div>
        <div class="row"><input class="text" id="ans" placeholder="${l.toUpperCase()}…" autocomplete="off" style="flex:1"><button class="btn primary" id="chk">Kiểm tra</button><button class="btn" id="giveup">Bỏ qua</button></div>
        <div id="after"></div></div>`;
      const inp = $("#ans"); inp.focus();
      let done = false;
      const finish = (ok) => {
        if (done) return; done = true;
        state[l] = ok ? "ok" : "bad"; ctx.mark(c, ok); if (ok) score++; else wrong.push(c);
        inp.disabled = true;
        $("#after").innerHTML = feedback(ok, c, `Thuật ngữ: <b>${esc(termText(c))}</b>`);
        bindNext(ctx, () => { i++; show(); });
      };
      $("#chk").onclick = () => finish(norm(inp.value) === norm(termText(c)));
      $("#giveup").onclick = () => finish(false);
      ctx.onKey = (e) => { if (e.key === "Enter" && !done) { e.preventDefault(); $("#chk").click(); } };
    };
    show();
  };

  // --- Time Attack ---
  MODES.attack = (ctx) => {
    const cards = ctx.cards.filter(hasAnswer);
    if (cards.length < 2) return empty(ctx, "Cần ít nhất 2 thẻ có Definition.");
    const TOTAL = 60;
    let left = TOTAL, score = 0, asked = 0, streak = 0, best = 0;
    const wrongSet = new Set();
    let queue = shuffle(cards);
    ctx.stage.innerHTML = `<div class="attack-top"><span class="chip" id="score">Điểm 0</span><span class="chip" id="streak">🔥 0</span><span class="qtimer" id="clock">⏱ ${TOTAL}s</span></div><div id="q"></div>`;
    const end = () => {
      ctx.timers.forEach(clearInterval);
      result(ctx, { score: `${score}`, total: 0, label: `điểm · ${asked} câu · chuỗi tốt nhất ${best}`, extra: `<p class="muted">Đúng ${asked - wrongSet.size}/${asked}</p>`, wrong: cards.filter((c) => wrongSet.has(c.id)) });
    };
    ctx.every(() => { left--; const el = $("#clock"); if (!el) return; el.textContent = `⏱ ${left}s`; el.classList.toggle("warn", left <= 10); if (left <= 0) end(); }, 1000);
    let locked = false;
    const next = () => {
      if (!queue.length) queue = shuffle(cards);
      const c = queue.pop();
      const options = mcOptions(ctx, c) || [{ html: answerHtml(c), correct: true }];
      locked = false;
      $("#q").innerHTML = `<div class="quiz-q"><div class="prompt rich">${promptHtml(c)}</div>
        <div class="quiz-options">${options.map((o, k) => `<button class="quiz-opt rich" data-k="${k}"><b>${k + 1}.</b> ${o.html}</button>`).join("")}</div></div>`;
      const pick = (k) => {
        if (locked) return; locked = true; asked++;
        const ok = options[k].correct;
        $$(".quiz-opt").forEach((b, j) => { b.disabled = true; if (options[j].correct) b.classList.add("correct"); else if (j === k) b.classList.add("wrong"); });
        if (ok) { streak++; best = Math.max(best, streak); score += 10 + Math.min(streak - 1, 5) * 2; ctx.mark(c, true); }
        else { streak = 0; wrongSet.add(c.id); ctx.mark(c, false); }
        $("#score").textContent = "Điểm " + score; $("#streak").textContent = "🔥 " + streak;
        ctx.after(next, ok ? 350 : 900);
      };
      $$(".quiz-opt").forEach((b) => (b.onclick = () => pick(+b.dataset.k)));
      ctx.onKey = (e) => { const n = parseInt(e.key, 10); if (n >= 1 && n <= options.length) pick(n - 1); };
    };
    next();
  };

  window.MeoModes = { open, openModeDialog, STUDY, GAME, FOCUS, focusCards };
  document.body.classList.toggle("zen", zenOn());
})();
