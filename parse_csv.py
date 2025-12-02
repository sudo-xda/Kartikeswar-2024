import csv
import json

def parse_currency(value):
    if not value:
        return 0
    if isinstance(value, str):
        clean_val = value.replace(',', '').replace('"', '').strip()
        if clean_val in ['-', '-  ', '']:
            return 0
        try:
            return int(float(clean_val))
        except ValueError:
            return 0
    return value

donations_2025 = []
donations_2024 = []
expenditures_2025 = []
expenditures_2024 = []

current_category_2025 = None
current_items_2025 = []
current_category_2024 = None
current_items_2024 = []

with open('PUJA Final 2025.csv', 'r', encoding='utf-8') as f:
    reader = csv.reader(f)
    rows = list(reader)

# Process Expenditure
for i in range(1, 145):
    if i >= len(rows): break
    row = rows[i]
    if len(row) < 5: continue
    
    col_b = row[1].strip() if row[1] else ""
    col_c = row[2].strip() if row[2] else ""
    amount_2025 = parse_currency(row[3])
    amount_2024 = parse_currency(row[4])
    
    if col_b.isdigit():
        # Save previous category
        if current_category_2025:
            expenditures_2025.append({
                "category": current_category_2025,
                "items": current_items_2025,
                "total": sum(item['amount'] for item in current_items_2025)
            })
        if current_category_2024:
            expenditures_2024.append({
                "category": current_category_2024,
                "items": current_items_2024,
                "total": sum(item['amount'] for item in current_items_2024)
            })
            
        current_category_2025 = col_c
        current_items_2025 = []
        current_category_2024 = col_c
        current_items_2024 = []
    
    elif col_c and col_c.lower() != "total" and current_category_2025:
        if amount_2025 > 0:
             current_items_2025.append({"name": col_c, "amount": amount_2025})
        if amount_2024 > 0:
             current_items_2024.append({"name": col_c, "amount": amount_2024})

# Append last category
if current_category_2025:
    expenditures_2025.append({
        "category": current_category_2025,
        "items": current_items_2025,
        "total": sum(item['amount'] for item in current_items_2025)
    })
if current_category_2024:
    expenditures_2024.append({
        "category": current_category_2024,
        "items": current_items_2024,
        "total": sum(item['amount'] for item in current_items_2024)
    })

# Process Donations
start_row_donations = -1
for i, row in enumerate(rows):
    if len(row) > 2 and "Name Donoer" in str(row):
        start_row_donations = i + 1
        break

if start_row_donations != -1:
    for i in range(start_row_donations, len(rows)):
        row = rows[i]
        if len(row) < 5: continue
        
        name = row[2].strip()
        if not name: continue
        
        amount_2025 = parse_currency(row[3])
        amount_2024 = parse_currency(row[4])
        
        if amount_2025 > 0:
            donations_2025.append({"name": name, "amount": amount_2025})
        if amount_2024 > 0:
            donations_2024.append({"name": name, "amount": amount_2024})

output = {
    "2025": {
        "donations": donations_2025,
        "expenditure": expenditures_2025
    },
    "2024": {
        "donations": donations_2024,
        "expenditure": expenditures_2024
    }
}

with open('data.js', 'w', encoding='utf-8') as f:
    f.write("const pujaData = ")
    json.dump(output, f, indent=2)
    f.write(";")
