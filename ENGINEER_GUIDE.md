# AAC Technical Services — Engineer User Guide

## Role Overview

The Engineer role has full technical authority in the AACTS system, including issuing Certificates of Release to Service (CRS), managing aircraft, rectifying defects, and approving crew attendance. Only Admin has more privileges.

---

## 1. Getting Started

### Login
1. Open the app at `https://thisaxx.github.io/aacts/`
2. Select your name from the dropdown
3. Enter your **PIN** (default: `1234`)
4. Tap **Sign In**

The sidebar shows your name and role at the top.

---

## 2. Daily CRS

A Daily CRS must be issued every day before the aircraft can fly. Without it, the aircraft shows as **Grounded** on the dashboard.

### Issue Daily CRS
- If no CRS has been issued today, a **"Issue Daily CRS"** button appears on the dashboard
- Tap it to sign off the aircraft as airworthy for the day
- This also clears the `groundedAfterInspection` flag if it was set

### After CRS
- The aircraft status returns to **Airworthy** (or **Caution** if near an inspection limit)
- The button disappears until the next day

---

## 3. Dashboard

The dashboard gives you at-a-glance fleet status:

- **Aircraft status** — Airworthy (green), Caution (orange, ≤5h to inspection), Grounded (red), Airborne (blue)
- **Inspection countdown** — 50hr and 100hr remaining hours
- **Open tasks & defects** — number of open work orders and squawks
- **Low stock alerts** — parts below minimum, fuel low
- **Quick actions** — navigate to Flights, Defects, Maintenance, Stock

---

## 4. Fleet Manager

Only Engineer, Admin, and Production Planner can access Fleet Manager.

### Add an Aircraft
1. Sidebar → **Fleet Manager**
2. Tap **+ Add New Aircraft**
3. Enter **Tail Number** (e.g. `4R-EXA`)
4. Enter **Aircraft Type** (e.g. `Cessna 152`)
5. Set **Engine TBO** and **Prop TBO** limits
6. Tap **Create Aircraft**

### Edit an Aircraft
- Tap **Edit** on any aircraft row
- Update tail number, type, tach time, inspection baselines, TBO limits
- If you change the tail number, all related records (flights, defects, tasks) are updated

### Delete an Aircraft
- Tap **×** on an aircraft row
- Confirm deletion
- If the deleted aircraft was the current one, the system switches to the first remaining aircraft

### Set Default Aircraft
- Tap **☆ Set Default** on any aircraft
- The default aircraft is selected automatically on next load

### Upload Photo
- Tap **Photo** on an aircraft row
- Choose from camera or gallery

---

## 5. Defects (Squawks)

### View Defects
- Bottom nav → **Mx/Defects** → Defects tab
- Shows all open defects for the current aircraft
- Grounding defects highlighted in red

### Report a Defect
1. Tap **+ Report Squawk**
2. Enter description
3. Set urgency: **Grounding** (grounds aircraft immediately) or **Normal**
4. Assign to a crew member
5. Tap **Report**

### Resolve a Defect
- Tap **Resolve** on an open defect
- Enter resolution notes
- The defect is marked as **resolved** (closed)

### Delete a Defect
- Tap **×** on a defect card
- Only Engineer and Admin can delete defects

---

## 6. Maintenance & Sign-offs

Bottom nav → **Mx/Defects** → Work tab

### Task Types
| Task | Description |
|------|-------------|
| **50hr Oil Change** | Auto-created when 50hr interval is due; deducts 1 oil filter + 6qt oil from parts |
| **100hr Structural** | Auto-created when 100hr interval is due |
| **After-flight Inspection** | Auto-created after every flight |
| **Grounding Defect Task** | Auto-created when a grounding defect is reported |
| **Manual Work Order** | Created manually from the Work tab |

### Sign Off a Task
1. Tap the task to open details
2. Tap **Sign Off**
3. Select outcome: **Serviceable** or **Unserviceable**
4. Enter notes
5. Confirm with your PIN

### Issue CRS on a Task
- **Only Engineer and Admin** can issue CRS
- After rectification, tap **Release to Service**
- This signs the task off with full CRS authority
- **Production Planner CANNOT issue CRS**

### Overhaul
- Tap **Overhaul Engine** to reset Engine TSO to 0
- Tap **Overhaul Propeller** to reset Prop TSO to 0

---

## 7. Flight Operations

### Log a Flight
1. Bottom nav → **Log Flights**
2. Tap **+ New Flight**
3. Fill in pilot, tach start/end, route, remarks
4. Fuel gauges (Before Left/Right, After Left/Right) auto-calculate fuel used and consumption
5. Tap **Save Flight**
   - ETSO / PTSO auto-increment
   - Bulk Avgas 100LL deducted
   - After-flight inspection auto-created
   - 50hr / 100hr intervals updated

### Delete a Flight
- Tap **×** on a flight card
- Confirms deletion
- ETSO, PTSO, tach time, and inspection baselines are rolled back

### Departure Form
- When aircraft is **grounded** (grounding defect, overdue inspection, no daily CRS), the departure form is **disabled** with a reason shown

---

## 8. Crew & Attendance

Sidebar → **Crew**

### Approve / Reject Attendance
1. View pending sign-ins
2. Tap **Approve** or **Reject**
3. Approved users show as **On Duty** on the Live Feed and Crew Board

### Crew Board
- Shows all users with today's attendance status
- **On Duty** (approved), **Pending**, or not signed in
- Avatars shown for users who have uploaded a photo

---

## 9. Parts & Inventory

Bottom nav → **Parts**

### Manage Stock
- View all parts with quantity on hand and minimum safe level
- **+ / –** buttons adjust quantity
- Tap the number to type a value directly
- **Red text** = below minimum stock
- **×** deletes the part

### Add a Part
- Tap **+ Add Part**
- Enter part number, description, quantity, minimum level

### Fuel Stock
- Shows Avgas 100LL, Mogas, Mix with progress bars
- **Record Fuel Delivery** — log new fuel into stock
- Fuel is auto-deducted by flight logging

---

## 10. Live Feed

Sidebar → **Live Feed**

Shows real-time operational status:
- **Airborne flights** — aircraft currently departed (pulsing blue dot with ETA progress)
- **On-duty crew** — approved sign-ins with avatars
- **Today's activity** — recent flights, defect reports, CRS sign-offs
- Auto-refreshes every 15 seconds

---

## 11. Reports & Export

Sidebar → **Export / Tech Log**

### Export PDF Report
1. Select date range and aircraft filter
2. Check the data types to include (flights, defects, tasks, etc.)
3. Tap **Generate PDF Report**
4. A multi-page PDF is downloaded

### Daily Tech Log Summary
- Tap **Daily Tech Log Summary**
- Generates a one-page PDF with today's flights, tasks, defects, and aircraft status
- Useful for end-of-day sign-off records

---

## 12. Role Permissions Summary

| Function | Admin | Engineer | Prod Planner | Sr Tech | Tech | Pilot | Guest |
|----------|-------|----------|-------------|---------|------|-------|-------|
| **CRS (Release)** | Yes | **Yes** | No | No | No | No | No |
| **Rectify Tasks** | Yes | **Yes** | Yes | Yes | No | No | No |
| **Fleet Manager** | Yes | **Yes** | Yes | No | No | No | No |
| **Delete Flights** | Yes | **Yes** | Yes | No | No | No | No |
| **Manage Parts** | Yes | **Yes** | Yes | No | No | No | No |
| **Manage Fuel** | Yes | **Yes** | Yes | No | No | No | No |
| **Attendance Approve** | Yes | **Yes** | Yes | Yes | No | No | No |
| **Factory Reset** | Yes | No | No | No | No | No | No |
| **All Read-Only** | No | No | No | No | No | No | Yes |

---

## 13. Offline Mode

- The app works **fully offline** — all data is stored in IndexedDB
- A sync badge in the top header shows connection status:
  - **✓** — connected and synced
  - **↻N** — N items waiting to sync
  - **✕** — offline
- Changes made offline sync automatically when connectivity is restored
- Firebase handles real-time sync across all devices

---

## 14. Key Engineer Responsibilities

1. **Issue Daily CRS** every day before operations
2. **Sign off inspections** (50hr, 100hr, after-flight)
3. **Rectify and release** maintenance tasks
4. **Resolve defects** and manage grounding squawks
5. **Manage aircraft** — add/edit/delete fleet entries
6. **Approve crew attendance**
7. **Oversee inventory** — parts and fuel stock levels
8. **Generate reports** — daily tech logs and data exports

*Issued: May 2026*
