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
    let label = p;
    let action = "";
    if (typeof p === "object") { label = p.label; action = p.action; }
    if (i === paths.length - 1) return `<span>${escapeHtml(label)}</span>`;
    if (action) return `<a href="#" onclick="${action}; return false;" style="color:var(--text-muted); text-decoration:none;" class="breadcrumb-link">${escapeHtml(label)}</a> <span style="color:var(--border)">/</span> `;
    return `<span style="color:var(--text-muted)">${escapeHtml(label)} <span style="color:var(--border)">/</span> </span>`;
  }).join("");
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
  setBreadcrumbs([{label: "Ana Sayfa", action: "openCourses()"}, "Kurslarımız"]);
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
  
  const draw = (filterTxt = "") => {
    const filtered = list.filter(c => c.name.toLowerCase().includes(filterTxt.toLowerCase()) || (c.description || "").toLowerCase().includes(filterTxt.toLowerCase()));
    if (!filtered.length) { wrap.innerHTML = `<p class="muted">Arama sonucu bulunamadı.</p>`; return; }
    wrap.innerHTML = filtered.map(c => `
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
  };
  draw();
  const searchInput = $("#courseSearch");
  if(searchInput) {
    searchInput.oninput = (e) => draw(e.target.value);
  }
}

async function openLessons(courseId, courseName) {
  state.currentCourseId = courseId;
  state.currentCourseName = courseName;
  show("view-lessons");
  setBreadcrumbs([{label: "Ana Sayfa", action: "openCourses()"}, {label: "Kurslarımız", action: "openCourses()"}, courseName]);
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
  
  const readKey = "read_" + (state.user ? state.user.id : "anon");
  const readData = JSON.parse(localStorage.getItem(readKey) || "{}");
  
  const draw = (filterTxt = "") => {
    const filtered = list.filter(l => l.title.toLowerCase().includes(filterTxt.toLowerCase()));
    if (!filtered.length) { wrap.innerHTML = `<p class="muted">Arama sonucu bulunamadı.</p>`; return; }
    
    wrap.innerHTML = filtered.map((l, i) => {
      const isRead = readData[l.id];
      return `
        <div class="list-item" data-id="${l.id}" data-title="${escapeHtml(l.title)}">
          <div class="list-item-title" style="display:flex; align-items:center; width:100%;">
            <span class="icon" style="margin-right:8px;">📄</span> ${escapeHtml(l.title)}
            ${isRead ? '<span style="font-size:11px; color:var(--success); background:rgba(38,135,146,0.1); padding:2px 6px; border-radius:4px; margin-left:auto;">✓ Okundu</span>' : ''}
          </div>
          <div class="list-item-meta">Sıra: ${i + 1} • Görüntülemek için tıklayın</div>
        </div>
      `;
    }).join("");
    
    wrap.querySelectorAll(".list-item").forEach(item => {
      item.addEventListener("click", () => openMaterial(item.dataset.id, item.dataset.title));
    });
  };
  draw();
  const searchInput = $("#lessonSearch");
  if(searchInput) {
    searchInput.oninput = (e) => draw(e.target.value);
  }
}

async function openMaterial(lessonId, title) {
  state.currentLessonId = lessonId;
  state.currentLessonTitle = title;
  show("view-material");
  setBreadcrumbs([
    {label: "Ana Sayfa", action: "openCourses()"}, 
    {label: "Kurslarımız", action: "openCourses()"}, 
    {label: state.currentCourseName, action: `openLessons('${state.currentCourseId}', '${state.currentCourseName.replace(/'/g, "\\'")}')`}, 
    title
  ]);
  
  let topActions = `<button class="btn btn-ghost btn-sm" onclick="openShareModal()">🔗 Paylaş</button>`;
  topActions += `<button class="btn btn-back" onclick="openLessons(state.currentCourseId, state.currentCourseName)" style="margin-left:8px;">← Derslere Dön</button>`;
  setTopbarActions(topActions);
  
  $("#materialTitle").textContent = title;
  
  const readKey = "read_" + (state.user ? state.user.id : "anon");
  const readData = JSON.parse(localStorage.getItem(readKey) || "{}");
  readData[lessonId] = true;
  localStorage.setItem(readKey, JSON.stringify(readData));

  if (cache.materials[lessonId]) {
    renderMaterialData(cache.materials[lessonId]);
    return;
  }
  try {
    const res = await api("getMaterials", { lessonId });
    cache.materials[lessonId] = res.data || {};
    cache.save();
    renderMaterialData(cache.materials[lessonId]);
  } catch (e) { toast(e.message, "error"); }
}

function renderMaterialData(m) {
  const data = migrateContent(m.content);
  
  let html = "";
  
  if(data.toc) {
    let tocHtml = `<div class="toc-smart-block" style="background:var(--bg-card); border:1px solid var(--border); border-radius:8px; padding:20px; margin-bottom:24px;">`;
    tocHtml += `<h3 style="margin-bottom:12px; color:var(--primary); font-size:18px; display:flex; align-items:center; gap:8px;">📑 ${escapeHtml(data.toc.title || 'İçindekiler')}</h3>`;
    
    if(data.toc.mode === 'manual' && data.toc.manualText) {
      const lines = data.toc.manualText.split('\n');
      tocHtml += `<ul style="list-style-type:none; padding-left:0; line-height:1.8; margin:0;">`;
      lines.forEach(line => {
        let indent = 0;
        let cleanLine = line;
        while(cleanLine.startsWith('-') || cleanLine.startsWith(' ')) { 
          if(cleanLine.startsWith(' ')) indent += 0.5;
          else indent += 1;
          cleanLine = cleanLine.substring(1); 
        }
        if(cleanLine.trim()) {
           tocHtml += `<li style="margin-left:${Math.floor(indent)*20}px; border-bottom:1px dashed var(--border); padding:6px 0; color:var(--text-main);">${escapeHtml(cleanLine.trim())}</li>`;
        }
      });
      tocHtml += `</ul>`;
    } else {
      tocHtml += `<ul style="list-style-type:none; padding-left:0; line-height:1.8; margin:0;">`;
      data.sections.forEach(sec => {
        tocHtml += `<li style="border-bottom:1px dashed var(--border); padding:8px 0;">
          <a href="#sec_${sec.id}" class="toc-smart-link" style="color:var(--text-main); text-decoration:none; display:flex; justify-content:space-between; align-items:center;">
            <strong>${escapeHtml(sec.title)}</strong>
            <span style="color:var(--primary); font-size:12px; background:rgba(130,58,175,0.1); padding:2px 8px; border-radius:12px;">Bölüme Git →</span>
          </a>
        </li>`;
      });
      tocHtml += `</ul>`;
    }
    tocHtml += `</div>`;
    html += tocHtml;
  }
  
  data.sections.forEach(sec => {
    if (sec.type === "toggle") {
      html += `<details id="sec_${sec.id}" class="material-section material-toggle" style="margin-bottom:24px; background:var(--bg-card); border:1px solid var(--border); border-radius:8px; padding:16px; box-shadow:var(--shadow);">`;
      html += `<summary style="font-size:18px; font-weight:bold; cursor:pointer; color:var(--primary); padding-bottom:8px; outline:none; user-select:none;">▶️ ${escapeHtml(sec.title)}</summary>`;
      html += `<div class="section-content-wrapper" style="margin-top:12px; padding-top:12px; border-top:1px dashed var(--border);">${sec.content}</div>`;
      html += `</details>`;
    } else {
      html += `<div id="sec_${sec.id}" class="material-section" style="margin-bottom:40px; background:var(--bg-main); border:1px solid var(--border); border-radius:12px; padding:24px; box-shadow:var(--shadow);">`;
      html += `<h2 style="border-bottom:2px solid var(--primary); padding-bottom:12px; margin-bottom:20px; font-size:24px;">${escapeHtml(sec.title)}</h2>`;
      html += `<div class="section-content-wrapper">`;
      
      if(sec.type === "table" && sec.tableData) {
        html += `<div style="overflow-x:auto;"><table class="custom-table table-${sec.tableData.theme}"><tbody>`;
        sec.tableData.rows.forEach((row, rIndex) => {
          let isHeader = (rIndex === 0 && sec.tableData.headerRow);
          html += `<tr>`;
          row.forEach(cell => {
            let tag = isHeader ? 'th' : 'td';
            html += `<${tag}>${cell}</${tag}>`;
          });
          html += `</tr>`;
        });
        html += `</tbody></table></div>`;
      } else if (sec.type === "mermaid") {
        html += `<div class="mermaid" style="background:white; padding:16px; border-radius:8px; overflow:auto; text-align:center;">${escapeHtml(sec.content)}</div>`;
      } else {
        html += sec.content;
      }
      
      html += `</div></div>`;
    }
  });
  
  $("#materialContent").innerHTML = html || `<p class="muted">İçerik bulunamadı.</p>`;
  
  if (m.updatedAt) {
    const d = new Date(m.updatedAt);
    $("#materialUpdated").textContent = "Son güncelleme: " + d.toLocaleDateString('tr-TR');
  } else {
    $("#materialUpdated").textContent = "Son güncelleme: -";
  }
  
  if (m.ownerId) {
    const owner = (cache.instructors || []).find(x => x.id === m.ownerId);
    $("#materialOwnerCallout").classList.remove('hidden');
    $("#materialOwnerName").textContent = "@" + (owner ? owner.name : "Belirtilmedi");
  } else {
    $("#materialOwnerCallout").classList.add('hidden');
  }

  generateTOC();
  loadComments(state.currentLessonId);
  setupUnfurling();
  
  try {
    if(window.mermaid) {
      mermaid.initialize({ startOnLoad: false, theme: 'default' });
      mermaid.run({ querySelector: '.mermaid' });
    }
  } catch(e) { console.warn("Mermaid error:", e); }
}

function generateTOC() {
  const tocList = $("#tocList");
  tocList.innerHTML = "";
  
  const content = $("#materialContent");
  const sectionEls = content.querySelectorAll(".material-section");
  
  if (sectionEls.length === 0) {
    tocList.innerHTML = '<span class="muted" style="font-size:13px;">Başlık bulunamadı.</span>';
    return;
  }
  
  const observerItems = [];

  sectionEls.forEach(secEl => {
    const secId = secEl.id;
    const secTitle = secEl.querySelector("h2").textContent;
    
    const a = document.createElement("a");
    a.href = "#" + secId;
    a.className = "toc-item toc-h1";
    a.innerHTML = `<strong>${escapeHtml(secTitle)}</strong>`;
    a.onclick = (e) => {
      e.preventDefault();
      secEl.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    tocList.appendChild(a);
    observerItems.push(secEl);
    
    const innerHeaders = secEl.querySelectorAll(".section-content-wrapper h1, .section-content-wrapper h2, .section-content-wrapper h3");
    innerHeaders.forEach((h, i) => {
      if (!h.id) h.id = "h_" + secId + "_" + i;
      const sub = document.createElement("a");
      sub.href = "#" + h.id;
      const tag = h.tagName.toLowerCase();
      sub.className = "toc-item toc-" + tag;
      sub.textContent = h.textContent;
      sub.style.paddingLeft = tag === 'h1' ? '24px' : (tag === 'h2' ? '36px' : '48px');
      sub.onclick = (e) => {
        e.preventDefault();
        h.scrollIntoView({ behavior: "smooth", block: "start" });
      };
      tocList.appendChild(sub);
      observerItems.push(h);
    });
  });

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        $$(".toc-item").forEach(a => a.classList.remove("active"));
        const id = entry.target.id;
        const link = tocList.querySelector(`a[href="#${id}"]`);
        if (link) link.classList.add("active");
      }
    });
  }, { rootMargin: "0px 0px -80% 0px" });

  observerItems.forEach(h => observer.observe(h));
}

function setupUnfurling() {
  $$("#materialContent a").forEach(a => {
    const href = a.href;
    if (a.classList.contains("unfurled") || a.closest('iframe') || a.closest('.embed-card')) return;
    
    const isStandalone = a.textContent.trim() === href.trim() || a.parentNode.textContent.trim() === a.textContent.trim();
    
    if (href.includes("scratch.mit.edu/projects/") && isStandalone) {
      const match = href.match(/projects\/(\d+)/);
      if (match) {
        a.classList.add("unfurled");
        const embedHtml = `
          <div class="embed-card">
            <a href="${href}" target="_blank" class="embed-card-header">🐱 Scratch Projesi #${match[1]} - Açmak için tıkla</a>
            <iframe src="https://scratch.mit.edu/projects/${match[1]}/embed" allowtransparency="true" frameborder="0" scrolling="no" allowfullscreen></iframe>
          </div>
        `;
        a.insertAdjacentHTML("afterend", embedHtml);
        a.style.display = 'none';
      }
    } else if (isStandalone) {
      try {
        const url = new URL(href);
        const domain = url.hostname;
        a.classList.add("unfurled");
        const embedHtml = `
          <a href="${href}" target="_blank" class="generic-link-card" style="display:flex; align-items:center; gap:12px; padding:12px; border:1px solid var(--border); border-radius:8px; margin:8px 0; text-decoration:none; background:var(--bg-card); transition:all 0.2s;">
            <img src="https://www.google.com/s2/favicons?domain=${domain}" style="width:24px; height:24px; border-radius:4px;" />
            <div style="display:flex; flex-direction:column;">
              <strong style="color:var(--text-main); font-size:14px;">Ziyaret et: ${domain}</strong>
              <small style="color:var(--text-muted); font-size:12px;">${href.length > 50 ? href.substring(0,50)+'...' : href}</small>
            </div>
          </a>
        `;
        a.insertAdjacentHTML("afterend", embedHtml);
        a.style.display = "none";
      } catch(e) {}
    }
  });
}

async function loadComments(lessonId) {
  const list = $("#commentsList");
  list.innerHTML = `<span class="muted" style="font-size:13px;">Yorumlar yükleniyor...</span>`;
  try {
    const res = await api("getComments", { lessonId }, { silent: true });
    if (!res.data || res.data.length === 0) {
      list.innerHTML = `<span class="muted" style="font-size:13px;">İlk yorumu siz yapın.</span>`;
      return;
    }
    list.innerHTML = res.data.map(c => {
      const canDelete = state.user && (state.user.id === c.userId || state.user.role === 'admin' || state.user.id === 'admin');
      return `
      <div class="comment-item" style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div style="display:flex; gap:12px;">
          <div class="comment-avatar">${(c.userName || "U")[0].toUpperCase()}</div>
          <div class="comment-body">
            <div class="comment-meta">
              <span class="comment-author">${escapeHtml(c.userName)}</span>
              <span title="${new Date(c.createdAt).toLocaleString()}">${new Date(c.createdAt).toLocaleDateString('tr-TR')}</span>
            </div>
            <div class="comment-text">${escapeHtml(c.text)}</div>
          </div>
        </div>
        ${canDelete ? `<button class="btn btn-ghost btn-sm" onclick="deleteComment('${c.id}')" style="color:var(--danger); padding:4px 8px;">Sil</button>` : ''}
      </div>
    `}).join("");
  } catch (e) {
    list.innerHTML = `<span class="error">Yorumlar yüklenemedi.</span>`;
  }
}

window.deleteComment = async function(id) {
  if (!confirm("Bu yorumu silmek istediğinize emin misiniz?")) return;
  try {
    await api("deleteComment", { id });
    toast("Yorum silindi", "success");
    loadComments(state.currentLessonId);
  } catch (e) {
    toast(e.message, "error");
  }
};

function setupComments() {
  const form = document.getElementById("commentForm");
  if (!form) return;
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const input = document.getElementById("commentInput");
    const text = input.value;
    if (!text.trim()) return;
    
    try {
      await api("addComment", { lessonId: state.currentLessonId, text });
      input.value = "";
      toast("Yorumunuz eklendi", "success");
      loadComments(state.currentLessonId);
    } catch (err) {
      toast(err.message, "error");
    }
  });
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
  setBreadcrumbs([{label: "Yönetim", action: "openAdmin()"}, {label: "Kurs Detayı", action: ""}, courseName]);
  setTopbarActions(`
    <button class="btn btn-ghost btn-sm" onclick="openModal('newDocModal')">📄 + Yeni Belge</button>
    <button class="btn btn-back" onclick="openAdmin()" style="margin-left:8px;">← Geri Dön</button>
  `);
  
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

let activeQuill = null;
let sectionEditors = {};
window.lessonData = { toc: { mode: "auto", title: "İçindekiler", manualText: "" }, sections: [] };
let autoSaveInterval = null;
let lastSavedContentStr = "";

function _newId() { return Math.random().toString(36).substr(2, 9); }

function migrateContent(content) {
  if (!content) return { toc: { mode: "auto", title: "İçindekiler", manualText: "" }, sections: [{ id: _newId(), title: "Ana Bölüm", content: "" }] };
  if (content.startsWith("{") && content.includes('"sections"')) {
    try { return JSON.parse(content); } catch(e) {}
  }
  return {
    toc: { mode: "auto", title: "İçindekiler", manualText: "" },
    sections: [{ id: _newId(), title: "Ana Bölüm", content: content }]
  };
}

let slashMenuOpen = false;
let slashCursor = 0;

function createQuillInstance(selector) {
  const BlockEmbed = Quill.import('blots/block/embed');
  if(!Quill.imports['formats/divider']) {
    class DividerBlot extends BlockEmbed { static create() { return super.create(); } }
    DividerBlot.blotName = 'divider'; DividerBlot.tagName = 'hr';
    Quill.register(DividerBlot);
  }
  const q = new Quill(selector, {
    theme: 'bubble',
    placeholder: 'İçeriği yazmaya başla... / ile menüyü aç.',
    modules: {
      formula: true,
      toolbar: [
        ['bold', 'italic', 'underline', 'strike'],
        [{ 'color': ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#e60000', '#ff9900', '#ffff00', '#008a00', '#0066cc', '#9933ff', '#facccc', '#ffebcc', '#ffffcc', '#cce8cc', '#cce0f5', '#ebd6ff', '#bbbbbb', '#f06666', '#ffc266', '#ffff66', '#66b966', '#66a3e0', '#c285ff', '#888888', '#a10000', '#b26b00', '#b2b200', '#006100', '#0047b2', '#6b24b2', '#444444', '#5c0000', '#663d00', '#666600', '#003700', '#002966', '#3d1466', 'custom-color'] }, { 'background': ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#e60000', '#ff9900', '#ffff00', '#008a00', '#0066cc', '#9933ff', '#facccc', '#ffebcc', '#ffffcc', '#cce8cc', '#cce0f5', '#ebd6ff', '#bbbbbb', '#f06666', '#ffc266', '#ffff66', '#66b966', '#66a3e0', '#c285ff', '#888888', '#a10000', '#b26b00', '#b2b200', '#006100', '#0047b2', '#6b24b2', '#444444', '#5c0000', '#663d00', '#666600', '#003700', '#002966', '#3d1466'] }],
        [{ 'size': ['small', false, 'large', 'huge'] }],
        [{ 'header': [1, 2, 3, false] }],
        ['blockquote', 'code-block', 'formula'],
        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
        ['link', 'image', 'video'],
        ['clean']
      ]
    }
  });

  q.on('text-change', (delta, oldDelta, source) => {
    if (source !== 'user') return;
    const sel = q.getSelection();
    if (!sel) return;
    const cursor = sel.index;
    
    // Slash Menu Logic
    const char = q.getText(cursor - 1, 1);
    if (char === '/') {
      slashMenuOpen = true;
      slashCursor = cursor - 1;
      const bounds = q.getBounds(cursor);
      const menu = $("#slashMenu");
      const containerRect = q.container.getBoundingClientRect();
      // Ensure menu is relative to viewport + scroll
      menu.style.left = (bounds.left + containerRect.left + window.scrollX) + 'px';
      menu.style.top = (bounds.top + containerRect.top + window.scrollY + 20) + 'px';
      menu.style.display = 'block';
    } else if (slashMenuOpen) {
      if (char === ' ' || char === '\n') {
        $("#slashMenu").style.display = 'none';
        slashMenuOpen = false;
      }
    }
    
    // Markdown Shortcuts Logic
    if (char === ' ') {
      const text = q.getText(0, cursor);
      const lastLineBreak = text.lastIndexOf('\n', cursor - 2);
      const lineStart = lastLineBreak === -1 ? 0 : lastLineBreak + 1;
      const lineText = text.substring(lineStart, cursor);
      
      if (lineText === '# ') {
        q.deleteText(cursor - 2, 2);
        q.formatLine(cursor - 2, 1, 'header', 1);
      } else if (lineText === '## ') {
        q.deleteText(cursor - 3, 3);
        q.formatLine(cursor - 3, 1, 'header', 2);
      } else if (lineText === '### ') {
        q.deleteText(cursor - 4, 4);
        q.formatLine(cursor - 4, 1, 'header', 3);
      } else if (lineText === '- ' || lineText === '* ') {
        q.deleteText(cursor - 2, 2);
        q.formatLine(cursor - 2, 1, 'list', 'bullet');
      } else if (lineText === '1. ') {
        q.deleteText(cursor - 3, 3);
        q.formatLine(cursor - 3, 1, 'list', 'ordered');
      } else if (lineText === '[] ') {
        q.deleteText(cursor - 3, 3);
        q.formatText(cursor - 3, 1, 'list', 'unchecked');
      } else if (lineText === '> ') {
        q.deleteText(cursor - 2, 2);
        q.formatLine(cursor - 2, 1, 'blockquote', true);
      }
    } else if (char === '\n') {
      const text = q.getText(0, cursor);
      const lastLineBreak = text.lastIndexOf('\n', cursor - 2);
      const lineStart = lastLineBreak === -1 ? 0 : lastLineBreak + 1;
      const lineText = text.substring(lineStart, cursor - 1);
      if (lineText.trim() === '---') {
        q.deleteText(cursor - 4, 4);
        q.insertEmbed(cursor - 4, 'divider', true, 'user');
        q.insertText(cursor - 3, '\n', 'user');
        q.setSelection(cursor - 2);
      }
    }
  });

  return q;
}

async function openAdminMaterial(lessonId, title) {
  state.currentLessonId = lessonId;
  state.currentLessonTitle = title;
  show("view-admin-material");
  setBreadcrumbs([
    {label: "Yönetim", action: "openAdmin()"}, 
    {label: "Kurs Detayı", action: `openAdminCourse('${state.currentCourseId}', '${state.currentCourseName.replace(/'/g, "\\'")}')`},
    title
  ]);
  setTopbarActions(`
    <span id="autoSaveIndicator" style="font-size:12px; color:var(--text-muted); margin-right:12px; display:inline-flex; align-items:center; height:100%;"></span>
    <button id="revisionsBtn" class="btn btn-ghost btn-sm">🕰️ Versiyonlar</button>
    <button id="previewBtn" class="btn btn-ghost btn-sm">👁 Önizle</button>
    <button id="saveBtn" class="btn btn-primary btn-sm">💾 Kaydet</button>
    <button class="btn btn-back" onclick="openAdminCourse(state.currentCourseId, state.currentCourseName)">← Dön</button>
  `);
  
  $("#adminMaterialTitle").textContent = title + " - Materyal";
  $("#sectionsContainer").innerHTML = "Yükleniyor...";
  
  // Custom button bindings from topbar
  $("#saveBtn").onclick = saveMaterialAction;
  $("#previewBtn").onclick = togglePreviewAction;
  $("#revisionsBtn").onclick = showRevisions;
  
  if (autoSaveInterval) clearInterval(autoSaveInterval);
  // autoSaveInterval = setInterval(autoSaveTick, 10000); // OTOMATİK KAYIT İPTAL EDİLDİ
  lastSavedContentStr = "";
  
  $("#addSectionBtn").onclick = () => {
    saveCurrentEditorsToData();
    lessonData.sections.push({ id: _newId(), title: "Yeni Bölüm", type: "text", content: "" });
    drawSections();
  };
  
  $("#addTableBtn").onclick = () => {
    saveCurrentEditorsToData();
    lessonData.sections.push({ 
      id: _newId(), title: "Yeni Tablo", type: "table", 
      tableData: { cols: 2, rows: [["", ""], ["", ""]], headerRow: true, theme: "default" } 
    });
    drawSections();
  };
  
  $("#addToggleBtn").onclick = () => {
    saveCurrentEditorsToData();
    lessonData.sections.push({ id: _newId(), title: "Yeni Akordion", type: "toggle", content: "" });
    drawSections();
  };
  
  $("#addMermaidBtn").onclick = () => {
    saveCurrentEditorsToData();
    lessonData.sections.push({ id: _newId(), title: "Yeni Akış Diyagramı", type: "mermaid", content: "graph TD;\n    A-->B;\n    A-->C;\n    B-->D;\n    C-->D;" });
    drawSections();
  };

  document.addEventListener("click", e => {
    if (!e.target.closest("#slashMenu") && slashMenuOpen) {
      $("#slashMenu").style.display = 'none';
      slashMenuOpen = false;
    }
  });

  document.querySelectorAll(".slash-item").forEach(btn => {
    btn.onclick = () => {
      const cmd = btn.dataset.cmd;
      const q = getActiveQuill();
      if (!q || !slashMenuOpen) return;
      
      q.deleteText(slashCursor, q.getSelection(true).index - slashCursor);
      
      if (cmd === 'h1') q.formatLine(slashCursor, 1, 'header', 1);
      if (cmd === 'h2') q.formatLine(slashCursor, 1, 'header', 2);
      if (cmd === 'bullet') q.formatLine(slashCursor, 1, 'list', 'bullet');
      if (cmd === 'callout') {
        q.insertText(slashCursor, '💡 Bilgi: ', 'bold', true);
        q.formatLine(slashCursor, 1, 'blockquote', true);
        q.setSelection(slashCursor + 9);
      }
      if (cmd === 'divider') {
        q.insertEmbed(slashCursor, 'divider', true, 'user');
        q.setSelection(slashCursor + 1);
      }
      
      $("#slashMenu").style.display = 'none';
      slashMenuOpen = false;
    };
  });

  if (cache.materials[lessonId]) {
    renderAdminSections(cache.materials[lessonId]);
    return;
  }
  try {
    const res = await api("getMaterials", { lessonId });
    cache.materials[lessonId] = res.data || {};
    cache.save();
    renderAdminSections(cache.materials[lessonId]);
  } catch (e) { toast(e.message, "error"); }
}

function renderAdminSections(m) {
  window.lessonData = migrateContent(m.content);
  
  $("#tocModeSelect").value = lessonData.toc.mode;
  $("#tocTitleInput").value = lessonData.toc.title || "İçindekiler";
  $("#manualTocTextarea").value = lessonData.toc.manualText || "";
  $("#manualTocEditor").style.display = lessonData.toc.mode !== "auto" ? "block" : "none";
  
  $("#tocModeSelect").onchange = e => {
    lessonData.toc.mode = e.target.value;
    $("#manualTocEditor").style.display = lessonData.toc.mode !== "auto" ? "block" : "none";
  };
  $("#tocTitleInput").oninput = e => lessonData.toc.title = e.target.value;
  $("#manualTocTextarea").oninput = e => lessonData.toc.manualText = e.target.value;
  
  drawSections();
}

function drawSections() {
  const container = $("#sectionsContainer");
  container.innerHTML = "";
  sectionEditors = {};
  
  lessonData.sections.forEach((sec, idx) => {
    const el = document.createElement("div");
    el.className = "admin-section-block";
    el.style.border = "1px solid var(--border)";
    el.style.borderRadius = "8px";
    el.style.background = "var(--bg-card)";
    el.style.padding = "16px";
    
    el.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <input type="text" class="sec-title-input" value="${escapeHtml(sec.title)}" style="background:transparent; color:white; border:none; font-size:18px; font-weight:600; flex:1;" placeholder="Bölüm Adı" />
        <div>
          <button class="btn btn-ghost btn-sm move-up" ${idx===0 ? 'disabled':''}>⬆️</button>
          <button class="btn btn-ghost btn-sm move-down" ${idx===lessonData.sections.length-1 ? 'disabled':''}>⬇️</button>
          <button class="btn btn-danger btn-sm del-sec">Sil</button>
        </div>
      </div>
    `;
    if (sec.type === "table") {
      el.innerHTML += `<div class="table-editor-container" id="editor_${sec.id}" style="min-height: 100px;"></div>`;
      container.appendChild(el);
      initTableEditor(sec, el.querySelector(`#editor_${sec.id}`));
    } else if (sec.type === "mermaid") {
      el.innerHTML += `
        <div style="display:flex; gap:16px; margin-top:8px;">
          <textarea id="mermaid_src_${sec.id}" style="flex:1; height:150px; background:var(--bg-main); color:var(--text-main); font-family:monospace; padding:8px; border:1px solid var(--border); border-radius:6px;">${sec.content}</textarea>
          <div id="mermaid_preview_${sec.id}" style="flex:1; background:white; padding:16px; border-radius:6px; overflow:auto;"></div>
        </div>
      `;
      container.appendChild(el);
      const textInput = el.querySelector(`#mermaid_src_${sec.id}`);
      const preview = el.querySelector(`#mermaid_preview_${sec.id}`);
      const updatePreview = () => {
        sec.content = textInput.value;
        try {
          mermaid.render('svg_' + sec.id, textInput.value).then(res => {
            preview.innerHTML = res.svg;
          }).catch(err => {
            preview.innerHTML = `<span style="color:red">Sözdizimi hatası: ${err}</span>`;
          });
        } catch(e) {}
      };
      textInput.addEventListener("input", updatePreview);
      updatePreview();
    } else {
      if (sec.type === "toggle") {
        el.style.borderLeft = "4px solid var(--primary)";
        el.innerHTML += `<div style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">▶️ Bu bölüm öğrencilere tıklanınca açılan bir akordion olarak gösterilir.</div>`;
      }
      el.innerHTML += `<div id="editor_${sec.id}" style="min-height: 100px;"></div>`;
      container.appendChild(el);
      const q = createQuillInstance(`#editor_${sec.id}`);
      q.root.innerHTML = sec.content || "";
      sectionEditors[sec.id] = q;
      q.on('selection-change', (range) => {
        if (range) activeQuill = q;
      });
    }
    
    const titleInput = el.querySelector(".sec-title-input");
    titleInput.oninput = (e) => sec.title = e.target.value;
    
    el.querySelector(".move-up").onclick = () => {
      const temp = lessonData.sections[idx-1];
      lessonData.sections[idx-1] = lessonData.sections[idx];
      lessonData.sections[idx] = temp;
      saveCurrentEditorsToData();
      drawSections();
    };
    el.querySelector(".move-down").onclick = () => {
      const temp = lessonData.sections[idx+1];
      lessonData.sections[idx+1] = lessonData.sections[idx];
      lessonData.sections[idx] = temp;
      saveCurrentEditorsToData();
      drawSections();
    };
    el.querySelector(".del-sec").onclick = () => {
      if(!confirm("Bölümü silmek istiyor musunuz?")) return;
      lessonData.sections.splice(idx, 1);
      saveCurrentEditorsToData();
      drawSections();
    };
  });
}

function initTableEditor(sec, container) {
  const renderTable = () => {
    let html = `<div class="table-controls" style="margin-bottom:12px; display:flex; gap:8px; align-items:center;">
      <button class="btn btn-ghost btn-sm add-row-btn">+ Satır</button>
      <button class="btn btn-ghost btn-sm add-col-btn">+ Sütun</button>
      <select class="table-theme-select btn btn-ghost btn-sm" style="padding:4px; background:var(--bg-main); color:white; border:1px solid var(--border);">
        <option value="default">Düz Tema</option>
        <option value="blue">Mavi Vurgu</option>
        <option value="stripe">Zebra (Stripe)</option>
      </select>
      <label style="color:var(--text-muted); font-size:13px; display:flex; align-items:center; gap:4px;">
        <input type="checkbox" class="header-toggle" ${sec.tableData.headerRow ? 'checked':''}> İlk satır başlık olsun
      </label>
      <div style="display:flex; align-items:center; gap:4px; margin-left:auto;">
        <label style="color:var(--text-muted); font-size:13px;">Hücre Rengi:</label>
        <input type="color" class="cell-bg-picker" value="#ffffff" style="cursor:pointer; width:30px; height:30px; border:none; padding:0; background:transparent;" />
      </div>
    </div>
    <div style="overflow-x:auto;">
    <table class="custom-table table-${sec.tableData.theme}" style="margin:0;">
      <tbody>`;
      
    sec.tableData.rows.forEach((row, rIndex) => {
      let isHeader = (rIndex === 0 && sec.tableData.headerRow);
      html += `<tr>`;
      row.forEach((cell, cIndex) => {
        let tag = isHeader ? 'th' : 'td';
        let bgColor = cell.bgColor ? `background-color:${cell.bgColor};` : '';
        html += `<${tag} style="${bgColor} padding:8px;">
          <div contenteditable="true" class="table-cell-content" data-r="${rIndex}" data-c="${cIndex}">${cell.text !== undefined ? cell.text : cell}</div>
        </${tag}>`;
      });
      html += `<td style="width:30px; text-align:center; border:none; background:transparent;"><button class="btn btn-danger btn-sm del-row-btn" data-r="${rIndex}">-</button></td>`;
      html += `</tr>`;
    });
    
    html += `<tr>`;
    for(let i=0; i<sec.tableData.cols; i++) {
       html += `<td style="text-align:center; border:none; padding-top:4px; background:transparent;"><button class="btn btn-ghost btn-sm del-col-btn" data-c="${i}">Sütunu Sil</button></td>`;
    }
    html += `<td style="border:none;"></td></tr></tbody></table></div>`;
    
    container.innerHTML = html;
    
    container.querySelector(".table-theme-select").value = sec.tableData.theme;
    container.querySelector(".table-theme-select").onchange = (e) => {
      sec.tableData.theme = e.target.value;
      renderTable();
    };
    container.querySelector(".header-toggle").onchange = (e) => {
      sec.tableData.headerRow = e.target.checked;
      renderTable();
    };
    container.querySelector(".add-row-btn").onclick = () => {
      sec.tableData.rows.push(Array(sec.tableData.cols).fill(""));
      renderTable();
    };
    container.querySelector(".add-col-btn").onclick = () => {
      sec.tableData.cols++;
      sec.tableData.rows.forEach(r => r.push(""));
      renderTable();
    };
    container.querySelectorAll(".del-row-btn").forEach(btn => {
      btn.onclick = (e) => {
        if(sec.tableData.rows.length <= 1) return;
        sec.tableData.rows.splice(parseInt(e.target.dataset.r), 1);
        renderTable();
      };
    });
    container.querySelectorAll(".del-col-btn").forEach(btn => {
      btn.onclick = (e) => {
        if(sec.tableData.cols <= 1) return;
        const cIdx = parseInt(e.target.dataset.c);
        sec.tableData.cols--;
        sec.tableData.rows.forEach(r => r.splice(cIdx, 1));
        renderTable();
      };
    });

    let lastFocusedCell = null;
    const bgPicker = container.querySelector(".cell-bg-picker");
    bgPicker.oninput = (e) => {
      if (lastFocusedCell) {
        const r = lastFocusedCell.dataset.r;
        const c = lastFocusedCell.dataset.c;
        if (typeof sec.tableData.rows[r][c] === 'string') {
          sec.tableData.rows[r][c] = { text: sec.tableData.rows[r][c], bgColor: e.target.value };
        } else {
          sec.tableData.rows[r][c].bgColor = e.target.value;
        }
        lastFocusedCell.parentElement.style.backgroundColor = e.target.value;
      }
    };

    container.querySelectorAll(".table-cell-content").forEach(cell => {
      cell.onfocus = (e) => {
        lastFocusedCell = e.target;
        const r = e.target.dataset.r;
        const c = e.target.dataset.c;
        const cellData = sec.tableData.rows[r][c];
        bgPicker.value = (cellData && cellData.bgColor) ? cellData.bgColor : '#ffffff';
      };
      cell.onblur = (e) => {
        const r = e.target.dataset.r;
        const c = e.target.dataset.c;
        if (typeof sec.tableData.rows[r][c] === 'string') {
          sec.tableData.rows[r][c] = e.target.innerHTML;
        } else {
          sec.tableData.rows[r][c].text = e.target.innerHTML;
        }
      };
      cell.onkeydown = (e) => {
        if(e.ctrlKey || e.metaKey) {
          if(e.key === 'b') { e.preventDefault(); document.execCommand('bold'); }
          if(e.key === 'i') { e.preventDefault(); document.execCommand('italic'); }
          if(e.key === 'u') { e.preventDefault(); document.execCommand('underline'); }
        }
      };
    });
  };
  renderTable();
}

function saveCurrentEditorsToData() {
  if(!lessonData || !lessonData.sections) return;
  lessonData.sections.forEach(sec => {
    if(sec.type !== "table" && sectionEditors[sec.id]) {
      sec.content = sectionEditors[sec.id].root.innerHTML;
    }
  });
}

async function saveMaterialAction() {
  saveCurrentEditorsToData();
  const jsonStr = JSON.stringify(window.lessonData);
  try {
    await api("saveMaterial", {
      lessonId: state.currentLessonId,
      content: jsonStr,
      type: "json",
      savedBy: state.user ? state.user.name : "Admin",
      isAutoSave: false
    });
    cache.materials[state.currentLessonId] = { content: jsonStr, type: "json" };
    cache.save();
    lastSavedContentStr = jsonStr;
    const indicator = $("#autoSaveIndicator");
    if(indicator) indicator.textContent = "Kaydedildi " + new Date().toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'});
    toast("Materyal bölümleri başarıyla kaydedildi", "success");
  } catch (e) { toast(e.message, "error"); }
}

async function autoSaveTick() {
  if (!state.currentLessonId || !window.lessonData) return;
  saveCurrentEditorsToData();
  const currentStr = JSON.stringify(window.lessonData);
  if (!lastSavedContentStr) {
    lastSavedContentStr = currentStr;
    return;
  }
  if (currentStr === lastSavedContentStr) return; // no changes
  
  const indicator = $("#autoSaveIndicator");
  if(indicator) indicator.textContent = "Kaydediliyor...";
  
  try {
    await api("saveMaterial", { 
      lessonId: state.currentLessonId, 
      content: currentStr, 
      type: "json",
      savedBy: state.user ? state.user.name : "Admin",
      isAutoSave: true
    });
    lastSavedContentStr = currentStr;
    if(indicator) indicator.textContent = "Taslak Kaydedildi " + new Date().toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'});
    cache.materials[state.currentLessonId] = { content: currentStr, type: "json" };
    cache.save();
  } catch(e) {
    if(indicator) indicator.textContent = "Kayıt Hatası";
  }
}

async function showRevisions() {
  showModal("revisionsModal");
  $("#revisionsList").innerHTML = "Yükleniyor...";
  try {
    const res = await api("getRevisions", { lessonId: state.currentLessonId });
    const revs = res.data || [];
    if(revs.length === 0) {
      $("#revisionsList").innerHTML = "<p class='muted'>Henüz geçmiş versiyon yok.</p>";
      return;
    }
    let html = `<ul style="list-style:none; padding:0; margin:0;">`;
    revs.forEach(r => {
      const d = new Date(r.createdAt);
      html += `<li style="padding:12px; border:1px solid var(--border); border-radius:8px; margin-bottom:8px; background:var(--bg-main); display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-weight:bold;">${d.toLocaleDateString('tr-TR')} ${d.toLocaleTimeString('tr-TR')}</div>
          <div style="font-size:12px; color:var(--text-muted);">Kaydeden: ${escapeHtml(r.savedBy)}</div>
        </div>
        <button class="btn btn-ghost btn-sm restore-rev-btn" data-content="${escapeHtml(r.content)}">Bu Versiyona Dön</button>
      </li>`;
    });
    html += `</ul>`;
    $("#revisionsList").innerHTML = html;
    
    $$(".restore-rev-btn").forEach(btn => {
      btn.onclick = (e) => {
        if(!confirm("Mevcut tüm değişiklikleriniz bu versiyonla üzerine yazılacak. Onaylıyor musunuz?")) return;
        const c = e.target.dataset.content;
        window.lessonData = migrateContent(c);
        drawSections();
        saveMaterialAction();
        closeModal("revisionsModal");
      };
    });
  } catch(e) {
    $("#revisionsList").innerHTML = `<p class="muted" style="color:var(--danger)">Hata: ${e.message}</p>`;
  }
}

function togglePreviewAction() {
  // To be implemented
  toast("Önizleme modu bölüm bazlı düzende güncelleniyor.", "info");
}

function getActiveQuill() {
  if (activeQuill) return activeQuill;
  const ids = Object.keys(sectionEditors);
  if(ids.length > 0) return sectionEditors[ids[0]];
  return null;
}

function setupMaterialEditor() {
  $("#insertH1Btn").addEventListener("click", () => {
    const q = getActiveQuill(); if (!q) return;
    const range = q.getSelection(true);
    q.formatLine(range.index, range.length, 'header', 1);
  });
  
  $("#insertH2Btn").addEventListener("click", () => {
    const q = getActiveQuill(); if (!q) return;
    const range = q.getSelection(true);
    q.formatLine(range.index, range.length, 'header', 2);
  });
  
  $("#insertDividerBtn").addEventListener("click", () => {
    const q = getActiveQuill(); if (!q) return;
    const range = q.getSelection(true) || { index: q.getLength() };
    q.insertEmbed(range.index, 'divider', true, 'user');
    q.setSelection(range.index + 1);
  });
  
  $("#insertCalloutBtn").addEventListener("click", () => {
    const q = getActiveQuill(); if (!q) return;
    const range = q.getSelection(true) || { index: q.getLength() };
    q.insertText(range.index, '💡 Bilgi: ', 'bold', true);
    q.formatLine(range.index, 1, 'blockquote', true);
    q.setSelection(range.index + 9);
  });

  $("#insertDurationBtn").addEventListener("click", () => {
    const q = getActiveQuill(); if (!q) return;
    const duration = prompt("Süre (örn. 10 Dakika):");
    if (!duration) return;
    const range = q.getSelection(true) || { index: q.getLength() };
    q.insertText(range.index, '⏱ ' + duration + ' ', 'bold', true);
    q.setSelection(range.index + duration.length + 3);
  });

  $("#insertYoutubeBtn").addEventListener("click", () => {
    const q = getActiveQuill(); if (!q) return;
    const url = prompt("YouTube video URL'si:");
    if (!url) return;
    const embedUrl = toYoutubeEmbed(url);
    if (!embedUrl) { toast("Geçersiz YouTube linki.", "error"); return; }
    const range = q.getSelection(true) || { index: q.getLength() };
    q.insertEmbed(range.index, 'video', embedUrl, 'user');
    q.insertText(range.index + 1, '\n', 'user');
    q.setSelection(range.index + 2);
  });

  $("#insertGeniallyBtn").addEventListener("click", () => {
    const q = getActiveQuill(); if (!q) return;
    const url = prompt("Genially URL'si:");
    if (!url) return;
    const range = q.getSelection(true) || { index: q.getLength() };
    q.insertEmbed(range.index, 'video', url, 'user');
    q.insertText(range.index + 1, '\n', 'user');
    q.setSelection(range.index + 2);
  });

  const btnTinkercad = document.getElementById("insertTinkercadBtn");
  if (btnTinkercad) {
    btnTinkercad.addEventListener("click", () => {
      const q = getActiveQuill(); if (!q) return;
      let url = prompt("Tinkercad Paylaşım URL'si (örn. https://www.tinkercad.com/things/...):");
      if (!url) return;
      if (url.includes("/things/")) {
        url = url.replace("/things/", "/embed/");
      }
      const range = q.getSelection(true) || { index: q.getLength() };
      q.insertEmbed(range.index, 'video', url, 'user');
      q.insertText(range.index + 1, '\n', 'user');
      q.setSelection(range.index + 2);
    });
  }

  $("#insertPdfBtn").addEventListener("click", () => {
    const q = getActiveQuill(); if (!q) return;
    const url = prompt("PDF/Drive linkini yapıştır:");
    if (!url) return;
    const text = prompt("Görünecek metin:", "📄 Ders Notları (PDF)") || "📄 PDF";
    const range = q.getSelection(true) || { index: q.getLength() };
    q.insertText(range.index, text, { link: url }, 'user');
    q.insertText(range.index + text.length, '\n', 'user');
    q.setSelection(range.index + text.length + 1);
  });

  $("#insertImgBtn").addEventListener("click", () => {
    const q = getActiveQuill(); if (!q) return;
    const url = prompt("Görselin tam URL'sini yapıştır (örn. https://site.com/resim.png):");
    if (!url) return;
    let range = q.getSelection();
    if (!range) range = { index: q.getLength() };
    q.insertEmbed(range.index, 'image', url, 'user');
    q.insertText(range.index + 1, '\n\n', 'user');
    q.setSelection(range.index + 2);
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
  setupComments();

  if (loadSession()) enterApp();
  else {
    document.body.classList.add("login-mode");
    show("view-login");
  }
});

// ============= MODALS & YORUM =============
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}
function copyShareLink() {
  const input = document.getElementById('shareLinkInput');
  input.select();
  document.execCommand('copy');
  toast('Bağlantı kopyalandı', 'success');
}

function openShareModal() {
  $('#shareLinkInput').value = window.location.origin + window.location.pathname + "#lesson=" + state.currentLessonId;
  if (state.role === 'admin') {
    $('#adminShareOptions').style.display = 'block';
    const sel = $('#ownerSelect');
    sel.innerHTML = `<option value="">-- Sorumlu Yok --</option>` + 
      (cache.instructors || []).map(i => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('');
    
    const m = cache.materials[state.currentLessonId];
    if (m && m.ownerId) sel.value = m.ownerId;
  } else {
    $('#adminShareOptions').style.display = 'none';
  }
  openModal('shareModal');
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById('saveOwnerBtn');
  if(btn) {
    btn.addEventListener('click', async () => {
      const ownerId = $('#ownerSelect').value;
      try {
        await api("updateMaterialOwner", { lessonId: state.currentLessonId, ownerId });
        if(cache.materials[state.currentLessonId]) {
          cache.materials[state.currentLessonId].ownerId = ownerId;
        }
        toast('İçerik sorumlusu güncellendi', 'success');
        closeModal('shareModal');
        if (state.currentLessonId) {
          renderMaterialData(cache.materials[state.currentLessonId]);
        }
      } catch(e) {
        toast(e.message, 'error');
      }
    });
  }
  
  const quickForm = document.getElementById('quickAddLessonForm');
  if(quickForm) {
    quickForm.addEventListener('submit', async e => {
      e.preventDefault();
      try {
        await api("addLesson", {
          courseId: state.currentCourseId,
          title: $("#quickNewLessonTitle").value
        });
        cache.invalidate("lessons:" + state.currentCourseId);
        $("#quickNewLessonTitle").value = "";
        toast("Ders eklendi", "success");
        closeModal('newDocModal');
        if ($("#view-admin-course").classList.contains("active")) {
          loadAdminLessons();
        }
      } catch (e) { toast(e.message, "error"); }
    });
  }

  const commentForm = document.getElementById('commentForm');
  if(commentForm) {
    commentForm.addEventListener('submit', async e => {
      e.preventDefault();
      const input = $("#commentInput");
      const text = input.value.trim();
      if (!text) return;
      try {
        await api("addComment", {
          lessonId: state.currentLessonId,
          userId: state.user.id || "admin",
          userName: state.user.name,
          text
        });
        input.value = "";
        loadComments(state.currentLessonId);
      } catch(e) { toast(e.message, "error"); }
    });
  }
});
