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
    { name: "Abaduta Rout", amount: 1000 },
    { name: "Abhilash Behera", amount: 500 },
    { name: "Abhisek Mohanty", amount: 2500 },
    { name: "Aditya Barik", amount: 500 },
    { name: "Agasti Mohanty", amount: 500 },
    { name: "Ajaya Roul", amount: 1005 },
    { name: "Ajaya Saseni", amount: 100 },
    { name: "Akshya Swain", amount: 501 },
    { name: "Asish Ku Rout", amount: 2000 },
    { name: "Asish Rout", amount: 500 },
    { name: "Ayashkanta Panda", amount: 2500 },
    { name: "Badal Saseni", amount: 200 },
    { name: "Basanta Nayak", amount: 1001 },
    { name: "Bhubanananda Rout", amount: 200 },
    { name: "Bibekananda Sabut", amount: 1000 },
    { name: "Bichitra Swain", amount: 510 },
    { name: "Biman Sabut", amount: 1000 },
    { name: "Biswojit Das", amount: 3750 },
    { name: "Biswonath Jena", amount: 1000 },
    { name: "Debasish Mohanty", amount: 1000 },
    { name: "Debiduta Mohanty", amount: 1000 },
    { name: "Dilip Barik", amount: 205 },
    { name: "Dilip Mohanty", amount: 500 },
    { name: "Dinesh Mohanty", amount: 1500 },
    { name: "Dolagobinda Das", amount: 500 },
    { name: "Dushasana Das", amount: 500 },
    { name: "Er Chinmaya Sethi", amount: 500 },
    { name: "Gourisankar Mohanty", amount: 1000 },
    { name: "Gunia Nana", amount: 2500 },
    { name: "Hemanta Nayak", amount: 1000 },
    { name: "Janmajya Mohanty", amount: 500 },
    { name: "Jigyansa Jeevan Rout", amount: 2001 },
    { name: "Jitendra Mohanty", amount: 1000 },
    { name: "Kalia Jena", amount: 500 },
    {name: "Kalia Rout", amount: 1000 },
    { name: "Kirti Ramjan Jethy", amount: 300 },
    { name: "Krushna Das", amount: 50 },
    { name: "KumarMani Jena", amount: 2000 },
    { name: "Kuna Rout", amount: 4010 },
    { name: "Kunu Jena", amount: 500 },
    { name: "Lagnajit Jena", amount: 700 },
    { name: "Lalatendu Saseni", amount: 1500 },
    { name: "Lipu Saseni", amount: 350 },
    { name: "Lipuranjan Rout", amount: 200 },
    { name: "Mangaraj Roul", amount: 1000 },
    { name: "Nabaghana Das", amount: 1000 },
    { name: "Nanda Das", amount: 1000 },
    { name: "Nirakar Saseni", amount: 1001 },
    { name: "Nitua Das", amount: 1500 },
    { name: "Padarbinda Mohanty", amount: 500 },
    { name: "Papu Sabuta", amount: 2200 },
    { name: "Papu Saseni", amount: 200 },
    { name: "Papuna Mohanty", amount: 1000 },
    { name: "Priyabrata Das", amount: 3000 },
    { name: "Pintu Panda", amount: 501 },
    { name: "Pintuna Das", amount: 2370 },
    { name: "Prabash Sabut", amount: 1500 },
    { name: "Prabir Ku Jena", amount: 2101 },
    { name: "Prasanjit Mohanty", amount: 5000 },
    { name: "Prasant Rout", amount: 1000 },
    { name: "Pratap Behera", amount: 1000 },
    { name: "Priyabrata Mohanty", amount: 305 },
    { name: "Rabina Das", amount: 200 },
    { name: "Rabindra Saseni", amount: 500 },
    { name: "Rajesh Barik", amount: 1000 },
    { name: "Rajib Ku Das", amount: 500 },
    { name: "Sachikanta Mohanty", amount: 1000 },
    { name: "Sagar Behera", amount: 1000 },
    { name: "Sagar Jena", amount: 1000 },
    { name: "Sagar Mohanty", amount: 2101 },
    { name: "Sagar Rout", amount: 3000 },
    { name: "Sanjaya Roul", amount: 2000 },
    { name: "Sanjeeb Das", amount: 1000 },
    { name: "Santosh Roul", amount: 500 },
    { name: "Sarbjit Mohanty", amount: 1010 },
    { name: "Sima Textiles", amount: 305 },
    { name: "Somya Ranjan Jena", amount: 2000 },
    { name: "Subrajit Saseni", amount: 2000 },
    { name: "Sumanta Mohanty", amount: 3200 },
    { name: "Sumanta Rout", amount: 500 },
    { name: "Suryakanta Rout", amount: 1000 },
    { name: "Suryakanta Sethi", amount: 1000 },
    { name: "Tanmaya Rout", amount: 500 },
    { name: "Tapan Mohanty", amount: 500 },
    { name: "Trilochan Rout", amount: 1000 },
    { name: "Tulu Sethi", amount: 1000 },
    { name: "Tuna Rout", amount: 501 },
    { name: "Tushar Panda", amount: 500 },
    { name: "Tushar Rnj Mohanty", amount: 630 },
    { name: "Tushar Rout", amount: 1500 },
    { name: "Tushar Roy", amount: 500 },
   
];




const tableBody = document.querySelector("#donations-table tbody");
donations.forEach(item => {
    const row = `<tr>
        <td>${item.name}</td>
        <td>${item.amount}</td>
    </tr>`;
    tableBody.innerHTML += row;
});






document.addEventListener("DOMContentLoaded", function () {
    // Get all tab elements
    const tabs = document.querySelectorAll(".tab");
    const donationTab = document.querySelector("#donations");
    const expenditureTab = document.querySelector("#expenditure");

    // Initially show the 'Donations' div and set its tab as active
    donationTab.style.display = "block";
    expenditureTab.style.display = "none";

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
            document.getElementById(target).style.display = "block";
        });
    });
});

document.addEventListener("DOMContentLoaded", function () {
    // Hide splash screen after 3 seconds
    setTimeout(() => {
        const splashScreen = document.getElementById("splash-screen");
        splashScreen.style.animation = "fadeOut 1s ease-out forwards";
        setTimeout(() => {
            splashScreen.style.display = "none";
        }, 1000); // Wait for fade-out animation to finish
    }, 3000); // 3 seconds delay
});


function toggleBreakdown(element) {
    const breakdown = element.nextElementSibling;
    if (breakdown.style.display === "none") {
        breakdown.style.display = "block";
    } else {
        breakdown.style.display = "none";
    }
}
