// Tab Switching
const tabs = document.querySelectorAll('.tab');
const contents = document.querySelectorAll('.content');

// Disable PrintScreen functionality
document.addEventListener("keyup", function(event) {
    if (event.key === "PrintScreen") {
        alert("Screenshots are disabled on this page.");
        navigator.clipboard.writeText(""); // Clear clipboard
    }
});

// Disable right-click context menu
document.addEventListener("contextmenu", function(e) {
    e.preventDefault();
    alert("Right-click is disabled.");
});

// Disable common keyboard shortcuts
document.addEventListener("keydown", function(e) {
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
setInterval(() => {
    const date = new Date();
    watermark.textContent = `DONATION LIST - ${date.toLocaleString()}`;
}, 1000);

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        contents.forEach(content => content.classList.remove('active'));
        document.getElementById(tab.getAttribute('data-target')).classList.add('active');
    });
});

// Fetch Donations Data
async function fetchData(endpoint, tableId) {
    try {
        const response = await fetch(endpoint);
        const data = await response.json();

        const tableBody = document.getElementById(tableId);
        tableBody.innerHTML = '';

        data.forEach(row => {
            const tr = document.createElement('tr');
            Object.values(row).forEach(value => {
                const td = document.createElement('td');
                td.textContent = value;
                tr.appendChild(td);
            });
            tableBody.appendChild(tr);
        });
    } catch (error) {
        console.error('Error fetching data:', error);
    }
}

const donations = [
    { name: "Prabir Jena", amount: 2101 },
    { name: "Chiku Mohanty", amount: 2101 },
    { name: "Kuna Rout", amount: 4010 },
    { name: "Babul Mohanty", amount: 5000 },
    { name: "Ripu Mohanty", amount: 1500 },
    { name: "Chintu Panda", amount: 2500 },
    { name: "Abhilash Behura", amount: 500 },
    { name: "Kedar Jena", amount: 2000 },
    { name: "Bapi Rout", amount: 1000 },
    { name: "Gudu Barik", amount: 500 },
    { name: "Happy Sasheni", amount: 2000 },
    { name: "Balhu Barik", amount: 1000 },
    { name: "Bikuna Sabut", amount: 1000 },
    { name: "Silu Rout", amount: 1000 },
    { name: "Nitua Das", amount: 1500 },
    { name: "Jeevan Rout", amount: 2001 },
    { name: "Hapina Roul", amount: 1005 },
    { name: "Sania (Mohanty)", amount: 1010 },
    { name: "Banka Mohanty", amount: 500 },
    { name: "Kalia Jena", amount: 500 },
    { name: "Oka Mohanty", amount: 1000 },
    { name: "Papu Roul", amount: 1001 },
    { name: "Chuchu Sabut", amount: 1000 },
    { name: "Sagar Jena", amount: 1000 },
    { name: "Gunia Nana", amount: 2500 },
    { name: "Kargil Rout", amount: 2000 },
    { name: "Biswanath Jena", amount: 1000 },
    { name: "Tushar Roy", amount: 500 },
    { name: "Palu Rout", amount: 500 },
    { name: "Linku Mohanty", amount: 2500 },
    { name: "Aba Rout", amount: 1000 },
    { name: "Dhusia Das", amount: 500 },
    { name: "Gudu Mohanty", amount: 1000 },
    { name: "Chintua Mohanty", amount: 1000 },
    { name: "Nirakar Saseni", amount: 1001 },
    { name: "Papuna Sabut", amount: 1500 },
    { name: "Libuna Jena", amount: 700 },
    { name: "Lantu Saseni", amount: 1500 },
    { name: "Sagar Rout", amount: 3000 },
    { name: "Kumar Jena", amount: 2000 },
    { name: "Abha Mohanty", amount: 1000 },
    { name: "Jilu Das", amount: 3000 },
    { name: "Manguli Rout", amount: 1500 },
    { name: "Haun Bhai", amount: 1000 },
    { name: "Tulu Baba", amount: 1000 },
    { name: "Jilu Mohanty", amount: 1000 },
    { name: "Naba Das", amount: 1000 },
    { name: "Chinu Sethi", amount: 500 },
    { name: "Kumar Das", amount: 1000 },
    { name: "Felu Mohanty", amount: 305 },
    { name: "Hemanta Nayak", amount: 1000 },
    { name: "Jiban Das", amount: 3000 },
    { name: "Lipu Nana", amount: 350 },
    { name: "Vobi Rout", amount: 200 },
    { name: "Mitu Rout", amount: 500 },
    { name: "Budha Bhaina", amount: 101 },
    { name: "Akshay Swain", amount: 501 },
    { name: "Papuna Mohanty Cement", amount: 1000 },
    { name: "Papu Saseni", amount: 200 },
    { name: "Dillip Mohanty", amount: 500 },
    { name: "Rabina Das", amount: 200 },
    { name: "Sima Textile", amount: 305 },
    { name: "Bichitra Swain", amount: 510 },
    { name: "Nanda Das", amount: 1000 },
    { name: "Tapan Mohanty", amount: 500 },
    { name: "Ramakanta Panda", amount: 501 },
    { name: "Dillip Barik", amount: 205 },
    { name: "Mangua Bhai", amount: 1000 },
    { name: "Dolia Das", amount: 500 },
    { name: "Lipu Rout (Bhagia)", amount: 200 },
    { name: "Tuna Rout", amount: 501 },
    { name: "Basanta Nayak", amount: 1001 },
    { name: "Trilochan (Lipu)", amount: 1000 },
    { name: "Tanu Rout", amount: 500 },
    { name: "Amara Das", amount: 500 },
    { name: "Kunu Jena", amount: 500 },
    { name: "Aju Saseni", amount: 100 },
    { name: "Badal Saseni", amount: 200 },
    { name: "Sagar Behera", amount: 1000 },
    { name: "Lipu Mohanty (Kalaghara)", amount: 500 },
    { name: "Butu Panda", amount: 500 },
    { name: "Papu Roul", amount: 1000 },
    { name: "Siba Panda", amount: 200 },
    { name: "Rabi Saseni", amount: 500 },
    { name: "Total", amount: 90510}
];

const tableBody = document.querySelector("#donations-table tbody");
donations.forEach(item => {
    const row = `<tr>
        <td>${item.name}</td>
        <td>${item.amount}</td>
    </tr>`;
    tableBody.innerHTML += row;
});

