/**
 * EĞİTMEN PLATFORMU - Hızlandırılmış Backend (CacheService + bootstrap)
 *
 * KURULUM ADIMLARI (yeniden):
 *   1) Sheets > Uzantılar > Apps Script > tüm kodu sil > bunu yapıştır > 💾 kaydet
 *   2) İlk seferdeyse "kurulum" fonksiyonunu çalıştır (zaten yapıldıysa atla)
 *   3) Deploy → Manage deployments → kalem ikonu → Version: NEW VERSION → Deploy
 *
 * Yenilikler:
 *   - Tüm okumalar 5 dakika RAM'de cache'leniyor (Apps Script CacheService).
 *   - Yazma sonrası ilgili cache otomatik temizleniyor.
 *   - Yeni "bootstrap" action: tek istekte tüm veriyi döndürüyor.
 */

// ====================== ŞEMA ======================
const SHEETS_SCHEMA = {
  Config:      ["key", "value"],
  Instructors: ["id", "name", "email", "password", "createdAt"],
  Courses:     ["id", "name", "description", "createdAt"],
  Lessons:     ["id", "courseId", "title", "order", "createdAt"],
  Materials:   ["id", "lessonId", "content", "type"]
};

// ====================== KURULUM (manuel çalıştır) ======================
function kurulum() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS_SCHEMA).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const headers = SHEETS_SCHEMA[name];
    const range = sh.getRange(1, 1, 1, headers.length);
    range.setValues([headers]);
    range.setFontWeight("bold");
    range.setBackground("#e8eaf6");
    range.setHorizontalAlignment("center");
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, headers.length);
  });
  const config = ss.getSheetByName("Config");
  const data = config.getDataRange().getValues();
  if (!data.some(row => row[0] === "adminPassword")) {
    config.appendRow(["adminPassword", "admin123"]);
  }
  ["Sheet1", "Sayfa1"].forEach(n => {
    const s = ss.getSheetByName(n);
    if (s && ss.getSheets().length > 1 && s.getLastRow() <= 1) {
      try { ss.deleteSheet(s); } catch (e) {}
    }
  });
  _invalidateAllCache();
  SpreadsheetApp.getActive().toast("Kurulum tamamlandı!", "✅", 5);
  return "Kurulum başarılı.";
}

// ====================== HTTP GİRİŞ NOKTALARI ======================

function doGet(e) {
  return _json({ ok: true, message: "Eğitmen Platformu API çalışıyor (hızlı sürüm)." });
}

function doPost(e) {
  try {
    _ensureSheets();
    const params = JSON.parse(e.postData.contents || "{}");
    const action = params.action;
    let result;

    switch (action) {
      // Auth
      case "instructorLogin": result = instructorLogin(params); break;
      case "adminLogin":      result = adminLogin(params); break;

      // Toplu yükleme (YENİ)
      case "bootstrap":       _checkAuth(params.token); result = bootstrap(params); break;

      // Read
      case "getCourses":     _checkAuth(params.token); result = { ok: true, data: getCourses() }; break;
      case "getLessons":     _checkAuth(params.token); result = { ok: true, data: getLessons(params.courseId) }; break;
      case "getMaterials":   _checkAuth(params.token); result = { ok: true, data: getMaterials(params.lessonId) }; break;
      case "getInstructors": _checkAuth(params.token, "admin"); result = { ok: true, data: getInstructors() }; break;

      // Courses
      case "addCourse":    _checkAuth(params.token, "admin"); result = addCourse(params); break;
      case "updateCourse": _checkAuth(params.token, "admin"); result = updateCourse(params); break;
      case "deleteCourse": _checkAuth(params.token, "admin"); result = deleteCourse(params); break;

      // Lessons
      case "addLesson":    _checkAuth(params.token, "admin"); result = addLesson(params); break;
      case "updateLesson": _checkAuth(params.token, "admin"); result = updateLesson(params); break;
      case "deleteLesson": _checkAuth(params.token, "admin"); result = deleteLesson(params); break;

      // Materials
      case "saveMaterial": _checkAuth(params.token, "admin"); result = saveMaterial(params); break;

      // Instructors
      case "addInstructor":    _checkAuth(params.token, "admin"); result = addInstructor(params); break;
      case "updateInstructor": _checkAuth(params.token, "admin"); result = updateInstructor(params); break;
      case "deleteInstructor": _checkAuth(params.token, "admin"); result = deleteInstructor(params); break;

      default: result = { ok: false, error: "Bilinmeyen işlem: " + action };
    }
    return _json(result);
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ====================== CACHE ======================
const CACHE_TTL = 300; // 5 dakika

function _cacheGet(key) {
  try {
    const v = CacheService.getScriptCache().get(key);
    return v ? JSON.parse(v) : null;
  } catch (e) { return null; }
}

function _cachePut(key, value) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(value), CACHE_TTL);
  } catch (e) { /* boyut limiti aşıldıysa sessizce geç */ }
}

function _invalidateCache(name) {
  try { CacheService.getScriptCache().remove("rows:" + name); } catch (e) {}
}

function _invalidateAllCache() {
  try {
    CacheService.getScriptCache().removeAll(
      Object.keys(SHEETS_SCHEMA).map(n => "rows:" + n)
    );
  } catch (e) {}
}

// ====================== YARDIMCILAR ======================

function _ensureSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS_SCHEMA).forEach(name => {
    if (!ss.getSheetByName(name)) {
      const sh = ss.insertSheet(name);
      const headers = SHEETS_SCHEMA[name];
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
      sh.setFrozenRows(1);
    }
  });
  if (!_getConfigValue("adminPassword")) {
    const cfg = ss.getSheetByName("Config");
    if (cfg) cfg.appendRow(["adminPassword", "admin123"]);
    _invalidateCache("Config");
  }
}

function _sheet(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error("Sayfa bulunamadı: " + name);
  return sh;
}

/** Cache'li satır okuyucu — büyük hız kazancı buradan geliyor. */
function _rows(name) {
  const cached = _cacheGet("rows:" + name);
  if (cached) return cached;

  const sh = _sheet(name);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) {
    _cachePut("rows:" + name, []);
    return [];
  }
  const headers = data[0];
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      let v = data[i][j];
      if (v instanceof Date) v = v.toISOString();
      obj[headers[j]] = v;
    }
    obj._row = i + 1;
    rows.push(obj);
  }
  _cachePut("rows:" + name, rows);
  return rows;
}

function _newId() { return Utilities.getUuid().slice(0, 8); }
function _now()   { return new Date().toISOString(); }

function _getConfigValue(key) {
  const r = _rows("Config").find(x => x.key === key);
  return r ? String(r.value) : "";
}

// ====================== AUTH ======================

function _checkAuth(token, requiredRole) {
  if (!token) throw new Error("Yetkisiz erişim (Oturum açılmamış).");
  if (token.startsWith("admin:")) {
    if (token.split(":")[1] === _getConfigValue("adminPassword")) return "admin";
    throw new Error("Geçersiz admin şifresi.");
  }
  if (token.startsWith("ins:")) {
    const parts = token.split(":");
    const u = _rows("Instructors").find(x => x.id === parts[1] && String(x.password) === parts[2]);
    if (!u) throw new Error("Geçersiz eğitmen oturumu.");
    if (requiredRole === "admin") throw new Error("Güvenlik İhlali: Bu işlem için Admin yetkisi gerekiyor.");
    return "instructor";
  }
  throw new Error("Geçersiz token formatı.");
}

function adminLogin({ password }) {
  if (String(password) === _getConfigValue("adminPassword")) {
    return { ok: true, role: "admin", token: "admin:" + password };
  }
  return { ok: false, error: "Hatalı admin şifresi." };
}

function instructorLogin({ email, password }) {
  const u = _rows("Instructors").find(x =>
    String(x.email).trim().toLowerCase() === String(email).trim().toLowerCase() &&
    String(x.password) === String(password)
  );
  if (!u) return { ok: false, error: "E-posta veya şifre hatalı." };
  return {
    ok: true, role: "instructor", token: "ins:" + u.id + ":" + u.password,
    user: { id: u.id, name: u.name, email: u.email }
  };
}

// ====================== BOOTSTRAP (yeni) ======================
/**
 * Tek istekte tüm veriyi döndür: kurslar + tüm dersler (kursa göre gruplanmış)
 * + tüm materyaller (derse göre indekslenmiş). Admin ise eğitmenler de.
 * Frontend bunu çağırınca artık tek tek getCourses/getLessons/getMaterials gerekmez.
 */
function bootstrap({ role }) {
  const courses = _rows("Courses").map(r => ({
    id: r.id, name: r.name, description: r.description, createdAt: r.createdAt
  }));

  const lessonsRaw = _rows("Lessons");
  const lessonsByCourse = {};
  lessonsRaw.forEach(r => {
    const l = { id: r.id, courseId: r.courseId, title: r.title, order: r.order, createdAt: r.createdAt };
    (lessonsByCourse[l.courseId] = lessonsByCourse[l.courseId] || []).push(l);
  });
  Object.keys(lessonsByCourse).forEach(k => {
    lessonsByCourse[k].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  });

  const materialsByLesson = {};
  _rows("Materials").forEach(m => {
    materialsByLesson[m.lessonId] = {
      id: m.id, lessonId: m.lessonId, content: m.content, type: m.type || "html"
    };
  });

  const result = { ok: true, courses, lessonsByCourse, materialsByLesson };

  if (role === "admin") {
    result.instructors = _rows("Instructors").map(r => ({
      id: r.id, name: r.name, email: r.email, password: r.password, createdAt: r.createdAt
    }));
  }
  return result;
}

// ====================== COURSES ======================

function getCourses() {
  return _rows("Courses").map(r => ({
    id: r.id, name: r.name, description: r.description, createdAt: r.createdAt
  }));
}

function addCourse({ name, description }) {
  const sh = _sheet("Courses");
  const id = _newId();
  sh.appendRow([id, name || "", description || "", _now()]);
  _invalidateCache("Courses");
  return { ok: true, id };
}

function updateCourse({ id, name, description }) {
  const sh = _sheet("Courses");
  const r = _rows("Courses").find(x => x.id === id);
  if (!r) return { ok: false, error: "Kurs bulunamadı." };
  sh.getRange(r._row, 2).setValue(name);
  sh.getRange(r._row, 3).setValue(description || "");
  _invalidateCache("Courses");
  return { ok: true };
}

function deleteCourse({ id }) {
  const lessons = _rows("Lessons").filter(x => x.courseId === id);
  lessons.forEach(l => deleteLesson({ id: l.id }));
  const sh = _sheet("Courses");
  const r = _rows("Courses").find(x => x.id === id);
  if (!r) return { ok: false, error: "Kurs bulunamadı." };
  sh.deleteRow(r._row);
  _invalidateCache("Courses");
  return { ok: true };
}

// ====================== LESSONS ======================

function getLessons(courseId) {
  return _rows("Lessons")
    .filter(r => r.courseId === courseId)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    .map(r => ({ id: r.id, courseId: r.courseId, title: r.title, order: r.order, createdAt: r.createdAt }));
}

function addLesson({ courseId, title, order }) {
  const sh = _sheet("Lessons");
  const id = _newId();
  if (!order) {
    const existing = _rows("Lessons").filter(x => x.courseId === courseId).length;
    order = existing + 1;
  }
  sh.appendRow([id, courseId, title || "", order, _now()]);
  _invalidateCache("Lessons");
  return { ok: true, id };
}

function updateLesson({ id, title, order }) {
  const sh = _sheet("Lessons");
  const r = _rows("Lessons").find(x => x.id === id);
  if (!r) return { ok: false, error: "Ders bulunamadı." };
  if (title !== undefined) sh.getRange(r._row, 3).setValue(title);
  if (order !== undefined) sh.getRange(r._row, 4).setValue(order);
  _invalidateCache("Lessons");
  return { ok: true };
}

function deleteLesson({ id }) {
  const mats = _rows("Materials").filter(x => x.lessonId === id);
  if (mats.length) {
    const sh = _sheet("Materials");
    mats.sort((a, b) => b._row - a._row).forEach(m => sh.deleteRow(m._row));
    _invalidateCache("Materials");
  }
  const sh = _sheet("Lessons");
  const r = _rows("Lessons").find(x => x.id === id);
  if (!r) return { ok: false, error: "Ders bulunamadı." };
  sh.deleteRow(r._row);
  _invalidateCache("Lessons");
  return { ok: true };
}

// ====================== MATERIALS ======================

function getMaterials(lessonId) {
  const m = _rows("Materials").find(x => x.lessonId === lessonId);
  if (!m) return { lessonId, content: "", type: "html" };
  return { id: m.id, lessonId: m.lessonId, content: m.content, type: m.type || "html" };
}

function saveMaterial({ lessonId, content, type }) {
  const sh = _sheet("Materials");
  const existing = _rows("Materials").find(x => x.lessonId === lessonId);
  if (existing) {
    sh.getRange(existing._row, 3).setValue(content || "");
    sh.getRange(existing._row, 4).setValue(type || "html");
  } else {
    sh.appendRow([_newId(), lessonId, content || "", type || "html"]);
  }
  _invalidateCache("Materials");
  return { ok: true };
}

// ====================== INSTRUCTORS ======================

function getInstructors() {
  return _rows("Instructors").map(r => ({
    id: r.id, name: r.name, email: r.email, password: r.password, createdAt: r.createdAt
  }));
}

function addInstructor({ name, email, password }) {
  const exists = _rows("Instructors").find(x =>
    String(x.email).trim().toLowerCase() === String(email).trim().toLowerCase()
  );
  if (exists) return { ok: false, error: "Bu e-posta zaten kayıtlı." };
  const sh = _sheet("Instructors");
  const id = _newId();
  sh.appendRow([id, name || "", email || "", password || "", _now()]);
  _invalidateCache("Instructors");
  return { ok: true, id };
}

function updateInstructor({ id, name, email, password }) {
  const sh = _sheet("Instructors");
  const r = _rows("Instructors").find(x => x.id === id);
  if (!r) return { ok: false, error: "Eğitmen bulunamadı." };
  if (name !== undefined)  sh.getRange(r._row, 2).setValue(name);
  if (email !== undefined) sh.getRange(r._row, 3).setValue(email);
  if (password !== undefined && password !== "") sh.getRange(r._row, 4).setValue(password);
  _invalidateCache("Instructors");
  return { ok: true };
}

function deleteInstructor({ id }) {
  const sh = _sheet("Instructors");
  const r = _rows("Instructors").find(x => x.id === id);
  if (!r) return { ok: false, error: "Eğitmen bulunamadı." };
  sh.deleteRow(r._row);
  _invalidateCache("Instructors");
  return { ok: true };
}