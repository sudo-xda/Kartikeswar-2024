import { firebaseConfig } from "./firebase-config.js";
import { STR, DEFAULT_MESSAGES, DEFAULT_TASKS } from "./i18n.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
    collection, doc, onSnapshot, getDoc, setDoc, deleteDoc, writeBatch, runTransaction, serverTimestamp
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

// ---------- Language ----------

let lang = "en";
try { lang = localStorage.getItem("lang") === "or" ? "or" : "en"; } catch (e) { }
document.documentElement.lang = lang;

function t(key, vars = {}) {
    const entry = STR[key];
    const text = entry ? entry[lang === "or" ? 1 : 0] : key;
    return text.replace(/\{(\w+)\}/g, (match, name) => vars[name] !== undefined ? vars[name] : match);
}

function setLang(value) {
    lang = value;
    try { localStorage.setItem("lang", value); } catch (e) { }
    document.documentElement.lang = value;
    render();
}

const countEntries = n => n === 1 ? t("entryCount") : t("entriesCount", { n });

// ---------- Helpers ----------

const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rs = amount => (amount < 0 ? "−" : "") + "₹" + Math.round(Math.abs(amount || 0)).toLocaleString("en-IN");
const sum = (list, key = "amount") => list.reduce((total, item) => total + (Number(item[key]) || 0), 0);
const digits = value => String(value || "").replace(/\D/g, "");

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

function addDays(iso, days) {
    const [y, m, d] = iso.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + days));
    return date.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
    const ms = Date.parse(toIso + "T00:00:00Z") - Date.parse(fromIso + "T00:00:00Z");
    return Math.round(ms / 86400000);
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

const waLink = (phone, text) => `https://wa.me/${phone ? waNumber(phone) : ""}?text=${encodeURIComponent(text)}`;
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

function pastCategoryTotal(year, category) {
    const data = PAST[year];
    const found = data && data.expenditure.find(c => c.category === category);
    return found ? found.total : 0;
}

const PAST_CATEGORIES = (() => {
    const latest = Object.keys(PAST).sort().pop();
    return latest ? PAST[latest].expenditure.map(c => c.category) : [];
})();

// UPI payment string read by every UPI app (GPay, PhonePe, Paytm, BHIM…)
function upiString(amount, note) {
    const s = state.settings;
    const params = [`pa=${String(s.upiId).trim()}`, `pn=${encodeURIComponent(s.upiName || "Kartikeswar Puja Committee")}`, "cu=INR"];
    if (Number(amount) > 0) params.push(`am=${Number(amount)}`);
    if (note) params.push(`tn=${encodeURIComponent(note)}`);
    return "upi://pay?" + params.join("&");
}

// Public pay page on the website; it reads the UPI ID from the database, not from the link
function payLink(donorName, amount) {
    if (!hasUpi()) return "";
    const url = new URL("../pay.html", location.href);
    url.searchParams.set("y", year());
    if (donorName) url.searchParams.set("n", donorName);
    if (Number(amount) > 0) url.searchParams.set("am", String(Number(amount)));
    return url.toString();
}

function qrSvg(text) {
    if (typeof qrcode === "undefined") return "";
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

const ICONS = {
    home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    followup: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    entries: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    more: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    whatsapp: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z"/>'
};
const icon = name => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

// ---------- State ----------

const thisYear = String(new Date().getFullYear());
const DEFAULT_SETTINGS = {
    year: thisYear,
    pujaDate: "",
    upiId: "",
    upiName: "Kartikeswar Puja Committee",
    msgLang: "or",
    ...DEFAULT_MESSAGES
};

const state = {
    authReady: false,
    user: null,
    memberStatus: "checking", // checking | ok | denied
    me: null,
    settings: { ...DEFAULT_SETTINGS, openingBalance: pastClosing(String(Number(thisYear) - 1)) },
    members: [],
    donors: [],
    collectionsAll: [], // includes cancelled ones, so receipt numbers have no gaps
    collections: [],
    expenses: [],
    moves: [],
    vendors: [],
    tasks: [],
    budget: {},
    publicPay: {}, // UPI ID, payee name and QR image shown on the public pay page
    pendingQr: undefined, // QR image chosen in Settings but not saved yet ("" = remove)
    pendingPhoto: undefined, // photo picked in the open collection/expense form ("" = remove)
    photoEntry: null, // the entry that form is editing
    search: {},
    fuFilter: "todo",
    entriesTab: "collections"
};

let dataUnsubs = [];
let yearUnsubs = [];
let renderQueued = false;
let formDirty = false; // a form on the page (Settings, Members) has unsaved typing

function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
        renderQueued = false;
        if (!formDirty) render();
    });
}

const year = () => state.settings.year;
const hasUpi = () => Boolean(state.settings.upiId || state.publicPay.qrImage);
const prevYear = () => String(Number(year()) - 1);
const yearPath = kind => `years/${year()}/${kind}`;
const donorById = id => state.donors.find(d => d.id === id);
const vendorById = id => state.vendors.find(v => v.id === id);
const BANK = "bank"; // UPI money lands in the committee account, not in anyone's hand
const memberName = email => email === BANK ? t("bankAccount") : (state.members.find(m => m.id === email) || {}).name || email || "";
const receiptLabel = number => number ? `KP-${year()}-${String(number).padStart(3, "0")}` : "";

function stamp(isNew) {
    return isNew
        ? { createdBy: state.me.id, createdAt: serverTimestamp() }
        : { updatedBy: state.me.id, updatedAt: serverTimestamp() };
}

function commit(promise) {
    // Writes are saved on the phone at once and synced when online, so don't wait for them
    promise.catch(err => toast(t("couldNotSave", { msg: err.message })));
}

// ---------- Data subscriptions ----------

function toList(snap) {
    return snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }), _pending: d.metadata.hasPendingWrites }));
}

const active = list => list.filter(item => !item.deleted);

const byNewest = (a, b) =>
    (b.date || "").localeCompare(a.date || "") ||
    ((b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

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
        state.members = active(toList(snap)).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        scheduleRender();
    }, onDataError));

    dataUnsubs.push(onSnapshot(collection(db, "donors"), snap => {
        state.donors = active(toList(snap));
        scheduleRender();
    }, onDataError));

    // Not fatal if unreadable (e.g. rules not updated yet): the app just works without the QR image
    dataUnsubs.push(onSnapshot(doc(db, "public", "pay"), snap => {
        state.publicPay = snap.exists() ? snap.data() : {};
        scheduleRender();
    }, () => { }));

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
    const watch = (kind, handle) => onSnapshot(collection(db, yearPath(kind)), { includeMetadataChanges: true }, snap => {
        handle(toList(snap));
        scheduleRender();
    }, onDataError);

    yearUnsubs = [
        watch("collections", list => {
            state.collectionsAll = list.sort(byNewest);
            state.collections = active(state.collectionsAll);
            assignMissingReceipts();
        }),
        watch("expenses", list => state.expenses = active(list).sort(byNewest)),
        watch("moves", list => state.moves = active(list).sort(byNewest)),
        watch("vendors", list => state.vendors = active(list).sort((a, b) => (a.name || "").localeCompare(b.name || ""))),
        watch("tasks", list => state.tasks = active(list)),
        watch("meta", list => state.budget = ((list.find(d => d.id === "budget") || {}).categories) || {})
    ];
}

// ---------- Receipt numbers ----------
// A shared counter hands out KP-2026-001, 002… inside a transaction, so two phones never get
// the same number. Transactions need internet; entries saved offline get their number
// automatically once the phone is back online.

const counterRef = () => doc(db, yearPath("meta"), "counters");
const numbering = new Set();

function nextReceipt(tx) {
    return tx.get(counterRef()).then(snap => (snap.exists() ? Number(snap.data().receipt) || 0 : 0) + 1);
}

function saveWithReceipt(ref, data) {
    const attempt = runTransaction(db, async tx => {
        const number = await nextReceipt(tx);
        tx.set(counterRef(), { receipt: number }, { merge: true });
        tx.set(ref, { ...data, receiptNo: number });
        return number;
    });
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000));
    return Promise.race([attempt, timeout]);
}

function assignMissingReceipts() {
    if (!navigator.onLine || !state.me) return;
    state.collectionsAll
        .filter(c => !c.receiptNo && !c._pending && c.createdBy === state.me.id && !numbering.has(c.id))
        .forEach(c => {
            numbering.add(c.id);
            const ref = doc(db, yearPath("collections"), c.id);
            runTransaction(db, async tx => {
                const entry = await tx.get(ref);
                if (!entry.exists() || entry.data().receiptNo) return;
                const number = await nextReceipt(tx);
                tx.set(counterRef(), { receipt: number }, { merge: true });
                tx.set(ref, { receiptNo: number }, { merge: true });
            }).catch(() => { }).finally(() => numbering.delete(c.id));
        });
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
    state.collections.forEach(c => add(c.mode === "upi" ? BANK : c.collectedBy, Number(c.amount)));
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

function vendorStatus(vendor) {
    const payments = state.expenses.filter(e => e.vendorId === vendor.id);
    const paid = sum(payments);
    const total = Number(vendor.total) || 0;
    return { payments, paid, total, due: Math.max(0, total - paid) };
}

function categories() {
    return [...new Set([
        ...PAST_CATEGORIES,
        ...Object.keys(state.budget),
        ...state.expenses.map(e => e.category),
        ...state.vendors.map(v => v.category)
    ].filter(Boolean))];
}

function followupGroups() {
    const paid = paidMap();
    const now = today();
    const groups = { todo: [], calls: [], promised: [], mine: [], fresh: [], paid: [], declined: [] };
    state.donors.forEach(d => {
        const fu = followup(d);
        if (paid.has(d.id)) return groups.paid.push(d);
        if (fu.status === "declined") return groups.declined.push(d);
        groups.todo.push(d);
        if (fu.status === "later" && fu.callOn && fu.callOn <= now) groups.calls.push(d);
        if (fu.status === "promised") groups.promised.push(d);
        if (fu.assignedTo === state.me.id) groups.mine.push(d);
        if (!fu.contactedAt && !fu.status) groups.fresh.push(d);
    });
    return { groups, paid };
}

// ---------- Rendering ----------

const VIEWS = {
    home: viewHome,
    followup: viewFollowup,
    entries: viewEntries,
    more: viewMore,
    tasks: viewTasks,
    spending: viewSpending,
    donors: viewDonors,
    members: viewMembers,
    settings: viewSettings,
    export: viewExport
};
const LISTS = { followup: followupList, entries: entriesList, donors: donorsList };
const NAV_PARENT = { tasks: "more", spending: "more", donors: "more", members: "more", settings: "more", export: "more" };

function currentView() {
    const view = location.hash.slice(1);
    return VIEWS[view] ? view : "home";
}

function render() {
    const root = $("#app");
    if (!configured) {
        root.innerHTML = screenMessage(t("almostReady"), t("notConfigured"));
        return;
    }
    if (!state.authReady) {
        root.innerHTML = screenMessage("", t("loading"));
        return;
    }
    if (!state.user) {
        root.innerHTML = viewLogin();
        return;
    }
    if (state.memberStatus === "checking") {
        root.innerHTML = screenMessage("", t("checkingAccess"));
        return;
    }
    if (state.memberStatus === "denied") {
        root.innerHTML = screenMessage(t("notAdded"), t("notAddedBody", { email: esc(state.user.email) }),
            `<button class="btn" data-act="signout">${t("signOut")}</button>`);
        return;
    }

    const view = currentView();
    const activeEl = document.activeElement;
    const focusId = activeEl && activeEl.id && root.contains(activeEl) ? activeEl.id : null;
    const caret = focusId && "selectionStart" in activeEl ? activeEl.selectionStart : null;

    const nav = NAV_PARENT[view] || view;
    const navItem = (name, label) =>
        `<a href="#${name}" class="${nav === name ? "active" : ""}">${icon(name)}<span>${label}</span></a>`;

    root.innerHTML = `
        <header class="topbar">
            <span class="brand">Kartikeswar <span class="year-pill">${esc(year())}</span></span>
            ${navigator.onLine ? "" : `<span class="offline">${t("offline")}</span>`}
        </header>
        <main class="view">${VIEWS[view]()}</main>
        <nav class="bottom-nav">
            ${navItem("home", t("navHome"))}
            ${navItem("followup", t("navFollowup"))}
            <button class="fab" data-act="add" aria-label="${t("addEntry")}">${icon("plus")}</button>
            ${navItem("entries", t("navEntries"))}
            ${navItem("more", t("navMore"))}
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

function langSwitch() {
    return `
        <div class="lang-switch" role="group" aria-label="${t("language")}">
            <button data-act="lang" data-lang="en" aria-pressed="${lang === "en"}">English</button>
            <button data-act="lang" data-lang="or" aria-pressed="${lang === "or"}">ଓଡ଼ିଆ</button>
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
            ${langSwitch()}
            <div class="diya" aria-hidden="true"></div>
            <p class="eyebrow">${t("jayMaa")}</p>
            <h1>${t("committee")}</h1>
            <p class="muted">${t("membersOnly")}</p>
            <button class="btn primary block" data-act="google-login">${t("googleSignIn")}</button>
            <details class="id-login">
                <summary>${t("useId")}</summary>
                <form data-form="login">
                    <label>${t("userId")}<input name="id" autocomplete="username" autocapitalize="none" required></label>
                    <label>${t("password")}<input name="password" type="password" autocomplete="current-password" required></label>
                    <button class="btn block">${t("signIn")}</button>
                </form>
            </details>
        </div>`;
}

// --- Home ---

function countdown() {
    const date = state.settings.pujaDate;
    if (!date) return "";
    const days = daysBetween(today(), date);
    if (days < 0) return "";
    if (days === 0) return t("pujaToday");
    if (days === 1) return t("oneDayToGo");
    return t("daysToGo", { n: days });
}

function viewHome() {
    const tt = totals();
    const paid = paidMap();
    const lastYearTotal = PAST[prevYear()] ? sum(PAST[prevYear()].donations) : 0;
    const progress = lastYearTotal ? Math.min(100, (tt.collected / lastYearTotal) * 100) : 0;
    const { groups } = followupGroups();
    const promisedTotal = sum(groups.promised.map(d => ({ amount: followup(d).promised })));

    const holders = [...tt.held.entries()].filter(([, amount]) => amount !== 0).sort((a, b) => b[1] - a[1]);
    const recent = [
        ...state.collections.map(c => ({ ...c, kind: "collection" })),
        ...state.expenses.map(e => ({ ...e, kind: "expense" }))
    ].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)).slice(0, 6);

    const vendorDues = state.vendors.map(v => ({ vendor: v, ...vendorStatus(v) })).filter(v => v.due > 0)
        .sort((a, b) => b.due - a.due);
    const openTasks = state.tasks.filter(task => !task.done && task.due)
        .sort((a, b) => a.due.localeCompare(b.due));
    const soonTasks = openTasks.filter(task => daysBetween(today(), task.due) <= 3);
    const doneTasks = state.tasks.filter(task => task.done).length;
    const cd = countdown();

    return `
        <section class="hello">
            <p>${t("hello", { name: esc(state.me.name || "") })}</p>
            <h1>${t("pujaYear", { year: esc(year()) })}</h1>
            ${cd ? `<span class="countdown">${cd}</span>` : ""}
        </section>

        <div class="cards">
            <div class="card">
                <span class="label">${t("collected")}</span>
                <span class="big">${rs(tt.collected)}</span>
                <span class="note">${t("donorsPaid", { n: paid.size })}</span>
            </div>
            <div class="card">
                <span class="label">${t("spent")}</span>
                <span class="big">${rs(tt.spent)}</span>
                <span class="note">${countEntries(state.expenses.length)}</span>
            </div>
            <div class="card wide accent">
                <span class="label">${t("balance")}</span>
                <span class="big ${tt.balance < 0 ? "neg" : ""}">${tt.balance < 0 ? "−" : ""}${rs(Math.abs(tt.balance))}</span>
                <span class="note">${tt.opening ? t("inclFrom", { amount: rs(tt.opening), year: esc(prevYear()) }) : t("collectedMinusSpent")}</span>
            </div>
        </div>

        <a class="btn wa block share-btn" href="${esc(waLink("", summaryText()))}" target="_blank" rel="noopener">
            ${icon("whatsapp")} ${t("shareSummary")}
        </a>

        ${lastYearTotal ? `
        <div class="panel">
            <div class="row-between"><span>${t("vsLast", { year: esc(prevYear()) })}</span><b>${rs(tt.collected)} / ${rs(lastYearTotal)}</b></div>
            <div class="bar"><span style="width:${progress}%"></span></div>
        </div>` : ""}

        ${groups.calls.length ? `
        <div class="panel">
            <div class="row-between"><h2>${t("todaysCalls")} · ${groups.calls.length}</h2><a href="#followup" data-act="fu-filter-go" data-filter="calls">${t("seeAll")}</a></div>
            ${groups.calls.slice(0, 5).map(d => `
                <div class="row-between">
                    <span><b>${esc(d.name)}</b>${followup(d).note ? `<span class="muted small block-line">${esc(followup(d).note)}</span>` : ""}</span>
                    ${d.phone ? `<a class="btn small" href="${telLink(d.phone)}" data-act="contacted" data-id="${d.id}">${t("call")}</a>` : ""}
                </div>`).join("")}
        </div>` : ""}

        <a class="panel link-panel" href="#followup">
            <h2>${t("navFollowup")}</h2>
            <div class="row-between"><span>${t("yetToPay")}</span><b>${groups.todo.length}</b></div>
            <div class="row-between"><span>${t("promisedPending")}</span><b>${rs(promisedTotal)} · ${groups.promised.length}</b></div>
            <div class="row-between"><span>${t("assignedToYou")}</span><b>${groups.mine.length}</b></div>
        </a>

        ${state.tasks.length ? `
        <a class="panel link-panel" href="#tasks">
            <div class="row-between"><h2>${t("checklist")}</h2><span class="muted small">${t("tasksDone", { done: doneTasks, total: state.tasks.length })}</span></div>
            ${soonTasks.slice(0, 4).map(task => `
                <div class="row-between">
                    <span>${esc(task.title)}${task.assignedTo ? ` <span class="muted small">· ${esc(memberName(task.assignedTo))}</span>` : ""}</span>
                    <span class="badge ${task.due < today() ? "overdue" : "later"}">${fmtDate(task.due)}</span>
                </div>`).join("")}
        </a>` : ""}

        ${vendorDues.length ? `
        <a class="panel link-panel" href="#spending">
            <div class="row-between"><h2>${t("vendorDues")}</h2><b class="neg">${rs(sum(vendorDues, "due"))}</b></div>
            ${vendorDues.slice(0, 4).map(v => `
                <div class="row-between"><span>${esc(v.vendor.name)}</span><span>${rs(v.due)}</span></div>`).join("")}
        </a>` : ""}

        <div class="panel">
            <h2>${t("cashInHand")}</h2>
            ${holders.map(([email, amount]) => `
                <div class="row-between"><span>${esc(memberName(email))}</span><b class="${amount < 0 ? "neg" : ""}">${amount < 0 ? "−" : ""}${rs(Math.abs(amount))}</b></div>`).join("")}
            ${tt.unassignedOpening ? `
                <div class="row-between"><span>${t("notHandedOver", { year: esc(prevYear()) })}</span><b>${rs(tt.unassignedOpening)}</b></div>` : ""}
            ${!holders.length && !tt.unassignedOpening ? `<p class="muted">${t("noCash")}</p>` : ""}
            <p class="hint">${t("cashHint")}</p>
        </div>

        <div class="panel">
            <h2>${t("recent")}</h2>
            ${recent.length ? recent.map(item => item.kind === "collection"
                ? collectionRow(item)
                : entryRow(item.item || item.category, `${fmtDate(item.date)} · ${esc(item.category)}`, -item.amount, item, "expense")
            ).join("") : `<p class="muted">${t("nothingYet")}</p>`}
        </div>`;
}

function entryRow(title, sub, amount, item, kind, extraClass = "") {
    return `
        <button class="entry ${extraClass}" data-act="edit-${kind}" data-id="${item.id}">
            <span class="entry-main">
                <span class="entry-title">${esc(title)}${item.hasPhoto ? ` <span class="has-photo">${icon("camera")}</span>` : ""}${item._pending ? ` <span class="pending" title="Not synced yet">●</span>` : ""}</span>
                <span class="entry-sub">${sub}</span>
            </span>
            <span class="entry-amount ${amount < 0 ? "neg" : "pos"}">${amount < 0 ? "−" : ""}${rs(Math.abs(amount))}</span>
        </button>`;
}

function collectionRow(c) {
    const parts = [
        c.receiptNo ? receiptLabel(c.receiptNo) : "",
        fmtDate(c.date),
        c.mode === "upi" ? t("upi") : t("cash"),
        t("by", { name: esc(memberName(c.collectedBy)) })
    ].filter(Boolean);
    if (c.deleted) parts.unshift(t("cancelled"));
    return entryRow(c.donorName, parts.join(" · "), c.amount, c, "collection", c.deleted ? "cancelled" : "");
}

// --- Today's summary for the committee WhatsApp group ---

function summaryText() {
    const now = today();
    const tt = totals();
    const todays = state.collections.filter(c => c.date === now);
    const lastYearTotal = PAST[prevYear()] ? sum(PAST[prevYear()].donations) : 0;
    const { groups } = followupGroups();
    const promised = groups.promised.map(d => ({ name: d.name, amount: Number(followup(d).promised) || 0 }))
        .sort((a, b) => b.amount - a.amount);

    const lines = [`*${t("sumTitle", { year: year(), date: fmtDate(now) })}*`, ""];
    if (todays.length) {
        lines.push(`*${t("sumToday")}: ${rs(sum(todays))}* (${t("sumDonors", { n: todays.length })})`);
        todays.forEach(c => lines.push(`• ${c.donorName} ${rs(c.amount)}${c.mode === "upi" ? " (UPI)" : ""} – ${memberName(c.collectedBy)}`));
    } else {
        lines.push(t("sumNoneToday"));
    }
    lines.push("");
    lines.push(`*${t("sumTotal")}: ${rs(tt.collected)}*` +
        (lastYearTotal ? ` (${prevYear()}: ${rs(lastYearTotal)}, ${Math.round((tt.collected / lastYearTotal) * 100)}%)` : ""));
    lines.push(t("sumSpentBalance", { spent: rs(tt.spent), balance: rs(tt.balance) }));

    const holders = [...tt.held.entries()].filter(([, amount]) => amount !== 0).sort((a, b) => b[1] - a[1]);
    if (holders.length || tt.unassignedOpening) {
        lines.push("", `*${t("cashInHand")}*`);
        holders.forEach(([email, amount]) => lines.push(`• ${memberName(email)}: ${rs(amount)}`));
        if (tt.unassignedOpening) lines.push(`• ${t("notHandedOver", { year: prevYear() })}: ${rs(tt.unassignedOpening)}`);
    }
    if (promised.length) {
        lines.push("", `*${t("sumPromised")}: ${rs(sum(promised))}*`);
        promised.slice(0, 10).forEach(p => lines.push(`• ${p.name}${p.amount ? " " + rs(p.amount) : ""}`));
        if (promised.length > 10) lines.push(t("sumAndMore", { n: promised.length - 10 }));
    }
    lines.push("", t("jayMaa"));
    return lines.join("\n");
}

// --- Follow-up ---

const FU_FILTERS = [
    ["todo", "fTodo"],
    ["calls", "fCalls"],
    ["promised", "fPromised"],
    ["mine", "fMine"],
    ["fresh", "fFresh"],
    ["paid", "fPaid"],
    ["declined", "fDeclined"]
];

function viewFollowup() {
    const { groups, paid } = followupGroups();
    return `
        <div class="view-head">
            <h1>${t("navFollowup")}</h1>
            <p class="muted">${t("donorsPaidOf", { paid: paid.size, total: state.donors.length })}</p>
        </div>
        ${searchBox("followup", t("searchName"))}
        <div class="chips">
            ${FU_FILTERS.filter(([key]) => key !== "calls" || groups.calls.length).map(([key, label]) => `
                <button class="chip" data-act="fu-filter" data-filter="${key}" aria-pressed="${state.fuFilter === key}">
                    ${t(label)} <span>${groups[key].length}</span>
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

    if (!state.donors.length) return `<div class="empty">${t("noDonors")}</div>`;
    if (!donors.length) return `<div class="empty">${t("nobodyHere")}</div>`;
    return donors.map(d => donorCard(d, paid.get(d.id))).join("");
}

function statusBadge(donor, paidAmount) {
    const fu = followup(donor);
    if (paidAmount) return `<span class="badge paid">${t("bPaid", { amount: rs(paidAmount) })}</span>`;
    if (fu.status === "promised") return `<span class="badge promised">${fu.promised ? t("bPromised", { amount: rs(fu.promised) }) : t("bPromisedPlain")}</span>`;
    if (fu.status === "later") {
        const overdue = fu.callOn && fu.callOn <= today();
        return `<span class="badge ${overdue ? "overdue" : "later"}">${fu.callOn ? t("bCallOn", { date: fmtDate(fu.callOn) }) : t("bLater")}</span>`;
    }
    if (fu.status === "declined") return `<span class="badge declined">${t("bDeclined")}</span>`;
    if (fu.contactedAt) return `<span class="badge later">${t("bReminded", { date: fmtDate(fu.contactedAt) })}</span>`;
    return `<span class="badge">${t("bFresh")}</span>`;
}

function donorCard(donor, paidAmount) {
    const fu = followup(donor);
    const last = lastGift(donor);
    const facts = [
        last ? `${last.year}: ${rs(last.amount)}` : t("newDonor"),
        fu.assignedTo ? t("withName", { name: esc(memberName(fu.assignedTo)) }) : ""
    ].filter(Boolean).join(" · ");
    const upiBtn = hasUpi()
        ? `<button class="btn" data-act="upi-qr" data-id="${donor.id}">${t("upiQr")}</button>` : "";

    let actions;
    if (paidAmount) {
        actions = donor.phone
            ? `<a class="btn wa" href="${esc(waLink(donor.phone, thanksMessage(donor, paidAmount)))}" target="_blank" rel="noopener">${icon("whatsapp")} ${t("thank")}</a>`
            : "";
    } else if (donor.phone) {
        actions = `
            <a class="btn wa" href="${esc(waLink(donor.phone, reminderMessage(donor)))}" target="_blank" rel="noopener" data-act="contacted" data-id="${donor.id}">${icon("whatsapp")} ${t("remind")}</a>
            <a class="btn" href="${telLink(donor.phone)}" data-act="contacted" data-id="${donor.id}">${t("call")}</a>
            ${upiBtn}
            <button class="btn" data-act="fu-update" data-id="${donor.id}">${t("update")}</button>
            <button class="btn primary" data-act="collect" data-id="${donor.id}">${t("paidBtn")}</button>`;
    } else {
        actions = `
            <button class="btn" data-act="edit-donor" data-id="${donor.id}">${t("addNumber")}</button>
            ${upiBtn}
            <button class="btn" data-act="fu-update" data-id="${donor.id}">${t("update")}</button>
            <button class="btn primary" data-act="collect" data-id="${donor.id}">${t("paidBtn")}</button>`;
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

const msgKey = base => state.settings.msgLang === "en" ? base : base + "Or";

function reminderMessage(donor) {
    const last = lastGift(donor);
    const fu = followup(donor);
    return fillTemplate(state.settings[msgKey("waReminder")], {
        name: donor.name,
        year: year(),
        last: last ? last.amount.toLocaleString("en-IN") : "",
        member: state.me.name || "",
        paylink: payLink(donor.name, fu.promised),
        upi: state.settings.upiId || ""
    });
}

function thanksMessage(donor, amount, member, receiptNo) {
    if (receiptNo === undefined) {
        const latest = state.collections.find(c => c.donorId === donor.id);
        receiptNo = latest ? latest.receiptNo : "";
    }
    return fillTemplate(state.settings[msgKey("waThanks")], {
        name: donor.name,
        year: year(),
        amount: Number(amount).toLocaleString("en-IN"),
        receipt: receiptLabel(receiptNo),
        member: member || state.me.name || "",
        upi: state.settings.upiId || ""
    });
}

// --- Entries ---

const ENTRY_TABS = [["collections", "tabCollections"], ["expenses", "tabExpenses"], ["moves", "tabMoves"]];

function viewEntries() {
    const tab = state.entriesTab;
    const total = tab === "moves" ? null : sum(state[tab]);
    return `
        <div class="view-head">
            <h1>${t("navEntries")}</h1>
            ${total !== null ? `<p class="muted">${countEntries(state[tab].length)} · ${rs(total)}</p>` : ""}
        </div>
        <div class="segmented">
            ${ENTRY_TABS.map(([key, label]) =>
                `<button data-act="entries-tab" data-tab="${key}" aria-pressed="${tab === key}">${t(label)}</button>`).join("")}
        </div>
        ${searchBox("entries", t("search"))}
        <div id="list" class="entries">${entriesList()}</div>`;
}

function entriesList() {
    const term = searchTerm("entries");
    const tab = state.entriesTab;
    const match = (...fields) => !term || fields.some(f => nameKey(f).includes(term));

    let rows = [];
    if (tab === "collections") {
        rows = state.collectionsAll
            .filter(c => !c.deleted || c.receiptNo) // cancelled receipts stay visible so numbers have no gaps
            .filter(c => match(c.donorName, memberName(c.collectedBy), c.note, receiptLabel(c.receiptNo)))
            .map(collectionRow);
    } else if (tab === "expenses") {
        rows = state.expenses
            .filter(e => match(e.category, e.item, memberName(e.paidBy), e.note))
            .map(e => entryRow(e.item || e.category,
                `${fmtDate(e.date)} · ${esc(e.category)} · ${t("paidBy", { name: esc(memberName(e.paidBy)) })}`,
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
    return rows.length ? rows.join("") : `<div class="empty">${t("noEntries")}</div>`;
}

const moveFromName = from => from === "opening" ? t("lastYearBalance", { year: prevYear() }) : memberName(from);

// --- More ---

function menuItem(href, title, sub, act, extra = "") {
    const open = act ? `button data-act="${act}" ${extra}` : `a href="${href}"`;
    return `
        <${open} class="menu-item">
            <span><b>${title}</b><span class="muted small">${sub}</span></span>${icon("chevron")}
        </${act ? "button" : "a"}>`;
}

function viewMore() {
    const done = state.tasks.filter(task => task.done).length;
    const due = state.vendors.reduce((total, v) => total + vendorStatus(v).due, 0);
    const pastYears = Object.keys(PAST).join(", ");
    return `
        <div class="view-head row-between">
            <h1>${t("moreTitle")}</h1>
            ${langSwitch()}
        </div>
        <div class="menu">
            ${menuItem("#tasks", t("mChecklist"), t("mChecklistSub", { done, total: state.tasks.length }))}
            ${menuItem("#spending", t("mSpending"), t("mSpendingSub", { due: rs(due) }))}
            ${menuItem("#donors", t("mDonors"), t("mDonorsSub", { n: state.donors.length, p: state.donors.filter(d => d.phone).length }))}
        </div>
        <div class="menu">
            ${menuItem("#members", t("mMembers"), t("mMembersSub", { n: state.members.length }))}
            ${menuItem("#settings", t("mSettings"), t("mSettingsSub", { year: esc(year()) }))}
            ${menuItem("#export", t("mExport"), t("mExportSub"))}
            ${menuItem("", t("mImport"), t("mImportSub", { years: pastYears }), "import-past")}
        </div>
        <div class="menu">
            ${menuItem("", t("signOut"), esc(state.user.email), "signout")}
        </div>`;
}

// --- Checklist ---

function viewTasks() {
    const now = today();
    const open = state.tasks.filter(task => !task.done);
    const sortDue = (a, b) => (a.due || "9999").localeCompare(b.due || "9999") || (a.order || 0) - (b.order || 0);
    const overdue = open.filter(task => task.due && task.due < now).sort(sortDue);
    const upcoming = open.filter(task => !task.due || task.due >= now).sort(sortDue);
    const done = state.tasks.filter(task => task.done).sort(sortDue);

    const group = (title, list, cls = "") => list.length ? `
        <h2 class="group-title ${cls}">${title} · ${list.length}</h2>
        <div class="tasks">${list.map(taskRow).join("")}</div>` : "";

    return `
        <div class="view-head">
            <a href="#more" class="back">${t("back")}</a>
            <h1>${t("checklistTitle")}</h1>
            ${state.tasks.length ? `<p class="muted">${t("tasksDone", { done: done.length, total: state.tasks.length })}</p>` : ""}
        </div>
        <div class="btn-row">
            <button class="btn primary" data-act="new-task">${t("addTask")}</button>
            ${state.tasks.length ? "" : `<button class="btn" data-act="seed-tasks">${t("seedTasks")}</button>`}
        </div>
        ${!state.tasks.length && !state.settings.pujaDate ? `<p class="hint">${t("seedNeedsDate")}</p>` : ""}
        ${state.tasks.length ? "" : `<div class="empty">${t("noTasks")}</div>`}
        ${group(t("overdue"), overdue, "neg")}
        ${group(t("upcoming"), upcoming)}
        ${group(t("doneTasks"), done)}`;
}

function taskRow(task) {
    const sub = [
        task.due ? t("dueOn", { date: fmtDate(task.due) }) : "",
        task.assignedTo ? esc(memberName(task.assignedTo)) : "",
        task.category ? esc(task.category) : ""
    ].filter(Boolean).join(" · ");
    return `
        <div class="task ${task.done ? "done" : ""}">
            <button class="check" data-act="task-toggle" data-id="${task.id}" aria-pressed="${!!task.done}" aria-label="${t("markDone")}">${icon("check")}</button>
            <button class="task-main" data-act="edit-task" data-id="${task.id}">
                <span class="entry-title">${esc(task.title)}</span>
                ${sub ? `<span class="entry-sub">${sub}</span>` : ""}
            </button>
        </div>`;
}

// --- Vendors & budget ---

function viewSpending() {
    const cats = categories();
    const totalBudget = Object.values(state.budget).reduce((a, b) => a + (Number(b) || 0), 0);
    const spent = sum(state.expenses);
    const hasPast = Boolean(PAST[prevYear()]);

    const catRows = cats.map(category => {
        const catSpent = sum(state.expenses.filter(e => e.category === category));
        const budget = Number(state.budget[category]) || 0;
        const last = pastCategoryTotal(prevYear(), category);
        const pct = budget ? Math.min(100, (catSpent / budget) * 100) : 0;
        const over = budget && catSpent > budget;
        return `
            <button class="budget-row" data-act="edit-budget" data-category="${esc(category)}">
                <span class="row-between">
                    <b>${esc(category)}</b>
                    <span>${rs(catSpent)} / ${budget ? rs(budget) : `<span class="muted">${t("noBudget")}</span>`}</span>
                </span>
                <span class="bar ${over ? "over" : ""}"><span style="width:${over ? 100 : pct}%"></span></span>
                <span class="row-between small muted">
                    <span>${last ? t("lastYearAmt", { year: prevYear(), amount: rs(last) }) : ""}</span>
                    <span class="${over ? "neg" : ""}">${over ? t("overBudget", { amount: rs(catSpent - budget) }) : ""}</span>
                </span>
            </button>`;
    }).join("");

    const vendorRows = state.vendors.map(v => {
        const st = vendorStatus(v);
        return `
            <button class="entry" data-act="edit-vendor" data-id="${v.id}">
                <span class="entry-main">
                    <span class="entry-title">${esc(v.name)}</span>
                    <span class="entry-sub">${esc(v.category || "")} · ${t("paidOfTotal", { paid: rs(st.paid), total: rs(st.total) })}</span>
                </span>
                ${st.due > 0
                    ? `<span class="badge overdue">${t("due", { amount: rs(st.due) })}</span>`
                    : `<span class="badge paid">${t("paidInFull")}</span>`}
            </button>`;
    }).join("");

    return `
        <div class="view-head">
            <a href="#more" class="back">${t("back")}</a>
            <h1>${t("spendingTitle")}</h1>
        </div>

        <div class="panel">
            <div class="row-between"><h2>${t("vendors")}</h2><button class="btn small primary" data-act="new-vendor">${t("addVendor")}</button></div>
            <p class="hint">${t("vendorsHint")}</p>
            ${vendorRows || `<p class="muted">${t("noVendors")}</p>`}
        </div>

        <div class="panel">
            <h2>${t("budget")}</h2>
            <p class="muted small">${t("spentOfBudget", { spent: rs(spent), budget: rs(totalBudget) })}</p>
            ${hasPast ? `<button class="btn small" data-act="budget-from-last">${t("useLastYear", { year: prevYear() })}</button>` : ""}
            <div class="budget-list">${catRows}</div>
        </div>`;
}

// --- Donors, members, settings, export ---

function viewDonors() {
    return `
        <div class="view-head">
            <a href="#more" class="back">${t("back")}</a>
            <h1>${t("donorsTitle")}</h1>
        </div>
        <div class="btn-row">
            <button class="btn primary" data-act="edit-donor">${t("addDonor")}</button>
            <button class="btn" data-act="paste-numbers">${t("pasteNumbers")}</button>
        </div>
        ${searchBox("donors", t("searchDonor"))}
        <div id="list" class="entries">${donorsList()}</div>`;
}

function donorsList() {
    const term = searchTerm("donors");
    const donors = state.donors
        .filter(d => !term || nameKey(d.name).includes(term) || digits(d.phone).includes(term.replace(/\D/g, "") || "x"))
        .sort((a, b) => a.name.localeCompare(b.name));
    if (!donors.length) return `<div class="empty">${t("noDonorsFound")}</div>`;
    return donors.map(d => {
        const last = lastGift(d);
        return `
            <button class="entry" data-act="edit-donor" data-id="${d.id}">
                <span class="entry-main">
                    <span class="entry-title">${esc(d.name)}</span>
                    <span class="entry-sub">${d.phone ? esc(d.phone) : `<span class="warn">${t("noNumber")}</span>`}</span>
                </span>
                <span class="entry-amount muted">${last ? `${last.year}: ${rs(last.amount)}` : ""}</span>
            </button>`;
    }).join("");
}

function viewMembers() {
    return `
        <div class="view-head">
            <a href="#more" class="back">${t("back")}</a>
            <h1>${t("membersTitle")}</h1>
            <p class="muted">${t("membersSub")}</p>
        </div>
        <div class="panel">
            ${state.members.map(m => `
                <div class="row-between member">
                    <span><b>${esc(m.name)}</b><span class="muted small">${esc(m.id)}</span></span>
                    ${m.id === state.me.id ? `<span class="muted small">${t("you")}</span>` :
                        `<button class="btn small" data-act="remove-member" data-id="${esc(m.id)}">${t("remove")}</button>`}
                </div>`).join("")}
        </div>
        <form class="panel form" data-form="member">
            <h2>${t("addMember")}</h2>
            <label>${t("name")}<input name="name" required placeholder="Kuna Rout"></label>
            <label>${t("memberEmail")}
                <input name="email" required autocapitalize="none" placeholder="name@gmail.com  /  kuna">
            </label>
            <p class="hint">${t("memberIdHint", { domain: ID_DOMAIN })}</p>
            <button class="btn primary block">${t("addMember")}</button>
        </form>`;
}

function viewSettings() {
    const s = state.settings;
    const prev = String(Number(s.year) - 1);
    return `
        <div class="view-head">
            <a href="#more" class="back">${t("back")}</a>
            <h1>${t("settingsTitle")}</h1>
        </div>
        <form class="form" data-form="settings">
            <div class="panel form">
                <label>${t("pujaYearLabel")}<input name="year" inputmode="numeric" pattern="\\d{4}" value="${esc(s.year)}" required></label>
                <label>${t("pujaDate")}<input name="pujaDate" type="date" value="${esc(s.pujaDate)}"></label>
                <p class="hint">${t("pujaDateHint")}</p>
                <label>${t("openingBalance")}
                    <input name="openingBalance" type="number" inputmode="numeric" value="${esc(s.openingBalance)}">
                </label>
                ${PAST[prev] ? `<p class="hint">${t("websiteShows", { amount: rs(pastClosing(prev)), year: prev })}</p>` : ""}
            </div>

            <div class="panel form">
                <h2>${t("upiSection")}</h2>
                <label>${t("upiId")}<input name="upiId" autocapitalize="none" placeholder="kartikeswarpuja@sbi" value="${esc(s.upiId)}"></label>
                <p class="hint">${t("upiIdHint")}</p>
                <label>${t("upiName")}<input name="upiName" value="${esc(s.upiName)}"></label>
                <label>${t("qrImage")}<input name="qrFile" type="file" accept="image/*"></label>
                <p class="hint">${t("qrUploadHint")}</p>
                <div class="qr-preview" id="qr-preview">${qrPreview()}</div>
            </div>

            <div class="panel form">
                <h2>${t("messages")}</h2>
                <label>${t("msgLanguage")}
                    <select name="msgLang">
                        <option value="or" ${s.msgLang !== "en" ? "selected" : ""}>${t("odia")}</option>
                        <option value="en" ${s.msgLang === "en" ? "selected" : ""}>${t("english")}</option>
                    </select>
                </label>
                <details>
                    <summary>${t("odia")}</summary>
                    <label>${t("reminderMsg")}<textarea name="waReminderOr" rows="9">${esc(s.waReminderOr)}</textarea></label>
                    <label>${t("thanksMsg")}<textarea name="waThanksOr" rows="8">${esc(s.waThanksOr)}</textarea></label>
                </details>
                <details>
                    <summary>${t("english")}</summary>
                    <label>${t("reminderMsg")}<textarea name="waReminder" rows="9">${esc(s.waReminder)}</textarea></label>
                    <label>${t("thanksMsg")}<textarea name="waThanks" rows="8">${esc(s.waThanks)}</textarea></label>
                </details>
                <p class="hint">${t("msgHint")}</p>
                <button type="button" class="btn small" data-act="reset-messages">${t("resetMessages")}</button>
            </div>

            <button class="btn primary block">${t("saveSettings")}</button>
        </form>`;
}

function qrPreview() {
    const image = state.pendingQr !== undefined ? state.pendingQr : state.publicPay.qrImage;
    return image ? `
        <img src="${esc(image)}" alt="UPI QR">
        <button type="button" class="btn small danger" data-act="remove-qr">${t("removeQr")}</button>` : "";
}

// Shrink an image so it fits in one database document (max 1 MB).
// Photos are kept in the database because Firebase file storage needs a paid plan.
function shrinkImage(file, maxSide, sharp) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let side = maxSide;
            let data = "";
            for (let attempt = 0; attempt < 4; attempt++) {
                const scale = Math.min(1, side / Math.max(img.width, img.height));
                const canvas = document.createElement("canvas");
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                const ctx = canvas.getContext("2d");
                ctx.fillStyle = "#fff";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                data = sharp ? canvas.toDataURL("image/png") : "";
                if (!data || data.length > 600000) data = canvas.toDataURL("image/jpeg", sharp ? 0.9 : 0.7);
                if (data.length < 600000) break;
                side = Math.round(side * 0.75);
            }
            resolve(data);
        };
        img.onerror = reject;
        img.src = url;
    });
}

const readQrImage = file => shrinkImage(file, 900, true);

// --- Photos on collections (payment screenshot) and expenses (bill / receipt) ---

function resetPhoto(entry) {
    state.pendingPhoto = undefined;
    state.photoEntry = entry || null;
}

function photoField(labelKey) {
    return `
        <div class="photo-field">
            <span class="field-label">${t(labelKey)}</span>
            <div id="photo-pick">${photoPicker()}</div>
        </div>`;
}

function photoPicker() {
    const pick = `
        <label class="pick-btn"><input type="file" accept="image/*" capture="environment" data-photo hidden>${icon("camera")} ${t("takePhoto")}</label>
        <label class="pick-btn"><input type="file" accept="image/*" data-photo hidden>${t("choosePhoto")}</label>`;
    if (state.pendingPhoto) {
        return `
            <div class="photo-row">
                <img class="photo-thumb" src="${state.pendingPhoto}" alt="">
                <button type="button" class="btn small danger" data-act="remove-photo">${t("removePhoto")}</button>
            </div>`;
    }
    const entry = state.photoEntry;
    if (entry && entry.hasPhoto && state.pendingPhoto === undefined) {
        return `
            <div class="photo-row">
                <button type="button" class="btn small" data-act="view-photo" data-kind="${entry.kind}" data-id="${entry.id}">${icon("camera")} ${t("viewPhoto")}</button>
                <button type="button" class="btn small danger" data-act="remove-photo">${t("removePhoto")}</button>
            </div>`;
    }
    return `<div class="photo-row">${pick}</div>`;
}

const photoRef = (kind, entryId) => doc(db, yearPath("photos"), `${kind}-${entryId}`);

// Saves (or removes) the picked photo; returns the field to store on the entry
function savePhoto(kind, entryId) {
    if (state.pendingPhoto === undefined) return {};
    if (state.pendingPhoto) {
        commit(setDoc(photoRef(kind, entryId), { data: state.pendingPhoto, kind, entryId, ...stamp(true) }));
        return { hasPhoto: true };
    }
    commit(setDoc(photoRef(kind, entryId), { data: "", deleted: true, ...stamp(false) }, { merge: true }));
    return { hasPhoto: false };
}

function showPhoto(kind, entryId) {
    getDoc(photoRef(kind, entryId)).then(snap => {
        const data = snap.exists() ? snap.data().data : "";
        if (!data) return toast(t("photoOffline"));
        const viewer = document.createElement("div");
        viewer.className = "photo-viewer";
        viewer.innerHTML = `<img src="${data}" alt=""><button class="icon-btn" aria-label="${t("close")}">×</button>`;
        viewer.addEventListener("click", () => viewer.remove());
        document.body.appendChild(viewer);
    }, () => toast(t("photoOffline")));
}

function viewExport() {
    const item = (kind, title, sub) => menuItem("", title, sub, "export", `data-kind="${kind}"`);
    return `
        <div class="view-head">
            <a href="#more" class="back">${t("back")}</a>
            <h1>${t("exportTitle")}</h1>
            <p class="muted">${t("exportSub")}</p>
        </div>
        <div class="menu">
            ${item("collections", t("tabCollections"), countEntries(state.collectionsAll.length))}
            ${item("expenses", t("tabExpenses"), countEntries(state.expenses.length))}
            ${item("moves", t("tabMoves"), countEntries(state.moves.length))}
            ${item("vendors", t("exVendors"), String(state.vendors.length))}
            ${item("donors", t("exDonors"), String(state.donors.length))}
            ${item("website", t("exWebsite"), t("exWebsiteSub"))}
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
                <button class="icon-btn" data-act="close-sheet" aria-label="${t("close")}">×</button>
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
    resetPhoto();
    pushAfterBack = false;
    $("#sheet-root").innerHTML = "";
    document.body.classList.remove("no-scroll");
    if (!fromBackButton) {
        backPending = true;
        history.back();
    }
}

const memberOptions = (selected, withBank) =>
    (withBank ? `<option value="${BANK}" ${selected === BANK ? "selected" : ""}>${t("bankAccount")}</option>` : "") +
    state.members.map(m => `<option value="${esc(m.id)}" ${m.id === selected ? "selected" : ""}>${esc(m.name)}</option>`).join("");

const deleteButton = (kind, id, label = t("deleteEntry")) =>
    `<button type="button" class="btn danger block" data-act="delete-entry" data-kind="${kind}" data-id="${id}">${label}</button>`;

function openAddChooser() {
    const choice = (act, title, sub) => `<button class="choice" data-act="${act}"><b>${t(title)}</b><span>${t(sub)}</span></button>`;
    openSheet(t("add"), `
        <div class="chooser">
            ${choice("new-collection", "chCollection", "chCollectionSub")}
            ${choice("new-expense", "chExpense", "chExpenseSub")}
            ${choice("new-move", "chMove", "chMoveSub")}
            ${choice("new-task", "chTask", "chTaskSub")}
        </div>`);
}

function openCollectionSheet({ entry, donorId } = {}) {
    resetPhoto(entry && { kind: "collections", ...entry });
    const donor = donorById(entry ? entry.donorId : donorId);
    const fu = donor ? followup(donor) : {};
    const receipt = entry && entry.receiptNo ? receiptLabel(entry.receiptNo) : "";
    openSheet(entry ? `${t("editCollection")}${receipt ? " · " + receipt : ""}` : t("newCollection"), `
        <form class="form" data-form="collection" data-id="${entry ? entry.id : ""}">
            <label>${t("donorName")}
                <input name="donor" list="donor-names" required autocomplete="off" value="${esc(donor ? donor.name : entry ? entry.donorName : "")}">
            </label>
            <datalist id="donor-names">${state.donors.map(d => `<option value="${esc(d.name)}">`).join("")}</datalist>
            <label>${t("phoneOptional")}<input name="phone" type="tel" inputmode="tel" value="${esc(donor ? donor.phone : "")}"></label>
            <label>${t("amount")}
                <input name="amount" type="number" inputmode="numeric" min="1" required value="${esc(entry ? entry.amount : fu.promised || "")}">
            </label>
            <div class="radio-row">
                <label><input type="radio" name="mode" value="cash" ${!entry || entry.mode !== "upi" ? "checked" : ""}> ${t("cash")}</label>
                <label><input type="radio" name="mode" value="upi" ${entry && entry.mode === "upi" ? "checked" : ""}> ${t("upiOnline")}</label>
            </div>
            <label>${t("receivedBy")}<select name="by">${memberOptions(entry ? entry.collectedBy : state.me.id)}</select></label>
            <label>${t("date")}<input name="date" type="date" required value="${esc(entry ? entry.date : today())}"></label>
            <label>${t("note")}<input name="note" value="${esc(entry ? entry.note : "")}" placeholder="${t("optional")}"></label>
            ${photoField("photoCollection")}
            <button class="btn primary block">${entry ? t("saveChanges") : t("saveCollection")}</button>
            ${entry && donor && donor.phone && !entry.deleted ? `
                <a class="btn wa block" href="${esc(waLink(donor.phone, thanksMessage(donor, entry.amount, memberName(entry.collectedBy), entry.receiptNo)))}"
                    target="_blank" rel="noopener">${icon("whatsapp")} ${t("sendReceipt")}</a>` : ""}
            ${entry && !entry.deleted ? deleteButton("collections", entry.id) : ""}
        </form>`);
}

function openExpenseSheet(entry, preset = {}) {
    resetPhoto(entry && { kind: "expenses", ...entry });
    const values = { ...preset, ...(entry || {}) };
    openSheet(entry ? t("editExpense") : t("newExpense"), `
        <form class="form" data-form="expense" data-id="${entry ? entry.id : ""}">
            ${state.vendors.length ? `
            <label>${t("vendorOptional")}
                <select name="vendorId">
                    <option value="">${t("none")}</option>
                    ${state.vendors.map(v => `<option value="${v.id}" ${v.id === values.vendorId ? "selected" : ""}>${esc(v.name)}</option>`).join("")}
                </select>
            </label>` : ""}
            <label>${t("category")}
                <input name="category" list="categories" required autocomplete="off" value="${esc(values.category || "")}">
            </label>
            <datalist id="categories">${categories().map(c => `<option value="${esc(c)}">`).join("")}</datalist>
            <label>${t("item")}<input name="item" required value="${esc(values.item || "")}" placeholder="${t("itemHint")}"></label>
            <label>${t("amount")}<input name="amount" type="number" inputmode="numeric" min="1" required value="${esc(values.amount || "")}"></label>
            <label>${t("whoPaid")}<select name="paidBy">${memberOptions(values.paidBy || state.me.id, true)}</select></label>
            <label>${t("date")}<input name="date" type="date" required value="${esc(values.date || today())}"></label>
            <label>${t("note")}<input name="note" value="${esc(values.note || "")}" placeholder="${t("optional")}"></label>
            ${photoField("photoExpense")}
            <button class="btn primary block">${entry ? t("saveChanges") : t("saveExpense")}</button>
            ${entry ? deleteButton("expenses", entry.id) : ""}
        </form>`);
}

function openMoveSheet(entry) {
    const from = entry ? entry.from : state.me.id;
    openSheet(entry ? t("editMove") : t("chMove"), `
        <form class="form" data-form="move" data-id="${entry ? entry.id : ""}">
            <label>${t("from")}
                <select name="from">
                    <option value="opening" ${from === "opening" ? "selected" : ""}>${t("lastYearMoney", { year: esc(prevYear()) })}</option>
                    ${memberOptions(from, true)}
                </select>
            </label>
            <label>${t("to")}<select name="to">${memberOptions(entry ? entry.to : "", true)}</select></label>
            <label>${t("amount")}<input name="amount" type="number" inputmode="numeric" min="1" required value="${esc(entry ? entry.amount : "")}"></label>
            <label>${t("date")}<input name="date" type="date" required value="${esc(entry ? entry.date : today())}"></label>
            <label>${t("note")}<input name="note" value="${esc(entry ? entry.note : "")}" placeholder="${t("optional")}"></label>
            <button class="btn primary block">${entry ? t("saveChanges") : t("saveMove")}</button>
            ${entry ? deleteButton("moves", entry.id) : ""}
        </form>`);
}

function openFollowupSheet(donorId) {
    const donor = donorById(donorId);
    if (!donor) return;
    const fu = followup(donor);
    const status = fu.status || "pending";
    const option = (value, label) =>
        `<label><input type="radio" name="status" value="${value}" ${status === value ? "checked" : ""}> ${t(label)}</label>`;
    openSheet(donor.name, `
        <form class="form" data-form="followup" data-id="${donor.id}">
            <div class="radio-col">
                ${option("pending", "sNotDecided")}
                ${option("promised", "sPromised")}
                ${option("later", "sLater")}
                ${option("declined", "sDeclined")}
            </div>
            <label>${t("promisedAmount")}<input name="promised" type="number" inputmode="numeric" value="${esc(fu.promised || "")}"></label>
            <label>${t("callOn")}<input name="callOn" type="date" value="${esc(fu.callOn || "")}"></label>
            <label>${t("whoFollows")}
                <select name="assignedTo"><option value="">${t("nobody")}</option>${memberOptions(fu.assignedTo)}</select>
            </label>
            <label>${t("note")}<input name="note" value="${esc(fu.note || "")}" placeholder="${t("fuNoteHint")}"></label>
            <button class="btn primary block">${t("save")}</button>
        </form>`);
}

function openUpiSheet(donorId, amount) {
    const donor = donorById(donorId);
    if (!donor) return;
    if (!hasUpi()) return toast(t("noUpi"));
    const fu = followup(donor);
    const value = amount !== undefined ? amount : (fu.promised || (lastGift(donor) || {}).amount || "");
    const link = payLink(donor.name, value);
    const image = state.publicPay.qrImage;
    openSheet(t("upiTitle"), `
        <div class="upi">
            <p class="upi-for"><b>${esc(donor.name)}</b></p>
            ${image ? `
                <div class="qr qr-image"><img src="${esc(image)}" alt="UPI QR"></div>
                <p class="hint">${t("qrDonorAmount")}</p>` : `
                <form class="form" data-form="upi-amount" data-id="${donor.id}">
                    <label>${t("amount")}<input name="amount" type="number" inputmode="numeric" value="${esc(value)}"></label>
                </form>
                <div class="qr">${qrSvg(upiString(value, `Kartikeswar Puja ${year()} - ${donor.name}`))}</div>`}
            ${state.settings.upiId ? `
                <p class="upi-id">${esc(state.settings.upiId)}</p>
                <button class="btn block" data-act="copy-upi">${t("copyUpi")}</button>` : ""}
            ${donor.phone ? `<a class="btn wa block" href="${esc(waLink(donor.phone, t("payLinkMsg", { name: donor.name, year: year(), paylink: link })))}"
                target="_blank" rel="noopener">${icon("whatsapp")} ${t("sharePayLink")}</a>` : ""}
            <p class="hint">${t("upiScan")}</p>
        </div>`);
}

function openDonorSheet(donorId) {
    const donor = donorById(donorId);
    const history = donor && donor.history ? Object.entries(donor.history).sort() : [];
    openSheet(donor ? t("editDonor") : t("newDonorTitle"), `
        <form class="form" data-form="donor" data-id="${donor ? donor.id : ""}">
            <label>${t("name")}<input name="name" required value="${esc(donor ? donor.name : "")}"></label>
            <label>${t("phone")}<input name="phone" type="tel" inputmode="tel" value="${esc(donor ? donor.phone : "")}" placeholder="${t("phoneHint")}"></label>
            <label>${t("note")}<input name="note" value="${esc(donor ? donor.note : "")}" placeholder="${t("donorNoteHint")}"></label>
            ${history.length ? `<p class="hint">${t("pastGifts", { list: history.map(([y, a]) => `${y} ${rs(a)}`).join(" · ") })}</p>` : ""}
            <button class="btn primary block">${t("saveDonor")}</button>
            ${donor ? `<button type="button" class="btn danger block" data-act="delete-donor" data-id="${donor.id}">${t("deleteDonor")}</button>` : ""}
        </form>`);
}

function openVendorSheet(vendorId) {
    const vendor = vendorById(vendorId);
    const st = vendor ? vendorStatus(vendor) : null;
    openSheet(vendor ? t("editVendor") : t("newVendor"), `
        ${vendor ? `
        <div class="vendor-status">
            <div class="row-between"><span>${t("paidOfTotal", { paid: rs(st.paid), total: rs(st.total) })}</span>
                ${st.due > 0 ? `<b class="neg">${t("due", { amount: rs(st.due) })}</b>` : `<b class="pos">${t("paidInFull")}</b>`}</div>
            <div class="bar"><span style="width:${st.total ? Math.min(100, (st.paid / st.total) * 100) : 0}%"></span></div>
            <h3>${t("payments")}</h3>
            ${st.payments.length ? st.payments.map(e => `
                <div class="row-between small"><span>${fmtDate(e.date)} · ${esc(e.item)} · ${esc(memberName(e.paidBy))}</span><span>${rs(e.amount)}</span></div>`).join("")
                : `<p class="muted small">${t("noPayments")}</p>`}
            <button class="btn primary block" data-act="vendor-pay" data-id="${vendor.id}">${t("recordPayment")}</button>
        </div>` : ""}
        <form class="form" data-form="vendor" data-id="${vendor ? vendor.id : ""}">
            <label>${t("vendorName")}<input name="name" required value="${esc(vendor ? vendor.name : "")}" placeholder="${t("vendorNameHint")}"></label>
            <label>${t("category")}<input name="category" list="categories" required autocomplete="off" value="${esc(vendor ? vendor.category : "")}"></label>
            <datalist id="categories">${categories().map(c => `<option value="${esc(c)}">`).join("")}</datalist>
            <label>${t("agreedTotal")}<input name="total" type="number" inputmode="numeric" required value="${esc(vendor ? vendor.total : "")}"></label>
            <label>${t("phoneOptional")}<input name="phone" type="tel" inputmode="tel" value="${esc(vendor ? vendor.phone : "")}"></label>
            <label>${t("note")}<input name="note" value="${esc(vendor ? vendor.note : "")}" placeholder="${t("optional")}"></label>
            <button class="btn ${vendor ? "" : "primary"} block">${t("saveVendor")}</button>
            ${vendor ? `<button type="button" class="btn danger block" data-act="delete-vendor" data-id="${vendor.id}">${t("deleteVendor")}</button>` : ""}
        </form>`);
}

function openBudgetSheet(category) {
    const last = pastCategoryTotal(prevYear(), category);
    openSheet(t("setBudget", { category }), `
        <form class="form" data-form="budget" data-category="${esc(category)}">
            <label>${t("amount")}<input name="amount" type="number" inputmode="numeric" value="${esc(state.budget[category] || "")}"></label>
            ${last ? `<p class="hint">${t("lastYearAmt", { year: prevYear(), amount: rs(last) })}</p>` : ""}
            <button class="btn primary block">${t("save")}</button>
        </form>`);
}

function openTaskSheet(taskId) {
    const task = state.tasks.find(x => x.id === taskId);
    openSheet(task ? t("editTask") : t("newTask"), `
        <form class="form" data-form="task" data-id="${task ? task.id : ""}">
            <label>${t("taskTitle")}<input name="title" required value="${esc(task ? task.title : "")}"></label>
            <label>${t("taskWho")}
                <select name="assignedTo"><option value="">${t("nobody")}</option>${memberOptions(task ? task.assignedTo : "")}</select>
            </label>
            <label>${t("dueDate")}<input name="due" type="date" value="${esc(task ? task.due : "")}"></label>
            <label>${t("note")}<input name="note" value="${esc(task ? task.note : "")}" placeholder="${t("optional")}"></label>
            <button class="btn primary block">${t("saveTask")}</button>
            ${task ? deleteButton("tasks", task.id, t("deleteTask")) : ""}
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
    openSheet(t("pasteNumbers"), `
        <form class="form" data-form="paste-numbers">
            <p class="hint">${t("pasteHint")}</p>
            <textarea name="lines" rows="8" placeholder="Abaduta Rout, 9876543210">${esc(text)}</textarea>
            ${preview ? `
                <div class="preview">
                    <p>${t("pasteMatched", { n: preview.matched.length })}</p>
                    ${preview.added.length ? `<p>${t("pasteNew", { n: preview.added.length })}</p>
                        <p class="muted small">${preview.added.map(a => esc(a.name)).join(", ")}</p>
                        <p class="hint">${t("pasteFixHint")}</p>` : ""}
                    ${preview.skipped.length ? `<p class="warn small">${t("pasteSkipped", { n: preview.skipped.length, lines: preview.skipped.map(esc).join(" | ") })}</p>` : ""}
                </div>
                <button class="btn primary block" name="confirm" value="1">${t("saveNumbers", { n: preview.matched.length + preview.added.length })}</button>`
            : `<button class="btn primary block">${t("check")}</button>`}
        </form>`);
}

function openSavedSheet(donor, amount, collectorEmail, receiptNo) {
    openSheet(t("saved"), `
        <div class="done">
            <div class="tick">✓</div>
            <h2>${rs(amount)}</h2>
            <p class="muted">${t("fromDonor", { name: esc(donor.name) })}</p>
            ${receiptNo ? `<p class="receipt">${t("receiptNo", { no: receiptLabel(receiptNo) })}</p>` : `<p class="hint">${t("receiptLater")}</p>`}
            ${donor.phone ? `<a class="btn wa block" href="${esc(waLink(donor.phone, thanksMessage(donor, amount, memberName(collectorEmail), receiptNo || "")))}"
                target="_blank" rel="noopener" data-act="close-sheet">${icon("whatsapp")} ${t("sendThanks")}</a>` : ""}
            <button class="btn block" data-act="close-sheet">${t("done")}</button>
        </div>`);
}

// ---------- Saving ----------

const FORMS = {
    login(form) {
        const { id, password } = formValues(form);
        const email = id.includes("@") ? id.trim() : `${id.trim().toLowerCase()}@${ID_DOMAIN}`;
        signInWithEmailAndPassword(auth, email, password).catch(() => toast(t("wrongPassword")));
    },

    async collection(form) {
        const f = formValues(form);
        const amount = Number(f.amount);
        if (!f.donor.trim() || !(amount > 0)) return toast(t("enterDonorAmount"));

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
        const data = {
            donorId: donor.id,
            donorName: donor.name,
            amount,
            mode: f.mode || "cash",
            collectedBy: f.by,
            date: f.date,
            note: f.note.trim()
        };

        if (existingId) {
            Object.assign(data, savePhoto("collections", existingId));
            batch.set(doc(db, yearPath("collections"), existingId), { ...data, ...stamp(false) }, { merge: true });
            commit(batch.commit());
            closeSheet();
            return toast(t("saved"));
        }

        commit(batch.commit());
        const ref = doc(collection(db, yearPath("collections")));
        const entry = { ...data, ...savePhoto("collections", ref.id), ...stamp(true) };
        form.querySelector("button:not([type])").disabled = true;
        let receiptNo = null;
        if (navigator.onLine) {
            try { receiptNo = await saveWithReceipt(ref, entry); } catch (e) { receiptNo = null; }
        }
        // Offline or slow: save without a number; it is numbered automatically once synced.
        // Same document id, so a late transaction and this write never make two entries.
        if (!receiptNo) commit(setDoc(ref, entry, { merge: true }));
        openSavedSheet(donor, amount, f.by, receiptNo);
    },

    expense(form) {
        const f = formValues(form);
        const amount = Number(f.amount);
        if (!(amount > 0)) return toast(t("enterAmount"));
        const existingId = form.dataset.id;
        const ref = existingId ? doc(db, yearPath("expenses"), existingId) : doc(collection(db, yearPath("expenses")));
        commit(setDoc(ref, {
            category: f.category.trim(),
            item: f.item.trim(),
            amount,
            paidBy: f.paidBy,
            vendorId: f.vendorId || "",
            date: f.date,
            note: f.note.trim(),
            ...savePhoto("expenses", ref.id),
            ...stamp(!existingId)
        }, { merge: true }));
        closeSheet();
        toast(existingId ? t("saved") : t("expenseSaved", { amount: rs(amount) }));
    },

    move(form) {
        const f = formValues(form);
        const amount = Number(f.amount);
        if (!(amount > 0)) return toast(t("enterAmount"));
        if (f.from === f.to) return toast(t("sameFromTo"));
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
        toast(t("moveSaved"));
    },

    followup(form) {
        const f = formValues(form);
        const update = {
            status: f.status,
            promised: Number(f.promised) || 0,
            callOn: f.callOn || "",
            assignedTo: f.assignedTo,
            note: f.note.trim(),
            updatedBy: state.me.id
        };
        commit(setDoc(doc(db, "donors", form.dataset.id), { fu: { [year()]: update } }, { merge: true }));
        closeSheet();
        toast(t("updated"));
    },

    donor(form) {
        const f = formValues(form);
        const existingId = form.dataset.id;
        const duplicate = state.donors.find(d => d.id !== existingId && nameKey(d.name) === nameKey(f.name));
        if (duplicate) return toast(t("donorExists", { name: duplicate.name }));
        const ref = existingId ? doc(db, "donors", existingId) : doc(collection(db, "donors"));
        commit(setDoc(ref, {
            name: f.name.trim(),
            phone: digits(f.phone),
            note: f.note.trim(),
            ...(existingId ? stamp(false) : { history: {}, ...stamp(true) })
        }, { merge: true }));
        closeSheet();
        toast(t("donorSaved"));
    },

    vendor(form) {
        const f = formValues(form);
        const existingId = form.dataset.id;
        const ref = existingId ? doc(db, yearPath("vendors"), existingId) : doc(collection(db, yearPath("vendors")));
        commit(setDoc(ref, {
            name: f.name.trim(),
            category: f.category.trim(),
            total: Number(f.total) || 0,
            phone: digits(f.phone),
            note: f.note.trim(),
            ...stamp(!existingId)
        }, { merge: true }));
        closeSheet();
        toast(t("saved"));
    },

    budget(form) {
        const amount = Number(form.elements.amount.value) || 0;
        commit(setDoc(doc(db, yearPath("meta"), "budget"),
            { categories: { [form.dataset.category]: amount }, ...stamp(false) }, { merge: true }));
        closeSheet();
        toast(t("budgetSaved"));
    },

    task(form) {
        const f = formValues(form);
        const existingId = form.dataset.id;
        const ref = existingId ? doc(db, yearPath("tasks"), existingId) : doc(collection(db, yearPath("tasks")));
        const data = {
            title: f.title.trim(),
            assignedTo: f.assignedTo,
            due: f.due || "",
            note: f.note.trim(),
            ...stamp(!existingId)
        };
        if (!existingId) Object.assign(data, { done: false, order: state.tasks.length + 1 });
        commit(setDoc(ref, data, { merge: true }));
        closeSheet();
        toast(t("saved"));
    },

    "upi-amount"(form) {
        openUpiSheet(form.dataset.id, form.elements.amount.value);
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
        toast(t("numbersSaved", { n: preview.matched.length + preview.added.length }));
    },

    member(form) {
        formDirty = false;
        const f = formValues(form);
        let email = f.email.trim().toLowerCase();
        if (!email.includes("@")) email = `${email}@${ID_DOMAIN}`;
        commit(setDoc(doc(db, "members", email), { name: f.name.trim(), ...stamp(true) }));
        form.reset();
        toast(t("memberAdded", { name: f.name.trim() }));
    },

    settings(form) {
        const f = formValues(form);
        const upiId = f.upiId.trim();
        const upiName = f.upiName.trim() || DEFAULT_SETTINGS.upiName;
        const batch = writeBatch(db);
        batch.set(doc(db, "settings", "app"), {
            year: f.year.trim(),
            pujaDate: f.pujaDate || "",
            openingBalance: Number(f.openingBalance) || 0,
            upiId,
            upiName,
            msgLang: f.msgLang,
            waReminder: f.waReminder,
            waThanks: f.waThanks,
            waReminderOr: f.waReminderOr,
            waThanksOr: f.waThanksOr,
            ...stamp(false)
        }, { merge: true });
        commit(batch.commit());
        // The public pay page can read only this document. Saved separately so the
        // settings above still save if the database rules have not been updated yet.
        const pay = { upiId, upiName };
        if (state.pendingQr !== undefined) pay.qrImage = state.pendingQr;
        commit(setDoc(doc(db, "public", "pay"), pay, { merge: true }));
        state.pendingQr = undefined;
        formDirty = false;
        toast(t("settingsSaved"));
    }
};

// ---------- Buttons ----------

const ACTIONS = {
    "close-sheet": () => closeSheet(),
    "add": openAddChooser,
    "new-collection": () => openCollectionSheet(),
    "new-expense": () => openExpenseSheet(),
    "new-move": () => openMoveSheet(),
    "new-task": () => openTaskSheet(),
    "new-vendor": () => openVendorSheet(),
    "collect": (el, id) => openCollectionSheet({ donorId: id }),
    "fu-update": (el, id) => openFollowupSheet(id),
    "upi-qr": (el, id) => openUpiSheet(id),
    "edit-donor": (el, id) => openDonorSheet(id),
    "paste-numbers": () => openPasteNumbersSheet(),
    "edit-collection": (el, id) => openCollectionSheet({ entry: state.collectionsAll.find(c => c.id === id) }),
    "edit-expense": (el, id) => openExpenseSheet(state.expenses.find(e => e.id === id)),
    "edit-move": (el, id) => openMoveSheet(state.moves.find(m => m.id === id)),
    "edit-vendor": (el, id) => openVendorSheet(id),
    "edit-budget": el => openBudgetSheet(el.dataset.category),
    "edit-task": (el, id) => openTaskSheet(id),

    "vendor-pay": (el, id) => {
        const vendor = vendorById(id);
        const st = vendorStatus(vendor);
        openExpenseSheet(null, {
            vendorId: vendor.id,
            category: vendor.category,
            item: t("paymentItem", { vendor: vendor.name }),
            amount: st.due || ""
        });
    },

    "contacted": (el, id) => {
        const fu = followup(donorById(id) || {});
        const update = { contactedAt: today(), contactedBy: state.me.id };
        if (!fu.assignedTo) update.assignedTo = state.me.id;
        commit(setDoc(doc(db, "donors", id), { fu: { [year()]: update } }, { merge: true }));
    },

    "task-toggle": (el, id) => {
        const task = state.tasks.find(x => x.id === id);
        if (!task) return;
        const done = !task.done;
        commit(setDoc(doc(db, yearPath("tasks"), id),
            { done, doneBy: done ? state.me.id : "", doneAt: done ? today() : "", ...stamp(false) }, { merge: true }));
    },

    "seed-tasks": () => {
        if (!confirm(t("seedConfirm", { n: DEFAULT_TASKS.length }))) return;
        const batch = writeBatch(db);
        DEFAULT_TASKS.forEach((task, i) => batch.set(doc(collection(db, yearPath("tasks"))), {
            title: lang === "or" ? task.or : task.en,
            category: task.category,
            due: state.settings.pujaDate ? addDays(state.settings.pujaDate, -task.days) : "",
            assignedTo: "",
            note: "",
            done: false,
            order: i + 1,
            ...stamp(true)
        }));
        commit(batch.commit());
        toast(t("tasksAdded", { n: DEFAULT_TASKS.length }));
    },

    "budget-from-last": () => {
        if (!confirm(t("confirmUseLastYear", { year: prevYear() }))) return;
        const cats = {};
        (PAST[prevYear()].expenditure || []).forEach(c => cats[c.category] = c.total);
        commit(setDoc(doc(db, yearPath("meta"), "budget"), { categories: cats, ...stamp(false) }, { merge: true }));
        toast(t("budgetSaved"));
    },

    "delete-entry": (el, id) => {
        if (!confirm(t("confirmDelete"))) return;
        commit(setDoc(doc(db, yearPath(el.dataset.kind), id),
            { deleted: true, deletedBy: state.me.id, deletedAt: serverTimestamp() }, { merge: true }));
        closeSheet();
        toast(t("deleted"));
    },

    "delete-vendor": (el, id) => {
        if (state.expenses.some(e => e.vendorId === id)) return toast(t("vendorHasPayments"));
        if (!confirm(t("confirmDelete"))) return;
        commit(setDoc(doc(db, yearPath("vendors"), id),
            { deleted: true, deletedBy: state.me.id, deletedAt: serverTimestamp() }, { merge: true }));
        closeSheet();
    },

    "delete-donor": (el, id) => {
        if (state.collections.some(c => c.donorId === id)) return toast(t("donorHasCollections"));
        if (!confirm(t("confirmDeleteDonor"))) return;
        commit(deleteDoc(doc(db, "donors", id)));
        closeSheet();
    },

    "remove-member": (el, id) => {
        if (!confirm(t("confirmRemove", { name: memberName(id) }))) return;
        commit(deleteDoc(doc(db, "members", id)));
    },

    "reset-messages": el => {
        if (!confirm(t("confirmReset"))) return;
        const form = el.closest("form");
        Object.entries(DEFAULT_MESSAGES).forEach(([key, text]) => form.elements[key].value = text);
    },

    "remove-photo": () => {
        state.pendingPhoto = "";
        $("#photo-pick").innerHTML = photoPicker();
    },

    "view-photo": el => showPhoto(el.dataset.kind, el.dataset.id),

    "remove-qr": () => {
        state.pendingQr = "";
        formDirty = true;
        $("#qr-preview").innerHTML = "";
    },

    "copy-upi": () => {
        const copy = navigator.clipboard ? navigator.clipboard.writeText(state.settings.upiId) : Promise.reject();
        copy.then(() => toast(t("copied")), () => toast(state.settings.upiId));
    },

    "fu-filter": el => {
        state.fuFilter = el.dataset.filter;
        render();
    },

    "fu-filter-go": el => {
        state.fuFilter = el.dataset.filter;
    },

    "entries-tab": el => {
        state.entriesTab = el.dataset.tab;
        render();
    },

    "lang": el => setLang(el.dataset.lang),

    "import-past": () => {
        const years = Object.keys(PAST);
        if (!years.length) return toast(t("noPast"));
        if (!confirm(t("importConfirm", { years: years.join(", ") }))) return;
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
        toast(t("imported", { added, updated }));
    },

    "export": el => exportData(el.dataset.kind),

    "google-login": () => {
        signInWithPopup(auth, new GoogleAuthProvider()).catch(err => {
            if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") return;
            toast(t("googleFailed"));
        });
    },

    "signout": () => {
        if (confirm(t("confirmSignOut"))) signOut(auth);
    }
};

function exportData(kind) {
    const y = year();
    if (kind === "collections") {
        download(`collections-${y}.csv`, toCsv([
            ["Receipt", "Date", "Donor", "Amount", "Mode", "Received by", "Status", "Photo", "Note"],
            ...state.collectionsAll.slice().sort((a, b) => (a.receiptNo || 1e9) - (b.receiptNo || 1e9)).map(c => [
                receiptLabel(c.receiptNo), c.date, c.donorName, c.amount, c.mode === "upi" ? "UPI" : "Cash",
                memberName(c.collectedBy), c.deleted ? "Cancelled" : "", c.hasPhoto ? "Yes" : "", c.note
            ])
        ]));
    } else if (kind === "expenses") {
        download(`expenses-${y}.csv`, toCsv([
            ["Date", "Category", "Item", "Amount", "Paid by", "Vendor", "Bill photo", "Note"],
            ...state.expenses.map(e => [e.date, e.category, e.item, e.amount, memberName(e.paidBy),
                (vendorById(e.vendorId) || {}).name || "", e.hasPhoto ? "Yes" : "", e.note])
        ]));
    } else if (kind === "moves") {
        download(`cash-handovers-${y}.csv`, toCsv([
            ["Date", "From", "To", "Amount", "Note"],
            ...state.moves.map(m => [m.date, moveFromName(m.from), memberName(m.to), m.amount, m.note])
        ]));
    } else if (kind === "vendors") {
        download(`vendors-${y}.csv`, toCsv([
            ["Vendor", "Category", "Agreed total", "Paid", "Due", "Phone", "Note"],
            ...state.vendors.map(v => {
                const st = vendorStatus(v);
                return [v.name, v.category, st.total, st.paid, st.due, v.phone, v.note];
            })
        ]));
    } else if (kind === "donors") {
        const years = [...new Set(state.donors.flatMap(d => Object.keys(d.history || {})))].sort();
        const paid = paidMap();
        download("donors.csv", toCsv([
            ["Name", "Phone", ...years, y, "Status", "Promised", "Note"],
            ...state.donors.slice().sort((a, b) => a.name.localeCompare(b.name)).map(d => [
                d.name, d.phone, ...years.map(yr => (d.history || {})[yr] || ""), paid.get(d.id) || "",
                followup(d).status || "", followup(d).promised || "", d.note
            ])
        ]));
    } else if (kind === "website") {
        // Same shape as pujaData in data.js, ready to paste in when publishing the accounts
        const donations = new Map();
        state.collections.forEach(c => donations.set(c.donorName, (donations.get(c.donorName) || 0) + Number(c.amount)));
        const cats = new Map();
        state.expenses.forEach(e => {
            const items = cats.get(e.category) || new Map();
            items.set(e.item, (items.get(e.item) || 0) + Number(e.amount));
            cats.set(e.category, items);
        });
        const data = {
            [y]: {
                donations: [...donations].sort((a, b) => a[0].localeCompare(b[0])).map(([name, amount]) => ({ name, amount })),
                expenditure: [...cats].map(([category, items]) => ({
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
    if (e.target.form && e.target.closest("main.view")) formDirty = true;
    const view = e.target.dataset.search;
    if (!view) return;
    state.search[view] = e.target.value;
    renderList();
});

document.addEventListener("change", e => {
    const form = e.target.form;
    if (e.target.hasAttribute("data-photo") && e.target.files[0]) {
        shrinkImage(e.target.files[0], 1280, false).then(data => {
            state.pendingPhoto = data;
            $("#photo-pick").innerHTML = photoPicker();
        }, () => toast(t("photoReadFail")));
        return;
    }
    if (e.target.name === "qrFile" && e.target.files[0]) {
        readQrImage(e.target.files[0]).then(data => {
            state.pendingQr = data;
            formDirty = true;
            $("#qr-preview").innerHTML = qrPreview();
        }, () => toast(t("photoReadFail")));
        return;
    }
    // Fill in the donor's saved number when a known name is picked
    if (e.target.name === "donor" && form && form.elements.phone) {
        const donor = state.donors.find(d => nameKey(d.name) === nameKey(e.target.value));
        if (donor && !form.elements.phone.value) form.elements.phone.value = donor.phone || "";
    }
    // Picking a vendor fills in its category
    if (e.target.name === "vendorId" && form && form.elements.category) {
        const vendor = vendorById(e.target.value);
        if (vendor) form.elements.category.value = vendor.category || "";
    }
    // Changing the amount on the UPI sheet redraws the QR code
    if (e.target.form && e.target.form.dataset.form === "upi-amount") {
        openUpiSheet(form.dataset.id, e.target.value);
    }
});

window.addEventListener("hashchange", () => {
    formDirty = false;
    state.pendingQr = undefined;
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

window.addEventListener("online", () => {
    assignMissingReceipts();
    scheduleRender();
});
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
        state.members = state.donors = state.collectionsAll = state.collections = [];
        state.expenses = state.moves = state.vendors = state.tasks = [];
        state.budget = {};
        if (user && user.email) watchMembership(user);
        else if (user) state.memberStatus = "denied";
        render();
    });
} else {
    render();
}
