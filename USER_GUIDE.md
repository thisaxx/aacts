# AAC — Flight School Maintenance & Inventory PWA

## User Guide

---

## 1. Installing on Mobile (PWA)

### Android (Chrome)
1. Open `https://thisaxx.github.io/aacts/` in Chrome
2. Tap the **⋮ menu** (top-right)
3. Tap **"Add to Home screen"**
4. Name it "AAC" and tap **Add**
5. The app launches full-screen, offline-ready

### iOS (Safari)
1. Open the app URL in Safari
2. Tap the **Share icon** (bottom toolbar)
3. Scroll down and tap **"Add to Home Screen"**
4. Tap **Add** (top-right)
5. Opens as a standalone app with no browser chrome

### Desktop (Chrome/Edge)
1. Click the **install icon** (right side of address bar)
2. Click **Install**

Once installed, the app works fully offline. Internet is only needed for syncing.

---

## 2. First Launch — Setting Up

### Set Your Name & Role
1. Tap the **☰ hamburger menu** (top-left) to open the sidebar
2. Tap **My Profile**
3. Enter your name and select your role:
   - **Technician** — basic user, no special privileges
   - **Senior Technician** — can sign off after-flight inspections, resolve defects, approve attendance
   - **Engineer** — can issue CRS, manage aircraft, resolve defects, approve attendance
   - **Admin** — full access to everything
4. Selecting Senior Technician, Engineer, or Admin requires the **pincode** (default: `1234`)

### Add Your First Aircraft
1. Open the **☰ sidebar** → **Manage Aircraft**
2. Tap **+ Add Aircraft**
3. Enter the tail number (e.g. `C-152-003`)
4. Set Engine TBO and Prop TBO limits
5. Optionally take or upload a photo
6. Tap **Save**
7. Only **Engineer** or **Admin** can add/delete aircraft

---

## 3. Navigation

### Sidebar (☰)
| Item | What it does |
|------|--------------|
| **Home** | Dashboard — aircraft overview, stats, recent flights |
| **Calendar & History** | Browse all records by date: flights, defects, maintenance, fuel, attendance |
| **Attendance** | Check in to a job site; approve/reject check-ins |
| **My Profile** | View/change your name, role, pincode |
| **Manage Aircraft** | Add/delete aircraft (engineer/admin only) |
| **Change Pincode** | Update the security pincode |
| **Reset All Data** | Wipes everything from local storage + Firebase |

### Bottom Navigation (mobile)
- **✈️ Flights** — log flights & view history
- **⚠️ Squawks** — report defects
- **🔧 Work** — maintenance tasks & CRS
- **📦 Stock** — parts inventory & fuel stock

---

## 4. Home Dashboard

- **Aircraft photo** — tap to change (camera or gallery)
- **Live status** — green "Flightworthy", red "Grounded", or orange "Caution"
  - Grounded if: open grounding defect, inspection overdue, after-flight inspection pending, **or no daily CRS issued**
- **Daily CRS button** — appears for Engineer/Admin if no CRS issued today
- **Stats grid** — flights, total hours, open tasks, low stock alerts
- **Quick actions** — Log Flight, Squawks, Work, Stock
- **Interval bars** — 50hr oil change, 100hr structural
- **Inspection notifications** — toasts when 50hr/100hr interval is due or overdue
- **Sidebar countdown** — shows live 50hr/100hr remaining hours

### Switching aircraft
Use the dropdown in the header, or open **Manage Aircraft** from sidebar.

---

## 5. Flights Tab

### Log a Flight
1. Tap **+ New Flight**
2. Fill in:
   - **Date** (defaults to today)
   - **Takeoff Time / Landing Time** (HH:MM format) — duration auto-calculated
   - **Before Left / Before Right** — wing fuel before flight (gallons)
   - **After Left / After Right** — wing fuel after flight (gallons)
   - **Fuel used** (total gallons) auto-calculated
   - **Fuel consumption** (gal/hr) auto-calculated
3. Tap **Save Flight**
   - ETSO / PTSO automatically increment
   - Bulk fuel stock automatically deducted (Avgas 100LL)
   - 50hr / 100hr intervals updated
   - **After-flight inspection task** auto-created — must be signed off by Senior Technician or Engineer

### View Flight History
Scroll the list — each card shows date, times, duration, fuel.

### Delete a Flight
Tap the **×** on a flight card, confirm.
- ETSO / PTSO are reversed (clamped at 0)
- Fuel stock is NOT reversed

---

## 6. Squawks Tab (Defects)

### Report a Defect
1. Tap **+ Report Squawk**
2. Enter a description
3. Choose severity:
   - **Grounding** — aircraft immediately grounded, auto-creates critical maintenance task
   - **Monitor** — flagged for attention
4. Tap **Report**

### Resolve a Defect
- Only **Engineer** or **Senior Technician** can resolve defects
- Tap **Resolve** on an open defect

### Delete a Defect
- Only **Engineer** or **Admin** can delete defects

---

## 7. Work Tab (Maintenance)

### Maintenance List
Shows all tasks for the current aircraft:
- **50hr Oil Change** and **100hr Structural** intervals auto-generate tasks
  - Tap **Sign Off** to complete them
  - 50hr sign-off automatically deducts 1 oil filter + 6 quarts oil from parts inventory
- **Grounding** defects auto-create critical tasks (red highlight)
- **After-flight inspections** — auto-created after each flight

### Certificate of Release to Service (CRS)
- Only **Engineer** or **Admin** can issue CRS on maintenance tasks
- **Daily CRS** — Engineer/Admin must issue each day from the dashboard for aircraft to be flightworthy
- After-flight inspections can be signed by **Senior Technician** or **Engineer**

### Work Orders
Tap a task to open:
- **Rectify** — add repair notes
- **Release to Service** — sign off with role, name, timestamp
- **Overhaul Engine / Propeller** — resets ETSO / PTSO to 0

---

## 8. Stock Tab

### Parts Inventory
- Table of parts (Part #, Description, On Hand, Min)
- **+ / –** buttons adjust quantity
- Tap the number to type a value directly
- **Red text** = low stock (below minimum)
- **×** deletes the part

### Add a Part
Tap **+ Add Part**, enter part number, description, quantity, min level.

### Bulk Fuel Stock
Shows Avgas 100LL, Mogas, Mix levels with progress bars.
- **+ / –** buttons adjust stock by 10L
- Tap the number to type directly
- **×** deletes that fuel type

### Record a fuel delivery
1. Tap **Record Fuel Delivery**
2. Pick type (Avgas 100LL, Mogas, or Mix)
3. Enter liters
4. Saves to fuel log + adds to stock

### Fuel History
Scroll down to see all fuel deliveries and refuel deductions.

---

## 9. Attendance

1. Open **Attendance** from the sidebar
2. Tap **Check In**, select your job site, add optional notes
3. Your check-in appears as **Pending**
4. **Senior Technician**, **Engineer**, or **Admin** can approve or reject requests
5. Approved check-ins show in the attendance history

---

## 10. Calendar & History

1. Open **Calendar & History** from the sidebar
2. Pick a date to view all records for that day:
   - Flights
   - Defects / Squawks
   - Maintenance tasks
   - Fuel logs
   - Attendance records
3. All records are merged into a single timeline

---

## 11. Online Sync (Firebase)

- The app works **fully offline** — data stores in IndexedDB
- When online, data syncs in real-time via **Firebase Firestore**
- A **sync badge** (top header) shows:
  - **Green ✓** — connected and synced
  - **Red ✕** — offline
- Anonymous authentication — no account needed
- All data syncs across devices automatically via `onSnapshot` listeners

---

## 12. ETSO / PTSO

- Shown on the dashboard with progress bars
- Set TBO limits when adding an aircraft
- Each logged flight **automatically adds** flight duration to ETSO and PTSO
- When TBO is exceeded, the bar turns red
- **Overhaul** in the work order resets to 0

---

## 13. Fuel Basics

- **Wing fuel** is measured in **gallons** (USG) — what you put in the plane
- **Bulk stock** is measured in **liters** — what's in the fuel bowser/tank
- When you log a flight, gallons used are **auto-converted to liters** (× 3.78541) and deducted from bulk Avgas 100LL stock
- To add bulk stock, go to **Stock** tab → **Record Fuel Delivery**

---

## 14. Tips

- **Refresh** if the UI looks stuck — everything reloads from IndexedDB
- **Clear all data**: Open sidebar → **Reset All Data** — wipes everything locally and in Firebase
- **Switch aircraft** using the header dropdown
- **Delete an aircraft** via Manage Aircraft — only Engineer/Admin
- **Photo upload** uses camera on mobile; gallery/choose-file on desktop
- **Change pincode** from sidebar to customize the security code
- **Default pincode** is `1234`
