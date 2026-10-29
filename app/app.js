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

// ---------- Android app (Capacitor) ----------
// Inside the Android app these native features exist; in a browser Native is null.
const Cap = window.Capacitor;
const isNative = Boolean(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
const Native = isNative ? {
    sms: Cap.registerPlugin("KpSms"),
    widget: Cap.registerPlugin("KpWidget"),
    notifications: Cap.registerPlugin("LocalNotifications")
} : null;

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
    const s = payInfo();
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
    if (payInfo().key) url.searchParams.set("m", payInfo().key);
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
    autoReceiptSms: true,
    smsDailyLimit: 90,
    upiOwner: "",
    nudgeCrowd: true,
    nudgeCommon: true,
    nudgeTier: true,
    tiers: "5001 = Maha Sevak / ମହା ସେବକ\n2001 = Pradhan Sevak / ପ୍ରଧାନ ସେବକ\n1001 = Sevak / ସେବକ",
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
    myPay: {}, // this member's own UPI ID and QR image (public/m-<payKey>), if they added one
    pendingQr: undefined, // QR image chosen in Settings but not saved yet ("" = remove)
    pendingPhoto: undefined, // photo picked in the open collection/expense form ("" = remove)
    photoEntry: null, // the entry that form is editing
    queue: null, // running reminder queue: { ids, index, sent, skipped, sentCurrent }
    smsRun: null, // running SMS batch: { ids, index, sent, failed, stopped, done, limitHit }
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
const prevYear = () => String(Number(year()) - 1);
const yearPath = kind => `years/${year()}/${kind}`;
const donorById = id => state.donors.find(d => d.id === id);
const vendorById = id => state.vendors.find(v => v.id === id);
const BANK = "bank"; // money paid to the main committee QR (it is someone's personal account)
const memberName = email => {
    if (email === BANK) {
        const owner = state.members.find(m => m.id === state.settings.upiOwner);
        return owner ? `${t("bankAccount")} (${owner.name})` : t("bankAccount");
    }
    return (state.members.find(m => m.id === email) || {}).name || email || "";
};

// The UPI this member hands out: their own if they added one, otherwise the main committee QR
function payInfo() {
    const me = state.me || {};
    if (me.payKey && (me.upiId || state.myPay.qrImage)) {
        return { upiId: me.upiId || "", upiName: me.upiName || me.name || "", qrImage: state.myPay.qrImage || "", key: me.payKey };
    }
    return { upiId: state.settings.upiId || "", upiName: state.settings.upiName || "", qrImage: state.publicPay.qrImage || "", key: "" };
}
const hasUpi = () => Boolean(payInfo().upiId || payInfo().qrImage);
// Members whose own UPI can receive money (for "UPI paid into" on a collection)
const ownUpiMembers = () => state.members.filter(m => m.payKey && m.hasOwnUpi);
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
    watchMyPay("");
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
            watchMyPay(state.me.payKey);
            if (state.memberStatus !== "ok") {
                state.memberStatus = "ok";
                startData();
            }
        }
        scheduleRender();
    }, onDataError));
}

// This member's own QR image lives in a public document so the pay page can show it
let myPayKey = "";
let myPayUnsub = null;
function watchMyPay(key) {
    if ((key || "") === myPayKey) return;
    if (myPayUnsub) myPayUnsub();
    myPayUnsub = null;
    myPayKey = key || "";
    state.myPay = {};
    if (!myPayKey) return;
    myPayUnsub = onSnapshot(doc(db, "public", "m-" + myPayKey), snap => {
        state.myPay = snap.exists() ? snap.data() : {};
        scheduleRender();
    }, () => { });
}

function startData() {
    dataUnsubs.push(onSnapshot(collection(db, "members"), snap => {
        state.members = active(toList(snap)).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        scheduleRender();
    }, onDataError));

    dataUnsubs.push(onSnapshot(collection(db, "donors"), snap => {
        const firstLoad = !state.donors.length;
        state.donors = active(toList(snap));
        scheduleRender();
        // The app may have been closed during a call; ask about it once the donors are loaded
        if (firstLoad) setTimeout(checkPendingCall, 800);
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

// Each receipt also gets a public page (receipt.html?r=<token>) that only someone with the
// link can open. The token is long and random, so receipts cannot be guessed or listed.
function newToken() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map(b => (b % 36).toString(36)).join("");
}

const receiptRef = token => doc(db, "receipts", token);
const receiptLink = token => token ? new URL(`../receipt.html?r=${token}`, location.href).toString() : "";

// entry needs its id (and createdAt / receiptNo once saved) so the running total counts only earlier payments
function saveReceiptPage(token, entry, number) {
    const donor = donorById(entry.donorId);
    const given = givenUpTo({ ...entry, receiptNo: number });
    const tier = state.settings.nudgeTier !== false ? tierFor(given) : null;
    commit(setDoc(receiptRef(token), {
        pledge: donor ? pledgeOf(donor).pledge : 0,
        totalGiven: given,
        tierEn: tier ? tier.en : "",
        tierOr: tier ? tier.or : "",
        committee: "Kartikeswar Puja Committee, Karanga",
        year: year(),
        receiptNo: receiptLabel(number),
        name: entry.donorName,
        amount: Number(entry.amount),
        mode: entry.mode === "upi" ? "UPI" : "Cash",
        date: entry.date,
        receivedBy: memberName(entry.collectedBy),
        status: "valid",
        updatedAt: serverTimestamp()
    }, { merge: true }));
}

function saveWithReceipt(ref, data) {
    const token = newToken();
    const attempt = runTransaction(db, async tx => {
        const number = await nextReceipt(tx);
        tx.set(counterRef(), { receipt: number }, { merge: true });
        tx.set(ref, { ...data, receiptNo: number, receiptToken: token });
        return number;
    }).then(number => {
        saveReceiptPage(token, { ...data, id: ref.id }, number);
        return { number, token };
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
            const token = newToken();
            runTransaction(db, async tx => {
                const entry = await tx.get(ref);
                if (!entry.exists() || entry.data().receiptNo) return null;
                const number = await nextReceipt(tx);
                tx.set(counterRef(), { receipt: number }, { merge: true });
                tx.set(ref, { receiptNo: number, receiptToken: token }, { merge: true });
                return number;
            }).then(number => {
                if (!number) return;
                // Entry was saved offline: its receipt page and SMS go out now
                saveReceiptPage(token, c, number);
                const donor = donorById(c.donorId);
                if (donor) sendReceiptSms(donor, c.amount, number, token, givenUpTo({ ...c, receiptNo: number }));
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

// Promised amount vs what has come in so far. A donor counts as paid once the promise is met,
// the promise is closed, or (with no promise) after any payment.
function pledgeOf(donor, paid = paidMap()) {
    const fu = followup(donor);
    const given = paid.get(donor.id) || 0;
    const pledge = Number(fu.promised) || 0;
    const due = fu.closed ? 0 : Math.max(0, pledge - given);
    return { given, pledge, due, closed: Boolean(fu.closed), partial: given > 0 && due > 0, done: given > 0 && due === 0 };
}

// Everyone with promised money still to come, biggest amount first
function pledgesDue() {
    const paid = paidMap();
    return state.donors.map(d => ({ name: d.name, status: followup(d).status, ...pledgeOf(d, paid) }))
        .filter(p => p.due > 0 && (p.status !== "declined" || p.given))
        .sort((a, b) => b.due - a.due);
}

// Total a donor had given up to and including this collection (receipts show the running total)
function givenUpTo(entry) {
    const isNew = !millis(entry.createdAt);
    const earlier = state.collections.filter(c => c.donorId === entry.donorId && c.id !== entry.id && (isNew ||
        (c.receiptNo && entry.receiptNo ? c.receiptNo < entry.receiptNo : millis(c.createdAt) < millis(entry.createdAt))));
    return sum(earlier) + Number(entry.amount || 0);
}

// Donor titles from Settings, e.g. "2001 = Pradhan Sevak / ପ୍ରଧାନ ସେବକ", biggest first
function tierList() {
    return String(state.settings.tiers || "").split("\n").map(line => {
        const match = line.match(/^\s*(\d+)\s*=\s*([^/]+?)\s*(?:\/\s*(.+?))?\s*$/);
        return match && { min: Number(match[1]), en: match[2], or: match[3] || match[2] };
    }).filter(Boolean).sort((a, b) => b.min - a.min);
}
const tierFor = amount => amount > 0 ? tierList().find(tier => amount >= tier.min) || null : null;
const tierText = tier => state.settings.msgLang === "en" ? tier.en : tier.or;

// The amount range most families are giving: middle half of this year's donors (or last year's
// until ten have paid), rounded to the usual donation amounts
const NICE_AMOUNTS = [101, 151, 201, 251, 301, 501, 701, 1001, 1101, 1501, 2001, 2501, 3001, 5001, 10001];
function commonRange() {
    let amounts = [...paidMap().values()];
    if (amounts.length < 10 && PAST[prevYear()]) amounts = PAST[prevYear()].donations.map(d => Number(d.amount));
    amounts = amounts.filter(a => a > 0).sort((a, b) => a - b);
    if (amounts.length < 10) return null;
    const nice = value => NICE_AMOUNTS.reduce((best, a) => Math.abs(a - value) < Math.abs(best - value) ? a : best);
    const at = q => nice(amounts[Math.floor((amounts.length - 1) * q)]);
    return { from: at(0.25), to: at(0.75) };
}

// Message text in the message language (Settings), not the phone's language
function mt(key, vars = {}) {
    const entry = STR[key];
    const text = entry ? entry[state.settings.msgLang === "en" ? 0 : 1] : key;
    return text.replace(/\{(\w+)\}/g, (match, name) => vars[name] !== undefined ? vars[name] : match);
}
const inr = amount => Math.round(Number(amount) || 0).toLocaleString("en-IN");

// Put extra lines just above the pay link (or above the sign-off when there is none)
function withLines(text, lines, anchor) {
    lines = lines.filter(Boolean);
    if (!lines.length) return text;
    const rows = text.split("\n");
    let at = anchor ? rows.findIndex(row => row.includes(anchor)) : -1;
    if (at < 0) {
        const blank = rows.lastIndexOf("");
        at = blank > 0 ? blank : rows.length;
    }
    rows.splice(at, 0, ...lines);
    return rows.join("\n");
}

// Pledge progress, encouragement and title lines for a reminder (WhatsApp gets all, SMS only the pledge)
function reminderLines(donor, forSms) {
    const s = state.settings;
    const p = pledgeOf(donor);
    const lines = [];
    if (p.partial) lines.push(mt("msgPartial", { given: inr(p.given), pledge: inr(p.pledge), due: inr(p.due) }));
    if (forSms) return lines;
    const paid = paidMap();
    if (s.nudgeCrowd !== false && paid.size >= 5) lines.push(mt("msgCrowd", { n: paid.size, total: inr(sum(state.collections)) }));
    if (!p.partial) {
        const base = Math.max(p.pledge, (lastGift(donor) || {}).amount || 0);
        // Only for donors below the usual range; a big donor should not read "most give less"
        const range = s.nudgeCommon !== false && commonRange();
        if (range && base < range.to) lines.push(range.from === range.to
            ? mt("msgCommonOne", { from: inr(range.from) })
            : mt("msgCommon", { from: inr(range.from), to: inr(range.to) }));
        // Suggest the next title above what they promised or gave last year
        const next = s.nudgeTier !== false && base > 0 && tierList().slice().reverse().find(tier => tier.min > base);
        if (next && next.min <= base * 2) lines.push(mt("msgTierNext", { amount: inr(next.min), tier: tierText(next) }));
    }
    return lines;
}

// Running total and title lines for a thank-you / receipt message
function thanksLines(donor, amount, given, forSms) {
    const p = pledgeOf(donor);
    const lines = [];
    if (p.pledge && !p.closed) {
        lines.push(given >= p.pledge
            ? mt("msgPledgeDone", { pledge: inr(p.pledge) })
            : mt("msgPledgeProgress", { given: inr(given), pledge: inr(p.pledge), due: inr(p.pledge - given) }));
    } else if (given > Number(amount)) {
        lines.push(mt("msgTotalGiven", { given: inr(given) }));
    }
    const tier = !forSms && state.settings.nudgeTier !== false && tierFor(given);
    if (tier) lines.push(mt("msgTier", { tier: tierText(tier) }));
    return lines;
}

function totals() {
    const collected = sum(state.collections);
    const spent = sum(state.expenses);
    const opening = Number(state.settings.openingBalance) || 0;
    const fromOpening = sum(state.moves.filter(m => m.from === "opening"));

    const held = new Map();
    const add = (email, amount) => email && email !== "opening" && held.set(email, (held.get(email) || 0) + amount);
    state.collections.forEach(c => add(c.mode === "upi" ? c.upiTo || BANK : c.collectedBy, Number(c.amount)));
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
    const groups = { todo: [], calls: [], promised: [], partial: [], mine: [], fresh: [], paid: [], declined: [] };
    state.donors.forEach(d => {
        const fu = followup(d);
        const p = pledgeOf(d, paid);
        if (p.done) return groups.paid.push(d);
        if (fu.status === "declined" && !p.partial) return groups.declined.push(d);
        groups.todo.push(d);
        if (fu.status === "later" && fu.callOn && fu.callOn <= now) groups.calls.push(d);
        if (p.partial) groups.partial.push(d);
        else if (fu.status === "promised") groups.promised.push(d);
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
    myupi: viewMyUpi,
    export: viewExport
};
const LISTS = { followup: followupList, entries: entriesList, donors: donorsList };
const NAV_PARENT = { tasks: "more", spending: "more", donors: "more", members: "more", settings: "more", myupi: "more", export: "more" };

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
    syncNative();
}

// ---------- Android: home-screen widget and alarms ----------

let widgetTimer = null;
let alarmTimer = null;
let alarmSignature = "";

function syncNative() {
    if (!isNative || state.memberStatus !== "ok") return;
    clearTimeout(widgetTimer);
    widgetTimer = setTimeout(updateWidget, 1500);
    clearTimeout(alarmTimer);
    alarmTimer = setTimeout(scheduleAlarms, 4000);
}

function updateWidget() {
    const now = new Date();
    const { groups } = followupGroups();
    Native.widget.update({
        title: `Kartikeswar Puja ${year()}`,
        today: rs(sum(state.collections.filter(c => c.date === today()))),
        total: rs(totals().collected),
        pending: String(groups.todo.length),
        labelToday: t("wToday"),
        labelTotal: t("wTotal"),
        labelPending: t("wPending"),
        updated: t("wUpdated", { time: now.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) })
    }).catch(() => { });
}

// Stable positive number for a notification id
function alarmId(key) {
    let hash = 0;
    for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    return Math.abs(hash) || 1;
}

const atTime = (iso, time) => new Date(`${iso}T${time || "10:00"}:00`).getTime();

// Call-backs and checklist tasks ring on this phone at the right time, even when the app is closed.
// Items assigned to someone else are left to their phone.
async function scheduleAlarms() {
    const mine = who => !who || who === state.me.id;
    const now = Date.now();
    const paid = paidMap();
    const items = [];
    state.donors.forEach(d => {
        const fu = followup(d);
        if (pledgeOf(d, paid).done || fu.status !== "later" || !fu.callOn || !mine(fu.assignedTo)) return;
        const at = atTime(fu.callOn, fu.callTime);
        if (at > now) items.push({ key: "call-" + d.id, at, title: t("notifCall", { name: d.name }), body: fu.note || (d.phone || ""), hash: "#followup" });
    });
    state.tasks.forEach(task => {
        if (task.done || !task.due || !mine(task.assignedTo)) return;
        const at = atTime(task.due, "09:00");
        if (at > now) items.push({ key: "task-" + task.id, at, title: t("notifTask", { task: task.title }), body: task.note || t("checklist"), hash: "#tasks" });
    });
    items.sort((a, b) => a.at - b.at);
    const chosen = items.slice(0, 40);
    const signature = JSON.stringify(chosen.map(n => [n.key, n.at, n.title, n.body]));
    if (signature === alarmSignature) return;

    try {
        const N = Native.notifications;
        let permission = await N.checkPermissions();
        if (permission.display !== "granted") permission = await N.requestPermissions();
        if (permission.display !== "granted") return;
        let old = [];
        try { old = JSON.parse(localStorage.getItem("kpAlarmIds") || "[]"); } catch (e) { }
        if (old.length) await N.cancel({ notifications: old.map(id => ({ id })) });
        if (chosen.length) {
            await N.schedule({
                notifications: chosen.map(n => ({
                    id: alarmId(n.key),
                    title: n.title,
                    body: n.body,
                    schedule: { at: new Date(n.at), allowWhileIdle: true },
                    smallIcon: "ic_stat_diya",
                    extra: { hash: n.hash }
                }))
            });
        }
        localStorage.setItem("kpAlarmIds", JSON.stringify(chosen.map(n => alarmId(n.key))));
        alarmSignature = signature;
    } catch (e) {
        // Alarms are a convenience; the app works without them
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
    const owed = pledgesDue();

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

        ${activeNowPanel()}

        ${groups.calls.length ? `
        <div class="panel">
            <div class="row-between"><h2>${t("todaysCalls")} · ${groups.calls.length}</h2><a href="#followup" data-act="fu-filter-go" data-filter="calls">${t("seeAll")}</a></div>
            ${groups.calls.slice(0, 5).map(d => `
                <div class="row-between">
                    <span><b>${esc(d.name)}</b>${followup(d).note ? `<span class="muted small block-line">${esc(followup(d).note)}</span>` : ""}</span>
                    ${d.phone ? `<a class="btn small" href="${telLink(d.phone)}" data-act="contacted" data-lead="call" data-id="${d.id}">${t("call")}</a>` : ""}
                </div>`).join("")}
        </div>` : ""}

        <a class="panel link-panel" href="#followup">
            <h2>${t("navFollowup")}</h2>
            <div class="row-between"><span>${t("yetToPay")}</span><b>${groups.todo.length}</b></div>
            <div class="row-between"><span>${t("promisedPending")}</span><b>${rs(sum(owed, "due"))} · ${owed.length}</b></div>
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

function activeNowPanel() {
    const live = state.donors.filter(d => isLive(followup(d).leadAt))
        .sort((a, b) => millis(followup(b).leadAt) - millis(followup(a).leadAt));
    if (!live.length) return "";
    return `
        <div class="panel">
            <h2><span class="live-dot"></span>${t("activeNow")}</h2>
            ${live.slice(0, 5).map(d => `
                <div class="row-between small">
                    <span><b>${esc(d.name)}</b><span class="muted block-line">${leadText(d)}</span></span>
                </div>`).join("")}
        </div>`;
}

// --- Today's summary for the committee WhatsApp group ---

function summaryText() {
    const now = today();
    const tt = totals();
    const todays = state.collections.filter(c => c.date === now);
    const lastYearTotal = PAST[prevYear()] ? sum(PAST[prevYear()].donations) : 0;
    const promised = pledgesDue();

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
        lines.push("", `*${t("sumPromised")}: ${rs(sum(promised, "due"))}*`);
        promised.slice(0, 10).forEach(p => lines.push(`• ${p.name} ` +
            (p.given ? t("sumDue", { due: rs(p.due), pledge: rs(p.pledge) }) : rs(p.due))));
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
    ["partial", "fPartial"],
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
            <p class="muted">${t("donorsPaidOf", { paid: groups.paid.length, total: state.donors.length })}</p>
        </div>
        ${state.donors.length ? `<button class="btn wa block queue-btn" data-act="queue-setup">${icon("whatsapp")} ${t("startReminders")}</button>` : ""}
        ${state.donors.length && isNative ? `<button class="btn block queue-btn" data-act="sms-setup">${t("smsReminders")}</button>` : ""}
        ${searchBox("followup", t("searchName"))}
        <div class="chips">
            ${FU_FILTERS.filter(([key]) => key !== "calls" || groups.calls.length).map(([key, label]) => `
                <button class="chip" data-act="fu-filter" data-filter="${key}" aria-pressed="${state.fuFilter === key}">
                    ${t(label)} <span>${groups[key].length}</span>
                </button>`).join("")}
        </div>
        <div id="list">${followupList()}</div>`;
}

// Biggest past donors first
const byLastGift = donors => donors.slice().sort((a, b) =>
    ((lastGift(b) || {}).amount || 0) - ((lastGift(a) || {}).amount || 0) || a.name.localeCompare(b.name));

function followupList() {
    const { groups, paid } = followupGroups();
    const term = searchTerm("followup");
    let donors = groups[state.fuFilter] || [];
    if (term) donors = donors.filter(d => nameKey(d.name).includes(term));
    donors = byLastGift(donors);

    if (!state.donors.length) return `<div class="empty">${t("noDonors")}</div>`;
    if (!donors.length) return `<div class="empty">${t("nobodyHere")}</div>`;
    return donors.map(d => donorCard(d, paid.get(d.id))).join("");
}

function statusBadge(donor, paidAmount) {
    const fu = followup(donor);
    const p = pledgeOf(donor);
    if (p.partial) return `<span class="badge partial">${t("bPartial", { due: rs(p.due) })}</span>`;
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
    const p = pledgeOf(donor);
    const paidLabel = p.partial ? t("addPayment") : t("paidBtn");
    const pledgeBar = p.pledge && p.given ? `
        <div class="pledge">
            <div class="row-between small"><span>${t("pledgeLine", { given: rs(p.given), pledge: rs(p.pledge) })}</span>
                <b>${p.closed ? t("pledgeClosed", { given: rs(p.given) }) : p.due ? t("pledgeDue", { due: rs(p.due) }) : "✓"}</b></div>
            <div class="bar"><span style="width:${Math.min(100, (p.given / p.pledge) * 100)}%"></span></div>
        </div>` : "";

    let actions;
    if (p.done) {
        actions = donor.phone
            ? `<a class="btn wa" href="${esc(waLink(donor.phone, thanksMessage(donor, paidAmount)))}" target="_blank" rel="noopener">${icon("whatsapp")} ${t("thank")}</a>`
            : "";
    } else if (donor.phone) {
        actions = `
            <a class="btn wa" href="${esc(waLink(donor.phone, reminderMessage(donor)))}" target="_blank" rel="noopener" data-act="contacted" data-lead="remind" data-id="${donor.id}">${icon("whatsapp")} ${t("remind")}</a>
            <a class="btn" href="${telLink(donor.phone)}" data-act="contacted" data-lead="call" data-id="${donor.id}">${t("call")}</a>
            ${upiBtn}
            <button class="btn" data-act="fu-update" data-id="${donor.id}">${t("update")}</button>
            <button class="btn primary" data-act="collect" data-id="${donor.id}">${paidLabel}</button>`;
    } else {
        actions = `
            <button class="btn" data-act="edit-donor" data-id="${donor.id}">${t("addNumber")}</button>
            ${upiBtn}
            <button class="btn" data-act="fu-update" data-id="${donor.id}">${t("update")}</button>
            <button class="btn primary" data-act="collect" data-id="${donor.id}">${paidLabel}</button>`;
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
            ${pledgeBar}
            ${fu.note ? `<p class="dc-note">${esc(fu.note)}</p>` : ""}
            ${p.done ? "" : leadLine(donor)}
            ${actions ? `<div class="dc-actions">${actions}</div>` : ""}
        </article>`;
}

// --- Who is on a donor: the last member who reminded / called / showed UPI / updated ---
// Everyone sees it; it never stops anyone else from contacting the donor.

const LEAD_TEXT = { remind: "leadRemind", call: "leadCall", upi: "leadUpi", update: "leadUpdate", sms: "leadSms" };
const millis = ts => (ts && ts.toMillis ? ts.toMillis() : 0);
const isToday = ts => millis(ts) && new Date(millis(ts)).toDateString() === new Date().toDateString();
const isLive = ts => millis(ts) && Date.now() - millis(ts) < 60 * 60 * 1000;

function fmtWhen(ts) {
    const ms = millis(ts);
    if (!ms) return "";
    const date = new Date(ms);
    return isToday(ts)
        ? date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })
        : date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function leadText(donor) {
    const fu = followup(donor);
    if (!fu.leadBy) return "";
    const who = fu.leadBy === state.me.id ? t("you") : esc(memberName(fu.leadBy));
    return `${t(LEAD_TEXT[fu.leadAction] || "leadUpdate", { name: who })} · ${fmtWhen(fu.leadAt)}`;
}

function leadLine(donor) {
    const fu = followup(donor);
    if (!fu.leadBy) return "";
    return `<p class="lead ${isLive(fu.leadAt) ? "live" : ""}"><span class="dot"></span>${leadText(donor)}</p>`;
}

function markLead(donorId, action) {
    const fu = followup(donorById(donorId) || {});
    const update = { leadBy: state.me.id, leadAction: action, leadAt: serverTimestamp() };
    if (action === "remind" || action === "call" || action === "sms") Object.assign(update, { contactedAt: today(), contactedBy: state.me.id });
    if (!fu.assignedTo) update.assignedTo = state.me.id;
    commit(setDoc(doc(db, "donors", donorId), { fu: { [year()]: update } }, { merge: true }));
}

// --- Reminder queue: one donor after another, each sent by hand from your own WhatsApp ---

const QUEUE_LISTS = [["todo", "fTodo"], ["mine", "fMine"], ["fresh", "fFresh"], ["promised", "fPromised"], ["partial", "fPartial"]];

function queueDonors(list, skipToday) {
    const { groups } = followupGroups();
    let donors = (groups[list] || []).filter(d => d.phone);
    if (skipToday) donors = donors.filter(d => followup(d).contactedAt !== today());
    return byLastGift(donors);
}

function openQueueSetup(list = "todo", skipToday = true, mode = "wa") {
    const option = ([key, label]) => `
        <label><input type="radio" name="list" value="${key}" ${key === list ? "checked" : ""}>
            ${t(label)} <span class="muted small">${queueDonors(key, skipToday).length}</span></label>`;
    let smsInfo = "";
    let startButton = `<button class="btn wa block">${icon("whatsapp")} ${t("queueStart")}</button>`;
    if (mode === "sms") {
        const donors = queueDonors(list, skipToday);
        const parts = donors.reduce((total, d) => total + smsParts(smsReminderText(d)), 0);
        smsInfo = `
            <p class="preview small">${t("smsEstimate", { donors: donors.length, sms: parts })}<br>
                ${t("smsUsedToday", { used: smsUsedToday(), limit: smsLimit() })}</p>
            ${donors.length ? `<details><summary>${t("smsPreview")}</summary><pre class="sms-preview">${esc(smsReminderText(donors[0]))}</pre></details>` : ""}
            <p class="hint">${t("smsKeepOpen")}</p>`;
        startButton = `<button class="btn primary block">${t("smsStart", { n: donors.length })}</button>`;
    }
    openSheet(mode === "sms" ? t("smsTitle") : t("queueTitle"), `
        <form class="form" data-form="queue-start" data-mode="${mode}">
            <span class="field-label">${t("queueWho")}</span>
            <div class="radio-col">${QUEUE_LISTS.map(option).join("")}</div>
            <label class="check-row"><input type="checkbox" name="skipToday" ${skipToday ? "checked" : ""}> ${t("queueSkipToday")}</label>
            <p class="hint">${t("queueOnlyPhones")}</p>
            ${smsInfo}
            ${startButton}
        </form>`);
}

function renderSmsRun() {
    const run = state.smsRun;
    if (!run) return;
    const current = donorById(run.ids[run.index]);
    let status;
    if (run.done) {
        status = `
            <div class="tick">✓</div>
            <p>${t("smsDone", { sent: run.sent, failed: run.failed })}</p>
            ${run.limitHit ? `<p class="lead-warn">${t("smsLimitHit", { limit: smsLimit() })}</p>` : ""}
            ${run.permissionDenied ? `<p class="lead-warn">${t("smsNoPermission")}</p>` : ""}
            <button class="btn block" data-act="close-sheet">${t("done")}</button>`;
    } else {
        status = `
            <div class="bar"><span style="width:${(run.index / run.ids.length) * 100}%"></span></div>
            <p>${t("smsSending", { n: run.index + 1, total: run.ids.length })}</p>
            ${current ? `<h3>${esc(current.name)}</h3>` : ""}
            <p class="muted">${t("smsProgress", { sent: run.sent, failed: run.failed })}</p>
            <button class="btn block" data-act="sms-stop">${t("queueStop")}</button>
            <p class="hint">${t("smsKeepOpen")}</p>`;
    }
    openSheet(t("smsTitle"), `<div class="queue done">${status}</div>`);
}

async function runSms() {
    const run = state.smsRun;
    renderSmsRun();
    while (run.index < run.ids.length && !run.stopped) {
        if (smsUsedToday() >= smsLimit()) {
            run.limitHit = true;
            break;
        }
        const donor = donorById(run.ids[run.index]);
        if (donor && donor.phone) {
            try {
                await sendSms(donor.phone, smsReminderText(donor));
                run.sent++;
                markLead(donor.id, "sms");
            } catch (e) {
                run.failed++;
                if (e && e.code === "PERMISSION_DENIED") {
                    run.permissionDenied = true;
                    break;
                }
            }
        }
        run.index++;
        if (run.stopped) break;
        renderSmsRun();
        // A short gap between messages so the network does not treat them as spam
        await new Promise(resolve => setTimeout(resolve, 4000));
    }
    run.done = true;
    if (state.smsRun === run) renderSmsRun();
}

function renderQueue() {
    const q = state.queue;
    if (!q) return;
    if (q.index >= q.ids.length) {
        const summary = t("queueDone", { sent: q.sent, skipped: q.skipped });
        state.queue = null;
        openSheet(t("queueTitle"), `
            <div class="done">
                <div class="tick">✓</div>
                <p>${summary}</p>
                <button class="btn block" data-act="close-sheet">${t("done")}</button>
            </div>`);
        return;
    }
    const donor = donorById(q.ids[q.index]);
    if (!donor) {
        q.index++;
        return renderQueue();
    }
    const fu = followup(donor);
    const last = lastGift(donor);
    const someoneElse = fu.leadBy && fu.leadBy !== state.me.id && isToday(fu.leadAt);
    openSheet(t("queueProgress", { n: q.index + 1, total: q.ids.length }), `
        <div class="queue">
            <div class="bar"><span style="width:${(q.index / q.ids.length) * 100}%"></span></div>
            <h3>${esc(donor.name)}</h3>
            <p class="muted">${last ? `${last.year}: ${rs(last.amount)}` : t("newDonor")} · ${esc(donor.phone)}</p>
            ${fu.note ? `<p class="dc-note">${esc(fu.note)}</p>` : ""}
            ${someoneElse ? `<p class="lead-warn">${t("queueOtherLead", { line: leadText(donor) })}</p>` : leadLine(donor)}
            ${q.sentCurrent ? `
                <p class="sent-ok">✓ ${t("queueSent")}</p>
                <button class="btn primary block" data-act="queue-next">${t("queueNext")}</button>` : `
                <a class="btn wa block big" href="${esc(waLink(donor.phone, reminderMessage(donor)))}" target="_blank" rel="noopener"
                    data-act="queue-send" data-id="${donor.id}">${icon("whatsapp")} ${t("queueSend")}</a>
                <div class="btn-row">
                    <button class="btn" data-act="queue-skip">${t("queueSkip")}</button>
                    <button class="btn" data-act="queue-stop">${t("queueStop")}</button>
                </div>`}
            <p class="hint">${t("queueHint")}</p>
        </div>`);
}

function queueAdvance() {
    if (!state.queue) return;
    state.queue.index++;
    state.queue.sentCurrent = false;
    renderQueue();
}

const msgKey = base => state.settings.msgLang === "en" ? base : base + "Or";

// Values every reminder template can use; {paid}, {pledge} and {due} are there for custom messages
function reminderVars(donor) {
    const last = lastGift(donor);
    const p = pledgeOf(donor);
    return {
        name: donor.name,
        year: year(),
        last: last ? last.amount.toLocaleString("en-IN") : "",
        member: state.me.name || "",
        paylink: payLink(donor.name, p.partial ? p.due : p.pledge),
        upi: payInfo().upiId,
        paid: p.given ? inr(p.given) : "",
        pledge: p.pledge ? inr(p.pledge) : "",
        due: p.due ? inr(p.due) : ""
    };
}

function reminderMessage(donor) {
    const vars = reminderVars(donor);
    return withLines(fillTemplate(state.settings[msgKey("waReminder")], vars), reminderLines(donor, false), vars.paylink);
}

// given = donor's total including this payment; worked out from the receipt when not passed
function thanksMessage(donor, amount, member, receiptNo, token, kind = "waThanks", given) {
    const entry = receiptNo === undefined
        ? state.collections.find(c => c.donorId === donor.id)
        : state.collections.find(c => c.donorId === donor.id && receiptNo && c.receiptNo === receiptNo);
    if (receiptNo === undefined) {
        receiptNo = entry ? entry.receiptNo : "";
        token = entry ? entry.receiptToken : "";
    }
    if (given === undefined) given = entry ? givenUpTo(entry) : Number(amount);
    let template = state.settings[msgKey(kind)] || "";
    const link = receiptLink(token);
    // Messages saved before receipt links existed still get the link
    if (link && !template.includes("{receiptlink}")) template += `\n${t("receiptWord")}: {receiptlink}`;
    const text = fillTemplate(template, {
        name: donor.name,
        year: year(),
        amount: Number(amount).toLocaleString("en-IN"),
        receipt: receiptLabel(receiptNo),
        receiptlink: link,
        member: member || state.me.name || "",
        upi: payInfo().upiId
    });
    return withLines(text, thanksLines(donor, amount, given, kind === "smsReceipt"), receiptLabel(receiptNo) || link);
}

// ---------- SMS from the member's own SIM (Android app only) ----------

// How many SMS a message takes: plain English 160 letters, Odia (Unicode) 70
function smsParts(text) {
    const plain = /^[\x20-\x7E\n\r]*$/.test(text);
    const single = plain ? 160 : 70;
    const multi = plain ? 153 : 67;
    return text.length <= single ? 1 : Math.ceil(text.length / multi);
}

function smsUsedToday() {
    try {
        const saved = JSON.parse(localStorage.getItem("kpSmsCount") || "{}");
        return saved.date === today() ? saved.count : 0;
    } catch (e) {
        return 0;
    }
}

function addSmsUsed(parts) {
    try { localStorage.setItem("kpSmsCount", JSON.stringify({ date: today(), count: smsUsedToday() + parts })); } catch (e) { }
}

const smsLimit = () => Number(state.settings.smsDailyLimit) || 90;

function sendSms(phone, message) {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 30000));
    return Promise.race([Native.sms.send({ phone: "+" + waNumber(phone), message }), timeout])
        .then(result => {
            addSmsUsed((result && result.parts) || smsParts(message));
            return result;
        });
}

function smsReminderText(donor) {
    const vars = reminderVars(donor);
    return withLines(fillTemplate(state.settings[msgKey("smsReminder")], vars), reminderLines(donor, true), vars.paylink);
}

// Sends the receipt SMS automatically after a collection gets its number (Android app only)
function sendReceiptSms(donor, amount, number, token, given) {
    if (!isNative || state.settings.autoReceiptSms === false || !donor.phone || !number) return null;
    const message = thanksMessage(donor, amount, state.me.name, number, token, "smsReceipt", given);
    return sendSms(donor.phone, message);
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
            ${menuItem("#myupi", t("mMyUpi"), payInfo().key ? t("mMyUpiOn") : t("mMyUpiOff"))}
            ${menuItem("#settings", t("mSettings"), t("mSettingsSub", { year: esc(year()) }))}
            ${menuItem("#export", t("mExport"), t("mExportSub"))}
            ${menuItem("", t("mImport"), t("mImportSub", { years: pastYears }), "import-past")}
        </div>
        <div class="menu">
            ${menuItem("guide.html", t("mGuide"), t("mGuideSub"))}
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
                <label>${t("upiOwner")}
                    <select name="upiOwner"><option value="">${t("nobody")}</option>${memberOptions(s.upiOwner)}</select>
                </label>
                <p class="hint">${t("upiOwnerHint")}</p>
            </div>

            <div class="panel form">
                <h2>${t("nudgeSection")}</h2>
                <p class="hint">${t("nudgeHint")}</p>
                <label class="check-row"><input type="checkbox" name="nudgeCrowd" ${s.nudgeCrowd !== false ? "checked" : ""}> ${t("nudgeCrowd")}</label>
                <label class="check-row"><input type="checkbox" name="nudgeCommon" ${s.nudgeCommon !== false ? "checked" : ""}> ${t("nudgeCommon")}</label>
                <label class="check-row"><input type="checkbox" name="nudgeTier" ${s.nudgeTier !== false ? "checked" : ""}> ${t("nudgeTier")}</label>
                <label>${t("tiersLabel")}<textarea name="tiers" rows="4">${esc(s.tiers)}</textarea></label>
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

            <div class="panel form">
                <h2>${t("smsSection")}</h2>
                <p class="hint">${t("smsSectionHint")}</p>
                <label class="check-row"><input type="checkbox" name="autoReceiptSms" ${s.autoReceiptSms !== false ? "checked" : ""}> ${t("autoReceiptSms")}</label>
                <label>${t("smsDailyLimit")}<input name="smsDailyLimit" type="number" inputmode="numeric" min="1" value="${esc(s.smsDailyLimit)}"></label>
                <details>
                    <summary>${t("odia")}</summary>
                    <label>${t("smsReminderMsg")}<textarea name="smsReminderOr" rows="6">${esc(s.smsReminderOr)}</textarea></label>
                    <label>${t("smsReceiptMsg")}<textarea name="smsReceiptOr" rows="5">${esc(s.smsReceiptOr)}</textarea></label>
                </details>
                <details>
                    <summary>${t("english")}</summary>
                    <label>${t("smsReminderMsg")}<textarea name="smsReminder" rows="6">${esc(s.smsReminder)}</textarea></label>
                    <label>${t("smsReceiptMsg")}<textarea name="smsReceipt" rows="5">${esc(s.smsReceipt)}</textarea></label>
                </details>
            </div>

            <button class="btn primary block">${t("saveSettings")}</button>
        </form>`;
}

// Each member can hand out their own UPI / QR instead of the main committee one
function viewMyUpi() {
    const me = state.me;
    const own = Boolean(payInfo().key);
    return `
        <div class="view-head">
            <a href="#more" class="back">${t("back")}</a>
            <h1>${t("myUpiTitle")}</h1>
            <p class="muted">${t("myUpiSub")}</p>
        </div>
        <form class="panel form" data-form="myupi">
            <label>${t("upiId")}<input name="upiId" autocapitalize="none" placeholder="9876543210@ybl" value="${esc(me.upiId || "")}"></label>
            <label>${t("myUpiName")}<input name="upiName" value="${esc(me.upiName || me.name || "")}"></label>
            <label>${t("qrImage")}<input name="qrFile" type="file" accept="image/*"></label>
            <div class="qr-preview" id="qr-preview">${qrPreview()}</div>
            <button class="btn primary block">${t("save")}</button>
            ${own ? `<button type="button" class="btn danger block" data-act="remove-my-upi">${t("myUpiRemove")}</button>` : ""}
        </form>`;
}

function qrPreview() {
    const saved = currentView() === "myupi" ? state.myPay.qrImage : state.publicPay.qrImage;
    const image = state.pendingQr !== undefined ? state.pendingQr : saved;
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
    state.queue = null;
    if (state.smsRun) {
        state.smsRun.stopped = true;
        state.smsRun = null;
    }
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
    const p = donor ? pledgeOf(donor) : null;
    const upiTo = entry ? entry.upiTo || BANK : state.me.hasOwnUpi ? state.me.id : BANK;
    openSheet(entry ? `${t("editCollection")}${receipt ? " · " + receipt : ""}` : t("newCollection"), `
        <form class="form" data-form="collection" data-id="${entry ? entry.id : ""}">
            <label>${t("donorName")}
                <input name="donor" list="donor-names" required autocomplete="off" value="${esc(donor ? donor.name : entry ? entry.donorName : "")}">
            </label>
            <datalist id="donor-names">${state.donors.map(d => `<option value="${esc(d.name)}">`).join("")}</datalist>
            <label>${t("phoneOptional")}<input name="phone" type="tel" inputmode="tel" value="${esc(donor ? donor.phone : "")}"></label>
            <label>${t("amount")}
                <input name="amount" type="number" inputmode="numeric" min="1" required value="${esc(entry ? entry.amount : (p && p.partial ? p.due : fu.promised) || "")}">
            </label>
            ${!entry && p && p.partial ? `<p class="hint">${t("pledgeHint", { pledge: rs(p.pledge), given: rs(p.given), due: rs(p.due) })}</p>` : ""}
            <div class="radio-row">
                <label><input type="radio" name="mode" value="cash" ${!entry || entry.mode !== "upi" ? "checked" : ""}> ${t("cash")}</label>
                <label><input type="radio" name="mode" value="upi" ${entry && entry.mode === "upi" ? "checked" : ""}> ${t("upiOnline")}</label>
            </div>
            ${ownUpiMembers().length ? `
            <label class="upi-only">${t("upiTo")}
                <select name="upiTo">
                    <option value="${BANK}">${esc(memberName(BANK))}</option>
                    ${ownUpiMembers().map(m => `<option value="${esc(m.id)}" ${m.id === upiTo ? "selected" : ""}>${esc(t("ownUpi", { name: m.name }))}</option>`).join("")}
                </select>
            </label>` : ""}
            <label>${t("receivedBy")}<select name="by">${memberOptions(entry ? entry.collectedBy : state.me.id)}</select></label>
            <label>${t("date")}<input name="date" type="date" required value="${esc(entry ? entry.date : today())}"></label>
            <label>${t("note")}<input name="note" value="${esc(entry ? entry.note : "")}" placeholder="${t("optional")}"></label>
            ${photoField("photoCollection")}
            <button class="btn primary block">${entry ? t("saveChanges") : t("saveCollection")}</button>
            ${entry && entry.receiptToken ? `<a class="small" href="${esc(receiptLink(entry.receiptToken))}" target="_blank" rel="noopener">${t("viewReceipt")}</a>` : ""}
            ${entry && donor && donor.phone && !entry.deleted ? `
                <a class="btn wa block" href="${esc(waLink(donor.phone, thanksMessage(donor, entry.amount, memberName(entry.collectedBy), entry.receiptNo, entry.receiptToken)))}"
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

function openFollowupSheet(donorId, afterCall = false) {
    const donor = donorById(donorId);
    if (!donor) return;
    const fu = followup(donor);
    const p = pledgeOf(donor);
    const status = afterCall ? "" : fu.status || "pending";
    const option = (value, label) =>
        `<label><input type="radio" name="status" value="${value}" ${status === value ? "checked" : ""}> ${t(label)}</label>`;
    openSheet(afterCall ? t("callHow", { name: donor.name }) : donor.name, `
        <form class="form" data-form="followup" data-id="${donor.id}">
            ${afterCall ? `<button type="button" class="btn primary block" data-act="collect" data-id="${donor.id}">${t("paidNow")}</button>` : ""}
            <div class="radio-col">
                ${afterCall ? option("noanswer", "sNoAnswer") : option("pending", "sNotDecided")}
                ${option("promised", "sPromised")}
                ${option("later", "sLater")}
                ${option("declined", "sDeclined")}
            </div>
            <label>${t("promisedAmount")}<input name="promised" type="number" inputmode="numeric" value="${esc(fu.promised || "")}"></label>
            ${p.given && p.pledge > p.given ? `
                <p class="hint">${t("pledgeHint", { pledge: rs(p.pledge), given: rs(p.given), due: rs(p.pledge - p.given) })}</p>
                <label class="check-row"><input type="checkbox" name="closed" ${p.closed ? "checked" : ""}> ${t("closePledge", { given: rs(p.given) })}</label>` : ""}
            <div class="row-2">
                <label>${t("callOn")}<input name="callOn" type="date" value="${esc(fu.callOn || "")}"></label>
                <label>${t("callTime")}<input name="callTime" type="time" value="${esc(fu.callTime || "")}"></label>
            </div>
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
    const p = pledgeOf(donor);
    const value = amount !== undefined ? amount : ((p.partial ? p.due : p.pledge) || (lastGift(donor) || {}).amount || "");
    const link = payLink(donor.name, value);
    const pay = payInfo();
    const image = pay.qrImage;
    openSheet(t("upiTitle"), `
        <div class="upi">
            <p class="upi-for"><b>${esc(donor.name)}</b></p>
            ${pay.upiName ? `<p class="hint">${t("payingTo", { name: esc(pay.upiName) })}</p>` : ""}
            ${image ? `
                <div class="qr qr-image"><img src="${esc(image)}" alt="UPI QR"></div>
                <p class="hint">${t("qrDonorAmount")}</p>` : `
                <form class="form" data-form="upi-amount" data-id="${donor.id}">
                    <label>${t("amount")}<input name="amount" type="number" inputmode="numeric" value="${esc(value)}"></label>
                </form>
                <div class="qr">${qrSvg(upiString(value, `Kartikeswar Puja ${year()} - ${donor.name}`))}</div>`}
            ${pay.upiId ? `
                <p class="upi-id">${esc(pay.upiId)}</p>
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

function openSavedSheet(donor, amount, collectorEmail, receiptNo, token, given) {
    const smsSending = Boolean(receiptNo && isNative && state.settings.autoReceiptSms !== false && donor.phone);
    openSheet(t("saved"), `
        <div class="done">
            <div class="tick">✓</div>
            <h2>${rs(amount)}</h2>
            <p class="muted">${t("fromDonor", { name: esc(donor.name) })}</p>
            ${receiptNo ? `<p class="receipt">${t("receiptNo", { no: receiptLabel(receiptNo) })}</p>` : `<p class="hint">${t("receiptLater")}</p>`}
            ${token ? `<a class="small" href="${esc(receiptLink(token))}" target="_blank" rel="noopener">${t("viewReceipt")}</a>` : ""}
            ${smsSending ? `<p class="hint" id="receipt-sms">${t("receiptSmsSending")}</p>` : ""}
            ${donor.phone ? `<a class="btn wa block" href="${esc(waLink(donor.phone, thanksMessage(donor, amount, memberName(collectorEmail), receiptNo || "", token, "waThanks", given)))}"
                target="_blank" rel="noopener" data-act="close-sheet">${icon("whatsapp")} ${t("sendThanks")}</a>` : ""}
            <button class="btn block" data-act="close-sheet">${t("done")}</button>
        </div>`);
    if (smsSending) {
        const status = ok => {
            const el = $("#receipt-sms");
            if (el) el.textContent = ok ? "✓ " + t("receiptSmsSent") : t("receiptSmsFailed");
        };
        sendReceiptSms(donor, amount, receiptNo, token, given).then(() => status(true), () => status(false));
    }
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
            upiTo: f.mode === "upi" ? f.upiTo || BANK : "",
            collectedBy: f.by,
            date: f.date,
            note: f.note.trim()
        };

        if (existingId) {
            const old = state.collectionsAll.find(c => c.id === existingId);
            if (old && old.receiptToken) saveReceiptPage(old.receiptToken, { ...data, id: existingId, createdAt: old.createdAt }, old.receiptNo);
            Object.assign(data, savePhoto("collections", existingId));
            batch.set(doc(db, yearPath("collections"), existingId), { ...data, ...stamp(false) }, { merge: true });
            commit(batch.commit());
            closeSheet();
            return toast(t("saved"));
        }

        commit(batch.commit());
        const ref = doc(collection(db, yearPath("collections")));
        const given = givenUpTo({ ...data, id: ref.id });
        const entry = { ...data, ...savePhoto("collections", ref.id), ...stamp(true) };
        form.querySelector("button:not([type])").disabled = true;
        let receipt = null;
        if (navigator.onLine) {
            try { receipt = await saveWithReceipt(ref, entry); } catch (e) { receipt = null; }
        }
        // Offline or slow: save without a number; it is numbered automatically once synced.
        // Same document id, so a late transaction and this write never make two entries.
        if (!receipt) commit(setDoc(ref, entry, { merge: true }));
        openSavedSheet(donor, amount, f.by, receipt && receipt.number, receipt && receipt.token, given);
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
        let status = f.status || followup(donorById(form.dataset.id) || {}).status || "pending";
        let callOn = f.callOn || "";
        if (status === "noanswer") {
            // Didn't pick up: try again tomorrow unless a date was chosen
            status = "later";
            callOn = callOn || addDays(today(), 1);
        }
        const update = {
            status,
            promised: Number(f.promised) || 0,
            closed: Boolean(form.elements.closed && form.elements.closed.checked),
            callOn,
            callTime: f.callTime || "",
            assignedTo: f.assignedTo,
            note: f.note.trim(),
            updatedBy: state.me.id,
            leadBy: state.me.id,
            leadAction: "update",
            leadAt: serverTimestamp()
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

    "queue-start"(form) {
        const list = formValues(form).list || "todo";
        const skipToday = form.elements.skipToday.checked;
        const ids = queueDonors(list, skipToday).map(d => d.id);
        if (!ids.length) return toast(t("queueEmpty"));
        if (form.dataset.mode === "sms") {
            state.smsRun = { ids, index: 0, sent: 0, failed: 0, stopped: false, done: false };
            return runSms();
        }
        state.queue = { ids, index: 0, sent: 0, skipped: 0, sentCurrent: false };
        renderQueue();
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
            upiOwner: f.upiOwner || "",
            nudgeCrowd: form.elements.nudgeCrowd.checked,
            nudgeCommon: form.elements.nudgeCommon.checked,
            nudgeTier: form.elements.nudgeTier.checked,
            tiers: f.tiers,
            msgLang: f.msgLang,
            waReminder: f.waReminder,
            waThanks: f.waThanks,
            waReminderOr: f.waReminderOr,
            waThanksOr: f.waThanksOr,
            autoReceiptSms: form.elements.autoReceiptSms.checked,
            smsDailyLimit: Number(f.smsDailyLimit) || 90,
            smsReminder: f.smsReminder,
            smsReceipt: f.smsReceipt,
            smsReminderOr: f.smsReminderOr,
            smsReceiptOr: f.smsReceiptOr,
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
    },

    // Own UPI: the member doc says whether it is on; the QR goes in a public doc for the pay page
    myupi(form) {
        const f = formValues(form);
        const upiId = f.upiId.trim();
        const upiName = f.upiName.trim() || state.me.name || "";
        const qrImage = state.pendingQr !== undefined ? state.pendingQr : state.myPay.qrImage || "";
        if (!upiId && !qrImage) return ACTIONS["remove-my-upi"]();
        const payKey = state.me.payKey || newToken().slice(0, 12);
        commit(setDoc(doc(db, "members", state.me.id), { upiId, upiName, payKey, hasOwnUpi: true, ...stamp(false) }, { merge: true }));
        commit(setDoc(doc(db, "public", "m-" + payKey), { upiId, upiName, qrImage }));
        // Show it straight away, before the database answers
        Object.assign(state.me, { upiId, upiName, payKey, hasOwnUpi: true });
        watchMyPay(payKey);
        state.myPay = { upiId, upiName, qrImage };
        state.pendingQr = undefined;
        formDirty = false;
        toast(t("myUpiSaved"));
        render();
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
    "upi-qr": (el, id) => {
        markLead(id, "upi");
        openUpiSheet(id);
    },
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
        markLead(id, el.dataset.lead || "remind");
        // After a call, ask how it went when the member comes back to the app
        if (el.dataset.lead === "call") {
            try { localStorage.setItem("kpPendingCall", JSON.stringify({ id, at: Date.now() })); } catch (e) { }
        }
    },

    "sms-setup": () => openQueueSetup("todo", true, "sms"),

    "sms-stop": () => {
        if (state.smsRun) state.smsRun.stopped = true;
    },

    "queue-setup": () => openQueueSetup(),

    "queue-send": (el, id) => {
        markLead(id, "remind");
        state.queue.sent++;
        state.queue.sentCurrent = true;
        // Let WhatsApp open first; the sheet then shows "Sent" with a Next button
        setTimeout(renderQueue, 400);
    },

    "queue-next": queueAdvance,

    "queue-skip": () => {
        state.queue.skipped++;
        queueAdvance();
    },

    "queue-stop": () => closeSheet(),

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
        const entry = el.dataset.kind === "collections" && state.collectionsAll.find(c => c.id === id);
        if (entry && entry.receiptToken) {
            commit(setDoc(receiptRef(entry.receiptToken), { status: "cancelled", updatedAt: serverTimestamp() }, { merge: true }));
        }
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

    // Keep payKey so old pay links still open (they fall back to the main committee QR)
    "remove-my-upi": () => {
        const payKey = state.me.payKey;
        commit(setDoc(doc(db, "members", state.me.id), { upiId: "", hasOwnUpi: false, ...stamp(false) }, { merge: true }));
        if (payKey) commit(setDoc(doc(db, "public", "m-" + payKey), { upiId: "", upiName: "", qrImage: "" }));
        Object.assign(state.me, { upiId: "", hasOwnUpi: false });
        state.myPay = {};
        state.pendingQr = undefined;
        formDirty = false;
        toast(t("myUpiRemoved"));
        render();
    },

    "copy-upi": () => {
        const upiId = payInfo().upiId;
        const copy = navigator.clipboard ? navigator.clipboard.writeText(upiId) : Promise.reject();
        copy.then(() => toast(t("copied")), () => toast(upiId));
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
        if (isNative) return toast(t("googleNative"));
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
                receiptLabel(c.receiptNo), c.date, c.donorName, c.amount, c.mode === "upi" ? `UPI (${memberName(c.upiTo || BANK)})` : "Cash",
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
            ["Name", "Phone", ...years, y, "Status", "Promised", "Due", "Note"],
            ...state.donors.slice().sort((a, b) => a.name.localeCompare(b.name)).map(d => [
                d.name, d.phone, ...years.map(yr => (d.history || {})[yr] || ""), paid.get(d.id) || "",
                followup(d).status || "", followup(d).promised || "", pledgeOf(d, paid).due || "", d.note
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
    if (form && form.dataset.form === "queue-start") {
        openQueueSetup(formValues(form).list, form.elements.skipToday.checked, form.dataset.mode);
        return;
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

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (state.queue && state.queue.sentCurrent) setTimeout(queueAdvance, 300);
    setTimeout(checkPendingCall, 400);
});

function checkPendingCall() {
    let pending = null;
    try { pending = JSON.parse(localStorage.getItem("kpPendingCall") || "null"); } catch (e) { }
    if (!pending || sheetOpen || state.memberStatus !== "ok" || !donorById(pending.id)) return;
    const away = Date.now() - pending.at;
    if (away < 4000) return; // back too quickly: the call probably did not start yet
    try { localStorage.removeItem("kpPendingCall"); } catch (e) { }
    if (away < 3 * 60 * 60 * 1000) openFollowupSheet(pending.id, true);
}

if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => { });
}

if (isNative) {
    Native.notifications.addListener("localNotificationActionPerformed", event => {
        const hash = event && event.notification && event.notification.extra && event.notification.extra.hash;
        if (hash) location.hash = hash;
    }).catch(() => { });
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
