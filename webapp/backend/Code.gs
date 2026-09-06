/**
 * ============================================================================
 *  DEE CLEANERS — Business Management System  (Google Apps Script backend)
 * ============================================================================
 *  Google Sheets is the SINGLE SOURCE OF TRUTH.
 *  This script exposes a JSON API so the web application can read and write
 *  the Dee_Cleaners_Management workbook. It is the exact twin of
 *  webapp/dev/mock-server.js — same actions, same response formats.
 *
 *  HOW TO DEPLOY
 *  -------------
 *  1. Upload Dee_Cleaners_Management.xlsx to Google Drive and open it in
 *     Google Sheets (File > Save as Google Sheets). The workbook is created
 *     by build_dee_cleaners.py.
 *  2. Extensions > Apps Script — delete the default code, paste this file,
 *     save the project as "Dee Cleaners API".
 *  3. (Optional) set the API key: in Apps Script, Project Settings >
 *     Script Properties > Add property DEE_CLEANERS_API_KEY = your-key.
 *     The web app will then require ?key=your-key on every request.
 *  4. Deploy > New deployment > type "Web app":
 *       - Execute as: Me
 *       - Who has access: Anyone
 *     Copy the Web app URL — that is your API URL.
 *
 *  RULES THIS BACKEND ENFORCES
 *  ----------------------------
 *  - Writes ONLY input columns; formula columns on Orders
 *    (A, K, M, N, R, U) are never overwritten.
 *  - Deleted orders are archived to the "Archive" sheet, never removed.
 *  - All migrations/setup are idempotent and preserve existing records.
 *  - Input is validated and sanitized; responses are always
 *    { ok: true, data: ... } or { ok: false, error: "..." }.
 *  - Househelp service payments, salaries and fees are kept on their own
 *    sheets — never merged into cleaning-service revenue.
 * ============================================================================
 */

var API_KEY_PROP = 'DEE_CLEANERS_API_KEY';
var API_VERSION = '1.0.0';
var DATA_START_ROW = 4;          // headers live on row 3 in every data sheet
var HEADER_ROW = 3;
var MAX_ORDER_ROWS = 2000;       // Orders rows 4 .. 2003

/** Names of the data sheets (order matters only for display). */
var SHEETS = {
  SETTINGS: 'Settings',
  ORDERS: 'Orders',
  CUSTOMERS: 'Customers',
  EXPENSES: 'Expenses',
  PAYMENTS: 'Payments',
  HOUSEHELPS: 'Househelps',
  EMPLOYERS: 'Employers',
  PLACEMENTS: 'Placements',
  HOUSEHELP_PAYMENTS: 'Househelp Payments',
  CONTRACTS: 'Contracts',
  COMPLAINTS: 'Complaints',
  REPLACEMENTS: 'Replacements',
  ATTENDANCE: 'Attendance',
  DASHBOARD: 'Dashboard',
  ARCHIVE: 'Archive'
};

/**
 * Column maps: camelCase key -> 1-based column index.
 * MUST stay identical to build_dee_cleaners.py and mock-server.js.
 * Formula columns are marked with an asterisk in the header text and are
 * NEVER written by this API.
 */
var ORDERS_COLS = {
  id: 1, date: 2, customerName: 3, phone: 4, email: 5, service: 6,
  description: 7, quantity: 8, unitPrice: 9, discount: 10,
  totalF: 11, amountPaid: 12, balanceF: 13, paymentStatusF: 14,
  orderStatus: 15, transportFee: 16, directExpense: 17, netF: 18,
  notes: 19, lineItems: 20, helperF: 21
};
var ORDERS_INPUT_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 16, 17, 19, 20];
var ORDERS_HEADERS = ['Order ID', 'Date', 'Customer Name', 'Phone', 'Email',
  'Service', 'Description', 'Quantity', 'Unit Price', 'Discount', 'Total*',
  'Amount Paid', 'Balance*', 'Payment Status*', 'Order Status',
  'Transport Fee', 'Direct Expense', 'Net Service Profit*', 'Notes',
  'Line Items JSON', 'Unique Customer Helper*'];

var CUSTOMERS_COLS = { name: 1, phone: 2, email: 3, orderCount: 4,
  totalSpending: 5, totalPaid: 6, balance: 7, lastDate: 8, status: 9 };
var EXPENSES_COLS = { id: 1, date: 2, category: 3, description: 4, amount: 5,
  method: 6, relatedService: 7, notes: 8 };
var PAYMENTS_COLS = { id: 1, date: 2, customer: 3, orderId: 4, amount: 5,
  method: 6, reference: 7, receivedBy: 8, notes: 9 };
var HOUSEHELPS_COLS = { id: 1, fullName: 2, phone: 3, email: 4, gender: 5,
  nationality: 6, occupation: 7, nida: 8, cityCountry: 9, homeAddress: 10,
  registrationDate: 11, status: 12, skills: 13, experience: 14,
  availability: 15, notes: 16 };
var EMPLOYERS_COLS = { id: 1, fullName: 2, familyMember: 3, phone: 4, email: 5,
  gender: 6, nationality: 7, occupation: 8, cityCountry: 9, nida: 10,
  homeAddress: 11, registrationDate: 12, notes: 13 };
var PLACEMENTS_COLS = { id: 1, househelpId: 2, employerId: 3, category: 4,
  jobDescription: 5, salary: 6, paymentFrequency: 7, startDate: 8,
  expectedEndDate: 9, status: 10, contractStatus: 11, liveIn: 12,
  workingHours: 13, accommodation: 14, meals: 15, agencyFee: 16, notes: 17 };
var HH_PAYMENTS_COLS = { id: 1, househelpId: 2, employerId: 3, placementId: 4,
  paymentDate: 5, period: 6, amount: 7, method: 8, status: 9, reference: 10,
  notes: 11 };
var CONTRACTS_COLS = { id: 1, placementId: 2, employer: 3, househelp: 4,
  startDate: 5, endDate: 6, minimumDuration: 7, noticeRequired: 8,
  status: 9, terminationDate: 10, terminationReason: 11, documentLink: 12,
  employerSignature: 13, househelpSignature: 14, deeAck: 15, notes: 16 };
var COMPLAINTS_COLS = { id: 1, date: 2, client: 3, househelp: 4, placement: 5,
  type: 6, description: 7, reportedBy: 8, severity: 9, status: 10, action: 11,
  resolution: 12, resolutionDate: 13, notes: 14 };
var REPLACEMENTS_COLS = { id: 1, originalPlacement: 2, originalHousehelp: 3,
  employer: 4, reason: 5, requestDate: 6, replacementHousehelp: 7,
  replacementDate: 8, status: 9, notes: 10 };
var ATTENDANCE_COLS = { id: 1, date: 2, personType: 3, person: 4, checkIn: 5,
  checkOut: 6, hours: 7, status: 8, notes: 9 };

/** Header definitions used by the idempotent setup/migration. */
var HEADER_DEFS = {
  'Orders': ORDERS_HEADERS,
  'Customers': ['Customer Name', 'Phone', 'Email', 'Number of Orders',
    'Total Spending', 'Total Paid', 'Outstanding Balance', 'Last Service Date',
    'Customer Status'],
  'Expenses': ['Expense ID', 'Date', 'Category', 'Description', 'Amount',
    'Payment Method', 'Related Service', 'Notes'],
  'Payments': ['Payment ID', 'Date', 'Customer', 'Order ID', 'Amount',
    'Payment Method', 'Reference', 'Received By', 'Notes'],
  'Househelps': ['Househelp ID', 'Full Name', 'Phone', 'Email', 'Gender',
    'Nationality', 'Occupation', 'NIDA Number', 'City/Country',
    'Home Address', 'Registration Date', 'Status', 'Skills', 'Experience',
    'Availability', 'Notes'],
  'Employers': ['Client ID', 'Full Name', 'Family Member/Relative', 'Phone',
    'Email', 'Gender', 'Nationality', 'Occupation', 'City/Country',
    'NIDA Number', 'Home Address', 'Registration Date', 'Notes'],
  'Placements': ['Placement ID', 'Househelp ID', 'Employer ID', 'Category',
    'Job Description', 'Salary', 'Payment Frequency', 'Start Date',
    'Expected End Date', 'Status', 'Contract Status', 'Live-in/Live-out',
    'Working Hours', 'Accommodation', 'Meals', 'Agency Fee', 'Notes'],
  'Househelp Payments': ['Payment ID', 'Househelp ID', 'Employer ID',
    'Placement ID', 'Payment Date', 'Period', 'Amount', 'Payment Method',
    'Status', 'Reference', 'Notes'],
  'Contracts': ['Contract ID', 'Placement ID', 'Employer', 'Househelp',
    'Start Date', 'End Date', 'Minimum Duration', 'Notice Required',
    'Contract Status', 'Termination Date', 'Termination Reason',
    'Document Link', 'Employer Signature', 'Househelp Signature',
    'Dee Cleaners Acknowledged', 'Notes'],
  'Complaints': ['Complaint ID', 'Date', 'Client', 'Househelp', 'Placement',
    'Complaint Type', 'Description', 'Reported By', 'Severity', 'Status',
    'Dee Cleaners Action', 'Resolution', 'Resolution Date', 'Notes'],
  'Replacements': ['Replacement ID', 'Original Placement', 'Original Househelp',
    'Employer', 'Reason', 'Request Date', 'Replacement Househelp',
    'Replacement Date', 'Status', 'Notes'],
  'Attendance': ['Attendance ID', 'Date', 'Person Type', 'Person', 'Check In',
    'Check Out', 'Hours', 'Status', 'Notes'],
  'Dashboard': ['KPI', 'Value'],
  'Archive': ORDERS_HEADERS.concat(['Archived Date'])
};

/** Default settings seeded on a fresh sheet (from the supplied catalog). */
var DEFAULT_SETTINGS = [
  ['Business Name', 'Dee Cleaners'],
  ['Phone 1', '+255 693 806 051'],
  ['Phone 2', '+255 762 292 439'],
  ['Email', 'deecleanerscleaningservices@gmail.com'],
  ['Address', 'Magomeni, Mikumi'],
  ['Website', ''],
  ['Social Media', ''],
  ['Currency', 'TZS'],
  ['Default Transport Policy', 'Customer pays transport fees (Transport fees ni juu ya mteja)'],
  ['Room Pricing Note', 'Bei zinapungua au Kuongezeka kulingana na ukubwa wa chumba (prices may decrease or increase depending on room size)'],
  ['Live-in Working Hours', '5:00 a.m. - 6:30 p.m.'],
  ['Minimum Work Duration (months)', 3],
  ['Agency Fee Note', 'One-time agency fee paid by the employer upon contract initiation'],
  ['Payment Policy Note', 'All househelp service payments are made directly to Dee Cleaners, which handles salary disbursement'],
  ['Logo Reference', 'assets/dee_cleaners_logo/dee_cleaners_logo.png']
];

/** Section definitions for the Settings sheet: title, columns, seed rows. */
var LIST_DEFS = [
  { title: 'CLEANING SERVICES', columns: ['Name', 'Min Price', 'Max Price', 'Category', 'Active', 'Description'],
    rows: [['Toilet Cleaning', 30000, 40000, 'Cleaning', 'Yes', ''],
      ['Kitchen Cleaning', 50000, 150000, 'Cleaning', 'Yes', ''],
      ['Chumba Kimoja (One Room)', 50000, 50000, 'Cleaning', 'Yes', ''],
      ['Window Cleaning', 15000, 20000, 'Cleaning', 'Yes', ''],
      ['Sitting Room & 2 Bedrooms', 150000, 150000, 'Empty Rooms', 'Yes', ''],
      ['Sitting Room & 3 Bedrooms', 200000, 200000, 'Empty Rooms', 'Yes', ''],
      ['Sitting Room & 4 Bedrooms', 250000, 250000, 'Empty Rooms', 'Yes', ''],
      ['Sitting Room & 5 Bedrooms', 350000, 350000, 'Empty Rooms', 'Yes', ''],
      ['Sitting Room & 6 Bedrooms', 450000, 450000, 'Empty Rooms', 'Yes', ''],
      ['Sitting Room & 2 Bedrooms', 200000, 200000, 'Rooms With Furniture Cleaning', 'Yes', ''],
      ['Sitting Room & 3 Bedrooms', 250000, 250000, 'Rooms With Furniture Cleaning', 'Yes', ''],
      ['Sitting Room & 4 Bedrooms', 300000, 300000, 'Rooms With Furniture Cleaning', 'Yes', ''],
      ['Sitting Room & 5 Bedrooms', 350000, 350000, 'Rooms With Furniture Cleaning', 'Yes', ''],
      ['Sitting Room & 6 Bedrooms', 450000, 450000, 'Rooms With Furniture Cleaning', 'Yes', '']] },
  { title: 'SOFA SERVICES', columns: ['Name', 'Min Price', 'Max Price', 'Active'],
    rows: [['One Seater Sofa Set', 15000, 15000, 'Yes'],
      ['Two Seater Sofa Set', 30000, 30000, 'Yes'],
      ['Three Seater Sofa Set', 45000, 45000, 'Yes'],
      ['Four Seater Sofa Set', 60000, 60000, 'Yes'],
      ['Five Seater Sofa Set', 75000, 75000, 'Yes'],
      ['Six Seater Sofa Set', 90000, 90000, 'Yes'],
      ['Seven Seater Sofa Set', 105000, 105000, 'Yes'],
      ['Eight Seater Sofa Set', 120000, 120000, 'Yes'],
      ['Nine Seater Sofa Set', 135000, 135000, 'Yes'],
      ['Ten Seater Sofa Set', 150000, 150000, 'Yes']] },
  { title: 'LAUNDRY SERVICES', columns: ['Name', 'Unit', 'Light Price', 'Heavy Price', 'Ironing Price', 'Active', 'Description'],
    rows: [['Ties', 'Piece', 1000, '', '', 'Yes', '1-4 pieces: 1,000 | 5-9 pieces: 900 | 10+ pieces: 800 (per piece)'],
      ['Socks', 'Pair', 500, '', '', 'Yes', '1-4 pairs: 500 | 5-9 pairs: 400 | 10+ pairs: 300 (per pair)'],
      ['Jeans / Cargo / Formal Trousers', 'Piece', 500, 1000, '', 'Yes', 'Light: 500 | Heavy: 1,000'],
      ['Bazee / Kikoi / Lace / Kitenge', 'Piece', 2000, 3000, '', 'Yes', 'Light: 2,000 | Heavy: 3,000'],
      ['Curtains', 'Piece', 5000, '', '', 'Yes', '5,000 per curtain'],
      ['Bundle of Clothes', 'Bundle', 20000, 30000, '', 'Yes', '30-clothes bundle: Light 20,000 | Heavy 30,000'],
      ['Graduation Gown', 'Piece', '', '', 10000, 'Yes', '+ Ironing: 10,000'],
      ['Wedding Gown', 'Piece', '', '', 29900, 'Yes', '+ Ironing: 29,900'],
      ['Blanket', 'Piece', 15000, 29900, '', 'Yes', 'Light: 15,000 | Heavy: 29,900'],
      ['Ironing', 'Piece', '', '', '', 'Yes', 'Price set by the administrator']] },
  { title: 'SPECIALIZED SERVICES', columns: ['Name', 'Min Price', 'Max Price', 'Active', 'Description'],
    rows: [['Shoe Cleaning', 2000, 2000, 'Yes', ''],
      ['Sewer Cleaning', 20000, 20000, 'Yes', ''],
      ['Carpet Cleaning', 15000, 30000, 'Yes', ''],
      ['Fumigation Service', 10000, 500000, 'Yes', ''],
      ['Gardening & Maintenance', 100000, 1000000, 'Yes', '']] },
  { title: 'HOUSEHELP CATEGORIES', columns: ['Name', 'Min Price', 'Max Price', 'Active', 'Description'],
    rows: [['Single Parent Family', 80000, 100000, 'Yes', 'Family with only one parent'],
      ['Nuclear Family', 150000, 200000, 'Yes', 'Family with both parents'],
      ['Extended Family', 250000, 500000, 'Yes', ''],
      ['Family Including Relative', 250000, 500000, 'Yes', '']] },
  { title: 'PAYMENT METHODS', columns: ['Name', 'Details'],
    rows: [['Cash', ''], ['M-Pesa', ''], ['Tigo Pesa', ''], ['Airtel Money', ''], ['Bank Transfer', '']] },
  { title: 'ORDER STATUSES', columns: ['Name'],
    rows: ['Pending', 'Confirmed', 'In Progress', 'Completed', 'Cancelled'].map(function (s) { return [s]; }) },
  { title: 'PAYMENT STATUSES', columns: ['Name'],
    rows: ['Paid', 'Partial', 'Unpaid'].map(function (s) { return [s]; }) },
  { title: 'EXPENSE CATEGORIES', columns: ['Name'],
    rows: ['Transport', 'Cleaning Materials', 'Laundry Materials', 'Equipment', 'Fuel', 'Utilities', 'Salaries', 'Househelp Payments', 'Marketing', 'Maintenance', 'Other'].map(function (s) { return [s]; }) },
  { title: 'HOUSEHELP STATUSES', columns: ['Name'],
    rows: ['Available', 'Placed', 'On Contract', 'Inactive', 'Replacement Required'].map(function (s) { return [s]; }) },
  { title: 'CONTRACT STATUSES', columns: ['Name'],
    rows: ['Pending', 'Active', 'Completed', 'Terminated'].map(function (s) { return [s]; }) },
  { title: 'PLACEMENT STATUSES', columns: ['Name'],
    rows: ['Pending', 'Matching', 'Contract Pending', 'Active', 'Completed', 'Terminated', 'Replacement Required'].map(function (s) { return [s]; }) },
  { title: 'COMPLAINT STATUSES', columns: ['Name'],
    rows: ['Reported', 'Under Review', 'Mediation', 'Resolved', 'Escalated'].map(function (s) { return [s]; }) },
  { title: 'COMPLAINT TYPES', columns: ['Name'],
    rows: ['Salary/payment', 'Mistreatment', 'Abuse', 'Working conditions', 'Accommodation', 'Food', 'Misconduct', 'Property/damage', 'Other'].map(function (s) { return [s]; }) },
  { title: 'EMPLOYEE/WORKER TYPES', columns: ['Name'],
    rows: ['Staff', 'Worker', 'Househelp'].map(function (s) { return [s]; }) },
  { title: 'SEVERITY LEVELS', columns: ['Name'],
    rows: ['Low', 'Medium', 'High'].map(function (s) { return [s]; }) },
  { title: 'PAYMENT FREQUENCIES', columns: ['Name'],
    rows: ['Monthly', 'Weekly'].map(function (s) { return [s]; }) },
  { title: 'ATTENDANCE STATUSES', columns: ['Name'],
    rows: ['Present', 'Absent', 'Half Day', 'Leave'].map(function (s) { return [s]; }) }
];

/** Mapping of section title -> api list name used by getSettings(). */
var LIST_NAMES = {
  'CLEANING SERVICES': 'cleaningServices',
  'SOFA SERVICES': 'sofaServices',
  'LAUNDRY SERVICES': 'laundryServices',
  'SPECIALIZED SERVICES': 'specializedServices',
  'HOUSEHELP CATEGORIES': 'househelpCategories',
  'PAYMENT METHODS': 'paymentMethods',
  'ORDER STATUSES': 'orderStatuses',
  'PAYMENT STATUSES': 'paymentStatuses',
  'EXPENSE CATEGORIES': 'expenseCategories',
  'HOUSEHELP STATUSES': 'househelpStatuses',
  'CONTRACT STATUSES': 'contractStatuses',
  'PLACEMENT STATUSES': 'placementStatuses',
  'COMPLAINT STATUSES': 'complaintStatuses',
  'COMPLAINT TYPES': 'complaintTypes',
  'EMPLOYEE/WORKER TYPES': 'employeeTypes',
  'SEVERITY LEVELS': 'severityLevels',
  'PAYMENT FREQUENCIES': 'paymentFrequencies',
  'ATTENDANCE STATUSES': 'attendanceStatuses'
};

/* ==========================================================================
 * HTTP entry points
 * ========================================================================== */

function doGet(e) {
  return apiRequest(e && e.parameter ? e.parameter : {});
}

function doPost(e) {
  var params = {};
  if (e && e.postData && e.postData.contents) {
    try { params = JSON.parse(e.postData.contents); } catch (err) { params = {}; }
    if (typeof params !== 'object' || params === null) params = {};
  }
  // merge URL query parameters (?key=...); the JSON body wins on conflicts
  if (e && e.parameter) {
    for (var p in e.parameter) {
      if (params[p] === undefined) params[p] = e.parameter[p];
    }
  }
  return apiRequest(params);
}

function apiRequest(params) {
  try {
    // auth first — an unauthenticated request must never mutate the workbook
    if (!checkAuth(params)) throw new Error('Unauthorized: invalid or missing API key');
    ensureSetup();
    var action = String(params.action || '');
    if (!action) throw new Error('Missing "action" parameter');
    var data = params.data !== undefined && params.data !== null ? params.data : params;
    var result = handleAction(action, data);
    return jsonOut({ ok: true, data: result, version: API_VERSION });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message ? err.message : err), version: API_VERSION });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Optional API key stored as a script property. */
function checkAuth(params) {
  var key = PropertiesService.getScriptProperties().getProperty(API_KEY_PROP);
  if (!key) return true;
  var supplied = String((params && params.key) || '');
  return supplied === key;
}

/* ==========================================================================
 * Action router
 * ========================================================================== */

function handleAction(action, d) {
  d = d || {};
  switch (action) {
    // settings & lists
    case 'getSettings': return getSettings();
    case 'updateSettings': return updateSettings(d);
    case 'addList': return addListItem(d.list, d.item);
    case 'renameList': return renameListItem(d.list, d.oldName, d.newName);
    case 'deleteList': return deleteListItem(d.list, d.name);
    case 'updateList': return updateListItem(d.list, d.name, d.item);
    // orders
    case 'listOrders': return listOrders(d);
    case 'createOrder': return createOrder(d);
    case 'updateOrder': return updateOrder(d);
    case 'deleteOrder': return deleteOrder(d);
    // customers
    case 'listCustomers': return listCustomers(d);
    case 'getCustomer': return getCustomer(d);
    case 'getCustomerOrders': return getCustomerOrders(d);
    // payments
    case 'listPayments': return listPayments(d);
    case 'createPayment': return createPayment(d);
    case 'updatePayment': return updatePayment(d);
    case 'deletePayment': return deletePayment(d);
    // expenses
    case 'listExpenses': return listExpenses(d);
    case 'addExpense': return addExpense(d);
    case 'updateExpense': return updateExpense(d);
    case 'deleteExpense': return deleteExpense(d);
    // househelps
    case 'listHousehelps': return listHousehelps(d);
    case 'createHousehelp': return createHousehelp(d);
    case 'updateHousehelp': return updateHousehelp(d);
    case 'archiveHousehelp': return archiveHousehelp(d);
    // employers
    case 'listEmployers': return listEmployers(d);
    case 'createEmployer': return createEmployer(d);
    case 'updateEmployer': return updateEmployer(d);
    // placements
    case 'listPlacements': return listPlacements(d);
    case 'createPlacement': return createPlacement(d);
    case 'updatePlacement': return updatePlacement(d);
    case 'terminatePlacement': return terminatePlacement(d);
    // contracts
    case 'listContracts': return listContracts(d);
    case 'createContract': return createContract(d);
    case 'updateContract': return updateContract(d);
    case 'terminateContract': return terminateContract(d);
    // househelp payments
    case 'listHousehelpPayments': return listHousehelpPayments(d);
    case 'createHousehelpPayment': return createHousehelpPayment(d);
    case 'updateHousehelpPayment': return updateHousehelpPayment(d);
    // complaints
    case 'listComplaints': return listComplaints(d);
    case 'createComplaint': return createComplaint(d);
    case 'updateComplaint': return updateComplaint(d);
    case 'resolveComplaint': return resolveComplaint(d);
    // replacements
    case 'listReplacements': return listReplacements(d);
    case 'createReplacement': return createReplacement(d);
    case 'updateReplacement': return updateReplacement(d);
    // attendance
    case 'listAttendance': return listAttendance(d);
    case 'createAttendance': return createAttendance(d);
    case 'updateAttendance': return updateAttendance(d);
    // dashboard & reports
    case 'getDashboard': return getDashboard(d);
    case 'getReport': return getReport(d);
    default:
      throw new Error('Unknown action: ' + action);
  }
}

/* ==========================================================================
 * Idempotent setup / migration (never touches existing data)
 * ========================================================================== */

function ensureSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Settings sheet
  if (!ss.getSheetByName(SHEETS.SETTINGS)) {
    var ws = ss.insertSheet(SHEETS.SETTINGS);
    ws.getRange(1, 1, 1, 2).setValues([['DEE CLEANERS — SETTINGS', '']]);
    ws.getRange(HEADER_ROW, 1, 1, 2).setValues([['Setting', 'Value']]);
    var info = DEFAULT_SETTINGS.map(function (r) { return [r[0], r[1]]; });
    ws.getRange(DATA_START_ROW, 1, info.length, 2).setValues(info);
  }
  var settings = ss.getSheetByName(SHEETS.SETTINGS);

  // 2. Settings list sections (additive — existing rows are preserved)
  var existing = {};
  var values = settings.getRange(1, 1, Math.max(settings.getLastRow(), 1), 7).getValues();
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < values[r].length; c++) {
      var v = String(values[r][c] || '');
      for (var t in LIST_NAMES) { if (v === t) existing[t] = r + 1; }
    }
  }
  for (var k = 0; k < LIST_DEFS.length; k++) {
    var def = LIST_DEFS[k];
    if (!existing[def.title]) {
      var last = settings.getLastRow();
      var row = Math.max(last + 2, 1);
      settings.getRange(row, 1, 1, def.columns.length)
        .setValues([def.columns]).setFontWeight('bold');
      if (def.rows.length) {
        settings.getRange(row + 1, 1, def.rows.length, def.columns.length)
          .setValues(def.rows);
      }
    }
  }

  // 3. Data sheets with headers (additive header migration)
  for (var name in HEADER_DEFS) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1).setValue('DEE CLEANERS — ' + name.toUpperCase());
      sh.getRange(HEADER_ROW, 1, 1, HEADER_DEFS[name].length)
        .setValues([HEADER_DEFS[name]]);
      sh.getRange(HEADER_ROW, 1, 1, HEADER_DEFS[name].length).setFontWeight('bold');
    } else {
      ensureHeaders(sh, HEADER_DEFS[name]);
    }
  }

  // 4. Orders formula rows (only for completely new Orders sheets)
  var orders = ss.getSheetByName(SHEETS.ORDERS);
  if (orders.getLastRow() < DATA_START_ROW) {
    ensureOrdersFormulas(orders);
  }
  return ss;
}

function ensureHeaders(sh, headers) {
  var existing = sh.getRange(HEADER_ROW, 1, 1, headers.length).getValues()[0];
  var same = true;
  for (var i = 0; i < headers.length; i++) {
    if (String(existing[i] || '') !== String(headers[i])) { same = false; break; }
  }
  if (same) return;
  // Additive migration: append any missing headers, never move data.
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var missing = [];
  for (var j = 0; j < headers.length; j++) {
    var found = false;
    for (var e = 0; e < existing.length; e++) {
      if (String(existing[e] || '') === String(headers[j])) { found = true; break; }
    }
    if (!found) missing.push(headers[j]);
  }
  if (missing.length) {
    sh.getRange(HEADER_ROW, lastCol + 1, 1, missing.length).setValues([missing]);
    sh.getRange(HEADER_ROW, lastCol + 1, 1, missing.length).setFontWeight('bold');
  }
}

function ensureOrdersFormulas(orders) {
  var last = DATA_START_ROW + MAX_ORDER_ROWS - 1;   // row 2003
  var n = MAX_ORDER_ROWS;
  var ids = [], totals = [], balances = [], payStatus = [], nets = [], helpers = [];
  for (var r = DATA_START_ROW; r <= last; r++) {
    var b = 'B' + r;
    ids.push('=IF(' + b + '="","",TEXT(ROW()-3,"""DC-""0000"))');
    totals.push('=IF(' + b + '="","",MAX(0,IFERROR(I' + r + ',0)*IFERROR(H' + r + ',0)-IFERROR(J' + r + ',0)))');
    balances.push('=IF(' + b + '="","",MAX(0,K' + r + '-L' + r + '))');
    payStatus.push('=IF(' + b + '="","",IF(L' + r + '>=K' + r + ',"Paid",IF(L' + r + '>0,"Partial","Unpaid")))');
    nets.push('=IF(' + b + '="","",IFERROR(K' + r + ',0)+IFERROR(P' + r + ',0)-IFERROR(Q' + r + ',0))');
    helpers.push('=IF(' + b + '="","",TRIM(LOWER(C' + r + '&"|"&LOWER(D' + r + '))))');
  }
  orders.getRange(DATA_START_ROW, 1, n, 1).setFormulas(ids.map(function (f) { return [f]; }));
  orders.getRange(DATA_START_ROW, 11, n, 1).setFormulas(totals.map(function (f) { return [f]; }));
  orders.getRange(DATA_START_ROW, 13, n, 1).setFormulas(balances.map(function (f) { return [f]; }));
  orders.getRange(DATA_START_ROW, 14, n, 1).setFormulas(payStatus.map(function (f) { return [f]; }));
  orders.getRange(DATA_START_ROW, 18, n, 1).setFormulas(nets.map(function (f) { return [f]; }));
  orders.getRange(DATA_START_ROW, 21, n, 1).setFormulas(helpers.map(function (f) { return [f]; }));
}

/* ==========================================================================
 * Generic helpers
 * ========================================================================== */

function sh(name) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }

function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }

function todayISO() {
  var d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
}

/** Strip control characters (keep tab and newline); neutralise values that
 *  would become formulas. */
function clean(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return isFinite(v) ? v : '';
  var s = String(v).replace(/[\u0000-\u0008\u000B-\u001F]/g, '').trim();
  if (/^[=+@]/.test(s)) s = "'" + s;
  return s;
}

function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

function validDate(v) {
  var s = clean(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : todayISO();
}

function readRows(sheetName, nCols) {
  var sheet = sh(sheetName);
  var last = Math.max(sheet.getLastRow(), DATA_START_ROW - 1);
  if (last < DATA_START_ROW) return [];
  return sheet.getRange(DATA_START_ROW, 1, last - DATA_START_ROW + 1, nCols).getValues();
}

function rowToObj(row, cols) {
  var o = {};
  for (var key in cols) {
    var v = row[cols[key] - 1];
    o[key] = v === null || v === undefined ? '' : v;
  }
  return o;
}

/**
 * Write one row of input values at an absolute row number.
 * preserveCols: optional array of 1-based column indexes to leave untouched.
 * Preserved cells keep their existing formula (or value) — used for the
 * Orders formula columns, which must never be overwritten by the API.
 */
function writeRow(sheetName, rowNumber, keyedValues, cols, preserveCols) {
  var sheet = sh(sheetName);
  var n = Object.keys(cols).length;
  var skip = {};
  for (var s = 0; preserveCols && s < preserveCols.length; s++) skip[preserveCols[s]] = true;
  var arr = new Array(n);
  for (var i = 0; i < n; i++) arr[i] = '';
  if (preserveCols && preserveCols.length) {
    var formulas = sheet.getRange(rowNumber, 1, 1, n).getFormulas()[0];
    var values = sheet.getRange(rowNumber, 1, 1, n).getValues()[0];
    for (var p = 0; p < preserveCols.length; p++) {
      var c = preserveCols[p];
      arr[c - 1] = formulas[c - 1] !== '' ? formulas[c - 1] : values[c - 1];
    }
  }
  for (var k in keyedValues) {
    if (cols[k] !== undefined && !skip[cols[k]]) arr[cols[k] - 1] = keyedValues[k];
  }
  sheet.getRange(rowNumber, 1, 1, n).setValues([arr]);
  return arr;
}

/** Next sequential ID for a sheet (never reuses IDs, checks Archive too). */
function newId(prefix, sheetName, colIdx, extraSheet) {
  var max = 0;
  var scan = function (name) {
    var rows = readRows(name, colIdx);
    for (var i = 0; i < rows.length; i++) {
      var m = String(rows[i][colIdx - 1]).match(new RegExp('^' + prefix + '-(\\d+)$'));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  };
  scan(sheetName);
  if (extraSheet && sh(extraSheet)) scan(extraSheet);
  return prefix + '-' + pad(max + 1, 4);
}

function findRowByValue(sheetName, colIdx, value) {
  var rows = readRows(sheetName, colIdx);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][colIdx - 1]) === String(value)) return DATA_START_ROW + i;
  }
  return -1;
}

/** Get the display value of a cell (needed for formula columns like Order ID). */
function displayColumn(sheetName, colIdx, maxRows) {
  var sheet = sh(sheetName);
  var last = Math.max(sheet.getLastRow(), DATA_START_ROW - 1);
  if (last < DATA_START_ROW) return [];
  var n = Math.min(last - DATA_START_ROW + 1, maxRows || 5000);
  return sheet.getRange(DATA_START_ROW, colIdx, n, 1).getDisplayValues()
    .map(function (r) { return r[0]; });
}

/* ==========================================================================
 * Settings & lists
 * ========================================================================== */

function getSettings() {
  ensureSetup();
  var sheet = sh(SHEETS.SETTINGS);
  var values = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 7).getValues();
  var settings = {};
  var lists = {};
  var infoMode = true;

  for (var r = DATA_START_ROW - 1; r < values.length; r++) {
    var a = String(values[r][0] === null ? '' : values[r][0]).trim();
    var b = values[r][1] === null ? '' : values[r][1];
    if (infoMode) {
      if (a) settings[a] = (b === null || b === undefined) ? '' : b;
      else if (!a && r > DATA_START_ROW) infoMode = false;
    }
    var listName = LIST_NAMES[a];
    if (listName) {
      // header row is the row above the first data row; find column count
      var headers = [];
      for (var c = 0; c < 7; c++) {
        var h = String(values[r - 1][c] || '').trim();
        if (h) headers.push(h);
      }
      var items = [];
      for (var rr = r + 1; rr < values.length; rr++) {
        var first = String(values[rr][0] || '').trim();
        if (!first) break;
        var item = { name: first };
        for (var hc = 1; hc < headers.length; hc++) {
          var key = headers[hc].toLowerCase().replace(/[^a-z0-9]+/g, '');
          item[key] = values[rr][hc] === null ? '' : values[rr][hc];
        }
        items.push(item);
      }
      lists[listName] = { columns: headers, items: items };
    }
  }
  return { settings: settings, lists: lists };
}

function updateSettings(d) {
  var sheet = sh(SHEETS.SETTINGS);
  var updates = d.settings || {};
  var last = Math.max(sheet.getLastRow(), DATA_START_ROW - 1);
  var values = sheet.getRange(DATA_START_ROW, 1, last - DATA_START_ROW + 1, 2).getValues();
  // The settings info block runs from row 4 down to the first blank cell in
  // column A (the list sections follow after that blank separator row).
  var infoEnd = last;
  var known = {};
  for (var r = 0; r < values.length; r++) {
    var key = String(values[r][0] || '').trim();
    if (!key) { infoEnd = DATA_START_ROW + r - 1; break; }
    known[key] = DATA_START_ROW + r;
  }
  for (var k in updates) {
    if (known[k] !== undefined) {
      sheet.getRange(known[k], 2).setValue(clean(updates[k]));
    } else {
      // new key: insert right after the last existing setting so the info
      // block stays contiguous and the list sections shift down intact
      var insertAt = infoEnd + 1;
      if (insertAt <= last) sheet.insertRowBefore(insertAt);
      else insertAt = last + 1;
      sheet.getRange(insertAt, 1, 1, 2).setValues([[clean(k), clean(updates[k])]]);
      infoEnd = insertAt;
      known[k] = insertAt;
    }
  }
  return getSettings();
}

/** Locate a list section + row by item name. Returns {sheetRow} or null. */
function findListRow(listName, itemName) {
  var sheet = sh(SHEETS.SETTINGS);
  var values = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 7).getValues();
  var section = -1;
  for (var i = 0; i < values.length; i++) {
    if (LIST_NAMES[String(values[i][0] || '').trim()] === listName) { section = i; break; }
  }
  if (section < 0) return null;
  for (var r = section + 2; r < values.length; r++) {
    var name = String(values[r][0] || '').trim();
    if (!name) break;
    if (name === String(itemName || '').trim()) return { sheetRow: r + 1, colCount: sectionCols(values, section) };
  }
  return { sheetRow: -1, colCount: sectionCols(values, section) };
}

function sectionCols(values, section) {
  var n = 1;
  for (var c = 1; c < 7; c++) { if (String(values[section + 1][c] || '').trim()) n++; }
  return n;
}

function addListItem(listName, item) {
  var sheet = sh(SHEETS.SETTINGS);
  var values = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 7).getValues();
  var section = -1;
  for (var i = 0; i < values.length; i++) {
    if (LIST_NAMES[String(values[i][0] || '').trim()] === listName) { section = i; break; }
  }
  if (section < 0) throw new Error('Unknown list: ' + listName);
  var colCount = sectionCols(values, section);
  var name = typeof item === 'string' ? item : clean(item && item.name);
  if (!name) throw new Error('List item needs a name');
  // find last data row of the section
  var r = section + 2;
  while (r < values.length && String(values[r][0] || '').trim()) r++;
  var arr = new Array(colCount);
  for (var c = 0; c < colCount; c++) arr[c] = '';
  arr[0] = name;
  if (item && typeof item === 'object') {
    var j = 1;
    for (var kk in item) {
      if (kk === 'name' || j >= colCount) continue;
      arr[j++] = clean(item[kk]);
    }
  }
  sheet.getRange(r + 1, 1, 1, colCount).setValues([arr]);
  return getSettings();
}

function renameListItem(listName, oldName, newName) {
  var loc = findListRow(listName, oldName);
  if (!loc || loc.sheetRow < 0) throw new Error('Item not found: ' + oldName);
  sh(SHEETS.SETTINGS).getRange(loc.sheetRow, 1).setValue(clean(newName));
  return getSettings();
}

function deleteListItem(listName, name) {
  var loc = findListRow(listName, name);
  if (!loc || loc.sheetRow < 0) throw new Error('Item not found: ' + name);
  // move every row below up one — keeps the section contiguous
  var sheet = sh(SHEETS.SETTINGS);
  var values = sheet.getRange(loc.sheetRow, 1, Math.max(sheet.getLastRow() - loc.sheetRow + 1, 1), loc.colCount).getValues();
  for (var r = 0; r < values.length - 1; r++) values[r] = values[r + 1];
  values[values.length - 1] = new Array(loc.colCount).join('.').split('.');
  sheet.getRange(loc.sheetRow, 1, values.length, loc.colCount).setValues(values);
  return getSettings();
}

function updateListItem(listName, name, item) {
  var loc = findListRow(listName, name);
  if (!loc || loc.sheetRow < 0) throw new Error('Item not found: ' + name);
  var sheet = sh(SHEETS.SETTINGS);
  if (typeof item === 'object' && item !== null) {
    if (item.name) sheet.getRange(loc.sheetRow, 1).setValue(clean(item.name));
    var colMap = {};
    var headers = sheet.getRange(loc.sheetRow - 1, 1, 1, loc.colCount).getValues()[0];
    for (var c = 0; c < headers.length; c++) {
      colMap[String(headers[c]).toLowerCase().replace(/[^a-z0-9]+/g, '')] = c + 1;
    }
    for (var key in item) {
      var k = String(key).toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (k === 'name' || colMap[k] === undefined) continue;
      var val = item[key];
      if (typeof val === 'number') sheet.getRange(loc.sheetRow, colMap[k]).setValue(val);
      else sheet.getRange(loc.sheetRow, colMap[k]).setValue(clean(val));
    }
  }
  return getSettings();
}

/* ==========================================================================
 * Orders (formula columns K/M/N/R/U are NEVER written)
 * ========================================================================== */

/** Map one raw Orders row to an API object with computed totals. */
function orderFromRow(row) {
  var o = rowToObj(row, ORDERS_COLS);
  var lineItems = [];
  if (o.lineItems) {
    try {
      var parsed = JSON.parse(o.lineItems);
      if (Array.isArray(parsed)) lineItems = parsed;
    } catch (e) { lineItems = []; }
  }
  var total = 0;
  if (lineItems.length) {
    for (var i = 0; i < lineItems.length; i++) {
      total += num(lineItems[i].qty) * num(lineItems[i].unitPrice);
    }
  } else {
    total = num(o.quantity) * num(o.unitPrice);
  }
  total = Math.max(0, total - num(o.discount));
  var paid = Math.max(0, num(o.amountPaid));
  var balance = Math.max(0, total - paid);
  o.lineItems = lineItems;
  o.quantity = num(o.quantity);
  o.unitPrice = num(o.unitPrice);
  o.discount = num(o.discount);
  o.total = total;
  o.amountPaid = paid;
  o.balance = balance;
  o.paymentStatus = paid <= 0 ? 'Unpaid' : (paid >= total ? 'Paid' : 'Partial');
  o.transportFee = num(o.transportFee);
  o.directExpense = num(o.directExpense);
  o.netServiceProfit = total + num(o.transportFee) - num(o.directExpense);
  return o;
}

function listOrders(d) {
  var rows = readRows(SHEETS.ORDERS, 21);
  var orders = [];
  for (var i = 0; i < rows.length; i++) {
    if (!String(rows[i][1] || '').trim()) continue;   // no date -> empty row
    var o = orderFromRow(rows[i]);
    o.row = DATA_START_ROW + i;
    o.id = String(rows[i][0] || o.id);
    orders.push(o);
  }
  orders = filterOrders(orders, d || {});
  return orders;
}

function filterOrders(orders, q) {
  var s = String(q.search || '').toLowerCase();
  if (s) {
    orders = orders.filter(function (o) {
      var hay = [o.id, o.customerName, o.phone, o.email, o.service,
        o.description, o.notes].join(' ').toLowerCase();
      return hay.indexOf(s) >= 0;
    });
  }
  if (q.orderStatus) orders = orders.filter(function (o) { return o.orderStatus === q.orderStatus; });
  if (q.paymentStatus) orders = orders.filter(function (o) { return o.paymentStatus === q.paymentStatus; });
  if (q.serviceCategory) orders = orders.filter(function (o) {
    return serviceCategoryOf(o.service) === q.serviceCategory;
  });
  if (q.service) orders = orders.filter(function (o) { return o.service === q.service; });
  if (q.dateFrom) orders = orders.filter(function (o) { return o.date >= String(q.dateFrom); });
  if (q.dateTo) orders = orders.filter(function (o) { return o.date <= String(q.dateTo); });
  return orders;
}

var CATEGORY_MAP_ = null;

/** Map every service name in the live Settings lists to its category. */
function buildCategoryMap() {
  var map = {};
  try {
    var sets = getSettings().lists;
    var addAll = function (list, category) {
      if (!list) return;
      (list.items || []).forEach(function (it) {
        if (it.name) map[String(it.name).toLowerCase()] = category;
      });
    };
    addAll(sets.cleaningServices, 'Cleaning');
    addAll(sets.sofaServices, 'Sofa Cleaning');
    addAll(sets.laundryServices, 'Laundry');
    addAll(sets.specializedServices, 'Specialized');
  } catch (e) { map = {}; }
  CATEGORY_MAP_ = map;
  return map;
}

function serviceCategoryOf(serviceName) {
  var s = String(serviceName || '').toLowerCase();
  if (!s) return 'Other';
  if (CATEGORY_MAP_ === null) buildCategoryMap();
  if (CATEGORY_MAP_[s]) return CATEGORY_MAP_[s];
  if (/fumigation|gardening/.test(s)) return 'Specialized';
  if (/sofa/.test(s)) return 'Sofa Cleaning';
  if (/ironing|laundry|gown|blanket|curtain|kikoi|kitenge|bazee|sock|tie|trouser|jean|cargo|bundle/.test(s)) return 'Laundry';
  return 'Other';
}

/** Normalise + validate an incoming order payload. */
function normalizeOrder(d, partial) {
  var o = {};
  o.date = validDate(d.date);
  o.customerName = clean(d.customerName);
  o.phone = clean(d.phone);
  o.email = clean(d.email);
  o.service = clean(d.service);
  o.description = clean(d.description);
  o.discount = Math.max(0, num(d.discount));
  o.amountPaid = Math.max(0, num(d.amountPaid));
  o.orderStatus = clean(d.orderStatus) || 'Pending';
  o.transportFee = Math.max(0, num(d.transportFee));
  o.directExpense = Math.max(0, num(d.directExpense));
  o.notes = clean(d.notes);

  var lineItems = Array.isArray(d.lineItems) ? d.lineItems : [];
  var cleaned = [];
  for (var i = 0; i < lineItems.length; i++) {
    var li = lineItems[i];
    var svc = clean(li && li.service);
    if (!svc) continue;
    cleaned.push({
      service: svc,
      description: clean(li && li.description),
      qty: Math.max(0, num(li && li.qty)),
      unitPrice: Math.max(0, num(li && li.unitPrice))
    });
  }

  if (!partial) {
    if (!o.customerName) throw new Error('Customer name is required');
    if (cleaned.length === 0 && !o.service) throw new Error('At least one service line is required');
  }

  if (cleaned.length) {
    o.lineItems = cleaned;
    var sum = 0, qtySum = 0;
    for (var k = 0; k < cleaned.length; k++) {
      sum += cleaned[k].qty * cleaned[k].unitPrice;
      qtySum += cleaned[k].qty;
    }
    o.quantity = 1;
    o.unitPrice = sum;                       // keeps the sheet formula accurate
    o.service = o.service || (cleaned.length === 1 ? cleaned[0].service : 'Multiple Services');
    o.lineItemsJson = JSON.stringify(cleaned);
  } else {
    o.quantity = Math.max(0, num(d.quantity));
    o.unitPrice = Math.max(0, num(d.unitPrice));
    o.lineItemsJson = '';
  }
  return o;
}

function ordersInputValues(o) {
  return {
    date: o.date, customerName: o.customerName, phone: o.phone,
    email: o.email, service: o.service, description: o.description,
    quantity: o.quantity, unitPrice: o.unitPrice, discount: o.discount,
    amountPaid: o.amountPaid, orderStatus: o.orderStatus,
    transportFee: o.transportFee, directExpense: o.directExpense,
    notes: o.notes, lineItems: o.lineItemsJson
  };
}

function nextOrderId() {
  var max = 0;
  var ids = displayColumn(SHEETS.ORDERS, 1, MAX_ORDER_ROWS);
  for (var i = 0; i < ids.length; i++) {
    var m = String(ids[i]).match(/^DC-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  if (sh(SHEETS.ARCHIVE)) {
    var arch = displayColumn(SHEETS.ARCHIVE, 1, 5000);
    for (var a = 0; a < arch.length; a++) {
      var m2 = String(arch[a]).match(/^DC-(\d+)$/);
      if (m2) max = Math.max(max, parseInt(m2[1], 10));
    }
  }
  return 'DC-' + pad(max + 1, 4);
}

function createOrder(d) {
  var o = normalizeOrder(d, false);
  // serialise the row scan + ID allocation + write so two concurrent
  // requests can never claim the same row or ID
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var id, rowIdx, arr = new Array(21);
  try {
    // find first empty row (B empty), restricted to the formula block
    var sheet = sh(SHEETS.ORDERS);
    var last = Math.max(sheet.getLastRow(), DATA_START_ROW);
    var rows = sheet.getRange(DATA_START_ROW, 2, Math.min(last - DATA_START_ROW + 1, MAX_ORDER_ROWS), 1).getValues();
    rowIdx = -1;
    for (var i = 0; i < rows.length; i++) {
      if (!String(rows[i][0] || '').trim()) { rowIdx = DATA_START_ROW + i; break; }
    }
    if (rowIdx < 0) throw new Error('Orders sheet is full (2,000 rows)');
    id = nextOrderId();
    var vals = ordersInputValues(o);
    vals.id = id;
    var cols = ORDERS_COLS;
    for (var c = 0; c < 21; c++) arr[c] = '';
    for (var k in vals) { if (cols[k] !== undefined) arr[cols[k] - 1] = vals[k]; }
    // write only input columns: 1,2,3,4,5,6,7,8,9,10,12,15,16,17,19,20
    var input = {};
    for (var kk in vals) input[kk] = vals[kk];
    writeRow(SHEETS.ORDERS, rowIdx, input, cols, [11, 13, 14, 18, 21]);
  } finally {
    lock.releaseLock();
  }
  return Object.assign(orderFromRow(arr), { id: id, row: rowIdx });
}

function findOrderRow(orderId) {
  var ids = displayColumn(SHEETS.ORDERS, 1, MAX_ORDER_ROWS);
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i]) === String(orderId)) return DATA_START_ROW + i;
  }
  return -1;
}

function updateOrder(d) {
  var id = clean(d.orderId);
  if (!id) throw new Error('orderId is required');
  var rowIdx = findOrderRow(id);
  if (rowIdx < 0) throw new Error('Order not found: ' + id);
  var current = listOrders({}).filter(function (o) { return o.id === id; });
  var base = current.length ? current[0] : {};
  var merged = {
    date: d.date !== undefined ? d.date : base.date,
    customerName: d.customerName !== undefined ? d.customerName : base.customerName,
    phone: d.phone !== undefined ? d.phone : base.phone,
    email: d.email !== undefined ? d.email : base.email,
    service: d.service !== undefined ? d.service : base.service,
    description: d.description !== undefined ? d.description : base.description,
    discount: d.discount !== undefined ? d.discount : base.discount,
    amountPaid: d.amountPaid !== undefined ? d.amountPaid : base.amountPaid,
    orderStatus: d.orderStatus !== undefined ? d.orderStatus : base.orderStatus,
    transportFee: d.transportFee !== undefined ? d.transportFee : base.transportFee,
    directExpense: d.directExpense !== undefined ? d.directExpense : base.directExpense,
    notes: d.notes !== undefined ? d.notes : base.notes,
    lineItems: d.lineItems !== undefined ? d.lineItems : base.lineItems,
    quantity: d.quantity !== undefined ? d.quantity : base.quantity,
    unitPrice: d.unitPrice !== undefined ? d.unitPrice : base.unitPrice
  };
  var o = normalizeOrder(merged, true);
  // preserve col A (Order ID) and the formula columns K/M/N/R/U
  writeRow(SHEETS.ORDERS, rowIdx, ordersInputValues(o), ORDERS_COLS,
    [1, 11, 13, 14, 18, 21]);
  return Object.assign(orderFromRow(
    sh(SHEETS.ORDERS).getRange(rowIdx, 1, 1, 21).getValues()[0]), { id: id, row: rowIdx });
}

function deleteOrder(d) {
  var id = clean(d.orderId);
  if (!id) throw new Error('orderId is required');
  var rowIdx = findOrderRow(id);
  if (rowIdx < 0) throw new Error('Order not found: ' + id);
  var sheet = sh(SHEETS.ORDERS);
  var row = sheet.getRange(rowIdx, 1, 1, 21).getValues()[0];
  row[0] = id;
  var archive = sh(SHEETS.ARCHIVE);
  var lastA = Math.max(archive.getLastRow(), DATA_START_ROW - 1);
  var dest = lastA + 1;
  archive.getRange(dest, 1, 1, 21).setValues([row]);
  archive.getRange(dest, 22).setValue(todayISO());
  // clear input columns so the row can be reused (formulas stay intact)
  for (var i = 0; i < ORDERS_INPUT_COLS.length; i++) {
    sheet.getRange(rowIdx, ORDERS_INPUT_COLS[i]).setValue('');
  }
  return { archived: id, archiveRow: dest };
}

/* ==========================================================================
 * Customers (aggregated from Orders — Customers sheet is app-managed)
 * ========================================================================== */

function customerKey(name, phone) {
  return (String(name || '').trim().toLowerCase() + '|' + String(phone || '').trim().toLowerCase());
}

function refreshCustomers() {
  var orders = listOrders({});
  var map = {};
  for (var i = 0; i < orders.length; i++) {
    var o = orders[i];
    var key = customerKey(o.customerName, o.phone);
    if (!key || key === '|') continue;
    if (!map[key]) {
      map[key] = { name: o.customerName, phone: o.phone, email: o.email,
        orderCount: 0, totalSpending: 0, totalPaid: 0, balance: 0, lastDate: '' };
    }
    var c = map[key];
    c.orderCount++;
    c.totalSpending += o.total;
    c.totalPaid += o.amountPaid;
    c.balance += o.balance;
    if (o.date > c.lastDate) c.lastDate = o.date;
    if (o.email && !c.email) c.email = o.email;
    if (o.customerName && o.customerName !== c.name && o.customerName.length > c.name.length) c.name = o.customerName;
  }
  var list = Object.keys(map).map(function (k) { return map[k]; });
  list.sort(function (a, b) { return b.totalSpending - a.totalSpending; });
  var days90 = 90 * 24 * 60 * 60 * 1000;
  var now = new Date();
  var rows = list.map(function (c) {
    var active = 'Inactive';
    if (c.lastDate) {
      var d = new Date(c.lastDate + 'T00:00:00');
      if (now - d <= days90) active = 'Active';
    }
    return [c.name, c.phone, c.email, c.orderCount, c.totalSpending,
      c.totalPaid, c.balance, c.lastDate, active];
  });
  var sheet = sh(SHEETS.CUSTOMERS);
  // clear previous aggregate block
  var last = Math.max(sheet.getLastRow(), DATA_START_ROW);
  if (last >= DATA_START_ROW) {
    sheet.getRange(DATA_START_ROW, 1, last - DATA_START_ROW + 1, 9).clearContent();
  }
  if (rows.length) {
    sheet.getRange(DATA_START_ROW, 1, rows.length, 9).setValues(rows);
  }
  return list.map(function (c, i) {
    var row = rows[i];
    return { name: row[0], phone: row[1], email: row[2], orderCount: row[3],
      totalSpending: row[4], totalPaid: row[5], balance: row[6],
      lastServiceDate: row[7], status: row[8] };
  });
}

function listCustomers(d) {
  var customers = refreshCustomers();
  var s = String((d && d.search) || '').toLowerCase();
  if (s) customers = customers.filter(function (c) {
    return (c.name + ' ' + c.phone + ' ' + c.email).toLowerCase().indexOf(s) >= 0;
  });
  return customers;
}

function getCustomer(d) {
  var customers = refreshCustomers();
  var name = String((d && d.name) || '').toLowerCase();
  var phone = String((d && d.phone) || '').toLowerCase();
  for (var i = 0; i < customers.length; i++) {
    var c = customers[i];
    if ((name && c.name.toLowerCase().indexOf(name) >= 0) ||
        (phone && String(c.phone).toLowerCase().indexOf(phone) >= 0)) {
      c.orders = getCustomerOrders({ name: c.name, phone: c.phone });
      return c;
    }
  }
  throw new Error('Customer not found');
}

function getCustomerOrders(d) {
  var key = customerKey(d && d.name, d && d.phone);
  return listOrders({}).filter(function (o) {
    return customerKey(o.customerName, o.phone) === key;
  });
}

/* ==========================================================================
 * Payments (recording a payment updates the linked order's Amount Paid)
 * ========================================================================== */

function paymentFromRow(row) {
  var p = rowToObj(row, PAYMENTS_COLS);
  p.amount = num(p.amount);
  return p;
}

function listPayments(d) {
  var rows = readRows(SHEETS.PAYMENTS, 9);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!String(rows[i][0] || '').trim() && !String(rows[i][2] || '').trim()) continue;
    var p = paymentFromRow(rows[i]);
    p.row = DATA_START_ROW + i;
    out.push(p);
  }
  var s = String((d && d.search) || '').toLowerCase();
  if (s) out = out.filter(function (p) {
    return (p.id + ' ' + p.customer + ' ' + p.orderId + ' ' + p.reference).toLowerCase().indexOf(s) >= 0;
  });
  return out;
}

/** Adjust the linked order's Amount Paid (capped at order total). */
function syncOrderPaid(orderId, delta, replaceWith) {
  if (!orderId) return;
  var rowIdx = findOrderRow(orderId);
  if (rowIdx < 0) return;
  var row = sh(SHEETS.ORDERS).getRange(rowIdx, 1, 1, 21).getValues()[0];
  var o = orderFromRow(row);
  var paid = replaceWith !== undefined ? replaceWith : o.amountPaid + delta;
  paid = Math.max(0, Math.min(o.total, paid));
  sh(SHEETS.ORDERS).getRange(rowIdx, 12).setValue(paid);
}

function createPayment(d) {
  var p = {
    id: newId('PAY', SHEETS.PAYMENTS, 1),
    date: validDate(d.date),
    customer: clean(d.customer),
    orderId: clean(d.orderId),
    amount: Math.max(0, num(d.amount)),
    method: clean(d.method),
    reference: clean(d.reference),
    receivedBy: clean(d.receivedBy),
    notes: clean(d.notes)
  };
  if (!p.customer && !p.orderId) throw new Error('Customer or Order ID is required');
  if (p.amount <= 0) throw new Error('Payment amount must be greater than 0');
  var sheet = sh(SHEETS.PAYMENTS);
  var last = Math.max(sheet.getLastRow(), DATA_START_ROW - 1);
  var dest = last + 1;
  sheet.getRange(dest, 1, 1, 9).setValues([[p.id, p.date, p.customer, p.orderId,
    p.amount, p.method, p.reference, p.receivedBy, p.notes]]);
  syncOrderPaid(p.orderId, p.amount);
  p.row = dest;
  return p;
}

function updatePayment(d) {
  var id = clean(d.paymentId);
  if (!id) throw new Error('paymentId is required');
  var rowIdx = findRowByValue(SHEETS.PAYMENTS, 1, id);
  if (rowIdx < 0) throw new Error('Payment not found: ' + id);
  var old = paymentFromRow(sh(SHEETS.PAYMENTS).getRange(rowIdx, 1, 1, 9).getValues()[0]);
  var p = {
    id: id,
    date: d.date !== undefined ? validDate(d.date) : old.date,
    customer: d.customer !== undefined ? clean(d.customer) : old.customer,
    orderId: d.orderId !== undefined ? clean(d.orderId) : old.orderId,
    amount: d.amount !== undefined ? Math.max(0, num(d.amount)) : old.amount,
    method: d.method !== undefined ? clean(d.method) : old.method,
    reference: d.reference !== undefined ? clean(d.reference) : old.reference,
    receivedBy: d.receivedBy !== undefined ? clean(d.receivedBy) : old.receivedBy,
    notes: d.notes !== undefined ? clean(d.notes) : old.notes
  };
  sh(SHEETS.PAYMENTS).getRange(rowIdx, 1, 1, 9).setValues([[p.id, p.date,
    p.customer, p.orderId, p.amount, p.method, p.reference, p.receivedBy, p.notes]]);
  if (old.orderId) syncOrderPaid(old.orderId, -old.amount);
  if (p.orderId) syncOrderPaid(p.orderId, p.amount);
  p.row = rowIdx;
  return p;
}

function deletePayment(d) {
  var id = clean(d.paymentId);
  if (!id) throw new Error('paymentId is required');
  var rowIdx = findRowByValue(SHEETS.PAYMENTS, 1, id);
  if (rowIdx < 0) throw new Error('Payment not found: ' + id);
  var old = paymentFromRow(sh(SHEETS.PAYMENTS).getRange(rowIdx, 1, 1, 9).getValues()[0]);
  var sheet = sh(SHEETS.PAYMENTS);
  var last = sheet.getLastRow();
  if (rowIdx < last) {
    var below = sheet.getRange(rowIdx + 1, 1, last - rowIdx, 9).getValues();
    sheet.getRange(rowIdx, 1, below.length, 9).setValues(below);
  }
  sheet.getRange(last, 1, 1, 9).clearContent();
  if (old.orderId) syncOrderPaid(old.orderId, -old.amount);
  return { deleted: id };
}

/* ==========================================================================
 * Expenses
 * ========================================================================== */

function expenseFromRow(row) {
  var x = rowToObj(row, EXPENSES_COLS);
  x.amount = num(x.amount);
  return x;
}

function listExpenses(d) {
  var rows = readRows(SHEETS.EXPENSES, 8);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!String(rows[i][0] || '').trim() && !String(rows[i][3] || '').trim()) continue;
    var x = expenseFromRow(rows[i]);
    x.row = DATA_START_ROW + i;
    out.push(x);
  }
  var s = String((d && d.search) || '').toLowerCase();
  if (s) out = out.filter(function (x) {
    return (x.id + ' ' + x.category + ' ' + x.description + ' ' + x.relatedService).toLowerCase().indexOf(s) >= 0;
  });
  if (d && d.category) out = out.filter(function (x) { return x.category === d.category; });
  return out;
}

function addExpense(d) {
  var x = {
    id: newId('EXP', SHEETS.EXPENSES, 1),
    date: validDate(d.date),
    category: clean(d.category) || 'Other',
    description: clean(d.description),
    amount: Math.max(0, num(d.amount)),
    method: clean(d.method),
    relatedService: clean(d.relatedService),
    notes: clean(d.notes)
  };
  if (!x.description) throw new Error('Expense description is required');
  var sheet = sh(SHEETS.EXPENSES);
  var last = Math.max(sheet.getLastRow(), DATA_START_ROW - 1);
  var dest = last + 1;
  sheet.getRange(dest, 1, 1, 8).setValues([[x.id, x.date, x.category,
    x.description, x.amount, x.method, x.relatedService, x.notes]]);
  x.row = dest;
  return x;
}

function updateExpense(d) {
  var id = clean(d.expenseId);
  if (!id) throw new Error('expenseId is required');
  var rowIdx = findRowByValue(SHEETS.EXPENSES, 1, id);
  if (rowIdx < 0) throw new Error('Expense not found: ' + id);
  var old = expenseFromRow(sh(SHEETS.EXPENSES).getRange(rowIdx, 1, 1, 8).getValues()[0]);
  var x = {
    id: id,
    date: d.date !== undefined ? validDate(d.date) : old.date,
    category: d.category !== undefined ? clean(d.category) : old.category,
    description: d.description !== undefined ? clean(d.description) : old.description,
    amount: d.amount !== undefined ? Math.max(0, num(d.amount)) : old.amount,
    method: d.method !== undefined ? clean(d.method) : old.method,
    relatedService: d.relatedService !== undefined ? clean(d.relatedService) : old.relatedService,
    notes: d.notes !== undefined ? clean(d.notes) : old.notes
  };
  sh(SHEETS.EXPENSES).getRange(rowIdx, 1, 1, 8).setValues([[x.id, x.date,
    x.category, x.description, x.amount, x.method, x.relatedService, x.notes]]);
  x.row = rowIdx;
  return x;
}

function deleteExpense(d) {
  var id = clean(d.expenseId);
  if (!id) throw new Error('expenseId is required');
  var rowIdx = findRowByValue(SHEETS.EXPENSES, 1, id);
  if (rowIdx < 0) throw new Error('Expense not found: ' + id);
  var sheet = sh(SHEETS.EXPENSES);
  var last = sheet.getLastRow();
  if (rowIdx < last) {
    var below = sheet.getRange(rowIdx + 1, 1, last - rowIdx, 8).getValues();
    sheet.getRange(rowIdx, 1, below.length, 8).setValues(below);
  }
  sheet.getRange(last, 1, 1, 8).clearContent();
  return { deleted: id };
}

/* ==========================================================================
 * Househelps
 * ========================================================================== */

function househelpFromRow(row) {
  return rowToObj(row, HOUSEHELPS_COLS);
}

function listHousehelps(d) {
  var rows = readRows(SHEETS.HOUSEHELPS, 16);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!String(rows[i][1] || '').trim()) continue;
    var h = househelpFromRow(rows[i]);
    h.row = DATA_START_ROW + i;
    out.push(h);
  }
  var s = String((d && d.search) || '').toLowerCase();
  if (s) out = out.filter(function (h) {
    return (h.id + ' ' + h.fullName + ' ' + h.phone + ' ' + h.skills).toLowerCase().indexOf(s) >= 0;
  });
  if (d && d.status) out = out.filter(function (h) { return h.status === d.status; });
  return out;
}

function createHousehelp(d) {
  var h = {
    id: newId('HH', SHEETS.HOUSEHELPS, 1),
    fullName: clean(d.fullName),
    phone: clean(d.phone),
    email: clean(d.email),
    gender: clean(d.gender),
    nationality: clean(d.nationality),
    occupation: clean(d.occupation),
    nida: clean(d.nida),
    cityCountry: clean(d.cityCountry),
    homeAddress: clean(d.homeAddress),
    registrationDate: validDate(d.registrationDate),
    status: clean(d.status) || 'Available',
    skills: clean(d.skills),
    experience: clean(d.experience),
    availability: clean(d.availability),
    notes: clean(d.notes)
  };
  if (!h.fullName) throw new Error('Full name is required');
  var sheet = sh(SHEETS.HOUSEHELPS);
  var last = Math.max(sheet.getLastRow(), DATA_START_ROW - 1);
  var dest = last + 1;
  sheet.getRange(dest, 1, 1, 16).setValues([[h.id, h.fullName, h.phone, h.email,
    h.gender, h.nationality, h.occupation, h.nida, h.cityCountry, h.homeAddress,
    h.registrationDate, h.status, h.skills, h.experience, h.availability, h.notes]]);
  h.row = dest;
  return h;
}

function updateHousehelp(d) {
  var id = clean(d.househelpId);
  if (!id) throw new Error('househelpId is required');
  var rowIdx = findRowByValue(SHEETS.HOUSEHELPS, 1, id);
  if (rowIdx < 0) throw new Error('Househelp not found: ' + id);
  var old = househelpFromRow(sh(SHEETS.HOUSEHELPS).getRange(rowIdx, 1, 1, 16).getValues()[0]);
  var h = {
    id: id,
    fullName: d.fullName !== undefined ? clean(d.fullName) : old.fullName,
    phone: d.phone !== undefined ? clean(d.phone) : old.phone,
    email: d.email !== undefined ? clean(d.email) : old.email,
    gender: d.gender !== undefined ? clean(d.gender) : old.gender,
    nationality: d.nationality !== undefined ? clean(d.nationality) : old.nationality,
    occupation: d.occupation !== undefined ? clean(d.occupation) : old.occupation,
    nida: d.nida !== undefined ? clean(d.nida) : old.nida,
    cityCountry: d.cityCountry !== undefined ? clean(d.cityCountry) : old.cityCountry,
    homeAddress: d.homeAddress !== undefined ? clean(d.homeAddress) : old.homeAddress,
    registrationDate: d.registrationDate !== undefined ? validDate(d.registrationDate) : old.registrationDate,
    status: d.status !== undefined ? clean(d.status) : old.status,
    skills: d.skills !== undefined ? clean(d.skills) : old.skills,
    experience: d.experience !== undefined ? clean(d.experience) : old.experience,
    availability: d.availability !== undefined ? clean(d.availability) : old.availability,
    notes: d.notes !== undefined ? clean(d.notes) : old.notes
  };
  sh(SHEETS.HOUSEHELPS).getRange(rowIdx, 1, 1, 16).setValues([[h.id, h.fullName,
    h.phone, h.email, h.gender, h.nationality, h.occupation, h.nida,
    h.cityCountry, h.homeAddress, h.registrationDate, h.status, h.skills,
    h.experience, h.availability, h.notes]]);
  h.row = rowIdx;
  return h;
}

function archiveHousehelp(d) {
  var id = clean(d.househelpId);
  if (!id) throw new Error('househelpId is required');
  var rowIdx = findRowByValue(SHEETS.HOUSEHELPS, 1, id);
  if (rowIdx < 0) throw new Error('Househelp not found: ' + id);
  sh(SHEETS.HOUSEHELPS).getRange(rowIdx, 12).setValue('Inactive');
  return { archived: id, status: 'Inactive' };
}

/* ==========================================================================
 * Employers / Clients
 * ========================================================================== */

function employerFromRow(row) { return rowToObj(row, EMPLOYERS_COLS); }

function listEmployers(d) {
  var rows = readRows(SHEETS.EMPLOYERS, 13);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!String(rows[i][1] || '').trim()) continue;
    var e = employerFromRow(rows[i]);
    e.row = DATA_START_ROW + i;
    out.push(e);
  }
  var s = String((d && d.search) || '').toLowerCase();
  if (s) out = out.filter(function (e) {
    return (e.id + ' ' + e.fullName + ' ' + e.phone).toLowerCase().indexOf(s) >= 0;
  });
  return out;
}

function createEmployer(d) {
  var e = {
    id: newId('CL', SHEETS.EMPLOYERS, 1),
    fullName: clean(d.fullName),
    familyMember: clean(d.familyMember),
    phone: clean(d.phone),
    email: clean(d.email),
    gender: clean(d.gender),
    nationality: clean(d.nationality),
    occupation: clean(d.occupation),
    cityCountry: clean(d.cityCountry),
    nida: clean(d.nida),
    homeAddress: clean(d.homeAddress),
    registrationDate: validDate(d.registrationDate),
    notes: clean(d.notes)
  };
  if (!e.fullName) throw new Error('Full name is required');
  var sheet = sh(SHEETS.EMPLOYERS);
  var last = Math.max(sheet.getLastRow(), DATA_START_ROW - 1);
  var dest = last + 1;
  sheet.getRange(dest, 1, 1, 13).setValues([[e.id, e.fullName, e.familyMember,
    e.phone, e.email, e.gender, e.nationality, e.occupation, e.cityCountry,
    e.nida, e.homeAddress, e.registrationDate, e.notes]]);
  e.row = dest;
  return e;
}

function updateEmployer(d) {
  var id = clean(d.clientId);
  if (!id) throw new Error('clientId is required');
  var rowIdx = findRowByValue(SHEETS.EMPLOYERS, 1, id);
  if (rowIdx < 0) throw new Error('Employer not found: ' + id);
  var old = employerFromRow(sh(SHEETS.EMPLOYERS).getRange(rowIdx, 1, 1, 13).getValues()[0]);
  var e = {
    id: id,
    fullName: d.fullName !== undefined ? clean(d.fullName) : old.fullName,
    familyMember: d.familyMember !== undefined ? clean(d.familyMember) : old.familyMember,
    phone: d.phone !== undefined ? clean(d.phone) : old.phone,
    email: d.email !== undefined ? clean(d.email) : old.email,
    gender: d.gender !== undefined ? clean(d.gender) : old.gender,
    nationality: d.nationality !== undefined ? clean(d.nationality) : old.nationality,
    occupation: d.occupation !== undefined ? clean(d.occupation) : old.occupation,
    cityCountry: d.cityCountry !== undefined ? clean(d.cityCountry) : old.cityCountry,
    nida: d.nida !== undefined ? clean(d.nida) : old.nida,
    homeAddress: d.homeAddress !== undefined ? clean(d.homeAddress) : old.homeAddress,
    registrationDate: d.registrationDate !== undefined ? validDate(d.registrationDate) : old.registrationDate,
    notes: d.notes !== undefined ? clean(d.notes) : old.notes
  };
  sh(SHEETS.EMPLOYERS).getRange(rowIdx, 1, 1, 13).setValues([[e.id, e.fullName,
    e.familyMember, e.phone, e.email, e.gender, e.nationality, e.occupation,
    e.cityCountry, e.nida, e.homeAddress, e.registrationDate, e.notes]]);
  e.row = rowIdx;
  return e;
}

/* ==========================================================================
 * Placements
 * ========================================================================== */

function placementFromRow(row) {
  var p = rowToObj(row, PLACEMENTS_COLS);
  p.salary = num(p.salary);
  p.agencyFee = num(p.agencyFee);
  return p;
}

function placementView(p) {
  var v = Object.assign({}, p);
  v.househelpName = lookupName(SHEETS.HOUSEHELPS, p.househelpId, 2);
  v.employerName = lookupName(SHEETS.EMPLOYERS, p.employerId, 2);
  v.employerPhone = lookupName(SHEETS.EMPLOYERS, p.employerId, 4);
  return v;
}

function lookupName(sheetName, id, col) {
  if (!id) return '';
  var rows = readRows(sheetName, col);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) return String(rows[i][col - 1] || '');
  }
  return '';
}

function listPlacements(d) {
  var rows = readRows(SHEETS.PLACEMENTS, 17);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!String(rows[i][0] || '').trim()) continue;
    var p = placementFromRow(rows[i]);
    p.row = DATA_START_ROW + i;
    out.push(placementView(p));
  }
  var s = String((d && d.search) || '').toLowerCase();
  if (s) out = out.filter(function (p) {
    return (p.id + ' ' + p.househelpName + ' ' + p.employerName + ' ' + p.category).toLowerCase().indexOf(s) >= 0;
  });
  if (d && d.status) out = out.filter(function (p) { return p.status === d.status; });
  return out;
}

function createPlacement(d) {
  var p = {
    id: newId('PL', SHEETS.PLACEMENTS, 1),
    househelpId: clean(d.househelpId),
    employerId: clean(d.employerId),
    category: clean(d.category),
    jobDescription: clean(d.jobDescription),
    salary: Math.max(0, num(d.salary)),
    paymentFrequency: clean(d.paymentFrequency),
    startDate: validDate(d.startDate),
    expectedEndDate: clean(d.expectedEndDate),
    status: clean(d.status) || 'Pending',
    contractStatus: clean(d.contractStatus) || 'Pending',
    liveIn: clean(d.liveIn),
    workingHours: clean(d.workingHours),
    accommodation: clean(d.accommodation),
    meals: clean(d.meals),
    agencyFee: Math.max(0, num(d.agencyFee)),
    notes: clean(d.notes)
  };
  if (!p.househelpId || !p.employerId) throw new Error('Househelp and Employer are required');
  var sheet = sh(SHEETS.PLACEMENTS);
  var last = Math.max(sheet.getLastRow(), DATA_START_ROW - 1);
  var dest = last + 1;
  sheet.getRange(dest, 1, 1, 17).setValues([[p.id, p.househelpId, p.employerId,
    p.category, p.jobDescription, p.salary, p.paymentFrequency, p.startDate,
    p.expectedEndDate, p.status, p.contractStatus, p.liveIn, p.workingHours,
    p.accommodation, p.meals, p.agencyFee, p.notes]]);
  // househelp now placed (match updatePlacement's status mapping)
  var hhRow = findRowByValue(SHEETS.HOUSEHELPS, 1, p.househelpId);
  if (hhRow >= 0) {
    var st = p.status === 'Active' ? 'On Contract' :
      (p.status === 'Completed' || p.status === 'Terminated') ? 'Available' : 'Placed';
    sh(SHEETS.HOUSEHELPS).getRange(hhRow, 12).setValue(st);
  }
  p.row = dest;
  return placementView(p);
}

function updatePlacement(d) {
  var id = clean(d.placementId);
  if (!id) throw new Error('placementId is required');
  var rowIdx = findRowByValue(SHEETS.PLACEMENTS, 1, id);
  if (rowIdx < 0) throw new Error('Placement not found: ' + id);
  var old = placementFromRow(sh(SHEETS.PLACEMENTS).getRange(rowIdx, 1, 1, 17).getValues()[0]);
  var p = {
    id: id,
    househelpId: d.househelpId !== undefined ? clean(d.househelpId) : old.househelpId,
    employerId: d.employerId !== undefined ? clean(d.employerId) : old.employerId,
    category: d.category !== undefined ? clean(d.category) : old.category,
    jobDescription: d.jobDescription !== undefined ? clean(d.jobDescription) : old.jobDescription,
    salary: d.salary !== undefined ? Math.max(0, num(d.salary)) : old.salary,
    paymentFrequency: d.paymentFrequency !== undefined ? clean(d.paymentFrequency) : old.paymentFrequency,
    startDate: d.startDate !== undefined ? validDate(d.startDate) : old.startDate,
    expectedEndDate: d.expectedEndDate !== undefined ? clean(d.expectedEndDate) : old.expectedEndDate,
    status: d.status !== undefined ? clean(d.status) : old.status,
    contractStatus: d.contractStatus !== undefined ? clean(d.contractStatus) : old.contractStatus,
    liveIn: d.liveIn !== undefined ? clean(d.liveIn) : old.liveIn,
    workingHours: d.workingHours !== undefined ? clean(d.workingHours) : old.workingHours,
    accommodation: d.accommodation !== undefined ? clean(d.accommodation) : old.accommodation,
    meals: d.meals !== undefined ? clean(d.meals) : old.meals,
    agencyFee: d.agencyFee !== undefined ? Math.max(0, num(d.agencyFee)) : old.agencyFee,
    notes: d.notes !== undefined ? clean(d.notes) : old.notes
  };
  sh(SHEETS.PLACEMENTS).getRange(rowIdx, 1, 1, 17).setValues([[p.id, p.househelpId,
    p.employerId, p.category, p.jobDescription, p.salary, p.paymentFrequency,
    p.startDate, p.expectedEndDate, p.status, p.contractStatus, p.liveIn,
    p.workingHours, p.accommodation, p.meals, p.agencyFee, p.notes]]);
  var hhRow = findRowByValue(SHEETS.HOUSEHELPS, 1, p.househelpId);
  if (hhRow >= 0) {
    var st = p.status === 'Active' ? 'On Contract' :
      (p.status === 'Completed' || p.status === 'Terminated') ? 'Available' : 'Placed';
    sh(SHEETS.HOUSEHELPS).getRange(hhRow, 12).setValue(st);
  }
  p.row = rowIdx;
  return placementView(p);
}

function terminatePlacement(d) {
  var id = clean(d.placementId);
  if (!id) throw new Error('placementId is required');
  var rowIdx = findRowByValue(SHEETS.PLACEMENTS, 1, id);
  if (rowIdx < 0) throw new Error('Placement not found: ' + id);
  var reason = clean(d.reason);
  sh(SHEETS.PLACEMENTS).getRange(rowIdx, 10).setValue('Terminated');
  sh(SHEETS.PLACEMENTS).getRange(rowIdx, 11).setValue('Terminated');
  var oldNotes = String(sh(SHEETS.PLACEMENTS).getRange(rowIdx, 17).getValue() || '');
  var stamp = 'Terminated ' + validDate(d.date) + (reason ? ': ' + reason : '');
  sh(SHEETS.PLACEMENTS).getRange(rowIdx, 17).setValue((oldNotes ? oldNotes + ' | ' : '') + stamp);
  var hhId = String(sh(SHEETS.PLACEMENTS).getRange(rowIdx, 2).getValue() || '');
  var hhRow = findRowByValue(SHEETS.HOUSEHELPS, 1, hhId);
  if (hhRow >= 0) sh(SHEETS.HOUSEHELPS).getRange(hhRow, 12).setValue('Available');
  // terminate the linked contract as well
  var rows = readRows(SHEETS.CONTRACTS, 16);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][1]) === id) {
      sh(SHEETS.CONTRACTS).getRange(DATA_START_ROW + i, 9).setValue('Terminated');
      sh(SHEETS.CONTRACTS).getRange(DATA_START_ROW + i, 10).setValue(validDate(d.date));
      if (reason) sh(SHEETS.CONTRACTS).getRange(DATA_START_ROW + i, 11).setValue(clean(reason));
    }
  }
  return listPlacements({}).filter(function (p) { return p.id === id; })[0] ||
    { id: id, status: 'Terminated' };
}

/* ==========================================================================
 * Contracts
 * ========================================================================== */

function contractFromRow(row) { return rowToObj(row, CONTRACTS_COLS); }

function listContracts(d) {
  var rows = readRows(SHEETS.CONTRACTS, 16);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!String(rows[i][0] || '').trim()) continue;
    var c = contractFromRow(rows[i]);
    c.row = DATA_START_ROW + i;
    out.push(c);
  }
  var s = String((d && d.search) || '').toLowerCase();
  if (s) out = out.filter(function (c) {
    return (c.id + ' ' + c.employer + ' ' + c.househelp + ' ' + c.placementId).toLowerCase().indexOf(s) >= 0;
  });
  if (d && d.status) out = out.filter(function (c) { return c.status === d.status; });
  return out;
}

function createContract(d) {
  var c = {
    id: newId('CON', SHEETS.CONTRACTS, 1),
    placementId: clean(d.placementId),
    employer: clean(d.employer),
    househelp: clean(d.househelp),
    startDate: validDate(d.startDate),
    endDate: clean(d.endDate),
    minimumDuration: clean(d.minimumDuration),
    noticeRequired: clean(d.noticeRequired),
    status: clean(d.status) || 'Pending',
    terminationDate: '',
    terminationReason: '',
    documentLink: clean(d.documentLink),
    employerSignature: clean(d.employerSignature),
    househelpSignature: clean(d.househelpSignature),
    deeAck: clean(d.deeAck),
    notes: clean(d.notes)
  };
  if (!c.employer || !c.househelp) throw new Error('Employer and Househelp are required');
  var sheet = sh(SHEETS.CONTRACTS);
  var last = Math.max(sheet.getLastRow(), DATA_START_ROW - 1);
  var dest = last + 1;
  sheet.getRange(dest, 1, 1, 16).setValues([[c.id, c.placementId, c.employer,
    c.househelp, c.startDate, c.endDate, c.minimumDuration, c.noticeRequired,
    c.status, c.terminationDate, c.terminationReason, c.documentLink,
    c.employerSignature, c.househelpSignature, c.deeAck, c.notes]]);
  // keep the placement contract status in sync
  if (c.placementId) {
    var pRow = findRowByValue(SHEETS.PLACEMENTS, 1, c.placementId);
    if (pRow >= 0) {
      sh(SHEETS.PLACEMENTS).getRange(pRow, 11).setValue(c.status);
      if (c.status === 'Active') sh(SHEETS.PLACEMENTS).getRange(pRow, 10).setValue('Active');
    }
  }
  c.row = dest;
  return c;
}

function updateContract(d) {
  var id = clean(d.contractId);
  if (!id) throw new Error('contractId is required');
  var rowIdx = findRowByValue(SHEETS.CONTRACTS, 1, id);
  if (rowIdx < 0) throw new Error('Contract not found: ' + id);
  var old = contractFromRow(sh(SHEETS.CONTRACTS).getRange(rowIdx, 1, 1, 16).getValues()[0]);
  var c = {
    id: id,
    placementId: d.placementId !== undefined ? clean(d.placementId) : old.placementId,
    employer: d.employer !== undefined ? clean(d.employer) : old.employer,
    househelp: d.househelp !== undefined ? clean(d.househelp) : old.househelp,
    startDate: d.startDate !== undefined ? validDate(d.startDate) : old.startDate,
    endDate: d.endDate !== undefined ? clean(d.endDate) : old.endDate,
    minimumDuration: d.minimumDuration !== undefined ? clean(d.minimumDuration) : old.minimumDuration,
    noticeRequired: d.noticeRequired !== undefined ? clean(d.noticeRequired) : old.noticeRequired,
    status: d.status !== undefined ? clean(d.status) : old.status,
    terminationDate: d.terminationDate !== undefined ? clean(d.terminationDate) : old.terminationDate,
    terminationReason: d.terminationReason !== undefined ? clean(d.terminationReason) : old.terminationReason,
    documentLink: d.documentLink !== undefined ? clean(d.documentLink) : old.documentLink,
    employerSignature: d.employerSignature !== undefined ? clean(d.employerSignature) : old.employerSignature,
    househelpSignature: d.househelpSignature !== undefined ? clean(d.househelpSignature) : old.househelpSignature,
    deeAck: d.deeAck !== undefined ? clean(d.deeAck) : old.deeAck,
    notes: d.notes !== undefined ? clean(d.notes) : old.notes
  };
  sh(SHEETS.CONTRACTS).getRange(rowIdx, 1, 1, 16).setValues([[c.id, c.placementId,
    c.employer, c.househelp, c.startDate, c.endDate, c.minimumDuration,
    c.noticeRequired, c.status, c.terminationDate, c.terminationReason,
    c.documentLink, c.employerSignature, c.househelpSignature, c.deeAck, c.notes]]);
  if (c.placementId) {
    var pRow = findRowByValue(SHEETS.PLACEMENTS, 1, c.placementId);
    if (pRow >= 0) {
      sh(SHEETS.PLACEMENTS).getRange(pRow, 11).setValue(c.status);
      if (c.status === 'Active') sh(SHEETS.PLACEMENTS).getRange(pRow, 10).setValue('Active');
    }
  }
  c.row = rowIdx;
  return c;
}

function terminateContract(d) {
  var id = clean(d.contractId);
  if (!id) throw new Error('contractId is required');
  var rowIdx = findRowByValue(SHEETS.CONTRACTS, 1, id);
  if (rowIdx < 0) throw new Error('Contract not found: ' + id);
  sh(SHEETS.CONTRACTS).getRange(rowIdx, 9).setValue('Terminated');
  sh(SHEETS.CONTRACTS).getRange(rowIdx, 10).setValue(validDate(d.date));
  if (d.reason) sh(SHEETS.CONTRACTS).getRange(rowIdx, 11).setValue(clean(d.reason));
  var pId = String(sh(SHEETS.CONTRACTS).getRange(rowIdx, 2).getValue() || '');
  if (pId) {
    var pRow = findRowByValue(SHEETS.PLACEMENTS, 1, pId);
    if (pRow >= 0) {
      sh(SHEETS.PLACEMENTS).getRange(pRow, 10).setValue('Terminated');
      sh(SHEETS.PLACEMENTS).getRange(pRow, 11).setValue('Terminated');
    }
  }
  return listContracts({}).filter(function (c) { return c.id === id; })[0] ||
    { id: id, status: 'Terminated' };
}

/* ==========================================================================
 * Househelp payments (kept separate from cleaning revenue)
 * ========================================================================== */

function hhPaymentFromRow(row) {
  var p = rowToObj(row, HH_PAYMENTS_COLS);
  p.amount = num(p.amount);
  return p;
}

function listHousehelpPayments(d) {
  var rows = readRows(SHEETS.HOUSEHELP_PAYMENTS, 11);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!String(rows[i][0] || '').trim()) continue;
    var p = hhPaymentFromRow(rows[i]);
    p.row = DATA_START_ROW + i;
    out.push(p);
  }
  var s = String((d && d.search) || '').toLowerCase();
  if (s) out = out.filter(function (p) {
    return (p.id + ' ' + p.househelpId + ' ' + p.placementId + ' ' + p.period).toLowerCase().indexOf(s) >= 0;
  });
  return out;
}

function createHousehelpPayment(d) {
  var p = {
    id: newId('HHP', SHEETS.HOUSEHELP_PAYMENTS, 1),
    househelpId: clean(d.househelpId),
    employerId: clean(d.employerId),
    placementId: clean(d.placementId),
    paymentDate: validDate(d.paymentDate),
    period: clean(d.period),
    amount: Math.max(0, num(d.amount)),
    method: clean(d.method),
    status: clean(d.status) || 'Pending',
    reference: clean(d.reference),
    notes: clean(d.notes)
  };
  if (!p.househelpId && !p.placementId) throw new Error('Househelp or Placement is required');
  var sheet = sh(SHEETS.HOUSEHELP_PAYMENTS);
  var last = Math.max(sheet.getLastRow(), DATA_START_ROW - 1);
  var dest = last + 1;
  sheet.getRange(dest, 1, 1, 11).setValues([[p.id, p.househelpId, p.employerId,
    p.placementId, p.paymentDate, p.period, p.amount, p.method, p.status,
    p.reference, p.notes]]);
  p.row = dest;
  return p;
}

function updateHousehelpPayment(d) {
  var id = clean(d.paymentId);
  if (!id) throw new Error('paymentId is required');
  var rowIdx = findRowByValue(SHEETS.HOUSEHELP_PAYMENTS, 1, id);
  if (rowIdx < 0) throw new Error('Househelp payment not found: ' + id);
  var old = hhPaymentFromRow(sh(SHEETS.HOUSEHELP_PAYMENTS).getRange(rowIdx, 1, 1, 11).getValues()[0]);
  var p = {
    id: id,
    househelpId: d.househelpId !== undefined ? clean(d.househelpId) : old.househelpId,
    employerId: d.employerId !== undefined ? clean(d.employerId) : old.employerId,
    placementId: d.placementId !== undefined ? clean(d.placementId) : old.placementId,
    paymentDate: d.paymentDate !== undefined ? validDate(d.paymentDate) : old.paymentDate,
    period: d.period !== undefined ? clean(d.period) : old.period,
    amount: d.amount !== undefined ? Math.max(0, num(d.amount)) : old.amount,
    method: d.method !== undefined ? clean(d.method) : old.method,
    status: d.status !== undefined ? clean(d.status) : old.status,
    reference: d.reference !== undefined ? clean(d.reference) : old.reference,
    notes: d.notes !== undefined ? clean(d.notes) : old.notes
  };
  sh(SHEETS.HOUSEHELP_PAYMENTS).getRange(rowIdx, 1, 1, 11).setValues([[p.id,
    p.househelpId, p.employerId, p.placementId, p.paymentDate, p.period,
    p.amount, p.method, p.status, p.reference, p.notes]]);
  p.row = rowIdx;
  return p;
}

/* ==========================================================================
 * Complaints
 * ========================================================================== */

function complaintFromRow(row) { return rowToObj(row, COMPLAINTS_COLS); }

function listComplaints(d) {
  var rows = readRows(SHEETS.COMPLAINTS, 14);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!String(rows[i][0] || '').trim()) continue;
    var c = complaintFromRow(rows[i]);
    c.row = DATA_START_ROW + i;
    out.push(c);
  }
  var s = String((d && d.search) || '').toLowerCase();
  if (s) out = out.filter(function (c) {
    return (c.id + ' ' + c.client + ' ' + c.househelp + ' ' + c.type + ' ' + c.description).toLowerCase().indexOf(s) >= 0;
  });
  if (d && d.status) out = out.filter(function (c) { return c.status === d.status; });
  return out;
}

function createComplaint(d) {
  var c = {
    id: newId('CMP', SHEETS.COMPLAINTS, 1),
    date: validDate(d.date),
    client: clean(d.client),
    househelp: clean(d.househelp),
    placement: clean(d.placement),
    type: clean(d.type) || 'Other',
    description: clean(d.description),
    reportedBy: clean(d.reportedBy),
    severity: clean(d.severity) || 'Medium',
    status: clean(d.status) || 'Reported',
    action: clean(d.action),
    resolution: clean(d.resolution),
    resolutionDate: clean(d.resolutionDate),
    notes: clean(d.notes)
  };
  if (!c.description) throw new Error('Complaint description is required');
  var sheet = sh(SHEETS.COMPLAINTS);
  var last = Math.max(sheet.getLastRow(), DATA_START_ROW - 1);
  var dest = last + 1;
  sheet.getRange(dest, 1, 1, 14).setValues([[c.id, c.date, c.client, c.househelp,
    c.placement, c.type, c.description, c.reportedBy, c.severity, c.status,
    c.action, c.resolution, c.resolutionDate, c.notes]]);
  c.row = dest;
  return c;
}

function updateComplaint(d) {
  var id = clean(d.complaintId);
  if (!id) throw new Error('complaintId is required');
  var rowIdx = findRowByValue(SHEETS.COMPLAINTS, 1, id);
  if (rowIdx < 0) throw new Error('Complaint not found: ' + id);
  var old = complaintFromRow(sh(SHEETS.COMPLAINTS).getRange(rowIdx, 1, 1, 14).getValues()[0]);
  var c = {
    id: id,
    date: d.date !== undefined ? validDate(d.date) : old.date,
    client: d.client !== undefined ? clean(d.client) : old.client,
    househelp: d.househelp !== undefined ? clean(d.househelp) : old.househelp,
    placement: d.placement !== undefined ? clean(d.placement) : old.placement,
    type: d.type !== undefined ? clean(d.type) : old.type,
    description: d.description !== undefined ? clean(d.description) : old.description,
    reportedBy: d.reportedBy !== undefined ? clean(d.reportedBy) : old.reportedBy,
    severity: d.severity !== undefined ? clean(d.severity) : old.severity,
    status: d.status !== undefined ? clean(d.status) : old.status,
    action: d.action !== undefined ? clean(d.action) : old.action,
    resolution: d.resolution !== undefined ? clean(d.resolution) : old.resolution,
    resolutionDate: d.resolutionDate !== undefined ? clean(d.resolutionDate) : old.resolutionDate,
    notes: d.notes !== undefined ? clean(d.notes) : old.notes
  };
  sh(SHEETS.COMPLAINTS).getRange(rowIdx, 1, 1, 14).setValues([[c.id, c.date,
    c.client, c.househelp, c.placement, c.type, c.description, c.reportedBy,
    c.severity, c.status, c.action, c.resolution, c.resolutionDate, c.notes]]);
  c.row = rowIdx;
  return c;
}

function resolveComplaint(d) {
  var id = clean(d.complaintId);
  if (!id) throw new Error('complaintId is required');
  var rowIdx = findRowByValue(SHEETS.COMPLAINTS, 1, id);
  if (rowIdx < 0) throw new Error('Complaint not found: ' + id);
  sh(SHEETS.COMPLAINTS).getRange(rowIdx, 10).setValue(clean(d.status) || 'Resolved');
  if (d.action !== undefined) sh(SHEETS.COMPLAINTS).getRange(rowIdx, 11).setValue(clean(d.action));
  if (d.resolution !== undefined) sh(SHEETS.COMPLAINTS).getRange(rowIdx, 12).setValue(clean(d.resolution));
  sh(SHEETS.COMPLAINTS).getRange(rowIdx, 13).setValue(validDate(d.resolutionDate));
  return listComplaints({}).filter(function (c) { return c.id === id; })[0] ||
    { id: id, status: 'Resolved' };
}

/* ==========================================================================
 * Replacements
 * ========================================================================== */

function replacementFromRow(row) { return rowToObj(row, REPLACEMENTS_COLS); }

function listReplacements(d) {
  var rows = readRows(SHEETS.REPLACEMENTS, 10);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!String(rows[i][0] || '').trim()) continue;
    var r = replacementFromRow(rows[i]);
    r.row = DATA_START_ROW + i;
    out.push(r);
  }
  var s = String((d && d.search) || '').toLowerCase();
  if (s) out = out.filter(function (r) {
    return (r.id + ' ' + r.employer + ' ' + r.originalHousehelp + ' ' + r.reason).toLowerCase().indexOf(s) >= 0;
  });
  return out;
}

function createReplacement(d) {
  var r = {
    id: newId('REP', SHEETS.REPLACEMENTS, 1),
    originalPlacement: clean(d.originalPlacement),
    originalHousehelp: clean(d.originalHousehelp),
    employer: clean(d.employer),
    reason: clean(d.reason),
    requestDate: validDate(d.requestDate),
    replacementHousehelp: clean(d.replacementHousehelp),
    replacementDate: clean(d.replacementDate),
    status: clean(d.status) || 'Requested',
    notes: clean(d.notes)
  };
  if (!r.employer) throw new Error('Employer is required');
  var sheet = sh(SHEETS.REPLACEMENTS);
  var last = Math.max(sheet.getLastRow(), DATA_START_ROW - 1);
  var dest = last + 1;
  sheet.getRange(dest, 1, 1, 10).setValues([[r.id, r.originalPlacement,
    r.originalHousehelp, r.employer, r.reason, r.requestDate,
    r.replacementHousehelp, r.replacementDate, r.status, r.notes]]);
  // flag the original placement
  if (r.originalPlacement) {
    var pRow = findRowByValue(SHEETS.PLACEMENTS, 1, r.originalPlacement);
    if (pRow >= 0) sh(SHEETS.PLACEMENTS).getRange(pRow, 10).setValue('Replacement Required');
  }
  r.row = dest;
  return r;
}

function updateReplacement(d) {
  var id = clean(d.replacementId);
  if (!id) throw new Error('replacementId is required');
  var rowIdx = findRowByValue(SHEETS.REPLACEMENTS, 1, id);
  if (rowIdx < 0) throw new Error('Replacement not found: ' + id);
  var old = replacementFromRow(sh(SHEETS.REPLACEMENTS).getRange(rowIdx, 1, 1, 10).getValues()[0]);
  var r = {
    id: id,
    originalPlacement: d.originalPlacement !== undefined ? clean(d.originalPlacement) : old.originalPlacement,
    originalHousehelp: d.originalHousehelp !== undefined ? clean(d.originalHousehelp) : old.originalHousehelp,
    employer: d.employer !== undefined ? clean(d.employer) : old.employer,
    reason: d.reason !== undefined ? clean(d.reason) : old.reason,
    requestDate: d.requestDate !== undefined ? validDate(d.requestDate) : old.requestDate,
    replacementHousehelp: d.replacementHousehelp !== undefined ? clean(d.replacementHousehelp) : old.replacementHousehelp,
    replacementDate: d.replacementDate !== undefined ? clean(d.replacementDate) : old.replacementDate,
    status: d.status !== undefined ? clean(d.status) : old.status,
    notes: d.notes !== undefined ? clean(d.notes) : old.notes
  };
  sh(SHEETS.REPLACEMENTS).getRange(rowIdx, 1, 1, 10).setValues([[r.id,
    r.originalPlacement, r.originalHousehelp, r.employer, r.reason,
    r.requestDate, r.replacementHousehelp, r.replacementDate, r.status, r.notes]]);
  r.row = rowIdx;
  return r;
}

/* ==========================================================================
 * Attendance
 * ========================================================================== */

function attendanceFromRow(row) { return rowToObj(row, ATTENDANCE_COLS); }

function listAttendance(d) {
  var rows = readRows(SHEETS.ATTENDANCE, 9);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!String(rows[i][0] || '').trim()) continue;
    var a = attendanceFromRow(rows[i]);
    a.row = DATA_START_ROW + i;
    out.push(a);
  }
  if (d && d.date) out = out.filter(function (a) { return a.date === d.date; });
  return out;
}

function createAttendance(d) {
  var a = {
    id: newId('ATT', SHEETS.ATTENDANCE, 1),
    date: validDate(d.date),
    personType: clean(d.personType),
    person: clean(d.person),
    checkIn: clean(d.checkIn),
    checkOut: clean(d.checkOut),
    hours: clean(d.hours),
    status: clean(d.status) || 'Present',
    notes: clean(d.notes)
  };
  if (!a.person) throw new Error('Person is required');
  var sheet = sh(SHEETS.ATTENDANCE);
  var last = Math.max(sheet.getLastRow(), DATA_START_ROW - 1);
  var dest = last + 1;
  sheet.getRange(dest, 1, 1, 9).setValues([[a.id, a.date, a.personType, a.person,
    a.checkIn, a.checkOut, a.hours, a.status, a.notes]]);
  a.row = dest;
  return a;
}

function updateAttendance(d) {
  var id = clean(d.attendanceId);
  if (!id) throw new Error('attendanceId is required');
  var rowIdx = findRowByValue(SHEETS.ATTENDANCE, 1, id);
  if (rowIdx < 0) throw new Error('Attendance record not found: ' + id);
  var old = attendanceFromRow(sh(SHEETS.ATTENDANCE).getRange(rowIdx, 1, 1, 9).getValues()[0]);
  var a = {
    id: id,
    date: d.date !== undefined ? validDate(d.date) : old.date,
    personType: d.personType !== undefined ? clean(d.personType) : old.personType,
    person: d.person !== undefined ? clean(d.person) : old.person,
    checkIn: d.checkIn !== undefined ? clean(d.checkIn) : old.checkIn,
    checkOut: d.checkOut !== undefined ? clean(d.checkOut) : old.checkOut,
    hours: d.hours !== undefined ? clean(d.hours) : old.hours,
    status: d.status !== undefined ? clean(d.status) : old.status,
    notes: d.notes !== undefined ? clean(d.notes) : old.notes
  };
  sh(SHEETS.ATTENDANCE).getRange(rowIdx, 1, 1, 9).setValues([[a.id, a.date,
    a.personType, a.person, a.checkIn, a.checkOut, a.hours, a.status, a.notes]]);
  a.row = rowIdx;
  return a;
}

/* ==========================================================================
 * Dashboard
 * ========================================================================== */

function getDashboard(d) {
  var orders = listOrders({});
  var expenses = listExpenses({});
  var customers = listCustomers({});
  var househelps = listHousehelps({});
  var placements = listPlacements({});
  var contracts = listContracts({});
  var hhPayments = listHousehelpPayments({});
  var complaints = listComplaints({});
  var replacements = listReplacements({});

  var today = todayISO();
  var month = today.slice(0, 7);
  var weekAgo = isoDaysAgo(6);

  var todayOrders = orders.filter(function (o) { return o.date === today; });
  var kpi = {
    todaySales: sum(todayOrders.map(function (o) { return o.total; })),
    todayOrders: todayOrders.length,
    todayExpenses: sum(expenses.filter(function (x) { return x.date === today; }).map(function (x) { return x.amount; })),
    todayProfit: sum(todayOrders.map(function (o) { return o.netServiceProfit; })) -
      sum(expenses.filter(function (x) { return x.date === today; }).map(function (x) { return x.amount; })),
    weeklyRevenue: sum(orders.filter(function (o) { return o.date >= weekAgo; }).map(function (o) { return o.total; })),
    monthlyRevenue: sum(orders.filter(function (o) { return o.date.slice(0, 7) === month; }).map(function (o) { return o.total; })),
    monthlyExpenses: sum(expenses.filter(function (x) { return x.date.slice(0, 7) === month; }).map(function (x) { return x.amount; })),
    monthlyProfit: sum(orders.filter(function (o) { return o.date.slice(0, 7) === month; }).map(function (o) { return o.netServiceProfit; })) -
      sum(expenses.filter(function (x) { return x.date.slice(0, 7) === month; }).map(function (x) { return x.amount; })),
    outstanding: sum(orders.map(function (o) { return o.balance; })),
    activeCustomers: customers.filter(function (c) { return c.status === 'Active'; }).length,
    activeHousehelps: househelps.filter(function (h) { return h.status === 'Placed' || h.status === 'On Contract'; }).length,
    activePlacements: placements.filter(function (p) { return p.status === 'Active'; }).length,
    pendingHousehelpPayments: hhPayments.filter(function (p) { return p.status === 'Pending'; }).length,
    activeContracts: contracts.filter(function (c) { return c.status === 'Active'; }).length,
    contractsExpiringSoon: contracts.filter(function (c) {
      return c.status === 'Active' && c.endDate && c.endDate >= today && c.endDate <= isoDaysAhead(30);
    }).length,
    openComplaints: complaints.filter(function (c) {
      return c.status !== 'Resolved' && c.status !== 'Escalated';
    }).length,
    replacementRequests: replacements.filter(function (r) {
      return r.status === 'Requested' || r.status === 'In Progress';
    }).length
  };

  var charts = {
    revenueLast30Days: dailySeries(orders, 30, function (o) { return o.total; }),
    profitLast30Days: dailySeries(orders, 30, function (o) { return o.netServiceProfit; }, expenses),
    ordersByStatus: groupCount(orders, function (o) { return o.orderStatus || 'Pending'; }),
    paymentStatus: groupCount(orders, function (o) { return o.paymentStatus; }),
    revenueByService: groupSum(orders, function (o) { return o.service || 'Other'; }, function (o) { return o.total; }),
    revenueByServiceCategory: groupSum(orders, function (o) { return serviceCategoryOf(o.service); }, function (o) { return o.total; }),
    monthlyRevenue: monthlySeries(orders, 12, function (o) { return o.total; }),
    monthlyExpenses: monthlySeries(expenses, 12, function (x) { return x.amount; }),
    placementsByStatus: groupCount(placements, function (p) { return p.status || 'Pending'; }),
    househelpCategories: groupCount(placements, function (p) { return p.category || 'Other'; }),
    complaintsByStatus: groupCount(complaints, function (c) { return c.status || 'Reported'; }),
    contractStatuses: groupCount(contracts, function (c) { return c.status || 'Pending'; })
  };

  return { kpi: kpi, charts: charts, generatedAt: today };
}

function sum(arr) { var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i]; return s; }

function groupCount(items, keyFn) {
  var m = {};
  items.forEach(function (it) { var k = keyFn(it); m[k] = (m[k] || 0) + 1; });
  return Object.keys(m).map(function (k) { return { label: k, value: m[k] }; });
}

function groupSum(items, keyFn, valFn) {
  var m = {};
  items.forEach(function (it) { var k = keyFn(it); m[k] = (m[k] || 0) + valFn(it); });
  return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; })
    .map(function (k) { return { label: k, value: m[k] }; });
}

function isoDaysAgo(n) {
  var d = new Date();
  d.setDate(d.getDate() - n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
}

function isoDaysAhead(n) {
  var d = new Date();
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
}

function dailySeries(orders, days, valFn, expenses) {
  var out = [];
  var expMap = {};
  if (expenses) {
    expenses.forEach(function (x) { expMap[x.date] = (expMap[x.date] || 0) + x.amount; });
  }
  for (var i = days - 1; i >= 0; i--) {
    var d = isoDaysAgo(i);
    var v = sum(orders.filter(function (o) { return o.date === d; }).map(valFn));
    if (expenses) v -= (expMap[d] || 0);
    out.push({ date: d, value: v });
  }
  return out;
}

function monthlySeries(items, months, valFn) {
  var out = [];
  var now = new Date();
  for (var i = months - 1; i >= 0; i--) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    var key = d.getFullYear() + '-' + pad(d.getMonth() + 1, 2);
    out.push({ month: key, value: sum(items.filter(function (it) {
      return String(it.date).slice(0, 7) === key;
    }).map(valFn)) });
  }
  return out;
}

/* ==========================================================================
 * Reports
 * ========================================================================== */

function getReport(d) {
  var type = clean(d.type);
  if (!type) throw new Error('Report type is required');
  var orders = listOrders({});
  var expenses = listExpenses({});
  var from = clean(d.from);
  var to = clean(d.to);

  switch (type) {
    case 'daily': {
      var days = {};
      orders.forEach(function (o) {
        if (from && o.date < from) return;
        if (to && o.date > to) return;
        days[o.date] = days[o.date] || { date: o.date, orders: 0, revenue: 0, paid: 0, transport: 0, directExpenses: 0, profit: 0 };
        days[o.date].orders++;
        days[o.date].revenue += o.total;
        days[o.date].paid += o.amountPaid;
        days[o.date].transport += o.transportFee;
        days[o.date].directExpenses += o.directExpense;
        days[o.date].profit += o.netServiceProfit;
      });
      expenses.forEach(function (x) {
        if (from && x.date < from) return;
        if (to && x.date > to) return;
        // expense-only days still appear as their own rows
        days[x.date] = days[x.date] || { date: x.date, orders: 0, revenue: 0,
          paid: 0, transport: 0, directExpenses: 0, profit: 0 };
        days[x.date].profit -= x.amount;
        days[x.date].otherExpenses = (days[x.date].otherExpenses || 0) + x.amount;
      });
      return { rows: Object.keys(days).sort().map(function (k) { return days[k]; }) };
    }
    case 'weekly': case 'monthly': case 'yearly': {
      var buckets = {};
      var keyFn = type === 'weekly' ? weekKey : type === 'monthly' ? monthKey : yearKey;
      orders.forEach(function (o) {
        if (from && o.date < from) return;
        if (to && o.date > to) return;
        var k = keyFn(o.date);
        buckets[k] = buckets[k] || { period: k, orders: 0, revenue: 0, paid: 0, profit: 0 };
        buckets[k].orders++;
        buckets[k].revenue += o.total;
        buckets[k].paid += o.amountPaid;
        buckets[k].profit += o.netServiceProfit;
      });
      expenses.forEach(function (x) {
        if (from && x.date < from) return;
        if (to && x.date > to) return;
        var k = keyFn(x.date);
        // expense-only periods still appear as their own rows
        buckets[k] = buckets[k] || { period: k, orders: 0, revenue: 0, paid: 0, profit: 0 };
        buckets[k].profit -= x.amount;
        buckets[k].expenses = (buckets[k].expenses || 0) + x.amount;
      });
      return { rows: Object.keys(buckets).sort().map(function (k) { return buckets[k]; }) };
    }
    case 'pnl': {
      var inRange = function (o) {
        return (!from || o.date >= from) && (!to || o.date <= to);
      };
      var rangedOrders = orders.filter(inRange);
      var revenue = sum(rangedOrders.map(function (o) { return o.total; }));
      var transport = sum(rangedOrders.map(function (o) { return o.transportFee; }));
      var directExpenses = sum(rangedOrders.map(function (o) { return o.directExpense; }));
      var byCategory = {};
      var otherExpenses = 0;
      expenses.forEach(function (x) {
        if (from && x.date < from) return;
        if (to && x.date > to) return;
        byCategory[x.category] = (byCategory[x.category] || 0) + x.amount;
        otherExpenses += x.amount;
      });
      return {
        revenue: revenue,
        transportFees: transport,
        directServiceExpenses: directExpenses,
        expensesByCategory: Object.keys(byCategory).map(function (k) {
          return { category: k, amount: byCategory[k] };
        }),
        totalExpenses: directExpenses + otherExpenses,
        netProfit: revenue + transport - directExpenses - otherExpenses
      };
    }
    case 'outstanding': {
      var rows = orders.filter(function (o) { return o.balance > 0; })
        .map(function (o) {
          return { orderId: o.id, date: o.date, customer: o.customerName,
            phone: o.phone, service: o.service, total: o.total, paid: o.amountPaid,
            balance: o.balance };
        });
      rows.sort(function (a, b) { return b.balance - a.balance; });
      return { rows: rows, totalOutstanding: sum(rows.map(function (r) { return r.balance; })) };
    }
    case 'customers': {
      var rows = listCustomers({});
      if (from || to) {
        rows = rows.filter(function (c) {
          return (!from || c.lastServiceDate >= from) && (!to || c.lastServiceDate <= to);
        });
      }
      return { rows: rows };
    }
    case 'services': {
      var svcOrders = orders.filter(function (o) {
        return (!from || o.date >= from) && (!to || o.date <= to);
      });
      var rows = groupSum(svcOrders, function (o) { return o.service || 'Other'; },
        function (o) { return o.total; });
      var counts = groupCount(svcOrders, function (o) { return o.service || 'Other'; });
      return {
        rows: rows.map(function (r) {
          var c = counts.filter(function (x) { return x.label === r.label; });
          return { service: r.label, orders: c.length ? c[0].value : 0, revenue: r.value };
        })
      };
    }
    case 'laundry': {
      var laundry = orders.filter(function (o) {
        return serviceCategoryOf(o.service) === 'Laundry' &&
          (!from || o.date >= from) && (!to || o.date <= to);
      });
      var byName = groupSum(laundry, function (o) { return o.service || 'Other'; },
        function (o) { return o.total; });
      var counts = groupCount(laundry, function (o) { return o.service || 'Other'; });
      return {
        rows: byName.map(function (r) {
          var c = counts.filter(function (x) { return x.label === r.label; });
          return { service: r.label, orders: c.length ? c[0].value : 0, revenue: r.value };
        }),
        totalLaundryRevenue: sum(laundry.map(function (o) { return o.total; }))
      };
    }
    case 'househelps': {
      var hh = listHousehelps({});
      var placements = listPlacements({});
      return { rows: hh.map(function (h) {
        var p = placements.filter(function (pl) {
          return pl.househelpId === h.id &&
            (pl.status === 'Active' || pl.status === 'Pending' || pl.status === 'Matching' || pl.status === 'Contract Pending');
        })[0];
        return Object.assign({}, h, {
          currentPlacement: p ? p.id : '',
          currentEmployer: p ? p.employerName : '',
          placementStatus: p ? p.status : ''
        });
      }) };
    }
    case 'placements': {
      return { rows: listPlacements({}) };
    }
    case 'contracts': {
      return { rows: listContracts({}) };
    }
    case 'complaints': {
      return { rows: listComplaints({}) };
    }
    case 'replacements': {
      return { rows: listReplacements({}) };
    }
    case 'payments': {
      var rows = listPayments({});
      if (from) rows = rows.filter(function (p) { return p.date >= from; });
      if (to) rows = rows.filter(function (p) { return p.date <= to; });
      return { rows: rows, total: sum(rows.map(function (p) { return p.amount; })) };
    }
    default:
      throw new Error('Unknown report type: ' + type);
  }
}

function weekKey(iso) {
  var d = new Date(iso + 'T00:00:00');
  var day = (d.getDay() + 6) % 7;               // Monday = 0
  d.setDate(d.getDate() - day + 3);             // Thursday of this week
  var firstThursday = new Date(d.getFullYear(), 0, 4);
  var week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 +
    ((firstThursday.getDay() + 6) % 7)) / 7);
  var monday = new Date(d);
  monday.setDate(monday.getDate() - 3);
  return d.getFullYear() + '-W' + pad(week, 2) +
    ' (' + monday.getFullYear() + '-' + pad(monday.getMonth() + 1, 2) +
    '-' + pad(monday.getDate(), 2) + ')';
}

function monthKey(iso) { return String(iso).slice(0, 7); }
function yearKey(iso) { return String(iso).slice(0, 4); }
