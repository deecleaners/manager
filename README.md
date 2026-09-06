# Dee Cleaners — Business Management System

A complete business management system for **Dee Cleaners**, a cleaning-services
company based in Magomeni, Mikumi (Tanzania): cleaning, sofa cleaning, laundry,
specialized services (shoes, sewer, carpet, fumigation, gardening) and
househelp placement. Built from the company's own catalog
(`DEE CLEANERS CATALOG SERVICES.pdf`), client form (`HOUSEHELP CLIENT FORM.pdf`)
and logo (see `../dee_manager/`).

**Google Sheets is the single source of truth.** The web app never stores
business data itself — it reads and writes the workbook through a small JSON
API.

## Live system

| Piece | Where |
|---|---|
| **Web app (frontend)** | https://deecleaners.github.io/manager/ *(enabled via GitHub Pages)* |
| **API (Apps Script)** | `https://script.google.com/macros/s/AKfycbxgewP_sTZEsqdfVp6Eqz_rZLYcg3LrdEaFgcWgn9z-rh6F2aAwWfUbIlyU2oefw2X0/exec` (deployment `AKfycbxgewP…`) |
| **Backend code** | this repo, `webapp/backend/Code.gs` — pasted into the Apps Script project bound to the Sheets workbook (also shared as library `1-8YiK-LBlVAgvX-9YeYRSDt7CbTP4JWPzvzXD7kSkY0KoUI3rWzZAlE4`) |
| **Source code** | https://github.com/deecleaners/manager |

The frontend ships with the live API URL pre-filled — on first open, just
press **Connect** (Settings ▸ API to change it per device).

> ⚠️ **After changing `Code.gs`:** paste the new code into the Apps Script
> project, then **Deploy ▸ Manage deployments ▸ ✎ Edit ▸ Version: New
> version** — the web app runs a frozen snapshot and does not pick up code
> changes automatically. If the backend is referenced as a library, update
> the library version in the bound project as well.

```
dee_cleaners_system/
├── Dee_Cleaners_Management.xlsx   ← the workbook (built by the script below)
├── build_dee_cleaners.py          ← builds the workbook (openpyxl)
├── contracts/
│   ├── generate_contracts.py      ← bilingual househelp agreements (python-docx + reportlab)
│   └── Dee_Cleaners_Househelp_Agreement_EN/SW.docx|.pdf
├── assets/dee_cleaners_logo/      ← brand logo files
└── webapp/
    ├── backend/Code.gs            ← Google Apps Script backend (JSON API)
    ├── dev/mock-server.js         ← zero-dependency Node mock of Code.gs (dev/demo)
    └── frontend/                  ← the app itself (vanilla JS PWA, no build step)
```

## 1. Quick demo (no Google account needed)

```bash
node webapp/dev/mock-server.js     # serves the app + API on http://localhost:8787
```

Open **http://localhost:8787/?api=http://localhost:8787/api** — the `?api=`
override points the app at the mock server instead of the live deployment.
(Or open the app normally and set the API URL in Settings ▸ API.)

The mock server keeps data in memory only (restart = reset) and ignores the
API key. It is an exact twin of `Code.gs` — same actions, same responses —
so it is also how you test changes before deploying to Google Sheets.

## 2. Real deployment (Google Sheets + Apps Script)

1. **(Re)build the workbook** (optional — only needed when the schema changes):

   ```bash
   pip install openpyxl
   python3 build_dee_cleaners.py
   ```

2. Upload `Dee_Cleaners_Management.xlsx` to Google Drive and open it in
   Google Sheets → **File ▸ Save as Google Sheets**.
3. **Extensions ▸ Apps Script** — delete the default code, paste the contents
   of `webapp/backend/Code.gs`, save the project (e.g. "Dee Cleaners API").
4. *(Optional)* set an API key: **Project Settings ▸ Script Properties ▸
   Add property** — `DEE_CLEANERS_API_KEY` = your secret. The API then
   requires that key on every request.
5. **Deploy ▸ New deployment ▸ Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** *(if the app shows a Google login page
     instead of the Connect screen, the deployment is set to "Only myself"
     or "Anyone with Google account" — edit the deployment and set
     "Who has access" to "Anyone".)*
   - Copy the **Web app URL** — this is your API URL.

The backend is self-healing: on first request it makes sure every sheet,
header row and Settings list section exists (idempotent — it never touches
existing records).

## 3. Serving the app (frontend)

The frontend is a set of static files (`webapp/frontend/`) — no build step.
Host them anywhere:

- **Dev:** the mock server already serves them at `http://localhost:8787`.
- **Production:** upload the folder to any static host (Netlify, GitHub Pages,
  Drive via the Apps Script `doGet`…). The PWA service worker only activates
  on `https:`.

On first open the app shows the **Connect** screen: paste the Apps Script
Web App URL from step 2.5 (and the API key, if you set one) and press
Connect. The URL/key are saved in the browser (localStorage) per device and
can be changed later in **Settings ▸ API**.

> If you edit `sw.js` cache list or any cached asset, bump `CACHE` in `sw.js`
> so returning devices pick up the new files.

## 4. Data model (workbook sheets)

| Sheet | Purpose |
|---|---|
| `Settings` | Business info + editable reference lists (services, statuses, payment methods…) |
| `Orders` | Service orders. Grey columns (Total, Balance, Payment Status, Net Profit, Order ID, Customer Helper) are formulas — the API never writes them |
| `Customers` | Aggregated from Orders automatically on every read |
| `Payments` | Customer payments (syncs the linked order's Amount Paid) |
| `Expenses` | Operating expenses by category |
| `Househelps` / `Employers` | Househelp registry / employer (client) registry |
| `Placements` | Househelp ↔ employer placements with salary and agency fee |
| `Contracts` | Placement agreements (printable agreement built into the app) |
| `Househelp Payments` | Salary disbursements — kept separate from cleaning revenue |
| `Complaints` / `Replacements` | Dispute handling and replacement requests |
| `Attendance` | Staff / worker / househelp attendance |
| `Dashboard` | Live KPI formulas |
| `Archive` | Deleted orders are archived here — never permanently removed |

## 5. API contract

Everything is one endpoint. `POST` a JSON body (the app sends it as
`text/plain`):

```json
{ "action": "listOrders", "data": { "search": "Rose" }, "key": "optional" }
```

Response is always HTTP 200 with `{ "ok": true, "data": … }` or
`{ "ok": false, "error": "…" }`. Actions:

- Settings/lists: `getSettings`, `updateSettings`, `addList`, `renameList`,
  `deleteList`, `updateList`
- Orders: `listOrders`, `createOrder`, `updateOrder`, `deleteOrder` (archives)
- Customers: `listCustomers`, `getCustomer`, `getCustomerOrders`
- Payments: `listPayments`, `createPayment`, `updatePayment`, `deletePayment`
- Expenses: `listExpenses`, `addExpense`, `updateExpense`, `deleteExpense`
- Househelps: `listHousehelps`, `createHousehelp`, `updateHousehelp`,
  `archiveHousehelp`
- Employers: `listEmployers`, `createEmployer`, `updateEmployer`
- Placements: `listPlacements`, `createPlacement`, `updatePlacement`,
  `terminatePlacement`
- Contracts: `listContracts`, `createContract`, `updateContract`,
  `terminateContract`
- Househelp payments: `listHousehelpPayments`, `createHousehelpPayment`,
  `updateHousehelpPayment`
- Complaints: `listComplaints`, `createComplaint`, `updateComplaint`,
  `resolveComplaint`
- Replacements: `listReplacements`, `createReplacement`, `updateReplacement`
- Attendance: `listAttendance`, `createAttendance`, `updateAttendance`
- Reports: `getDashboard`, `getReport` (`daily`, `weekly`, `monthly`,
  `yearly`, `pnl`, `outstanding`, `customers`, `services`, `laundry`,
  `househelps`, `placements`, `contracts`, `complaints`, `replacements`,
  `payments` — all respect `from`/`to` dates)

`webapp/dev/mock-server.js`, `webapp/backend/Code.gs` and the frontend are
kept in lockstep — when you change one, change the other two.

## 6. Contracts

```bash
pip install python-docx reportlab
python3 contracts/generate_contracts.py
```

Generates the English and Swahili househelp agreements as `.docx` and `.pdf`.
The same terms are also available in-app: **Contracts ▸ Print Agreement**.

## 7. Rules the system enforces

- Orders' formula columns are never overwritten by the API; deleting an order
  archives it to `Archive`.
- Payments update the linked order's Amount Paid (capped at the order total).
- Placements keep househelp statuses in sync (`Active → On Contract`,
  `Completed/Terminated → Available`, otherwise `Placed`).
- Househelp salary payments are kept on their own sheet — never merged into
  cleaning-service revenue.
- All input is sanitized (control characters stripped, `=`/`+`/`@` neutralized
  so a cell can never be turned into a formula).
