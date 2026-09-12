// ================================================================
// Chatly — script.js  (main user app logic)
// Sections: helpers → auth → profile/social → chat → notifications
// ================================================================

// ---------- 1. Helpers ----------
const $ = id => document.getElementById(id);
const state = { uid: null, profile: null, listeners: [] };
const DEFAULT_AVATAR = "https://ui-avatars.com/api/?background=00a884&color=fff&name=";

/*
 * bind(id, event, fn) — safely attach a handler. If the element is missing
 * (e.g. during a partial/outdated deployment) we log a warning instead of
 * throwing and breaking the rest of the app.
 */
function bind(id, event, fn) {
  const el = document.getElementById(id);
  if (!el) { console.log("SKIP_MISSING_ELEMENT #" + id); return; }
  el.addEventListener(event, fn);
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 2500);
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function timeStr(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const today = new Date().toDateString();
  if (d.toDateString() === today) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}
function chatIdOf(a, b) { return [a, b].sort().join("_"); }
function avatarFor(u) { return u?.photoURL || DEFAULT_AVATAR + encodeURIComponent(u?.displayName || u?.username || "U"); }
function isRestricted(p) { return !p || p.status !== "active"; }
function restrictMsg(p) {
  return "Your account is " + (p?.status || "restricted") +
    ". You cannot perform this action. Contact support if you think this is a mistake.";
}
function confirmBox(text) {
  return new Promise(resolve => {
    $("confirm-text").textContent = text;
    $("confirm-modal").classList.remove("hidden");
    bind("confirm-yes", "click", () => { $("confirm-modal").classList.add("hidden"); resolve(true); });
    bind("confirm-no", "click", () => { $("confirm-modal").classList.add("hidden"); resolve(false); });
  });
}
function track(ref, event, cb) { const h = ref.on(event, cb); state.listeners.push({ ref, event, h }); return h; }
function clearListeners() {
  state.listeners.forEach(l => l.ref.off(l.event, l.h));
  state.listeners = [];
}
function showPage(name) {
  document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
  $("page-" + name)?.classList.remove("hidden");
  document.querySelectorAll("[data-page]").forEach(a => a.classList.toggle("active", a.dataset.page === name));
}

// Navigation is wired immediately so it keeps working even if a later step fails.
// ---------- Notifications ----------
function renderNotifications(snap) {
  const box = $("#notif-list");
  box.innerHTML = "";
  const items = [];
  snap.forEach(c => items.push({ id: c.key, ...c.val() }));
  items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  for (const n of items) {
    const el = document.createElement("div");
    el.className = "list-item" + (n.read ? "" : " unread");
    let icon = "💬";
    if (n.type === "follow") icon = "👤";
    else if (n.type === "follow_request") icon = "📩";
    else if (n.type === "follow_accept") icon = "✅";
    else if (n.type === "message") icon = "💬";
    el.innerHTML = `<div class="grow"><div class="bold text">${icon} ${escapeHtml(n.text || "")}</div>
      <div class="muted small">${timeStr(n.ts)}</div></div>`;
    if (!n.read) {
      el.onclick = async () => {
        await db.ref("notifications/" + state.uid + "/" + n.id + "/read").set(true);
        el.classList.add("read");
      };
    }
    box.appendChild(el);
  }
  if (!items.length) box.innerHTML = "<p class='muted small'>No notifications yet</p>";
}
function renderNotificationsPage() {
  db.ref("notifications/" + state.uid).orderByChild("ts").limitToLast(100).once("value").then(renderNotifications);
}
bind("btn-mark-read", "click", async () => {
  const ref = db.ref("notifications/" + state.uid);
  ref.once("value", snap => {
    snap.forEach(c => { if (!c.val().read) db.ref("notifications/" + state.uid + "/" + c.key + "/read").set(true); });
  });
  toast("All marked as read");
});
bindNav();

// Surface unexpected runtime errors via toast instead of failing silently.
window.addEventListener("error", e => {
  try { toast("Error: " + (e.message || "unknown")); } catch (_) {}
});

// ---------- 2. Authentication ----------
function authMsg(text) {
  const el = $("auth-msg");
  el.textContent = text;
  el.classList.remove("hidden");
}
function authView(name) {
  ["login", "signup", "email-link"].forEach(v => $(v + "-view").classList.add("hidden"));
  $(name + "-view").classList.remove("hidden");
}
bind("link-signup", "click", e => { e.preventDefault(); authView("signup"); });
bind("link-login", "click", e => { e.preventDefault(); authView("login"); });
bind("link-login2", "click", e => { e.preventDefault(); authView("login"); });
bind("link-email-login", "click", e => { e.preventDefault(); authView("email-link"); });

// --- Email + Password signup ---
bind("btn-signup", "click", async () => {
  const username = $("su-username").value.trim();
  const displayName = $("su-display").value.trim() || username;
  const email = $("su-email").value.trim().toLowerCase();
  const password = $("su-password").value;
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return authMsg("Username: 3-20 letters, numbers or _");
  if (password.length < 6) return authMsg("Password must be at least 6 characters");
  const uname = username.toLowerCase();
  try {
    const snap = await db.ref("usernames/" + uname).get();
    if (snap.exists()) return authMsg("That username is taken");
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.sendEmailVerification().catch(() => {});
    await db.ref("usernames/" + uname).set(cred.user.uid);
    await db.ref("users/" + cred.user.uid).set({
      username, usernameLower: uname, displayName, bio: "",
      email, photoURL: "", createdAt: firebase.database.ServerValue.TIMESTAMP,
      status: "active", isPrivate: false,
      settings: { whoCanMessage: "followers", showOnline: true, showLastSeen: true }
    });
  } catch (err) { authMsg(err.message); }
});

// --- Login (email OR username + password) ---
bind("btn-login", "click", async () => {
  const id = $("login-identifier").value.trim();
  const password = $("login-password").value;
  try {
    let email = id;
    if (!id.includes("@")) {
      const uidSnap = await db.ref("usernames/" + id.toLowerCase()).get();
      if (!uidSnap.exists()) return authMsg("Unknown username");
      const userSnap = await db.ref("users/" + uidSnap.val()).get();
      email = userSnap.val()?.email;
      if (!email) return authMsg("No email linked to that username");
    }
    await auth.signInWithEmailAndPassword(email, password);
  } catch (err) { authMsg(err.message); }
});

// --- Forgot / reset password ---
function sendReset(email) {
  if (!email) return authMsg("Enter your email first");
  auth.sendPasswordResetEmail(email)
    .then(() => toast("Password reset email sent"))
    .catch(err => authMsg(err.message));
}
bind("link-forgot", "click", e => { e.preventDefault(); sendReset($("login-identifier").value.trim()); });

// --- Email link (passwordless) login ---
bind("btn-send-link", "click", () => {
  const email = $("el-email").value.trim();
  if (!email) return authMsg("Enter your email");
  const actionCodeSettings = { url: location.origin + location.pathname, handleCodeInApp: true };
  auth.sendSignInLinkToEmail(email, actionCodeSettings)
    .then(() => {
      localStorage.setItem("emailForSignIn", email);
      authMsg("Link sent! Open it in this browser to log in.");
    })
    .catch(err => authMsg(err.message));
});

// --- Logout + reset password ---
bind("btn-logout", "click", () => auth.signOut());
bind("btn-logout2", "click", () => auth.signOut());
bind("btn-forgot-pw", "click", () => sendReset(state.profile?.email));

// Handle returning from an email-link login
if (auth.isSignInWithEmailLink(window.location.href)) {
  let email = localStorage.getItem("emailForSignIn") || prompt("Confirm your email to finish logging in:");
  if (email) {
    auth.signInWithEmailLink(email, window.location.href)
      .then(() => localStorage.removeItem("emailForSignIn"))
      .catch(err => authMsg(err.message));
  }
}


// ---------- 3. Session ----------
auth.onAuthStateChanged(async user => {
  clearListeners();
  if (!user) {
    state.uid = null; state.profile = null;
    $("auth-page").classList.remove("hidden");
    $("app-page").classList.add("hidden");
    return;
  }
  state.uid = user.uid;
  $("auth-page").classList.add("hidden");
  $("app-page").classList.remove("hidden");

  track(db.ref("users/" + user.uid), "value", snap => {
    const p = snap.val();
    if (!p) return;
    state.profile = p;
    renderMyHeader(p);
    checkRestriction(p);
    fillProfilePage(p);
    fillSettingsPage(p);
  });
  setupPresence(user.uid);
  listenNotifications(user.uid);
  loadChatList();
  loadRequests();
  showPage("chats");
});

function checkRestriction(p) {
  const banner = $("restriction-banner");
  const locked = isRestricted(p);
  banner.classList.toggle("hidden", !locked);
  if (locked) {
    banner.textContent = restrictMsg(p);
    if (p.status === "disabled" || p.status === "banned") {
      toast("Account " + p.status + " — you have been logged out.");
      auth.signOut();
    }
  }
}
function renderMyHeader(p) {
  $("my-avatar").src = avatarFor(p);
  $("my-displayname").textContent = p.displayName || p.username;
  $("my-username").textContent = "@" + p.username;
}

// ---------- 4. Presence (online / last seen) ----------
function setupPresence(uid) {
  const ref = db.ref("presence/" + uid);
  track(db.ref(".info/connected"), "value", snap => {
    if (snap.val() === true) {
      ref.onDisconnect().update({ online: false, lastSeen: firebase.database.ServerValue.TIMESTAMP });
      ref.update({ online: true, lastSeen: firebase.database.ServerValue.TIMESTAMP });
    }
  });
}

// ---------- 5. My profile ----------
function fillProfilePage(p) {
  $("profile-avatar").src = avatarFor(p);
  $("edit-displayname").value = p.displayName || "";
  $("edit-bio").value = p.bio || "";
  $("edit-private").checked = !!p.isPrivate;
  renderStats(state.uid, p.createdAt, "profile-stats");
}
async function renderStats(uid, createdAt, elId) {
  const f = (await db.ref("followers/" + uid).get()).numChildren();
  const g = (await db.ref("following/" + uid).get()).numChildren();
  const created = createdAt ? new Date(createdAt).toLocaleDateString() : "—";
  $(elId).innerHTML = `<div><b>${f}</b><span>Followers</span></div>
          <div><b>${g}</b><span>Following</span></div>
          <div><b style="font-size:14px">${created}</b><span>Joined</span></div>`;
}
bind("btn-save-profile", "click", async () => {
  if (isRestricted(state.profile)) return toast(restrictMsg(state.profile));
  const displayName = $("edit-displayname").value.trim();
  if (!displayName) return toast("Display name required");
  await db.ref("users/" + state.uid).update({
    displayName, bio: $("edit-bio").value.trim(), isPrivate: $("edit-private").checked
  });
  toast("Profile saved");
});
bind("avatar-file", "change", async e => {
  if (isRestricted(state.profile)) return toast(restrictMsg(state.profile));
  const file = e.target.files[0];
  if (!file) return;
  const snap = await storage.ref("profilePictures/" + state.uid + "/" + Date.now()).put(file);
  const url = await snap.ref.getDownloadURL();
  await db.ref("users/" + state.uid).update({ photoURL: url });
  toast("Profile picture updated");
});


// ---------- 6. User search ----------
let searchTimer = null;
bind("user-search", "input", e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = e.target.value.trim().toLowerCase();
    const box = $("user-results");
    box.innerHTML = "";
    if (q.length < 2) return;
    const found = new Map();
    try {
      const snap = await db.ref("usernames").orderByKey().startAt(q).endAt(q + "\uf8ff").get();
      for (const uid of Object.values(snap.val() || {})) {
        if (found.has(uid)) continue;
        const u = (await db.ref("users/" + uid).get()).val();
        if (u && u.status !== "banned") found.set(uid, { ...u, uid });
      }
    } catch (err) { /* index may be missing; fallback below */ }
    if (found.size < 20) {
      try {
        const all = (await db.ref("users").get()).val() || {};
        for (const [uid, u] of Object.entries(all)) {
          if (found.size >= 20) break;
          if (found.has(uid)) continue;
          const hay = ((u.usernameLower || u.username || "") + " " + (u.displayName || "")).toLowerCase();
          if (hay.includes(q) && u.status !== "banned") found.set(uid, { ...u, uid });
        }
      } catch (err) { /* not permitted */ }
    }
    found.forEach(u => { if (u.uid !== state.uid) box.appendChild(userRow(u, "View")); });
    if (!box.innerHTML) box.innerHTML = "<p class='muted small'>No users found</p>";
  }, 400);
});

function userRow(u, btnLabel) {
  const el = document.createElement("div");
  el.className = "list-item";
  el.innerHTML = `
    <img class="avatar" src="${escapeHtml(avatarFor(u))}">
    <div class="grow"><div class="bold text">${escapeHtml(u.displayName || "")}</div>
    <div class="muted small text">@${escapeHtml(u.username)}</div></div>
    <button class="btn small">${btnLabel || "View"}</button>`;
  el.querySelector(".btn").onclick = ev => { ev.stopPropagation(); openUserProfile(u, u.uid); };
  el.onclick = () => openUserProfile(u, u.uid);
  return el;
}

// ---------- 7. Other user's profile ----------
async function openUserProfile(u, uid) {
  if (!uid) uid = u.uid;
  const p = (await db.ref("users/" + uid).get()).val();
  if (!p) return toast("User not found");
  viewingUser = { uid, ...p };
  $("user-avatar").src = avatarFor(p);
  $("user-name").textContent = p.displayName || "";
  $("user-username").textContent = "@" + p.username + (p.isPrivate ? " 🔒" : "");
  $("user-bio").textContent = p.bio || "";
  renderStats(uid, p.createdAt, "user-stats");
  $("user-list-area").innerHTML = "";
  await renderUserActions(uid, p);
  showPage("user");
}
let viewingUser = null;
bind("btn-back-user", "click", () => showPage("search"));

async function renderUserActions(uid, p) {
  const box = $("user-actions");
  box.innerHTML = "";
  const mine = state.uid;
  const [followingSnap, blockedSnap, theyBlockedSnap] = await Promise.all([
    db.ref("following/" + mine + "/" + uid).get(),
    db.ref("blocks/" + mine + "/" + uid).get(),
    db.ref("blocks/" + uid + "/" + mine).get()
  ]);
  const following = followingSnap.exists();
  const iBlocked = blockedSnap.exists();
  const theyBlocked = theyBlockedSnap.exists();
  const add = (label, primary, danger, fn) => {
    const b = document.createElement("button");
    b.className = "btn small" + (primary ? " primary" : "") + (danger ? " danger" : "");
    b.textContent = label;
    b.onclick = fn;
    box.appendChild(b);
  };

  if (p.isPrivate && !following) {
    const req = await db.ref("followRequests/" + uid + "/" + mine).get();
    if (req.exists()) add("Cancel request", false, false, () => cancelFollowRequest(uid));
    else add("Request to follow", true, false, () => sendFollowRequest(uid));
  } else {
    add(following ? "Unfollow" : "Follow", !following, false,
      following ? () => unfollow(uid) : () => follow(uid));
  }
  if (!theyBlocked && (await canMessage(uid))) add("Message", false, false, () => openChat(uid));
  add(iBlocked ? "Unblock" : "Block", false, false, () => iBlocked ? unblockUser(uid) : blockUser(uid));
  add("Report", false, false, () => reportUser(uid));

  if (!p.isPrivate || following) {
    $("user-list-area").innerHTML = "";
    [["Followers", "followers/" + uid], ["Following", "following/" + uid]].forEach(([title, node]) => {
      $("user-list-area").appendChild(mkBtn(title, false, false, () => showUserList(uid, node, title)));
    });
  }
}
function mkBtn(label, primary, danger, fn) {
  const b = document.createElement("button");
  b.className = "btn small" + (primary ? " primary" : "") + (danger ? " danger" : "");
  b.textContent = label;
  b.onclick = fn;
  return b;
}


// ---------- 8. Follow / requests / lists ----------
async function follow(uid) {
  if (isRestricted(state.profile)) return toast(restrictMsg(state.profile));
  await Promise.all([
    db.ref("following/" + state.uid + "/" + uid).set(true),
    db.ref("followers/" + uid + "/" + state.uid).set(true),
    pushNotification(uid, "follow", state.profile.username + " started following you")
  ]);
  toast("Followed");
  openUserProfile(null, uid);
}
async function unfollow(uid) {
  await Promise.all([
    db.ref("following/" + state.uid + "/" + uid).remove(),
    db.ref("followers/" + uid + "/" + state.uid).remove()
  ]);
  toast("Unfollowed");
  openUserProfile(null, uid);
}
async function sendFollowRequest(uid) {
  if (isRestricted(state.profile)) return toast(restrictMsg(state.profile));
  await db.ref("followRequests/" + uid + "/" + state.uid).set(true);
  await pushNotification(uid, "follow_request", state.profile.username + " requested to follow you");
  toast("Request sent");
  openUserProfile(null, uid);
}
async function cancelFollowRequest(uid) {
  await db.ref("followRequests/" + uid + "/" + state.uid).remove();
  toast("Request cancelled");
  openUserProfile(null, uid);
}

function loadRequests() {
  track(db.ref("followRequests/" + state.uid), "value", snap => {
    const n = snap.numChildren();
    const badge = $("req-badge");
    badge.classList.toggle("hidden", n === 0);
    badge.textContent = n;
  });
}

let listCtx = null;
async function showUserList(uid, node, title) {
  listCtx = node;
  $("list-title").textContent = title;
  $("generic-list").innerHTML = "";
  showPage("list");
  const snap = await db.ref(node).get();
  for (const childUid of Object.keys(snap.val() || {})) {
    const u = (await db.ref("users/" + childUid).get()).val();
    if (u) $("generic-list").appendChild(userRow({ ...u, uid: childUid }, "View"));
  }
}
async function renderRequestList() {
  listCtx = "requests";
  $("list-title").textContent = "Follow requests";
  $("generic-list").innerHTML = "";
  showPage("list");
  const snap = await db.ref("followRequests/" + state.uid).get();
  for (const senderUid of Object.keys(snap.val() || {})) {
    const u = (await db.ref("users/" + senderUid).get()).val();
    if (!u) continue;
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `<img class="avatar" src="${escapeHtml(avatarFor(u))}">
      <div class="grow"><div class="bold text">${escapeHtml(u.displayName)}</div>
      <div class="muted small">@${escapeHtml(u.username)}</div></div>`;
    row.append(mkBtn("Accept", true, false, () => acceptRequest(senderUid)),
               mkBtn("Reject", false, true, () => rejectRequest(senderUid)));
    $("generic-list").appendChild(row);
  }
}
async function acceptRequest(uid) {
  await Promise.all([
    db.ref("followRequests/" + state.uid + "/" + uid).remove(),
    db.ref("following/" + uid + "/" + state.uid).set(true),
    db.ref("followers/" + state.uid + "/" + uid).set(true),
    pushNotification(uid, "follow_accept", state.profile.username + " accepted your follow request")
  ]);
  toast("Request accepted");
  renderRequestList();
}
async function rejectRequest(uid) {
  await db.ref("followRequests/" + state.uid + "/" + uid).remove();
  toast("Request rejected");
  renderRequestList();
}

// ---------- 9. Block & report ----------
async function blockUser(uid) {
  if (!(await confirmBox("Block this user? You will not be able to message each other."))) return;
  await Promise.all([
    db.ref("blocks/" + state.uid + "/" + uid).set(true),
    db.ref("blocks/" + uid + "/" + state.uid).set(true)
  ]);
  toast("User blocked");
  renderBlockedList();
}
async function unblockUser(uid) {
  await Promise.all([
    db.ref("blocks/" + state.uid + "/" + uid).remove(),
    db.ref("blocks/" + uid + "/" + state.uid).remove()
  ]);
  toast("User unblocked");
  renderBlockedList();
}
async function reportUser(uid) {
  const reason = prompt("Why are you reporting this user?");
  if (!reason) return;
  await db.ref("reports/" + db.ref("reports").push().key).set({
    reporterUid: state.uid, reportedUid: uid, messageId: "",
    reason, status: "pending", timestamp: firebase.database.ServerValue.TIMESTAMP
  });
  toast("Report submitted. Thank you.");
}
async function renderBlockedList() {
  const snap = await db.ref("blocks/" + state.uid).get();
  const box = $("blocked-list");
  box.innerHTML = "";
  for (const uid of Object.keys(snap.val() || {})) {
    const u = (await db.ref("users/" + uid).get()).val();
    if (!u) continue;
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `<img class="avatar" src="${escapeHtml(avatarFor(u))}">
      <div class="grow bold text">@${escapeHtml(u.username)}</div>`;
    row.appendChild(mkBtn("Unblock", false, false, () => unblockUser(uid)));
    box.appendChild(row);
  }
}

// ---------- 10. Settings ----------
function fillSettingsPage(p) {
  const s = p.settings || {};
  $("set-who-msg").checked = s.whoCanMessage === "anyoneIFollow";
  $("set-show-online").checked = s.showOnline !== false;
  $("set-show-lastseen").checked = s.showLastSeen !== false;
  renderBlockedList();
}
bind("btn-save-settings", "click", async () => {
  await db.ref("users/" + state.uid + "/settings").update({
    whoCanMessage: $("set-who-msg").checked ? "anyoneIFollow" : "followers",
    showOnline: $("set-show-online").checked,
    showLastSeen: $("set-show-lastseen").checked
  });
  toast("Settings saved");
});


// ---------- 11. Chat list & permissions ----------
let chatListeners = [];
function clearChatListeners() { chatListeners.forEach(l => l.off()); chatListeners = []; }

async function canMessage(uid) {
  if (!state.profile) return false;
  const [iBlock, theyBlock, theirProfile] = await Promise.all([
    db.ref("blocks/" + state.uid + "/" + uid).get(),
    db.ref("blocks/" + uid + "/" + state.uid).get(),
    db.ref("users/" + uid).get()
  ]);
  if (iBlock.exists() || theyBlock.exists()) return false;
  const t = theirProfile.val();
  if (!t) return false;
  const s = t.settings || {};
  if (s.whoCanMessage === "anyoneIFollow") {
    return (await db.ref("following/" + state.uid + "/" + uid).get()).exists();
  }
  return (await db.ref("followers/" + uid + "/" + state.uid).get()).exists();
}

function loadChatList() {
  track(db.ref("userChats/" + state.uid), "value", async snap => {
    const box = $("chat-list");
    box.innerHTML = "";
    const filter = ($("chat-search").value || "").toLowerCase();
    const cids = Object.keys(snap.val() || {});
    const items = [];
    for (const cid of cids) {
      const peerUid = cid.split("_").find(u => u !== state.uid);
      const meta = (await db.ref("chats/" + cid + "/meta").get()).val() || {};
      if (filter && !(meta.lastMessage || "").toLowerCase().includes(filter)) continue;
      const peer = (await db.ref("users/" + peerUid).get()).val();
      if (!peer) continue;
      items.push({ cid, peerUid, peer, meta });
    }
    items.sort((a, b) => (b.meta.lastTimestamp || 0) - (a.meta.lastTimestamp || 0));
    items.forEach(({ peerUid, peer, meta }) => {
      const row = document.createElement("div");
      row.className = "list-item";
      row.innerHTML = `
        <img class="avatar" src="${escapeHtml(avatarFor(peer))}">
        <div class="grow"><div class="bold text">${escapeHtml(peer.displayName)}</div>
        <div class="muted small text">${escapeHtml(meta.lastMessage || "No messages yet")}</div></div>
        <div class="muted small">${timeStr(meta.lastTimestamp)}</div>`;
      row.onclick = () => openChat(peerUid);
      box.appendChild(row);
    });
  });
}
bind("chat-search", "input", () => loadChatList());

// ---------- 12. Individual chat ----------
let currentChat = null;
async function openChat(peerUid) {
  if (isRestricted(state.profile)) return toast(restrictMsg(state.profile));
  const peer = (await db.ref("users/" + peerUid).get()).val();
  if (!peer) return toast("User not found");
  if (peer.status === "banned" || peer.status === "disabled") return toast("This account is unavailable.");
  const cid = chatIdOf(state.uid, peerUid);
  currentChat = { cid, peerUid, peer };
  $("chat-peer-name").textContent = peer.displayName;
  $("chat-avatar").src = avatarFor(peer);
  $("msg-search").value = "";
  $("msg-search").classList.add("hidden");
  try { renderPinned(); } catch (_) {}
  showPage("chat");
  bindPeerPresence(peerUid);
  bindTypingIndicator(cid, peerUid);
  listenMessages(cid);
  db.ref("chats/" + cid + "/participants/" + state.uid).set(true);
  db.ref("chats/" + cid + "/participants/" + peerUid).set(true);
  db.ref("userChats/" + state.uid + "/" + cid).set(true);
  db.ref("userChats/" + peerUid + "/" + cid).set(true);
}
bind("btn-back-chats", "click", () => { clearChatListeners(); currentChat = null; showPage("chats"); });

function bindPeerPresence(peerUid) {
  const el = $("chat-peer-status");
  db.ref("presence/" + peerUid).on("value", snap => {
    if (currentChat?.peerUid !== peerUid) return;
    const p = snap.val() || {};
    if (p.online) { el.textContent = "online"; el.classList.remove("muted"); return; }
    el.classList.add("muted");
    db.ref("users/" + peerUid + "/settings/showLastSeen").get().then(s => {
      el.textContent = (s.val() !== false && p.lastSeen) ? "last seen " + timeStr(p.lastSeen) : "offline";
    });
  });
  chatListeners.push({ off: () => db.ref("presence/" + peerUid).off() });
}
function bindTypingIndicator(cid, peerUid) {
  const el = $("typing-indicator");
  db.ref("chats/" + cid + "/meta/typing/" + peerUid).on("value", snap => {
    el.classList.toggle("hidden", !snap.val() || currentChat?.cid !== cid);
  });
  chatListeners.push({ off: () => db.ref("chats/" + cid + "/meta/typing/" + peerUid).off() });
}
function listenMessages(cid) {
  chatListeners.push({ off: () => db.ref("messages/" + cid).off() });
  db.ref("messages/" + cid).orderByChild("timestamp").limitToLast(200).on("value", snap => {
    if (currentChat?.cid !== cid) return;
    renderMessages(snap);
    markMessagesSeen(cid, snap);
  });
}


function renderMessages(snap) {
  const box = $("messages");
  box.innerHTML = "";
  const filter = ($("msg-search").value || "").toLowerCase();
  snap.forEach(c => {
    const m = { id: c.key, ...c.val() };
    if (filter && !(m.text || "").toLowerCase().includes(filter)) return;
    const mine = m.sender === state.uid;
    const row = document.createElement("div");
    row.className = "msg-row" + (mine ? " mine" : "");
    const reactionsHtml = m.reactions ? `<span class="reactions">${Object.keys(m.reactions).join("")}</span>` : "";
    let body = m.deleted ? "🚫 This message was deleted"
      : (m.imageUrl ? `<img class="msg-img" src="${escapeHtml(m.imageUrl)}">` : "") + escapeHtml(m.text || "");
    if (m.edited && !m.deleted) body += ' <i class="small muted">(edited)</i>';
    const replyHtml = m.replyTo ? `<div class="reply-quote">↩ ${escapeHtml(m.replyTo.text || "Image")}</div>` : "";
    const status = mine ? (m.seenBy?.[currentChat.peerUid] ? '<span class="seen">✓✓ Seen</span>'
      : (m.delivered ? "✓✓" : "✓ Sent")) : "";
    row.innerHTML = `<div class="bubble ${m.deleted ? "deleted" : ""}">
      ${replyHtml}${body}
      <div class="meta">${timeStr(m.timestamp)} ${status}</div>${reactionsHtml}
      <div class="msg-actions">
        <button title="Reply">↩</button><button title="React">🙂</button>
        <button title="Pin">📌</button>
        ${mine ? '<button title="Edit">✏️</button><button title="Delete">🗑</button>' : ""}
        ${mine ? "" : '<button title="Report msg">🚩</button>'}
      </div></div>`;
    const [bReply, bReact, bPin, bEdit, bDel, bReport] = row.querySelectorAll(".msg-actions button");
    bReply.onclick = () => showReplyPreview(m);
    bReact.onclick = () => reactToMessage(m);
    bPin.onclick = () => togglePin(m);
    if (bEdit) bEdit.onclick = () => editMessage(m);
    if (bDel) bDel.onclick = () => deleteMessage(m);
    if (bReport) bReport.onclick = () => reportMessage(m);
    box.appendChild(row);
  });
  box.scrollTop = box.scrollHeight;
}

function markMessagesSeen(cid, snap) {
  const upd = {};
  snap.forEach(c => {
    const m = c.val();
    if (m.sender !== state.uid && !m.seenBy?.[state.uid]) {
      upd[c.key + "/seenBy/" + state.uid] = true;
      upd[c.key + "/delivered"] = true;
    }
  });
  if (Object.keys(upd).length) db.ref("messages/" + cid).update(upd);
}

// ---------- 13. Sending messages ----------
let replyTarget = null;
bind("btn-send", "click", sendText);
bind("chat-input", "keydown", e => { if (e.key === "Enter") sendText(); });

async function sendText() {
  if (!currentChat) return;
  if (isRestricted(state.profile)) return toast(restrictMsg(state.profile));
  const text = $("chat-input").value.trim();
  if (!text) return;
  if (!(await canMessage(currentChat.peerUid))) return toast("You cannot message this user (privacy/block rules)");
  $("chat-input").value = "";
  const msg = { sender: state.uid, text,
    timestamp: firebase.database.ServerValue.TIMESTAMP,
    delivered: false, seenBy: {}, reactions: {} };
  if (replyTarget) { msg.replyTo = replyTarget; cancelReply(); }
  await pushMessage(msg);
}

async function pushMessage(msg) {
  const cid = currentChat.cid;
  await db.ref("messages/" + cid + "/" + db.ref("messages/" + cid).push().key).set(msg);
  await db.ref("chats/" + cid + "/meta").update({
    lastMessage: msg.text || "📷 Photo",
    lastTimestamp: firebase.database.ServerValue.TIMESTAMP,
    lastSender: state.uid
  });
  await db.ref("chats/" + cid + "/meta/typing/" + state.uid).remove();
  await pushNotification(currentChat.peerUid, "message",
    state.profile.username + ": " + (msg.text || "📷 Photo"), cid);
}

// ---------- Message helpers (reply / react / pin / edit / delete / report) ----------

// Push a notification to another user's notification list
async function pushNotification(targetUid, type, text, chatId) {
  const nid = await db.ref("notifications/" + targetUid).push().key;
  await db.ref("notifications/" + targetUid + "/" + nid).set({
    type: type || "message",
    text: text || "",
    chatId: chatId || null,
    read: false,
    ts: firebase.database.ServerValue.TIMESTAMP
  });
}

// Notification list listener + badge
function listenNotifications(uid) {
  track(db.ref("notifications/" + uid), "value", snap => {
    const n = snap.numChildren();
    const badge = $("#notif-badge");
    badge.classList.toggle("hidden", n === 0);
    badge.textContent = n;
  });
}

// Render pinned messages banner
function renderPinned() {
  const banner = $("#pinned-banner");
  if (!currentChat) { banner.classList.add("hidden"); return; }
  db.ref("chats/" + currentChat.cid + "/meta/pinned").once("value").then(snap => {
    const ids = [];
    snap.forEach(c => ids.push(c.key));
    if (!ids.length) { banner.classList.add("hidden"); return; }
    db.ref("messages/" + currentChat.cid).once("value").then(ms => {
      const list = [];
      ms.forEach(c => { const m = c.val(); if (ids.includes(c.key)) list.push(m); });
      banner.innerHTML = list.map(m =>
        `<div class="pinned-item"><b>${escapeHtml(m.sender === state.uid ? "You" : (currentChat?.peerDisplayName || "User"))}:</b> ${escapeHtml(m.text || "📷 Photo")} <span class="muted small">${timeStr(m.timestamp)}</span></div>`
      ).join("");
      banner.classList.remove("hidden");
    });
  });
}

// Show reply preview
function showReplyPreview(m) {
  const el = $("#reply-preview");
  el.textContent = "↩ Replying to: " + (m.text || "Image");
  el.classList.toggle("hidden", false);
  setTimeout(() => el.classList.toggle("hidden", true), 4000);
}

// Message reactions
const EMOJIS = ["👍","❤️","😂","😮","😢","🚀"];
function reactToMessage(m) {
  if (!currentChat) return;
  const existing = m.reactions || {};
  // toggle first emoji for simplicity
  const key = Object.keys(EMOJIS)[0];
  const next = { ...existing };
  next[key] = ((next[key] || 0) + 1) % 2 ? (next[key] || 0) + 1 : undefined;
  if (next[key] === undefined) delete next[key];
  db.ref("messages/" + currentChat.cid + "/" + m.id + "/reactions").set(next);
  toast("Reacted 👍");
}

// Pin / unpin
function togglePin(m) {
  if (!currentChat) return;
  db.ref("chats/" + currentChat.cid + "/meta/pinned/" + m.id).once("value").then(s => {
    if (s.exists()) db.ref("chats/" + currentChat.cid + "/meta/pinned/" + m.id).remove();
    else db.ref("chats/" + currentChat.cid + "/meta/pinned/" + m.id).set(true);
    renderPinned();
    toast(s.exists() ? "Unpinned" : "Pinned");
  });
}

// Edit message
async function editMessage(m) {
  if (!currentChat || m.sender !== state.uid) return;
  const newText = prompt("Edit message:", m.text || "");
  if (newText === null || !newText.trim()) return;
  await db.ref("messages/" + currentChat.cid + "/" + m.id).update({
    text: newText.trim(),
    edited: firebase.database.ServerValue.TIMESTAMP
  });
  toast("Edited");
}

// Soft-delete message
async function deleteMessage(m) {
  if (!currentChat || m.sender !== state.uid) return;
  if (!confirmBox("Delete this message? (can't be undone by you)")) return;
  await db.ref("messages/" + currentChat.cid + "/" + m.id).update({ deleted: true });
  toast("Deleted");
}

// Report a message (creates a report entry for the message sender)
async function reportMessage(m) {
  if (!currentChat) return;
  await db.ref("reports").push().set({
    reportedUid: m.sender,
    type: "message",
    reason: "Inappropriate message",
    reporterUid: state.uid,
    chatId: currentChat.cid,
    messageId: m.id,
    messageText: m.text || "(image)",
    status: "pending",
    ts: firebase.database.ServerValue.TIMESTAMP
  });
  toast("Message reported");
}

// ---------- Image messages (stored in Firebase Storage, only URL in DB) ----------
bind("chat-image", "change", async e => {
  if (!currentChat) return;
  if (isRestricted(state.profile)) return toast(restrictMsg(state.profile));
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return toast("Max image size is 5MB");
  if (!(await canMessage(currentChat.peerUid))) return toast("You cannot message this user");
  const cid = currentChat.cid;
  const snap = await storage.ref("chatImages/" + cid + "/" + Date.now()).put(file);
  const url = await snap.ref.getDownloadURL();
  await pushMessage({ sender: state.uid, imageUrl: url, text: "",
    timestamp: firebase.database.ServerValue.TIMESTAMP, seenBy: {}, reactions: {} });
});

// Typing indicator (auto-clears after 2s of inactivity)
let typingTimer = null;
bind("chat-input", "input", () => {
  if (!currentChat) return;
  db.ref("chats/" + currentChat.cid + "/meta/typing/" + state.uid).set(true);
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    if (currentChat) db.ref("chats/" + currentChat.cid + "/meta/typing/" + state.uid).remove();
  }, 2000);
});

