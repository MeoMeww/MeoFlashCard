/* MeoCards — flashcard web app
 * - Dữ liệu lưu localStorage (dùng offline được) + đồng bộ lên Google Drive (appDataFolder)
 * - Không cần server: chạy tĩnh trên GitHub Pages
 */
(() => {
  "use strict";

  const CFG = Object.assign(
    { GOOGLE_CLIENT_ID: "", DRIVE_FILE_NAME: "flashcards-data.json", AUTO_SYNC_SECONDS: 60 },
    window.APP_CONFIG || {}
  );
  const SCOPES = "https://www.googleapis.com/auth/drive.appdata openid email profile";
  const LS = {
    clientId: "mc-client-id",
    token: "mc-token",
    user: "mc-user",
    data: (who) => "mc-data:" + (who || "guest"),
  };

  /* ===================== Utils ===================== */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const now = () => Date.now();
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const debounce = (fn, ms) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const fmtTime = (t) => {
    const d = new Date(t);
    return d.toLocaleDateString("vi-VN") + " " + d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  };
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
  }
  const lsGet = (k, d = null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn(e); } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch {} };

  /* ===================== HTML sanitize & render ===================== */
  const ALLOWED = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "DEL", "CODE", "PRE", "BR", "DIV", "P", "SPAN", "FONT", "MARK"]);
  const DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "IMG", "SVG", "MATH", "TEMPLATE"]);
  const safeColor = (v) => (/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i.test(v.trim()) ? v.trim() : "");

  function sanitize(html) {
    const doc = new DOMParser().parseFromString("<div>" + (html || "") + "</div>", "text/html");
    const root = doc.body.firstChild;
    (function walk(node) {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) continue;
        if (child.nodeType !== 1) { child.remove(); continue; }
        const tag = child.tagName;
        if (DROP.has(tag)) { child.remove(); continue; }
        walk(child);
        if (!ALLOWED.has(tag)) { child.replaceWith(...child.childNodes); continue; }
        // giữ lại thuộc tính an toàn
        const color = safeColor(child.style?.color || child.getAttribute("color") || "");
        const bg = safeColor(child.style?.backgroundColor || "");
        const isCloze = child.classList?.contains("cloze");
        for (const a of [...child.attributes]) child.removeAttribute(a.name);
        let el = child;
        if (tag === "FONT") {
          el = doc.createElement("span");
          el.append(...child.childNodes);
          child.replaceWith(el);
        }
        if (el.tagName === "SPAN" || el.tagName === "MARK") {
          if (isCloze) el.className = "cloze";
          if (color) el.style.color = color;
          if (bg) el.style.backgroundColor = bg;
        }
      }
    })(root);
    let out = root.innerHTML;
    if (/^(<br>|\s|&nbsp;)*$/.test(out)) out = "";
    return out;
  }

  function plainText(html) {
    const d = document.createElement("div");
    d.innerHTML = html || "";
    $$("br", d).forEach((b) => b.replaceWith("\n"));
    return (d.textContent || "").replace(/\u200b/g, "").trim();
  }
  function clozeTexts(html) {
    const d = document.createElement("div");
    d.innerHTML = html || "";
    return $$(".cloze", d).map((e) => e.textContent.trim()).filter(Boolean);
  }
  // mode: "hide" (ô trống), "reveal" (tô xanh), "plain"
  function renderRich(html, mode = "plain") {
    const d = document.createElement("div");
    d.innerHTML = sanitize(html);
    $$(".cloze", d).forEach((c) => {
      if (mode === "hide") {
        const b = document.createElement("span");
        b.className = "blank";
        b.textContent = c.textContent.replace(/./g, "_").slice(0, 14) || "____";
        c.replaceWith(b);
      } else if (mode === "reveal") {
        c.className = "cloze-reveal";
      } else {
        c.replaceWith(...c.childNodes);
      }
    });
    return d.innerHTML;
  }

  /* ===================== Store ===================== */
  // data = { version, sets: {id: Set}, progress: {setId: {cardId: {s:'know'|'learning', t}}} }
  // Set  = { id, title, description, cards: Card[], createdAt, updatedAt, deleted? }
  // Card = { id, term, definition, mc, choices: [{id, html, correct}], tags: [] }
  const emptyData = () => ({ version: 1, sets: {}, progress: {}, categories: {} });
  // Danh mục mặc định (người dùng có thể sửa/xoá/thêm)
  const DEFAULT_CATEGORIES = [
    { id: "cat-vocab", name: "Từ vựng", color: "#2563eb" },
    { id: "cat-grammar", name: "Ngữ pháp", color: "#7c3aed" },
    { id: "cat-ielts", name: "IELTS / TOEIC", color: "#0891b2" },
    { id: "cat-science", name: "Khoa học", color: "#16a34a" },
    { id: "cat-social", name: "Xã hội", color: "#f59e0b" },
    { id: "cat-other", name: "Khác", color: "#6b7280" },
  ];
  const CATEGORY_COLORS = ["#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#f59e0b", "#16a34a", "#0d9488", "#0891b2", "#6b7280", "#1f2937", "#a16207"];
  const Store = {
    who: null,
    data: emptyData(),
    load(who) {
      this.who = who || null;
      this.data = Object.assign(emptyData(), lsGet(LS.data(who), emptyData()));
      this.ensureCategories();
    },
    ensureCategories() {
      if (!this.data.categories) this.data.categories = {};
      if (!Object.keys(this.data.categories).length) {
        const t = now();
        DEFAULT_CATEGORIES.forEach((c, i) => (this.data.categories[c.id] = { ...c, order: i, updatedAt: t }));
      }
    },
    categories() {
      return Object.values(this.data.categories || {}).filter((c) => !c.deleted).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
    },
    category(id) { const c = (this.data.categories || {})[id]; return c && !c.deleted ? c : null; },
    saveCategory(cat) {
      this.data.categories[cat.id] = { ...cat, updatedAt: now() };
      this.changed();
    },
    removeCategory(id) {
      this.data.categories[id] = { id, deleted: true, updatedAt: now() };
      Object.values(this.data.sets).forEach((s) => { if (!s.deleted && s.category === id) { s.category = ""; s.updatedAt = now(); } });
      this.changed();
    },
    persist() { lsSet(LS.data(this.who), this.data); },
    changed() { this.persist(); Sync.schedule(); },
    sets() {
      return Object.values(this.data.sets).filter((s) => !s.deleted).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    get(id) { const s = this.data.sets[id]; return s && !s.deleted ? s : null; },
    touch(set) { set.updatedAt = now(); this.changed(); },
    create(title = "") {
      const t = now();
      const s = { id: uid(), title, description: "", cards: [newCard(), newCard()], createdAt: t, updatedAt: t };
      this.data.sets[s.id] = s;
      this.changed();
      return s;
    },
    remove(id) {
      this.data.sets[id] = { id, deleted: true, updatedAt: now() };
      delete this.data.progress[id];
      this.changed();
    },
    setProgress(setId, cardId, s) {
      const p = (this.data.progress[setId] ||= {});
      p[cardId] = { s, t: now() };
      this.changed();
    },
    progress(setId) { return this.data.progress[setId] || {}; },
  };
  const newCard = () => ({ id: uid(), term: "", definition: "", mc: false, choices: [], tags: [], createdAt: now() });

  // Gộp 2 bản dữ liệu: mỗi bộ thẻ lấy bản có updatedAt mới hơn; tiến độ gộp theo từng thẻ
  function mergeData(local, remote) {
    const out = emptyData();
    let localChanged = false, remoteChanged = false;
    remote = remote || emptyData();
    const ids = new Set([...Object.keys(local.sets || {}), ...Object.keys(remote.sets || {})]);
    for (const id of ids) {
      const l = local.sets?.[id], r = remote.sets?.[id];
      if (!r) { out.sets[id] = l; remoteChanged = true; }
      else if (!l) { out.sets[id] = r; localChanged = true; }
      else if (l.updatedAt > r.updatedAt) { out.sets[id] = l; remoteChanged = true; }
      else if (r.updatedAt > l.updatedAt) { out.sets[id] = r; localChanged = true; }
      else out.sets[id] = l;
    }
    const cids = new Set([...Object.keys(local.categories || {}), ...Object.keys(remote.categories || {})]);
    for (const id of cids) {
      const l = local.categories?.[id], r = remote.categories?.[id];
      if (!r) { out.categories[id] = l; remoteChanged = true; }
      else if (!l) { out.categories[id] = r; localChanged = true; }
      else if ((l.updatedAt || 0) > (r.updatedAt || 0)) { out.categories[id] = l; remoteChanged = true; }
      else if ((r.updatedAt || 0) > (l.updatedAt || 0)) { out.categories[id] = r; localChanged = true; }
      else out.categories[id] = l;
    }
    const pids = new Set([...Object.keys(local.progress || {}), ...Object.keys(remote.progress || {})]);
    for (const sid of pids) {
      if (out.sets[sid]?.deleted || !out.sets[sid]) {
        if (local.progress?.[sid]) localChanged = true;
        if (remote.progress?.[sid]) remoteChanged = true;
        continue;
      }
      const lp = local.progress?.[sid] || {}, rp = remote.progress?.[sid] || {};
      const o = (out.progress[sid] = {});
      for (const cid of new Set([...Object.keys(lp), ...Object.keys(rp)])) {
        const a = lp[cid], b = rp[cid];
        if (!b) { o[cid] = a; remoteChanged = true; }
        else if (!a) { o[cid] = b; localChanged = true; }
        else if (a.t > b.t) { o[cid] = a; remoteChanged = true; }
        else if (b.t > a.t) { o[cid] = b; localChanged = true; }
        else o[cid] = a;
      }
    }
    return { data: out, localChanged, remoteChanged };
  }

  /* ===================== Google Auth ===================== */
  const Auth = {
    tokenClient: null,
    token: null, // {access_token, exp}
    user: null, // {email, name, picture}
    clientId() { return lsGet(LS.clientId, "") || CFG.GOOGLE_CLIENT_ID || ""; },
    valid() { return !!(this.token && this.token.exp > now() + 30_000); },
    init() {
      this.user = lsGet(LS.user);
      const t = lsGet(LS.token);
      if (t && t.exp > now() + 30_000) this.token = t;
    },
    ensureClient() {
      if (this.tokenClient) return true;
      if (!window.google?.accounts?.oauth2) { toast("Chưa tải được Google Sign-In, kiểm tra kết nối mạng."); return false; }
      const cid = this.clientId();
      if (!cid) { openSettings(true); return false; }
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: cid,
        scope: SCOPES,
        callback: (resp) => this.onToken(resp),
        error_callback: (err) => { console.warn(err); if (err?.type !== "popup_closed") toast("Đăng nhập thất bại: " + (err?.message || err?.type)); },
      });
      return true;
    },
    login() {
      if (!this.ensureClient()) return;
      this.tokenClient.requestAccessToken({ prompt: this.user ? "" : "consent", hint: this.user?.email });
    },
    async onToken(resp) {
      if (resp.error) { toast("Đăng nhập thất bại: " + resp.error); return; }
      this.token = { access_token: resp.access_token, exp: now() + (Number(resp.expires_in) || 3600) * 1000 };
      lsSet(LS.token, this.token);
      try {
        const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + this.token.access_token } });
        const u = await r.json();
        const prev = this.user?.email;
        this.user = { email: u.email, name: u.name || u.email, picture: u.picture };
        lsSet(LS.user, this.user);
        if (prev !== this.user.email) switchAccount(this.user.email);
      } catch (e) { console.warn(e); }
      renderAuth();
      Sync.now();
    },
    logout() {
      if (this.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(this.token.access_token, () => {});
      this.token = null;
      this.user = null;
      lsDel(LS.token);
      lsDel(LS.user);
      Sync.fileId = null;
      Store.load(null);
      renderAuth();
      Sync.status("Chưa đăng nhập — dữ liệu chỉ lưu trên máy này", "");
      route();
    },
  };

  // Khi đăng nhập tài khoản: chuyển kho dữ liệu sang tài khoản đó, gộp dữ liệu "khách" (chưa đăng nhập) vào
  function switchAccount(email) {
    const guest = lsGet(LS.data(null));
    Store.load(email);
    if (guest && Object.keys(guest.sets || {}).length) {
      Store.data = mergeData(Store.data, guest).data;
      Store.persist();
      lsDel(LS.data(null));
    }
    route();
  }

  /* ===================== Google Drive Sync ===================== */
  const DRIVE = "https://www.googleapis.com/drive/v3/files";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
  const Sync = {
    fileId: null,
    busy: false,
    again: false,
    last: 0,
    status(text, cls = "") {
      const el = $("#syncStatus");
      el.textContent = text;
      el.className = "sync-status " + cls;
    },
    schedule: debounce(() => Sync.now(), 1500),
    async api(url, opts = {}) {
      const r = await fetch(url, { ...opts, headers: { Authorization: "Bearer " + Auth.token.access_token, ...(opts.headers || {}) } });
      if (r.status === 401) { Auth.token = null; lsDel(LS.token); throw Object.assign(new Error("401"), { code: 401 }); }
      if (!r.ok) throw new Error("Drive " + r.status + ": " + (await r.text()).slice(0, 200));
      return r;
    },
    async findFile() {
      const q = encodeURIComponent(`name='${CFG.DRIVE_FILE_NAME}' and trashed=false`);
      const r = await this.api(`${DRIVE}?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`);
      const j = await r.json();
      return j.files?.[0]?.id || null;
    },
    async download(id) {
      const r = await this.api(`${DRIVE}/${id}?alt=media`);
      const txt = await r.text();
      try { return JSON.parse(txt); } catch { return emptyData(); }
    },
    async create(data) {
      const boundary = "mcb" + uid();
      const meta = { name: CFG.DRIVE_FILE_NAME, parents: ["appDataFolder"], mimeType: "application/json" };
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`;
      const r = await this.api(`${UPLOAD}?uploadType=multipart&fields=id`, {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      });
      return (await r.json()).id;
    },
    async update(id, data) {
      await this.api(`${UPLOAD}/${id}?uploadType=media`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    },
    // Sao lưu thủ công: gộp rồi luôn ghi đè bản trên Drive
    async push() {
      while (this.busy) await new Promise((r) => setTimeout(r, 200));
      this.busy = true;
      this.status("Đang sao lưu…");
      try {
        if (!this.fileId) this.fileId = await this.findFile();
        const remote = this.fileId ? await this.download(this.fileId) : null;
        Store.data = mergeData(Store.data, remote).data;
        Store.persist();
        if (!this.fileId) this.fileId = await this.create(Store.data);
        else await this.update(this.fileId, Store.data);
        try { await this.syncBg(true); } catch (e) { console.warn("bg sync", e); }
        this.last = now();
        this.status("✓ Đã sao lưu " + new Date(this.last).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }), "ok");
      } catch (e) { this.status("⚠ Sao lưu thất bại", "err"); throw e; }
      finally { this.busy = false; }
    },
    // Tải sao lưu thủ công: lấy bản trên Drive thay cho dữ liệu trên máy
    async pull() {
      while (this.busy) await new Promise((r) => setTimeout(r, 200));
      this.busy = true;
      this.status("Đang tải sao lưu…");
      try {
        if (!this.fileId) this.fileId = await this.findFile();
        if (!this.fileId) { this.status("Chưa có bản sao lưu trên Drive", "err"); return false; }
        const remote = await this.download(this.fileId);
        Store.data = Object.assign(emptyData(), remote);
        Store.ensureCategories();
        Store.persist();
        try { await this.syncBg(true); } catch (e) { console.warn("bg sync", e); }
        this.last = now();
        this.status("✓ Đã tải sao lưu " + new Date(this.last).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }), "ok");
        return true;
      } catch (e) { this.status("⚠ Tải sao lưu thất bại", "err"); throw e; }
      finally { this.busy = false; }
    },
    /* ---- Ảnh nền: lưu thành file riêng trong appDataFolder, đồng bộ theo mốc thời gian ---- */
    BG_NAME: "meocards-bg.txt",
    async findBg() {
      const q = encodeURIComponent(`name='${this.BG_NAME}' and trashed=false`);
      const r = await this.api(`${DRIVE}?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`);
      const f = (await r.json()).files?.[0];
      return f ? { id: f.id, time: Date.parse(f.modifiedTime) } : null;
    },
    async uploadBg(existing, dataUrl) {
      let r;
      if (existing) {
        r = await this.api(`${UPLOAD}/${existing.id}?uploadType=media&fields=id,modifiedTime`, { method: "PATCH", headers: { "Content-Type": "text/plain" }, body: dataUrl });
      } else {
        const boundary = "mcb" + uid();
        const meta = { name: this.BG_NAME, parents: ["appDataFolder"], mimeType: "text/plain" };
        const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: text/plain\r\n\r\n${dataUrl}\r\n--${boundary}--`;
        r = await this.api(`${UPLOAD}?uploadType=multipart&fields=id,modifiedTime`, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
      }
      const j = await r.json();
      return Date.parse(j.modifiedTime) || now();
    },
    // Quy tắc: bên nào đổi sau cùng thì thắng (mốc thời gian local = lúc chọn/bỏ ảnh, remote = modifiedTime trên Drive)
    async syncBg(force = false) {
      const localImg = lsGet("mc-theme-img", "");
      const localTs = lsGet("mc-theme-img-ts", 0);
      const syncedTs = lsGet("mc-theme-img-synced", 0);
      const remote = await this.findBg();
      const remoteTs = remote ? remote.time : 0;
      if (!force && localTs <= syncedTs && remoteTs <= syncedTs) return; // không có gì mới
      if (remoteTs > localTs) {
        // Drive mới hơn → tải về
        const r = await this.api(`${DRIVE}/${remote.id}?alt=media`);
        const data = await r.text();
        if (data.startsWith("data:image")) { try { localStorage.setItem("mc-theme-img", JSON.stringify(data)); } catch { return; } }
        lsSet("mc-theme-img-ts", remoteTs); lsSet("mc-theme-img-synced", remoteTs);
        applyTheme(lsGet("mc-theme", {}));
      } else if (localImg && localTs > remoteTs) {
        // Máy này mới hơn → đẩy lên
        const t = await this.uploadBg(remote, localImg);
        lsSet("mc-theme-img-ts", t); lsSet("mc-theme-img-synced", t);
      } else if (!localImg && remote && localTs > remoteTs) {
        // Đã bỏ ảnh trên máy này → xoá trên Drive
        await this.api(`${DRIVE}/${remote.id}`, { method: "DELETE" });
        lsSet("mc-theme-img-synced", localTs);
      } else {
        lsSet("mc-theme-img-synced", Math.max(localTs, remoteTs));
      }
    },
    async now() {
      if (!Auth.user) return;
      if (!Auth.valid()) { this.status("⟳ Phiên Google hết hạn — bấm để kết nối lại", "err"); return; }
      if (this.busy) { this.again = true; return; }
      this.busy = true;
      this.status("Đang đồng bộ…");
      try {
        if (!this.fileId) this.fileId = await this.findFile();
        const remote = this.fileId ? await this.download(this.fileId) : null;
        const { data, localChanged, remoteChanged } = mergeData(Store.data, remote);
        Store.data = data;
        Store.ensureCategories();
        Store.persist();
        if (!this.fileId) this.fileId = await this.create(data);
        else if (remoteChanged) await this.update(this.fileId, data);
        try { await this.syncBg(); } catch (e) { console.warn("bg sync", e); }
        this.last = now();
        this.status("✓ Đã đồng bộ " + new Date(this.last).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }), "ok");
        if (localChanged) refreshAfterSync();
      } catch (e) {
        console.error(e);
        if (e.code === 401) this.status("⟳ Phiên Google hết hạn — bấm để kết nối lại", "err");
        else this.status("⚠ Lỗi đồng bộ — sẽ thử lại", "err");
      } finally {
        this.busy = false;
        if (this.again) { this.again = false; this.schedule(); }
      }
    },
  };

  function refreshAfterSync() {
    // Không vẽ lại khi người dùng đang gõ trong trình soạn thẻ
    const ae = document.activeElement;
    if (ae && (ae.isContentEditable || ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
    const r = parseRoute();
    if (r.page !== "library") return; // không làm gián đoạn khi đang sửa / đang học
    route();
  }

  /* ===================== Header / Auth UI ===================== */
  function renderAuth() {
    const el = $("#authArea");
    if (Auth.user) {
      el.innerHTML = `<div class="user-chip">
        ${Auth.user.picture ? `<img src="${esc(Auth.user.picture)}" alt="" referrerpolicy="no-referrer">` : ""}
        <span>${esc(Auth.user.name)}</span>
        <button class="btn small" id="btnLogout">Đăng xuất</button></div>`;
      $("#btnLogout").onclick = () => confirmDialog("Đăng xuất khỏi Google? Dữ liệu vẫn nằm an toàn trên Google Drive của bạn.", "Đăng xuất").then((ok) => ok && Auth.logout());
    } else {
      el.innerHTML = `<button class="btn primary" id="btnLogin">
        <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        Đăng nhập Google</button>`;
      $("#btnLogin").onclick = () => Auth.login();
    }
  }

  /* ===================== Dialogs ===================== */
  function openDialog(html, onSubmit) {
    const dlg = $("#dialog"), form = $("#dialogForm");
    form.innerHTML = html;
    return new Promise((resolve) => {
      const close = (val) => { dlg.close(); resolve(val); };
      form.onsubmit = (e) => {
        e.preventDefault();
        const action = e.submitter?.value;
        if (action === "cancel") return close(null);
        const res = onSubmit ? onSubmit(form, action) : action;
        if (res !== false) close(res ?? true);
      };
      dlg.oncancel = () => resolve(null);
      dlg.showModal();
      const first = $("input, textarea", form);
      if (first) first.focus();
    });
  }
  const confirmDialog = (msg, okText = "Đồng ý", danger = false) =>
    openDialog(`<h2>Xác nhận</h2><p>${esc(msg)}</p>
      <div class="actions"><button class="btn" value="cancel">Huỷ</button>
      <button class="btn ${danger ? "danger" : "primary"}" value="ok">${esc(okText)}</button></div>`).then((v) => v === "ok");

  // Chống bấm liên tục: mỗi thao tác sao lưu / tải sao lưu cách nhau tối thiểu 10 giây
  const COOLDOWN = 10_000;
  let lastManualSync = 0;
  function openSettings(needLogin = false) {
    const noCid = !CFG.GOOGLE_CLIENT_ID; // chỉ hỏi Client ID khi config.js chưa có
    openDialog(
      `<h2>⚙ Cài đặt</h2>
      ${noCid ? `<p>Để đăng nhập Google và đồng bộ qua Google Drive, app cần một <b>OAuth Client ID</b> (làm 1 lần).</p>
      <label class="field-label">Google OAuth Client ID</label>
      <input class="text" name="cid" placeholder="xxxxxxxx.apps.googleusercontent.com" value="${esc(Auth.clientId())}">
      <small>Tạo tại Google Cloud Console → Credentials → OAuth client ID (Web application), thêm <code>${esc(location.origin)}</code> vào <i>Authorized JavaScript origins</i>.</small>
      <hr style="border:none;border-top:1px solid var(--border);width:100%">` : ""}
      <label class="field-label">Google Drive</label>
      ${Auth.user ? `<small>Đang đăng nhập: <b>${esc(Auth.user.email)}</b>. App tự đồng bộ sau mỗi thay đổi; hai nút dưới dùng khi bạn muốn chủ động.</small>
      <div class="row">
        <button class="btn small" value="push" id="btnPush">☁ Sao lưu lên Drive ngay</button>
        <button class="btn small" value="pull" id="btnPull">⬇ Tải sao lưu từ Drive</button>
      </div>
      <small id="cooldownNote" class="muted"></small>` : `<small>Đăng nhập Google để sao lưu và đồng bộ giữa các thiết bị.</small>`}
      <hr style="border:none;border-top:1px solid var(--border);width:100%">
      <label class="field-label">Sao lưu file trên máy</label>
      <div class="row">
        <button class="btn small" value="export">⬇ Xuất toàn bộ (JSON)</button>
        <button class="btn small" value="import">⬆ Nhập file JSON</button>
      </div>
      <div class="actions"><button class="btn" value="cancel">Đóng</button>${noCid ? `<button class="btn primary" value="save">Lưu</button>` : ""}</div>`,
      (form, action) => {
        if (action === "export") { exportJSON(Store.data, "meocards-backup.json"); return false; }
        if (action === "import") { importJSONFile(); return true; }
        if (action === "push" || action === "pull") { setTimeout(() => manualSync(action), 50); return true; }
        if (action === "save" && noCid) {
          const cid = form.cid.value.trim();
          lsSet(LS.clientId, cid);
          Auth.tokenClient = null;
          if (needLogin && cid) setTimeout(() => Auth.login(), 50);
          toast("Đã lưu cài đặt");
        }
      }
    );
    // khoá nút khi chưa hết 10 giây
    const upd = () => {
      const left = Math.ceil((lastManualSync + COOLDOWN - now()) / 1000);
      const note = $("#cooldownNote");
      $$("#btnPush, #btnPull").forEach((b) => (b.disabled = left > 0));
      if (note) note.textContent = left > 0 ? `Vui lòng đợi ${left}s trước khi sao lưu / tải lại.` : "";
      if (left > 0) setTimeout(upd, 500);
    };
    upd();
  }
  async function manualSync(kind) {
    if (!Auth.user) { toast("Bạn chưa đăng nhập Google"); return; }
    const left = Math.ceil((lastManualSync + COOLDOWN - now()) / 1000);
    if (left > 0) { toast(`Vui lòng đợi ${left}s`); return; }
    if (!Auth.valid()) { toast("Phiên Google hết hạn — đang kết nối lại…"); Auth.login(); return; }
    if (kind === "pull" && !(await confirmDialog("Tải bản sao lưu từ Google Drive và THAY TOÀN BỘ dữ liệu trên máy này? Thay đổi chưa đồng bộ sẽ mất.", "Tải sao lưu", true))) return;
    lastManualSync = now();
    try {
      if (kind === "push") { await Sync.push(); toast("✓ Đã sao lưu lên Google Drive"); }
      else { const ok = await Sync.pull(); toast(ok ? "✓ Đã tải sao lưu từ Google Drive" : "Chưa có bản sao lưu nào trên Drive"); route(); }
    } catch (e) {
      console.error(e);
      toast("Lỗi: " + (e.code === 401 ? "phiên Google hết hạn, hãy đăng nhập lại" : e.message));
    }
  }

  function exportJSON(obj, name) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  // Nhập file: JSON (sao lưu của app) hoặc CSV/TSV (xuất từ Flashcards World, Quizlet, Excel…)
  function importFile(targetSet = null) {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,.csv,.tsv,.txt,application/json,text/csv,text/tab-separated-values,text/plain";
    inp.onchange = async () => {
      const file = inp.files[0];
      if (!file) return;
      let text = await file.text();
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // bỏ BOM
      const looksJSON = /^\s*[\[{]/.test(text);
      if (looksJSON) { try { importJSONText(JSON.parse(text)); return; } catch { /* rơi xuống CSV */ } }
      importCSVDialog(text, file.name, targetSet);
    };
    inp.click();
  }
  const importJSONFile = () => importFile(null);
  function importJSONText(obj) {
    let count = 0;
    const sets = obj.sets ? Object.values(obj.sets) : obj.cards ? [obj] : Array.isArray(obj) ? obj : [];
    for (const s of sets) {
      if (!s || s.deleted || !Array.isArray(s.cards)) continue;
      const id = Store.data.sets[s.id] ? uid() : s.id || uid();
      Store.data.sets[id] = normalizeSet({ ...s, id, updatedAt: now() });
      count++;
    }
    if (!count) { toast("File không có bộ thẻ nào"); return; }
    Store.changed();
    toast(`Đã nhập ${count} bộ thẻ`);
    route();
  }

  // Bộ phân tích CSV chuẩn (ngoặc kép, dấu phẩy/xuống dòng trong ô, "" = ")
  function parseCSV(text, delim) {
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.some((c) => c.trim())) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some((c) => c.trim())) rows.push(row);
    return rows;
  }
  const detectDelim = (text) => {
    const head = text.split(/\r?\n/).slice(0, 5).join("\n");
    const n = (d) => (head.match(new RegExp("\\" + d, "g")) || []).length;
    return n("\t") > n(",") ? "\t" : n(";") > n(",") ? ";" : ",";
  };
  // Chuyển bảng → danh sách thẻ. Nhận diện cột theo tiêu đề (Front/Back của Flashcards World, Term/Definition, …)
  function rowsToCards(rows, swap) {
    if (!rows.length) return { cards: [], headers: null };
    const norm = (h) => String(h || "").trim().toLowerCase();
    const h0 = rows[0].map(norm);
    const find = (...names) => h0.findIndex((h) => names.includes(h));
    let iFront = find("front", "term", "word", "question", "thuật ngữ", "từ"), iBack = find("back", "definition", "meaning", "answer", "định nghĩa", "nghĩa");
    const hasHeader = iFront >= 0 || iBack >= 0;
    const iEx = find("examples", "example", "ví dụ"), iLink = find("link", "url"), iId = find("card id", "id"), iTags = find("tags", "tag");
    if (iFront < 0) iFront = 0;
    if (iBack < 0) iBack = iFront === 0 ? 1 : 0;
    const body = hasHeader ? rows.slice(1) : rows;
    const cards = [];
    for (const r of body) {
      let front = (r[iFront] || "").trim(), back = (r[iBack] || "").trim();
      if (!front && !back) continue;
      if (swap) [front, back] = [back, front];
      let def = esc(back).replace(/\n/g, "<br>");
      const ex = iEx >= 0 ? (r[iEx] || "").trim() : "";
      const link = iLink >= 0 ? (r[iLink] || "").trim() : "";
      if (ex) def += (def ? "<br>" : "") + `<i>${esc(ex).replace(/\n/g, "<br>")}</i>`;
      if (link) def += (def ? "<br>" : "") + `<span style="color:#6b7280">${esc(link)}</span>`;
      const id = iId >= 0 && /^[\w-]{6,}$/.test(r[iId] || "") ? r[iId].trim() : uid();
      const tags = iTags >= 0 ? (r[iTags] || "").split(/[,;]/).map((t) => t.trim()).filter(Boolean) : [];
      cards.push({ ...newCard(), id, term: esc(front).replace(/\n/g, "<br>"), definition: def, tags });
    }
    return { cards, headers: hasHeader ? rows[0] : null };
  }
  function importCSVDialog(text, filename, targetSet) {
    const delim = detectDelim(text);
    const rows = parseCSV(text, delim);
    if (!rows.length) { toast("File trống hoặc không đọc được"); return; }
    const baseName = filename.replace(/\.(csv|tsv|txt)$/i, "").replace(/^[0-9a-f]{8}-/i, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();
    const isFW = rows[0].map((h) => h.trim().toLowerCase()).includes("front") && rows[0].map((h) => h.trim().toLowerCase()).includes("card id");
    const preview = (swap) => {
      const { cards } = rowsToCards(rows, swap);
      return { cards, html: cards.slice(0, 4).map((c) => `<tr><td>${c.term}</td><td>${c.definition}</td></tr>`).join("") };
    };
    openDialog(
      `<h2>⬆ Nhập CSV${isFW ? " <span class=\"chip\">Flashcards World</span>" : ""}</h2>
      <small>${esc(filename)} · ${rows.length - (rowsToCards(rows).headers ? 1 : 0)} dòng${rowsToCards(rows).headers ? ` · cột: ${rowsToCards(rows).headers.map(esc).join(", ")}` : " · không có dòng tiêu đề"}</small>
      ${targetSet ? `<label class="row"><input type="radio" name="dest" value="append" checked> Thêm vào bộ <b>${esc(targetSet.title || "(Chưa đặt tên)")}</b></label>
      <label class="row"><input type="radio" name="dest" value="new"> Tạo bộ thẻ mới</label>` : `<input type="hidden" name="dest" value="new">`}
      <div id="titleWrap" ${targetSet ? 'style="display:none"' : ""}><label class="field-label">Tên bộ thẻ</label><input class="text" name="title" value="${esc(baseName)}"></div>
      <label class="row"><input type="checkbox" name="swap"> Đảo cột: lấy <b>Back</b> làm Term, <b>Front</b> làm Definition</label>
      <div class="sheet-wrap" style="max-height:220px;overflow:auto"><table class="sheet" style="min-width:0;table-layout:fixed;word-break:break-word"><thead><tr><th>Term</th><th>Definition</th></tr></thead><tbody id="csvPrev"></tbody></table></div>
      <small class="muted">Cột Examples / Link (nếu có) được ghép vào Definition. Card ID được giữ để lần nhập sau không bị trùng thẻ.</small>
      <div class="actions"><button class="btn" value="cancel">Huỷ</button><button class="btn primary" value="ok">Nhập</button></div>`,
      (form) => {
        const { cards } = rowsToCards(rows, form.swap.checked);
        if (!cards.length) { toast("Không có thẻ nào để nhập"); return false; }
        const dest = form.dest.value;
        if (dest === "append" && targetSet) {
          const have = new Set(targetSet.cards.map((c) => c.id));
          const blank = (c) => !plainText(c.term) && !plainText(c.definition);
          targetSet.cards = targetSet.cards.filter((c) => !blank(c));
          let added = 0;
          for (const c of cards) { if (have.has(c.id)) continue; targetSet.cards.push(c); added++; }
          Store.touch(targetSet);
          toast(added ? `Đã thêm ${added} thẻ` : "Tất cả thẻ đã có trong bộ này");
          route();
        } else {
          const set = normalizeSet({ id: uid(), title: form.title.value.trim() || baseName || "Bộ thẻ CSV", description: isFW ? "Nhập từ Flashcards World" : "", cards });
          Store.data.sets[set.id] = set;
          Store.changed();
          toast(`Đã tạo bộ "${set.title}" với ${cards.length} thẻ`);
          location.hash = `#/set/${set.id}/edit`;
          route();
        }
      }
    );
    const form = $("#dialogForm");
    const draw = () => { $("#csvPrev", form).innerHTML = preview(form.swap.checked).html; };
    form.swap.onchange = draw;
    $$("input[name=dest]", form).forEach((r) => (r.onchange = () => { $("#titleWrap", form).style.display = form.dest.value === "new" ? "" : "none"; }));
    draw();
  }

  function normalizeSet(s) {
    return {
      id: s.id || uid(),
      title: String(s.title || "Bộ thẻ"),
      description: String(s.description || ""),
      createdAt: s.createdAt || now(),
      updatedAt: s.updatedAt || now(),
      lastUsed: s.lastUsed || 0,
      category: s.category || "",
      cards: (s.cards || []).map((c) => ({
        id: c.id || uid(),
        createdAt: c.createdAt || 0,
        term: sanitize(c.term || ""),
        definition: sanitize(c.definition || ""),
        mc: !!c.mc,
        choices: (c.choices || []).map((x) => ({ id: x.id || uid(), html: sanitize(x.html || ""), correct: !!x.correct })),
        tags: (c.tags || []).map(String),
      })),
    };
  }

  /* ===================== Router ===================== */
  function parseRoute() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (parts[0] === "set" && parts[1]) return { page: parts[2] || "edit", id: parts[1], mode: parts[3] || "" };
    return { page: "library" };
  }
  let cleanup = null;
  function route() {
    if (cleanup) { cleanup(); cleanup = null; }
    const r = parseRoute();
    const app = $("#app");
    app.classList.toggle("wide", r.page === "edit");
    app.classList.remove("mode-wide");
    window.scrollTo(0, 0);
    if (r.page === "library") return viewLibrary(app);
    const set = Store.get(r.id);
    if (!set) { location.hash = "#/"; return; }
    if (r.page === "edit") return viewEdit(app, set);
    if (r.page === "study") return viewStudy(app, set);
    if (r.page === "quiz") return viewQuiz(app, set);
    if (r.page === "mode" && window.MeoModes) return MeoModes.open(app, set, r.mode);
    location.hash = "#/";
  }

  /* ===================== View: Library ===================== */
  const catDot = (cat) => cat ? `<span class="cat-chip"><span class="cat-dot" style="background:${esc(cat.color)}"></span>${esc(cat.name)}</span>` : "";
  function viewLibrary(app) {
    const sets = Store.sets();
    const view = Object.assign({ sort: "newest", cats: [] }, lsGet("mc-lib-view", {}));
    view.cats = view.cats.filter((id) => Store.category(id));
    const saveView = () => lsSet("mc-lib-view", view);
    const totals = (() => {
      let cards = 0, known = 0;
      for (const st of sets) { const p = Store.progress(st.id); cards += st.cards.length; known += st.cards.filter((c) => p[c.id]?.s === "know").length; }
      return { cards, known };
    })();
    const SORTS = [["az", "A đến Z"], ["newest", "Mới nhất"], ["oldest", "Cũ nhất"], ["used", "Dùng gần đây"]];
    app.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Bộ thẻ của bạn</h1>
          <div class="muted" style="font-size:14px;margin-top:4px">${sets.length} bộ · ${totals.known}/${totals.cards} thẻ đã thuộc</div>
        </div>
        <div class="row">
          <button class="btn" id="btnImport">⬆ Nhập file (JSON / CSV)</button>
          <button class="btn primary" id="btnNew">＋ Tạo bộ mới</button>
        </div>
      </div>
      <div class="lib-toolbar">
        <div class="search-wrap"><span class="search-ico">🔍</span><input class="text" id="q" placeholder="Tìm bộ thẻ, thuật ngữ…"></div>
        <div class="dd-wrap">
          <button class="btn" id="btnFilter">▼ Lọc <span class="badge" id="filterBadge"></span></button>
          <div class="dd" id="ddFilter"></div>
        </div>
        <div class="dd-wrap">
          <button class="btn" id="btnSort">⇅ Sắp xếp <span class="badge soft" id="sortBadge"></span></button>
          <div class="dd" id="ddSort"></div>
        </div>
      </div>
      <div id="list"></div>`;
    $("#btnNew").onclick = () => { const st = Store.create(""); if (view.cats.length === 1) st.category = view.cats[0]; location.hash = `#/set/${st.id}/edit`; };
    $("#btnImport").onclick = () => importFile(null);

    const sortFn = {
      az: (a, b) => (a.title || "").localeCompare(b.title || "", "vi"),
      newest: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
      oldest: (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
      used: (a, b) => (b.lastUsed || b.updatedAt || 0) - (a.lastUsed || a.updatedAt || 0),
    };
    const draw = () => {
      const ql = $("#q").value.trim().toLowerCase();
      let items = sets.filter((st) => !ql || (st.title + " " + st.description + " " + st.cards.map((c) => plainText(c.term) + " " + plainText(c.definition) + " " + c.tags.join(" ")).join(" ")).toLowerCase().includes(ql));
      if (view.cats.length) items = items.filter((st) => view.cats.includes(st.category));
      items = items.slice().sort(sortFn[view.sort] || sortFn.newest);
      $("#filterBadge").textContent = view.cats.length || "";
      $("#sortBadge").textContent = SORTS.find((x) => x[0] === view.sort)?.[1] || "";
      const list = $("#list");
      if (!sets.length) {
        list.innerHTML = `<div class="empty"><div class="big">🃏</div><p>Chưa có bộ thẻ nào.</p>
          <p>${Auth.user ? "" : "Đăng nhập Google để đồng bộ giữa các thiết bị, hoặc "}bấm <b>＋ Tạo bộ mới</b> để bắt đầu.</p></div>`;
        return;
      }
      if (!items.length) { list.innerHTML = `<div class="empty">Không có bộ thẻ nào khớp bộ lọc.</div>`; return; }
      list.innerHTML = `<div class="set-grid">${items.map((st) => {
        const prog = Store.progress(st.id);
        const total = st.cards.length;
        const known = st.cards.filter((c) => prog[c.id]?.s === "know").length;
        const pct = total ? Math.round((known / total) * 100) : 0;
        const used = st.lastUsed || st.updatedAt;
        const cat = Store.category(st.category);
        return `<div class="set-tile" data-id="${st.id}" role="link" tabindex="0" title="Bấm để sửa bộ thẻ" ${cat ? `style="--cat:${esc(cat.color)}"` : ""}>
          <div class="tile-tools">
            <button class="tile-ico" data-act="dup" title="Nhân bản">⧉</button>
            <button class="tile-ico" data-act="exp" title="Xuất JSON">⬇</button>
            <button class="tile-ico" data-act="del" title="Xoá bộ thẻ"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 3h6l1 1h4v2H4V4h4zM5 8h14l-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/></svg></button>
          </div>
          ${cat ? `<div class="tile-cat">${catDot(cat)}</div>` : ""}
          <h3>${esc(st.title || "(Chưa đặt tên)")}</h3>
          <div class="memo-row"><span class="memo-label">Cards memorized</span><b>${known}/${total}</b></div>
          <div class="memo-bar"><div style="width:${pct}%"></div></div>
          <div class="tile-sep"></div>
          <div class="tile-meta">
            <div>🗂 ${total} ${total === 1 ? "card" : "cards"}</div>
            <div>🕓 Last used ${new Date(used).toLocaleDateString("vi-VN")}</div>
          </div>
          <div class="actions">
            <button class="btn small primary" data-modes="${st.id}" data-stop>▶ Học</button>
          </div></div>`;
      }).join("")}</div>`;
    };
    // Dropdown lọc theo danh mục
    const drawFilter = () => {
      const cats = Store.categories();
      $("#ddFilter").innerHTML = `<div class="dd-title">Lọc theo danh mục</div>
        ${cats.map((c) => `<label class="dd-item"><span class="cat-dot" style="background:${esc(c.color)}"></span><span style="flex:1">${esc(c.name)}</span><input type="checkbox" data-cat="${c.id}" ${view.cats.includes(c.id) ? "checked" : ""}></label>`).join("")}
        <label class="dd-item"><span class="cat-dot" style="background:#e5e7eb"></span><span style="flex:1">Chưa phân loại</span><input type="checkbox" data-cat="" ${view.cats.includes("") ? "checked" : ""}></label>
        <div class="dd-foot"><button type="button" class="link" id="clearCats">Bỏ lọc</button><button type="button" class="link" id="manageCats">Quản lý danh mục</button></div>`;
      $("#ddFilter").onchange = (e) => {
        const cb = e.target.closest("input[data-cat]"); if (!cb) return;
        const id = cb.dataset.cat;
        view.cats = cb.checked ? [...new Set([...view.cats, id])] : view.cats.filter((x) => x !== id);
        saveView(); draw();
      };
      $("#clearCats").onclick = () => { view.cats = []; saveView(); drawFilter(); draw(); };
      $("#manageCats").onclick = () => { closeDD(); manageCategories(() => { drawFilter(); draw(); }); };
    };
    const drawSort = () => {
      $("#ddSort").innerHTML = `<div class="dd-title">Sắp xếp bộ thẻ</div>${SORTS.map(([k, l]) => `<button type="button" class="dd-item ${view.sort === k ? "on" : ""}" data-sort="${k}">${view.sort === k ? "✓ " : ""}${l}</button>`).join("")}`;
      $("#ddSort").onclick = (e) => { const b = e.target.closest("button[data-sort]"); if (!b) return; view.sort = b.dataset.sort; saveView(); drawSort(); draw(); closeDD(); };
    };
    const closeDD = () => $$(".dd.open").forEach((d) => d.classList.remove("open"));
    const toggleDD = (id) => { const d = $(id); const open = d.classList.contains("open"); closeDD(); if (!open) d.classList.add("open"); };
    $("#btnFilter").onclick = (e) => { e.stopPropagation(); toggleDD("#ddFilter"); };
    $("#btnSort").onclick = (e) => { e.stopPropagation(); toggleDD("#ddSort"); };
    const outside = (e) => { if (!e.target.closest(".dd-wrap")) closeDD(); };
    document.addEventListener("click", outside);
    cleanup = () => document.removeEventListener("click", outside);
    drawFilter(); drawSort(); draw();
    $("#q").oninput = draw;
    const openSet = (tile) => { location.hash = `#/set/${tile.dataset.id}/edit`; };
    $("#list").onkeydown = (e) => { const t = e.target.closest(".set-tile"); if (t && e.target === t && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openSet(t); } };
    $("#list").onclick = async (e) => {
      const tile = e.target.closest(".set-tile");
      if (!tile) return;
      const btn = e.target.closest("button[data-act]");
      if (!btn) { if (!e.target.closest("[data-stop]")) openSet(tile); return; }
      const id = tile.dataset.id;
      const st = Store.get(id);
      if (btn.dataset.act === "del") {
        if (await confirmDialog(`Xoá bộ "${st.title || "(Chưa đặt tên)"}"? Thao tác sẽ đồng bộ sang các thiết bị khác.`, "Xoá", true)) {
          Store.remove(id); toast("Đã xoá"); route();
        }
      } else if (btn.dataset.act === "dup") {
        const copy = normalizeSet(JSON.parse(JSON.stringify(st)));
        copy.id = uid(); copy.title = st.title + " (bản sao)"; copy.cards.forEach((c) => (c.id = uid()));
        copy.createdAt = copy.updatedAt = now();
        Store.data.sets[copy.id] = copy; Store.changed(); route();
      } else if (btn.dataset.act === "exp") {
        exportJSON(st, (st.title || "set").replace(/[^\w\-]+/g, "_") + ".json");
      }
    };
  }

  /* ===================== Danh mục ===================== */
  const colorPicker = (name, value) => `<div class="color-row" data-color-row="${name}">
      ${CATEGORY_COLORS.map((c) => `<button type="button" class="swatch ${c === value ? "on" : ""}" style="background:${c}" data-c="${c}" title="${c}"></button>`).join("")}
      <label class="swatch custom" title="Màu khác"><input type="color" value="${esc(value)}" data-custom></label>
      <input type="hidden" name="${name}" value="${esc(value)}"></div>`;
  function bindColorRow(form) {
    $$("[data-color-row]", form).forEach((row) => {
      const hidden = $("input[type=hidden]", row);
      row.onclick = (e) => { const b = e.target.closest("button[data-c]"); if (!b) return; hidden.value = b.dataset.c; $$(".swatch", row).forEach((x) => x.classList.toggle("on", x === b)); };
      $("[data-custom]", row).oninput = (e) => { hidden.value = e.target.value; $$(".swatch", row).forEach((x) => x.classList.remove("on")); e.target.parentElement.classList.add("on"); };
    });
  }
  // Thêm / sửa một danh mục. Trả Promise<cat|null>
  function editCategory(cat = null) {
    const color = cat?.color || CATEGORY_COLORS[Store.categories().length % CATEGORY_COLORS.length];
    return openDialogWithColors(
      `<h2>${cat ? "Sửa danh mục" : "Thêm danh mục"}</h2>
      <label class="field-label">Tên danh mục</label>
      <input class="text" name="name" placeholder="Ví dụ: Sinh vật" value="${esc(cat?.name || "")}" maxlength="40">
      <label class="field-label">Màu</label>
      ${colorPicker("color", color)}
      <div class="actions"><button class="btn" value="cancel">Huỷ</button><button class="btn primary" value="ok">Lưu</button></div>`,
      (form) => {
        const name = form.name.value.trim();
        if (!name) { toast("Nhập tên danh mục"); return false; }
        const c = { id: cat?.id || "cat-" + uid(), name, color: form.color.value, order: cat?.order ?? Store.categories().length };
        Store.saveCategory(c);
        return c;
      }
    ).then((v) => (v && v.id ? v : null));
  }
  // openDialog vẽ xong là gắn bảng màu ngay
  function openDialogWithColors(html, onSubmit) { const p = openDialog(html, onSubmit); bindColorRow($("#dialogForm")); return p; }
  function manageCategories(onDone) {
    const draw = () => {
      const cats = Store.categories();
      openDialog(
        `<h2>Quản lý danh mục</h2>
        <div class="cat-list">${cats.map((c) => `<div class="cat-row" data-id="${c.id}">
            <span class="cat-dot big" style="background:${esc(c.color)}"></span><span style="flex:1">${esc(c.name)}</span>
            <span class="muted" style="font-size:13px">${Store.sets().filter((st) => st.category === c.id).length} bộ</span>
            <button type="button" class="icon-btn" data-edit title="Sửa">✎</button><button type="button" class="icon-btn" data-del title="Xoá">✕</button></div>`).join("") || `<p class="muted">Chưa có danh mục nào.</p>`}</div>
        <div class="actions" style="justify-content:space-between"><button class="btn" value="add">＋ Thêm danh mục</button><button class="btn primary" value="cancel">Xong</button></div>`,
        (form, action) => { if (action === "add") { setTimeout(() => editCategory().then(draw), 30); return true; } }
      ).then((v) => { if (v === null) onDone && onDone(); });
      $(".cat-list").onclick = async (e) => {
        const row = e.target.closest(".cat-row"); if (!row) return;
        const c = Store.category(row.dataset.id);
        if (e.target.closest("[data-edit]")) { $("#dialog").close(); setTimeout(() => editCategory(c).then(draw), 30); }
        if (e.target.closest("[data-del]")) {
          $("#dialog").close();
          setTimeout(async () => { if (await confirmDialog(`Xoá danh mục "${c.name}"? Các bộ thẻ thuộc danh mục này sẽ thành "Chưa phân loại".`, "Xoá", true)) Store.removeCategory(c.id); draw(); }, 30);
        }
      };
    };
    draw();
  }

  /* ===================== Rich text editor ===================== */
  let savedRange = null;
  function makeEditor({ html, placeholder, onChange }) {
    const wrap = document.createElement("div");
    wrap.className = "rt-wrap";
    const slot = document.createElement("div");
    slot.className = "rt-toolbar-slot";
    const tb = $("#tplToolbar").content.firstElementChild.cloneNode(true);
    tb.style.visibility = "hidden";
    slot.append(tb);
    const ed = document.createElement("div");
    ed.className = "rt";
    ed.contentEditable = "true";
    ed.dataset.placeholder = placeholder;
    ed.innerHTML = sanitize(html);
    wrap.append(slot, ed);

    const emit = debounce(() => onChange(sanitize(ed.innerHTML)), 250);
    ed.addEventListener("input", () => { if (ed.innerHTML === "<br>") ed.innerHTML = ""; emit(); });
    ed.addEventListener("focus", () => {
      $$(".rt-toolbar").forEach((t) => (t.style.visibility = "hidden"));
      tb.style.visibility = "visible";
    });
    ed.addEventListener("blur", () => {
      const sel = getSelection();
      if (sel.rangeCount && ed.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
      // làm sạch HTML khi rời ô
      const clean = sanitize(ed.innerHTML);
      onChange(clean);
    });
    ed.addEventListener("paste", (e) => {
      // dán dạng có định dạng nhưng đã được lọc
      const h = e.clipboardData.getData("text/html");
      const t = e.clipboardData.getData("text/plain");
      e.preventDefault();
      if (h) document.execCommand("insertHTML", false, sanitize(h));
      else document.execCommand("insertText", false, t);
    });
    ed.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") { e.preventDefault(); applyCmd("code", ed); }
    });

    // giữ focus khi bấm nút toolbar
    tb.addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); });
    tb.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-cmd]");
      if (!b) return;
      applyCmd(b.dataset.cmd, ed);
    });
    $$("input[type=color]", tb).forEach((inp) => {
      inp.addEventListener("input", () => {
        restoreRange(ed);
        document.execCommand("styleWithCSS", false, true);
        document.execCommand(inp.dataset.cmd, false, inp.value);
        ed.dispatchEvent(new Event("input"));
      });
    });
    return { el: wrap, editor: ed, toolbar: tb };
  }
  function restoreRange(ed) {
    ed.focus();
    if (savedRange && ed.contains(savedRange.startContainer)) {
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
  }
  function closestIn(node, sel, root) {
    while (node && node !== root) {
      if (node.nodeType === 1 && node.matches(sel)) return node;
      node = node.parentNode;
    }
    return null;
  }
  function unwrap(el) { el.replaceWith(...el.childNodes); }
  function wrapSelection(ed, makeEl) {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!ed.contains(range.commonAncestorContainer)) return;
    const el = makeEl();
    if (range.collapsed) {
      el.textContent = "\u200b";
      range.insertNode(el);
    } else {
      el.appendChild(range.extractContents());
      range.insertNode(el);
    }
    const r = document.createRange();
    r.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  function applyCmd(cmd, ed) {
    ed.focus();
    const sel = getSelection();
    const anchor = sel.anchorNode;
    if (cmd === "code") {
      const ex = closestIn(anchor, "code", ed);
      if (ex && !closestIn(ex, "pre", ed)) unwrap(ex);
      else wrapSelection(ed, () => document.createElement("code"));
    } else if (cmd === "codeblock") {
      const ex = closestIn(anchor, "pre", ed);
      if (ex) {
        const text = ex.textContent;
        const div = document.createElement("div");
        div.textContent = text;
        ex.replaceWith(div);
      } else {
        wrapSelection(ed, () => {
          const pre = document.createElement("pre");
          return pre;
        });
        // đưa nội dung trong pre vào <code> dạng text thuần
        $$("pre", ed).forEach((pre) => {
          if (!pre.querySelector("code")) {
            const code = document.createElement("code");
            code.textContent = pre.textContent || "\u200b";
            pre.textContent = "";
            pre.append(code);
          }
        });
      }
    } else if (cmd === "cloze") {
      const ex = closestIn(anchor, ".cloze", ed);
      if (ex) unwrap(ex);
      else if (sel.isCollapsed) { toast("Bôi đen chữ cần ẩn rồi bấm [...]"); return; }
      else wrapSelection(ed, () => { const s = document.createElement("span"); s.className = "cloze"; return s; });
    } else if (cmd === "removeFormat") {
      document.execCommand("removeFormat");
      const c = closestIn(sel.anchorNode, ".cloze, code", ed);
      if (c && !closestIn(c, "pre", ed)) unwrap(c);
    } else {
      document.execCommand(cmd);
    }
    ed.dispatchEvent(new Event("input"));
    updateToolbarState();
  }
  function updateToolbarState() {
    const ed = document.activeElement;
    if (!ed || !ed.classList?.contains("rt")) return;
    const tb = ed.parentElement.querySelector(".rt-toolbar");
    const anchor = getSelection().anchorNode;
    for (const b of $$("button[data-cmd]", tb)) {
      const c = b.dataset.cmd;
      let on = false;
      try {
        if (["bold", "italic", "underline", "strikeThrough"].includes(c)) on = document.queryCommandState(c);
        else if (c === "code") on = !!closestIn(anchor, "code", ed) && !closestIn(anchor, "pre", ed);
        else if (c === "codeblock") on = !!closestIn(anchor, "pre", ed);
        else if (c === "cloze") on = !!closestIn(anchor, ".cloze", ed);
      } catch {}
      b.classList.toggle("active", on);
    }
  }
  document.addEventListener("selectionchange", updateToolbarState);

  /* ===================== View: Edit set ===================== */
  function viewEdit(app, set) {
    const view = Object.assign({ layout: "grid" }, lsGet("mc-edit-view", {}));
    const render = () => {
      const n = set.cards.length;
      app.innerHTML = `
      <div class="edit-head">
        <div>
          <h1 class="set-title">${esc(set.title || "Bộ thẻ chưa đặt tên")}</h1>
          <div class="row" style="margin-top:8px">
            <span class="chip">${n} ${n === 1 ? "card" : "cards"}</span>
            ${Store.category(set.category) ? catDot(Store.category(set.category)) : ""}
            ${set.description ? `<span class="muted" style="font-size:14px">${esc(set.description)}</span>` : ""}
          </div>
        </div>
        <div class="row">
          <button class="btn" data-modes="${set.id}">▶ Học</button>
          <button class="btn" id="btnDetails">✎ Edit details</button>
        </div>
      </div>
      <div class="edit-toolbar">
        <div class="search-wrap"><span class="search-ico">🔍</span><input class="text" id="q" placeholder="Search cards..."></div>
        <div class="seg" id="layoutSeg">
          <button data-l="list" class="${view.layout === "list" ? "on" : ""}">☰ List</button>
          <button data-l="grid" class="${view.layout === "grid" ? "on" : ""}">▦ Grid</button>
          <button data-l="sheet" class="${view.layout === "sheet" ? "on" : ""}">▤ Spreadsheet</button>
        </div>
        <button class="btn" id="btnReverse" title="Tạo thêm thẻ đảo ngược (Definition → Term) cho mọi thẻ">⇄ Also create reverse card</button>
        <button class="btn" id="btnBulk">⚡ Nhập nhanh</button>
        <button class="btn" id="btnCsv" title="Nhập file CSV/JSON vào bộ này">⬆ Nhập CSV</button>
        <a class="btn primary" id="btnSave" href="#/">✓ Save cards</a>
      </div>
      <div id="cardsWrap"></div>
      <div class="add-card-wrap"><button class="add-card-btn" id="btnAdd">＋ Add Card</button></div>`;

      $("#btnDetails").onclick = () => editDetails(set, render);
      $("#btnBulk").onclick = () => bulkImport(set);
      $("#btnCsv").onclick = () => importFile(set);
      $("#layoutSeg").onclick = (e) => {
        const b = e.target.closest("button[data-l]");
        if (!b) return;
        view.layout = b.dataset.l;
        lsSet("mc-edit-view", view);
        render();
      };
      $("#btnReverse").onclick = async () => {
        const src = set.cards.filter((c) => !c.mc && plainText(c.term) && plainText(c.definition));
        if (!src.length) { toast("Cần thẻ có cả Term và Definition"); return; }
        const key = (a, b) => plainText(a).toLowerCase() + "\u0000" + plainText(b).toLowerCase();
        const existing = new Set(set.cards.map((c) => key(c.term, c.definition)));
        const add = src.filter((c) => !existing.has(key(c.definition, c.term)));
        if (!add.length) { toast("Mọi thẻ đã có bản đảo ngược"); return; }
        if (!(await confirmDialog(`Tạo thêm ${add.length} thẻ đảo ngược (Definition làm Term)?`, "Tạo thẻ"))) return;
        for (const c of add) set.cards.push({ ...newCard(), term: c.definition, definition: c.term, tags: c.tags.slice() });
        Store.touch(set);
        toast(`Đã thêm ${add.length} thẻ`);
        render();
      };
      $("#btnAdd").onclick = () => {
        const c = newCard();
        set.cards.push(c);
        Store.touch(set);
        if (view.layout === "sheet") { render(); const rows = $$("#sheet tbody tr"); rows[rows.length - 1]?.querySelector("input")?.focus(); }
        else { addCardEl(c, true); updateCount(); }
      };
      $("#q").oninput = (e) => filterCards(e.target.value.trim().toLowerCase());
      drawCards();
    };

    const save = debounce(() => Store.touch(set), 400);
    const updateCount = () => { const c = $(".chip"); if (c) c.textContent = `${set.cards.length} ${set.cards.length === 1 ? "card" : "cards"}`; };
    let cardsEl = null;
    const renumber = () => $$(".card-num", cardsEl).forEach((n, i) => (n.textContent = "#" + (i + 1)));
    const addCardEl = (card, focus = false) => {
      const el = buildCardEditor(set, card, save, () => {
        set.cards = set.cards.filter((c) => c !== card);
        el.remove();
        renumber();
        updateCount();
        Store.touch(set);
      });
      el.dataset.id = card.id;
      cardsEl.append(el);
      renumber();
      if (focus) { el.scrollIntoView({ behavior: "smooth", block: "center" }); $(".rt", el).focus(); }
    };
    const filterCards = (q) => {
      if (view.layout === "sheet") {
        $$("#sheet tbody tr").forEach((tr) => { tr.style.display = !q || tr.textContent.toLowerCase().includes(q) || [...tr.querySelectorAll("input")].some((i) => i.value.toLowerCase().includes(q)) ? "" : "none"; });
        return;
      }
      $$(".card-editor", cardsEl).forEach((el) => {
        const c = set.cards.find((x) => x.id === el.dataset.id);
        const hay = c ? (plainText(c.term) + " " + plainText(c.definition) + " " + c.tags.join(" ") + " " + c.choices.map((x) => plainText(x.html)).join(" ")).toLowerCase() : "";
        el.style.display = !q || hay.includes(q) ? "" : "none";
      });
    };
    const drawCards = () => {
      const wrap = $("#cardsWrap");
      if (view.layout === "sheet") { drawSheet(wrap); return; }
      wrap.innerHTML = `<div class="cards ${view.layout === "grid" ? "cards-grid" : "cards-list"}" id="cards"></div>`;
      cardsEl = $("#cards");
      set.cards.forEach((c) => addCardEl(c));
    };
    // Spreadsheet view: bảng Term / Definition / Tags, nhập text thuần (giữ định dạng của thẻ chưa sửa)
    const drawSheet = (wrap) => {
      wrap.innerHTML = `<div class="sheet-wrap"><table class="sheet" id="sheet">
        <thead><tr><th style="width:44px">#</th><th>Term</th><th>Definition</th><th style="width:22%">Tags (cách nhau bằng dấu phẩy)</th><th style="width:44px"></th></tr></thead>
        <tbody>${set.cards.map((c, i) => `<tr data-id="${c.id}"><td class="muted">${i + 1}</td>
          <td><input class="cell" data-f="term" value="${esc(plainText(c.term))}" ${c.mc ? 'title="Thẻ Multiple choice — sửa lựa chọn ở chế độ Grid/List"' : ""}></td>
          <td><input class="cell" data-f="definition" value="${esc(plainText(c.definition))}" placeholder="${c.mc ? "(Multiple choice)" : ""}"></td>
          <td><input class="cell" data-f="tags" value="${esc(c.tags.join(", "))}"></td>
          <td><button class="icon-btn" data-del title="Xoá thẻ">✕</button></td></tr>`).join("")}</tbody></table>
        <div class="hint" style="text-align:left;padding:8px 4px">Tab / Enter để di chuyển giữa các ô. Ô có định dạng (đậm, màu, [...]) sẽ bị chuyển về chữ thường khi bạn sửa ở đây.</div></div>`;
      const tbl = $("#sheet");
      tbl.addEventListener("input", (e) => {
        const inp = e.target.closest("input.cell");
        if (!inp) return;
        const c = set.cards.find((x) => x.id === inp.closest("tr").dataset.id);
        if (!c) return;
        const f = inp.dataset.f;
        if (f === "tags") c.tags = inp.value.split(",").map((s) => s.trim()).filter(Boolean);
        else if (plainText(c[f]) !== inp.value) c[f] = esc(inp.value);
        save();
      });
      tbl.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const cells = $$("input.cell", tbl);
        const i = cells.indexOf(e.target);
        if (i < 0) return;
        const next = cells[i + 3];
        if (next) next.focus();
        else $("#btnAdd").click();
      });
      tbl.addEventListener("click", async (e) => {
        const b = e.target.closest("button[data-del]");
        if (!b) return;
        const tr = b.closest("tr");
        set.cards = set.cards.filter((x) => x.id !== tr.dataset.id);
        Store.touch(set);
        render();
      });
    };

    render();
    if (!set.title) setTimeout(() => editDetails(set, render), 50);
    const flush = () => { if (set.title || set.cards.some((c) => plainText(c.term) || plainText(c.definition))) Store.touch(set); };
    window.addEventListener("beforeunload", flush);
    cleanup = () => {
      window.removeEventListener("beforeunload", flush);
      // bộ thẻ trống hoàn toàn → xoá luôn cho gọn
      const blank = !set.title.trim() && !set.description.trim() && set.cards.every((c) => !plainText(c.term) && !plainText(c.definition));
      if (blank) Store.remove(set.id);
    };
  }

  function editDetails(set, onDone) {
    const draw = () => {
      const cats = Store.categories();
      openDialog(
        `<h2>Chi tiết bộ thẻ</h2>
        <label class="field-label">Tên bộ thẻ</label>
        <input class="text" name="title" placeholder="Ví dụ: IELTS Vocabulary – Unit 1" value="${esc(set.title)}">
        <label class="field-label">Danh mục</label>
        <div class="row">
          <select class="text" name="category" style="flex:1">
            <option value="">— Chưa phân loại —</option>
            ${cats.map((c) => `<option value="${c.id}" ${set.category === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
          </select>
          <span class="cat-dot big" id="catPreview" style="background:${esc(Store.category(set.category)?.color || "#e5e7eb")}"></span>
          <button class="btn" value="addcat" type="submit">＋ Thêm</button>
        </div>
        <label class="field-label">Mô tả (tuỳ chọn)</label>
        <textarea class="text" name="desc" rows="3">${esc(set.description)}</textarea>
        <div class="actions"><button class="btn" value="cancel">Huỷ</button><button class="btn primary" value="ok">Lưu</button></div>`,
        (form, action) => {
          set.title = form.title.value.trim();
          set.description = form.desc.value.trim();
          set.category = form.category.value;
          Store.touch(set);
          if (action === "addcat") { setTimeout(() => editCategory().then((c) => { if (c) set.category = c.id; draw(); }), 30); return true; }
          onDone();
        }
      );
      const form = $("#dialogForm");
      form.category.onchange = () => { $("#catPreview", form).style.background = Store.category(form.category.value)?.color || "#e5e7eb"; };
    };
    draw();
  }

  function buildCardEditor(set, card, save, onDelete) {
    const el = document.createElement("div");
    el.className = "card-editor";
    el.innerHTML = `
      <div class="card-head">
        <span class="card-num"></span>
        <label class="mc-toggle">Multiple choice
          <span class="switch"><input type="checkbox" class="mc-input" ${card.mc ? "checked" : ""}><span class="slider"></span></span>
        </label>
        <button class="icon-btn btn-del" title="Xoá thẻ">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 3h6l1 1h4v2H4V4h4zM5 8h14l-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/></svg>
        </button>
      </div>
      <div class="field-label">Term</div>
      <div class="slot-term"></div>
      <div class="mc-area"></div>
      <div class="field-label def-label"></div>
      <div class="slot-def"></div>
      <div class="card-tools"><button type="button" class="btn small btn-translate" title="Mở Google Dịch với nội dung Term">🌐 Translate</button></div>
      <div class="tags-row"><span class="field-label">Tags</span><span class="tag-list"></span><button class="add-tag" type="button">Add Tag</button></div>`;

    const term = makeEditor({ html: card.term, placeholder: "Term", onChange: (h) => { if (h !== card.term) { card.term = h; save(); } } });
    const def = makeEditor({ html: card.definition, placeholder: "Definition", onChange: (h) => { if (h !== card.definition) { card.definition = h; save(); } } });
    $(".slot-term", el).append(term.el);
    $(".slot-def", el).append(def.el);

    // Multiple choice
    const mcArea = $(".mc-area", el);
    const drawMC = () => {
      $(".def-label", el).textContent = card.mc ? "Giải thích (tuỳ chọn)" : "Definition";
      def.editor.dataset.placeholder = card.mc ? "Giải thích hiện sau khi trả lời" : "Definition";
      mcArea.innerHTML = "";
      if (!card.mc) return;
      const box = document.createElement("div");
      box.className = "choices";
      box.innerHTML = `<div class="field-label">Lựa chọn <span class="muted" style="font-weight:400">(tích ✓ đáp án đúng)</span></div>`;
      card.choices.forEach((ch, i) => {
        const row = document.createElement("div");
        row.className = "choice-row";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "choice-correct";
        cb.checked = ch.correct;
        cb.title = "Đáp án đúng";
        cb.onchange = () => { ch.correct = cb.checked; save(); };
        const ed = makeEditor({ html: ch.html, placeholder: "Lựa chọn " + String.fromCharCode(65 + i), onChange: (h) => { if (h !== ch.html) { ch.html = h; save(); } } });
        const del = document.createElement("button");
        del.className = "icon-btn";
        del.type = "button";
        del.title = "Bỏ lựa chọn";
        del.textContent = "✕";
        del.style.marginBottom = "4px";
        del.onclick = () => { card.choices.splice(i, 1); save(); drawMC(); };
        row.append(cb, ed.el, del);
        box.append(row);
      });
      const add = document.createElement("button");
      add.type = "button";
      add.className = "btn small";
      add.textContent = "＋ Thêm lựa chọn";
      add.style.justifySelf = "start";
      add.onclick = () => { card.choices.push({ id: uid(), html: "", correct: false }); save(); drawMC(); $$(".choice-row .rt", mcArea).pop()?.focus(); };
      box.append(add);
      mcArea.append(box);
    };
    $(".mc-input", el).onchange = (e) => {
      card.mc = e.target.checked;
      if (card.mc && !card.choices.length) {
        card.choices = [
          { id: uid(), html: card.definition || "", correct: true },
          { id: uid(), html: "", correct: false },
          { id: uid(), html: "", correct: false },
          { id: uid(), html: "", correct: false },
        ];
        if (card.definition) { card.definition = ""; def.editor.innerHTML = ""; }
      }
      save();
      drawMC();
    };
    drawMC();

    // Tags
    const tagList = $(".tag-list", el);
    const drawTags = () => {
      tagList.innerHTML = card.tags.map((t, i) => `<span class="tag">${esc(t)}<button type="button" data-i="${i}" title="Bỏ tag">×</button></span>`).join(" ");
    };
    tagList.onclick = (e) => {
      const b = e.target.closest("button[data-i]");
      if (!b) return;
      card.tags.splice(+b.dataset.i, 1);
      save();
      drawTags();
    };
    const addBtn = $(".add-tag", el);
    addBtn.onclick = () => {
      const inp = document.createElement("input");
      inp.className = "tag-input";
      inp.placeholder = "Tên tag…";
      inp.setAttribute("list", "tagSuggest");
      addBtn.replaceWith(inp);
      ensureTagDatalist();
      inp.focus();
      let done = false;
      const commit = () => {
        if (done) return;
        done = true;
        const vals = inp.value.split(",").map((s) => s.trim()).filter(Boolean);
        for (const v of vals) if (!card.tags.includes(v)) card.tags.push(v);
        if (vals.length) { save(); drawTags(); }
        inp.replaceWith(addBtn);
      };
      inp.onkeydown = (e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { inp.value = ""; commit(); }
      };
      inp.onblur = commit;
    };
    drawTags();

    $(".btn-translate", el).onclick = () => {
      const t = plainText(card.term);
      if (!t) { toast("Nhập Term trước"); return; }
      window.open("https://translate.google.com/?sl=auto&tl=vi&text=" + encodeURIComponent(t) + "&op=translate", "_blank", "noopener");
    };
    $(".btn-del", el).onclick = onDelete;
    return el;
  }
  function ensureTagDatalist() {
    let dl = $("#tagSuggest");
    if (!dl) { dl = document.createElement("datalist"); dl.id = "tagSuggest"; document.body.append(dl); }
    const all = new Set();
    Store.sets().forEach((s) => s.cards.forEach((c) => c.tags.forEach((t) => all.add(t))));
    dl.innerHTML = [...all].map((t) => `<option value="${esc(t)}">`).join("");
  }

  function bulkImport(set) {
    openDialog(
      `<h2>⚡ Nhập nhanh</h2>
      <small>Mỗi dòng một thẻ. Ngăn cách Term và Definition bằng <b>Tab</b>, <b>" - "</b>, <b>" : "</b> hoặc <b>dấu phẩy</b> (dòng đầu tiên quyết định). Có thể dán trực tiếp từ Excel / Google Sheets / Quizlet.</small>
      <textarea class="text" name="txt" rows="10" placeholder="apple\tquả táo&#10;banana\tquả chuối"></textarea>
      <div class="actions"><button class="btn" value="cancel">Huỷ</button><button class="btn primary" value="ok">Thêm thẻ</button></div>`,
      (form) => {
        const lines = form.txt.value.split(/\r?\n/).filter((l) => l.trim());
        if (!lines.length) return false;
        const first = lines[0];
        const sep = first.includes("\t") ? "\t" : first.includes(" - ") ? " - " : first.includes(" : ") ? " : " : ",";
        // bỏ các thẻ trống ở cuối
        set.cards = set.cards.filter((c) => plainText(c.term) || plainText(c.definition) || c.mc);
        for (const l of lines) {
          const idx = l.indexOf(sep);
          const t = idx >= 0 ? l.slice(0, idx) : l;
          const d = idx >= 0 ? l.slice(idx + sep.length) : "";
          set.cards.push({ ...newCard(), term: esc(t.trim()), definition: esc(d.trim()) });
        }
        Store.touch(set);
        toast(`Đã thêm ${lines.length} thẻ`);
        route();
      }
    );
  }

  /* ===================== Study filters (dùng chung) ===================== */
  function allTags(set) {
    const s = new Set();
    set.cards.forEach((c) => c.tags.forEach((t) => s.add(t)));
    return [...s];
  }
  const usable = (c) => plainText(c.term) || plainText(c.definition) || (c.mc && c.choices.some((x) => plainText(x.html)));

  /* ===================== View: Study (lật thẻ) ===================== */
  function markUsed(set) { set.lastUsed = now(); Store.touch(set); }

  function viewStudy(app, set, filterFn) {
    markUsed(set);
    const opt = Object.assign({ shuffle: false, back: false, tag: "", onlyLearning: false }, lsGet("mc-study-opt", {}));
    let deck = [], idx = 0, flipped = false;
    const build = () => {
      const prog = Store.progress(set.id);
      let cards = set.cards.filter(usable);
      if (filterFn) cards = cards.filter(filterFn);
      if (opt.tag) cards = cards.filter((c) => c.tags.includes(opt.tag));
      if (opt.onlyLearning) cards = cards.filter((c) => prog[c.id]?.s !== "know");
      deck = opt.shuffle ? shuffle(cards) : cards;
      idx = 0;
      flipped = false;
    };
    const tags = allTags(set);
    app.innerHTML = `
      <div class="study-bar">
        <div><a href="#/">← Thư viện</a> · <b>${esc(set.title || "(Chưa đặt tên)")}</b></div>
        <div class="row">
          ${tags.length ? `<select class="text" id="optTag" style="width:auto"><option value="">Tất cả tag</option>${tags.map((t) => `<option ${opt.tag === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>` : ""}
          <label class="row" style="font-size:14px"><input type="checkbox" id="optShuffle" ${opt.shuffle ? "checked" : ""}> Trộn</label>
          <label class="row" style="font-size:14px"><input type="checkbox" id="optBack" ${opt.back ? "checked" : ""}> Hiện Definition trước</label>
          <label class="row" style="font-size:14px"><input type="checkbox" id="optLearning" ${opt.onlyLearning ? "checked" : ""}> Chỉ thẻ chưa thuộc</label>
          <button class="btn small" data-modes="${set.id}">☰ Chế độ</button>
          <a class="btn small" href="#/set/${set.id}/edit">Sửa</a>
        </div>
      </div>
      <div class="progress"><div id="bar"></div></div>
      <div id="stage"></div>`;
    const saveOpt = () => lsSet("mc-study-opt", opt);
    const onOpt = (k, v) => { opt[k] = v; saveOpt(); build(); draw(); };
    $("#optShuffle").onchange = (e) => onOpt("shuffle", e.target.checked);
    $("#optBack").onchange = (e) => onOpt("back", e.target.checked);
    $("#optLearning").onchange = (e) => onOpt("onlyLearning", e.target.checked);
    if ($("#optTag")) $("#optTag").onchange = (e) => onOpt("tag", e.target.value);

    const faceFront = (c) => {
      let h = `<div class="rich">${renderRich(c.term, "hide") || '<span class="muted">(trống)</span>'}</div>`;
      if (c.mc) {
        h += `<div class="mc-list">${c.choices.filter((x) => plainText(x.html)).map((x, i) => `<div><b>${String.fromCharCode(65 + i)}.</b> ${renderRich(x.html)}</div>`).join("")}</div>`;
      }
      return h;
    };
    const faceBack = (c) => {
      let h = "";
      if (clozeTexts(c.term).length) h += `<div class="rich" style="margin-bottom:12px">${renderRich(c.term, "reveal")}</div>`;
      if (c.mc) {
        const ok = c.choices.filter((x) => x.correct && plainText(x.html));
        h += `<div class="rich">${ok.map((x) => "✓ " + renderRich(x.html)).join("<br>") || '<span class="muted">(chưa chọn đáp án đúng)</span>'}</div>`;
        if (plainText(c.definition)) h += `<div class="rich muted" style="font-size:17px;margin-top:12px">${renderRich(c.definition)}</div>`;
      } else {
        h += `<div class="rich">${renderRich(c.definition) || (h ? "" : '<span class="muted">(trống)</span>')}</div>`;
      }
      return h;
    };

    const draw = () => {
      const stage = $("#stage");
      $("#bar").style.width = deck.length ? ((idx) / deck.length) * 100 + "%" : "0";
      if (!deck.length) {
        stage.innerHTML = `<div class="empty"><div class="big">🎉</div><p>${set.cards.filter(usable).length ? "Không còn thẻ nào khớp bộ lọc — có thể bạn đã thuộc hết!" : "Bộ này chưa có thẻ nào."}</p>
          <a class="btn primary" href="#/set/${set.id}/edit">Sửa bộ thẻ</a></div>`;
        return;
      }
      if (idx >= deck.length) {
        const prog = Store.progress(set.id);
        const known = deck.filter((c) => prog[c.id]?.s === "know").length;
        stage.innerHTML = `<div class="result-box"><div class="score">${known}/${deck.length}</div><p>thẻ đã thuộc trong lượt này</p>
          <div class="row" style="justify-content:center">
            <button class="btn" id="again">Học lại từ đầu</button>
            <button class="btn primary" id="learnRest">Học các thẻ chưa thuộc</button>
            <a class="btn" href="#/set/${set.id}/mode/mc">Làm bài kiểm tra</a></div></div>`;
        $("#again").onclick = () => { build(); draw(); };
        $("#learnRest").onclick = () => { $("#optLearning").checked = true; onOpt("onlyLearning", true); };
        $("#bar").style.width = "100%";
        return;
      }
      const c = deck[idx];
      const st = Store.progress(set.id)[c.id]?.s;
      const front = opt.back ? faceBack(c) : faceFront(c);
      const back = opt.back ? faceFront(c) : faceBack(c);
      const tagsHtml = c.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("");
      stage.innerHTML = `
        <div class="flip-scene"><div class="flip-card ${flipped ? "flipped" : ""}" id="fc">
          <div class="flip-face front"><span class="face-label">${opt.back ? "Definition" : "Term"}${st ? " · " + (st === "know" ? "✓ đã thuộc" : "đang học") : ""}</span>${front}<div class="face-tags">${tagsHtml}</div></div>
          <div class="flip-face back"><span class="face-label">${opt.back ? "Term" : "Definition"}</span>${back}<div class="face-tags">${tagsHtml}</div></div>
        </div></div>
        <div class="study-controls">
          <button class="btn" id="prev" ${idx === 0 ? "disabled" : ""}>←</button>
          <button class="btn learning" id="learning">✗ Chưa thuộc</button>
          <span class="counter">${idx + 1} / ${deck.length}</span>
          <button class="btn know" id="know">✓ Đã thuộc</button>
          <button class="btn" id="next">→</button>
        </div>
        <div class="hint">Phím tắt: Space = lật · ← → = chuyển thẻ · 1 = chưa thuộc · 2 = đã thuộc</div>`;
      fitCard();
      $("#fc").onclick = () => { flipped = !flipped; $("#fc").classList.toggle("flipped", flipped); };
      $("#prev").onclick = () => go(-1);
      $("#next").onclick = () => go(1);
      $("#know").onclick = () => mark("know");
      $("#learning").onclick = () => mark("learning");
    };
    const fitCard = () => {
      const fc = $("#fc");
      if (!fc) return;
      const h = Math.max(...$$(".flip-face", fc).map((f) => f.scrollHeight), 320);
      fc.style.minHeight = Math.min(h, 640) + "px";
    };
    const go = (d) => {
      const n = idx + d;
      if (n < 0) return;
      idx = n;
      flipped = false;
      draw();
    };
    const mark = (s) => { Store.setProgress(set.id, deck[idx].id, s); go(1); };
    const onKey = (e) => {
      if (e.target.closest("input, textarea, select, [contenteditable]")) return;
      if (idx >= deck.length) return;
      if (e.code === "Space") { e.preventDefault(); $("#fc")?.click(); }
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "1") mark("learning");
      else if (e.key === "2") mark("know");
    };
    document.addEventListener("keydown", onKey);
    cleanup = () => document.removeEventListener("keydown", onKey);
    build();
    draw();
  }

  /* ===================== View: Quiz (trắc nghiệm) ===================== */
  function buildQuestions(set, onlyIds, filterFn) {
    let cards = set.cards.filter(usable);
    if (filterFn) cards = cards.filter(filterFn);
    if (onlyIds) cards = cards.filter((c) => onlyIds.includes(c.id));
    const pool = set.cards.filter(usable);
    const answerOf = (c) => (plainText(c.definition) ? c.definition : clozeTexts(c.term).map(esc).join(", "));
    const qs = [];
    for (const c of shuffle(cards)) {
      if (c.mc) {
        const opts = c.choices.filter((x) => plainText(x.html));
        if (opts.length < 2 || !opts.some((x) => x.correct)) continue;
        qs.push({ card: c, prompt: renderRich(c.term, "hide"), options: shuffle(opts.map((x) => ({ html: renderRich(x.html), correct: x.correct }))), explain: c.definition });
        continue;
      }
      const ans = answerOf(c);
      if (!plainText(ans)) continue;
      const seen = new Set([plainText(ans).toLowerCase()]);
      const distract = [];
      for (const o of shuffle(pool)) {
        if (o === c || o.mc) continue;
        const a = answerOf(o);
        const k = plainText(a).toLowerCase();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        distract.push({ html: renderRich(a), correct: false });
        if (distract.length >= 3) break;
      }
      if (!distract.length) continue;
      const hasCloze = clozeTexts(c.term).length && !plainText(c.definition);
      qs.push({
        card: c,
        prompt: renderRich(c.term, "hide") + (hasCloze ? '<div class="muted" style="font-size:14px;margin-top:6px">Chọn từ điền vào chỗ trống</div>' : ""),
        options: shuffle([{ html: renderRich(ans), correct: true }, ...distract]),
        explain: "",
      });
    }
    return qs;
  }
  function viewQuiz(app, set, onlyIds, filterFn) {
    if (!onlyIds) markUsed(set);
    const qs = buildQuestions(set, onlyIds, filterFn);
    let i = 0, score = 0;
    const wrong = [];
    app.innerHTML = `
      <div class="study-bar">
        <div><a href="#/">← Thư viện</a> · <b>${esc(set.title || "(Chưa đặt tên)")}</b> · Kiểm tra</div>
        <div class="row"><button class="btn small" data-modes="${set.id}">☰ Chế độ</button><a class="btn small" href="#/set/${set.id}/edit">Sửa</a></div>
      </div>
      <div class="progress"><div id="bar"></div></div>
      <div id="stage"></div>`;
    const draw = () => {
      const stage = $("#stage");
      $("#bar").style.width = qs.length ? (i / qs.length) * 100 + "%" : "0";
      if (!qs.length) {
        stage.innerHTML = `<div class="empty"><div class="big">🧩</div><p>Cần ít nhất 2 thẻ có Definition (hoặc thẻ Multiple choice có đáp án đúng) để tạo câu hỏi.</p>
          <a class="btn primary" href="#/set/${set.id}/edit">Sửa bộ thẻ</a></div>`;
        return;
      }
      if (i >= qs.length) {
        const pct = Math.round((score / qs.length) * 100);
        stage.innerHTML = `<div class="result-box"><div class="score">${pct}%</div><p>Đúng ${score}/${qs.length} câu</p>
          <div class="row" style="justify-content:center">
            ${wrong.length ? `<button class="btn primary" id="retryWrong">Làm lại ${wrong.length} câu sai</button>` : ""}
            <button class="btn" id="retryAll">Làm lại tất cả</button>
            <a class="btn" href="#/set/${set.id}/mode/flashcards">Lật thẻ</a></div></div>`;
        if ($("#retryWrong")) $("#retryWrong").onclick = () => viewQuiz(app, set, wrong.slice(), filterFn);
        $("#retryAll").onclick = () => viewQuiz(app, set, null, filterFn);
        $("#bar").style.width = "100%";
        return;
      }
      const q = qs[i];
      stage.innerHTML = `<div class="quiz-q">
        <div class="muted" style="font-size:13px;margin-bottom:8px">Câu ${i + 1}/${qs.length}</div>
        <div class="prompt rich">${q.prompt}</div>
        <div class="quiz-options">${q.options.map((o, k) => `<button class="quiz-opt rich" data-k="${k}"><b>${k + 1}.</b> ${o.html}</button>`).join("")}</div>
        <div id="after"></div></div>
        <div class="hint">Phím tắt: 1–${q.options.length} để chọn · Enter để sang câu tiếp</div>`;
      $$(".quiz-opt", stage).forEach((b) => (b.onclick = () => answer(+b.dataset.k)));
    };
    let answered = false;
    const answer = (k) => {
      if (answered) return;
      answered = true;
      const q = qs[i];
      const ok = q.options[k].correct;
      if (ok) score++;
      else wrong.push(q.card.id);
      Store.setProgress(set.id, q.card.id, ok ? "know" : "learning");
      $$(".quiz-opt").forEach((b, j) => {
        b.disabled = true;
        if (q.options[j].correct) b.classList.add("correct");
        else if (j === k) b.classList.add("wrong");
      });
      const after = $("#after");
      after.innerHTML = `${plainText(q.explain) ? `<div class="rich muted" style="margin-top:14px">${renderRich(q.explain)}</div>` : ""}
        <div class="row" style="justify-content:flex-end;margin-top:14px"><span style="margin-right:auto;font-weight:600;color:${ok ? "var(--ok)" : "var(--danger)"}">${ok ? "✓ Chính xác!" : "✗ Chưa đúng"}</span>
        <button class="btn primary" id="nextQ">Tiếp →</button></div>`;
      $("#nextQ").onclick = next;
      $("#nextQ").focus();
    };
    const next = () => { i++; answered = false; draw(); };
    const onKey = (e) => {
      if (i >= qs.length) return;
      const n = parseInt(e.key, 10);
      if (!answered && n >= 1 && n <= qs[i].options.length) answer(n - 1);
      else if (answered && e.key === "Enter") { e.preventDefault(); next(); }
    };
    document.addEventListener("keydown", onKey);
    if (cleanup) cleanup();
    cleanup = () => document.removeEventListener("keydown", onKey);
    draw();
  }

  /* ===================== Màu nền ===================== */
  const BG_PRESETS = [
    ["Mặc định", "#f6f7fb"], ["Trắng", "#ffffff"], ["Kem", "#fdf6e3"], ["Vàng nhạt", "#fef9c3"], ["Hồng nhạt", "#fce7f3"],
    ["Xanh nhạt", "#e0f2fe"], ["Xanh lá nhạt", "#dcfce7"], ["Tím nhạt", "#ede9fe"], ["Xám", "#e5e7eb"], ["Tối", "#1f2430"],
  ];
  function applyTheme(t) {
    const bg = t.bg || "#f6f7fb";
    document.documentElement.style.setProperty("--bg", bg);
    // nền tối → đổi màu chữ / panel cho dễ đọc
    const m = bg.match(/^#([0-9a-f]{6})$/i);
    const rgb = m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : [246, 247, 251];
    const dark = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 < 128;
    document.body.classList.toggle("dark", dark);
    const img = t.img || lsGet("mc-theme-img", "");
    if (img) {
      const dim = Math.min(0.95, Math.max(0, (t.dim ?? 40) / 100));
      document.body.style.backgroundImage = `linear-gradient(rgba(${rgb.join(",")},${dim}), rgba(${rgb.join(",")},${dim})), url("${img}")`;
      document.body.classList.add("has-img");
    } else {
      document.body.style.backgroundImage = "";
      document.body.classList.remove("has-img");
    }
  }
  // Ảnh nền: thu nhỏ còn tối đa 1600px, nén JPEG rồi lưu trên máy (không đồng bộ lên Drive vì dung lượng)
  function bgChanged() { lsSet("mc-theme-img-ts", now()); if (Auth.user) Sync.schedule(); }
  function pickBgImage(onDone) {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      const img = new Image();
      img.onload = () => {
        const max = 1600, r = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement("canvas"); cv.width = Math.round(img.width * r); cv.height = Math.round(img.height * r);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        let q = 0.82, data = cv.toDataURL("image/jpeg", q);
        while (data.length > 2_500_000 && q > 0.4) { q -= 0.1; data = cv.toDataURL("image/jpeg", q); }
        try { localStorage.setItem("mc-theme-img", JSON.stringify(data)); } catch { toast("Ảnh quá lớn, hãy chọn ảnh nhỏ hơn"); return; }
        bgChanged();
        URL.revokeObjectURL(img.src);
        onDone(data);
      };
      img.onerror = () => toast("Không đọc được ảnh");
      img.src = URL.createObjectURL(f);
    };
    inp.click();
  }
  function openThemeDialog() {
    const cur = lsGet("mc-theme", {});
    const hasImg = !!lsGet("mc-theme-img", "");
    openDialog(
      `<h2>🎨 Màu nền</h2>
      <div class="bg-grid">${BG_PRESETS.map(([n, c]) => `<button type="button" class="bg-swatch ${cur.bg === c || (!cur.bg && c === "#f6f7fb") ? "on" : ""}" data-bg="${c}" style="background:${c}"><span>${n}</span></button>`).join("")}</div>
      <label class="row" style="margin-top:6px">Màu khác: <input type="color" id="bgCustom" value="${esc(cur.bg || "#f6f7fb")}"></label>
      <hr style="border:none;border-top:1px solid var(--border);width:100%">
      <label class="field-label">Ảnh nền</label>
      <div class="row">
        <button class="btn" value="img" type="submit">🖼 ${hasImg ? "Đổi ảnh" : "Chọn ảnh từ máy"}</button>
        ${hasImg ? `<button class="btn" value="noimg" type="submit">✕ Bỏ ảnh</button>` : ""}
      </div>
      <div class="row" id="dimRow" ${hasImg ? "" : 'style="display:none"'}><span style="font-size:14px">Làm mờ ảnh (phủ màu nền):</span><input type="range" id="dim" min="0" max="90" value="${cur.dim ?? 40}" style="flex:1"><b id="dimVal">${cur.dim ?? 40}%</b></div>
      <small class="muted">${Auth.user ? "Ảnh được đồng bộ lên Google Drive theo tài khoản của bạn." : "Chưa đăng nhập: ảnh chỉ lưu trên thiết bị này."}</small>
      <div class="actions"><button class="btn" value="reset">Mặc định</button><button class="btn primary" value="cancel">Xong</button></div>`,
      (form, action) => {
        if (action === "reset") { lsSet("mc-theme", {}); if (lsGet("mc-theme-img", "")) { lsDel("mc-theme-img"); bgChanged(); } applyTheme({}); setTimeout(openThemeDialog, 30); return true; }
        if (action === "img") { setTimeout(() => pickBgImage(() => { applyTheme(lsGet("mc-theme", {})); openThemeDialog(); }), 30); return true; }
        if (action === "noimg") { lsDel("mc-theme-img"); bgChanged(); applyTheme(lsGet("mc-theme", {})); setTimeout(openThemeDialog, 30); return true; }
      }
    );
    const form = $("#dialogForm");
    const save = (patch) => { const t = { ...lsGet("mc-theme", {}), ...patch }; lsSet("mc-theme", t); applyTheme(t); return t; };
    const pick = (bg) => { save({ bg }); $$(".bg-swatch", form).forEach((b) => b.classList.toggle("on", b.dataset.bg === bg)); };
    form.onclick = (e) => { const b = e.target.closest(".bg-swatch"); if (b) pick(b.dataset.bg); };
    $("#bgCustom", form).oninput = (e) => pick(e.target.value);
    $("#dim", form).oninput = (e) => { $("#dimVal", form).textContent = e.target.value + "%"; save({ dim: +e.target.value }); };
  }

  /* ===================== Boot ===================== */
  function boot() {
    Auth.init();
    Store.load(Auth.user?.email || null);
    renderAuth();
    $("#btnSettings").onclick = () => openSettings(false);
    applyTheme(lsGet("mc-theme", {}));
    $("#btnTheme").onclick = openThemeDialog;
    $("#syncStatus").onclick = () => { if (Auth.user && !Auth.valid()) Auth.login(); else Sync.now(); };
    $("#syncStatus").style.cursor = "pointer";
    window.addEventListener("hashchange", route);
    route();
    if (Auth.user) Sync.now();
    else Sync.status("Chưa đăng nhập — dữ liệu chỉ lưu trên máy này");
    // đồng bộ định kỳ và khi quay lại tab
    setInterval(() => { if (document.visibilityState === "visible") Sync.now(); }, CFG.AUTO_SYNC_SECONDS * 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") Sync.now();
      else if (Auth.valid()) Sync.now(); // đẩy thay đổi trước khi rời tab
    });
    // khởi tạo token client khi thư viện Google tải xong (để nút đăng nhập phản hồi nhanh)
    const wait = setInterval(() => { if (window.google?.accounts?.oauth2) { clearInterval(wait); if (Auth.clientId()) Auth.ensureClient(); } }, 300);
    setTimeout(() => clearInterval(wait), 15000);
  }

  // expose cho debug/test
  window.MeoCards = {
    Store, Sync, Auth, mergeData, sanitize, renderRich, plainText, clozeTexts, esc, shuffle, toast, uid, now,
    lsGet, lsSet, openDialog, confirmDialog, usable, allTags, markUsed, viewStudy, viewQuiz, route, $, $$,
    setCleanup: (fn) => { if (cleanup) cleanup(); cleanup = fn; },
  };
  boot();
})();
