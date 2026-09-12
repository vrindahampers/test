// ================================================================
// Chatly — admin.js
// SECURITY MODEL:
//  - Admin logs in with Firebase Authentication (same provider as users).
//  - Authorization lives in the DATABASE SECURITY RULES:
//      users/{uid}/role === "admin" is required to read users/reports/adminLogs
//      and to change account status. A normal user logging in here gets
//      "permission denied" — the frontend check below is only cosmetic.
//  - Every admin action writes an audit record to adminLogs/.
// ================================================================

const $ = id => document.getElementById(id);
const DEFAULT_AVATAR = "https://ui-avatars.com/api/?background=334155&color=fff&name=";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function timeStr(ts) {
  return ts ? new Date(ts).toLocaleString() : "";
}
function confirmBox(text) {
  return new Promise(resolve => {
    $("confirm-text").textContent = text;
    $("confirm-modal").classList.remove("hidden");
    $("confirm-yes").onclick = () => { $("confirm-modal").classList.add("hidden"); resolve(true); };
    $("confirm-no").onclick = () => { $("confirm-modal").classList.add("hidden"); resolve(false); };
  });
}
function toast(msg) {
  const m = $("ad-msg");
  m.textContent = msg;
  m.classList.remove("hidden");
  setTimeout(() => m.classList.add("hidden"), 3000);
}

// ---------- Audit log ----------
async function audit(action, targetUid, extra = {}) {
  await db.ref("adminLogs/" + db.ref("adminLogs").push().key).set({
    adminUid: auth.currentUser.uid, action, targetUid,
    timestamp: firebase.database.ServerValue.TIMESTAMP, ...extra
  });
}

// ---------- Auth gate ----------
$("btn-admin-login").onclick = () => {
  auth.signInWithEmailAndPassword($("ad-email").value.trim(), $("ad-password").value)
    .catch(err => toast(err.message));
};
$("admin-logout").onclick = () => auth.signOut();

auth.onAuthStateChanged(async user => {
  if (!user) {
    $("admin-login").classList.remove("hidden");
    $("admin-panel").classList.add("hidden");
    return;
  }
  // Ask the database itself whether this account is an admin.
  // If the security rules are correct, a non-admin gets permission denied here.
  try {
    const snap = await db.ref("users/" + user.uid + "/role").get();
    if (snap.val() !== "admin") throw new Error("permission denied");
  } catch {
    toast("Access denied: this account is not an admin (blocked by security rules).");
    await auth.signOut();
    return;
  }
  $("admin-login").classList.add("hidden");
  $("admin-panel").classList.remove("hidden");
  loadDashboard();
  loadReports();
  loadLogs();
});

// ---------- Navigation ----------
document.querySelectorAll(".admin-nav a[data-sec]").forEach(a => {
  a.onclick = () => {
    document.querySelectorAll(".admin-nav a").forEach(x => x.classList.remove("active"));
    a.classList.add("active");
    ["dashboard", "users", "reports", "database", "logs"].forEach(s =>
      $("sec-" + s).classList.toggle("hidden", s !== a.dataset.sec));
  };
});

// ---------- Dashboard ----------
async function loadDashboard() {
  const stats = { totalUsers: 0, online: 0, active: 0, suspended: 0, disabled: 0, banned: 0 };
  const users = (await db.ref("users").get()).val() || {};
  const recent = [];
  Object.entries(users).forEach(([uid, u]) => {
    stats.totalUsers++;
    const st = u.status || "active";
    stats[st] = (stats[st] || 0) + 1;
    if (st === "active") stats.active++;
    recent.push({ uid, ...u });
  });
  const presence = (await db.ref("presence").get()).val() || {};
  stats.online = Object.values(presence).filter(p => p.online).length;
  const messagesCount = (await db.ref("messages").get()).val() || {};
  const totalChats = Object.keys(messagesCount).length;
  const totalMsgs = Object.values(messagesCount).reduce((n, c) => n + Object.keys(c || {}).length, 0);
  const reports = (await db.ref("reports").get()).val() || {};
  const pendingReports = Object.values(reports).filter(r => r.status === "pending").length;

  $("stat-grid").innerHTML = [
    ["Total users", stats.totalUsers], ["Online users", stats.online],
    ["Active users", stats.active], ["Suspended", stats.suspended],
    ["Disabled", stats.disabled], ["Banned", stats.banned],
    ["Total chats", totalChats], ["Total messages", totalMsgs],
    ["Pending reports", pendingReports]
  ].map(([label, val]) =>
    `<div class="stat-card"><b>${val}</b><span>${label}</span></div>`).join("");

  recent.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  $("recent-users").innerHTML = recent.slice(0, 8).map(u =>
    `<div class="list-item"><img class="avatar sm" src="${u.photoURL || DEFAULT_AVATAR + encodeURIComponent(u.username)}">
     <div class="grow"><b>${escapeHtml(u.username)}</b></div>
     <span class="muted small">${timeStr(u.createdAt)}</span></div>`).join("");
  const repList = Object.values(reports).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  $("recent-reports").innerHTML = repList.slice(0, 5).map(r =>
    `<div class="small">🚩 <b>${escapeHtml(r.reason)}</b> <span class="muted">(${r.status})</span></div>`).join("")
    || "<span class='muted small'>None</span>";
  const logs = (await db.ref("adminLogs").limitToLast(8).get()).val() || {};
  $("recent-activity").innerHTML = Object.values(logs).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .map(l => `<div class="small">${escapeHtml(l.action)} → <span class="muted">${escapeHtml(l.targetUid || "")}</span> <span class="muted small">${timeStr(l.timestamp)}</span></div>`)
    .join("") || "<span class='muted small'>No activity yet</span>";
}


// ---------- Users ----------
$("admin-user-search").oninput = e => {
  const q = e.target.value.trim().toLowerCase();
  if (q.length < 2) { $("admin-user-results").innerHTML = ""; return; }
  db.ref("usernames").orderByKey().startAt(q).endAt(q + "\uf8ff").get().then(async snap => {
    const box = $("admin-user-results");
    box.innerHTML = "";
    for (const uid of Object.values(snap.val() || {})) {
      const u = (await db.ref("users/" + uid).get()).val();
      if (!u) continue;
      const row = document.createElement("div");
      row.className = "list-item";
      row.innerHTML = `<img class="avatar" src="${u.photoURL || DEFAULT_AVATAR + encodeURIComponent(u.username)}">
        <div class="grow"><b>${escapeHtml(u.username)}</b>
        <div class="muted small">${escapeHtml(u.email || "")} · ${u.status || "active"}</div></div>`;
      row.onclick = () => showAdminUser(uid);
      box.appendChild(row);
    }
  });
};

async function showAdminUser(uid) {
  const p = (await db.ref("users/" + uid).get()).val();
  if (!p) return toast("User not found");
  const box = $("admin-user-detail");
  box.classList.remove("hidden");
  const followers = Object.keys((await db.ref("followers/" + uid).get()).val() || {}).length;
  const following = Object.keys((await db.ref("following/" + uid).get()).val() || {}).length;
  const blocks = Object.keys((await db.ref("blocks/" + uid).get()).val() || {}).length;
  const reportsOn = Object.values((await db.ref("reports").get()).val() || {})
    .filter(r => r.reportedUid === uid).length;

  box.innerHTML = `
    <h3>${escapeHtml(p.displayName || "")} <span class="muted">@${escapeHtml(p.username)}</span>
        <span class="status-${escapeHtml(p.status || "active")}">(${escapeHtml(p.status || "active")})</span></h3>
    <p class="small muted">UID: <code>${escapeHtml(uid)}</code> · Email: ${escapeHtml(p.email || "—")} ·
       Joined: ${timeStr(p.createdAt)} · Private: ${!!p.isPrivate}</p>
    <p class="small">Followers: ${followers} · Following: ${following} · Blocks: ${blocks} · Reports on user: ${reportsOn}</p>
    <p class="small">Bio: ${escapeHtml(p.bio || "—")}</p>
    <div class="row-btns" style="justify-content:flex-start;margin-top:10px" id="admin-user-actions"></div>
    <div class="admin-section" style="margin-top:14px">
      <h3>Edit profile data</h3>
      <input id="ad-edit-name" value="${escapeHtml(p.displayName || "")}" placeholder="Display name">
      <input id="ad-edit-username" value="${escapeHtml(p.username || "")}" placeholder="Username" style="margin-left:8px">
      <input id="ad-edit-bio" value="${escapeHtml(p.bio || "")}" placeholder="Bio" style="margin-left:8px;width:40%">
      <button id="ad-save-profile" class="btn small primary" style="margin-left:8px">Save</button>
      <button id="ad-clear-photo" class="btn small danger" style="margin-left:8px">Remove photo</button>
    </div>`;

  const actions = $("admin-user-actions");
  const add = (label, fn, danger) => {
    const b = document.createElement("button");
    b.className = "btn small" + (danger ? " danger" : "");
    b.textContent = label;
    b.onclick = fn;
    actions.appendChild(b);
  };
  const setStatus = async (status, label) => {
    if (!(await confirmBox(label + " this user?"))) return;
    const prev = (await db.ref("users/" + uid + "/status").get()).val() || "active";
    await db.ref("users/" + uid + "/status").set(status);
    await audit("user_" + status, uid, { previousValue: prev, newValue: status });
    toast(label + " done");
    showAdminUser(uid);
  };
  add("Suspend", () => setStatus("suspended", "Suspend"), false);
  add("Disable", () => setStatus("disabled", "Disable"), false);
  add("Ban", () => setStatus("banned", "Ban"), true);
  add("Set active", () => setStatus("active", "Re-activate"), false);


  add("Revoke sessions", async () => {
    if (!(await confirmBox("Mark this user for forced logout?"))) return;
    await db.ref("users/" + uid + "/sessionRevokedAt").set(firebase.database.ServerValue.TIMESTAMP);
    await audit("sessions_revoked", uid);
    toast("Marked. Full token revocation requires the Admin SDK (see README).");
  }, false);
  add("Reset restrictions", async () => {
    if (!(await confirmBox("Reset all application-level restrictions (status=active)?"))) return;
    await db.ref("users/" + uid).update({ status: "active" });
    await audit("restrictions_reset", uid);
    toast("Done");
    showAdminUser(uid);
  }, false);
  add("Delete user", async () => {
    if (!(await confirmBox("PERMANENTLY delete this user's application data? Auth account deletion requires the Admin SDK (see README)."))) return;
    await Promise.all([
      db.ref("users/" + uid).remove(),
      db.ref("usernames/" + (p.usernameLower || p.username.toLowerCase())).remove(),
      db.ref("followRequests/" + uid).remove(),
      db.ref("followers/" + uid).remove(),
      db.ref("following/" + uid).remove(),
      db.ref("blocks/" + uid).remove(),
      db.ref("presence/" + uid).remove(),
      db.ref("notifications/" + uid).remove()
    ]);
    await audit("user_deleted", uid, { previousValue: p.username });
    toast("App data deleted");
    box.classList.add("hidden");
    loadDashboard();
  }, true);

  $("ad-save-profile").onclick = async () => {
    const newName = $("ad-edit-name").value.trim();
    const newUsername = $("ad-edit-username").value.trim().toLowerCase();
    const newBio = $("ad-edit-bio").value.trim();
    if (!/^[a-z0-9_]{3,20}$/.test(newUsername)) return toast("Invalid username");
    const prev = { displayName: p.displayName, username: p.username, bio: p.bio };
    if (newUsername !== (p.usernameLower || p.username.toLowerCase())) {
      const taken = await db.ref("usernames/" + newUsername).get();
      if (taken.exists() && taken.val() !== uid) return toast("Username already taken");
      await db.ref("usernames/" + (p.usernameLower || p.username.toLowerCase())).remove();
      await db.ref("usernames/" + newUsername).set(uid);
    }
    await db.ref("users/" + uid).update({
      displayName: newName, username: newUsername, usernameLower: newUsername, bio: newBio
    });
    await audit("profile_updated", uid, { previousValue: prev,
      newValue: { displayName: newName, username: newUsername, bio: newBio } });
    toast("Profile updated");
    showAdminUser(uid);
  };
  $("ad-clear-photo").onclick = async () => {
    if (!(await confirmBox("Remove this user's profile picture?"))) return;
    await db.ref("users/" + uid + "/photoURL").remove();
    await audit("profile_updated", uid, { previousValue: "photoURL", newValue: null });
    toast("Photo removed");
    showAdminUser(uid);
  };
}


// ---------- Reports ----------
async function loadReports() {
  const snap = (await db.ref("reports").get()).val() || {};
  const tbody = document.querySelector("#reports-table tbody");
  const rows = Object.entries(snap).sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));
  tbody.innerHTML = "";
  for (const [id, r] of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="small">${timeStr(r.timestamp)}</td>
      <td class="small">${escapeHtml(r.reporterUid)}</td>
      <td class="small">${escapeHtml(r.reportedUid)}</td>
      <td class="small">${escapeHtml(r.reason)}</td>
      <td class="small">${escapeHtml(r.status)}</td><td></td>`;
    const cell = tr.lastElementChild;
    ["pending", "reviewed", "resolved"].forEach(st => {
      const b = document.createElement("button");
      b.className = "btn small";
      b.textContent = st;
      b.onclick = async () => {
        await db.ref("reports/" + id + "/status").set(st);
        await audit("report_" + st, r.reportedUid, { newValue: st, reason: r.reason });
        loadReports();
      };
      cell.appendChild(b);
    });
    const act = document.createElement("button");
    act.className = "btn small danger";
    act.textContent = "Act on user";
    act.onclick = () => { showSection("users"); showAdminUser(r.reportedUid); };
    cell.appendChild(act);
    tbody.appendChild(tr);
  }
  if (!rows.length) tbody.innerHTML = "<tr><td colspan='6' class='muted small'>No reports</td></tr>";
}

// ---------- Database management ----------
$("btn-db-load").onclick = async () => {
  const node = $("db-node").value;
  const filter = ($("db-search").value || "").toLowerCase();
  const snap = (await db.ref(node).get()).val() || {};
  const view = $("db-view");
  let entries = Object.entries(snap);
  const json = e => JSON.stringify(e);
  if (filter) entries = entries.filter(([k, v]) => k.toLowerCase().includes(filter) || json(v).toLowerCase().includes(filter));
  view.innerHTML = "<table><thead><tr><th>Key</th><th>Value</th><th>Actions</th></tr></thead><tbody></tbody></table>";
  const tbody = view.querySelector("tbody");
  entries.slice(0, 100).forEach(([k, v]) => {
    const tr = document.createElement("tr");
    const valueStr = typeof v === "object" ? JSON.stringify(v).slice(0, 300) : String(v);
    tr.innerHTML = `<td class="small"><code>${escapeHtml(k)}</code></td>
      <td class="small" style="max-width:420px;word-break:break-all">${escapeHtml(valueStr)}</td><td></td>`;
    const cell = tr.lastElementChild;
    const edit = document.createElement("button");
    edit.className = "btn small";
    edit.textContent = "Edit";
    edit.onclick = async () => {
      const nv = prompt("New value (JSON for objects):", valueStr);
      if (nv === null) return;
      let parsed;
      try { parsed = typeof v === "object" ? JSON.parse(nv) : nv; } catch { return toast("Invalid JSON"); }
      await db.ref(node + "/" + k).set(parsed);
      await audit("db_edit", null, { targetUid: node + "/" + k, previousValue: valueStr, newValue: nv });
      $("btn-db-load").onclick();
    };
    const del = document.createElement("button");
    del.className = "btn small danger";
    del.textContent = "Delete";
    del.onclick = async () => {
      if (!(await confirmBox("Delete record " + k + " from " + node + "?"))) return;
      await db.ref(node + "/" + k).remove();
      await audit("db_delete", null, { targetUid: node + "/" + k, previousValue: valueStr });
      $("btn-db-load").onclick();
    };
    cell.append(edit, del);
    tbody.appendChild(tr);
  });
  if (!entries.length) view.innerHTML += "<p class='muted small'>No matching records</p>";
};

// ---------- Audit logs ----------
async function loadLogs() {
  const snap = (await db.ref("adminLogs").limitToLast(100).get()).val() || {};
  const list = Object.values(snap).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  $("logs-view").innerHTML = list.map(l => `
    <div class="list-item"><div class="grow">
      <b class="small">${escapeHtml(l.action)}</b>
      <div class="muted small">admin: ${escapeHtml(l.adminUid)} · target: ${escapeHtml(l.targetUid || "—")} · ${timeStr(l.timestamp)}</div>
      ${l.reason ? `<div class="small">reason: ${escapeHtml(l.reason)}</div>` : ""}
      ${l.previousValue !== undefined ? `<div class="muted small">prev: ${escapeHtml(JSON.stringify(l.previousValue).slice(0, 120))} → new: ${escapeHtml(JSON.stringify(l.newValue).slice(0, 120))}</div>` : ""}
    </div></div>`).join("") || "<p class='muted small'>No logs yet</p>";
}

// helper used by reports → jump to users tab
function showSection(name) {
  document.querySelectorAll(".admin-nav a[data-sec]").forEach(x =>
    x.classList.toggle("active", x.dataset.sec === name));
  ["dashboard", "users", "reports", "database", "logs"].forEach(s =>
    $("sec-" + s).classList.toggle("hidden", s !== name));
}

