/* ===========================================================
   EĞİTMEN PLATFORMU - Frontend (LocalStorage Cache + Hızlandırılmış UI)
   =========================================================== */

const API_URL = "https://script.google.com/macros/s/AKfycbxv_irFUNcb9W9qaojfdYNc3k9r1KWl-MuB-vNwgvSNIbbjTlcFUYcy7JKp-HO8SctMlg/exec";

// ---------- Durum ----------
const state = {
  role: null, user: null, token: null,
  currentCourseId: null, currentCourseName: "",
  currentLessonId: null, currentLessonTitle: ""
};

// ---------- CACHE (LocalStorage entegrasyonlu - Anında açılma) ----------
const cache = {
  courses: null,
  lessons: {},
  materials: {},
  instructors: null,
  
  load() {
    try {
      const data = JSON.parse(localStorage.getItem("app_cache_v2"));
      if (data) {
        this.courses = data.courses;
        this.lessons = data.lessons || {};
        this.instructors = data.instructors;
      }
    } catch(e){}
  },
  
  save() {
    try {
      localStorage.setItem("app_cache_v2", JSON.stringify({
        courses: this.courses,
        lessons: this.lessons,
        // materials çok büyük olduğu için LocalStorage'a kaydetmiyoruz (Kota aşımını önler)
        // Sadece RAM'de (bellekte) tutulur.
        instructors: this.instructors
      }));
    } catch (err) {
      console.warn("Önbellek boyutu aşıldı, kayıt atlandı.");
    }
  },
  
  invalidate(...keys) {
    keys.forEach(k => {
      if (k === "courses") this.courses = null;
      else if (k === "instructors") this.instructors = null;
      else if (k === "allLessons") this.lessons = {};
      else if (k === "allMaterials") this.materials = {};
      else if (k.startsWith("lessons:")) delete this.lessons[k.slice(8)];
      else if (k.startsWith("material:")) delete this.materials[k.slice(9)];
    });
    this.save();
  }
};

let quill = null;

// ---------- Akıllı yükleyici ----------
let loaderCount = 0;
let loaderTimer = null;
function showLoader(on) {
  if (on) {
    loaderCount++;
    if (loaderCount === 1) {
      loaderTimer = setTimeout(() => {
        $("#loader").classList.remove("hidden");
      }, 300);
    }
  } else {
    loaderCount = Math.max(0, loaderCount - 1);
    if (loaderCount === 0) {
      clearTimeout(loaderTimer);
      $("#loader").classList.add("hidden");
    }
  }
}

// ---------- API ----------
async function api(action, payload = {}, opts = {}) {
  const silent = opts.silent === true;
  if (!silent) showLoader(true);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, token: state.token, ...payload })
    });
    const data = await res.json();
    if (data.ok === false) throw new Error(data.error || "Bilinmeyen hata.");
    return data;
  } finally {
    if (!silent) showLoader(false);
  }
}

// ---------- UI YARDIMCILARI ----------
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

function toast(msg, type = "") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast show " + type;
  setTimeout(() => el.className = "toast", 3000);
}

function show(viewId) {
  $$(".view").forEach(v => v.classList.remove("active"));
  $("#" + viewId).classList.add("active");
  $("#topbar").classList.toggle("hidden", viewId === "view-login");
  window.scrollTo(0, 0);
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function setBreadcrumbs(paths) {
  const b = $("#breadcrumbs");
  b.innerHTML = paths.map((p, i) => {
    if (i === paths.length - 1) return p;
    return `<span>${p} / </span>`;
  }).join(" ");
}

function setTopbarActions(html) {
  $("#topbarActions").innerHTML = html;
}

// ---------- OTURUM ----------
function saveSession() {
  localStorage.setItem("session", JSON.stringify({ role: state.role, user: state.user, token: state.token }));
}
function loadSession() {
  const raw = localStorage.getItem("session");
  if (!raw) return false;
  try {
    const s = JSON.parse(raw);
    if (!s.role) return false;
    state.role = s.role; state.user = s.user; state.token = s.token;
    return true;
  } catch { return false; }
}
function clearSession() {
  localStorage.removeItem("session");
  cache.invalidate("courses", "instructors", "allLessons", "allMaterials");
}

// ---------- LOGIN ----------
function setupLogin() {
  $$("#view-login .tab").forEach(t => {
    t.addEventListener("click", () => {
      $$("#view-login .tab").forEach(x => x.classList.remove("active"));
      $$(".login-form").forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      $("#" + t.dataset.tab + "Form").classList.add("active");
      $("#loginError").textContent = "";
    });
  });

  $("#instructorForm").addEventListener("submit", async e => {
    e.preventDefault();
    $("#loginError").textContent = "";
    try {
      const res = await api("instructorLogin", {
        email: $("#insEmail").value,
        password: $("#insPassword").value
      });
      state.role = "instructor"; state.user = res.user; state.token = res.token;
      saveSession();
      enterApp();
    } catch (err) { $("#loginError").textContent = err.message; }
  });

  $("#adminForm").addEventListener("submit", async e => {
    e.preventDefault();
    $("#loginError").textContent = "";
    try {
      const res = await api("adminLogin", { password: $("#adminPassword").value });
      state.role = "admin"; state.user = { name: "Admin" }; state.token = res.token;
      saveSession();
      enterApp();
    } catch (err) { $("#loginError").textContent = err.message; }
  });
}

function setupLogout() {
  $("#logoutBtn").addEventListener("click", () => {
    clearSession();
    state.role = null; state.user = null; state.token = null;
    document.body.classList.add("login-mode");
    $("#nav-admin").classList.add("hidden");
    show("view-login");
  });
  
  // Navigation
  $("#nav-courses").addEventListener("click", (e) => {
    e.preventDefault();
    $$(".nav-item").forEach(x => x.classList.remove("active"));
    $("#nav-courses").classList.add("active");
    openCourses();
  });
  
  $("#nav-admin").addEventListener("click", (e) => {
    e.preventDefault();
    $$(".nav-item").forEach(x => x.classList.remove("active"));
    $("#nav-admin").classList.add("active");
    openAdmin();
  });
}

async function enterApp() {
  document.body.classList.remove("login-mode");
  $("#userLabel").textContent = state.user?.name || "Kullanıcı";
  if(state.user?.name) {
    $("#userAvatar").textContent = state.user.name.charAt(0).toUpperCase();
  }
  
  if (state.role === "admin") {
    $("#nav-admin").classList.remove("hidden");
  } else {
    $("#nav-admin").classList.add("hidden");
  }

  // İlk yüklemede cache'den göster
  if (state.role === "admin") openAdmin();
  else openCourses();

  // Arka planda tüm veriyi çek ve yenile
  bootstrap().then(() => {
    // refresh current view
    if (state.role === "admin" && $("#view-admin").classList.contains("active")) openAdmin();
    else if ($("#view-courses").classList.contains("active")) openCourses();
  });
}

// ============= BOOTSTRAP (toplu yükleme) =============
async function bootstrap() {
  try {
    const res = await api("bootstrap", { role: state.role }, { silent: true });
    cache.courses    = res.courses || [];
    cache.lessons    = res.lessonsByCourse || {};
    cache.materials  = res.materialsByLesson || {};
    if (res.instructors) cache.instructors = res.instructors;
    cache.save();
  } catch (e) {
    console.warn("Bootstrap hatası:", e.message);
  }
}

// ============= EĞİTMEN AKIŞI (Kodland Style) =============

async function openCourses() {
  show("view-courses");
  setBreadcrumbs(["Mena", "Kurslarımız"]);
  setTopbarActions("");
  $$(".nav-item").forEach(x => x.classList.remove("active"));
  $("#nav-courses").classList.add("active");

  if (cache.courses) {
    renderCourses(cache.courses);
    return;
  }
  try {
    const res = await api("getCourses");
    cache.courses = res.data;
    cache.save();
    renderCourses(res.data);
  } catch (e) { toast(e.message, "error"); }
}

function renderCourses(list) {
  const wrap = $("#coursesList");
  if (!list.length) { wrap.innerHTML = `<p class="muted">Henüz kurs eklenmemiş.</p>`; return; }
  
  wrap.innerHTML = list.map(c => `
    <div class="list-item" data-id="${c.id}">
      <div class="list-item-title"><span class="icon">📁</span> ${escapeHtml(c.name)}</div>
      <div class="list-item-meta">${escapeHtml(c.description || "Açıklama bulunmuyor.")} • ${c.id.slice(0,4).toUpperCase()} kodlu kurs</div>
    </div>
  `).join("");
  
  wrap.querySelectorAll(".list-item").forEach(item => {
    item.addEventListener("click", () => {
      const c = list.find(x => x.id === item.dataset.id);
      openLessons(c.id, c.name);
    });
  });
}

async function openLessons(courseId, courseName) {
  state.currentCourseId = courseId;
  state.currentCourseName = courseName;
  show("view-lessons");
  setBreadcrumbs(["Mena", "Kurslarımız", courseName]);
  setTopbarActions(`<button class="btn btn-back" onclick="openCourses()">← Geri Dön</button>`);
  $("#lessonsTitle").textContent = courseName;

  if (cache.lessons[courseId]) {
    renderLessons(cache.lessons[courseId]);
    return;
  }
  try {
    const res = await api("getLessons", { courseId });
    cache.lessons[courseId] = res.data;
    cache.save();
    renderLessons(res.data);
  } catch (e) { toast(e.message, "error"); }
}

function renderLessons(list) {
  const wrap = $("#lessonsList");
  if (!list.length) { wrap.innerHTML = `<p class="muted">Bu kursta henüz ders yok.</p>`; return; }
  
  wrap.innerHTML = list.map((l, i) => `
    <div class="list-item" data-id="${l.id}" data-title="${escapeHtml(l.title)}">
      <div class="list-item-title"><span class="icon">📄</span> ${escapeHtml(l.title)}</div>
      <div class="list-item-meta">Sıra: ${i + 1} • Görüntülemek için tıklayın</div>
    </div>
  `).join("");
  
  wrap.querySelectorAll(".list-item").forEach(item => {
    item.addEventListener("click", () => openMaterial(item.dataset.id, item.dataset.title));
  });
}

async function openMaterial(lessonId, title) {
  state.currentLessonId = lessonId;
  state.currentLessonTitle = title;
  show("view-material");
  setBreadcrumbs(["Mena", "Kurslarımız", state.currentCourseName, title]);
  setTopbarActions(`<button class="btn btn-back" onclick="openLessons(state.currentCourseId, state.currentCourseName)">← Derslere Dön</button>`);
  
  $("#materialTitle").textContent = title;

  if (cache.materials[lessonId]) {
    const m = cache.materials[lessonId];
    $("#materialContent").innerHTML = m.content || `<p class="muted">İçerik bulunamadı.</p>`;
    return;
  }
  try {
    const res = await api("getMaterials", { lessonId });
    cache.materials[lessonId] = res.data || {};
    cache.save();
    $("#materialContent").innerHTML = (res.data && res.data.content) || `<p class="muted">İçerik bulunamadı.</p>`;
  } catch (e) { toast(e.message, "error"); }
}

// ============= ADMIN AKIŞI =============

function setupAdminTabs() {
  $$("[data-admintab]").forEach(t => {
    t.addEventListener("click", () => {
      $$("#view-admin .tab").forEach(x => x.classList.remove("active"));
      $$(".admin-tab").forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      $("#admin-" + t.dataset.admintab).classList.add("active");
      if (t.dataset.admintab === "instructors") loadInstructors();
      else loadAdminCourses();
    });
  });
}

async function openAdmin() {
  if (state.role !== "admin") {
    toast("Güvenlik: Bu alana erişim yetkiniz yok.", "error");
    return;
  }
  show("view-admin");
  setBreadcrumbs(["Yönetim", "Admin Paneli"]);
  setTopbarActions("");
  
  $$("#view-admin .tab").forEach(x => x.classList.remove("active"));
  $$(".admin-tab").forEach(x => x.classList.remove("active"));
  $('[data-admintab="courses"]').classList.add("active");
  $("#admin-courses").classList.add("active");
  
  await loadAdminCourses();
}

async function loadAdminCourses() {
  if (cache.courses) {
    renderAdminCourses(cache.courses);
    return;
  }
  try {
    const res = await api("getCourses");
    cache.courses = res.data;
    cache.save();
    renderAdminCourses(res.data);
  } catch (e) { toast(e.message, "error"); }
}

function renderAdminCourses(list) {
  const wrap = $("#adminCoursesList");
  if (!list.length) { wrap.innerHTML = `<p class="muted">Kayıtlı kurs bulunamadı.</p>`; return; }
  
  wrap.innerHTML = list.map(c => `
    <div class="admin-row" data-id="${c.id}">
      <div class="info">
        <strong>${escapeHtml(c.name)}</strong>
        <small>${escapeHtml(c.description || "")}</small>
      </div>
      <div class="actions">
        <button class="btn btn-primary btn-sm" data-act="open">Yönet</button>
        <button class="btn btn-ghost btn-sm" data-act="edit">Düzenle</button>
        <button class="btn btn-danger btn-sm" data-act="delete">Sil</button>
      </div>
    </div>
  `).join("");

  wrap.querySelectorAll(".admin-row").forEach(row => {
    const id = row.dataset.id;
    const c = list.find(x => x.id === id);
    row.querySelector('[data-act="open"]').addEventListener("click", () => openAdminCourse(c.id, c.name));
    row.querySelector('[data-act="edit"]').addEventListener("click", async () => {
      const newName = prompt("Kurs adı:", c.name);
      if (newName === null) return;
      const newDesc = prompt("Açıklama:", c.description || "");
      if (newDesc === null) return;
      try {
        await api("updateCourse", { id: c.id, name: newName, description: newDesc });
        cache.invalidate("courses");
        toast("Güncellendi", "success");
        loadAdminCourses();
      } catch (e) { toast(e.message, "error"); }
    });
    row.querySelector('[data-act="delete"]').addEventListener("click", async () => {
      if (!confirm(`"${c.name}" kursunu ve tüm derslerini silmek istiyor musun?`)) return;
      try {
        await api("deleteCourse", { id: c.id });
        cache.invalidate("courses", "lessons:" + c.id);
        toast("Silindi", "success");
        loadAdminCourses();
      } catch (e) { toast(e.message, "error"); }
    });
  });
}

function setupAddCourse() {
  $("#addCourseForm").addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await api("addCourse", {
        name: $("#newCourseName").value,
        description: $("#newCourseDesc").value
      });
      cache.invalidate("courses");
      $("#newCourseName").value = "";
      $("#newCourseDesc").value = "";
      toast("Kurs eklendi", "success");
      loadAdminCourses();
    } catch (e) { toast(e.message, "error"); }
  });
}

async function openAdminCourse(courseId, courseName) {
  state.currentCourseId = courseId;
  state.currentCourseName = courseName;
  show("view-admin-course");
  setBreadcrumbs(["Yönetim", "Kurs Detayı", courseName]);
  setTopbarActions(`<button class="btn btn-back" onclick="openAdmin()">← Geri Dön</button>`);
  
  $("#adminCourseTitle").textContent = courseName + " - Dersler";
  await loadAdminLessons();
}

async function loadAdminLessons() {
  const courseId = state.currentCourseId;
  if (cache.lessons[courseId]) {
    renderAdminLessons(cache.lessons[courseId]);
    return;
  }
  try {
    const res = await api("getLessons", { courseId });
    cache.lessons[courseId] = res.data;
    cache.save();
    renderAdminLessons(res.data);
  } catch (e) { toast(e.message, "error"); }
}

function renderAdminLessons(list) {
  const wrap = $("#adminLessonsList");
  if (!list.length) { wrap.innerHTML = `<p class="muted">Henüz ders yok.</p>`; return; }
  
  wrap.innerHTML = list.map((l, i) => `
    <div class="admin-row" data-id="${l.id}">
      <div class="info">
        <strong>${i + 1}. ${escapeHtml(l.title)}</strong>
        <small>Sıra: ${l.order || "-"}</small>
      </div>
      <div class="actions">
        <button class="btn btn-primary btn-sm" data-act="material">Materyal</button>
        <button class="btn btn-ghost btn-sm" data-act="edit">Düzenle</button>
        <button class="btn btn-danger btn-sm" data-act="delete">Sil</button>
      </div>
    </div>
  `).join("");

  wrap.querySelectorAll(".admin-row").forEach(row => {
    const id = row.dataset.id;
    const l = list.find(x => x.id === id);
    row.querySelector('[data-act="material"]').addEventListener("click", () => openAdminMaterial(l.id, l.title));
    row.querySelector('[data-act="edit"]').addEventListener("click", async () => {
      const t = prompt("Ders adı:", l.title);
      if (t === null) return;
      const o = prompt("Sıra numarası:", l.order || "");
      if (o === null) return;
      try {
        await api("updateLesson", { id: l.id, title: t, order: Number(o) || l.order });
        cache.invalidate("lessons:" + state.currentCourseId);
        toast("Güncellendi", "success");
        loadAdminLessons();
      } catch (e) { toast(e.message, "error"); }
    });
    row.querySelector('[data-act="delete"]').addEventListener("click", async () => {
      if (!confirm(`"${l.title}" dersini silmek istiyor musun?`)) return;
      try {
        await api("deleteLesson", { id: l.id });
        cache.invalidate("lessons:" + state.currentCourseId, "material:" + l.id);
        toast("Silindi", "success");
        loadAdminLessons();
      } catch (e) { toast(e.message, "error"); }
    });
  });
}

function setupAddLesson() {
  $("#addLessonForm").addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await api("addLesson", {
        courseId: state.currentCourseId,
        title: $("#newLessonTitle").value
      });
      cache.invalidate("lessons:" + state.currentCourseId);
      $("#newLessonTitle").value = "";
      toast("Ders eklendi", "success");
      loadAdminLessons();
    } catch (e) { toast(e.message, "error"); }
  });
}

// ============= MATERYAL EDİTÖRÜ (Fotoğraf altı yazı düzeltildi) =============

function ensureQuill() {
  if (quill) return quill;
  quill = new Quill('#materialEditor', {
    theme: 'snow',
    placeholder: 'İçeriği yazmaya başla... Resim eklerseniz altına yazı yazabilmek için ekstra butonu kullanın.',
    modules: {
      toolbar: [
        [{ 'font': [] }, { 'size': ['small', false, 'large', 'huge'] }],
        [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ 'color': [] }, { 'background': [] }],
        [{ 'script': 'sub'}, { 'script': 'super' }],
        [{ 'list': 'ordered'}, { 'list': 'bullet' }, { 'indent': '-1'}, { 'indent': '+1' }],
        [{ 'direction': 'rtl' }, { 'align': [] }],
        ['blockquote', 'code-block'],
        ['link', 'image', 'video'],
        ['clean']
      ]
    }
  });
  return quill;
}

async function openAdminMaterial(lessonId, title) {
  state.currentLessonId = lessonId;
  state.currentLessonTitle = title;
  show("view-admin-material");
  setBreadcrumbs(["Yönetim", "İçerik Editörü", title]);
  setTopbarActions(`
    <button id="previewBtn" class="btn btn-ghost btn-sm">👁 Önizle</button>
    <button id="saveBtn" class="btn btn-primary btn-sm">💾 Kaydet</button>
    <button class="btn btn-back" onclick="openAdminCourse(state.currentCourseId, state.currentCourseName)">← Dön</button>
  `);
  
  $("#adminMaterialTitle").textContent = title + " - Materyal";
  $("#materialPreview").style.display = "none";
  $("#materialEditor").style.display = "block";

  ensureQuill();
  
  // Custom button bindings from topbar
  $("#saveBtn").addEventListener("click", saveMaterialAction);
  $("#previewBtn").addEventListener("click", togglePreviewAction);

  if (cache.materials[lessonId]) {
    quill.root.innerHTML = cache.materials[lessonId].content || "";
    return;
  }
  try {
    const res = await api("getMaterials", { lessonId });
    cache.materials[lessonId] = res.data || {};
    cache.save();
    quill.root.innerHTML = res.data?.content || "";
  } catch (e) { toast(e.message, "error"); }
}

async function saveMaterialAction() {
  if (!quill) return;
  const html = quill.root.innerHTML;
  try {
    await api("saveMaterial", {
      lessonId: state.currentLessonId,
      content: html,
      type: "html"
    });
    cache.materials[state.currentLessonId] = { content: html, type: "html" };
    cache.save();
    toast("Materyal başarıyla kaydedildi", "success");
  } catch (e) { toast(e.message, "error"); }
}

function togglePreviewAction() {
  if (!quill) return;
  const p = $("#materialPreview");
  const e = $("#materialEditor");
  if (p.style.display === "none") {
    p.innerHTML = quill.root.innerHTML;
    p.style.display = "block";
    e.style.display = "none";
    $("#previewBtn").textContent = "✏️ Düzenle";
  } else {
    p.style.display = "none";
    e.style.display = "block";
    $("#previewBtn").textContent = "👁 Önizle";
  }
}

function setupMaterialEditor() {
  $("#insertYoutubeBtn").addEventListener("click", () => {
    if (!quill) return;
    const url = prompt("YouTube video URL'si:");
    if (!url) return;
    const embedUrl = toYoutubeEmbed(url);
    if (!embedUrl) { toast("Geçersiz YouTube linki.", "error"); return; }
    const range = quill.getSelection(true) || { index: quill.getLength() };
    quill.insertEmbed(range.index, 'video', embedUrl, 'user');
    quill.insertText(range.index + 1, '\n', 'user');
    quill.setSelection(range.index + 2);
  });

  $("#insertGeniallyBtn").addEventListener("click", () => {
    if (!quill) return;
    const url = prompt("Genially URL'si:");
    if (!url) return;
    const range = quill.getSelection(true) || { index: quill.getLength() };
    quill.insertEmbed(range.index, 'video', url, 'user');
    quill.insertText(range.index + 1, '\n', 'user');
    quill.setSelection(range.index + 2);
  });

  $("#insertPdfBtn").addEventListener("click", () => {
    if (!quill) return;
    const url = prompt("PDF/Drive linkini yapıştır:");
    if (!url) return;
    const text = prompt("Görünecek metin:", "📄 Ders Notları (PDF)") || "📄 PDF";
    const range = quill.getSelection(true) || { index: quill.getLength() };
    quill.insertText(range.index, text, { link: url }, 'user');
    quill.insertText(range.index + text.length, '\n', 'user');
    quill.setSelection(range.index + text.length + 1);
  });

  // GÖRSELİN ALTINA YAZILAMAMA PROBLEMİ İÇİN FIX
  $("#insertImgBtn").addEventListener("click", () => {
    if (!quill) return;
    const url = prompt("Görselin tam URL'sini yapıştır (örn. https://site.com/resim.png):");
    if (!url) return;
    
    // Geçerli bir seçim yoksa sona ekle
    let range = quill.getSelection();
    if (!range) range = { index: quill.getLength() };
    
    // Görseli ekle
    quill.insertEmbed(range.index, 'image', url, 'user');
    // Hemen ardından yeni bir boş paragraf satırı ekle ki altına yazılabilsin
    quill.insertText(range.index + 1, '\n\n', 'user');
    // İmleci resmin altındaki yeni satıra konumlandır
    quill.setSelection(range.index + 2);
    
    toast("Resim eklendi. Hemen altından yazmaya devam edebilirsiniz.", "success");
  });
}

function toYoutubeEmbed(url) {
  try {
    const u = new URL(url);
    let id = "";
    if (u.hostname.includes("youtu.be")) id = u.pathname.slice(1);
    else if (u.hostname.includes("youtube.com")) {
      if (u.pathname === "/watch") id = u.searchParams.get("v");
      else if (u.pathname.startsWith("/embed/")) id = u.pathname.split("/")[2];
      else if (u.pathname.startsWith("/shorts/")) id = u.pathname.split("/")[2];
    }
    if (!id) return null;
    return "https://www.youtube.com/embed/" + id;
  } catch { return null; }
}

// ============= EĞİTMENLER =============

async function loadInstructors() {
  if (cache.instructors) {
    renderInstructors(cache.instructors);
    return;
  }
  try {
    const res = await api("getInstructors");
    cache.instructors = res.data;
    cache.save();
    renderInstructors(res.data);
  } catch (e) { toast(e.message, "error"); }
}

function renderInstructors(list) {
  const wrap = $("#adminInstructorsList");
  if (!list.length) { wrap.innerHTML = `<p class="muted">Henüz eğitmen eklenmemiş.</p>`; return; }
  
  wrap.innerHTML = list.map(u => `
    <div class="admin-row" data-id="${u.id}">
      <div class="info">
        <strong>${escapeHtml(u.name)}</strong>
        <small>${escapeHtml(u.email)} &nbsp;·&nbsp; Şifre: <code>${escapeHtml(u.password)}</code></small>
      </div>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" data-act="edit">Düzenle</button>
        <button class="btn btn-danger btn-sm" data-act="delete">Sil</button>
      </div>
    </div>
  `).join("");

  wrap.querySelectorAll(".admin-row").forEach(row => {
    const id = row.dataset.id;
    const u = list.find(x => x.id === id);
    row.querySelector('[data-act="edit"]').addEventListener("click", async () => {
      const name = prompt("Ad Soyad:", u.name);
      if (name === null) return;
      const email = prompt("E-posta:", u.email);
      if (email === null) return;
      const password = prompt("Yeni şifre (boş bırakırsan değişmez):", "");
      try {
        await api("updateInstructor", { id: u.id, name, email, password });
        cache.invalidate("instructors");
        toast("Güncellendi", "success");
        loadInstructors();
      } catch (e) { toast(e.message, "error"); }
    });
    row.querySelector('[data-act="delete"]').addEventListener("click", async () => {
      if (!confirm(`${u.name} adlı eğitmeni silmek istiyor musun?`)) return;
      try {
        await api("deleteInstructor", { id: u.id });
        cache.invalidate("instructors");
        toast("Silindi", "success");
        loadInstructors();
      } catch (e) { toast(e.message, "error"); }
    });
  });
}

function setupAddInstructor() {
  $("#addInstructorForm").addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await api("addInstructor", {
        name: $("#newInsName").value,
        email: $("#newInsEmail").value,
        password: $("#newInsPassword").value
      });
      cache.invalidate("instructors");
      $("#newInsName").value = "";
      $("#newInsEmail").value = "";
      $("#newInsPassword").value = "";
      toast("Eğitmen eklendi", "success");
      loadInstructors();
    } catch (e) { toast(e.message, "error"); }
  });
}

// ============= BAŞLATMA =============
document.addEventListener("DOMContentLoaded", () => {
  cache.load(); // İlk açılışta verileri ram'e al
  
  setupLogin();
  setupLogout();
  setupAdminTabs();
  setupAddCourse();
  setupAddLesson();
  setupMaterialEditor();
  setupAddInstructor();

  if (loadSession()) enterApp();
  else {
    document.body.classList.add("login-mode");
    show("view-login");
  }
});
