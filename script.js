// Tab Switching
const tabs = document.querySelectorAll('.tab');
const contents = document.querySelectorAll('.content');

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

// Add a dynamic watermark with a timestamp
const watermark = document.querySelector('.watermark');
if (watermark) {
    setInterval(() => {
        const date = new Date();
        watermark.textContent = `DONATION LIST - ${date.toLocaleString()}`;
    }, 1000);
}

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        contents.forEach(content => content.classList.remove('active'));
        document.getElementById(tab.getAttribute('data-target')).classList.add('active');
    });
});

// --- Dynamic Data Logic ---

let currentYear = "2025";

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

function calculateTotal(year) {
    const data = pujaData[year];
    if (!data) return { donations: 0, expenditure: 0 };

    const totalDonations = data.donations.reduce((sum, item) => sum + item.amount, 0);
    const totalExpenditure = data.expenditure.reduce((sum, category) => sum + category.total, 0);

    return { donations: totalDonations, expenditure: totalExpenditure };
}

function renderData(year) {
    const data = pujaData[year];
    if (!data) return;

    // Render Donations
    const donationsTableBody = document.querySelector("#donations-table tbody");
    donationsTableBody.innerHTML = "";
    let totalDonations = 0;

    data.donations.forEach(item => {
        const row = `<tr>
            <td>${item.name}</td>
            <td>${item.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        </tr>`;
        donationsTableBody.innerHTML += row;
        totalDonations += item.amount;
    });

    // Update Donation Total
    const donationFooter = document.querySelector("#donations-table tfoot td:last-child strong");
    if (donationFooter) {
        donationFooter.textContent = totalDonations.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // Render Expenditure
    const expenditureTableBody = document.querySelector("#expenditure-table tbody");

    // Clear all rows first
    expenditureTableBody.innerHTML = "";
    let expenditureTotal = 0;

    data.expenditure.forEach(category => {
        let itemsHtml = "";
        if (category.items && category.items.length > 0) {
            itemsHtml = `<div class="breakdown" style="display: none;"><ul>`;
            category.items.forEach(item => {
                itemsHtml += `<li>${item.name}: ${item.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</li>`;
            });
            itemsHtml += `</ul></div>`;
        }

        const row = `<tr>
            <td>
                <span class="dropdown-toggle" onclick="toggleBreakdown(this)">${category.category}</span>
                ${itemsHtml}
            </td>
            <td>${category.total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        </tr>`;
        expenditureTableBody.innerHTML += row;
        expenditureTotal += category.total;
    });

    // Add Total Row
    const totalRow = `<tr>
        <td><strong>TOTAL</strong></td>
        <td><strong>${expenditureTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
    </tr>`;
    expenditureTableBody.innerHTML += totalRow;

    // Update Balance Table
    const balanceTableBody = document.querySelector("#balance-table tbody");
    if (balanceTableBody) {
        balanceTableBody.innerHTML = ""; // Clear existing rows

        // Calculate Carry Forward if 2025
        let carryForward = 0;
        if (year === "2025") {
            const totals2024 = calculateTotal("2024");
            carryForward = totals2024.donations - totals2024.expenditure;

            const carryForwardRow = `<tr>
                <td>Carry Forward (2024)</td>
                <td>${carryForward.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>`;
            balanceTableBody.innerHTML += carryForwardRow;
        }

        const totalCollectionRow = `<tr>
            <td>Total Collection (${year})</td>
            <td>${totalDonations.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        </tr>`;
        balanceTableBody.innerHTML += totalCollectionRow;

        const totalExpenditureRow = `<tr>
            <td>Total Expenditure (${year})</td>
            <td>${expenditureTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        </tr>`;
        balanceTableBody.innerHTML += totalExpenditureRow;

        const totalBalance = (totalDonations + carryForward) - expenditureTotal;
        const sign = totalBalance >= 0 ? "+" : "";

        const totalBalanceRow = `<tr>
            <td><strong>Total Balance</strong></td>
            <td><strong>${sign}${totalBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
        </tr>`;
        balanceTableBody.innerHTML += totalBalanceRow;
    }

    // Update Holders Table
    const holdersTableBody = document.querySelector("#holders-table tbody");
    if (holdersTableBody) {
        holdersTableBody.innerHTML = "";
        const holders = holdersData[year] || [];
        holders.forEach(holder => {
            const row = `<tr>
                <td>${holder.name}</td>
                <td>${holder.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>`;
            holdersTableBody.innerHTML += row;
        });
    }
}

document.addEventListener("DOMContentLoaded", function () {
    // Get all tab elements
    const tabs = document.querySelectorAll(".tab");
    const donationTab = document.querySelector("#donations");
    const expenditureTab = document.querySelector("#expenditure");

    // Initially show the 'Donations' div and set its tab as active
    if (donationTab) donationTab.style.display = "block";
    if (expenditureTab) expenditureTab.style.display = "none";

    tabs.forEach(tab => {
        tab.addEventListener("click", function () {
            // Remove the active class from all tabs
            tabs.forEach(t => t.classList.remove("active"));
            // Add active class to the clicked tab
            tab.classList.add("active");

            // Hide all tab content divs
            document.querySelectorAll("main > div").forEach(div => div.style.display = "none");

            // Show the clicked tab's content
            const target = tab.getAttribute("data-target");
            const targetDiv = document.getElementById(target);
            if (targetDiv) targetDiv.style.display = "block";
        });
    });

    // Year Selector
    const yearSelect = document.getElementById("year-select");
    if (yearSelect) {
        yearSelect.addEventListener("change", (e) => {
            currentYear = e.target.value;
            renderData(currentYear);
        });
    }

    // Initial Render
    renderData(currentYear);
});

document.addEventListener("DOMContentLoaded", function () {
    // Hide splash screen after 3 seconds
    setTimeout(() => {
        const splashScreen = document.getElementById("splash-screen");
        if (splashScreen) {
            splashScreen.style.animation = "fadeOut 1s ease-out forwards";
            setTimeout(() => {
                splashScreen.style.display = "none";
            }, 1000); // Wait for fade-out animation to finish
        }
    }, 3000); // 3 seconds delay
});


function toggleBreakdown(element) {
    const breakdown = element.nextElementSibling;
    if (breakdown) {
        if (breakdown.style.display === "none") {
            breakdown.style.display = "block";
        } else {
            breakdown.style.display = "none";
        }
    }
}
