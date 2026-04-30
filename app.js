/* ===========================================================
   EĞİTMEN PLATFORMU - Frontend (cache + akıllı yükleyici)
   =========================================================== */

const API_URL = "https://script.google.com/macros/s/AKfycbxv_irFUNcb9W9qaojfdYNc3k9r1KWl-MuB-vNwgvSNIbbjTlcFUYcy7JKp-HO8SctMlg/exec";

// ---------- Durum ----------
const state = {
  role: null, user: null,
  currentCourseId: null, currentCourseName: "",
  currentLessonId: null, currentLessonTitle: ""
};

// ---------- CACHE ----------
const cache = {
  courses: null,             // Kurs listesi
  lessons: {},               // courseId -> ders listesi
  materials: {},             // lessonId -> { content, type }
  instructors: null,         // Eğitmen listesi
  invalidate(...keys) {
    keys.forEach(k => {
      if (k === "courses") this.courses = null;
      else if (k === "instructors") this.instructors = null;
      else if (k === "allLessons") this.lessons = {};
      else if (k === "allMaterials") this.materials = {};
      else if (k.startsWith("lessons:")) delete this.lessons[k.slice(8)];
      else if (k.startsWith("material:")) delete this.materials[k.slice(9)];
    });
  }
};

let quill = null;

// ---------- Akıllı yükleyici (250ms gecikmeli) ----------
let loaderCount = 0;
let loaderTimer = null;
function showLoader(on) {
  if (on) {
    loaderCount++;
    if (loaderCount === 1) {
      loaderTimer = setTimeout(() => {
        $("#loader").classList.remove("hidden");
      }, 250);
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
  if (!API_URL || API_URL.includes("BURAYA_GOOGLE")) {
    throw new Error("API_URL ayarlı değil. app.js içinde API_URL'yi düzenle.");
  }
  const silent = opts.silent === true;
  if (!silent) showLoader(true);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...payload })
    });
    const data = await res.json();
    if (data.ok === false) throw new Error(data.error || "Bilinmeyen hata.");
    return data;
  } finally {
    if (!silent) showLoader(false);
  }
}

// ---------- UI ----------
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

function toast(msg, type = "") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast show " + type;
  setTimeout(() => el.className = "toast", 2400);
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

// ---------- Oturum ----------
function saveSession() {
  localStorage.setItem("session", JSON.stringify({ role: state.role, user: state.user }));
}
function loadSession() {
  const raw = localStorage.getItem("session");
  if (!raw) return false;
  try {
    const s = JSON.parse(raw);
    if (!s.role) return false;
    state.role = s.role; state.user = s.user;
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
      state.role = "instructor"; state.user = res.user;
      saveSession();
      enterApp();
    } catch (err) { $("#loginError").textContent = err.message; }
  });

  $("#adminForm").addEventListener("submit", async e => {
    e.preventDefault();
    $("#loginError").textContent = "";
    try {
      await api("adminLogin", { password: $("#adminPassword").value });
      state.role = "admin"; state.user = { name: "Admin" };
      saveSession();
      enterApp();
    } catch (err) { $("#loginError").textContent = err.message; }
  });
}

function setupLogout() {
  $("#logoutBtn").addEventListener("click", () => {
    clearSession();
    state.role = null; state.user = null;
    location.reload();
  });
  $("#brandClick").addEventListener("click", () => {
    if (state.role === "admin") openAdmin();
    else openCourses();
  });
}

function setupBackButtons() {
  $$("[data-back]").forEach(b => {
    b.addEventListener("click", () => {
      const target = b.dataset.back;
      if (target === "courses") openCourses();
      else if (target === "lessons") openLessons(state.currentCourseId, state.currentCourseName);
      else if (target === "admin") openAdmin();
    });
  });
  $("#backToAdminCourse").addEventListener("click", () => {
    openAdminCourse(state.currentCourseId, state.currentCourseName);
  });
}

async function enterApp() {
  $("#userLabel").textContent = state.user?.name
    ? `${state.user.name}${state.role === "admin" ? " (Admin)" : ""}`
    : "";
  // Tek istekte tüm veriyi çek -> sonraki navigasyon anında olur
  await bootstrap();
  if (state.role === "admin") openAdmin();
  else openCourses();
}

// ============= BOOTSTRAP (toplu yükleme) =============
async function bootstrap() {
  try {
    const res = await api("bootstrap", { role: state.role });
    cache.courses    = res.courses || [];
    cache.lessons    = res.lessonsByCourse || {};
    cache.materials  = res.materialsByLesson || {};
    if (res.instructors) cache.instructors = res.instructors;
  } catch (e) {
    // Backend güncellenmemişse veya hata olursa eski akış devreye girer
    console.warn("Bootstrap atlandı:", e.message);
  }
}

// ============= EĞİTMEN AKIŞI (cache'li) =============

async function openCourses() {
  show("view-courses");
  // 1) Cache varsa anında göster
  if (cache.courses) {
    renderCourses(cache.courses);
    // 2) Arka planda sessizce yenile
    api("getCourses", {}, { silent: true })
      .then(res => {
        cache.courses = res.data;
        renderCourses(res.data);
      }).catch(() => {});
    return;
  }
  // İlk yükleme
  try {
    const res = await api("getCourses");
    cache.courses = res.data;
    renderCourses(res.data);
  } catch (e) { toast(e.message, "error"); }
}

function renderCourses(list) {
  const grid = $("#coursesGrid");
  if (!list.length) { grid.innerHTML = `<p class="muted">Henüz kurs eklenmemiş.</p>`; return; }
  grid.innerHTML = list.map(c => `
    <div class="course-card" data-id="${c.id}">
      <h3>${escapeHtml(c.name)}</h3>
      <p>${escapeHtml(c.description || "")}</p>
    </div>
  `).join("");
  grid.querySelectorAll(".course-card").forEach(card => {
    card.addEventListener("click", () => {
      const c = list.find(x => x.id === card.dataset.id);
      openLessons(c.id, c.name);
    });
  });
}

async function openLessons(courseId, courseName) {
  state.currentCourseId = courseId;
  state.currentCourseName = courseName;
  show("view-lessons");
  $("#lessonsTitle").textContent = courseName;

  if (cache.lessons[courseId]) {
    renderLessons(cache.lessons[courseId]);
    api("getLessons", { courseId }, { silent: true })
      .then(res => { cache.lessons[courseId] = res.data; renderLessons(res.data); })
      .catch(() => {});
    return;
  }
  try {
    const res = await api("getLessons", { courseId });
    cache.lessons[courseId] = res.data;
    renderLessons(res.data);
  } catch (e) { toast(e.message, "error"); }
}

function renderLessons(list) {
  const wrap = $("#lessonsList");
  if (!list.length) { wrap.innerHTML = `<p class="muted">Bu kursta henüz ders yok.</p>`; return; }
  wrap.innerHTML = list.map((l, i) => `
    <div class="lesson-item" data-id="${l.id}" data-title="${escapeHtml(l.title)}">
      <div><span class="num">${i + 1}</span><strong>${escapeHtml(l.title)}</strong></div>
      <span style="color:var(--muted);font-size:13px;">→</span>
    </div>
  `).join("");
  wrap.querySelectorAll(".lesson-item").forEach(item => {
    item.addEventListener("click", () => openMaterial(item.dataset.id, item.dataset.title));
  });
}

async function openMaterial(lessonId, title) {
  state.currentLessonId = lessonId;
  state.currentLessonTitle = title;
  show("view-material");
  $("#materialTitle").textContent = title;

  if (cache.materials[lessonId]) {
    const m = cache.materials[lessonId];
    $("#materialContent").innerHTML = m.content ||
      `<p class="muted">Bu ders için henüz materyal eklenmemiş.</p>`;
    api("getMaterials", { lessonId }, { silent: true })
      .then(res => {
        cache.materials[lessonId] = res.data || {};
        const c = (res.data && res.data.content) || "";
        $("#materialContent").innerHTML = c ||
          `<p class="muted">Bu ders için henüz materyal eklenmemiş.</p>`;
      }).catch(() => {});
    return;
  }
  try {
    const res = await api("getMaterials", { lessonId });
    cache.materials[lessonId] = res.data || {};
    const html = (res.data && res.data.content) ||
      `<p class="muted">Bu ders için henüz materyal eklenmemiş.</p>`;
    $("#materialContent").innerHTML = html;
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
  show("view-admin");
  $$("#view-admin .tab").forEach(x => x.classList.remove("active"));
  $$(".admin-tab").forEach(x => x.classList.remove("active"));
  $('[data-admintab="courses"]').classList.add("active");
  $("#admin-courses").classList.add("active");
  await loadAdminCourses();
}

async function loadAdminCourses() {
  // Cache varsa anında göster, arka planda yenile
  if (cache.courses) {
    renderAdminCourses(cache.courses);
    api("getCourses", {}, { silent: true })
      .then(res => { cache.courses = res.data; renderAdminCourses(res.data); })
      .catch(() => {});
    return;
  }
  try {
    const res = await api("getCourses");
    cache.courses = res.data;
    renderAdminCourses(res.data);
  } catch (e) { toast(e.message, "error"); }
}

function renderAdminCourses(list) {
  const wrap = $("#adminCoursesList");
  if (!list.length) { wrap.innerHTML = `<p class="muted">Henüz kurs yok. Yukarıdan ekleyebilirsin.</p>`; return; }
  wrap.innerHTML = list.map(c => `
    <div class="admin-row" data-id="${c.id}">
      <div class="info">
        <strong>${escapeHtml(c.name)}</strong>
        <small>${escapeHtml(c.description || "")}</small>
      </div>
      <div class="actions">
        <button class="btn btn-primary btn-sm" data-act="open">Dersler</button>
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
  $("#adminCourseTitle").textContent = courseName + " - Dersler";
  await loadAdminLessons();
}

async function loadAdminLessons() {
  const courseId = state.currentCourseId;
  if (cache.lessons[courseId]) {
    renderAdminLessons(cache.lessons[courseId]);
    api("getLessons", { courseId }, { silent: true })
      .then(res => { cache.lessons[courseId] = res.data; renderAdminLessons(res.data); })
      .catch(() => {});
    return;
  }
  try {
    const res = await api("getLessons", { courseId });
    cache.lessons[courseId] = res.data;
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

// ============= MATERYAL EDİTÖRÜ =============

function ensureQuill() {
  if (quill) return quill;
  quill = new Quill('#materialEditor', {
    theme: 'snow',
    placeholder: 'Buraya ders içeriğini yaz... Yazıyı seç, üstteki butonlardan kalın/italik/başlık/liste yap.',
    modules: {
      toolbar: [
        [{ 'header': [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ 'color': [] }, { 'background': [] }],
        [{ 'list': 'ordered' }, { 'list': 'bullet' }],
        [{ 'align': [] }],
        [{ 'indent': '-1' }, { 'indent': '+1' }],
        ['blockquote', 'code-block'],
        ['link', 'image'],
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
  $("#adminMaterialTitle").textContent = title + " - Materyal";
  $("#materialPreview").style.display = "none";

  ensureQuill();

  // Cache varsa anında doldur
  if (cache.materials[lessonId]) {
    quill.root.innerHTML = cache.materials[lessonId].content || "";
    api("getMaterials", { lessonId }, { silent: true })
      .then(res => {
        cache.materials[lessonId] = res.data || {};
        // Editör'ü sadece kullanıcı henüz yazmaya başlamadıysa güncelle
        if (!quill.hasFocus()) quill.root.innerHTML = res.data?.content || "";
      }).catch(() => {});
    return;
  }
  try {
    const res = await api("getMaterials", { lessonId });
    cache.materials[lessonId] = res.data || {};
    quill.root.innerHTML = res.data?.content || "";
  } catch (e) { toast(e.message, "error"); }
}

function setupMaterialEditor() {
  $("#saveMaterialBtn").addEventListener("click", async () => {
    if (!quill) return;
    const html = quill.root.innerHTML;
    try {
      await api("saveMaterial", {
        lessonId: state.currentLessonId,
        content: html,
        type: "html"
      });
      // Cache'i güncel tut
      cache.materials[state.currentLessonId] = { content: html, type: "html" };
      toast("Materyal kaydedildi", "success");
    } catch (e) { toast(e.message, "error"); }
  });

  $("#previewMaterialBtn").addEventListener("click", () => {
    if (!quill) return;
    const p = $("#materialPreview");
    if (p.style.display === "none") {
      p.innerHTML = quill.root.innerHTML;
      p.style.display = "block";
      p.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      p.style.display = "none";
    }
  });

  $("#insertYoutubeBtn").addEventListener("click", () => {
    if (!quill) return;
    const url = prompt("YouTube video URL'sini yapıştır:\n(örn. https://www.youtube.com/watch?v=XXXXX)");
    if (!url) return;
    const embedUrl = toYoutubeEmbed(url);
    if (!embedUrl) { toast("Geçerli bir YouTube linki gir.", "error"); return; }
    const range = quill.getSelection(true) || { index: quill.getLength() };
    quill.insertEmbed(range.index, 'video', embedUrl, 'user');
    quill.insertText(range.index + 1, '\n', 'user');
    quill.setSelection(range.index + 2);
  });

  $("#insertGeniallyBtn").addEventListener("click", () => {
    if (!quill) return;
    const url = prompt("Genially URL'sini yapıştır:\n(örn. https://view.genial.ly/XXXXXX)");
    if (!url) return;
    const range = quill.getSelection(true) || { index: quill.getLength() };
    quill.insertEmbed(range.index, 'video', url, 'user');
    quill.insertText(range.index + 1, '\n', 'user');
    quill.setSelection(range.index + 2);
  });

  $("#insertPdfBtn").addEventListener("click", () => {
    if (!quill) return;
    const url = prompt("PDF linkini yapıştır:\n(Google Drive paylaşım linki olabilir)");
    if (!url) return;
    const text = prompt("Görünecek metin:", "📄 Ders Notları (PDF)") || "📄 PDF";
    const range = quill.getSelection(true) || { index: quill.getLength() };
    quill.insertText(range.index, text, { link: url }, 'user');
    quill.insertText(range.index + text.length, '\n', 'user');
    quill.setSelection(range.index + text.length + 1);
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
    api("getInstructors", {}, { silent: true })
      .then(res => { cache.instructors = res.data; renderInstructors(res.data); })
      .catch(() => {});
    return;
  }
  try {
    const res = await api("getInstructors");
    cache.instructors = res.data;
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
  setupLogin();
  setupLogout();
  setupBackButtons();
  setupAdminTabs();
  setupAddCourse();
  setupAddLesson();
  setupMaterialEditor();
  setupAddInstructor();

  if (loadSession()) enterApp();
  else show("view-login");
});
