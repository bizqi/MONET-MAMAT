// ===========================
//  MOONLOADER SAMP SCRIPT HUB
//  script.js — Fixed Edition
// ===========================

// ─── KONFIGURASI ──────────────────────────────────────────────────────────────
const CONFIG = {
  adminPassword: "bizqi170811",

  supabaseUrl: "https://mmtivpvjmmavfjjmwnuc.supabase.co",
  supabaseKey: "sb_publishable_VzE6WjXgvI76mzSwe7TIYQ_tO2ez6ZC",

  bucket: "scripts",
  table: "scripts",

  iconMap: {
    ".lua": "🌙", ".cs": "⚙️", ".txt": "📄",
    ".zip": "📦", ".rar": "📦", ".asi": "🔧",
    ".dll": "🔧", "default": "📁"
  }
};

// ─── STATE ────────────────────────────────────────────────────────────────────
let supabaseClient = null;
let isAdmin = false;
let scripts = [];
let pendingFiles = [];
let currentPreviewId = null;

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Tunggu Supabase CDN load
  if (typeof window.supabase !== "undefined") {
    try {
      supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
    } catch(e) {
      console.warn("Supabase gagal init:", e);
      supabaseClient = null;
    }
  }

  initParticles();
  bindEvents();
  loadScripts();
});

// ─── LOAD SCRIPTS ─────────────────────────────────────────────────────────────
async function loadScripts() {
  showLoading(true);

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from(CONFIG.table)
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      scripts = data || [];
    } catch(e) {
      console.warn("Supabase load error, pakai localStorage:", e.message);
      loadFromLocal();
    }
  } else {
    loadFromLocal();
  }

  showLoading(false);
  renderGrid();
  updateStats();
}

function loadFromLocal() {
  try {
    const raw = localStorage.getItem("moonloader_scripts");
    scripts = raw ? JSON.parse(raw) : [];
  } catch(e) {
    scripts = [];
  }
}

// ─── UPLOAD ───────────────────────────────────────────────────────────────────
async function doUpload() {
  if (!isAdmin) { toast("Akses ditolak", "error"); return; }

  const name = document.getElementById("scriptName").value.trim();
  const desc = document.getElementById("scriptDesc").value.trim();
  const cat  = document.getElementById("scriptCat").value;
  const ver  = document.getElementById("scriptVersion").value.trim() || "1.0";

  if (!name)                   { toast("⚠ Nama script wajib diisi!", "error"); return; }
  if (pendingFiles.length === 0) { toast("⚠ Pilih minimal 1 file!", "error"); return; }

  const btn = document.getElementById("uploadBtn");
  btn.disabled = true;
  btn.textContent = "⏳ MENGUPLOAD...";

  if (supabaseClient) {
    await uploadToSupabase(name, desc, cat, ver);
  } else {
    await uploadToLocal(name, desc, cat, ver);
  }

  btn.disabled = false;
  btn.textContent = "⬆ UPLOAD SCRIPT";
}

async function uploadToSupabase(name, desc, cat, ver) {
  let successCount = 0;

  for (const file of pendingFiles) {
    const fileName = `${Date.now()}_${file.name.replace(/\s/g, "_")}`;

    const { error: storageErr } = await supabaseClient.storage
      .from(CONFIG.bucket)
      .upload(fileName, file, { cacheControl: "3600", upsert: false });

    if (storageErr) {
      toast(`Gagal upload ${file.name}: ${storageErr.message}`, "error");
      continue;
    }

    const { data: urlData } = supabaseClient.storage
      .from(CONFIG.bucket)
      .getPublicUrl(fileName);

    const { error: dbErr } = await supabaseClient.from(CONFIG.table).insert({
      name: pendingFiles.length > 1 ? `${name} (${file.name})` : name,
      description: desc, category: cat, version: ver,
      filename: file.name, file_path: fileName,
      file_url: urlData.publicUrl,
      size: file.size, downloads: 0
    });

    if (dbErr) {
      toast(`Gagal simpan metadata: ${dbErr.message}`, "error");
    } else {
      successCount++;
    }
  }

  if (successCount > 0) {
    resetForm();
    await loadScripts();
    toast(`✅ ${successCount} script berhasil diupload!`, "success");
  }
}

async function uploadToLocal(name, desc, cat, ver) {
  const promises = pendingFiles.map(file => new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = (e) => {
      scripts.unshift({
        id: genId(),
        name: pendingFiles.length > 1 ? `${name} (${file.name})` : name,
        description: desc, category: cat, version: ver,
        filename: file.name, size: file.size,
        file_url: e.target.result,
        downloads: 0,
        created_at: new Date().toISOString()
      });
      resolve();
    };
    reader.readAsDataURL(file);
  }));

  await Promise.all(promises);
  localStorage.setItem("moonloader_scripts", JSON.stringify(scripts));
  resetForm();
  renderGrid();
  renderManageList();
  updateStats();
  toast(`✅ Script berhasil diupload (mode lokal)!`, "success");
}

function resetForm() {
  document.getElementById("scriptName").value = "";
  document.getElementById("scriptDesc").value = "";
  document.getElementById("scriptVersion").value = "";
  document.getElementById("uploadQueue").innerHTML = "";
  pendingFiles = [];
}

// ─── DOWNLOAD ─────────────────────────────────────────────────────────────────
async function downloadScript(id) {
  const sc = scripts.find(s => s.id === id);
  if (!sc) { toast("File tidak ditemukan!", "error"); return; }

  const link = document.createElement("a");
  link.href = sc.file_url;
  link.download = sc.filename;
  link.target = "_blank";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  const newCount = (sc.downloads || 0) + 1;
  sc.downloads = newCount;

  if (supabaseClient) {
    await supabaseClient.from(CONFIG.table).update({ downloads: newCount }).eq("id", id);
  } else {
    localStorage.setItem("moonloader_scripts", JSON.stringify(scripts));
  }

  updateStats();
  toast(`⬇ Downloading: ${sc.filename}`, "success");
}

// ─── DELETE ───────────────────────────────────────────────────────────────────
async function deleteScript(id) {
  if (!isAdmin) return;
  if (!confirm("Yakin hapus script ini?")) return;

  const sc = scripts.find(s => s.id === id);

  if (supabaseClient) {
    if (sc && sc.file_path) {
      await supabaseClient.storage.from(CONFIG.bucket).remove([sc.file_path]);
    }
    const { error } = await supabaseClient.from(CONFIG.table).delete().eq("id", id);
    if (error) { toast("Gagal hapus: " + error.message, "error"); return; }
  } else {
    scripts = scripts.filter(s => s.id !== id);
    localStorage.setItem("moonloader_scripts", JSON.stringify(scripts));
  }

  scripts = scripts.filter(s => s.id !== id);
  renderGrid();
  renderManageList();
  updateStats();
  toast("🗑 Script dihapus", "info");
}

// ─── RENDER ───────────────────────────────────────────────────────────────────
function renderGrid(data) {
  const grid  = document.getElementById("fileGrid");
  const empty = document.getElementById("emptyState");
  const badge = document.getElementById("fileCount");
  const list  = data !== undefined ? data : scripts;

  grid.innerHTML = "";
  badge.textContent = `${list.length} file`;

  if (list.length === 0) {
    grid.style.display = "none";
    empty.style.display = "block";
  } else {
    grid.style.display = "grid";
    empty.style.display = "none";
    list.forEach((sc, i) => grid.appendChild(createCard(sc, i)));
  }
}

function createCard(sc, index) {
  const div = document.createElement("div");
  div.className = "file-card";
  div.style.animationDelay = `${index * 0.05}s`;

  const icon = getIcon(sc.filename);
  div.innerHTML = `
    <div class="card-top">
      <span class="card-icon">${icon}</span>
      <span class="card-cat cat-${sc.category || "misc"}">${sc.category || "misc"}</span>
    </div>
    <div class="card-name">${escHtml(sc.name)}</div>
    <div class="card-desc">${escHtml(sc.description || "Tidak ada deskripsi.")}</div>
    <div class="card-footer">
      <button class="card-dl-btn" data-id="${sc.id}">⬇ DOWNLOAD</button>
    </div>
  `;

  div.addEventListener("click", e => {
    if (!e.target.classList.contains("card-dl-btn")) openPreview(sc.id);
  });
  div.querySelector(".card-dl-btn").addEventListener("click", e => {
    e.stopPropagation();
    downloadScript(sc.id);
  });

  return div;
}

function updateStats() {
  document.getElementById("totalFiles").textContent = scripts.length;
  const total = scripts.reduce((s, sc) => s + (sc.downloads || 0), 0);
  document.getElementById("totalDownloads").textContent = total;
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────
function applyFilter() {
  const q   = document.getElementById("searchInput").value.toLowerCase().trim();
  const cat = document.getElementById("filterCat").value;
  const filtered = scripts.filter(sc => {
    const mQ = !q || sc.name.toLowerCase().includes(q) || (sc.description||"").toLowerCase().includes(q);
    const mC = !cat || sc.category === cat;
    return mQ && mC;
  });
  renderGrid(filtered);
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function tryLogin() {
  const pw  = document.getElementById("passwordInput").value;
  const err = document.getElementById("loginError");

  if (pw === CONFIG.adminPassword) {
    isAdmin = true;
    err.textContent = "";
    document.getElementById("loginForm").style.display = "none";
    document.getElementById("adminPanel").style.display = "block";
    renderManageList();
    toast("Login berhasil! Selamat datang, Admin 🌙", "success");
  } else {
    err.textContent = "⚠ Password salah!";
    shake(document.querySelector(".modal"));
  }
}

function logout() {
  isAdmin = false;
  pendingFiles = [];
  document.getElementById("adminPanel").style.display = "none";
  document.getElementById("loginForm").style.display = "block";
  document.getElementById("passwordInput").value = "";
  document.getElementById("uploadQueue").innerHTML = "";
  closeModal("adminModal");
  toast("Berhasil logout", "info");
}

// ─── FILE SELECT ──────────────────────────────────────────────────────────────
function handleFileSelect(files) {
  if (!isAdmin) return;
  Array.from(files).forEach(file => {
    if (pendingFiles.find(f => f.name === file.name)) return;
    pendingFiles.push(file);
    if (!document.getElementById("scriptName").value)
      document.getElementById("scriptName").value = file.name.replace(/\.[^.]+$/, "");
  });
  renderUploadQueue();
}

function renderUploadQueue() {
  const c = document.getElementById("uploadQueue");
  c.innerHTML = "";
  pendingFiles.forEach((file, i) => {
    const item = document.createElement("div");
    item.className = "queue-item";
    item.innerHTML = `
      <span class="q-icon">${getIcon(file.name)}</span>
      <span class="q-name">${escHtml(file.name)}</span>
      <span class="q-size">${formatSize(file.size)}</span>
      <button class="q-remove" data-idx="${i}">✕</button>
    `;
    c.appendChild(item);
  });
  c.querySelectorAll(".q-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      pendingFiles.splice(parseInt(btn.dataset.idx), 1);
      renderUploadQueue();
    });
  });
}

// ─── MANAGE LIST ──────────────────────────────────────────────────────────────
function renderManageList() {
  const c = document.getElementById("manageList");
  c.innerHTML = "";
  if (scripts.length === 0) {
    c.innerHTML = `<p style="color:var(--text-muted);font-size:14px;text-align:center;padding:20px">Belum ada script</p>`;
    return;
  }
  scripts.forEach(sc => {
    const item = document.createElement("div");
    item.className = "manage-item";
    item.innerHTML = `
      <span>${getIcon(sc.filename)}</span>
      <span class="m-name">${escHtml(sc.name)}</span>
      <span class="m-cat">${sc.category}</span>
      <button class="m-del" data-id="${sc.id}">🗑</button>
    `;
    item.querySelector(".m-del").addEventListener("click", () => deleteScript(sc.id));
    c.appendChild(item);
  });
}

// ─── PREVIEW ──────────────────────────────────────────────────────────────────
function openPreview(id) {
  const sc = scripts.find(s => s.id === id);
  if (!sc) return;
  currentPreviewId = id;
  document.getElementById("previewIcon").textContent = getIcon(sc.filename);
  document.getElementById("previewName").textContent = sc.name;
  document.getElementById("previewCat").textContent  = sc.category || "misc";
  document.getElementById("previewDesc").textContent = sc.description || "Tidak ada deskripsi.";
  document.getElementById("previewDate").textContent = new Date(sc.created_at).toLocaleDateString("id-ID");
  document.getElementById("previewSize").textContent = formatSize(sc.size);
  document.getElementById("previewVer").textContent  = sc.version || "1.0";
  openModal("previewModal");
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add("active"); }
function closeModal(id) { document.getElementById(id).classList.remove("active"); }

// ─── LOADING ──────────────────────────────────────────────────────────────────
function showLoading(show) {
  const loadingEl = document.getElementById("loadingState");
  const gridEl    = document.getElementById("fileGrid");
  if (show) {
    loadingEl.style.display = "flex";
    gridEl.style.display    = "none";
  } else {
    loadingEl.style.display = "none";
    gridEl.style.display    = "grid";
  }
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function toast(msg, type = "info") {
  const c = document.getElementById("toastContainer");
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  const icons = { success:"✅", error:"❌", info:"ℹ️" };
  t.innerHTML = `<span>${icons[type]||"ℹ️"}</span><span>${escHtml(msg)}</span>`;
  c.appendChild(t);
  setTimeout(() => {
    t.style.animation = "slideOut 0.3s ease forwards";
    setTimeout(() => t.remove(), 300);
  }, 3500);
}

// ─── PARTICLES ────────────────────────────────────────────────────────────────
function initParticles() {
  const canvas = document.getElementById("particles");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let pts = [], w, h;
  const resize = () => { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; };
  const mkPt = () => ({ x: Math.random()*w, y: Math.random()*h, vx: (Math.random()-.5)*.4, vy: (Math.random()-.5)*.4, r: Math.random()*1.5+.5, alpha: Math.random()*.5+.1, color: Math.random()>.5 ? "0,212,255" : "123,47,255" });
  const draw = () => {
    ctx.clearRect(0, 0, w, h);
    pts.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = `rgba(${p.color},${p.alpha})`; ctx.fill();
    });
    for (let i = 0; i < pts.length; i++) {
      for (let j = i+1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, d = Math.sqrt(dx*dx + dy*dy);
        if (d < 120) {
          ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y);
          ctx.strokeStyle = `rgba(0,212,255,${.1*(1-d/120)})`; ctx.lineWidth = .5; ctx.stroke();
        }
      }
    }
    requestAnimationFrame(draw);
  };
  window.addEventListener("resize", resize);
  resize();
  pts = Array.from({ length: 80 }, mkPt);
  draw();
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function getIcon(fn) { const ext = (fn||"").substring((fn||"").lastIndexOf(".")).toLowerCase(); return CONFIG.iconMap[ext] || CONFIG.iconMap.default; }
function formatSize(b) { if (!b) return "0 B"; const u = ["B","KB","MB","GB"]; let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return `${b.toFixed(1)} ${u[i]}`; }
function escHtml(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function shake(el) { if (!el) return; el.style.animation = "none"; el.offsetHeight; el.style.animation = "shake 0.4s ease"; setTimeout(() => el.style.animation = "", 400); }

const _s = document.createElement("style");
_s.textContent = `
  @keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)} 40%{transform:translateX(8px)} 60%{transform:translateX(-6px)} 80%{transform:translateX(6px)} }
  @keyframes fadeInUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
  .card-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
  .card-icon{font-size:32px}
  .card-cat{font-size:10px;font-family:'Orbitron',sans-serif;letter-spacing:2px;text-transform:uppercase;padding:4px 10px;border-radius:100px;background:rgba(0,212,255,0.1);border:1px solid rgba(0,212,255,0.2);color:#00d4ff}
  .card-name{font-family:'Orbitron',sans-serif;font-size:14px;font-weight:700;letter-spacing:1px;margin-bottom:8px;line-height:1.3}
  .card-desc{font-size:13px;color:var(--text-muted);line-height:1.5;margin-bottom:20px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .card-footer{display:flex;gap:8px}
  .card-dl-btn{flex:1;background:linear-gradient(135deg,#00d4ff,#7b2fff);border:none;color:#fff;font-family:'Orbitron',sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;padding:10px;border-radius:6px;cursor:pointer;transition:all 0.3s}
  .card-dl-btn:hover{transform:translateY(-2px);box-shadow:0 4px 15px rgba(0,212,255,0.4)}
  .empty-state{text-align:center;padding:80px 24px;display:none}
`;
document.head.appendChild(_s);

// ─── BIND EVENTS ──────────────────────────────────────────────────────────────
function bindEvents() {
  // Admin button
  document.getElementById("adminBtn").addEventListener("click", () => {
    if (isAdmin) {
      document.getElementById("loginForm").style.display = "none";
      document.getElementById("adminPanel").style.display = "block";
    } else {
      document.getElementById("loginForm").style.display = "block";
      document.getElementById("adminPanel").style.display = "none";
    }
    openModal("adminModal");
  });

  // Modal close
  document.getElementById("modalClose").addEventListener("click",   () => closeModal("adminModal"));
  document.getElementById("previewClose").addEventListener("click", () => closeModal("previewModal"));
  document.getElementById("adminModal").addEventListener("click",   function(e){ if (e.target === this) closeModal("adminModal"); });
  document.getElementById("previewModal").addEventListener("click", function(e){ if (e.target === this) closeModal("previewModal"); });

  // Auth
  document.getElementById("loginBtn").addEventListener("click", tryLogin);
  document.getElementById("passwordInput").addEventListener("keydown", e => { if (e.key === "Enter") tryLogin(); });
  document.getElementById("logoutBtn").addEventListener("click", logout);

  // Upload
  document.getElementById("uploadBtn").addEventListener("click", doUpload);
  document.getElementById("fileInput").addEventListener("change", e => handleFileSelect(e.target.files));

  // Drop zone
  const dz = document.getElementById("dropZone");
  dz.addEventListener("dragover",  e => { e.preventDefault(); dz.classList.add("drag-over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag-over"));
  dz.addEventListener("drop",      e => { e.preventDefault(); dz.classList.remove("drag-over"); handleFileSelect(e.dataTransfer.files); });
  dz.addEventListener("click",     e => { if (e.target !== document.querySelector("label[for='fileInput']")) document.getElementById("fileInput").click(); });

  // Search & filter
  document.getElementById("searchInput").addEventListener("input",  applyFilter);
  document.getElementById("filterCat").addEventListener("change",   applyFilter);

  // Preview download
  document.getElementById("previewDownload").addEventListener("click", () => {
    if (currentPreviewId) { downloadScript(currentPreviewId); closeModal("previewModal"); }
  });

  // ESC key
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeModal("adminModal"); closeModal("previewModal"); }
  });
}