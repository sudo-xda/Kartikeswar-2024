// Disable PrintScreen functionality
document.addEventListener("keyup", function (event) {
    if (event.key === "PrintScreen") {
        alert("Screenshots are disabled on this page.");
        navigator.clipboard.writeText(""); // Clear clipboard
    }
});

// Disable right-click context menu
document.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    alert("Right-click is disabled.");
});

// Disable common keyboard shortcuts
document.addEventListener("keydown", function (e) {
    // Block F12, Ctrl+Shift+I, and Ctrl+U (Inspect Element/View Source)
    if (e.key === "F12" ||
        (e.ctrlKey && e.shiftKey && e.key === "I") ||
        (e.ctrlKey && e.key === "U")) {
        e.preventDefault();
        alert("This functionality is disabled.");
    }

    // Block Ctrl+S (Save Page) and Ctrl+P (Print)
    if (e.ctrlKey && (e.key === "S" || e.key === "P")) {
        e.preventDefault();
        alert("This functionality is disabled.");
    }
});

// --- Dynamic Data Logic ---

const years = Object.keys(pujaData).sort().reverse();
let currentYear = years[0];

// Holders Data
const holdersData = {
    "2025": [
        { name: "Prabir Kumar Jena", amount: 10378 },
        { name: "Prasanjit Mohanty", amount: 2500 },
        { name: "Kuna Rout", amount: 2500 }
    ],
    "2024": [
        { name: "Ayashkanta Panda", amount: 3000 },
        { name: "Prabir Kumar Jena", amount: 1500 },
        { name: "Kuna Rout", amount: 1516 }
    ]
};

function formatRs(amount) {
    return "₹" + amount.toLocaleString("en-IN");
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function calculateTotal(year) {
    const data = pujaData[year];
    if (!data) return { donations: 0, expenditure: 0 };

    const totalDonations = data.donations.reduce((sum, item) => sum + item.amount, 0);
    const totalExpenditure = data.expenditure.reduce((sum, category) => sum + category.total, 0);

    return { donations: totalDonations, expenditure: totalExpenditure };
}

// Balance left over from the previous year's puja (0 for the first year)
function carryForward(year) {
    const previousYear = String(Number(year) - 1);
    if (!pujaData[previousYear]) return 0;
    return closingBalance(previousYear);
}

function closingBalance(year) {
    const totals = calculateTotal(year);
    return carryForward(year) + totals.donations - totals.expenditure;
}

function changeNote(current, previous, previousYear) {
    if (!previous) return "";
    const diff = current - previous;
    const sign = diff >= 0 ? "+" : "−";
    return `${sign}${formatRs(Math.abs(diff))} vs ${previousYear}`;
}

// --- Summary cards ---

function renderStats(year) {
    const data = pujaData[year];
    const totals = calculateTotal(year);
    const previousYear = String(Number(year) - 1);
    const previous = pujaData[previousYear] ? calculateTotal(previousYear) : null;
    const balance = closingBalance(year);
    const cf = carryForward(year);

    document.getElementById("stat-collection").textContent = formatRs(totals.donations);
    document.getElementById("stat-collection-note").textContent =
        previous ? changeNote(totals.donations, previous.donations, previousYear) : `Puja ${year}`;

    document.getElementById("stat-expenditure").textContent = formatRs(totals.expenditure);
    document.getElementById("stat-expenditure-note").textContent =
        previous ? changeNote(totals.expenditure, previous.expenditure, previousYear) : `Puja ${year}`;

    const balanceEl = document.getElementById("stat-balance");
    balanceEl.textContent = (balance < 0 ? "−" : "") + formatRs(Math.abs(balance));
    balanceEl.classList.toggle("negative", balance < 0);
    document.getElementById("stat-balance-note").textContent =
        cf ? `Incl. ${formatRs(cf)} from ${previousYear}` : "Carried to next year";

    const donorCount = data.donations.filter(d => d.name !== "Other Collection").length;
    document.getElementById("stat-donors").textContent = donorCount;
    const previousCount = pujaData[previousYear]
        ? pujaData[previousYear].donations.filter(d => d.name !== "Other Collection").length
        : 0;
    document.getElementById("stat-donors-note").textContent =
        previousCount ? `${previousCount} in ${previousYear}` : "Thank you all";
}

// --- Donations ---

function renderDonations(year) {
    const data = pujaData[year];
    const query = document.getElementById("donor-search").value.trim().toLowerCase();
    const sort = document.getElementById("donor-sort").value;

    let rows = data.donations.slice();
    if (sort === "name") rows.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "high") rows.sort((a, b) => b.amount - a.amount);
    if (sort === "low") rows.sort((a, b) => a.amount - b.amount);
    if (query) rows = rows.filter(item => item.name.toLowerCase().includes(query));

    document.querySelector("#donations-table tbody").innerHTML = rows.map((item, i) => `
        <tr>
            <td class="col-num">${i + 1}</td>
            <td>${escapeHtml(item.name)}</td>
            <td class="col-amount">${formatRs(item.amount)}</td>
        </tr>`).join("");

    document.getElementById("donor-empty").hidden = rows.length > 0;
    document.getElementById("donations-total").textContent = formatRs(calculateTotal(year).donations);
}

// --- Expenditure ---

function renderExpenditure(year) {
    const data = pujaData[year];
    const total = calculateTotal(year).expenditure;
    const largest = Math.max(...data.expenditure.map(c => c.total));

    document.getElementById("expenditure-list").innerHTML = data.expenditure.map(category => {
        const share = total ? (category.total / total) * 100 : 0;
        const items = (category.items || []).map(item => `
            <li><span>${escapeHtml(item.name)}</span><span>${formatRs(item.amount)}</span></li>`).join("");
        return `
        <details class="category">
            <summary>
                <span class="cat-name">${escapeHtml(category.category)}</span>
                <span class="cat-amount">${formatRs(category.total)}</span>
                <span class="cat-bar"><span style="width:${(category.total / largest) * 100}%"></span></span>
                <span class="cat-share">${share.toFixed(1)}%</span>
            </summary>
            <ul class="items">${items}</ul>
        </details>`;
    }).join("");

    document.getElementById("expenditure-total").textContent = formatRs(total);
}

// --- Balance ---

function renderBalance(year) {
    const totals = calculateTotal(year);
    const cf = carryForward(year);
    const balance = closingBalance(year);
    const previousYear = String(Number(year) - 1);

    const rows = [];
    if (pujaData[previousYear]) rows.push([`Carry Forward (${previousYear})`, formatRs(cf)]);
    rows.push([`Total Collection (${year})`, formatRs(totals.donations)]);
    rows.push([`Total Expenditure (${year})`, "−" + formatRs(totals.expenditure)]);

    const sign = balance >= 0 ? "+" : "−";
    document.querySelector("#balance-table tbody").innerHTML =
        rows.map(([label, value]) => `<tr><td>${label}</td><td class="col-amount">${value}</td></tr>`).join("") +
        `<tr class="total-row"><td>Total Balance</td><td class="col-amount">${sign}${formatRs(Math.abs(balance))}</td></tr>`;

    const holders = holdersData[year] || [];
    document.querySelector("#holders-table tbody").innerHTML = holders.length
        ? holders.map(holder => `
            <tr>
                <td>${escapeHtml(holder.name)}</td>
                <td class="col-amount">${formatRs(holder.amount)}</td>
            </tr>`).join("")
        : `<tr><td colspan="2" class="muted">Not updated yet</td></tr>`;
}

function renderData(year) {
    if (!pujaData[year]) return;
    document.querySelectorAll(".year-label").forEach(el => el.textContent = year);
    document.querySelectorAll(".year-btn").forEach(btn =>
        btn.setAttribute("aria-pressed", btn.dataset.year === year));
    renderStats(year);
    renderDonations(year);
    renderExpenditure(year);
    renderBalance(year);
}

// --- Gallery ---

let galleryFilter = "All";
let visiblePhotos = [];
let lightboxIndex = 0;

function renderGallery() {
    const photos = (typeof galleryPhotos !== "undefined" ? galleryPhotos : [])
        .slice()
        .sort((a, b) => String(b.year).localeCompare(String(a.year)));

    const tags = ["All", ...new Set(photos.map(p => p.tag).filter(Boolean))];
    const filters = document.getElementById("gallery-filters");
    filters.innerHTML = photos.length > 0
        ? tags.map(tag => `<button class="chip" data-tag="${escapeHtml(tag)}" aria-pressed="${tag === galleryFilter}">${escapeHtml(tag)}</button>`).join("")
        : "";

    visiblePhotos = galleryFilter === "All" ? photos : photos.filter(p => p.tag === galleryFilter);

    document.getElementById("gallery-grid").innerHTML = visiblePhotos.map((photo, i) => `
        <button class="photo" data-index="${i}" aria-label="Open ${escapeHtml(photo.caption || "photo")}">
            <img src="${escapeHtml(photo.src)}" alt="${escapeHtml(photo.caption || "")}" loading="lazy">
            <span class="photo-meta">
                <span>${escapeHtml(photo.caption || "")}</span>
                ${photo.year ? `<span class="photo-year">${escapeHtml(String(photo.year))}</span>` : ""}
            </span>
        </button>`).join("");

    document.getElementById("gallery-empty").hidden = visiblePhotos.length > 0;
}

function openLightbox(index) {
    lightboxIndex = (index + visiblePhotos.length) % visiblePhotos.length;
    const photo = visiblePhotos[lightboxIndex];
    document.getElementById("lb-image").src = photo.src;
    document.getElementById("lb-image").alt = photo.caption || "";
    document.getElementById("lb-caption").textContent =
        [photo.caption, photo.year].filter(Boolean).join(" · ");
    document.getElementById("lightbox").hidden = false;
    document.body.style.overflow = "hidden";
}

function closeLightbox() {
    document.getElementById("lightbox").hidden = true;
    document.body.style.overflow = "";
}

// --- Page setup ---

document.addEventListener("DOMContentLoaded", function () {
    // Tabs
    const tabs = document.querySelectorAll(".tab");
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            document.querySelectorAll(".panel").forEach(panel => panel.classList.remove("active"));
            document.getElementById(tab.dataset.target).classList.add("active");
        });
    });

    // Year switch
    const yearSwitch = document.getElementById("year-switch");
    yearSwitch.innerHTML = years.map(year =>
        `<button class="year-btn" data-year="${year}">${year}</button>`).join("");
    yearSwitch.addEventListener("click", e => {
        const btn = e.target.closest(".year-btn");
        if (!btn) return;
        currentYear = btn.dataset.year;
        renderData(currentYear);
    });

    // Donation search & sort
    document.getElementById("donor-search").addEventListener("input", () => renderDonations(currentYear));
    document.getElementById("donor-sort").addEventListener("change", () => renderDonations(currentYear));

    // Gallery filters & lightbox
    document.getElementById("gallery-filters").addEventListener("click", e => {
        const chip = e.target.closest(".chip");
        if (!chip) return;
        galleryFilter = chip.dataset.tag;
        renderGallery();
    });
    document.getElementById("gallery-grid").addEventListener("click", e => {
        const photo = e.target.closest(".photo");
        if (photo) openLightbox(Number(photo.dataset.index));
    });
    const lightbox = document.getElementById("lightbox");
    lightbox.querySelector(".lb-close").addEventListener("click", closeLightbox);
    lightbox.querySelector(".lb-prev").addEventListener("click", () => openLightbox(lightboxIndex - 1));
    lightbox.querySelector(".lb-next").addEventListener("click", () => openLightbox(lightboxIndex + 1));
    lightbox.addEventListener("click", e => { if (e.target === lightbox) closeLightbox(); });
    document.addEventListener("keydown", e => {
        if (lightbox.hidden) return;
        if (e.key === "Escape") closeLightbox();
        if (e.key === "ArrowLeft") openLightbox(lightboxIndex - 1);
        if (e.key === "ArrowRight") openLightbox(lightboxIndex + 1);
    });

    document.getElementById("footer-years").textContent =
        years.length > 1 ? `${years[years.length - 1]}–${years[0]}` : years[0];

    renderData(currentYear);
    renderGallery();

    // Splash screen: show once per visit
    const splashScreen = document.getElementById("splash-screen");
    let seen = false;
    try { seen = sessionStorage.getItem("splashSeen") === "1"; } catch (e) { }
    if (seen) {
        splashScreen.style.display = "none";
    } else {
        try { sessionStorage.setItem("splashSeen", "1"); } catch (e) { }
        setTimeout(() => {
            splashScreen.style.animation = "fadeOut 0.6s ease-out forwards";
            setTimeout(() => splashScreen.style.display = "none", 600);
        }, 1800);
    }
});
