import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
    collection, doc, onSnapshot, setDoc, deleteDoc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Ready-made IDs (e.g. "ravi") become ravi@kartikeswar.app logins
const ID_DOMAIN = "kartikeswar.app";

// Past years from the public site's data.js
const PAST = typeof pujaData !== "undefined" ? pujaData : {};

const configured = Boolean(firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PASTE"));
let auth, db;
if (configured) {
    const firebaseApp = initializeApp(firebaseConfig);
    auth = getAuth(firebaseApp);
    db = initializeFirestore(firebaseApp, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
}

// ---------- Helpers ----------

const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rs = amount => "₹" + Math.round(amount || 0).toLocaleString("en-IN");
const sum = (list, key = "amount") => list.reduce((total, item) => total + (Number(item[key]) || 0), 0);
const digits = value => String(value || "").replace(/\D/g, "");
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

// Loose name key so "Prabir Kumar Jena" and "Prabir ku Jena" match
function nameKey(name) {
    return String(name || "").toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\bkumar\b/g, "ku")
        .replace(/\branjan\b/g, "rnj")
        .trim();
}

function today() {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 10);
}

function fmtDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function waNumber(phone) {
    let number = digits(phone);
    if (number.length === 11 && number.startsWith("0")) number = number.slice(1);
    if (number.length === 10) number = "91" + number;
    return number;
}

const waLink = (phone, text) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
const telLink = phone => `tel:+${waNumber(phone)}`;

// Fill {placeholders}; lines whose placeholder is empty are dropped
function fillTemplate(template, vars) {
    return String(template || "").split("\n").filter(line => {
        const keys = [...line.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
        return keys.every(key => vars[key] !== undefined && vars[key] !== "");
    }).map(line => line.replace(/\{(\w+)\}/g, (_, key) => vars[key])).join("\n");
}

function formValues(form) {
    return Object.fromEntries(new FormData(form).entries());
}

function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 3000);
}

function download(filename, text, type = "text/csv") {
    const blob = new Blob([type === "text/csv" ? "﻿" + text : text], { type: type + ";charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function toCsv(rows) {
    return rows.map(row => row.map(cell => {
        const text = String(cell ?? "");
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join(",")).join("\n");
}

// Closing balance of a past year, as shown on the public website
function pastClosing(year) {
    const data = PAST[year];
    if (!data) return 0;
    return pastClosing(String(Number(year) - 1)) + sum(data.donations) - sum(data.expenditure, "total");
}

const PAST_CATEGORIES = (() => {
    const latest = Object.keys(PAST).sort().pop();
    return latest ? PAST[latest].expenditure.map(c => c.category) : [];
})();

const ICONS = {
    home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    followup: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    entries: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    more: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    whatsapp: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z"/>'
};
const icon = name => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

// ---------- State ----------

const thisYear = String(new Date().getFullYear());
const DEFAULT_SETTINGS = {
    year: thisYear,
    waReminder: "Namaskar {name} 🙏\n\nKartikeswar Puja {year}, Karanga is coming soon.\nLast year you kindly contributed ₹{last}.\nWe humbly request your support this year as well.\n\nJay Maa Siddha Mangala\n- {member}, Kartikeswar Puja Committee",
    waThanks: "Namaskar {name} 🙏\n\nWe have received your contribution of ₹{amount} for Kartikeswar Puja {year}. Thank you for your support!\n\nJay Maa Siddha Mangala\n- {member}, Kartikeswar Puja Committee"
};

const state = {
    authReady: false,
    user: null,
    memberStatus: "checking", // checking | ok | denied
    me: null,
    settings: { ...DEFAULT_SETTINGS, openingBalance: pastClosing(String(Number(thisYear) - 1)) },
    members: [],
    donors: [],
    collections: [],
    expenses: [],
    moves: [],
    search: {},
    fuFilter: "todo",
    entriesTab: "collections"
};

let dataUnsubs = [];
let yearUnsubs = [];
let renderQueued = false;

function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
        renderQueued = false;
        render();
    });
}

const year = () => state.settings.year;
const prevYear = () => String(Number(year()) - 1);
const yearPath = kind => `years/${year()}/${kind}`;
const donorById = id => state.donors.find(d => d.id === id);
const memberName = email => (state.members.find(m => m.id === email) || {}).name || email || "";

function stamp(isNew) {
    return isNew
        ? { createdBy: state.me.id, createdAt: serverTimestamp() }
        : { updatedBy: state.me.id, updatedAt: serverTimestamp() };
}

function commit(promise) {
    // Writes are saved on the phone at once and synced when online, so don't wait for them
    promise.catch(err => toast("Could not save: " + err.message));
}

// ---------- Data subscriptions ----------

function toList(snap) {
    return snap.docs
        .map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }), _pending: d.metadata.hasPendingWrites }))
        .filter(item => !item.deleted);
}

function onDataError(err) {
    if (err.code === "permission-denied") {
        state.memberStatus = "denied";
        stopData();
    } else {
        toast(err.message);
    }
    scheduleRender();
}

function stopData() {
    dataUnsubs.forEach(unsub => unsub());
    yearUnsubs.forEach(unsub => unsub());
    dataUnsubs = [];
    yearUnsubs = [];
}

function watchMembership(user) {
    const email = user.email.toLowerCase();
    state.memberStatus = "checking";
    dataUnsubs.push(onSnapshot(doc(db, "members", email), snap => {
        if (!snap.exists()) {
            // Offline on first ever open: wait for the server instead of saying "not allowed"
            if (snap.metadata.fromCache) return;
            state.memberStatus = "denied";
        } else {
            state.me = { id: email, ...snap.data() };
            if (state.memberStatus !== "ok") {
                state.memberStatus = "ok";
                startData();
            }
        }
        scheduleRender();
    }, onDataError));
}

function startData() {
    dataUnsubs.push(onSnapshot(collection(db, "members"), snap => {
        state.members = toList(snap).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        scheduleRender();
    }, onDataError));

    dataUnsubs.push(onSnapshot(collection(db, "donors"), snap => {
        state.donors = toList(snap);
        scheduleRender();
    }, onDataError));

    dataUnsubs.push(onSnapshot(doc(db, "settings", "app"), snap => {
        const saved = snap.exists() ? snap.data() : {};
        const oldYear = year();
        state.settings = { ...DEFAULT_SETTINGS, ...saved };
        if (saved.openingBalance === undefined) state.settings.openingBalance = pastClosing(prevYear());
        if (oldYear !== year() || yearUnsubs.length === 0) startYear();
        scheduleRender();
    }, onDataError));
}

function startYear() {
    yearUnsubs.forEach(unsub => unsub());
    yearUnsubs = ["collections", "expenses", "moves"].map(kind =>
        onSnapshot(collection(db, yearPath(kind)), { includeMetadataChanges: true }, snap => {
            state[kind] = toList(snap).sort((a, b) =>
                (b.date || "").localeCompare(a.date || "") ||
                ((b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)));
            scheduleRender();
        }, onDataError));
}

// ---------- Derived numbers ----------

function lastGift(donor) {
    const history = donor.history || {};
    const years = Object.keys(history).filter(y => y < year() && history[y] > 0).sort();
    const last = years.pop();
    return last ? { year: last, amount: history[last] } : null;
}

function paidMap() {
    const paid = new Map();
    state.collections.forEach(c => paid.set(c.donorId, (paid.get(c.donorId) || 0) + Number(c.amount)));
    return paid;
}

const followup = donor => (donor.fu && donor.fu[year()]) || {};

function totals() {
    const collected = sum(state.collections);
    const spent = sum(state.expenses);
    const opening = Number(state.settings.openingBalance) || 0;
    const fromOpening = sum(state.moves.filter(m => m.from === "opening"));

    const held = new Map();
    const add = (email, amount) => email && email !== "opening" && held.set(email, (held.get(email) || 0) + amount);
    state.collections.forEach(c => add(c.collectedBy, Number(c.amount)));
    state.expenses.forEach(e => add(e.paidBy, -Number(e.amount)));
    state.moves.forEach(m => {
        add(m.to, Number(m.amount));
        add(m.from, -Number(m.amount));
    });

    return {
        collected,
        spent,
        opening,
        balance: opening + collected - spent,
        unassignedOpening: opening - fromOpening,
        held
    };
}

// ---------- Rendering ----------

const VIEWS = {
    home: viewHome,
    followup: viewFollowup,
    entries: viewEntries,
    more: viewMore,
    donors: viewDonors,
    members: viewMembers,
    settings: viewSettings,
    export: viewExport
};
const LISTS = { followup: followupList, entries: entriesList, donors: donorsList };
const NAV_PARENT = { donors: "more", members: "more", settings: "more", export: "more" };

function currentView() {
    const view = location.hash.slice(1);
    return VIEWS[view] ? view : "home";
}

function render() {
    const root = $("#app");
    if (!configured) {
        root.innerHTML = screenMessage("Almost ready",
            "Firebase is not connected yet. Paste your Firebase config into <b>app/firebase-config.js</b> (see SETUP.md).");
        return;
    }
    if (!state.authReady) {
        root.innerHTML = screenMessage("", "Loading…");
        return;
    }
    if (!state.user) {
        root.innerHTML = viewLogin();
        return;
    }
    if (state.memberStatus === "checking") {
        root.innerHTML = screenMessage("", "Checking your access…");
        return;
    }
    if (state.memberStatus === "denied") {
        root.innerHTML = screenMessage("Not added yet",
            `You are signed in as <b>${esc(state.user.email)}</b>, but this account is not on the committee list.<br><br>
            Ask any committee member to add it in <b>More → Members</b>, then open the app again.`,
            `<button class="btn" data-act="signout">Sign out</button>`);
        return;
    }

    const view = currentView();
    const active = document.activeElement;
    const focusId = active && active.id && root.contains(active) ? active.id : null;
    const caret = focusId && "selectionStart" in active ? active.selectionStart : null;

    const nav = NAV_PARENT[view] || view;
    const navItem = (name, label) =>
        `<a href="#${name}" class="${nav === name ? "active" : ""}">${icon(name)}<span>${label}</span></a>`;

    root.innerHTML = `
        <header class="topbar">
            <span class="brand">Kartikeswar <span class="year-pill">${esc(year())}</span></span>
            ${navigator.onLine ? "" : `<span class="offline">Offline · saving on phone</span>`}
        </header>
        <main class="view">${VIEWS[view]()}</main>
        <nav class="bottom-nav">
            ${navItem("home", "Home")}
            ${navItem("followup", "Follow-up")}
            <button class="fab" data-act="add" aria-label="Add entry">${icon("plus")}</button>
            ${navItem("entries", "Entries")}
            ${navItem("more", "More")}
        </nav>`;

    if (focusId) {
        const el = document.getElementById(focusId);
        if (el) {
            el.focus();
            if (caret !== null && el.setSelectionRange) el.setSelectionRange(caret, caret);
        }
    }
}

function renderList() {
    const view = currentView();
    const listEl = $("#list");
    if (LISTS[view] && listEl) listEl.innerHTML = LISTS[view]();
}

function screenMessage(title, body, actions = "") {
    return `
        <div class="center-screen">
            <div class="diya" aria-hidden="true"></div>
            ${title ? `<h1>${title}</h1>` : ""}
            <p class="muted">${body}</p>
            ${actions}
        </div>`;
}

function searchBox(view, placeholder) {
    return `<input type="search" class="search" id="search-${view}" data-search="${view}"
        value="${esc(state.search[view] || "")}" placeholder="${placeholder}" autocomplete="off">`;
}

const searchTerm = view => nameKey(state.search[view] || "");

function viewLogin() {
    return `
        <div class="center-screen login">
            <div class="diya" aria-hidden="true"></div>
            <p class="eyebrow">Jay Maa Siddha Mangala</p>
            <h1>Kartikeswar Puja Committee</h1>
            <p class="muted">Members only</p>
            <button class="btn primary block" data-act="google-login">Sign in with Google</button>
            <details class="id-login">
                <summary>Use ID &amp; password instead</summary>
                <form data-form="login">
                    <label>User ID<input name="id" autocomplete="username" autocapitalize="none" required></label>
                    <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
                    <button class="btn block">Sign in</button>
                </form>
            </details>
        </div>`;
}

// --- Home ---

function viewHome() {
    const t = totals();
    const paid = paidMap();
    const lastYearTotal = PAST[prevYear()] ? sum(PAST[prevYear()].donations) : 0;
    const progress = lastYearTotal ? Math.min(100, (t.collected / lastYearTotal) * 100) : 0;

    const unpaid = state.donors.filter(d => !paid.has(d.id) && followup(d).status !== "declined");
    const promised = unpaid.filter(d => followup(d).status === "promised");
    const mine = unpaid.filter(d => followup(d).assignedTo === state.me.id);

    const holders = [...t.held.entries()].filter(([, amount]) => amount !== 0).sort((a, b) => b[1] - a[1]);
    const recent = [
        ...state.collections.map(c => ({ ...c, kind: "collection" })),
        ...state.expenses.map(e => ({ ...e, kind: "expense" }))
    ].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)).slice(0, 6);

    return `
        <section class="hello">
            <p>Namaskar, <b>${esc(state.me.name || "")}</b></p>
            <h1>Puja ${esc(year())}</h1>
        </section>

        <div class="cards">
            <div class="card">
                <span class="label">Collected</span>
                <span class="big">${rs(t.collected)}</span>
                <span class="note">${plural(paid.size, "donor", "donors")} paid</span>
            </div>
            <div class="card">
                <span class="label">Spent</span>
                <span class="big">${rs(t.spent)}</span>
                <span class="note">${plural(state.expenses.length, "entry", "entries")}</span>
            </div>
            <div class="card wide accent">
                <span class="label">Balance</span>
                <span class="big ${t.balance < 0 ? "neg" : ""}">${t.balance < 0 ? "−" : ""}${rs(Math.abs(t.balance))}</span>
                <span class="note">${t.opening ? `Incl. ${rs(t.opening)} from ${esc(prevYear())}` : "Collected minus spent"}</span>
            </div>
        </div>

        ${lastYearTotal ? `
        <div class="panel">
            <div class="row-between"><span>vs ${esc(prevYear())} collection</span><b>${rs(t.collected)} / ${rs(lastYearTotal)}</b></div>
            <div class="bar"><span style="width:${progress}%"></span></div>
        </div>` : ""}

        <a class="panel link-panel" href="#followup">
            <h2>Follow-up</h2>
            <div class="row-between"><span>Yet to pay</span><b>${unpaid.length}</b></div>
            <div class="row-between"><span>Promised, not received</span><b>${rs(sum(promised.map(d => ({ amount: followup(d).promised }))))} · ${promised.length}</b></div>
            <div class="row-between"><span>Assigned to you</span><b>${mine.length}</b></div>
        </a>

        <div class="panel">
            <h2>Cash in hand</h2>
            ${holders.map(([email, amount]) => `
                <div class="row-between"><span>${esc(memberName(email))}</span><b class="${amount < 0 ? "neg" : ""}">${amount < 0 ? "−" : ""}${rs(Math.abs(amount))}</b></div>`).join("")}
            ${t.unassignedOpening ? `
                <div class="row-between"><span>${esc(prevYear())} balance, not yet handed over</span><b>${rs(t.unassignedOpening)}</b></div>` : ""}
            ${!holders.length && !t.unassignedOpening ? `<p class="muted">No cash recorded yet.</p>` : ""}
            <p class="hint">Use <b>+ → Cash handover</b> when someone gives cash to another member.</p>
        </div>

        <div class="panel">
            <h2>Recent</h2>
            ${recent.length ? recent.map(item => item.kind === "collection"
                ? entryRow(item.donorName, `${fmtDate(item.date)} · by ${esc(memberName(item.collectedBy))}`, item.amount, item, "collection")
                : entryRow(item.item || item.category, `${fmtDate(item.date)} · ${esc(item.category)}`, -item.amount, item, "expense")
            ).join("") : `<p class="muted">Nothing entered yet. Tap + to add.</p>`}
        </div>`;
}

function entryRow(title, sub, amount, item, kind) {
    return `
        <button class="entry" data-act="edit-${kind}" data-id="${item.id}">
            <span class="entry-main">
                <span class="entry-title">${esc(title)}${item._pending ? ` <span class="pending" title="Not synced yet">●</span>` : ""}</span>
                <span class="entry-sub">${sub}</span>
            </span>
            <span class="entry-amount ${amount < 0 ? "neg" : "pos"}">${amount < 0 ? "−" : ""}${rs(Math.abs(amount))}</span>
        </button>`;
}

// --- Follow-up ---

const FU_FILTERS = [
    ["todo", "To follow up"],
    ["promised", "Promised"],
    ["mine", "Mine"],
    ["fresh", "Not contacted"],
    ["paid", "Paid"],
    ["declined", "Not giving"]
];

function followupGroups() {
    const paid = paidMap();
    const groups = { todo: [], promised: [], mine: [], fresh: [], paid: [], declined: [] };
    state.donors.forEach(d => {
        const fu = followup(d);
        if (paid.has(d.id)) return groups.paid.push(d);
        if (fu.status === "declined") return groups.declined.push(d);
        groups.todo.push(d);
        if (fu.status === "promised") groups.promised.push(d);
        if (fu.assignedTo === state.me.id) groups.mine.push(d);
        if (!fu.contactedAt && !fu.status) groups.fresh.push(d);
    });
    return { groups, paid };
}

function viewFollowup() {
    const { groups, paid } = followupGroups();
    return `
        <div class="view-head">
            <h1>Follow-up</h1>
            <p class="muted">${paid.size} of ${state.donors.length} donors paid</p>
        </div>
        ${searchBox("followup", "Search name…")}
        <div class="chips">
            ${FU_FILTERS.map(([key, label]) => `
                <button class="chip" data-act="fu-filter" data-filter="${key}" aria-pressed="${state.fuFilter === key}">
                    ${label} <span>${groups[key].length}</span>
                </button>`).join("")}
        </div>
        <div id="list">${followupList()}</div>`;
}

function followupList() {
    const { groups, paid } = followupGroups();
    const term = searchTerm("followup");
    let donors = groups[state.fuFilter] || [];
    if (term) donors = donors.filter(d => nameKey(d.name).includes(term));
    donors = donors.slice().sort((a, b) =>
        ((lastGift(b) || {}).amount || 0) - ((lastGift(a) || {}).amount || 0) || a.name.localeCompare(b.name));

    if (!state.donors.length) {
        return `<div class="empty">No donors yet. Go to <a href="#more">More</a> → <b>Import past donors</b> to load everyone from 2024 & 2025.</div>`;
    }
    if (!donors.length) return `<div class="empty">Nobody here.</div>`;
    return donors.map(d => donorCard(d, paid.get(d.id))).join("");
}

function statusBadge(donor, paidAmount) {
    const fu = followup(donor);
    if (paidAmount) return `<span class="badge paid">Paid ${rs(paidAmount)}</span>`;
    if (fu.status === "promised") return `<span class="badge promised">Promised${fu.promised ? " " + rs(fu.promised) : ""}</span>`;
    if (fu.status === "later") return `<span class="badge later">Call later</span>`;
    if (fu.status === "declined") return `<span class="badge declined">Not giving</span>`;
    if (fu.contactedAt) return `<span class="badge later">Reminded ${fmtDate(fu.contactedAt)}</span>`;
    return `<span class="badge">Not contacted</span>`;
}

function donorCard(donor, paidAmount) {
    const fu = followup(donor);
    const last = lastGift(donor);
    const facts = [
        last ? `${last.year}: ${rs(last.amount)}` : "New donor",
        fu.assignedTo ? `With ${esc(memberName(fu.assignedTo))}` : ""
    ].filter(Boolean).join(" · ");

    let actions;
    if (paidAmount) {
        actions = donor.phone
            ? `<a class="btn wa" href="${esc(waLink(donor.phone, thanksMessage(donor, paidAmount)))}" target="_blank" rel="noopener">${icon("whatsapp")} Thank</a>`
            : "";
    } else if (donor.phone) {
        actions = `
            <a class="btn wa" href="${esc(waLink(donor.phone, reminderMessage(donor)))}" target="_blank" rel="noopener" data-act="contacted" data-id="${donor.id}">${icon("whatsapp")} Remind</a>
            <a class="btn" href="${telLink(donor.phone)}" data-act="contacted" data-id="${donor.id}">Call</a>
            <button class="btn" data-act="fu-update" data-id="${donor.id}">Update</button>
            <button class="btn primary" data-act="collect" data-id="${donor.id}">Paid</button>`;
    } else {
        actions = `
            <button class="btn" data-act="edit-donor" data-id="${donor.id}">Add number</button>
            <button class="btn" data-act="fu-update" data-id="${donor.id}">Update</button>
            <button class="btn primary" data-act="collect" data-id="${donor.id}">Paid</button>`;
    }

    return `
        <article class="donor-card">
            <div class="dc-top">
                <div>
                    <h3>${esc(donor.name)}</h3>
                    <p class="muted small">${facts}</p>
                </div>
                ${statusBadge(donor, paidAmount)}
            </div>
            ${fu.note ? `<p class="dc-note">${esc(fu.note)}</p>` : ""}
            ${actions ? `<div class="dc-actions">${actions}</div>` : ""}
        </article>`;
}

function reminderMessage(donor) {
    const last = lastGift(donor);
    return fillTemplate(state.settings.waReminder, {
        name: donor.name,
        year: year(),
        last: last ? last.amount.toLocaleString("en-IN") : "",
        member: state.me.name || ""
    });
}

function thanksMessage(donor, amount, member) {
    return fillTemplate(state.settings.waThanks, {
        name: donor.name,
        year: year(),
        amount: Number(amount).toLocaleString("en-IN"),
        member: member || state.me.name || ""
    });
}

// --- Entries ---

const ENTRY_TABS = [["collections", "Collections"], ["expenses", "Expenses"], ["moves", "Cash handovers"]];

function viewEntries() {
    const tab = state.entriesTab;
    const total = tab === "moves" ? null : sum(state[tab]);
    return `
        <div class="view-head">
            <h1>Entries</h1>
            ${total !== null ? `<p class="muted">${plural(state[tab].length, "entry", "entries")} · ${rs(total)}</p>` : ""}
        </div>
        <div class="segmented">
            ${ENTRY_TABS.map(([key, label]) =>
                `<button data-act="entries-tab" data-tab="${key}" aria-pressed="${tab === key}">${label}</button>`).join("")}
        </div>
        ${searchBox("entries", "Search…")}
        <div id="list" class="entries">${entriesList()}</div>`;
}

function entriesList() {
    const term = searchTerm("entries");
    const tab = state.entriesTab;
    const match = (...fields) => !term || fields.some(f => nameKey(f).includes(term));

    let rows = [];
    if (tab === "collections") {
        rows = state.collections
            .filter(c => match(c.donorName, memberName(c.collectedBy), c.note))
            .map(c => entryRow(c.donorName,
                `${fmtDate(c.date)} · ${c.mode === "upi" ? "UPI" : "Cash"} · by ${esc(memberName(c.collectedBy))}`,
                c.amount, c, "collection"));
    } else if (tab === "expenses") {
        rows = state.expenses
            .filter(e => match(e.category, e.item, memberName(e.paidBy), e.note))
            .map(e => entryRow(e.item || e.category,
                `${fmtDate(e.date)} · ${esc(e.category)} · paid by ${esc(memberName(e.paidBy))}`,
                -e.amount, e, "expense"));
    } else {
        rows = state.moves
            .filter(m => match(moveFromName(m.from), memberName(m.to), m.note))
            .map(m => `
                <button class="entry" data-act="edit-move" data-id="${m.id}">
                    <span class="entry-main">
                        <span class="entry-title">${esc(moveFromName(m.from))} → ${esc(memberName(m.to))}${m._pending ? ` <span class="pending">●</span>` : ""}</span>
                        <span class="entry-sub">${fmtDate(m.date)}${m.note ? " · " + esc(m.note) : ""}</span>
                    </span>
                    <span class="entry-amount">${rs(m.amount)}</span>
                </button>`);
    }
    return rows.length ? rows.join("") : `<div class="empty">No entries yet. Tap + to add.</div>`;
}

const moveFromName = from => from === "opening" ? `${prevYear()} balance` : memberName(from);

// --- More ---

function viewMore() {
    const item = (href, title, sub, act) => `
        <${act ? `button data-act="${act}"` : `a href="${href}"`} class="menu-item">
            <span><b>${title}</b><span class="muted small">${sub}</span></span>${icon("chevron")}
        </${act ? "button" : "a"}>`;
    return `
        <div class="view-head"><h1>More</h1></div>
        <div class="menu">
            ${item("#donors", "Donors & phone numbers", `${state.donors.length} donors · ${state.donors.filter(d => d.phone).length} with numbers`)}
            ${item("#members", "Members", `${state.members.length} people can use this app`)}
            ${item("#settings", "Year, balance & WhatsApp messages", `Working on ${esc(year())}`)}
            ${item("#export", "Download / Export", "Excel (CSV) files and website data")}
            ${item("", "Import past donors", `Load names & amounts from ${Object.keys(PAST).join(", ") || "website"}`, "import-past")}
        </div>
        <div class="menu">
            ${item("", "Sign out", esc(state.user.email), "signout")}
        </div>`;
}

function viewDonors() {
    return `
        <div class="view-head">
            <a href="#more" class="back">‹ More</a>
            <h1>Donors</h1>
        </div>
        <div class="btn-row">
            <button class="btn primary" data-act="edit-donor">Add donor</button>
            <button class="btn" data-act="paste-numbers">Paste phone numbers</button>
        </div>
        ${searchBox("donors", "Search name or number…")}
        <div id="list" class="entries">${donorsList()}</div>`;
}

function donorsList() {
    const term = searchTerm("donors");
    const donors = state.donors
        .filter(d => !term || nameKey(d.name).includes(term) || digits(d.phone).includes(term.replace(/\D/g, "") || "x"))
        .sort((a, b) => a.name.localeCompare(b.name));
    if (!donors.length) return `<div class="empty">No donors found.</div>`;
    return donors.map(d => {
        const last = lastGift(d);
        return `
            <button class="entry" data-act="edit-donor" data-id="${d.id}">
                <span class="entry-main">
                    <span class="entry-title">${esc(d.name)}</span>
                    <span class="entry-sub">${d.phone ? esc(d.phone) : `<span class="warn">No number</span>`}</span>
                </span>
                <span class="entry-amount muted">${last ? `${last.year}: ${rs(last.amount)}` : ""}</span>
            </button>`;
    }).join("");
}

function viewMembers() {
    return `
        <div class="view-head">
            <a href="#more" class="back">‹ More</a>
            <h1>Members</h1>
            <p class="muted">Everyone here can see and add entries.</p>
        </div>
        <div class="panel">
            ${state.members.map(m => `
                <div class="row-between member">
                    <span><b>${esc(m.name)}</b><span class="muted small">${esc(m.id)}</span></span>
                    ${m.id === state.me.id ? `<span class="muted small">You</span>` :
                        `<button class="btn small" data-act="remove-member" data-id="${esc(m.id)}">Remove</button>`}
                </div>`).join("")}
        </div>
        <form class="panel form" data-form="member">
            <h2>Add a member</h2>
            <label>Name<input name="name" required placeholder="e.g. Kuna Rout"></label>
            <label>Gmail address or ready-made ID
                <input name="email" required autocapitalize="none" placeholder="name@gmail.com  or  kuna">
            </label>
            <p class="hint">A ready-made ID like <b>kuna</b> must also be created in Firebase console → Authentication as <b>kuna@${ID_DOMAIN}</b> with a password.</p>
            <button class="btn primary block">Add member</button>
        </form>`;
}

function viewSettings() {
    const s = state.settings;
    return `
        <div class="view-head">
            <a href="#more" class="back">‹ More</a>
            <h1>Settings</h1>
        </div>
        <form class="panel form" data-form="settings">
            <label>Puja year<input name="year" inputmode="numeric" pattern="\\d{4}" value="${esc(s.year)}" required></label>
            <label>Balance carried from last year (₹)
                <input name="openingBalance" type="number" inputmode="numeric" value="${esc(s.openingBalance)}">
            </label>
            ${PAST[String(Number(s.year) - 1)] ? `<p class="hint">Website shows ${rs(pastClosing(String(Number(s.year) - 1)))} as the ${Number(s.year) - 1} closing balance.</p>` : ""}
            <label>WhatsApp reminder message
                <textarea name="waReminder" rows="8">${esc(s.waReminder)}</textarea>
            </label>
            <label>WhatsApp thank-you message
                <textarea name="waThanks" rows="7">${esc(s.waThanks)}</textarea>
            </label>
            <p class="hint">You can use {name}, {year}, {last} (last year's amount), {amount} (amount received) and {member} (your name). A line is skipped if its value is empty, e.g. {last} for a new donor.</p>
            <button class="btn primary block">Save settings</button>
        </form>`;
}

function viewExport() {
    const item = (kind, title, sub) => `
        <button class="menu-item" data-act="export" data-kind="${kind}">
            <span><b>${title}</b><span class="muted small">${sub}</span></span>${icon("chevron")}
        </button>`;
    return `
        <div class="view-head">
            <a href="#more" class="back">‹ More</a>
            <h1>Export</h1>
            <p class="muted">Files open in Excel.</p>
        </div>
        <div class="menu">
            ${item("collections", "Collections", plural(state.collections.length, "entry", "entries"))}
            ${item("expenses", "Expenses", plural(state.expenses.length, "entry", "entries"))}
            ${item("moves", "Cash handovers", plural(state.moves.length, "entry", "entries"))}
            ${item("donors", "Donor list with phone numbers", `${state.donors.length} donors`)}
            ${item("website", "Data for public website", "Only when you decide to publish the year's accounts")}
        </div>`;
}

// ---------- Sheets (forms that slide up) ----------

// An open sheet adds a history entry so the phone's back button closes it.
// While closing, history.back() is still in flight, so a sheet opened right after
// waits for that before adding its own entry.
let sheetOpen = false;
let backPending = false;
let pushAfterBack = false;

function openSheet(title, body) {
    $("#sheet-root").innerHTML = `
        <div class="sheet-backdrop" data-act="close-sheet"></div>
        <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
            <div class="sheet-head">
                <h2>${esc(title)}</h2>
                <button class="icon-btn" data-act="close-sheet" aria-label="Close">×</button>
            </div>
            <div class="sheet-body">${body}</div>
        </div>`;
    if (!sheetOpen) {
        sheetOpen = true;
        if (backPending) pushAfterBack = true;
        else history.pushState({ sheet: true }, "");
        document.body.classList.add("no-scroll");
    }
}

function closeSheet(fromBackButton) {
    if (!sheetOpen) return;
    sheetOpen = false;
    pushAfterBack = false;
    $("#sheet-root").innerHTML = "";
    document.body.classList.remove("no-scroll");
    if (!fromBackButton) {
        backPending = true;
        history.back();
    }
}

const memberOptions = selected => state.members.map(m =>
    `<option value="${esc(m.id)}" ${m.id === selected ? "selected" : ""}>${esc(m.name)}</option>`).join("");

function openAddChooser() {
    openSheet("Add", `
        <div class="chooser">
            <button class="choice" data-act="new-collection"><b>Collection</b><span>Money received from a donor</span></button>
            <button class="choice" data-act="new-expense"><b>Expense</b><span>Money spent for the puja</span></button>
            <button class="choice" data-act="new-move"><b>Cash handover</b><span>One member gives cash to another</span></button>
        </div>`);
}

function openCollectionSheet({ entry, donorId } = {}) {
    const donor = donorById(entry ? entry.donorId : donorId);
    const fu = donor ? followup(donor) : {};
    openSheet(entry ? "Edit collection" : "New collection", `
        <form class="form" data-form="collection" data-id="${entry ? entry.id : ""}">
            <label>Donor name
                <input name="donor" list="donor-names" required autocomplete="off" value="${esc(donor ? donor.name : entry ? entry.donorName : "")}">
            </label>
            <datalist id="donor-names">${state.donors.map(d => `<option value="${esc(d.name)}">`).join("")}</datalist>
            <label>Phone (optional)<input name="phone" type="tel" inputmode="tel" value="${esc(donor ? donor.phone : "")}"></label>
            <label>Amount (₹)
                <input name="amount" type="number" inputmode="numeric" min="1" required value="${esc(entry ? entry.amount : fu.promised || "")}">
            </label>
            <div class="radio-row">
                <label><input type="radio" name="mode" value="cash" ${!entry || entry.mode !== "upi" ? "checked" : ""}> Cash</label>
                <label><input type="radio" name="mode" value="upi" ${entry && entry.mode === "upi" ? "checked" : ""}> UPI / Online</label>
            </div>
            <label>Received by<select name="by">${memberOptions(entry ? entry.collectedBy : state.me.id)}</select></label>
            <label>Date<input name="date" type="date" required value="${esc(entry ? entry.date : today())}"></label>
            <label>Note<input name="note" value="${esc(entry ? entry.note : "")}" placeholder="optional"></label>
            <button class="btn primary block">${entry ? "Save changes" : "Save collection"}</button>
            ${entry ? `<button type="button" class="btn danger block" data-act="delete-entry" data-kind="collections" data-id="${entry.id}">Delete entry</button>` : ""}
        </form>`);
}

function openExpenseSheet(entry) {
    const categories = [...new Set([...PAST_CATEGORIES, ...state.expenses.map(e => e.category)])];
    openSheet(entry ? "Edit expense" : "New expense", `
        <form class="form" data-form="expense" data-id="${entry ? entry.id : ""}">
            <label>Category
                <input name="category" list="categories" required autocomplete="off" value="${esc(entry ? entry.category : "")}">
            </label>
            <datalist id="categories">${categories.map(c => `<option value="${esc(c)}">`).join("")}</datalist>
            <label>Item<input name="item" required value="${esc(entry ? entry.item : "")}" placeholder="e.g. Tent, Diesel, Chicken 40 kg"></label>
            <label>Amount (₹)<input name="amount" type="number" inputmode="numeric" min="1" required value="${esc(entry ? entry.amount : "")}"></label>
            <label>Paid by<select name="paidBy">${memberOptions(entry ? entry.paidBy : state.me.id)}</select></label>
            <label>Date<input name="date" type="date" required value="${esc(entry ? entry.date : today())}"></label>
            <label>Note<input name="note" value="${esc(entry ? entry.note : "")}" placeholder="optional"></label>
            <button class="btn primary block">${entry ? "Save changes" : "Save expense"}</button>
            ${entry ? `<button type="button" class="btn danger block" data-act="delete-entry" data-kind="expenses" data-id="${entry.id}">Delete entry</button>` : ""}
        </form>`);
}

function openMoveSheet(entry) {
    const from = entry ? entry.from : state.me.id;
    openSheet(entry ? "Edit cash handover" : "Cash handover", `
        <form class="form" data-form="move" data-id="${entry ? entry.id : ""}">
            <label>From
                <select name="from">
                    <option value="opening" ${from === "opening" ? "selected" : ""}>${esc(prevYear())} balance (last year's money)</option>
                    ${memberOptions(from)}
                </select>
            </label>
            <label>To<select name="to">${memberOptions(entry ? entry.to : "")}</select></label>
            <label>Amount (₹)<input name="amount" type="number" inputmode="numeric" min="1" required value="${esc(entry ? entry.amount : "")}"></label>
            <label>Date<input name="date" type="date" required value="${esc(entry ? entry.date : today())}"></label>
            <label>Note<input name="note" value="${esc(entry ? entry.note : "")}" placeholder="optional"></label>
            <button class="btn primary block">${entry ? "Save changes" : "Save handover"}</button>
            ${entry ? `<button type="button" class="btn danger block" data-act="delete-entry" data-kind="moves" data-id="${entry.id}">Delete entry</button>` : ""}
        </form>`);
}

function openFollowupSheet(donorId) {
    const donor = donorById(donorId);
    if (!donor) return;
    const fu = followup(donor);
    const status = fu.status || "pending";
    const option = (value, label) =>
        `<label><input type="radio" name="status" value="${value}" ${status === value ? "checked" : ""}> ${label}</label>`;
    openSheet(donor.name, `
        <form class="form" data-form="followup" data-id="${donor.id}">
            <div class="radio-col">
                ${option("pending", "Not decided yet")}
                ${option("promised", "Promised to give")}
                ${option("later", "Call again later")}
                ${option("declined", "Not giving this year")}
            </div>
            <label>Promised amount (₹)<input name="promised" type="number" inputmode="numeric" value="${esc(fu.promised || "")}"></label>
            <label>Who will follow up
                <select name="assignedTo"><option value="">Nobody yet</option>${memberOptions(fu.assignedTo)}</select>
            </label>
            <label>Note<input name="note" value="${esc(fu.note || "")}" placeholder="e.g. will give after Diwali"></label>
            <button class="btn primary block">Save</button>
        </form>`);
}

function openDonorSheet(donorId) {
    const donor = donorById(donorId);
    const history = donor && donor.history ? Object.entries(donor.history).sort() : [];
    openSheet(donor ? "Edit donor" : "New donor", `
        <form class="form" data-form="donor" data-id="${donor ? donor.id : ""}">
            <label>Name<input name="name" required value="${esc(donor ? donor.name : "")}"></label>
            <label>Phone<input name="phone" type="tel" inputmode="tel" value="${esc(donor ? donor.phone : "")}" placeholder="10 digit mobile number"></label>
            <label>Note<input name="note" value="${esc(donor ? donor.note : "")}" placeholder="e.g. lives in Cuttack"></label>
            ${history.length ? `<p class="hint">Past: ${history.map(([y, a]) => `${y} ${rs(a)}`).join(" · ")}</p>` : ""}
            <button class="btn primary block">Save donor</button>
            ${donor ? `<button type="button" class="btn danger block" data-act="delete-donor" data-id="${donor.id}">Delete donor</button>` : ""}
        </form>`);
}

function parseNumberLines(text) {
    const matched = [], added = [], skipped = [];
    text.split("\n").map(line => line.trim()).filter(Boolean).forEach(line => {
        const m = line.match(/^(.*?)[\s,;:\t-]*(\+?\d[\d\s-]{8,})\s*$/);
        if (!m || !m[1].trim()) return skipped.push(line);
        const name = m[1].replace(/[,;:\t-]+$/, "").trim();
        const phone = digits(m[2]);
        const donor = state.donors.find(d => nameKey(d.name) === nameKey(name));
        (donor ? matched : added).push({ name, phone, donor });
    });
    return { matched, added, skipped };
}

function openPasteNumbersSheet(text = "", preview = null) {
    openSheet("Paste phone numbers", `
        <form class="form" data-form="paste-numbers">
            <p class="hint">One person per line: <b>Name, number</b><br>e.g. <i>Kuna Rout, 9876543210</i></p>
            <textarea name="lines" rows="8" placeholder="Abaduta Rout, 9876543210">${esc(text)}</textarea>
            ${preview ? `
                <div class="preview">
                    <p><b>${preview.matched.length}</b> ${preview.matched.length === 1 ? "number" : "numbers"} will be added to existing donors.</p>
                    ${preview.added.length ? `<p><b>${preview.added.length}</b> ${preview.added.length === 1 ? "name was" : "names were"} not found and will be added as new donors:</p>
                        <p class="muted small">${preview.added.map(a => esc(a.name)).join(", ")}</p>
                        <p class="hint">If a name is just spelled differently, fix it above to match the donor list first.</p>` : ""}
                    ${preview.skipped.length ? `<p class="warn small">Could not read ${preview.skipped.length} line(s): ${preview.skipped.map(esc).join(" | ")}</p>` : ""}
                </div>
                <button class="btn primary block" name="confirm" value="1">Save ${preview.matched.length + preview.added.length} numbers</button>`
            : `<button class="btn primary block">Check</button>`}
        </form>`);
}

function openSavedSheet(donor, amount, collectorEmail) {
    openSheet("Saved", `
        <div class="done">
            <div class="tick">✓</div>
            <h2>${rs(amount)}</h2>
            <p class="muted">from ${esc(donor.name)}</p>
            ${donor.phone ? `<a class="btn wa block" href="${esc(waLink(donor.phone, thanksMessage(donor, amount, memberName(collectorEmail))))}"
                target="_blank" rel="noopener" data-act="close-sheet">${icon("whatsapp")} Send thank-you on WhatsApp</a>` : ""}
            <button class="btn block" data-act="close-sheet">Done</button>
        </div>`);
}

// ---------- Saving ----------

const FORMS = {
    login(form) {
        const { id, password } = formValues(form);
        const email = id.includes("@") ? id.trim() : `${id.trim().toLowerCase()}@${ID_DOMAIN}`;
        signInWithEmailAndPassword(auth, email, password).catch(() => toast("Wrong ID or password"));
    },

    collection(form) {
        const f = formValues(form);
        const amount = Number(f.amount);
        if (!f.donor.trim() || !(amount > 0)) return toast("Enter the donor name and amount");

        const batch = writeBatch(db);
        let donor = state.donors.find(d => nameKey(d.name) === nameKey(f.donor));
        if (!donor) {
            const ref = doc(collection(db, "donors"));
            donor = { id: ref.id, name: f.donor.trim(), phone: digits(f.phone), history: {} };
            batch.set(ref, { name: donor.name, phone: donor.phone, history: {}, ...stamp(true) });
        } else if (digits(f.phone) && digits(f.phone) !== digits(donor.phone)) {
            donor = { ...donor, phone: digits(f.phone) };
            batch.set(doc(db, "donors", donor.id), { phone: donor.phone }, { merge: true });
        }

        const existingId = form.dataset.id;
        const ref = existingId ? doc(db, yearPath("collections"), existingId) : doc(collection(db, yearPath("collections")));
        batch.set(ref, {
            donorId: donor.id,
            donorName: donor.name,
            amount,
            mode: f.mode || "cash",
            collectedBy: f.by,
            date: f.date,
            note: f.note.trim(),
            ...stamp(!existingId)
        }, { merge: true });
        commit(batch.commit());

        if (existingId) {
            closeSheet();
            toast("Saved");
        } else {
            openSavedSheet(donor, amount, f.by);
        }
    },

    expense(form) {
        const f = formValues(form);
        const amount = Number(f.amount);
        if (!(amount > 0)) return toast("Enter the amount");
        const existingId = form.dataset.id;
        const ref = existingId ? doc(db, yearPath("expenses"), existingId) : doc(collection(db, yearPath("expenses")));
        commit(setDoc(ref, {
            category: f.category.trim(),
            item: f.item.trim(),
            amount,
            paidBy: f.paidBy,
            date: f.date,
            note: f.note.trim(),
            ...stamp(!existingId)
        }, { merge: true }));
        closeSheet();
        toast(existingId ? "Saved" : `Expense ${rs(amount)} saved`);
    },

    move(form) {
        const f = formValues(form);
        const amount = Number(f.amount);
        if (!(amount > 0)) return toast("Enter the amount");
        if (f.from === f.to) return toast("From and To must be different");
        const existingId = form.dataset.id;
        const ref = existingId ? doc(db, yearPath("moves"), existingId) : doc(collection(db, yearPath("moves")));
        commit(setDoc(ref, {
            from: f.from,
            to: f.to,
            amount,
            date: f.date,
            note: f.note.trim(),
            ...stamp(!existingId)
        }, { merge: true }));
        closeSheet();
        toast("Handover saved");
    },

    followup(form) {
        const f = formValues(form);
        const update = {
            status: f.status,
            promised: Number(f.promised) || 0,
            assignedTo: f.assignedTo,
            note: f.note.trim(),
            updatedBy: state.me.id
        };
        commit(setDoc(doc(db, "donors", form.dataset.id), { fu: { [year()]: update } }, { merge: true }));
        closeSheet();
        toast("Updated");
    },

    donor(form) {
        const f = formValues(form);
        const existingId = form.dataset.id;
        const duplicate = state.donors.find(d => d.id !== existingId && nameKey(d.name) === nameKey(f.name));
        if (duplicate) return toast(`${duplicate.name} is already in the list`);
        const ref = existingId ? doc(db, "donors", existingId) : doc(collection(db, "donors"));
        commit(setDoc(ref, {
            name: f.name.trim(),
            phone: digits(f.phone),
            note: f.note.trim(),
            ...(existingId ? stamp(false) : { history: {}, ...stamp(true) })
        }, { merge: true }));
        closeSheet();
        toast("Donor saved");
    },

    "paste-numbers"(form, submitter) {
        const text = form.elements.lines.value;
        const preview = parseNumberLines(text);
        if (!submitter || submitter.name !== "confirm") return openPasteNumbersSheet(text, preview);

        const batch = writeBatch(db);
        preview.matched.forEach(({ phone, donor }) =>
            batch.set(doc(db, "donors", donor.id), { phone }, { merge: true }));
        preview.added.forEach(({ name, phone }) =>
            batch.set(doc(collection(db, "donors")), { name, phone, history: {}, ...stamp(true) }));
        commit(batch.commit());
        closeSheet();
        toast(`Saved ${preview.matched.length + preview.added.length} numbers`);
    },

    member(form) {
        const f = formValues(form);
        let email = f.email.trim().toLowerCase();
        if (!email.includes("@")) email = `${email}@${ID_DOMAIN}`;
        commit(setDoc(doc(db, "members", email), { name: f.name.trim(), ...stamp(true) }));
        form.reset();
        toast(`${f.name.trim()} added`);
    },

    settings(form) {
        const f = formValues(form);
        commit(setDoc(doc(db, "settings", "app"), {
            year: f.year.trim(),
            openingBalance: Number(f.openingBalance) || 0,
            waReminder: f.waReminder,
            waThanks: f.waThanks,
            ...stamp(false)
        }, { merge: true }));
        toast("Settings saved");
    }
};

// ---------- Buttons ----------

const ACTIONS = {
    "close-sheet": () => closeSheet(),
    "add": openAddChooser,
    "new-collection": () => openCollectionSheet(),
    "new-expense": () => openExpenseSheet(),
    "new-move": () => openMoveSheet(),
    "collect": (el, id) => openCollectionSheet({ donorId: id }),
    "fu-update": (el, id) => openFollowupSheet(id),
    "edit-donor": (el, id) => openDonorSheet(id),
    "paste-numbers": () => openPasteNumbersSheet(),
    "edit-collection": (el, id) => openCollectionSheet({ entry: state.collections.find(c => c.id === id) }),
    "edit-expense": (el, id) => openExpenseSheet(state.expenses.find(e => e.id === id)),
    "edit-move": (el, id) => openMoveSheet(state.moves.find(m => m.id === id)),

    "contacted": (el, id) => {
        const fu = followup(donorById(id) || {});
        const update = { contactedAt: today(), contactedBy: state.me.id };
        if (!fu.assignedTo) update.assignedTo = state.me.id;
        commit(setDoc(doc(db, "donors", id), { fu: { [year()]: update } }, { merge: true }));
    },

    "delete-entry": (el, id) => {
        if (!confirm("Delete this entry?")) return;
        commit(setDoc(doc(db, yearPath(el.dataset.kind), id),
            { deleted: true, deletedBy: state.me.id, deletedAt: serverTimestamp() }, { merge: true }));
        closeSheet();
        toast("Deleted");
    },

    "delete-donor": (el, id) => {
        if (state.collections.some(c => c.donorId === id)) return toast("This donor has collections this year. Delete those first.");
        if (!confirm("Delete this donor and their history?")) return;
        commit(deleteDoc(doc(db, "donors", id)));
        closeSheet();
    },

    "remove-member": (el, id) => {
        if (!confirm(`Remove ${memberName(id)}? They will no longer be able to open the app.`)) return;
        commit(deleteDoc(doc(db, "members", id)));
    },

    "fu-filter": el => {
        state.fuFilter = el.dataset.filter;
        render();
    },

    "entries-tab": el => {
        state.entriesTab = el.dataset.tab;
        render();
    },

    "import-past": () => {
        const years = Object.keys(PAST);
        if (!years.length) return toast("No past data found");
        if (!confirm(`Load all donors from ${years.join(", ")} with their amounts? Existing donors are updated, nobody is duplicated.`)) return;
        const groups = new Map();
        years.sort().forEach(y => PAST[y].donations.forEach(d => {
            if (nameKey(d.name) === "other collection") return;
            const key = nameKey(d.name);
            const group = groups.get(key) || { name: d.name.trim(), history: {} };
            group.history[y] = (group.history[y] || 0) + d.amount;
            group.name = d.name.trim().replace(/\s+/g, " ");
            groups.set(key, group);
        }));
        const batch = writeBatch(db);
        let added = 0, updated = 0;
        groups.forEach((group, key) => {
            const existing = state.donors.find(d => nameKey(d.name) === key);
            if (existing) {
                batch.set(doc(db, "donors", existing.id), { history: group.history }, { merge: true });
                updated++;
            } else {
                batch.set(doc(collection(db, "donors")), { name: group.name, phone: "", history: group.history, ...stamp(true) });
                added++;
            }
        });
        commit(batch.commit());
        toast(`${added} donors added, ${updated} updated`);
    },

    "export": el => exportData(el.dataset.kind),

    "google-login": () => {
        signInWithPopup(auth, new GoogleAuthProvider()).catch(err => {
            if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") return;
            toast("Google sign-in did not work here. Try ID & password.");
        });
    },

    "signout": () => {
        if (confirm("Sign out?")) signOut(auth);
    }
};

function exportData(kind) {
    const y = year();
    if (kind === "collections") {
        download(`collections-${y}.csv`, toCsv([
            ["Date", "Donor", "Amount", "Mode", "Received by", "Note"],
            ...state.collections.map(c => [c.date, c.donorName, c.amount, c.mode === "upi" ? "UPI" : "Cash", memberName(c.collectedBy), c.note])
        ]));
    } else if (kind === "expenses") {
        download(`expenses-${y}.csv`, toCsv([
            ["Date", "Category", "Item", "Amount", "Paid by", "Note"],
            ...state.expenses.map(e => [e.date, e.category, e.item, e.amount, memberName(e.paidBy), e.note])
        ]));
    } else if (kind === "moves") {
        download(`cash-handovers-${y}.csv`, toCsv([
            ["Date", "From", "To", "Amount", "Note"],
            ...state.moves.map(m => [m.date, moveFromName(m.from), memberName(m.to), m.amount, m.note])
        ]));
    } else if (kind === "donors") {
        const years = [...new Set(state.donors.flatMap(d => Object.keys(d.history || {})))].sort();
        const paid = paidMap();
        download("donors.csv", toCsv([
            ["Name", "Phone", ...years, y, "Status", "Note"],
            ...state.donors.slice().sort((a, b) => a.name.localeCompare(b.name)).map(d => [
                d.name, d.phone, ...years.map(yr => (d.history || {})[yr] || ""), paid.get(d.id) || "",
                followup(d).status || "", d.note
            ])
        ]));
    } else if (kind === "website") {
        // Same shape as pujaData in data.js, ready to paste in when publishing the accounts
        const donations = new Map();
        state.collections.forEach(c => donations.set(c.donorName, (donations.get(c.donorName) || 0) + Number(c.amount)));
        const categories = new Map();
        state.expenses.forEach(e => {
            const items = categories.get(e.category) || new Map();
            items.set(e.item, (items.get(e.item) || 0) + Number(e.amount));
            categories.set(e.category, items);
        });
        const data = {
            [y]: {
                donations: [...donations].sort((a, b) => a[0].localeCompare(b[0])).map(([name, amount]) => ({ name, amount })),
                expenditure: [...categories].map(([category, items]) => ({
                    category,
                    items: [...items].map(([name, amount]) => ({ name, amount })),
                    total: [...items.values()].reduce((a, b) => a + b, 0)
                }))
            }
        };
        download(`website-data-${y}.json`, JSON.stringify(data, null, 2), "application/json");
    }
}

// ---------- Events ----------

document.addEventListener("click", e => {
    const el = e.target.closest("[data-act]");
    if (!el || !ACTIONS[el.dataset.act]) return;
    if (el.tagName === "BUTTON") e.preventDefault();
    ACTIONS[el.dataset.act](el, el.dataset.id, e);
});

document.addEventListener("submit", e => {
    const handler = FORMS[e.target.dataset.form];
    if (!handler) return;
    e.preventDefault();
    handler(e.target, e.submitter);
});

document.addEventListener("input", e => {
    const view = e.target.dataset.search;
    if (!view) return;
    state.search[view] = e.target.value;
    renderList();
});

// Keep the donor's saved number in the collection form when a known name is picked
document.addEventListener("change", e => {
    if (e.target.name !== "donor") return;
    const donor = state.donors.find(d => nameKey(d.name) === nameKey(e.target.value));
    const phone = e.target.form && e.target.form.elements.phone;
    if (donor && phone && !phone.value) phone.value = donor.phone || "";
});

window.addEventListener("hashchange", () => {
    window.scrollTo(0, 0);
    render();
});

// Phone back button closes an open form instead of leaving the app
window.addEventListener("popstate", () => {
    if (backPending) {
        backPending = false;
        if (pushAfterBack) {
            pushAfterBack = false;
            history.pushState({ sheet: true }, "");
        }
        return;
    }
    if (sheetOpen) closeSheet(true);
});

window.addEventListener("online", scheduleRender);
window.addEventListener("offline", scheduleRender);

if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => { });
}

// ---------- Start ----------

if (configured) {
    onAuthStateChanged(auth, user => {
        stopData();
        state.user = user;
        state.authReady = true;
        state.me = null;
        state.memberStatus = "checking";
        state.members = state.donors = state.collections = state.expenses = state.moves = [];
        if (user && user.email) watchMembership(user);
        else if (user) state.memberStatus = "denied";
        render();
    });
} else {
    render();
}
