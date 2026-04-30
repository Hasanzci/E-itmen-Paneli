/* ===========================================================
   EĞİTMEN PLATFORMU - Frontend (Quill / Word benzeri editör)
   =========================================================== */

const API_URL = "https://script.google.com/macros/s/AKfycbxv_irFUNcb9W9qaojfdYNc3k9r1KWl-MuB-vNwgvSNIbbjTlcFUYcy7JKp-HO8SctMlg/exec";

// ---------- Durum ----------
const state = {
  role: null, user: null,
  currentCourseId: null, currentCourseName: "",
  currentLessonId: null, currentLessonTitle: "",
  cache: { courses: [], lessons: {}, instructors: [] }
};

let quill = null; // Quill editör örneği (lazy-init)

// ---------- API ----------
async function api(action, payload = {}) {
  if (!API_URL || API_URL.includes("BURAYA_GOOGLE")) {
    throw new Error("API_URL ayarlı değil. app.js içinde API_URL'yi düzenle.");
  }
  showLoader(true);
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
    showLoader(false);
  }
}

// ---------- UI yardımcıları ----------
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

function showLoader(on) { $("#loader").classList.toggle("hidden", !on); }

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
function clearSession() { localStorage.removeItem("session"); }

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

function enterApp() {
  $("#userLabel").textContent = state.user?.name
    ? `${state.user.name}${state.role === "admin" ? " (Admin)" : ""}`
    : "";
  if (state.role === "admin") openAdmin();
  else openCourses();
}

// ============= EĞİTMEN AKIŞI =============

async function openCourses() {
  show("view-courses");
  try {
    const res = await api("getCourses");
    state.cache.courses = res.data;
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
  try {
    const res = await api("getLessons", { courseId });
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
  try {
    const res = await api("getMaterials", { lessonId });
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
  try {
    const res = await api("getCourses");
    state.cache.courses = res.data;
    const wrap = $("#adminCoursesList");
    if (!res.data.length) { wrap.innerHTML = `<p class="muted">Henüz kurs yok. Yukarıdan ekleyebilirsin.</p>`; return; }
    wrap.innerHTML = res.data.map(c => `
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
      const c = res.data.find(x => x.id === id);
      row.querySelector('[data-act="open"]').addEventListener("click", () => openAdminCourse(c.id, c.name));
      row.querySelector('[data-act="edit"]').addEventListener("click", async () => {
        const newName = prompt("Kurs adı:", c.name);
        if (newName === null) return;
        const newDesc = prompt("Açıklama:", c.description || "");
        if (newDesc === null) return;
        try {
          await api("updateCourse", { id: c.id, name: newName, description: newDesc });
          toast("Güncellendi", "success");
          loadAdminCourses();
        } catch (e) { toast(e.message, "error"); }
      });
      row.querySelector('[data-act="delete"]').addEventListener("click", async () => {
        if (!confirm(`"${c.name}" kursunu ve tüm derslerini silmek istiyor musun?`)) return;
        try {
          await api("deleteCourse", { id: c.id });
          toast("Silindi", "success");
          loadAdminCourses();
        } catch (e) { toast(e.message, "error"); }
      });
    });
  } catch (e) { toast(e.message, "error"); }
}

function setupAddCourse() {
  $("#addCourseForm").addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await api("addCourse", {
        name: $("#newCourseName").value,
        description: $("#newCourseDesc").value
      });
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
  try {
    const res = await api("getLessons", { courseId: state.currentCourseId });
    const wrap = $("#adminLessonsList");
    if (!res.data.length) { wrap.innerHTML = `<p class="muted">Henüz ders yok.</p>`; return; }
    wrap.innerHTML = res.data.map((l, i) => `
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
      const l = res.data.find(x => x.id === id);
      row.querySelector('[data-act="material"]').addEventListener("click", () => openAdminMaterial(l.id, l.title));
      row.querySelector('[data-act="edit"]').addEventListener("click", async () => {
        const t = prompt("Ders adı:", l.title);
        if (t === null) return;
        const o = prompt("Sıra numarası:", l.order || "");
        if (o === null) return;
        try {
          await api("updateLesson", { id: l.id, title: t, order: Number(o) || l.order });
          toast("Güncellendi", "success");
          loadAdminLessons();
        } catch (e) { toast(e.message, "error"); }
      });
      row.querySelector('[data-act="delete"]').addEventListener("click", async () => {
        if (!confirm(`"${l.title}" dersini silmek istiyor musun?`)) return;
        try {
          await api("deleteLesson", { id: l.id });
          toast("Silindi", "success");
          loadAdminLessons();
        } catch (e) { toast(e.message, "error"); }
      });
    });
  } catch (e) { toast(e.message, "error"); }
}

function setupAddLesson() {
  $("#addLessonForm").addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await api("addLesson", {
        courseId: state.currentCourseId,
        title: $("#newLessonTitle").value
      });
      $("#newLessonTitle").value = "";
      toast("Ders eklendi", "success");
      loadAdminLessons();
    } catch (e) { toast(e.message, "error"); }
  });
}

// ============= MATERYAL EDİTÖRÜ (Quill) =============

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

  ensureQuill(); // ilk seferinde başlat
  try {
    const res = await api("getMaterials", { lessonId });
    const content = (res.data && res.data.content) || "";
    // Mevcut içeriği yükle
    quill.root.innerHTML = content;
  } catch (e) { toast(e.message, "error"); }
}

function setupMaterialEditor() {
  // KAYDET
  $("#saveMaterialBtn").addEventListener("click", async () => {
    if (!quill) return;
    try {
      await api("saveMaterial", {
        lessonId: state.currentLessonId,
        content: quill.root.innerHTML,
        type: "html"
      });
      toast("Materyal kaydedildi", "success");
    } catch (e) { toast(e.message, "error"); }
  });

  // ÖNİZLE
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

  // YOUTUBE EKLE
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

  // GENIALLY EKLE
  $("#insertGeniallyBtn").addEventListener("click", () => {
    if (!quill) return;
    const url = prompt("Genially URL'sini yapıştır:\n(örn. https://view.genial.ly/XXXXXX)");
    if (!url) return;
    const range = quill.getSelection(true) || { index: quill.getLength() };
    quill.insertEmbed(range.index, 'video', url, 'user');
    quill.insertText(range.index + 1, '\n', 'user');
    quill.setSelection(range.index + 2);
  });

  // PDF LİNKİ EKLE
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

// YouTube linkini embed formuna çevir
function toYoutubeEmbed(url) {
  try {
    const u = new URL(url);
    let id = "";
    if (u.hostname.includes("youtu.be")) {
      id = u.pathname.slice(1);
    } else if (u.hostname.includes("youtube.com")) {
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
  try {
    const res = await api("getInstructors");
    state.cache.instructors = res.data;
    const wrap = $("#adminInstructorsList");
    if (!res.data.length) { wrap.innerHTML = `<p class="muted">Henüz eğitmen eklenmemiş.</p>`; return; }
    wrap.innerHTML = res.data.map(u => `
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
      const u = res.data.find(x => x.id === id);
      row.querySelector('[data-act="edit"]').addEventListener("click", async () => {
        const name = prompt("Ad Soyad:", u.name);
        if (name === null) return;
        const email = prompt("E-posta:", u.email);
        if (email === null) return;
        const password = prompt("Yeni şifre (boş bırakırsan değişmez):", "");
        try {
          await api("updateInstructor", { id: u.id, name, email, password });
          toast("Güncellendi", "success");
          loadInstructors();
        } catch (e) { toast(e.message, "error"); }
      });
      row.querySelector('[data-act="delete"]').addEventListener("click", async () => {
        if (!confirm(`${u.name} adlı eğitmeni silmek istiyor musun?`)) return;
        try {
          await api("deleteInstructor", { id: u.id });
          toast("Silindi", "success");
          loadInstructors();
        } catch (e) { toast(e.message, "error"); }
      });
    });
  } catch (e) { toast(e.message, "error"); }
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
