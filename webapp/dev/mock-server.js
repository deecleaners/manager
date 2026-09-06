#!/usr/bin/env node
/**
 * ============================================================================
 *  DEE CLEANERS — Mock Development Server  (webapp/dev/mock-server.js)
 * ============================================================================
 *  Runs on http://localhost:8787 and behaves exactly like the Google Apps
 *  Script backend (webapp/backend/Code.gs):
 *
 *    - serves the frontend from ../frontend
 *    - exposes the same JSON API at /api  (GET ?action=... and POST {action,data})
 *    - same actions, same response envelope: { ok: true, data } | { ok: false, error }
 *    - same business rules: formula columns are never touched, deleted orders
 *      go to the Archive, payments update the linked order's Amount Paid,
 *      customers are aggregated from Orders, IDs are sequential (DC-0001...).
 *
 *  Data is kept IN MEMORY and seeded with realistic Dee Cleaners sample data
 *  (relative dates, so the dashboard looks alive). Restarting the server
 *  resets the demo data.
 *
 *  Usage:  node webapp/dev/mock-server.js        (from the project root)
 * ============================================================================
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8787;
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const API_VERSION = '1.0.0-mock';

/* --------------------------------------------------------------------------
 * Date helpers — ISO strings everywhere (YYYY-MM-DD), same as the backend.
 * ------------------------------------------------------------------------ */
const pad = (n, w) => String(n).padStart(w || 2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return toISO(d); };
const daysAhead = n => { const d = new Date(); d.setDate(d.getDate() + n); return toISO(d); };
const todayISO = () => daysAgo(0);
const monthKey = iso => String(iso).slice(0, 7);
const clean = v => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return isFinite(v) ? v : '';
  let s = String(v).trim();
  if (/^[=+@]/.test(s)) s = "'" + s;
  return s;
};
const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
const validDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : todayISO();
const sum = arr => arr.reduce((a, b) => a + b, 0);

/* --------------------------------------------------------------------------
 * Settings + lists (identical to the workbook template / Code.gs)
 * ------------------------------------------------------------------------ */
const settings = {
  'Business Name': 'Dee Cleaners',
  'Phone 1': '+255 693 806 051',
  'Phone 2': '+255 762 292 439',
  'Email': 'deecleanerscleaningservices@gmail.com',
  'Address': 'Magomeni, Mikumi',
  'Website': '',
  'Social Media': '',
  'Currency': 'TZS',
  'Default Transport Policy': 'Customer pays transport fees (Transport fees ni juu ya mteja)',
  'Room Pricing Note': 'Bei zinapungua au Kuongezeka kulingana na ukubwa wa chumba (prices may decrease or increase depending on room size)',
  'Live-in Working Hours': '5:00 a.m. - 6:30 p.m.',
  'Minimum Work Duration (months)': 3,
  'Agency Fee Note': 'One-time agency fee paid by the employer upon contract initiation',
  'Payment Policy Note': 'All househelp service payments are made directly to Dee Cleaners, which handles salary disbursement',
  'Logo Reference': 'assets/dee_cleaners_logo/dee_cleaners_logo.png'
};

const lists = {
  cleaningServices: { columns: ['Name', 'Min Price', 'Max Price', 'Category', 'Active', 'Description'], items: [
    { name: 'Toilet Cleaning', minprice: 30000, maxprice: 40000, category: 'Cleaning', active: 'Yes', description: '' },
    { name: 'Kitchen Cleaning', minprice: 50000, maxprice: 150000, category: 'Cleaning', active: 'Yes', description: '' },
    { name: 'Chumba Kimoja (One Room)', minprice: 50000, maxprice: 50000, category: 'Cleaning', active: 'Yes', description: '' },
    { name: 'Window Cleaning', minprice: 15000, maxprice: 20000, category: 'Cleaning', active: 'Yes', description: '' },
    { name: 'Sitting Room & 2 Bedrooms', minprice: 150000, maxprice: 150000, category: 'Empty Rooms', active: 'Yes', description: '' },
    { name: 'Sitting Room & 3 Bedrooms', minprice: 200000, maxprice: 200000, category: 'Empty Rooms', active: 'Yes', description: '' },
    { name: 'Sitting Room & 4 Bedrooms', minprice: 250000, maxprice: 250000, category: 'Empty Rooms', active: 'Yes', description: '' },
    { name: 'Sitting Room & 5 Bedrooms', minprice: 350000, maxprice: 350000, category: 'Empty Rooms', active: 'Yes', description: '' },
    { name: 'Sitting Room & 6 Bedrooms', minprice: 450000, maxprice: 450000, category: 'Empty Rooms', active: 'Yes', description: '' },
    { name: 'Sitting Room & 2 Bedrooms', minprice: 200000, maxprice: 200000, category: 'Rooms With Furniture Cleaning', active: 'Yes', description: '' },
    { name: 'Sitting Room & 3 Bedrooms', minprice: 250000, maxprice: 250000, category: 'Rooms With Furniture Cleaning', active: 'Yes', description: '' },
    { name: 'Sitting Room & 4 Bedrooms', minprice: 300000, maxprice: 300000, category: 'Rooms With Furniture Cleaning', active: 'Yes', description: '' },
    { name: 'Sitting Room & 5 Bedrooms', minprice: 350000, maxprice: 350000, category: 'Rooms With Furniture Cleaning', active: 'Yes', description: '' },
    { name: 'Sitting Room & 6 Bedrooms', minprice: 450000, maxprice: 450000, category: 'Rooms With Furniture Cleaning', active: 'Yes', description: '' }
  ] },
  sofaServices: { columns: ['Name', 'Min Price', 'Max Price', 'Active'], items: [] },
  laundryServices: { columns: ['Name', 'Unit', 'Light Price', 'Heavy Price', 'Ironing Price', 'Active', 'Description'], items: [] },
  specializedServices: { columns: ['Name', 'Min Price', 'Max Price', 'Active', 'Description'], items: [] },
  househelpCategories: { columns: ['Name', 'Min Price', 'Max Price', 'Active', 'Description'], items: [] },
  paymentMethods: { columns: ['Name', 'Details'], items: [] },
  orderStatuses: { columns: ['Name'], items: [] },
  paymentStatuses: { columns: ['Name'], items: [] },
  expenseCategories: { columns: ['Name'], items: [] },
  househelpStatuses: { columns: ['Name'], items: [] },
  contractStatuses: { columns: ['Name'], items: [] },
  placementStatuses: { columns: ['Name'], items: [] },
  complaintStatuses: { columns: ['Name'], items: [] },
  complaintTypes: { columns: ['Name'], items: [] },
  employeeTypes: { columns: ['Name'], items: [] },
  severityLevels: { columns: ['Name'], items: [] },
  paymentFrequencies: { columns: ['Name'], items: [] },
  attendanceStatuses: { columns: ['Name'], items: [] }
};

['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
  .forEach((w, i) => lists.sofaServices.items.push({
    name: `${w} Seater Sofa Set`, minprice: 15000 * (i + 1), maxprice: 15000 * (i + 1), active: 'Yes' }));

[
  ['Ties', 'Piece', 1000, '', '', '1-4 pieces: 1,000 | 5-9 pieces: 900 | 10+ pieces: 800 (per piece)'],
  ['Socks', 'Pair', 500, '', '', '1-4 pairs: 500 | 5-9 pairs: 400 | 10+ pairs: 300 (per pair)'],
  ['Jeans / Cargo / Formal Trousers', 'Piece', 500, 1000, '', 'Light: 500 | Heavy: 1,000'],
  ['Bazee / Kikoi / Lace / Kitenge', 'Piece', 2000, 3000, '', 'Light: 2,000 | Heavy: 3,000'],
  ['Curtains', 'Piece', 5000, '', '', '5,000 per curtain'],
  ['Bundle of Clothes', 'Bundle', 20000, 30000, '', '30-clothes bundle: Light 20,000 | Heavy 30,000'],
  ['Graduation Gown', 'Piece', '', '', 10000, '+ Ironing: 10,000'],
  ['Wedding Gown', 'Piece', '', '', 29900, '+ Ironing: 29,900'],
  ['Blanket', 'Piece', 15000, 29900, '', 'Light: 15,000 | Heavy: 29,900'],
  ['Ironing', 'Piece', '', '', '', 'Price set by the administrator']
].forEach(r => lists.laundryServices.items.push({
  name: r[0], unit: r[1], lightprice: r[2], heavyprice: r[3], ironingprice: r[4], active: 'Yes', description: r[5] }));

[
  ['Shoe Cleaning', 2000, 2000, ''],
  ['Sewer Cleaning', 20000, 20000, ''],
  ['Carpet Cleaning', 15000, 30000, ''],
  ['Fumigation Service', 10000, 500000, ''],
  ['Gardening & Maintenance', 100000, 1000000, '']
].forEach(r => lists.specializedServices.items.push({ name: r[0], minprice: r[1], maxprice: r[2], active: 'Yes', description: r[3] }));

[
  ['Single Parent Family', 80000, 100000, 'Family with only one parent'],
  ['Nuclear Family', 150000, 200000, 'Family with both parents'],
  ['Extended Family', 250000, 500000, ''],
  ['Family Including Relative', 250000, 500000, '']
].forEach(r => lists.househelpCategories.items.push({ name: r[0], minprice: r[1], maxprice: r[2], active: 'Yes', description: r[3] }));

['Cash', 'M-Pesa', 'Tigo Pesa', 'Airtel Money', 'Bank Transfer']
  .forEach(n => lists.paymentMethods.items.push({ name: n, details: '' }));
['Pending', 'Confirmed', 'In Progress', 'Completed', 'Cancelled']
  .forEach(n => lists.orderStatuses.items.push({ name: n }));
['Paid', 'Partial', 'Unpaid'].forEach(n => lists.paymentStatuses.items.push({ name: n }));
['Transport', 'Cleaning Materials', 'Laundry Materials', 'Equipment', 'Fuel', 'Utilities',
  'Salaries', 'Househelp Payments', 'Marketing', 'Maintenance', 'Other']
  .forEach(n => lists.expenseCategories.items.push({ name: n }));
['Available', 'Placed', 'On Contract', 'Inactive', 'Replacement Required']
  .forEach(n => lists.househelpStatuses.items.push({ name: n }));
['Pending', 'Active', 'Completed', 'Terminated']
  .forEach(n => lists.contractStatuses.items.push({ name: n }));
['Pending', 'Matching', 'Contract Pending', 'Active', 'Completed', 'Terminated', 'Replacement Required']
  .forEach(n => lists.placementStatuses.items.push({ name: n }));
['Reported', 'Under Review', 'Mediation', 'Resolved', 'Escalated']
  .forEach(n => lists.complaintStatuses.items.push({ name: n }));
['Salary/payment', 'Mistreatment', 'Abuse', 'Working conditions', 'Accommodation',
  'Food', 'Misconduct', 'Property/damage', 'Other']
  .forEach(n => lists.complaintTypes.items.push({ name: n }));
['Staff', 'Worker', 'Househelp'].forEach(n => lists.employeeTypes.items.push({ name: n }));
['Low', 'Medium', 'High'].forEach(n => lists.severityLevels.items.push({ name: n }));
['Monthly', 'Weekly'].forEach(n => lists.paymentFrequencies.items.push({ name: n }));
['Present', 'Absent', 'Half Day', 'Leave'].forEach(n => lists.attendanceStatuses.items.push({ name: n }));

const serviceCategoryOf = name => {
  const s = String(name || '').toLowerCase();
  if (!s) return 'Other';
  if (lists.cleaningServices.items.some(i => i.name.toLowerCase() === s)) return 'Cleaning';
  if (lists.sofaServices.items.some(i => i.name.toLowerCase() === s)) return 'Sofa Cleaning';
  if (lists.laundryServices.items.some(i => i.name.toLowerCase() === s)) return 'Laundry';
  if (lists.specializedServices.items.some(i => i.name.toLowerCase() === s)) return 'Specialized';
  if (/fumigation|gardening/.test(s)) return 'Specialized';
  if (/sofa/.test(s)) return 'Sofa Cleaning';
  if (/ironing|laundry|gown|blanket|curtain|kikoi|kitenge|bazee|sock|tie|trouser|jean|cargo|bundle/.test(s)) return 'Laundry';
  return 'Other';
};

/* --------------------------------------------------------------------------
 * In-memory database
 * ------------------------------------------------------------------------ */
const db = {
  orders: [],          // { id, date, customerName, phone, email, service, description,
                       //   quantity, unitPrice, discount, amountPaid, orderStatus,
                       //   transportFee, directExpense, notes, lineItems: [] }
  archive: [],
  payments: [],        // { id, date, customer, orderId, amount, method, reference, receivedBy, notes }
  expenses: [],        // { id, date, category, description, amount, method, relatedService, notes }
  househelps: [],      // HH-
  employers: [],       // CL-
  placements: [],      // PL-
  hhPayments: [],      // HHP-
  contracts: [],       // CON-
  complaints: [],      // CMP-
  replacements: [],    // REP-
  attendance: []       // ATT-
};

const idCounters = {};
const newId = prefix => {
  if (!idCounters[prefix]) idCounters[prefix] = 0;
  idCounters[prefix]++;
  return `${prefix}-${pad(idCounters[prefix], 4)}`;
};

/** Compute derived order fields (mirrors Code.gs orderFromRow). */
const decorateOrder = o => {
  let total = 0;
  const items = Array.isArray(o.lineItems) ? o.lineItems : [];
  if (items.length) {
    total = items.reduce((a, li) => a + num(li.qty) * num(li.unitPrice), 0);
  } else {
    total = num(o.quantity) * num(o.unitPrice);
  }
  total = Math.max(0, total - num(o.discount));
  const paid = Math.max(0, num(o.amountPaid));
  o.quantity = num(o.quantity); o.unitPrice = num(o.unitPrice);
  o.discount = num(o.discount); o.total = total;
  o.amountPaid = paid; o.balance = Math.max(0, total - paid);
  o.paymentStatus = paid <= 0 ? 'Unpaid' : (paid >= total ? 'Paid' : 'Partial');
  o.transportFee = num(o.transportFee); o.directExpense = num(o.directExpense);
  o.netServiceProfit = total + o.transportFee - o.directExpense;
  return o;
};

const normalizeOrder = (d, partial) => {
  const o = {
    date: validDate(d.date),
    customerName: clean(d.customerName),
    phone: clean(d.phone),
    email: clean(d.email),
    service: clean(d.service),
    description: clean(d.description),
    discount: Math.max(0, num(d.discount)),
    amountPaid: Math.max(0, num(d.amountPaid)),
    orderStatus: clean(d.orderStatus) || 'Pending',
    transportFee: Math.max(0, num(d.transportFee)),
    directExpense: Math.max(0, num(d.directExpense)),
    notes: clean(d.notes)
  };
  const lineItems = (Array.isArray(d.lineItems) ? d.lineItems : [])
    .map(li => ({ service: clean(li && li.service), description: clean(li && li.description),
      qty: Math.max(0, num(li && li.qty)), unitPrice: Math.max(0, num(li && li.unitPrice)) }))
    .filter(li => li.service);
  if (!partial) {
    if (!o.customerName) throw new Error('Customer name is required');
    if (!lineItems.length && !o.service) throw new Error('At least one service line is required');
  }
  if (lineItems.length) {
    o.lineItems = lineItems;
    o.quantity = 1;
    o.unitPrice = lineItems.reduce((a, li) => a + li.qty * li.unitPrice, 0);
    o.service = o.service || (lineItems.length === 1 ? lineItems[0].service : 'Multiple Services');
  } else {
    o.quantity = Math.max(0, num(d.quantity));
    o.unitPrice = Math.max(0, num(d.unitPrice));
    o.lineItems = [];
  }
  return o;
};

/* --------------------------------------------------------------------------
 * Seed data — realistic Dee Cleaners sample business
 * ------------------------------------------------------------------------ */
const O = (d, name, phone, email, service, desc, qty, price, discount, paid,
           status, transport, direct, notes, items) => ({
  id: newId('DC'), date: d, customerName: name, phone, email, service,
  description: desc, quantity: qty, unitPrice: price, discount: discount || 0,
  amountPaid: paid || 0, orderStatus: status || 'Completed',
  transportFee: transport || 0, directExpense: direct || 0, notes: notes || '',
  lineItems: items || []
});

function seed() {
  // ---- cleaning orders
  db.orders.push(
    O(daysAgo(0), 'Fatuma Hassan', '+255 712 345 678', '', 'Kitchen Cleaning',
      'Deep cleaning of kitchen cabinets', 1, 80000, 0, 80000, 'Completed', 5000, 10000, ''),
    O(daysAgo(0), 'Juma Mwinyi', '+255 754 111 222', 'juma.mwinyi@gmail.com', 'Toilet Cleaning',
      '', 1, 35000, 0, 35000, 'Completed', 0, 4000, ''),
    O(daysAgo(0), 'Neema Charles', '+255 785 908 123', '', 'Sofa Cleaning',
      'Three Seater Sofa Set', 1, 45000, 0, 20000, 'In Progress', 0, 5000, 'Partial payment received'),
    O(daysAgo(1), 'Baraka Mushi', '+255 766 543 210', '', 'Chumba Kimoja (One Room)',
      'Student room, Magomeni', 1, 50000, 0, 50000, 'Completed', 0, 6000, ''),
    O(daysAgo(1), 'Zainabu Ally', '+255 713 999 888', 'zainabu.ally@yahoo.com', 'Window Cleaning',
      'All windows, 2 storey house', 1, 20000, 0, 20000, 'Completed', 3000, 2000, ''),
    O(daysAgo(2), 'Daudi Mkapa', '+255 622 456 789', '', 'Sitting Room & 3 Bedrooms',
      'Empty rooms - move-out clean', 1, 200000, 0, 150000, 'Completed', 10000, 15000, ''),
    O(daysAgo(3), 'Grace Temu', '+255 755 321 654', '', 'Sitting Room & 4 Bedrooms',
      'Rooms with furniture, full house', 1, 300000, 20000, 100000, 'In Progress', 15000, 20000, 'Discount agreed for repeat customer'),
    O(daysAgo(4), 'Hassan Omar', '+255 717 808 090', '', 'Toilet Cleaning', '', 2, 35000, 0, 70000, 'Completed', 0, 8000, 'Two toilets'),
    O(daysAgo(6), 'Mariam Bakari', '+255 784 222 333', '', 'Kitchen Cleaning', '', 1, 120000, 0, 120000, 'Completed', 5000, 12000, 'Large kitchen'),
    O(daysAgo(8), 'Peter Nyerere', '+255 656 777 888', '', 'Sitting Room & 2 Bedrooms',
      'Empty rooms', 1, 150000, 0, 150000, 'Completed', 0, 10000, ''),
    O(daysAgo(10), 'Amina Rajabu', '+255 715 456 789', 'amina.rajabu@outlook.com', 'Window Cleaning',
      'Office windows', 1, 18000, 0, 18000, 'Completed', 0, 1000, '')
  );

  // ---- laundry orders
  db.orders.push(
    O(daysAgo(0), 'Sarah Mosha', '+255 782 135 790', '', 'Bundle of Clothes',
      '30 clothes - Light', 1, 20000, 0, 20000, 'Completed', 0, 3000, ''),
    O(daysAgo(1), 'Kassim Mdoe', '+255 765 246 813', '', 'Blanket',
      'Heavy blanket', 1, 29900, 0, 29900, 'Completed', 0, 0, ''),
    O(daysAgo(2), 'Neema Charles', '+255 785 908 123', '', 'Socks',
      '1-4 pairs', 1, 500, 0, 0, 'Pending', 0, 0, ''),
    O(daysAgo(3), 'Zainabu Ally', '+255 713 999 888', 'zainabu.ally@yahoo.com', 'Wedding Gown',
      '+ Ironing', 1, 29900, 0, 29900, 'Completed', 0, 1500, ''),
    O(daysAgo(5), 'Fatuma Hassan', '+255 712 345 678', '', 'Jeans / Cargo / Formal Trousers',
      'Heavy - 4 pieces', 4, 1000, 0, 4000, 'Completed', 0, 500, ''),
    O(daysAgo(9), 'Grace Temu', '+255 755 321 654', '', 'Bazee / Kikoi / Lace / Kitenge',
      'Light - 2 pieces', 2, 2000, 0, 4000, 'Completed', 0, 0, ''),
    O(daysAgo(12), 'Mariam Bakari', '+255 784 222 333', '', 'Curtains',
      '4 curtains', 4, 5000, 0, 20000, 'Completed', 0, 1000, '')
  );

  // ---- sofa orders
  db.orders.push(
    O(daysAgo(2), 'Daudi Mkapa', '+255 622 456 789', '', 'Five Seater Sofa Set',
      '', 1, 75000, 0, 75000, 'Completed', 5000, 6000, ''),
    O(daysAgo(7), 'Baraka Mushi', '+255 766 543 210', '', 'Two Seater Sofa Set',
      '', 1, 30000, 0, 30000, 'Completed', 0, 3000, ''),
    O(daysAgo(15), 'Hassan Omar', '+255 717 808 090', '', 'Seven Seater Sofa Set',
      '', 1, 105000, 0, 60000, 'In Progress', 10000, 8000, 'Balance to be paid after completion')
  );

  // ---- specialized-service orders
  db.orders.push(
    O(daysAgo(1), 'Peter Nyerere', '+255 656 777 888', '', 'Fumigation Service',
      'Two-bedroom house', 1, 150000, 0, 100000, 'In Progress', 15000, 40000, 'Agreed price 150,000'),
    O(daysAgo(4), 'Amina Rajabu', '+255 715 456 789', 'amina.rajabu@outlook.com', 'Gardening & Maintenance',
      'Monthly garden care', 1, 200000, 0, 200000, 'Completed', 0, 50000, 'Monthly contract'),
    O(daysAgo(5), 'Kassim Mdoe', '+255 765 246 813', '', 'Carpet Cleaning',
      'Living room carpet', 1, 25000, 0, 25000, 'Completed', 0, 3000, 'Agreed price within 15,000-30,000 range'),
    O(daysAgo(11), 'Sarah Mosha', '+255 782 135 790', '', 'Shoe Cleaning',
      '', 3, 2000, 0, 6000, 'Completed', 0, 500, ''),
    O(daysAgo(14), 'Juma Mwinyi', '+255 754 111 222', 'juma.mwinyi@gmail.com', 'Sewer Cleaning',
      '', 1, 20000, 0, 20000, 'Completed', 5000, 8000, '')
  );

  // ---- multiple-service order
  db.orders.push(O(daysAgo(0), 'Grace Temu', '+255 755 321 654', '', 'Multiple Services',
    'Full home package', 1, 80000, 0, 60000, 'In Progress', 10000, 15000,
    'Customer requested combined package', [
      { service: 'Kitchen Cleaning', description: 'Deep cleaning', qty: 1, unitPrice: 50000 },
      { service: 'Window Cleaning', description: 'All windows', qty: 1, unitPrice: 20000 },
      { service: 'Toilet Cleaning', description: '1 toilet', qty: 1, unitPrice: 30000 }
    ]));

  // ---- a cancelled order and an old order for history
  db.orders.push(
    O(daysAgo(3), 'Neema Charles', '+255 785 908 123', '', 'Toilet Cleaning', '',
      1, 35000, 0, 0, 'Cancelled', 0, 0, 'Customer cancelled'),
    O(daysAgo(25), 'Fatuma Hassan', '+255 712 345 678', '', 'Sitting Room & 5 Bedrooms',
      'Rooms with furniture', 1, 350000, 50000, 350000, 'Completed', 20000, 30000, 'Returning customer discount')
  );

  // ---- expenses
  const X = (d, cat, desc, amt, method, related, notes) =>
    ({ id: newId('EXP'), date: d, category: cat, description: desc, amount: amt,
       method: method || 'Cash', relatedService: related || '', notes: notes || '' });
  db.expenses.push(
    X(daysAgo(0), 'Transport', 'Fuel for Magomeni team', 15000, 'Cash', 'Cleaning', ''),
    X(daysAgo(0), 'Cleaning Materials', 'Detergents and bleach', 25000, 'M-Pesa', '', ''),
    X(daysAgo(1), 'Transport', 'Bus fare - team of 3', 12000, 'Cash', 'Fumigation', ''),
    X(daysAgo(2), 'Laundry Materials', 'Soap and softener', 18000, 'Cash', '', ''),
    X(daysAgo(3), 'Equipment', 'Vacuum cleaner service', 45000, 'Tigo Pesa', '', ''),
    X(daysAgo(5), 'Utilities', 'Water and electricity', 30000, 'Bank Transfer', '', ''),
    X(daysAgo(7), 'Salaries', 'Team wages - week 1', 150000, 'Bank Transfer', '', ''),
    X(daysAgo(10), 'Marketing', 'Flyers and posters', 20000, 'Cash', '', ''),
    X(daysAgo(14), 'Salaries', 'Team wages - week 2', 150000, 'Bank Transfer', '', ''),
    X(daysAgo(20), 'Maintenance', 'Machine maintenance', 35000, 'Cash', '', '')
  );

  // ---- payments (recorded after orders were created — link to order IDs)
  db.payments.push(
    { id: newId('PAY'), date: daysAgo(0), customer: 'Fatuma Hassan', orderId: 'DC-0001', amount: 80000, method: 'M-Pesa', reference: 'MP-9921', receivedBy: 'Dee', notes: '' },
    { id: newId('PAY'), date: daysAgo(0), customer: 'Neema Charles', orderId: 'DC-0003', amount: 20000, method: 'Tigo Pesa', reference: '', receivedBy: 'Dee', notes: 'Partial payment' },
    { id: newId('PAY'), date: daysAgo(1), customer: 'Baraka Mushi', orderId: 'DC-0004', amount: 50000, method: 'Cash', reference: '', receivedBy: 'Dee', notes: '' },
    { id: newId('PAY'), date: daysAgo(2), customer: 'Daudi Mkapa', orderId: 'DC-0006', amount: 150000, method: 'Bank Transfer', reference: 'CRB-4401', receivedBy: 'Dee', notes: '' },
    { id: newId('PAY'), date: daysAgo(3), customer: 'Grace Temu', orderId: 'DC-0007', amount: 100000, method: 'M-Pesa', reference: '', receivedBy: 'Dee', notes: 'Deposit' }
  );

  // ---- househelps
  const H = (name, phone, gender, nationality, occ, nida, city, addr, reg, status,
             skills, exp, avail, notes) => ({
    id: newId('HH'), fullName: name, phone, email: '', gender, nationality,
    occupation: occ, nida, cityCountry: city, homeAddress: addr,
    registrationDate: reg, status, skills, experience: exp, availability: avail, notes: notes || ''
  });
  db.househelps.push(
    H('Rose Mlay', '+255 712 908 776', 'Female', 'Tanzanian', 'Househelp', 'NIDA-778899', 'Dar es Salaam', 'Mbezi Beach', daysAgo(120), 'On Contract', 'Cleaning, cooking, child care', '4 years', 'Live-in', ''),
    H('Agnes Peter', '+255 689 445 213', 'Female', 'Tanzanian', 'Househelp', 'NIDA-556677', 'Dodoma', 'Mkonze', daysAgo(90), 'On Contract', 'Cleaning, laundry', '2 years', 'Live-in', ''),
    H('Halima Juma', '+255 766 332 190', 'Female', 'Tanzanian', 'Househelp', 'NIDA-112233', 'Dar es Salaam', 'Kinondoni', daysAgo(45), 'Available', 'Cleaning, cooking', '3 years', 'Live-in or live-out', ''),
    H('Vumilia Sanga', '+255 745 887 001', 'Female', 'Tanzanian', 'Househelp', 'NIDA-334455', 'Mbeya', 'Iyunga', daysAgo(30), 'Available', 'Cleaning, elderly care', '5 years', 'Live-in', ''),
    H('Grace Mwakalinga', '+255 785 664 230', 'Female', 'Tanzanian', 'Househelp', 'NIDA-990011', 'Dar es Salaam', 'Tabata', daysAgo(200), 'Inactive', 'Cooking, laundry', '6 years', '—', 'Left service in good standing'),
    H('Pendo Kivuyo', '+255 623 118 447', 'Female', 'Tanzanian', 'Househelp', 'NIDA-667788', 'Iringa', 'Mkwawa', daysAgo(15), 'Replacement Required', 'Cleaning, child care', '1 year', 'Live-in', 'Placed but left without valid reason')
  );

  // ---- employers
  const E = (name, family, phone, email, gender, nationality, occ, city, nida, addr, reg, notes) => ({
    id: newId('CL'), fullName: name, familyMember: family || '', phone, email: email || '',
    gender: gender || '', nationality: nationality || 'Tanzanian', occupation: occ || '',
    cityCountry: city || '', nida: nida || '', homeAddress: addr || '',
    registrationDate: reg, notes: notes || ''
  });
  db.employers.push(
    E('Dr. Amina Rajabu', 'Mr. Rajabu', '+255 715 456 789', 'amina.rajabu@outlook.com', 'Female', 'Tanzanian', 'Doctor', 'Dar es Salaam', 'NIDA-100200', 'Masaki', daysAgo(120), ''),
    E('Kassim Mdoe', '', '+255 765 246 813', '', 'Male', 'Tanzanian', 'Businessman', 'Dar es Salaam', 'NIDA-200300', 'Kariakoo', daysAgo(95), ''),
    E('Mr. & Mrs. Lugano', '', '+255 787 909 101', '', '', 'Tanzanian', '', 'Dar es Salaam', '', 'Mikocheni', daysAgo(60), ''),
    E('Sarah Mosha', 'Mr. Mosha', '+255 782 135 790', '', 'Female', 'Tanzanian', 'Teacher', 'Arusha', 'NIDA-300400', 'Njiro', daysAgo(30), '')
  );

  // ---- placements
  const P = (hh, emp, cat, desc, salary, freq, start, end, status, cstatus, livein,
             hours, acc, meals, fee, notes) => ({
    id: newId('PL'), househelpId: hh, employerId: emp, category: cat,
    jobDescription: desc, salary, paymentFrequency: freq, startDate: start,
    expectedEndDate: end || '', status, contractStatus: cstatus, liveIn: livein,
    workingHours: hours || '5:00 a.m. - 6:30 p.m.', accommodation: acc || '',
    meals: meals || '', agencyFee: fee || 0, notes: notes || ''
  });
  db.placements.push(
    P('HH-0001', 'CL-0001', 'Nuclear Family', 'Cleaning, cooking, child care', 200000, 'Monthly', daysAgo(90), '', 'Active', 'Active', 'Live-in', '', 'Private room provided', '3 meals a day', 50000, ''),
    P('HH-0002', 'CL-0002', 'Single Parent Family', 'Cleaning and laundry', 100000, 'Monthly', daysAgo(75), '', 'Active', 'Active', 'Live-in', '', 'Shared quarters', 'Meals provided', 50000, ''),
    P('HH-0006', 'CL-0003', 'Extended Family', 'Cleaning, child care', 300000, 'Monthly', daysAgo(14), '', 'Replacement Required', 'Terminated', 'Live-in', '', 'Private room', 'Meals provided', 75000, 'Househelp left without valid reason — replacement requested'),
    P('HH-0003', 'CL-0004', 'Nuclear Family', 'Housekeeping, cooking', 180000, 'Monthly', daysAgo(7), daysAhead(83), 'Contract Pending', 'Pending', 'Live-out', '7:00 a.m. - 4:00 p.m.', 'Not applicable', 'Not applicable', 50000, 'Contract signing scheduled'),
    P('HH-0004', '', 'Single Parent Family', 'Elderly care and cleaning', 90000, 'Weekly', '', '', 'Matching', 'Pending', 'Live-in', '', '', '', 0, 'Looking for a suitable employer')
  );

  // ---- contracts
  const C = (placement, empName, hhName, start, end, minDur, notice, status,
             termDate, termReason, empSig, hhSig, deeAck, notes) => ({
    id: newId('CON'), placementId: placement, employer: empName, househelp: hhName,
    startDate: start, endDate: end || '', minimumDuration: minDur || '3 months',
    noticeRequired: notice || 'Oral or written notice to Dee Cleaners',
    status, terminationDate: termDate || '', terminationReason: termReason || '',
    documentLink: '', employerSignature: empSig || '', househelpSignature: hhSig || '',
    deeAck: deeAck || 'Yes', notes: notes || ''
  });
  db.contracts.push(
    C('PL-0001', 'Dr. Amina Rajabu', 'Rose Mlay', daysAgo(90), '', '3 months', '', 'Active', '', '', 'A. Rajabu', 'R. Mlay', 'Yes', ''),
    C('PL-0002', 'Kassim Mdoe', 'Agnes Peter', daysAgo(75), '', '3 months', '', 'Active', '', '', 'K. Mdoe', 'A. Peter', 'Yes', ''),
    C('PL-0003', 'Mr. & Mrs. Lugano', 'Pendo Kivuyo', daysAgo(14), '', '3 months', '', 'Terminated', daysAgo(1), 'Househelp left without valid reason', 'Lugano', 'P. Kivuyo', 'Yes', 'Replacement policy applies')
  );

  // ---- househelp payments
  db.hhPayments.push(
    { id: newId('HHP'), househelpId: 'HH-0001', employerId: 'CL-0001', placementId: 'PL-0001',
      paymentDate: daysAgo(30), period: 'Previous month', amount: 200000, method: 'M-Pesa',
      status: 'Paid', reference: '', notes: 'Salary disbursed by Dee Cleaners' },
    { id: newId('HHP'), househelpId: 'HH-0002', employerId: 'CL-0002', placementId: 'PL-0002',
      paymentDate: daysAgo(30), period: 'Previous month', amount: 100000, method: 'Tigo Pesa',
      status: 'Paid', reference: '', notes: '' },
    { id: newId('HHP'), househelpId: 'HH-0001', employerId: 'CL-0001', placementId: 'PL-0001',
      paymentDate: daysAgo(2), period: 'Current month', amount: 200000, method: 'M-Pesa',
      status: 'Pending', reference: '', notes: 'Employer payment expected' }
  );

  // ---- complaints
  db.complaints.push(
    { id: newId('CMP'), date: daysAgo(3), client: 'Kassim Mdoe', househelp: 'Agnes Peter',
      placement: 'PL-0002', type: 'Salary/payment', description: 'Employer asked to confirm payment date for this month',
      reportedBy: 'Employer', severity: 'Low', status: 'Resolved', action: 'Payment schedule clarified',
      resolution: 'Agreed payment by the 5th of each month', resolutionDate: daysAgo(2), notes: '' },
    { id: newId('CMP'), date: daysAgo(1), client: 'Mr. & Mrs. Lugano', househelp: 'Pendo Kivuyo',
      placement: 'PL-0003', type: 'Misconduct', description: 'Househelp left without valid reason',
      reportedBy: 'Employer', severity: 'Medium', status: 'Under Review', action: '',
      resolution: '', resolutionDate: '', notes: 'Replacement policy under review' },
    { id: newId('CMP'), date: daysAgo(5), client: 'Dr. Amina Rajabu', househelp: 'Rose Mlay',
      placement: 'PL-0001', type: 'Working conditions', description: 'Request for an extra rest day per week',
      reportedBy: 'Househelp', severity: 'Low', status: 'Mediation', action: 'Mediation meeting arranged',
      resolution: '', resolutionDate: '', notes: '' }
  );

  // ---- replacement request
  db.replacements.push(
    { id: newId('REP'), originalPlacement: 'PL-0003', originalHousehelp: 'Pendo Kivuyo',
      employer: 'Mr. & Mrs. Lugano', reason: 'Househelp terminated without valid reasons',
      requestDate: daysAgo(1), replacementHousehelp: '', replacementDate: '',
      status: 'Requested', notes: 'Replacement subject to availability' }
  );

  // ---- attendance
  db.attendance.push(
    { id: newId('ATT'), date: daysAgo(0), personType: 'Staff', person: 'Dee (Cleaning Team Lead)',
      checkIn: '08:00', checkOut: '17:00', hours: '9', status: 'Present', notes: '' },
    { id: newId('ATT'), date: daysAgo(0), personType: 'Househelp', person: 'Rose Mlay',
      checkIn: '05:00', checkOut: '18:30', hours: '13.5', status: 'Present', notes: 'Live-in househelp' }
  );

  // decorate all orders with computed fields
  db.orders.forEach(decorateOrder);
}

seed();

/* --------------------------------------------------------------------------
 * Business logic (mirrors Code.gs)
 * ------------------------------------------------------------------------ */
const customerKey = (name, phone) =>
  `${String(name || '').trim().toLowerCase()}|${String(phone || '').trim().toLowerCase()}`;

const listOrders = q => {
  let orders = db.orders.map(o => Object.assign({}, o, { lineItems: (o.lineItems || []).slice() }));
  const s = String((q && q.search) || '').toLowerCase();
  if (s) orders = orders.filter(o =>
    [o.id, o.customerName, o.phone, o.email, o.service, o.description, o.notes]
      .join(' ').toLowerCase().includes(s));
  if (q && q.orderStatus) orders = orders.filter(o => o.orderStatus === q.orderStatus);
  if (q && q.paymentStatus) orders = orders.filter(o => o.paymentStatus === q.paymentStatus);
  if (q && q.serviceCategory) orders = orders.filter(o => serviceCategoryOf(o.service) === q.serviceCategory);
  if (q && q.service) orders = orders.filter(o => o.service === q.service);
  if (q && q.dateFrom) orders = orders.filter(o => o.date >= String(q.dateFrom));
  if (q && q.dateTo) orders = orders.filter(o => o.date <= String(q.dateTo));
  return orders;
};

const refreshCustomers = () => {
  const map = {};
  listOrders({}).forEach(o => {
    const key = customerKey(o.customerName, o.phone);
    if (!key || key === '|') return;
    if (!map[key]) map[key] = { name: o.customerName, phone: o.phone, email: o.email,
      orderCount: 0, totalSpending: 0, totalPaid: 0, balance: 0, lastDate: '' };
    const c = map[key];
    c.orderCount++;
    c.totalSpending += o.total;
    c.totalPaid += o.amountPaid;
    c.balance += o.balance;
    if (o.date > c.lastDate) c.lastDate = o.date;
    if (o.email && !c.email) c.email = o.email;
  });
  const ms90 = 90 * 24 * 60 * 60 * 1000;
  return Object.values(map)
    .map(c => Object.assign({}, c, {
      lastServiceDate: c.lastDate,
      status: c.lastDate && (new Date() - new Date(c.lastDate + 'T00:00:00')) <= ms90 ? 'Active' : 'Inactive'
    }))
    .sort((a, b) => b.totalSpending - a.totalSpending);
};

const findOrder = id => db.orders.find(o => o.id === String(id));
const syncOrderPaid = (orderId, delta, replaceWith) => {
  const o = findOrder(orderId);
  if (!o) return;
  let paid = replaceWith !== undefined ? replaceWith : num(o.amountPaid) + delta;
  paid = Math.max(0, Math.min(o.total, paid));
  o.amountPaid = paid;
  decorateOrder(o);
};

const listSimple = (arr, q) => {
  const s = String((q && q.search) || '').toLowerCase();
  return s ? arr.filter(x => JSON.stringify(x).toLowerCase().includes(s)) : arr.slice();
};

const placementView = p => {
  const hh = db.househelps.find(h => h.id === p.househelpId);
  const emp = db.employers.find(e => e.id === p.employerId);
  return Object.assign({}, p, {
    househelpName: hh ? hh.fullName : '', employerName: emp ? emp.fullName : '',
    employerPhone: emp ? emp.phone : ''
  });
};

const groupCount = (items, keyFn) => {
  const m = {};
  items.forEach(it => { const k = keyFn(it); m[k] = (m[k] || 0) + 1; });
  return Object.keys(m).map(k => ({ label: k, value: m[k] }));
};
const groupSum = (items, keyFn, valFn) => {
  const m = {};
  items.forEach(it => { const k = keyFn(it); m[k] = (m[k] || 0) + valFn(it); });
  return Object.keys(m).sort((a, b) => m[b] - m[a]).map(k => ({ label: k, value: m[k] }));
};

const dailySeries = (orders, days, valFn, expenses) => {
  const expMap = {};
  if (expenses) expenses.forEach(x => { expMap[x.date] = (expMap[x.date] || 0) + x.amount; });
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = daysAgo(i);
    let v = sum(orders.filter(o => o.date === d).map(valFn));
    if (expenses) v -= (expMap[d] || 0);
    out.push({ date: d, value: v });
  }
  return out;
};

const monthlySeries = (items, months, valFn) => {
  const out = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    out.push({ month: key, value: sum(items.filter(it => monthKey(String(it.date)) === key).map(valFn)) });
  }
  return out;
};

const weekKey = iso => {
  const d = new Date(iso + 'T00:00:00');
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + 3);
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  const monday = new Date(d); monday.setDate(monday.getDate() - 3);
  return `${d.getFullYear()}-W${pad(week)} (${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())})`;
};

function getDashboard() {
  const orders = listOrders({});
  const expenses = listSimple(db.expenses);
  const customers = refreshCustomers();
  const househelps = listSimple(db.househelps);
  const placements = db.placements.map(placementView);
  const contracts = listSimple(db.contracts);
  const complaints = listSimple(db.complaints);
  const replacements = listSimple(db.replacements);
  const hhPayments = listSimple(db.hhPayments);
  const today = todayISO();
  const month = monthKey(today);
  const weekAgo = daysAgo(6);

  const todayOrders = orders.filter(o => o.date === today);
  const monthOrders = orders.filter(o => monthKey(o.date) === month);
  const monthExp = expenses.filter(x => monthKey(x.date) === month);
  return {
    kpi: {
      todaySales: sum(todayOrders.map(o => o.total)),
      todayOrders: todayOrders.length,
      todayExpenses: sum(expenses.filter(x => x.date === today).map(x => x.amount)),
      todayProfit: sum(todayOrders.map(o => o.netServiceProfit)) -
        sum(expenses.filter(x => x.date === today).map(x => x.amount)),
      weeklyRevenue: sum(orders.filter(o => o.date >= weekAgo).map(o => o.total)),
      monthlyRevenue: sum(monthOrders.map(o => o.total)),
      monthlyExpenses: sum(monthExp.map(x => x.amount)),
      monthlyProfit: sum(monthOrders.map(o => o.netServiceProfit)) - sum(monthExp.map(x => x.amount)),
      outstanding: sum(orders.map(o => o.balance)),
      activeCustomers: customers.filter(c => c.status === 'Active').length,
      activeHousehelps: househelps.filter(h => h.status === 'Placed' || h.status === 'On Contract').length,
      activePlacements: placements.filter(p => p.status === 'Active').length,
      pendingHousehelpPayments: hhPayments.filter(p => p.status === 'Pending').length,
      activeContracts: contracts.filter(c => c.status === 'Active').length,
      contractsExpiringSoon: contracts.filter(c => c.status === 'Active' && c.endDate &&
        c.endDate >= today && c.endDate <= daysAhead(30)).length,
      openComplaints: complaints.filter(c => c.status !== 'Resolved' && c.status !== 'Escalated').length,
      replacementRequests: replacements.filter(r => r.status === 'Requested' || r.status === 'In Progress').length
    },
    charts: {
      revenueLast30Days: dailySeries(orders, 30, o => o.total),
      profitLast30Days: dailySeries(orders, 30, o => o.netServiceProfit, expenses),
      ordersByStatus: groupCount(orders, o => o.orderStatus || 'Pending'),
      paymentStatus: groupCount(orders, o => o.paymentStatus),
      revenueByService: groupSum(orders, o => o.service || 'Other', o => o.total),
      revenueByServiceCategory: groupSum(orders, o => serviceCategoryOf(o.service), o => o.total),
      monthlyRevenue: monthlySeries(orders, 12, o => o.total),
      monthlyExpenses: monthlySeries(expenses, 12, x => x.amount),
      placementsByStatus: groupCount(placements, p => p.status || 'Pending'),
      househelpCategories: groupCount(placements, p => p.category || 'Other'),
      complaintsByStatus: groupCount(complaints, c => c.status || 'Reported'),
      contractStatuses: groupCount(contracts, c => c.status || 'Pending')
    },
    generatedAt: today
  };
}

function getReport(d) {
  const type = clean(d.type);
  if (!type) throw new Error('Report type is required');
  const orders = listOrders({});
  const expenses = listSimple(db.expenses);
  const from = clean(d.from), to = clean(d.to);
  const inRange = iso => (!from || iso >= from) && (!to || iso <= to);

  switch (type) {
    case 'daily': {
      const days = {};
      orders.filter(o => inRange(o.date)).forEach(o => {
        days[o.date] = days[o.date] || { date: o.date, orders: 0, revenue: 0, paid: 0,
          transport: 0, directExpenses: 0, profit: 0, otherExpenses: 0 };
        const day = days[o.date];
        day.orders++; day.revenue += o.total; day.paid += o.amountPaid;
        day.transport += o.transportFee; day.directExpenses += o.directExpense;
        day.profit += o.netServiceProfit;
      });
      expenses.filter(x => inRange(x.date)).forEach(x => {
        // expense-only days still appear as their own rows
        days[x.date] = days[x.date] || { date: x.date, orders: 0, revenue: 0, paid: 0,
          transport: 0, directExpenses: 0, profit: 0, otherExpenses: 0 };
        days[x.date].profit -= x.amount;
        days[x.date].otherExpenses += x.amount;
      });
      return { rows: Object.keys(days).sort().map(k => days[k]) };
    }
    case 'weekly': case 'monthly': case 'yearly': {
      const buckets = {};
      const keyFn = type === 'weekly' ? weekKey :
        (type === 'monthly' ? monthKey : iso => String(iso).slice(0, 4));
      orders.filter(o => inRange(o.date)).forEach(o => {
        const k = keyFn(o.date);
        buckets[k] = buckets[k] || { period: k, orders: 0, revenue: 0, paid: 0, profit: 0, expenses: 0 };
        buckets[k].orders++; buckets[k].revenue += o.total;
        buckets[k].paid += o.amountPaid; buckets[k].profit += o.netServiceProfit;
      });
      expenses.filter(x => inRange(x.date)).forEach(x => {
        const k = keyFn(x.date);
        // expense-only periods still appear as their own rows
        buckets[k] = buckets[k] || { period: k, orders: 0, revenue: 0, paid: 0, profit: 0, expenses: 0 };
        buckets[k].profit -= x.amount; buckets[k].expenses += x.amount;
      });
      return { rows: Object.keys(buckets).sort().map(k => buckets[k]) };
    }
    case 'pnl': {
      const rangedOrders = orders.filter(o => inRange(o.date));
      const revenue = sum(rangedOrders.map(o => o.total));
      const transport = sum(rangedOrders.map(o => o.transportFee));
      const directExpenses = sum(rangedOrders.map(o => o.directExpense));
      const byCategory = {};
      let otherExpenses = 0;
      expenses.filter(x => inRange(x.date)).forEach(x => {
        byCategory[x.category] = (byCategory[x.category] || 0) + x.amount;
        otherExpenses += x.amount;
      });
      return {
        revenue, transportFees: transport, directServiceExpenses: directExpenses,
        expensesByCategory: Object.keys(byCategory).map(k => ({ category: k, amount: byCategory[k] })),
        totalExpenses: directExpenses + otherExpenses,
        netProfit: revenue + transport - directExpenses - otherExpenses
      };
    }
    case 'outstanding': {
      const rows = orders.filter(o => o.balance > 0)
        .map(o => ({ orderId: o.id, date: o.date, customer: o.customerName, phone: o.phone,
          service: o.service, total: o.total, paid: o.amountPaid, balance: o.balance }))
        .sort((a, b) => b.balance - a.balance);
      return { rows, totalOutstanding: sum(rows.map(r => r.balance)) };
    }
    case 'customers': {
      const rows = refreshCustomers().filter(c => inRange(c.lastServiceDate || ''));
      return { rows };
    }
    case 'services': {
      const svcOrders = orders.filter(o => inRange(o.date));
      const rev = groupSum(svcOrders, o => o.service || 'Other', o => o.total);
      const counts = groupCount(svcOrders, o => o.service || 'Other');
      return { rows: rev.map(r => {
        const c = counts.find(x => x.label === r.label);
        return { service: r.label, orders: c ? c.value : 0, revenue: r.value };
      }) };
    }
    case 'laundry': {
      const laundry = orders.filter(o => serviceCategoryOf(o.service) === 'Laundry' && inRange(o.date));
      const rev = groupSum(laundry, o => o.service || 'Other', o => o.total);
      const counts = groupCount(laundry, o => o.service || 'Other');
      return { rows: rev.map(r => {
        const c = counts.find(x => x.label === r.label);
        return { service: r.label, orders: c ? c.value : 0, revenue: r.value };
      }), totalLaundryRevenue: sum(laundry.map(o => o.total)) };
    }
    case 'househelps': {
      const hh = listSimple(db.househelps);
      const placements = db.placements.map(placementView);
      return { rows: hh.map(h => {
        const p = placements.find(pl => pl.househelpId === h.id &&
          ['Active', 'Pending', 'Matching', 'Contract Pending'].includes(pl.status));
        return Object.assign({}, h, { currentPlacement: p ? p.id : '',
          currentEmployer: p ? p.employerName : '', placementStatus: p ? p.status : '' });
      }) };
    }
    case 'placements': return { rows: db.placements.map(placementView) };
    case 'contracts': return { rows: listSimple(db.contracts) };
    case 'complaints': return { rows: listSimple(db.complaints) };
    case 'replacements': return { rows: listSimple(db.replacements) };
    case 'payments': {
      const rows = listSimple(db.payments).filter(p => inRange(p.date));
      return { rows, total: sum(rows.map(p => p.amount)) };
    }
    default: throw new Error('Unknown report type: ' + type);
  }
}

/* --------------------------------------------------------------------------
 * Action handler — identical action set to Code.gs
 * ------------------------------------------------------------------------ */
function handleAction(action, d) {
  d = d || {};
  switch (action) {
    case 'getSettings': return { settings: Object.assign({}, settings), lists };
    case 'updateSettings': {
      const updates = d.settings || {};
      Object.keys(updates).forEach(k => { settings[k] = clean(updates[k]); });
      return { settings: Object.assign({}, settings), lists };
    }
    case 'addList': {
      const list = lists[d.list];
      if (!list) throw new Error('Unknown list: ' + d.list);
      const item = d.item || {};
      const name = typeof item === 'string' ? item : clean(item.name);
      if (!name) throw new Error('List item needs a name');
      list.items.push(Object.assign({}, item, { name }));
      return { settings: Object.assign({}, settings), lists };
    }
    case 'renameList': {
      const list = lists[d.list];
      if (!list) throw new Error('Unknown list: ' + d.list);
      const it = list.items.find(i => i.name === d.oldName);
      if (!it) throw new Error('Item not found: ' + d.oldName);
      it.name = clean(d.newName);
      return { settings: Object.assign({}, settings), lists };
    }
    case 'deleteList': {
      const list = lists[d.list];
      if (!list) throw new Error('Unknown list: ' + d.list);
      const idx = list.items.findIndex(i => i.name === d.name);
      if (idx < 0) throw new Error('Item not found: ' + d.name);
      list.items.splice(idx, 1);
      return { settings: Object.assign({}, settings), lists };
    }
    case 'updateList': {
      const list = lists[d.list];
      if (!list) throw new Error('Unknown list: ' + d.list);
      const it = list.items.find(i => i.name === d.name);
      if (!it) throw new Error('Item not found: ' + d.name);
      Object.assign(it, d.item || {});
      return { settings: Object.assign({}, settings), lists };
    }

    case 'listOrders': return listOrders(d);
    case 'createOrder': {
      const o = normalizeOrder(d, false);
      o.id = newId('DC');
      db.orders.push(o);
      return decorateOrder(o);
    }
    case 'updateOrder': {
      const id = clean(d.orderId);
      if (!id) throw new Error('orderId is required');
      const o = findOrder(id);
      if (!o) throw new Error('Order not found: ' + id);
      const upd = normalizeOrder(d, true);
      // merge only provided fields (mirrors Code.gs updateOrder) so a partial
      // update never wipes lineItems / quantity / unitPrice
      ['date', 'customerName', 'phone', 'email', 'service', 'description',
       'discount', 'amountPaid', 'orderStatus', 'transportFee', 'directExpense',
       'notes', 'lineItems', 'quantity', 'unitPrice'].forEach(k => {
        if (d[k] !== undefined) o[k] = upd[k];
      });
      return decorateOrder(o);
    }
    case 'deleteOrder': {
      const id = clean(d.orderId);
      const idx = db.orders.findIndex(o => o.id === id);
      if (idx < 0) throw new Error('Order not found: ' + id);
      const [o] = db.orders.splice(idx, 1);
      db.archive.push(Object.assign({}, o, { archivedDate: todayISO() }));
      return { archived: id };
    }

    case 'listCustomers': {
      const s = String(d.search || '').toLowerCase();
      const rows = refreshCustomers();
      return s ? rows.filter(c => `${c.name} ${c.phone} ${c.email}`.toLowerCase().includes(s)) : rows;
    }
    case 'getCustomer': {
      const name = String(d.name || '').toLowerCase();
      const phone = String(d.phone || '').toLowerCase();
      const c = refreshCustomers().find(x =>
        (name && x.name.toLowerCase().includes(name)) || (phone && String(x.phone).toLowerCase().includes(phone)));
      if (!c) throw new Error('Customer not found');
      c.orders = listOrders({}).filter(o => customerKey(o.customerName, o.phone) === customerKey(c.name, c.phone));
      return c;
    }
    case 'getCustomerOrders': {
      const key = customerKey(d.name, d.phone);
      return listOrders({}).filter(o => customerKey(o.customerName, o.phone) === key);
    }

    case 'listPayments': {
      const s = String(d.search || '').toLowerCase();
      const rows = listSimple(db.payments);
      return s ? rows.filter(p => `${p.id} ${p.customer} ${p.orderId} ${p.reference}`.toLowerCase().includes(s)) : rows;
    }
    case 'createPayment': {
      const p = { id: newId('PAY'), date: validDate(d.date), customer: clean(d.customer),
        orderId: clean(d.orderId), amount: Math.max(0, num(d.amount)), method: clean(d.method),
        reference: clean(d.reference), receivedBy: clean(d.receivedBy), notes: clean(d.notes) };
      if (!p.customer && !p.orderId) throw new Error('Customer or Order ID is required');
      if (p.amount <= 0) throw new Error('Payment amount must be greater than 0');
      db.payments.push(p);
      syncOrderPaid(p.orderId, p.amount);
      return p;
    }
    case 'updatePayment': {
      const id = clean(d.paymentId);
      const p = db.payments.find(x => x.id === id);
      if (!p) throw new Error('Payment not found: ' + id);
      const oldOrderId = p.orderId, oldAmount = p.amount;
      Object.assign(p, { date: d.date !== undefined ? validDate(d.date) : p.date,
        customer: d.customer !== undefined ? clean(d.customer) : p.customer,
        orderId: d.orderId !== undefined ? clean(d.orderId) : p.orderId,
        amount: d.amount !== undefined ? Math.max(0, num(d.amount)) : p.amount,
        method: d.method !== undefined ? clean(d.method) : p.method,
        reference: d.reference !== undefined ? clean(d.reference) : p.reference,
        receivedBy: d.receivedBy !== undefined ? clean(d.receivedBy) : p.receivedBy,
        notes: d.notes !== undefined ? clean(d.notes) : p.notes });
      if (oldOrderId) syncOrderPaid(oldOrderId, -oldAmount);
      if (p.orderId) syncOrderPaid(p.orderId, p.amount);
      return p;
    }
    case 'deletePayment': {
      const id = clean(d.paymentId);
      const idx = db.payments.findIndex(x => x.id === id);
      if (idx < 0) throw new Error('Payment not found: ' + id);
      const [p] = db.payments.splice(idx, 1);
      if (p.orderId) syncOrderPaid(p.orderId, -num(p.amount));
      return { deleted: id };
    }

    case 'listExpenses': {
      const s = String(d.search || '').toLowerCase();
      let rows = listSimple(db.expenses);
      if (s) rows = rows.filter(x => `${x.id} ${x.category} ${x.description} ${x.relatedService}`.toLowerCase().includes(s));
      if (d.category) rows = rows.filter(x => x.category === d.category);
      return rows;
    }
    case 'addExpense': {
      const x = { id: newId('EXP'), date: validDate(d.date),
        category: clean(d.category) || 'Other', description: clean(d.description),
        amount: Math.max(0, num(d.amount)), method: clean(d.method),
        relatedService: clean(d.relatedService), notes: clean(d.notes) };
      if (!x.description) throw new Error('Expense description is required');
      db.expenses.push(x);
      return x;
    }
    case 'updateExpense': {
      const id = clean(d.expenseId);
      const x = db.expenses.find(e => e.id === id);
      if (!x) throw new Error('Expense not found: ' + id);
      Object.assign(x, { date: d.date !== undefined ? validDate(d.date) : x.date,
        category: d.category !== undefined ? clean(d.category) : x.category,
        description: d.description !== undefined ? clean(d.description) : x.description,
        amount: d.amount !== undefined ? Math.max(0, num(d.amount)) : x.amount,
        method: d.method !== undefined ? clean(d.method) : x.method,
        relatedService: d.relatedService !== undefined ? clean(d.relatedService) : x.relatedService,
        notes: d.notes !== undefined ? clean(d.notes) : x.notes });
      return x;
    }
    case 'deleteExpense': {
      const id = clean(d.expenseId);
      const idx = db.expenses.findIndex(e => e.id === id);
      if (idx < 0) throw new Error('Expense not found: ' + id);
      db.expenses.splice(idx, 1);
      return { deleted: id };
    }

    case 'listHousehelps': {
      const s = String(d.search || '').toLowerCase();
      let rows = listSimple(db.househelps);
      if (s) rows = rows.filter(h => `${h.id} ${h.fullName} ${h.phone} ${h.skills}`.toLowerCase().includes(s));
      if (d.status) rows = rows.filter(h => h.status === d.status);
      return rows;
    }
    case 'createHousehelp': {
      const h = { id: newId('HH'), fullName: clean(d.fullName), phone: clean(d.phone),
        email: clean(d.email), gender: clean(d.gender), nationality: clean(d.nationality),
        occupation: clean(d.occupation), nida: clean(d.nida), cityCountry: clean(d.cityCountry),
        homeAddress: clean(d.homeAddress), registrationDate: validDate(d.registrationDate),
        status: clean(d.status) || 'Available', skills: clean(d.skills),
        experience: clean(d.experience), availability: clean(d.availability), notes: clean(d.notes) };
      if (!h.fullName) throw new Error('Full name is required');
      db.househelps.push(h);
      return h;
    }
    case 'updateHousehelp': {
      const id = clean(d.househelpId);
      const h = db.househelps.find(x => x.id === id);
      if (!h) throw new Error('Househelp not found: ' + id);
      Object.keys(d).forEach(k => {
        if (k === 'househelpId') return;
        if (k === 'registrationDate') h[k] = validDate(d[k]);
        else h[k] = clean(d[k]);
      });
      return h;
    }
    case 'archiveHousehelp': {
      const id = clean(d.househelpId);
      const h = db.househelps.find(x => x.id === id);
      if (!h) throw new Error('Househelp not found: ' + id);
      h.status = 'Inactive';
      return { archived: id, status: 'Inactive' };
    }

    case 'listEmployers': {
      const s = String(d.search || '').toLowerCase();
      const rows = listSimple(db.employers);
      return s ? rows.filter(e => `${e.id} ${e.fullName} ${e.phone}`.toLowerCase().includes(s)) : rows;
    }
    case 'createEmployer': {
      const e = { id: newId('CL'), fullName: clean(d.fullName), familyMember: clean(d.familyMember),
        phone: clean(d.phone), email: clean(d.email), gender: clean(d.gender),
        nationality: clean(d.nationality), occupation: clean(d.occupation),
        cityCountry: clean(d.cityCountry), nida: clean(d.nida),
        homeAddress: clean(d.homeAddress), registrationDate: validDate(d.registrationDate),
        notes: clean(d.notes) };
      if (!e.fullName) throw new Error('Full name is required');
      db.employers.push(e);
      return e;
    }
    case 'updateEmployer': {
      const id = clean(d.clientId);
      const e = db.employers.find(x => x.id === id);
      if (!e) throw new Error('Employer not found: ' + id);
      Object.keys(d).forEach(k => {
        if (k === 'clientId') return;
        if (k === 'registrationDate') e[k] = validDate(d[k]);
        else e[k] = clean(d[k]);
      });
      return e;
    }

    case 'listPlacements': {
      const s = String(d.search || '').toLowerCase();
      let rows = db.placements.map(placementView);
      if (s) rows = rows.filter(p => `${p.id} ${p.househelpName} ${p.employerName} ${p.category}`.toLowerCase().includes(s));
      if (d.status) rows = rows.filter(p => p.status === d.status);
      return rows;
    }
    case 'createPlacement': {
      const p = { id: newId('PL'), househelpId: clean(d.househelpId),
        employerId: clean(d.employerId), category: clean(d.category),
        jobDescription: clean(d.jobDescription), salary: Math.max(0, num(d.salary)),
        paymentFrequency: clean(d.paymentFrequency), startDate: validDate(d.startDate),
        expectedEndDate: clean(d.expectedEndDate), status: clean(d.status) || 'Pending',
        contractStatus: clean(d.contractStatus) || 'Pending', liveIn: clean(d.liveIn),
        workingHours: clean(d.workingHours), accommodation: clean(d.accommodation),
        meals: clean(d.meals), agencyFee: Math.max(0, num(d.agencyFee)), notes: clean(d.notes) };
      if (!p.househelpId || !p.employerId) throw new Error('Househelp and Employer are required');
      db.placements.push(p);
      const hh = db.househelps.find(h => h.id === p.househelpId);
      // match updatePlacement's status mapping
      if (hh) hh.status = p.status === 'Active' ? 'On Contract' :
        (p.status === 'Completed' || p.status === 'Terminated') ? 'Available' : 'Placed';
      return placementView(p);
    }
    case 'updatePlacement': {
      const id = clean(d.placementId);
      const p = db.placements.find(x => x.id === id);
      if (!p) throw new Error('Placement not found: ' + id);
      Object.keys(d).forEach(k => {
        if (k === 'placementId') return;
        if (k === 'startDate') p[k] = validDate(d[k]);
        else if (k === 'salary' || k === 'agencyFee') p[k] = Math.max(0, num(d[k]));
        else p[k] = clean(d[k]);
      });
      const hh = db.househelps.find(h => h.id === p.househelpId);
      if (hh) hh.status = p.status === 'Active' ? 'On Contract' :
        (p.status === 'Completed' || p.status === 'Terminated') ? 'Available' : 'Placed';
      return placementView(p);
    }
    case 'terminatePlacement': {
      const id = clean(d.placementId);
      const p = db.placements.find(x => x.id === id);
      if (!p) throw new Error('Placement not found: ' + id);
      p.status = 'Terminated'; p.contractStatus = 'Terminated';
      const stamp = `Terminated ${validDate(d.date)}${d.reason ? ': ' + clean(d.reason) : ''}`;
      p.notes = (p.notes ? p.notes + ' | ' : '') + stamp;
      const hh = db.househelps.find(h => h.id === p.househelpId);
      if (hh) hh.status = 'Available';
      db.contracts.forEach(c => {
        if (c.placementId === id) {
          c.status = 'Terminated'; c.terminationDate = validDate(d.date);
          if (d.reason) c.terminationReason = clean(d.reason);
        }
      });
      return placementView(p);
    }

    case 'listContracts': {
      const s = String(d.search || '').toLowerCase();
      let rows = listSimple(db.contracts);
      if (s) rows = rows.filter(c => `${c.id} ${c.employer} ${c.househelp} ${c.placementId}`.toLowerCase().includes(s));
      if (d.status) rows = rows.filter(c => c.status === d.status);
      return rows;
    }
    case 'createContract': {
      const c = { id: newId('CON'), placementId: clean(d.placementId),
        employer: clean(d.employer), househelp: clean(d.househelp),
        startDate: validDate(d.startDate), endDate: clean(d.endDate),
        minimumDuration: clean(d.minimumDuration) || '3 months',
        noticeRequired: clean(d.noticeRequired), status: clean(d.status) || 'Pending',
        terminationDate: '', terminationReason: '', documentLink: clean(d.documentLink),
        employerSignature: clean(d.employerSignature), househelpSignature: clean(d.househelpSignature),
        deeAck: clean(d.deeAck), notes: clean(d.notes) };
      if (!c.employer || !c.househelp) throw new Error('Employer and Househelp are required');
      db.contracts.push(c);
      const p = db.placements.find(x => x.id === c.placementId);
      if (p) {
        p.contractStatus = c.status;
        if (c.status === 'Active') p.status = 'Active';
      }
      return c;
    }
    case 'updateContract': {
      const id = clean(d.contractId);
      const c = db.contracts.find(x => x.id === id);
      if (!c) throw new Error('Contract not found: ' + id);
      Object.keys(d).forEach(k => {
        if (k === 'contractId') return;
        if (k === 'startDate' || k === 'terminationDate') c[k] = validDate(d[k]);
        else c[k] = clean(d[k]);
      });
      const p = db.placements.find(x => x.id === c.placementId);
      if (p) {
        p.contractStatus = c.status;
        if (c.status === 'Active') p.status = 'Active';
      }
      return c;
    }
    case 'terminateContract': {
      const id = clean(d.contractId);
      const c = db.contracts.find(x => x.id === id);
      if (!c) throw new Error('Contract not found: ' + id);
      c.status = 'Terminated'; c.terminationDate = validDate(d.date);
      if (d.reason) c.terminationReason = clean(d.reason);
      const p = db.placements.find(x => x.id === c.placementId);
      if (p) { p.status = 'Terminated'; p.contractStatus = 'Terminated'; }
      return c;
    }

    case 'listHousehelpPayments': {
      const s = String(d.search || '').toLowerCase();
      const rows = listSimple(db.hhPayments);
      return s ? rows.filter(p => `${p.id} ${p.househelpId} ${p.placementId} ${p.period}`.toLowerCase().includes(s)) : rows;
    }
    case 'createHousehelpPayment': {
      const p = { id: newId('HHP'), househelpId: clean(d.househelpId),
        employerId: clean(d.employerId), placementId: clean(d.placementId),
        paymentDate: validDate(d.paymentDate), period: clean(d.period),
        amount: Math.max(0, num(d.amount)), method: clean(d.method),
        status: clean(d.status) || 'Pending', reference: clean(d.reference), notes: clean(d.notes) };
      if (!p.househelpId && !p.placementId) throw new Error('Househelp or Placement is required');
      db.hhPayments.push(p);
      return p;
    }
    case 'updateHousehelpPayment': {
      const id = clean(d.paymentId);
      const p = db.hhPayments.find(x => x.id === id);
      if (!p) throw new Error('Househelp payment not found: ' + id);
      Object.keys(d).forEach(k => {
        if (k === 'paymentId') return;
        if (k === 'paymentDate') p[k] = validDate(d[k]);
        else if (k === 'amount') p[k] = Math.max(0, num(d[k]));
        else p[k] = clean(d[k]);
      });
      return p;
    }

    case 'listComplaints': {
      const s = String(d.search || '').toLowerCase();
      let rows = listSimple(db.complaints);
      if (s) rows = rows.filter(c => `${c.id} ${c.client} ${c.househelp} ${c.type} ${c.description}`.toLowerCase().includes(s));
      if (d.status) rows = rows.filter(c => c.status === d.status);
      return rows;
    }
    case 'createComplaint': {
      const c = { id: newId('CMP'), date: validDate(d.date), client: clean(d.client),
        househelp: clean(d.househelp), placement: clean(d.placement),
        type: clean(d.type) || 'Other', description: clean(d.description),
        reportedBy: clean(d.reportedBy), severity: clean(d.severity) || 'Medium',
        status: clean(d.status) || 'Reported', action: clean(d.action),
        resolution: clean(d.resolution), resolutionDate: clean(d.resolutionDate),
        notes: clean(d.notes) };
      if (!c.description) throw new Error('Complaint description is required');
      db.complaints.push(c);
      return c;
    }
    case 'updateComplaint': {
      const id = clean(d.complaintId);
      const c = db.complaints.find(x => x.id === id);
      if (!c) throw new Error('Complaint not found: ' + id);
      Object.keys(d).forEach(k => {
        if (k === 'complaintId') return;
        if (k === 'date' || k === 'resolutionDate') c[k] = validDate(d[k]);
        else c[k] = clean(d[k]);
      });
      return c;
    }
    case 'resolveComplaint': {
      const id = clean(d.complaintId);
      const c = db.complaints.find(x => x.id === id);
      if (!c) throw new Error('Complaint not found: ' + id);
      if (d.status !== undefined) c.status = clean(d.status);
      else c.status = 'Resolved';
      if (d.action !== undefined) c.action = clean(d.action);
      if (d.resolution !== undefined) c.resolution = clean(d.resolution);
      c.resolutionDate = validDate(d.resolutionDate);
      return c;
    }

    case 'listReplacements': {
      const s = String(d.search || '').toLowerCase();
      const rows = listSimple(db.replacements);
      return s ? rows.filter(r => `${r.id} ${r.employer} ${r.originalHousehelp} ${r.reason}`.toLowerCase().includes(s)) : rows;
    }
    case 'createReplacement': {
      const r = { id: newId('REP'), originalPlacement: clean(d.originalPlacement),
        originalHousehelp: clean(d.originalHousehelp), employer: clean(d.employer),
        reason: clean(d.reason), requestDate: validDate(d.requestDate),
        replacementHousehelp: clean(d.replacementHousehelp),
        replacementDate: clean(d.replacementDate), status: clean(d.status) || 'Requested',
        notes: clean(d.notes) };
      if (!r.employer) throw new Error('Employer is required');
      db.replacements.push(r);
      const p = db.placements.find(x => x.id === r.originalPlacement);
      if (p) p.status = 'Replacement Required';
      return r;
    }
    case 'updateReplacement': {
      const id = clean(d.replacementId);
      const r = db.replacements.find(x => x.id === id);
      if (!r) throw new Error('Replacement not found: ' + id);
      Object.keys(d).forEach(k => {
        if (k === 'replacementId') return;
        if (k === 'requestDate' || k === 'replacementDate') r[k] = validDate(d[k]);
        else r[k] = clean(d[k]);
      });
      return r;
    }

    case 'listAttendance': {
      let rows = listSimple(db.attendance);
      if (d.date) rows = rows.filter(a => a.date === d.date);
      return rows;
    }
    case 'createAttendance': {
      const a = { id: newId('ATT'), date: validDate(d.date), personType: clean(d.personType),
        person: clean(d.person), checkIn: clean(d.checkIn), checkOut: clean(d.checkOut),
        hours: clean(d.hours), status: clean(d.status) || 'Present', notes: clean(d.notes) };
      if (!a.person) throw new Error('Person is required');
      db.attendance.push(a);
      return a;
    }
    case 'updateAttendance': {
      const id = clean(d.attendanceId);
      const a = db.attendance.find(x => x.id === id);
      if (!a) throw new Error('Attendance record not found: ' + id);
      Object.keys(d).forEach(k => {
        if (k === 'attendanceId') return;
        if (k === 'date') a[k] = validDate(d[k]);
        else a[k] = clean(d[k]);
      });
      return a;
    }

    case 'getDashboard': return getDashboard();
    case 'getReport': return getReport(d);
    default: throw new Error('Unknown action: ' + action);
  }
}

/* --------------------------------------------------------------------------
 * HTTP server
 * ------------------------------------------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (code, body, type) => {
    res.writeHead(code, {
      'Content-Type': type || 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    res.end(body);
  };

  if (req.method === 'OPTIONS') return send(204, '');

  // ---- JSON API ----
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on('end', () => {
      try {
        let params = {};
        url.searchParams.forEach((v, k) => { params[k] = v; });
        if (req.method === 'POST' && body) {
          let parsed = {};
          try { parsed = JSON.parse(body); } catch (e) {
            try { const sp = new URLSearchParams(body); sp.forEach((v, k) => { parsed[k] = v; }); }
            catch (e2) { parsed = {}; }
          }
          Object.assign(params, parsed);
        }
        if (!params.action) throw new Error('Missing "action" parameter');
        const data = params.data !== undefined && params.data !== null ? params.data : params;
        const result = handleAction(params.action, data);
        send(200, JSON.stringify({ ok: true, data: result, version: API_VERSION }));
      } catch (err) {
        send(200, JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err), version: API_VERSION }));
      }
    });
    return;
  }

  // ---- static frontend files ----
  let filePath = decodeURIComponent(url.pathname);
  if (filePath === '/' || filePath === '') filePath = '/index.html';
  const safe = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  const full = path.join(FRONTEND_DIR, safe);
  if (!full.startsWith(FRONTEND_DIR)) return send(403, 'Forbidden', 'text/plain');
  fs.readFile(full, (err, buf) => {
    if (err) {
      if (err.code === 'ENOENT') return send(404, 'Not found', 'text/plain');
      return send(500, 'Server error', 'text/plain');
    }
    const ext = path.extname(full).toLowerCase();
    send(200, buf, MIME[ext] || 'application/octet-stream');
  });
});

server.listen(PORT, () => {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  DEE CLEANERS — Mock Development Server');
  console.log(`  Web app:  http://localhost:${PORT}`);
  console.log(`  API:      http://localhost:${PORT}/api?action=getSettings`);
  console.log('  (In-memory demo data — restarting the server resets it.)');
  console.log('══════════════════════════════════════════════════════════════');
});
