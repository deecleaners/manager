/* ==========================================================================
   DEE CLEANERS — Business Management System (frontend SPA)
   ==========================================================================
   Vanilla JavaScript, no build step, no frameworks. Google Sheets is the
   single source of truth — this app only reads and writes through the
   Apps Script API (or the mock server for development).

   Routes:
     #/dashboard  #/orders    #/customers   #/payments   #/expenses
     #/attendance #/househelps #/employers  #/placements #/contracts
     #/complaints #/replacements #/hhpayments #/reports   #/invoices
     #/receipts   #/services  #/settings
     (profiles: #/customers?name=… #/househelps?id=… #/employers?id=…)
   ========================================================================== */

'use strict';

/* ==========================================================================
 * 1. Utilities
 * ========================================================================== */

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

const esc = v => String(v === null || v === undefined ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmtMoney = n => {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('en-US');
};
const fmtMoneyTZS = n => 'TZS ' + fmtMoney(n);
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtDate = iso => {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return esc(iso);
  return `${m[3]}/${m[2]}/${m[1]}`;
};
const fmtDateLong = iso => {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return esc(iso);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${parseInt(m[3], 10)} ${names[parseInt(m[2], 10) - 1]} ${m[1]}`;
};
const debounce = (fn, ms) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};
const initials = name => String(name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

/* Badge colour for status values */
const BADGE = {
  ok: ['Paid', 'Completed', 'Resolved', 'Available', 'Active', 'Yes', 'Present'],
  warn: ['Partial', 'Pending', 'Reported', 'Contract Pending', 'Half Day'],
  info: ['In Progress', 'Under Review', 'Matching', 'Placed', 'Confirmed'],
  violet: ['On Contract', 'Mediation', 'Escalated'],
  danger: ['Unpaid', 'Cancelled', 'Terminated', 'Replacement Required', 'Inactive', 'Absent'],
  neutral: ['Leave', 'No']
};
function badgeClass(v) {
  const s = String(v || '');
  for (const cls in BADGE) if (BADGE[cls].includes(s)) return cls;
  return 'neutral';
}
const badge = v => `<span class="badge ${badgeClass(v)}">${esc(v || '—')}</span>`;

/* ==========================================================================
 * 2. API client
 * ========================================================================== */

function getApiConfig() {
  return {
    apiUrl: localStorage.getItem('dee_api_url') || (window.DEE_CLEANERS_CONFIG && window.DEE_CLEANERS_CONFIG.apiUrl) || '',
    apiKey: localStorage.getItem('dee_api_key') || (window.DEE_CLEANERS_CONFIG && window.DEE_CLEANERS_CONFIG.apiKey) || ''
  };
}
function saveApiConfig(url, key) {
  localStorage.setItem('dee_api_url', String(url || '').trim().replace(/\/+$/, ''));
  localStorage.setItem('dee_api_key', String(key || '').trim());
}
function apiConfigured() { return !!getApiConfig().apiUrl; }

/**
 * Call the backend. Uses POST text/plain (simple request — no CORS preflight)
 * and follows the Apps Script redirect, so it works against both the
 * Google Apps Script Web App and the local mock server.
 */
async function api(action, data) {
  const cfg = getApiConfig();
  if (!cfg.apiUrl) throw new Error('API URL is not configured');
  const body = Object.assign({ action: action }, data !== undefined ? { data: data } : {});
  if (cfg.apiKey) body.key = cfg.apiKey;
  let res;
  try {
    res = await fetch(cfg.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    });
  } catch (err) {
    setApiDot(false);
    throw new Error('Cannot reach the API. Check your connection and the API URL in Settings.');
  }
  if (!res.ok) {
    setApiDot(false);
    throw new Error('API error (HTTP ' + res.status + ')');
  }
  const out = await res.json();
  if (!out || out.ok !== true) {
    setApiDot(false);
    throw new Error((out && out.error) ? out.error : 'API returned an invalid response');
  }
  setApiDot(true);
  return out.data;
}

function setApiDot(on) {
  const dot = $('#api-dot'), txt = $('#api-status-text');
  if (!dot) return;
  dot.className = 'api-dot ' + (on ? 'on' : 'off');
  // "API connected" is accurate for both Google Sheets and the local mock
  if (txt) txt.textContent = on ? 'API connected' : 'API offline';
}

/** Cache for settings/lists (refreshed by actions that change them). */
let settingsCache = null;
async function getSettings() {
  if (settingsCache) return settingsCache;
  settingsCache = await api('getSettings');
  return settingsCache;
}
function invalidateSettings() { settingsCache = null; }
function listItems(name) {
  if (!settingsCache) return [];
  const l = settingsCache.lists[name];
  return l ? l.items : [];
}
function listNames(name) { return listItems(name).map(i => i.name); }

/* ==========================================================================
 * 3. Toasts, modals, confirm
 * ========================================================================== */

function toast(msg, type) {
  const wrap = $('#toast-wrap');
  const t = document.createElement('div');
  t.className = 'toast ' + (type || '');
  t.innerHTML = `<span>${esc(msg)}</span>`;
  wrap.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 3200);
  setTimeout(() => t.remove(), 3600);
}
const toastOK = m => toast(m, 'ok');
const toastErr = m => toast(m, 'err');

function openModal(title, bodyHTML, opts) {
  opts = opts || {};
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHTML;
  const modal = $('#modal');
  modal.className = 'modal' + (opts.size ? ' modal-' + opts.size : '');
  $('#modal-backdrop').hidden = false;
  document.body.style.overflow = 'hidden';
  return {
    close: closeModal,
    onClose: fn => { modal._onClose = fn; }
  };
}
function closeModal() {
  $('#modal-backdrop').hidden = true;
  document.body.style.overflow = '';
  const modal = $('#modal');
  if (modal._onClose) { const f = modal._onClose; modal._onClose = null; f(); }
}
$('#modal-backdrop').addEventListener('click', e => { if (e.target.id === 'modal-backdrop') closeModal(); });
$('#modal-close').addEventListener('click', closeModal);

function confirmDialog(title, message, opts) {
  opts = opts || {};
  return new Promise(resolve => {
    $('#confirm-title').textContent = title;
    $('#confirm-body').innerHTML = `<p style="font-size:13.5px;color:var(--text-soft)">${esc(message)}</p>`;
    $('#confirm-foot').innerHTML =
      `<button class="btn btn-ghost" id="cf-no">Cancel</button>` +
      `<button class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}" id="cf-yes">${esc(opts.confirmText || 'Confirm')}</button>`;
    $('#confirm-backdrop').hidden = false;
    const done = val => { $('#confirm-backdrop').hidden = true; $('#cf-yes').onclick = null; $('#cf-no').onclick = null; resolve(val); };
    $('#cf-yes').onclick = () => done(true);
    $('#cf-no').onclick = () => done(false);
    $('#confirm-backdrop').onclick = e => { if (e.target.id === 'confirm-backdrop') done(false); };
  });
}

/* ==========================================================================
 * 4. Shared UI blocks
 * ========================================================================== */

const loadingHTML = () => `<div class="state-box"><div class="spinner"></div><p>Loading…</p></div>`;
const emptyHTML = (icon, title, sub) =>
  `<div class="state-box"><div class="state-ico">${icon}</div><h4>${esc(title)}</h4><p>${esc(sub || '')}</p></div>`;
const errorHTML = msg =>
  `<div class="state-box"><div class="state-ico">⚠️</div><h4>Something went wrong</h4><p>${esc(msg)}</p></div>`;

function paginationHTML(page, pages) {
  if (pages <= 1) return '';
  let out = `<div class="pagination"><button data-p="prev" ${page <= 1 ? 'disabled' : ''}>‹</button>`;
  for (let p = 1; p <= pages; p++) {
    out += `<button data-p="${p}" class="${p === page ? 'on' : ''}">${p}</button>`;
  }
  out += `<button data-p="next" ${page >= pages ? 'disabled' : ''}>›</button></div>`;
  return out;
}

function bindPagination(container, totalRows, pageSize, onPage) {
  const pages = Math.max(1, Math.ceil(totalRows / pageSize));
  const box = container.querySelector('.pagination');
  if (!box) return;
  box.querySelectorAll('button[data-p]').forEach(b => {
    b.addEventListener('click', () => {
      const v = b.dataset.p;
      const cur = parseInt(container.dataset.page || '1', 10);
      const next = v === 'prev' ? Math.max(1, cur - 1) : v === 'next' ? Math.min(pages, cur + 1) : parseInt(v, 10);
      container.dataset.page = next;
      onPage(next);
    });
  });
}

/** Standard toolbar: search + filters + primary action button. */
function toolbarHTML(opts) {
  let out = `<div class="toolbar">`;
  if (opts.search !== false) {
    out += `<div class="search-input"><input type="search" id="tb-search" placeholder="${esc(opts.searchPlaceholder || 'Search…')}"></div>`;
  }
  (opts.filters || []).forEach(f => {
    out += `<select id="tb-filter-${esc(f.id)}" aria-label="${esc(f.label)}">
      <option value="">${esc(f.label)}</option>` +
      f.options.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('') + `</select>`;
  });
  if (opts.dates) {
    out += `<input type="date" id="tb-from" aria-label="From date"><input type="date" id="tb-to" aria-label="To date">`;
  }
  out += `<span class="spacer"></span>`;
  if (opts.extra) out += opts.extra;
  if (opts.actionLabel) {
    out += `<button class="btn btn-primary" id="tb-action">＋ ${esc(opts.actionLabel)}</button>`;
  }
  out += `</div>`;
  return out;
}

const inputHTML = (id, value, type, placeholder, attrs) =>
  `<input id="${id}" type="${type || 'text'}" value="${esc(value || '')}" placeholder="${esc(placeholder || '')}" ${attrs || ''}>`;
const selectHTML = (id, options, value, placeholder) =>
  `<select id="${id}"><option value="">${esc(placeholder || 'Select…')}</option>` +
  options.map(o => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('') + `</select>`;
const textareaHTML = (id, value, placeholder, rows) =>
  `<textarea id="${id}" rows="${rows || 2}" placeholder="${esc(placeholder || '')}">${esc(value || '')}</textarea>`;

const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
const valNum = id => { const n = Number(val(id)); return isFinite(n) ? n : 0; };
function setInvalid(id, on) {
  const el = document.getElementById(id);
  if (!el) return;
  const f = el.closest('.field');
  if (f) f.classList.toggle('invalid', !!on);
}

/* ==========================================================================
 * 5. Navigation
 * ========================================================================== */

const NAV = [
  { group: 'Overview', items: [
    { route: 'dashboard', label: 'Dashboard', icon: 'M3 13h8V3H3v10zm10 8h8V11h-8v10zM3 21h8v-6H3v6zm10-18v6h8V3h-8z' }
  ]},
  { group: 'Operations', items: [
    { route: 'orders', label: 'Orders', icon: 'M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h10v2H4v-2zm14 2h2v-3h2v3h2v2h-2v3h-2v-3h-2v-2z' },
    { route: 'customers', label: 'Customers', icon: 'M16 11a4 4 0 10-4-4 4 4 0 004 4zm0 2c-2.67 0-8 1.34-8 4v3h16v-3c0-2.66-5.33-4-8-4zM7 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0 2c-2.33 0-7 1.17-7 3.5V19h7v-3c0-1.2.5-2.27 1.2-3.13A9.9 9.9 0 007 13z' },
    { route: 'payments', label: 'Payments', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z' },
    { route: 'expenses', label: 'Expenses', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm-1 15H9v-6h2v6zm4 0h-2V7h2v10z' },
    { route: 'attendance', label: 'Attendance', icon: 'M12 2a10 10 0 1010 10A10 10 0 0012 2zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7z' },
    { route: 'reports', label: 'Reports', icon: 'M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z' }
  ]},
  { group: 'Househelp Service', items: [
    { route: 'househelps', label: 'Househelps', icon: 'M12 12a5 5 0 10-5-5 5 5 0 005 5zm0 2c-3.34 0-10 1.67-10 5v3h20v-3c0-3.33-6.66-5-10-5z' },
    { route: 'employers', label: 'Employers', icon: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C16 14.17 11.33 13 9 13zm7.5-4a3 3 0 100-6 3 3 0 000 6zM22 16.5c0-1.8-2.9-2.9-5.5-3.2.4.9.5 1.9.5 3.2v2.5h5v-2.5z' },
    { route: 'placements', label: 'Placements', icon: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8h5z' },
    { route: 'contracts', label: 'Contracts', icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zM8 13h8v2H8v-2zm0 4h5v2H8v-2z' },
    { route: 'complaints', label: 'Complaints', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z' },
    { route: 'replacements', label: 'Replacements', icon: 'M12 5V1L7 6l5 5V7a5 5 0 01-5 5v2a7 7 0 007-7zm-4 9v4l5-5-5-5v4a5 5 0 005 5h-5z' },
    { route: 'hhpayments', label: 'Salary Payments', icon: 'M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z' }
  ]},
  { group: 'Documents', items: [
    { route: 'invoices', label: 'Invoices', icon: 'M6 2h9l5 5v13a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2zm8 1v5h5M8 13h8M8 17h5' },
    { route: 'receipts', label: 'Receipts', icon: 'M4 4h16v2H4V4zm0 4h16v12a2 2 0 01-2 2H6a2 2 0 01-2-2V8zm3 4h6v2H7v-2zm0 4h6v2H7v-2zm9-4h1v2h-1v-2zm0 4h1v2h-1v-2z' }
  ]},
  { group: 'System', items: [
    { route: 'services', label: 'Services', icon: 'M20 6h-8V4a1 1 0 00-2 0v2H4a1 1 0 000 2h1l1.6 9.6A3 3 0 009.6 20h4.8a3 3 0 003-2.4L19 8h1a1 1 0 000-2zM10 14H8v-4h2v4zm4 0h-2v-4h2v4z' },
    { route: 'settings', label: 'Settings', icon: 'M19.4 13a7.8 7.8 0 000-2l2.1-1.6-2-3.4-2.5 1a8 8 0 00-1.7-1L15 3h-4l-.3 3a8 8 0 00-1.7 1l-2.5-1-2 3.4L6.6 11a7.8 7.8 0 000 2l-2.1 1.6 2 3.4 2.5-1a8 8 0 001.7 1l.3 3h4l.3-3a8 8 0 001.7-1l2.5 1 2-3.4L19.4 13zM12 15.5A3.5 3.5 0 1115.5 12 3.5 3.5 0 0112 15.5z' }
  ]}
];

const ROUTE_TITLES = {
  dashboard: 'Dashboard', orders: 'Orders', customers: 'Customers',
  payments: 'Payments', expenses: 'Expenses', attendance: 'Attendance',
  househelps: 'Househelp Service',
  employers: 'Employers / Clients', placements: 'Placements', contracts: 'Contracts',
  complaints: 'Complaints & Disputes', replacements: 'Replacements',
  hhpayments: 'Househelp Salary Payments', reports: 'Reports',
  invoices: 'Invoices', receipts: 'Receipts', services: 'Services & Pricing',
  settings: 'Settings'
};

const navIcon = d => `<svg class="nav-ico" viewBox="0 0 24 24" fill="currentColor"><path d="${d}"/></svg>`;

function renderNav() {
  const side = $('#sidebar-nav');
  const bottom = $('#bottom-nav');
  let sideHTML = '';
  NAV.forEach(g => {
    sideHTML += `<div class="nav-group-label">${esc(g.group)}</div>` +
      g.items.map(i => `<a class="nav-item" href="#/${i.route}">${navIcon(i.icon)}<span>${esc(i.label)}</span></a>`).join('');
  });
  side.innerHTML = sideHTML;

  // bottom nav: first 4 items + "more" that opens the sidebar on mobile
  const primary = ['dashboard', 'orders', 'payments', 'househelps'];
  let bn = primary.map(r => {
    const item = NAV.flatMap(g => g.items).find(i => i.route === r);
    return `<a class="bn-item" href="#/${r}">${navIcon(item.icon)}<span>${esc(item.label)}</span></a>`;
  }).join('');
  bn += `<button class="bn-item more" id="bn-more">${navIcon('M4 10h16v2H4v-2zm0 4h16v2H4v-2zm0-8h16v2H4V6z')}<span>More</span></button>`;
  bottom.innerHTML = bn;
  $('#bn-more').addEventListener('click', () => $('#sidebar').classList.add('open'));
}

function currentRoute() {
  const h = location.hash || '#/dashboard';
  const m = h.match(/^#\/([a-z]+)/);
  return m ? m[1] : 'dashboard';
}
function currentRouteParams() {
  const h = location.hash || '';
  const q = h.indexOf('?');
  if (q < 0) return {};
  return Object.fromEntries(new URLSearchParams(h.slice(q + 1)));
}

/** Back button: go to the previous in-app view, or fall back on deep links. */
function backOr(fallbackHash) {
  const prev = window.__deePrevHash;
  location.hash = (prev && prev !== location.hash) ? prev : fallbackHash;
}

function setActiveNav(route) {
  $$('.nav-item').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + location.hash.split('?')[0]));
  $$('.bn-item').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + location.hash.split('?')[0]));
  $('#page-title').textContent = ROUTE_TITLES[route] || 'Dee Cleaners';
  $('#sidebar').classList.remove('open');
  $('#main-content').scrollTop = 0;
}

/* ==========================================================================
 * 6. SVG charts (pure SVG, no libraries)
 * ========================================================================== */

function svgLine(data, opts) {
  opts = opts || {};
  const W = 640, H = 200, P = { t: 14, r: 12, b: 26, l: opts.money ? 62 : 30 };
  const innerW = W - P.l - P.r, innerH = H - P.t - P.b;
  const values = data.map(d => d.value);
  const max = Math.max(1, ...values);
  const x = i => P.l + (values.length === 1 ? innerW / 2 : i * innerW / (values.length - 1));
  const y = v => P.t + innerH - (v / max) * innerH;
  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
  const area = `${P.l},${P.t + innerH} ${pts} ${x(values.length - 1)},${P.t + innerH}`;
  let grid = '';
  for (let g = 0; g <= 4; g++) {
    const gy = P.t + innerH * g / 4;
    grid += `<line x1="${P.l}" y1="${gy}" x2="${W - P.r}" y2="${gy}" stroke="#e3e9f2" stroke-width="1"/>` +
      `<text x="${P.l - 6}" y="${gy + 3}" font-size="9" fill="#8b97ad" text-anchor="end">${fmtMoney(max - max * g / 4)}</text>`;
  }
  const every = Math.max(1, Math.floor(data.length / 6));
  let labels = '';
  data.forEach((d, i) => {
    if (i % every === 0 || i === data.length - 1) {
      labels += `<text x="${x(i)}" y="${H - 8}" font-size="9" fill="#8b97ad" text-anchor="middle">${fmtDate(d.date).slice(0, 5)}</text>`;
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="trend chart">
    ${grid}
    <polygon points="${area}" fill="rgba(45,158,214,.12)"/>
    <polyline points="${pts}" fill="none" stroke="#2d9ed6" stroke-width="2.5" stroke-linejoin="round"/>
    ${data.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.value)}" r="2.6" fill="#213668"/>`).join('')}
    ${labels}</svg>`;
}

function svgBars(data, opts) {
  opts = opts || {};
  const W = 640, H = 220, P = { t: 12, r: 10, b: 40, l: opts.money ? 62 : 30 };
  const innerW = W - P.l - P.r, innerH = H - P.t - P.b;
  const max = Math.max(1, ...data.map(d => d.value));
  const n = data.length;
  const bw = Math.min(46, (innerW / n) * 0.55);
  const step = innerW / n;
  let bars = '', labels = '';
  data.forEach((d, i) => {
    const h = Math.max(0, (d.value / max) * innerH);
    const bx = P.l + i * step + (step - bw) / 2;
    bars += `<rect x="${bx}" y="${P.t + innerH - h}" width="${bw}" height="${h}" rx="4" fill="#2e69a2"/>
      <text x="${bx + bw / 2}" y="${P.t + innerH - h - 4}" font-size="9" fill="#5a6a85" text-anchor="middle">${d.value ? fmtMoney(d.value) : ''}</text>`;
    labels += `<text x="${bx + bw / 2}" y="${H - 18}" font-size="9" fill="#8b97ad" text-anchor="middle">${esc((d.label || '').length > 9 ? d.label.slice(0, 9) + '…' : (d.label || ''))}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="bar chart">${bars}${labels}
    <line x1="${P.l}" y1="${P.t + innerH}" x2="${W - P.r}" y2="${P.t + innerH}" stroke="#c9d4e4"/></svg>`;
}

function svgHBar(data, opts) {
  opts = opts || {};
  const rowH = 30, W = 640;
  const H = data.length * rowH + 16;
  const max = Math.max(1, ...data.map(d => d.value));
  const barW = W * 0.52;
  let rows = '';
  data.forEach((d, i) => {
    const w = Math.max(2, (d.value / max) * barW);
    rows += `<text x="4" y="${i * rowH + 21}" font-size="11" fill="#1b2437">${esc(d.label.length > 24 ? d.label.slice(0, 24) + '…' : d.label)}</text>
      <rect x="${W * 0.46}" y="${i * rowH + 9}" width="${w}" height="15" rx="4" fill="${i % 2 ? '#2d9ed6' : '#213668'}"/>
      <text x="${W * 0.46 + w + 6}" y="${i * rowH + 21}" font-size="10.5" fill="#5a6a85">${fmtMoney(d.value)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="horizontal bar chart">${rows}</svg>`;
}

function svgDonut(data, opts) {
  opts = opts || {};
  const SIZE = 190, cx = SIZE / 2, cy = SIZE / 2, r = 66, rIn = 42;
  const total = Math.max(1, data.reduce((a, d) => a + d.value, 0));
  const colors = ['#213668', '#2d9ed6', '#2e69a2', '#7a5cc4', '#1d9e5c', '#c77d10', '#c2384d', '#8b97ad', '#5a9bd4', '#3f7fb5'];
  let seg = '', a0 = -Math.PI / 2;
  data.forEach((d, i) => {
    const frac = d.value / total;
    const a1 = a0 + frac * Math.PI * 2;
    if (frac > 0.0001) {
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const large = frac > 0.5 ? 1 : 0;
      seg += `<path d="M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${cx} ${cy} Z" fill="${colors[i % colors.length]}"/>`;
    }
    a0 = a1;
  });
  let legend = '';
  data.forEach((d, i) => {
    legend += `<div style="display:flex;align-items:center;gap:8px;font-size:12px;margin:4px 0">
      <span style="width:10px;height:10px;border-radius:3px;background:${colors[i % colors.length]};flex-shrink:0"></span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.label)}</span>
      <b>${fmtMoney(d.value)}${opts.count ? '' : ''}</b></div>`;
  });
  return `<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
    <svg viewBox="0 0 ${SIZE} ${SIZE}" style="width:${SIZE}px;flex-shrink:0" role="img" aria-label="donut chart">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e3e9f2" stroke-width="${r - rIn}"/>
      ${seg}
      <circle cx="${cx}" cy="${cy}" r="${rIn}" fill="#fff"/>
      <text x="${cx}" y="${cy - 2}" font-size="20" font-weight="800" fill="#213668" text-anchor="middle">${fmtMoney(total)}</text>
      <text x="${cx}" y="${cy + 14}" font-size="9.5" fill="#8b97ad" text-anchor="middle">${esc(opts.centerLabel || 'Total')}</text>
    </svg>
    <div style="flex:1;min-width:150px">${legend}</div></div>`;
}

function svgBarsGrouped(seriesA, seriesB, labels) {
  const W = 640, H = 220, P = { t: 12, r: 10, b: 40, l: 62 };
  const innerW = W - P.l - P.r, innerH = H - P.t - P.b;
  const max = Math.max(1, ...seriesA.map(d => d.value), ...seriesB.map(d => d.value));
  const n = Math.max(seriesA.length, seriesB.length);
  const step = innerW / n;
  const bw = Math.min(22, step * 0.32);
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = seriesA[i] ? seriesA[i].value : 0;
    const b = seriesB[i] ? seriesB[i].value : 0;
    const ha = a / max * innerH, hb = b / max * innerH;
    const xa = P.l + i * step + step / 2 - bw - 2;
    const xb = P.l + i * step + step / 2 + 2;
    out += `<rect x="${xa}" y="${P.t + innerH - ha}" width="${bw}" height="${ha}" rx="3" fill="#213668"/>` +
      `<rect x="${xb}" y="${P.t + innerH - hb}" width="${bw}" height="${hb}" rx="3" fill="#2d9ed6"/>` +
      `<text x="${xa + bw}" y="${H - 20}" font-size="8.5" fill="#8b97ad" text-anchor="middle">${esc((labels[i] || '').slice(0, 7))}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="grouped bar chart">${out}
    <line x1="${P.l}" y1="${P.t + innerH}" x2="${W - P.r}" y2="${P.t + innerH}" stroke="#c9d4e4"/>
    <rect x="${W - 170}" y="6" width="11" height="11" rx="3" fill="#213668"/><text x="${W - 154}" y="15" font-size="10" fill="#5a6a85">Revenue</text>
    <rect x="${W - 96}" y="6" width="11" height="11" rx="3" fill="#2d9ed6"/><text x="${W - 80}" y="15" font-size="10" fill="#5a6a85">Expenses</text></svg>`;
}

/* ==========================================================================
 * 7. Views
 * ========================================================================== */

const VIEWS = {};

/* ---------------------------------------------------------------- connect */

VIEWS.connect = () => {
  $('#main-content').innerHTML = `
  <div class="connect-screen">
    <div class="connect-card">
      <img src="icons/logo.png" alt="Dee Cleaners logo" class="brand-logo">
      <h1>Dee Cleaners</h1>
      <p class="sub">Connect the app to your Google Sheets business data.</p>
      <form id="connect-form">
        <div class="form-grid" style="grid-template-columns:1fr">
          <div class="field">
            <label>API URL <span class="req">*</span></label>
            <input id="c-api-url" type="url" placeholder="https://script.google.com/macros/s/…/exec"
                   value="${esc(getApiConfig().apiUrl)}">
            <span class="hint">The Apps Script Web App URL — see README.md.</span>
          </div>
          <div class="field">
            <label>API Key (optional)</label>
            <input id="c-api-key" type="password" placeholder="Only if you set DEE_CLEANERS_API_KEY"
                   value="${esc(getApiConfig().apiKey)}">
          </div>
        </div>
        <div style="margin-top:16px">
          <button class="btn btn-primary btn-lg btn-block" type="submit">Connect</button>
        </div>
      </form>
      <ol class="connect-steps">
        <li>Quick demo (no Google account): use <code>http://localhost:8787/api</code> with the mock server running.</li>
        <li>Real data: upload <code>Dee_Cleaners_Management.xlsx</code> to Google Sheets, paste <code>Code.gs</code> into Apps Script and deploy as a Web App.</li>
      </ol>
    </div>
  </div>`;
  $('#connect-form').addEventListener('submit', async e => {
    e.preventDefault();
    const url = val('c-api-url');
    if (!url) { setInvalid('c-api-url', true); return; }
    saveApiConfig(url, val('c-api-key'));
    settingsCache = null;
    try {
      await api('getSettings');
      toastOK('Connected ✓');
      location.hash = '#/dashboard';
      router();
    } catch (err) {
      toastErr(err.message);
      saveApiConfig('', getApiConfig().apiKey);
    }
  });
};

/* ---------------------------------------------------------------- dashboard */

VIEWS.dashboard = async () => {
  const main = $('#main-content');
  main.innerHTML = loadingHTML();
  try {
    const d = await api('getDashboard');
    const k = d.kpi, c = d.charts;
    main.innerHTML = `
    <div class="kpi-grid">
      ${kpiCard('Today Revenue', fmtMoneyTZS(k.todaySales), k.todayOrders + ' orders today', '')}
      ${kpiCard('This Month Revenue', fmtMoneyTZS(k.monthlyRevenue), '', 'accent')}
      ${kpiCard('This Month Expenses', fmtMoneyTZS(k.monthlyExpenses), '', 'warn')}
      ${kpiCard('This Month Profit', fmtMoneyTZS(k.monthlyProfit), '', k.monthlyProfit >= 0 ? 'ok' : 'danger')}
      ${kpiCard('Outstanding', fmtMoneyTZS(k.outstanding), '', 'danger')}
      ${kpiCard('Active Customers', k.activeCustomers, '', '')}
      ${kpiCard('Active Househelps', k.activeHousehelps, '', '')}
      ${kpiCard('Active Placements', k.activePlacements, '', '')}
      ${kpiCard('Open Complaints', k.openComplaints, k.replacementRequests + ' replacement requests', 'warn')}
    </div>
    <div class="grid-2">
      <div class="chart-box"><h4>Revenue — last 30 days</h4>${svgLine(c.revenueLast30Days, { money: true })}</div>
      <div class="chart-box"><h4>Profit — last 30 days</h4>${svgLine(c.profitLast30Days, { money: true })}</div>
      <div class="chart-box"><h4>Revenue by service</h4>${svgHBar((c.revenueByService || []).slice(0, 8))}</div>
      <div class="chart-box"><h4>Orders by status</h4>${svgDonut(c.ordersByStatus, { centerLabel: 'Orders' })}</div>
      <div class="chart-box"><h4>Payment status</h4>${svgDonut(c.paymentStatus, { centerLabel: 'Orders' })}</div>
      <div class="chart-box"><h4>Revenue by service category</h4>${svgDonut(c.revenueByServiceCategory, { centerLabel: 'TZS' })}</div>
      <div class="chart-box"><h4>Monthly revenue vs expenses</h4>${svgBarsGrouped(c.monthlyRevenue, c.monthlyExpenses, c.monthlyRevenue.map(x => x.month))}</div>
      <div class="chart-box"><h4>Househelp placements by status</h4>${svgDonut(c.placementsByStatus, { centerLabel: 'Placements' })}</div>
      <div class="chart-box"><h4>Househelp categories</h4>${svgHBar(c.househelpCategories || [])}</div>
      <div class="chart-box"><h4>Complaints by status</h4>${svgDonut(c.complaintsByStatus, { centerLabel: 'Complaints' })}</div>
      <div class="chart-box"><h4>Contract status</h4>${svgDonut(c.contractStatuses, { centerLabel: 'Contracts' })}</div>
      <div class="chart-box"><h4>Revenue by service (top)</h4>${svgBars((c.revenueByService || []).slice(0, 7), { money: false })}</div>
    </div>`;
  } catch (err) {
    main.innerHTML = errorHTML(err.message);
  }
};

function kpiCard(label, value, sub, cls) {
  return `<div class="kpi-card ${cls}"><span class="kpi-label">${esc(label)}</span>
    <span class="kpi-value">${esc(value)}</span>${sub ? `<span class="kpi-sub">${esc(sub)}</span>` : ''}</div>`;
}

/* ---------------------------------------------------------------- orders */

VIEWS.orders = async () => {
  const main = $('#main-content');
  main.innerHTML = loadingHTML();
  try {
    const [settings, orders] = await Promise.all([getSettings(), api('listOrders')]);
    const statuses = listNames('orderStatuses');
    const payStatuses = listNames('paymentStatuses');
    const cats = ['Cleaning', 'Sofa Cleaning', 'Laundry', 'Specialized', 'Other'];

    main.innerHTML = `
    <div class="card">
      ${toolbarHTML({
        searchPlaceholder: 'Search order ID, customer, phone, service…',
        filters: [
          { id: 'status', label: 'Order status', options: statuses },
          { id: 'pay', label: 'Payment status', options: payStatuses },
          { id: 'cat', label: 'Service category', options: cats }
        ],
        dates: true,
        actionLabel: 'New Order'
      })}
      <div class="table-wrap" id="orders-table"></div>
    </div>`;

    let page = 1;
    const PAGE = 12;
    const renderTable = (filtered) => {
      const tbody = filtered.slice((page - 1) * PAGE, page * PAGE);
      const box = $('#orders-table');
      if (!filtered.length) {
        box.innerHTML = emptyHTML('🧾', 'No orders found', 'Try changing the search or filters, or create a new order.');
        return;
      }
      box.innerHTML = `
      <table class="data">
        <thead><tr>
          <th>Order</th><th>Date</th><th>Customer</th><th>Service</th>
          <th class="num">Total</th><th class="num">Paid</th><th class="num">Balance</th>
          <th>Payment</th><th>Status</th><th></th>
        </tr></thead>
        <tbody>
          ${tbody.map(o => `
          <tr>
            <td class="nowrap"><span class="row-main">${esc(o.id)}</span></td>
            <td class="nowrap">${fmtDate(o.date)}</td>
            <td><span class="row-main">${esc(o.customerName)}</span><br><span class="row-sub">${esc(o.phone)}</span></td>
            <td><span class="row-main">${esc(o.service)}</span>${o.lineItems && o.lineItems.length > 1 ? '<br><span class="row-sub">' + esc(o.lineItems.length) + ' services</span>' : ''}</td>
            <td class="num">${fmtMoney(o.total)}</td>
            <td class="num">${fmtMoney(o.amountPaid)}</td>
            <td class="num">${o.balance > 0 ? '<b style="color:var(--danger)">' + fmtMoney(o.balance) + '</b>' : '—'}</td>
            <td>${badge(o.paymentStatus)}</td>
            <td>${badge(o.orderStatus)}</td>
            <td><div class="table-actions">
              <button class="icon-btn" title="Invoice" data-inv="${esc(o.id)}">🧾</button>
              <button class="icon-btn" title="Edit" data-edit="${esc(o.id)}">✏️</button>
              <button class="icon-btn" title="Delete (archive)" data-del="${esc(o.id)}">🗑️</button>
            </div></td>
          </tr>`).join('')}
        </tbody>
      </table>` + paginationHTML(page, Math.ceil(filtered.length / PAGE));
      bindPagination(box, filtered.length, PAGE, p => { page = p; renderTable(filtered); });
      $$('[data-inv]', box).forEach(b => b.addEventListener('click', () => location.hash = '#/invoices?order=' + b.dataset.inv));
      $$('[data-edit]', box).forEach(b => b.addEventListener('click', () => orderModal(b.dataset.edit)));
      $$('[data-del]', box).forEach(b => b.addEventListener('click', async () => {
        if (await confirmDialog('Delete order?', `Order ${b.dataset.del} will be archived (not permanently deleted).`, { danger: true, confirmText: 'Archive' })) {
          try {
            await api('deleteOrder', { orderId: b.dataset.del });
            toastOK('Order archived');
            VIEWS.orders();
          } catch (err) { toastErr(err.message); }
        }
      }));
    };

    const applyFilters = () => {
      const q = val('tb-search').toLowerCase();
      const fs = val('tb-filter-status'), fp = val('tb-filter-pay'), fc = val('tb-filter-cat');
      const from = val('tb-from'), to = val('tb-to');
      let rows = orders.filter(o => {
        if (q && !(o.id + ' ' + o.customerName + ' ' + o.phone + ' ' + o.email + ' ' + o.service + ' ' + o.description).toLowerCase().includes(q)) return false;
        if (fs && o.orderStatus !== fs) return false;
        if (fp && o.paymentStatus !== fp) return false;
        if (fc && categoryOf(o.service, settings) !== fc) return false;
        if (from && o.date < from) return false;
        if (to && o.date > to) return false;
        return true;
      });
      rows.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
      page = 1;
      renderTable(rows);
    };
    renderTable([...orders].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)));
    $('#tb-search').addEventListener('input', debounce(applyFilters, 250));
    ['tb-filter-status', 'tb-filter-pay', 'tb-filter-cat', 'tb-from', 'tb-to'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', applyFilters);
    });
    $('#tb-action').addEventListener('click', () => orderModal());
    if (currentRouteParams().new) orderModal();
  } catch (err) {
    main.innerHTML = errorHTML(err.message);
  }
};

function categoryOf(service, settings) {
  const s = String(service || '').toLowerCase();
  const find = list => (list || []).some(i => i.name.toLowerCase() === s);
  if (find(settings.lists.cleaningServices.items)) return 'Cleaning';
  if (find(settings.lists.sofaServices.items)) return 'Sofa Cleaning';
  if (find(settings.lists.laundryServices.items)) return 'Laundry';
  if (find(settings.lists.specializedServices.items)) return 'Specialized';
  if (/fumigation|gardening/.test(s)) return 'Specialized';
  if (/sofa/.test(s)) return 'Sofa Cleaning';
  return 'Other';
}

/** Service builder: dynamic rows with live totals. */
function orderModal(orderId) {
  const settingsP = getSettings();
  const customersP = api('listCustomers');
  Promise.all([settingsP, customersP, orderId ? api('listOrders', {}) : Promise.resolve([])])
    .then(([settings, customers, allOrders]) => {
      const order = orderId ? allOrders.find(o => o.id === orderId) : null;
      const serviceOptions = [];
      const pushGroup = (list, optLabel) => {
        list.forEach(i => serviceOptions.push({ name: i.name, min: i.minprice, max: i.maxprice, group: optLabel }));
      };
      pushGroup(settings.lists.cleaningServices.items, 'Cleaning');
      pushGroup(settings.lists.sofaServices.items, 'Sofa Cleaning');
      pushGroup(settings.lists.laundryServices.items, 'Laundry');
      pushGroup(settings.lists.specializedServices.items, 'Specialized');

      const lines = order && order.lineItems && order.lineItems.length ? order.lineItems : [];
      const m = openModal(order ? 'Edit Order ' + order.id : 'New Order', orderFormHTML(settings, customers, serviceOptions, order, lines), { size: 'lg' });

      const recalc = () => {
        let subtotal = 0;
        $$('#svc-rows .svc-row').forEach(row => {
          const q = Number(row.querySelector('.svc-qty').value) || 0;
          const p = Number(row.querySelector('.svc-price').value) || 0;
          subtotal += q * p;
        });
        const disc = valNum('o-discount');
        const transport = valNum('o-transport');
        const grand = Math.max(0, subtotal - disc);
        const paid = valNum('o-paid');
        $('#t-subtotal').textContent = fmtMoney(subtotal);
        $('#t-discount').textContent = fmtMoney(disc);
        $('#t-transport').textContent = fmtMoney(transport);
        $('#t-grand').textContent = fmtMoney(grand + transport);
        $('#t-paid').textContent = fmtMoney(paid);
        $('#t-balance').textContent = fmtMoney(Math.max(0, grand + transport - paid));
      };

      const addRow = (li) => {
        const row = document.createElement('div');
        row.className = 'svc-row';
        row.innerHTML = `
          <div class="field"><label>Service <span class="req">*</span></label>
            <input class="svc-name" list="svc-datalist" placeholder="Choose or type a service" value="${esc((li && li.service) || '')}"></div>
          <div class="field f-desc"><label>Description</label>
            <input class="svc-desc" placeholder="Optional details" value="${esc((li && li.description) || '')}"></div>
          <div class="field"><label>Qty</label>
            <input class="svc-qty" type="number" min="0" step="1" value="${esc((li && li.qty) || 1)}"></div>
          <div class="field"><label>Unit Price (TZS)</label>
            <input class="svc-price" type="number" min="0" step="500" value="${esc((li && li.unitPrice) || '')}" placeholder="0"></div>
          <button class="icon-btn rm" type="button" title="Remove service" style="color:var(--danger)">✕</button>`;
        row.querySelector('.rm').addEventListener('click', () => {
          if ($$('#svc-rows .svc-row').length > 1) { row.remove(); recalc(); }
          else toast('At least one service line is required', 'warn');
        });
        row.querySelector('.svc-name').addEventListener('change', e => {
          const svc = serviceOptions.find(s => s.name.toLowerCase() === e.target.value.trim().toLowerCase());
          const price = row.querySelector('.svc-price');
          if (svc && svc.min === svc.max && Number(svc.min) > 0 && !price.value) price.value = svc.min;
          else if (svc) price.placeholder = svc.min !== svc.max ? `${svc.min} – ${svc.max}` : (svc.min || 0);
          recalc();
        });
        ['input', 'change'].forEach(ev => row.querySelectorAll('input').forEach(i => i.addEventListener(ev, recalc)));
        $('#svc-rows').appendChild(row);
        recalc();
      };
      (lines.length ? lines : [null]).forEach(addRow);
      $('#svc-add').addEventListener('click', () => addRow(null));
      ['o-discount', 'o-transport', 'o-paid'].forEach(id => {
        document.getElementById(id).addEventListener('input', recalc);
      });
      $('#order-cancel').addEventListener('click', m.close);
      recalc();

      $('#order-save').addEventListener('click', async () => {
        const lineItems = $$('#svc-rows .svc-row').map(row => ({
          service: row.querySelector('.svc-name').value.trim(),
          description: row.querySelector('.svc-desc').value.trim(),
          qty: Math.max(0, valNumSafe(row.querySelector('.svc-qty').value)),
          unitPrice: Math.max(0, valNumSafe(row.querySelector('.svc-price').value))
        })).filter(li => li.service);
        const customerName = val('o-customer');
        if (!customerName) { setInvalid('o-customer', true); toastErr('Customer name is required'); return; }
        if (!lineItems.length) { toastErr('Add at least one service line'); return; }
        const payload = {
          date: val('o-date') || todayISO(),
          customerName, phone: val('o-phone'), email: val('o-email'),
          description: val('o-description'),
          discount: valNum('o-discount'), amountPaid: valNum('o-paid'),
          transportFee: valNum('o-transport'), directExpense: valNum('o-direct'),
          orderStatus: val('o-status'), notes: val('o-notes'),
          lineItems
        };
        if (lineItems.length === 1) {
          payload.service = lineItems[0].service;
          payload.description = payload.description || lineItems[0].description;
        } else {
          payload.service = 'Multiple Services';
        }
        try {
          const btn = $('#order-save');
          btn.disabled = true;
          if (order) await api('updateOrder', Object.assign({ orderId: order.id }, payload));
          else await api('createOrder', payload);
          m.close();
          toastOK(order ? 'Order updated' : 'Order created ✓');
          VIEWS.orders();
        } catch (err) { toastErr(err.message); }
      });
    })
    .catch(err => toastErr(err.message));
}

function valNumSafe(v) { const n = Number(v); return isFinite(n) ? n : 0; }

function orderFormHTML(settings, customers, serviceOptions, order, lines) {
  const names = [...new Set(customers.map(c => c.name))];
  const datalist = `<datalist id="svc-datalist">` +
    serviceOptions.map(s => `<option value="${esc(s.name)}">${esc(s.group)}</option>`).join('') +
    `</datalist><datalist id="cust-datalist">` +
    names.map(n => `<option value="${esc(n)}">`).join('') + `</datalist>`;
  return `${datalist}
  <div class="form-grid">
    <div class="field"><label>Date <span class="req">*</span></label>
      ${inputHTML('o-date', (order && order.date) || todayISO(), 'date')}</div>
    <div class="field"><label>Order Status</label>
      ${selectHTML('o-status', listNames('orderStatuses'), (order && order.orderStatus) || 'Pending')}</div>
    <div class="field"><label>Customer Name <span class="req">*</span></label>
      ${inputHTML('o-customer', order && order.customerName, 'text', 'Customer name', 'list="cust-datalist"')}</div>
    <div class="field"><label>Phone</label>${inputHTML('o-phone', order && order.phone, 'tel', '+255 …')}</div>
    <div class="field"><label>Email</label>${inputHTML('o-email', order && order.email, 'email', '')}</div>
    <div class="field"><label>Description</label>${inputHTML('o-description', order && order.description, 'text', 'Order notes / details')}</div>
  </div>
  <div style="margin:14px 0 6px"><b style="font-size:13px">Services</b>
    <span style="font-size:11.5px;color:var(--text-faint)"> — price ranges: enter the agreed price (e.g. Carpet 15,000 – 30,000)</span></div>
  <div id="svc-rows"></div>
  <button type="button" class="btn btn-outline btn-sm" id="svc-add">＋ Add Service</button>
  <div class="form-grid" style="margin-top:14px">
    <div class="field"><label>Discount (TZS)</label>${inputHTML('o-discount', order && order.discount || 0, 'number', '0', 'min="0"')}</div>
    <div class="field"><label>Transport Fee (TZS)</label>
      ${inputHTML('o-transport', order && order.transportFee || 0, 'number', '0', 'min="0"')}
      <span class="hint">Transport fees are paid by the customer.</span></div>
    <div class="field"><label>Amount Paid (TZS)</label>${inputHTML('o-paid', order && order.amountPaid || 0, 'number', '0', 'min="0"')}</div>
    <div class="field"><label>Direct Expense (TZS)</label>
      ${inputHTML('o-direct', order && order.directExpense || 0, 'number', '0', 'min="0"')}
      <span class="hint">Materials and other costs for this order.</span></div>
    <div class="field full"><label>Notes</label>${textareaHTML('o-notes', order && order.notes, 'Internal notes')}</div>
  </div>
  <div class="totals">
    <span class="t-label">Subtotal</span><span class="t-value" id="t-subtotal">0</span>
    <span class="t-label">Discount</span><span class="t-value" id="t-discount">0</span>
    <span class="t-label">Transport fee</span><span class="t-value" id="t-transport">0</span>
    <span class="t-label">Amount paid</span><span class="t-value" id="t-paid">0</span>
    <div class="grand"><span class="t-label">Grand Total / Balance Due</span>
      <span class="t-value"><span id="t-grand">0</span> / <span id="t-balance" style="color:var(--danger)">0</span></span></div>
  </div>
  <div class="modal-foot" style="padding:14px 0 0">
    <button class="btn btn-ghost" id="order-cancel">Cancel</button>
    <button class="btn btn-primary" id="order-save">${order ? 'Save Changes' : 'Create Order'}</button>
  </div>`;
}

/* ---------------------------------------------------------------- customers */

VIEWS.customers = async () => {
  const main = $('#main-content');
  const params = currentRouteParams();
  if (params.name) return customerProfile(params.name);
  main.innerHTML = loadingHTML();
  try {
    const customers = await api('listCustomers');
    main.innerHTML = `<div class="card">
      ${toolbarHTML({ searchPlaceholder: 'Search name, phone, email…' })}
      <div class="table-wrap" id="cust-table"></div>
    </div>`;
    const box = $('#cust-table');
    let page = 1;
    const PAGE = 12;
    const renderTable = rows => {
      const slice = rows.slice((page - 1) * PAGE, page * PAGE);
      if (!rows.length) return box.innerHTML = emptyHTML('👥', 'No customers yet', 'Customers appear automatically from orders.');
      box.innerHTML = `
      <table class="data"><thead><tr>
        <th>Customer</th><th>Phone</th><th class="num">Orders</th>
        <th class="num">Total Spending</th><th class="num">Paid</th><th class="num">Balance</th>
        <th>Last Service</th><th>Status</th>
      </tr></thead><tbody>
      ${slice.map(c => `<tr class="clickable" data-cust="${esc(c.name)}">
        <td><span class="row-main">${esc(c.name)}</span>${c.email ? `<br><span class="row-sub">${esc(c.email)}</span>` : ''}</td>
        <td>${esc(c.phone)}</td>
        <td class="num">${c.orderCount}</td>
        <td class="num">${fmtMoney(c.totalSpending)}</td>
        <td class="num">${fmtMoney(c.totalPaid)}</td>
        <td class="num">${c.balance > 0 ? '<b style="color:var(--danger)">' + fmtMoney(c.balance) + '</b>' : '—'}</td>
        <td class="nowrap">${fmtDate(c.lastServiceDate)}</td>
        <td>${badge(c.status)}</td>
      </tr>`).join('')}
      </tbody></table>` + paginationHTML(page, Math.ceil(rows.length / PAGE));
      bindPagination(box, rows.length, PAGE, p => { page = p; renderTable(rows); });
      $$('[data-cust]', box).forEach(tr => tr.addEventListener('click', () =>
        location.hash = '#/customers?name=' + encodeURIComponent(tr.dataset.cust)));
    };
    const apply = () => {
      const q = val('tb-search').toLowerCase();
      let rows = customers;
      if (q) rows = rows.filter(c => (c.name + ' ' + c.phone + ' ' + c.email).toLowerCase().includes(q));
      rows = [...rows].sort((a, b) => b.totalSpending - a.totalSpending);
      page = 1;
      renderTable(rows);
    };
    apply();
    $('#tb-search').addEventListener('input', debounce(apply, 250));
  } catch (err) { main.innerHTML = errorHTML(err.message); }
};

async function customerProfile(name) {
  const main = $('#main-content');
  main.innerHTML = loadingHTML();
  try {
    const [customer, settings] = await Promise.all([api('getCustomer', { name }), getSettings()]);
    const payments = (await api('listPayments')).filter(p => p.customer === customer.name);
    const servicesUsed = {};
    customer.orders.forEach(o => {
      const lines = o.lineItems && o.lineItems.length ? o.lineItems.map(l => l.service) : [o.service];
      lines.forEach(s => { servicesUsed[s] = (servicesUsed[s] || 0) + 1; });
    });
    main.innerHTML = `
    <div class="card no-print"><button class="btn btn-outline btn-sm" onclick="backOr('#/customers')">← Back</button></div>
    <div class="card">
      <div class="profile-head">
        <div class="avatar">${esc(initials(customer.name))}</div>
        <div>
          <h2 style="font-size:18px">${esc(customer.name)}</h2>
          <div style="color:var(--text-soft);font-size:12.5px">${esc(customer.phone)}${customer.email ? ' · ' + esc(customer.email) : ''}</div>
          <div style="margin-top:4px">${badge(customer.status)}</div>
        </div>
      </div>
      <div class="kpi-grid" style="margin-bottom:0">
        ${kpiCard('Orders', customer.orderCount, '', '')}
        ${kpiCard('Total Spending', fmtMoneyTZS(customer.totalSpending), '', 'accent')}
        ${kpiCard('Total Paid', fmtMoneyTZS(customer.totalPaid), '', 'ok')}
        ${kpiCard('Outstanding Balance', fmtMoneyTZS(customer.balance), '', customer.balance > 0 ? 'danger' : '')}
        ${kpiCard('Last Service', fmtDateLong(customer.lastServiceDate), '', '')}
      </div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><span class="card-title">Order history</span></div>
        <div class="table-wrap"><table class="data"><thead><tr>
          <th>Order</th><th>Date</th><th>Service</th><th class="num">Total</th><th>Status</th>
        </tr></thead><tbody>
        ${customer.orders.map(o => `<tr>
          <td>${esc(o.id)}</td><td class="nowrap">${fmtDate(o.date)}</td>
          <td>${esc(o.service)}${o.lineItems && o.lineItems.length > 1 ? `<br><span class="row-sub">${o.lineItems.map(l => esc(l.service)).join(', ')}</span>` : ''}</td>
          <td class="num">${fmtMoney(o.total)}</td><td>${badge(o.orderStatus)}</td>
        </tr>`).join('') || '<tr><td colspan="5">No orders</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="card">
        <div class="card-head"><span class="card-title">Payment history</span></div>
        <div class="table-wrap"><table class="data"><thead><tr>
          <th>ID</th><th>Date</th><th class="num">Amount</th><th>Method</th>
        </tr></thead><tbody>
        ${payments.map(p => `<tr><td>${esc(p.id)}</td><td class="nowrap">${fmtDate(p.date)}</td>
          <td class="num">${fmtMoney(p.amount)}</td><td>${esc(p.method)}</td></tr>`).join('') || '<tr><td colspan="4">No payments recorded</td></tr>'}
        </tbody></table></div>
        <div class="card-head" style="margin-top:14px"><span class="card-title">Services used</span></div>
        <div style="display:flex;flex-wrap:wrap;gap:7px">
          ${Object.entries(servicesUsed).map(([s, n]) => `<span class="badge info">${esc(s)} × ${n}</span>`).join('') || '<span style="color:var(--text-faint)">None yet</span>'}
        </div>
      </div>
    </div>`;
  } catch (err) { main.innerHTML = errorHTML(err.message); }
}

/* ---------------------------------------------------------------- payments */

VIEWS.payments = async () => {
  const main = $('#main-content');
  main.innerHTML = loadingHTML();
  try {
    const [settings, payments, orders] = await Promise.all([getSettings(), api('listPayments'), api('listOrders')]);
    const methods = listNames('paymentMethods');
    main.innerHTML = `<div class="card">
      ${toolbarHTML({ searchPlaceholder: 'Search payment, customer, order, reference…', actionLabel: 'Record Payment' })}
      <div class="table-wrap" id="pay-table"></div>
    </div>`;
    const box = $('#pay-table');
    let page = 1; const PAGE = 12;
    const renderTable = rows => {
      const slice = rows.slice((page - 1) * PAGE, page * PAGE);
      if (!rows.length) return box.innerHTML = emptyHTML('💵', 'No payments recorded', 'Record customer payments here — they update the order balance automatically.');
      box.innerHTML = `<table class="data"><thead><tr>
        <th>Payment</th><th>Date</th><th>Customer</th><th>Order</th>
        <th class="num">Amount</th><th>Method</th><th>Received By</th><th></th>
      </tr></thead><tbody>
      ${slice.map(p => `<tr>
        <td class="nowrap"><span class="row-main">${esc(p.id)}</span>${p.reference ? `<br><span class="row-sub">${esc(p.reference)}</span>` : ''}</td>
        <td class="nowrap">${fmtDate(p.date)}</td>
        <td><span class="row-main">${esc(p.customer)}</span></td>
        <td>${esc(p.orderId)}</td>
        <td class="num"><b>${fmtMoney(p.amount)}</b></td>
        <td>${esc(p.method)}</td><td>${esc(p.receivedBy)}</td>
        <td><div class="table-actions">
          <button class="icon-btn" title="Receipt" data-rcpt="${esc(p.id)}">🧾</button>
          <button class="icon-btn" title="Edit" data-edit="${esc(p.id)}">✏️</button>
          <button class="icon-btn" title="Delete" data-del="${esc(p.id)}">🗑️</button>
        </div></td>
      </tr>`).join('')}
      </tbody></table>` + paginationHTML(page, Math.ceil(rows.length / PAGE));
      bindPagination(box, rows.length, PAGE, p => { page = p; renderTable(rows); });
      $$('[data-rcpt]', box).forEach(b => b.addEventListener('click', () => location.hash = '#/receipts?payment=' + b.dataset.rcpt));
      $$('[data-edit]', box).forEach(b => b.addEventListener('click', () => paymentModal(b.dataset.edit, payments, orders, methods)));
      $$('[data-del]', box).forEach(b => b.addEventListener('click', async () => {
        if (await confirmDialog('Delete payment?', `Payment ${b.dataset.del} will be removed and the order balance adjusted.`, { danger: true })) {
          try { await api('deletePayment', { paymentId: b.dataset.del }); toastOK('Payment deleted'); VIEWS.payments(); }
          catch (err) { toastErr(err.message); }
        }
      }));
    };
    const apply = () => {
      const q = val('tb-search').toLowerCase();
      let rows = payments;
      if (q) rows = rows.filter(p => (p.id + ' ' + p.customer + ' ' + p.orderId + ' ' + p.reference + ' ' + p.method).toLowerCase().includes(q));
      rows = [...rows].sort((a, b) => b.date.localeCompare(a.date));
      page = 1; renderTable(rows);
    };
    apply();
    $('#tb-search').addEventListener('input', debounce(apply, 250));
    $('#tb-action').addEventListener('click', () => paymentModal(null, payments, orders, methods));
  } catch (err) { main.innerHTML = errorHTML(err.message); }
};

function paymentModal(paymentId, payments, orders, methods) {
  const p = paymentId ? payments.find(x => x.id === paymentId) : null;
  const orderOptions = orders.map(o => o.id);
  const m = openModal(p ? 'Edit Payment ' + p.id : 'Record Payment', `
    <div class="form-grid">
      <div class="field"><label>Date <span class="req">*</span></label>${inputHTML('p-date', (p && p.date) || todayISO(), 'date')}</div>
      <div class="field"><label>Amount (TZS) <span class="req">*</span></label>${inputHTML('p-amount', p && p.amount, 'number', '0', 'min="0"')}</div>
      <div class="field"><label>Customer</label>${inputHTML('p-customer', p && p.customer, 'text', 'Customer name')}</div>
      <div class="field"><label>Order ID</label>
        <input id="p-order" list="order-datalist" value="${esc(p && p.orderId || '')}" placeholder="DC-0001">
        <datalist id="order-datalist">${orderOptions.map(o => `<option value="${esc(o)}">`).join('')}</datalist></div>
      <div class="field"><label>Payment Method</label>${selectHTML('p-method', methods, p && p.method)}</div>
      <div class="field"><label>Reference</label>${inputHTML('p-ref', p && p.reference, 'text', 'Transaction ref.')}</div>
      <div class="field"><label>Received By</label>${inputHTML('p-by', p && p.receivedBy, 'text', '')}</div>
      <div class="field"><label>Notes</label>${inputHTML('p-notes', p && p.notes, 'text', '')}</div>
    </div>
    <p class="hint" style="font-size:11.5px;color:var(--text-faint);margin-top:10px">Recording a payment updates the linked order's Amount Paid and Balance automatically.</p>
    <div class="modal-foot" style="padding:14px 0 0">
      <button class="btn btn-ghost" id="p-cancel">Cancel</button>
      <button class="btn btn-primary" id="p-save">${p ? 'Save' : 'Record Payment'}</button>
    </div>`);
  $('#p-cancel').addEventListener('click', m.close);
  $('#p-save').addEventListener('click', async () => {
    const amount = valNum('p-amount');
    if (amount <= 0) { setInvalid('p-amount', true); toastErr('Amount must be greater than 0'); return; }
    const payload = {
      date: val('p-date') || todayISO(), amount, customer: val('p-customer'),
      orderId: val('p-order'), method: val('p-method'), reference: val('p-ref'),
      receivedBy: val('p-by'), notes: val('p-notes')
    };
    if (!payload.customer && !payload.orderId) { toastErr('Customer or Order ID is required'); return; }
    try {
      if (p) await api('updatePayment', Object.assign({ paymentId: p.id }, payload));
      else await api('createPayment', payload);
      m.close(); toastOK('Payment recorded ✓'); VIEWS.payments();
    } catch (err) { toastErr(err.message); }
  });
}

/* ---------------------------------------------------------------- expenses */

VIEWS.expenses = async () => {
  const main = $('#main-content');
  main.innerHTML = loadingHTML();
  try {
    const [settings, expenses] = await Promise.all([getSettings(), api('listExpenses')]);
    const cats = listNames('expenseCategories');
    const methods = listNames('paymentMethods');
    main.innerHTML = `<div class="card">
      ${toolbarHTML({
        searchPlaceholder: 'Search description, category…',
        filters: [{ id: 'cat', label: 'Category', options: cats }],
        dates: true, actionLabel: 'Add Expense'
      })}
      <div class="table-wrap" id="exp-table"></div>
    </div>`;
    const box = $('#exp-table');
    let page = 1; const PAGE = 12;
    const renderTable = rows => {
      const slice = rows.slice((page - 1) * PAGE, page * PAGE);
      if (!rows.length) return box.innerHTML = emptyHTML('💸', 'No expenses recorded', 'Record transport, materials, salaries and other business costs.');
      box.innerHTML = `<table class="data"><thead><tr>
        <th>Expense</th><th>Date</th><th>Category</th><th>Description</th>
        <th class="num">Amount</th><th>Method</th><th>Related Service</th><th></th>
      </tr></thead><tbody>
      ${slice.map(x => `<tr>
        <td class="nowrap">${esc(x.id)}</td>
        <td class="nowrap">${fmtDate(x.date)}</td>
        <td><span class="badge neutral">${esc(x.category)}</span></td>
        <td>${esc(x.description)}</td>
        <td class="num">${fmtMoney(x.amount)}</td>
        <td>${esc(x.method)}</td><td>${esc(x.relatedService)}</td>
        <td><div class="table-actions">
          <button class="icon-btn" data-edit="${esc(x.id)}">✏️</button>
          <button class="icon-btn" data-del="${esc(x.id)}">🗑️</button>
        </div></td>
      </tr>`).join('')}
      </tbody></table>` + paginationHTML(page, Math.ceil(rows.length / PAGE));
      bindPagination(box, rows.length, PAGE, p => { page = p; renderTable(rows); });
      $$('[data-edit]', box).forEach(b => b.addEventListener('click', () => expenseModal(b.dataset.edit, expenses, cats, methods)));
      $$('[data-del]', box).forEach(b => b.addEventListener('click', async () => {
        if (await confirmDialog('Delete expense?', `Expense ${b.dataset.del} will be removed.`, { danger: true })) {
          try { await api('deleteExpense', { expenseId: b.dataset.del }); toastOK('Expense deleted'); VIEWS.expenses(); }
          catch (err) { toastErr(err.message); }
        }
      }));
    };
    const apply = () => {
      const q = val('tb-search').toLowerCase();
      const fc = val('tb-filter-cat');
      const from = val('tb-from'), to = val('tb-to');
      let rows = expenses.filter(x => {
        if (q && !(x.description + ' ' + x.category + ' ' + x.relatedService + ' ' + x.id).toLowerCase().includes(q)) return false;
        if (fc && x.category !== fc) return false;
        if (from && x.date < from) return false;
        if (to && x.date > to) return false;
        return true;
      });
      rows.sort((a, b) => b.date.localeCompare(a.date));
      page = 1; renderTable(rows);
    };
    apply();
    $('#tb-search').addEventListener('input', debounce(apply, 250));
    ['tb-filter-cat', 'tb-from', 'tb-to'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('change', apply); });
    $('#tb-action').addEventListener('click', () => expenseModal(null, expenses, cats, methods));
  } catch (err) { main.innerHTML = errorHTML(err.message); }
};

function expenseModal(expenseId, expenses, cats, methods) {
  const x = expenseId ? expenses.find(e => e.id === expenseId) : null;
  const m = openModal(x ? 'Edit Expense ' + x.id : 'Add Expense', `
    <div class="form-grid">
      <div class="field"><label>Date <span class="req">*</span></label>${inputHTML('x-date', (x && x.date) || todayISO(), 'date')}</div>
      <div class="field"><label>Amount (TZS) <span class="req">*</span></label>${inputHTML('x-amount', x && x.amount, 'number', '0', 'min="0"')}</div>
      <div class="field"><label>Category</label>${selectHTML('x-cat', cats, x && x.category, 'Other')}</div>
      <div class="field"><label>Payment Method</label>${selectHTML('x-method', methods, x && x.method)}</div>
      <div class="field"><label>Description <span class="req">*</span></label>${inputHTML('x-desc', x && x.description, 'text', 'What was the money used for?')}</div>
      <div class="field"><label>Related Service</label>${inputHTML('x-rel', x && x.relatedService, 'text', '')}</div>
      <div class="field full"><label>Notes</label>${textareaHTML('x-notes', x && x.notes, '')}</div>
    </div>
    <div class="modal-foot" style="padding:14px 0 0">
      <button class="btn btn-ghost" id="x-cancel">Cancel</button>
      <button class="btn btn-primary" id="x-save">${x ? 'Save' : 'Add Expense'}</button>
    </div>`);
  $('#x-cancel').addEventListener('click', m.close);
  $('#x-save').addEventListener('click', async () => {
    const desc = val('x-desc');
    if (!desc) { setInvalid('x-desc', true); toastErr('Description is required'); return; }
    const payload = {
      date: val('x-date') || todayISO(), amount: valNum('x-amount'),
      category: val('x-cat') || 'Other', method: val('x-method'),
      description: desc, relatedService: val('x-rel'), notes: val('x-notes')
    };
    try {
      if (x) await api('updateExpense', Object.assign({ expenseId: x.id }, payload));
      else await api('addExpense', payload);
      m.close(); toastOK('Expense saved ✓'); VIEWS.expenses();
    } catch (err) { toastErr(err.message); }
  });
}

/* ---------------------------------------------------------------- househelps */

VIEWS.househelps = async () => {
  const main = $('#main-content');
  const params = currentRouteParams();
  if (params.id) return househelpProfile(params.id);
  main.innerHTML = loadingHTML();
  try {
    const [settings, househelps, placements, employers] = await Promise.all([
      getSettings(), api('listHousehelps'), api('listPlacements'), api('listEmployers')
    ]);
    const statuses = listNames('househelpStatuses');
    const counts = {
      total: househelps.length,
      available: househelps.filter(h => h.status === 'Available').length,
      placed: househelps.filter(h => h.status === 'Placed' || h.status === 'On Contract').length,
      onContract: househelps.filter(h => h.status === 'On Contract').length,
      inactive: househelps.filter(h => h.status === 'Inactive').length,
      replacement: househelps.filter(h => h.status === 'Replacement Required').length
    };
    main.innerHTML = `
    <div class="kpi-grid">
      ${kpiCard('Total Househelps', counts.total, '', '')}
      ${kpiCard('Available', counts.available, '', 'ok')}
      ${kpiCard('Placed', counts.placed, '', 'info')}
      ${kpiCard('On Contract', counts.onContract, '', 'violet')}
      ${kpiCard('Inactive', counts.inactive, '', 'neutral')}
      ${kpiCard('Replacement Required', counts.replacement, '', 'danger')}
    </div>
    <div class="card">
      ${toolbarHTML({
        searchPlaceholder: 'Search name, phone, skills…',
        filters: [{ id: 'status', label: 'Status', options: statuses }],
        actionLabel: 'Register Househelp'
      })}
      <div class="table-wrap" id="hh-table"></div>
    </div>`;
    const box = $('#hh-table');
    let page = 1; const PAGE = 12;
    const empName = id => { const e = employers.find(x => x.id === id); return e ? e.fullName : ''; };
    const renderTable = rows => {
      const slice = rows.slice((page - 1) * PAGE, page * PAGE);
      if (!rows.length) return box.innerHTML = emptyHTML('🏠', 'No househelps registered', 'Register househelps to start matching them with employers.');
      box.innerHTML = `<table class="data"><thead><tr>
        <th>ID</th><th>Name</th><th>Phone</th><th>Gender</th>
        <th>Availability</th><th>Current Employer</th><th>Status</th><th></th>
      </tr></thead><tbody>
      ${slice.map(h => {
        const p = placements.find(pl => pl.househelpId === h.id && ['Active', 'Pending', 'Matching', 'Contract Pending', 'Replacement Required'].includes(pl.status));
        return `<tr class="clickable" data-hh="${esc(h.id)}">
          <td>${esc(h.id)}</td>
          <td><span class="row-main">${esc(h.fullName)}</span><br><span class="row-sub">${esc(h.skills || '')}</span></td>
          <td>${esc(h.phone)}</td>
          <td>${esc(h.gender)}</td>
          <td>${esc(h.availability)}</td>
          <td>${p ? esc(p.employerName) : '—'}</td>
          <td>${badge(h.status)}</td>
          <td><div class="table-actions">
            <button class="icon-btn" title="Edit" data-edit="${esc(h.id)}">✏️</button>
            <button class="icon-btn" title="Archive (set inactive)" data-arch="${esc(h.id)}">📦</button>
          </div></td>
        </tr>`;
      }).join('')}
      </tbody></table>` + paginationHTML(page, Math.ceil(rows.length / PAGE));
      bindPagination(box, rows.length, PAGE, p => { page = p; renderTable(rows); });
      $$('[data-hh]', box).forEach(tr => tr.addEventListener('click', () =>
        location.hash = '#/househelps?id=' + encodeURIComponent(tr.dataset.hh)));
      $$('[data-edit]', box).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); househelpModal(b.dataset.edit, househelps); }));
      $$('[data-arch]', box).forEach(b => b.addEventListener('click', async e => {
        e.stopPropagation();
        if (await confirmDialog('Archive househelp?', 'The househelp will be marked Inactive (records are kept).', { danger: true })) {
          try { await api('archiveHousehelp', { househelpId: b.dataset.arch }); toastOK('Househelp archived'); VIEWS.househelps(); }
          catch (err) { toastErr(err.message); }
        }
      }));
    };
    const apply = () => {
      const q = val('tb-search').toLowerCase();
      const fs = val('tb-filter-status');
      let rows = househelps.filter(h => {
        if (q && !(h.fullName + ' ' + h.phone + ' ' + h.skills + ' ' + h.id).toLowerCase().includes(q)) return false;
        if (fs && h.status !== fs) return false;
        return true;
      });
      page = 1; renderTable(rows);
    };
    apply();
    $('#tb-search').addEventListener('input', debounce(apply, 250));
    $('#tb-filter-status').addEventListener('change', apply);
    $('#tb-action').addEventListener('click', () => househelpModal(null, househelps));
  } catch (err) { main.innerHTML = errorHTML(err.message); }
};

function househelpModal(id, househelps) {
  getSettings().then(settings => {
    const h = id ? househelps.find(x => x.id === id) : null;
    const m = openModal(h ? 'Edit ' + h.fullName : 'Register Househelp', `
    <div class="form-grid">
      <div class="field"><label>Full Name <span class="req">*</span></label>${inputHTML('h-name', h && h.fullName, 'text')}</div>
      <div class="field"><label>Phone</label>${inputHTML('h-phone', h && h.phone, 'tel', '+255 …')}</div>
      <div class="field"><label>Email</label>${inputHTML('h-email', h && h.email, 'email')}</div>
      <div class="field"><label>Gender</label>${selectHTML('h-gender', ['Male', 'Female'], h && h.gender)}</div>
      <div class="field"><label>Nationality</label>${inputHTML('h-nation', h && h.nationality, 'text', 'Tanzanian')}</div>
      <div class="field"><label>Occupation</label>${inputHTML('h-occ', h && h.occupation, 'text')}</div>
      <div class="field"><label>NIDA Number</label>${inputHTML('h-nida', h && h.nida, 'text')}</div>
      <div class="field"><label>City/Country</label>${inputHTML('h-city', h && h.cityCountry, 'text')}</div>
      <div class="field"><label>Home Address</label>${inputHTML('h-addr', h && h.homeAddress, 'text')}</div>
      <div class="field"><label>Registration Date</label>${inputHTML('h-reg', (h && h.registrationDate) || todayISO(), 'date')}</div>
      <div class="field"><label>Status</label>${selectHTML('h-status', listNames('househelpStatuses'), (h && h.status) || 'Available')}</div>
      <div class="field"><label>Skills</label>${inputHTML('h-skills', h && h.skills, 'text', 'Cleaning, cooking…')}</div>
      <div class="field"><label>Experience</label>${inputHTML('h-exp', h && h.experience, 'text', 'e.g. 2 years')}</div>
      <div class="field"><label>Availability</label>${selectHTML('h-avail', ['Live-in', 'Live-out', 'Live-in or live-out'], h && h.availability)}</div>
      <div class="field full"><label>Notes</label>${textareaHTML('h-notes', h && h.notes, '')}</div>
    </div>
    <div class="modal-foot" style="padding:14px 0 0">
      <button class="btn btn-ghost" id="h-cancel">Cancel</button>
      <button class="btn btn-primary" id="h-save">${h ? 'Save' : 'Register'}</button>
    </div>`);
    $('#h-cancel').addEventListener('click', m.close);
    $('#h-save').addEventListener('click', async () => {
      const name = val('h-name');
      if (!name) { setInvalid('h-name', true); toastErr('Full name is required'); return; }
      const payload = {
        fullName: name, phone: val('h-phone'), email: val('h-email'),
        gender: val('h-gender'), nationality: val('h-nation'),
        occupation: val('h-occ'), nida: val('h-nida'), cityCountry: val('h-city'),
        homeAddress: val('h-addr'), registrationDate: val('h-reg') || todayISO(),
        status: val('h-status') || 'Available', skills: val('h-skills'),
        experience: val('h-exp'), availability: val('h-avail'), notes: val('h-notes')
      };
      try {
        if (h) await api('updateHousehelp', Object.assign({ househelpId: h.id }, payload));
        else await api('createHousehelp', payload);
        m.close(); toastOK('Househelp saved ✓'); VIEWS.househelps();
      } catch (err) { toastErr(err.message); }
    });
  });
}

async function househelpProfile(id) {
  const main = $('#main-content');
  main.innerHTML = loadingHTML();
  try {
    const [househelps, employers, placements, contracts, hhPayments, complaints, replacements, settings] = await Promise.all([
      api('listHousehelps'), api('listEmployers'), api('listPlacements'), api('listContracts'),
      api('listHousehelpPayments'), api('listComplaints'), api('listReplacements'), getSettings()
    ]);
    const h = househelps.find(x => x.id === id);
    if (!h) throw new Error('Househelp not found');
    const myPlacements = placements.filter(p => p.househelpId === id);
    const myPayments = hhPayments.filter(p => p.househelpId === id);
    const myContracts = contracts.filter(c => c.househelp === h.fullName);
    const myComplaints = complaints.filter(c => c.househelp === h.fullName);
    const myReplacements = replacements.filter(r => r.originalHousehelp === h.fullName);
    main.innerHTML = `
    <div class="card no-print"><button class="btn btn-outline btn-sm" onclick="backOr('#/househelps')">← Back</button></div>
    <div class="card">
      <div class="profile-head">
        <div class="avatar">${esc(initials(h.fullName))}</div>
        <div style="flex:1">
          <h2 style="font-size:18px">${esc(h.fullName)} <span style="font-size:12px;color:var(--text-faint)">${esc(h.id)}</span></h2>
          <div style="color:var(--text-soft);font-size:12.5px">${esc(h.phone)}${h.email ? ' · ' + esc(h.email) : ''}</div>
          <div style="margin-top:4px">${badge(h.status)}</div>
        </div>
        <button class="btn btn-outline btn-sm" id="hh-edit">✏️ Edit</button>
      </div>
      <div class="detail-grid">
        ${detail('Gender', h.gender)}${detail('Nationality', h.nationality)}
        ${detail('Occupation', h.occupation)}${detail('NIDA Number', h.nida)}
        ${detail('City/Country', h.cityCountry)}${detail('Home Address', h.homeAddress)}
        ${detail('Registered', fmtDate(h.registrationDate))}${detail('Availability', h.availability)}
        ${detail('Skills', h.skills)}${detail('Experience', h.experience)}
      </div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><span class="card-title">Placement history</span></div>
        <div class="table-wrap"><table class="data"><thead><tr>
          <th>Placement</th><th>Employer</th><th>Salary</th><th>Status</th>
        </tr></thead><tbody>
        ${myPlacements.map(p => `<tr><td>${esc(p.id)}</td><td>${esc(p.employerName)}</td>
          <td class="num">${fmtMoney(p.salary)}</td><td>${badge(p.status)}</td></tr>`).join('') || '<tr><td colspan="4">No placements</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="card"><div class="card-head">
        <span class="card-title">Payment history</span>
        <button class="btn btn-primary btn-sm" id="hhp-add">＋ Record Salary Payment</button>
      </div>
        <div class="table-wrap"><table class="data"><thead><tr>
          <th>ID</th><th>Date</th><th>Period</th><th class="num">Amount</th><th>Status</th><th></th>
        </tr></thead><tbody>
        ${myPayments.map(p => `<tr><td class="nowrap">${esc(p.id)}</td><td class="nowrap">${fmtDate(p.paymentDate)}</td><td>${esc(p.period)}</td>
          <td class="num">${fmtMoney(p.amount)}</td><td>${badge(p.status)}</td>
          <td><div class="table-actions"><button class="icon-btn" title="Edit" data-hhp-edit="${esc(p.id)}">✏️</button></div></td></tr>`).join('') || '<tr><td colspan="6">No payments</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="card"><div class="card-head"><span class="card-title">Contracts</span></div>
        <div class="table-wrap"><table class="data"><thead><tr>
          <th>Contract</th><th>Employer</th><th>Start</th><th>Status</th>
        </tr></thead><tbody>
        ${myContracts.map(c => `<tr><td>${esc(c.id)}</td><td>${esc(c.employer)}</td>
          <td>${fmtDate(c.startDate)}</td><td>${badge(c.status)}</td></tr>`).join('') || '<tr><td colspan="4">No contracts</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="card"><div class="card-head"><span class="card-title">Complaints</span></div>
        <div class="table-wrap"><table class="data"><thead><tr>
          <th>Date</th><th>Type</th><th>Status</th>
        </tr></thead><tbody>
        ${myComplaints.map(c => `<tr><td>${fmtDate(c.date)}</td><td>${esc(c.type)}</td><td>${badge(c.status)}</td></tr>`).join('') || '<tr><td colspan="3">No complaints</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="card"><div class="card-head"><span class="card-title">Replacement history</span></div>
        <div class="table-wrap"><table class="data"><thead><tr>
          <th>Request</th><th>Employer</th><th>Status</th>
        </tr></thead><tbody>
        ${myReplacements.map(r => `<tr><td>${esc(r.id)}</td><td>${esc(r.employer)}</td><td>${badge(r.status)}</td></tr>`).join('') || '<tr><td colspan="3">No replacements</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="card"><div class="card-head"><span class="card-title">Notes & documents</span></div>
        <p style="font-size:13px;color:var(--text-soft)">${esc(h.notes || 'No notes recorded.')}</p>
      </div>
    </div>`;
    $('#hh-edit').addEventListener('click', () => househelpModal(id, househelps));
    $('#hhp-add').addEventListener('click', () => househelpPaymentModal(null,
      { househelps, employers, placements, settings, preset: { househelpId: id } },
      () => househelpProfile(id)));
    $$('[data-hhp-edit]', main).forEach(b => b.addEventListener('click', () => {
      const pay = myPayments.find(x => x.id === b.dataset.hhpEdit);
      househelpPaymentModal(pay, { househelps, employers, placements, settings }, () => househelpProfile(id));
    }));
  } catch (err) { main.innerHTML = errorHTML(err.message); }
}

const detail = (label, value) => `<div class="detail-item"><div class="d-label">${esc(label)}</div><div class="d-value">${esc(value || '—')}</div></div>`;

/* ---------------------------------------------------------------- employers */

VIEWS.employers = async () => {
  const main = $('#main-content');
  const params = currentRouteParams();
  if (params.id) return employerProfile(params.id);
  main.innerHTML = loadingHTML();
  try {
    const [employers, placements] = await Promise.all([api('listEmployers'), api('listPlacements')]);
    main.innerHTML = `<div class="card">
      ${toolbarHTML({ searchPlaceholder: 'Search name, phone, city…', actionLabel: 'Register Employer' })}
      <div class="table-wrap" id="emp-table"></div>
    </div>`;
    const box = $('#emp-table');
    let page = 1; const PAGE = 12;
    const renderTable = rows => {
      const slice = rows.slice((page - 1) * PAGE, page * PAGE);
      if (!rows.length) return box.innerHTML = emptyHTML('🏢', 'No employers registered', 'Employers are clients who take househelp services.');
      box.innerHTML = `<table class="data"><thead><tr>
        <th>Client</th><th>Phone</th><th>City</th><th>Current Househelp</th>
        <th>Registered</th><th></th>
      </tr></thead><tbody>
      ${slice.map(e => {
        const p = placements.find(pl => pl.employerId === e.id && ['Active', 'Pending', 'Matching', 'Contract Pending', 'Replacement Required'].includes(pl.status));
        return `<tr class="clickable" data-emp="${esc(e.id)}">
          <td><span class="row-main">${esc(e.fullName)}</span>${e.familyMember ? `<br><span class="row-sub">Family: ${esc(e.familyMember)}</span>` : ''}</td>
          <td>${esc(e.phone)}</td>
          <td>${esc(e.cityCountry)}</td>
          <td>${p ? esc(p.househelpName) : '—'}</td>
          <td class="nowrap">${fmtDate(e.registrationDate)}</td>
          <td><div class="table-actions"><button class="icon-btn" data-edit="${esc(e.id)}">✏️</button></div></td>
        </tr>`;
      }).join('')}
      </tbody></table>` + paginationHTML(page, Math.ceil(rows.length / PAGE));
      bindPagination(box, rows.length, PAGE, p => { page = p; renderTable(rows); });
      $$('[data-emp]', box).forEach(tr => tr.addEventListener('click', () =>
        location.hash = '#/employers?id=' + encodeURIComponent(tr.dataset.emp)));
      $$('[data-edit]', box).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); employerModal(b.dataset.edit, employers); }));
    };
    const apply = () => {
      const q = val('tb-search').toLowerCase();
      let rows = employers;
      if (q) rows = rows.filter(e => (e.fullName + ' ' + e.phone + ' ' + e.cityCountry + ' ' + e.id).toLowerCase().includes(q));
      page = 1; renderTable(rows);
    };
    apply();
    $('#tb-search').addEventListener('input', debounce(apply, 250));
    $('#tb-action').addEventListener('click', () => employerModal(null, employers));
  } catch (err) { main.innerHTML = errorHTML(err.message); }
};

function employerModal(id, employers) {
  const e = id ? employers.find(x => x.id === id) : null;
  const m = openModal(e ? 'Edit ' + e.fullName : 'Register Employer / Client', `
    <div class="form-grid">
      <div class="field"><label>Full Name <span class="req">*</span></label>${inputHTML('e-name', e && e.fullName, 'text')}</div>
      <div class="field"><label>Family Member/Relative</label>${inputHTML('e-family', e && e.familyMember, 'text')}</div>
      <div class="field"><label>Phone</label>${inputHTML('e-phone', e && e.phone, 'tel', '+255 …')}</div>
      <div class="field"><label>Email</label>${inputHTML('e-email', e && e.email, 'email')}</div>
      <div class="field"><label>Gender</label>${selectHTML('e-gender', ['Male', 'Female'], e && e.gender)}</div>
      <div class="field"><label>Nationality</label>${inputHTML('e-nation', e && e.nationality, 'text', 'Tanzanian')}</div>
      <div class="field"><label>Occupation</label>${inputHTML('e-occ', e && e.occupation, 'text')}</div>
      <div class="field"><label>City/Country</label>${inputHTML('e-city', e && e.cityCountry, 'text')}</div>
      <div class="field"><label>NIDA Number</label>${inputHTML('e-nida', e && e.nida, 'text')}</div>
      <div class="field"><label>Home Address</label>${inputHTML('e-addr', e && e.homeAddress, 'text')}</div>
      <div class="field"><label>Registration Date</label>${inputHTML('e-reg', (e && e.registrationDate) || todayISO(), 'date')}</div>
      <div class="field full"><label>Notes</label>${textareaHTML('e-notes', e && e.notes, '')}</div>
    </div>
    <div class="modal-foot" style="padding:14px 0 0">
      <button class="btn btn-ghost" id="e-cancel">Cancel</button>
      <button class="btn btn-primary" id="e-save">${e ? 'Save' : 'Register'}</button>
    </div>`);
  $('#e-cancel').addEventListener('click', m.close);
  $('#e-save').addEventListener('click', async () => {
    const name = val('e-name');
    if (!name) { setInvalid('e-name', true); toastErr('Full name is required'); return; }
    const payload = {
      fullName: name, familyMember: val('e-family'), phone: val('e-phone'),
      email: val('e-email'), gender: val('e-gender'), nationality: val('e-nation'),
      occupation: val('e-occ'), cityCountry: val('e-city'), nida: val('e-nida'),
      homeAddress: val('e-addr'), registrationDate: val('e-reg') || todayISO(),
      notes: val('e-notes')
    };
    try {
      if (e) await api('updateEmployer', Object.assign({ clientId: e.id }, payload));
      else await api('createEmployer', payload);
      m.close(); toastOK('Employer saved ✓'); VIEWS.employers();
    } catch (err) { toastErr(err.message); }
  });
}

async function employerProfile(id) {
  const main = $('#main-content');
  main.innerHTML = loadingHTML();
  try {
    const [employers, househelps, placements, contracts, payments, complaints, replacements, settings] = await Promise.all([
      api('listEmployers'), api('listHousehelps'), api('listPlacements'), api('listContracts'),
      api('listHousehelpPayments'), api('listComplaints'), api('listReplacements'), getSettings()
    ]);
    const e = employers.find(x => x.id === id);
    if (!e) throw new Error('Employer not found');
    const myPlacements = placements.filter(p => p.employerId === id);
    const myContracts = contracts.filter(c => c.employer === e.fullName);
    const myPayments = payments.filter(p => p.employerId === id);
    const myComplaints = complaints.filter(c => c.client === e.fullName);
    const myReplacements = replacements.filter(r => r.employer === e.fullName);
    const current = myPlacements.find(p => ['Active', 'Contract Pending'].includes(p.status));
    const previous = myPlacements.filter(p => !current || p.id !== current.id);
    main.innerHTML = `
    <div class="card no-print"><button class="btn btn-outline btn-sm" onclick="backOr('#/employers')">← Back</button></div>
    <div class="card">
      <div class="profile-head">
        <div class="avatar">${esc(initials(e.fullName))}</div>
        <div style="flex:1">
          <h2 style="font-size:18px">${esc(e.fullName)} <span style="font-size:12px;color:var(--text-faint)">${esc(e.id)}</span></h2>
          <div style="color:var(--text-soft);font-size:12.5px">${esc(e.phone)}${e.email ? ' · ' + esc(e.email) : ''}</div>
        </div>
        <button class="btn btn-outline btn-sm" id="emp-edit">✏️ Edit</button>
      </div>
      <div class="detail-grid">
        ${detail('Family Member/Relative', e.familyMember)}${detail('Gender', e.gender)}
        ${detail('Nationality', e.nationality)}${detail('Occupation', e.occupation)}
        ${detail('City/Country', e.cityCountry)}${detail('NIDA Number', e.nida)}
        ${detail('Home Address', e.homeAddress)}${detail('Registered', fmtDate(e.registrationDate))}
        ${detail('Current Househelp', current ? current.househelpName + ' (' + current.id + ')' : '—')}
      </div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><span class="card-title">Previous househelps</span></div>
        <div class="table-wrap"><table class="data"><thead><tr>
          <th>Househelp</th><th>Start</th><th>Status</th>
        </tr></thead><tbody>
        ${previous.map(p => `<tr><td>${esc(p.househelpName)}</td><td>${fmtDate(p.startDate)}</td><td>${badge(p.status)}</td></tr>`).join('') || '<tr><td colspan="3">None yet</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="card"><div class="card-head"><span class="card-title">Contracts</span></div>
        <div class="table-wrap"><table class="data"><thead><tr>
          <th>Contract</th><th>Househelp</th><th>Status</th>
        </tr></thead><tbody>
        ${myContracts.map(c => `<tr><td>${esc(c.id)}</td><td>${esc(c.househelp)}</td><td>${badge(c.status)}</td></tr>`).join('') || '<tr><td colspan="3">No contracts</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="card"><div class="card-head">
        <span class="card-title">Househelp payments</span>
        <button class="btn btn-primary btn-sm" id="hhp-add">＋ Record Salary Payment</button>
      </div>
        <div class="table-wrap"><table class="data"><thead><tr>
          <th>ID</th><th>Date</th><th>Househelp</th><th class="num">Amount</th><th>Status</th><th></th>
        </tr></thead><tbody>
        ${myPayments.map(p => `<tr><td class="nowrap">${esc(p.id)}</td><td class="nowrap">${fmtDate(p.paymentDate)}</td>
          <td>${esc(househelps.find(x => x.id === p.househelpId) ? househelps.find(x => x.id === p.househelpId).fullName : p.househelpId)}</td>
          <td class="num">${fmtMoney(p.amount)}</td><td>${badge(p.status)}</td>
          <td><div class="table-actions"><button class="icon-btn" title="Edit" data-hhp-edit="${esc(p.id)}">✏️</button></div></td></tr>`).join('') || '<tr><td colspan="6">No payments</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="card"><div class="card-head"><span class="card-title">Complaints & replacement requests</span></div>
        <div class="table-wrap"><table class="data"><thead><tr>
          <th>Type</th><th>Detail</th><th>Status</th>
        </tr></thead><tbody>
        ${myComplaints.map(c => `<tr><td>Complaint — ${esc(c.type)}</td><td>${esc(c.description)}</td><td>${badge(c.status)}</td></tr>`).join('')}
        ${myReplacements.map(r => `<tr><td>Replacement</td><td>${esc(r.reason)}</td><td>${badge(r.status)}</td></tr>`).join('') || '<tr><td colspan="3">None</td></tr>'}
        </tbody></table></div>
      </div>
    </div>`;
    $('#emp-edit').addEventListener('click', () => employerModal(id, employers));
    $('#hhp-add').addEventListener('click', () => househelpPaymentModal(null,
      { househelps, employers, placements, settings, preset: { employerId: id } },
      () => employerProfile(id)));
    $$('[data-hhp-edit]', main).forEach(b => b.addEventListener('click', () => {
      const pay = myPayments.find(x => x.id === b.dataset.hhpEdit);
      househelpPaymentModal(pay, { househelps, employers, placements, settings }, () => employerProfile(id));
    }));
  } catch (err) { main.innerHTML = errorHTML(err.message); }
}

/* ----------------------------------------------------- househelp payments */

VIEWS.hhpayments = async () => {
  const main = $('#main-content');
  main.innerHTML = loadingHTML();
  try {
    const [settings, payments, househelps, employers, placements] = await Promise.all([
      getSettings(), api('listHousehelpPayments'), api('listHousehelps'),
      api('listEmployers'), api('listPlacements')
    ]);
    const hhName = id => { const h = househelps.find(x => x.id === id); return h ? h.fullName : id; };
    const empName = id => { const e = employers.find(x => x.id === id); return e ? e.fullName : id; };
    main.innerHTML = `<div class="card">
      ${toolbarHTML({ searchPlaceholder: 'Search payment, househelp, employer, period…', actionLabel: 'Record Salary Payment' })}
      <div class="table-wrap" id="hhp-table"></div>
    </div>`;
    const box = $('#hhp-table');
    let page = 1; const PAGE = 12;
    const renderTable = rows => {
      if (!rows.length) {
        box.innerHTML = emptyHTML('💵', 'No househelp payments', 'Salary disbursements to househelps are recorded here.');
        return;
      }
      const slice = rows.slice((page - 1) * PAGE, page * PAGE);
      box.innerHTML = `<table class="data"><thead><tr>
        <th>ID</th><th>Date</th><th>Househelp</th><th>Employer</th><th>Period</th>
        <th class="num">Amount</th><th>Method</th><th>Status</th><th></th>
      </tr></thead><tbody>
      ${slice.map(p => `<tr>
        <td class="nowrap">${esc(p.id)}</td>
        <td class="nowrap">${fmtDate(p.paymentDate)}</td>
        <td><span class="row-main">${esc(hhName(p.househelpId))}</span></td>
        <td>${esc(empName(p.employerId))}</td>
        <td>${esc(p.period)}</td>
        <td class="num">${fmtMoney(p.amount)}</td>
        <td>${esc(p.method)}</td>
        <td>${badge(p.status)}</td>
        <td><div class="table-actions"><button class="icon-btn" title="Edit" data-hhp-edit="${esc(p.id)}">✏️</button></div></td>
      </tr>`).join('')}
      </tbody></table>` + paginationHTML(page, Math.ceil(rows.length / PAGE));
      bindPagination(box, rows.length, PAGE, p => { page = p; renderTable(rows); });
      $$('[data-hhp-edit]', box).forEach(b => b.addEventListener('click', () => {
        const p = payments.find(x => x.id === b.dataset.hhpEdit);
        househelpPaymentModal(p, { househelps, employers, placements, settings }, () => VIEWS.hhpayments());
      }));
    };
    const apply = () => {
      const q = val('tb-search').toLowerCase();
      let rows = payments;
      if (q) rows = rows.filter(p =>
        `${p.id} ${hhName(p.househelpId)} ${empName(p.employerId)} ${p.period} ${p.status}`.toLowerCase().includes(q));
      rows.sort((a, b) => b.paymentDate.localeCompare(a.paymentDate) || b.id.localeCompare(a.id));
      page = 1; renderTable(rows);
    };
    apply();
    $('#tb-search').addEventListener('input', debounce(apply, 250));
    $('#tb-action').addEventListener('click', () =>
      househelpPaymentModal(null, { househelps, employers, placements, settings }, () => VIEWS.hhpayments()));
  } catch (err) { main.innerHTML = errorHTML(err.message); }
};

/** Create/edit a househelp salary disbursement. ctx.preset pre-fills a new
 *  payment (used from the househelp and employer profile pages). */
function househelpPaymentModal(payment, ctx, onSaved) {
  const { househelps, employers, placements, settings } = ctx;
  const p = payment || null;
  const preset = ctx.preset || {};
  const methods = listNames('paymentMethods');
  const statuses = ['Pending', 'Paid'];
  const sel = (v, selVal) => v === selVal ? 'selected' : '';
  const m = openModal(p ? 'Edit Salary Payment ' + p.id : 'Record Salary Payment', `
    <div class="form-grid">
      <div class="field"><label>Househelp</label>
        <select id="hp-hh"><option value="">Select househelp…</option>
        ${househelps.map(h => `<option value="${esc(h.id)}" ${sel((p && p.househelpId) || preset.househelpId, h.id)}>${esc(h.id)} — ${esc(h.fullName)}</option>`).join('')}
        </select></div>
      <div class="field"><label>Employer</label>
        <select id="hp-emp"><option value="">Select employer…</option>
        ${employers.map(e => `<option value="${esc(e.id)}" ${sel((p && p.employerId) || preset.employerId, e.id)}>${esc(e.id)} — ${esc(e.fullName)}</option>`).join('')}
        </select></div>
      <div class="field"><label>Placement</label>
        <select id="hp-pl"><option value="">Auto / none</option>
        ${placements.map(pl => `<option value="${esc(pl.id)}" ${sel((p && p.placementId) || preset.placementId, pl.id)}>${esc(pl.id)} — ${esc(pl.househelpName)} @ ${esc(pl.employerName)}</option>`).join('')}
        </select></div>
      <div class="field"><label>Payment Date</label>${inputHTML('hp-date', (p && p.paymentDate) || todayISO(), 'date')}</div>
      <div class="field"><label>Period</label>${inputHTML('hp-period', p && p.period, 'text', 'Current month / Previous month')}</div>
      <div class="field"><label>Amount (TZS)</label>${inputHTML('hp-amount', p && p.amount, 'number', '0', 'min="0"')}</div>
      <div class="field"><label>Method</label>${selectHTML('hp-method', methods, p && p.method)}</div>
      <div class="field"><label>Status</label>${selectHTML('hp-status', statuses, (p && p.status) || 'Pending')}</div>
      <div class="field"><label>Reference</label>${inputHTML('hp-ref', p && p.reference, 'text', 'Transaction ref (optional)')}</div>
      <div class="field full"><label>Notes</label>${textareaHTML('hp-notes', p && p.notes, '')}</div>
    </div>
    <div class="modal-foot" style="padding:14px 0 0">
      <button class="btn btn-ghost" id="hp-cancel">Cancel</button>
      <button class="btn btn-primary" id="hp-save">${p ? 'Save' : 'Record Payment'}</button>
    </div>`);
  $('#hp-cancel').addEventListener('click', m.close);
  // auto-pick the placement when the chosen househelp and employer match one
  const autoPlacement = () => {
    const hh = val('hp-hh'), emp = val('hp-emp');
    const pl = placements.find(x => x.househelpId === hh && x.employerId === emp);
    if (pl && !val('hp-pl')) document.getElementById('hp-pl').value = pl.id;
  };
  $('#hp-hh').addEventListener('change', autoPlacement);
  $('#hp-emp').addEventListener('change', autoPlacement);
  $('#hp-save').addEventListener('click', async () => {
    const househelpId = val('hp-hh'), placementId = val('hp-pl');
    if (!househelpId && !placementId) { toastErr('Choose a househelp or a placement'); return; }
    if (valNum('hp-amount') <= 0) { toastErr('Amount is required'); return; }
    const payload = {
      househelpId, employerId: val('hp-emp'), placementId,
      paymentDate: val('hp-date') || todayISO(), period: val('hp-period'),
      amount: valNum('hp-amount'), method: val('hp-method'),
      status: val('hp-status') || 'Pending', reference: val('hp-ref'), notes: val('hp-notes')
    };
    try {
      if (p) await api('updateHousehelpPayment', Object.assign({ paymentId: p.id }, payload));
      else await api('createHousehelpPayment', payload);
      m.close(); toastOK('Salary payment saved ✓');
      if (onSaved) onSaved();
    } catch (err) { toastErr(err.message); }
  });
}

/* ---------------------------------------------------------------- attendance */

VIEWS.attendance = async () => {
  const main = $('#main-content');
  main.innerHTML = loadingHTML();
  try {
    const [settings, records, househelps, employers] = await Promise.all([
      getSettings(), api('listAttendance'), api('listHousehelps'), api('listEmployers')
    ]);
    const personNames = [...new Set([
      ...househelps.map(h => h.fullName),
      ...employers.map(e => e.fullName)
    ])].sort();
    main.innerHTML = `<div class="card">
      ${toolbarHTML({ searchPlaceholder: 'Search person, type, status…', dates: true, actionLabel: 'Mark Attendance' })}
      <div class="table-wrap" id="att-table"></div>
    </div>`;
    const box = $('#att-table');
    let page = 1; const PAGE = 15;
    const renderTable = rows => {
      if (!rows.length) {
        box.innerHTML = emptyHTML('🕒', 'No attendance records', 'Mark attendance for staff, workers and househelps.');
        return;
      }
      const slice = rows.slice((page - 1) * PAGE, page * PAGE);
      box.innerHTML = `<table class="data"><thead><tr>
        <th>Date</th><th>Person Type</th><th>Person</th><th>Check In</th>
        <th>Check Out</th><th class="num">Hours</th><th>Status</th><th></th>
      </tr></thead><tbody>
      ${slice.map(a => `<tr>
        <td class="nowrap">${fmtDate(a.date)}</td>
        <td>${esc(a.personType)}</td>
        <td><span class="row-main">${esc(a.person)}</span></td>
        <td>${esc(a.checkIn || '—')}</td>
        <td>${esc(a.checkOut || '—')}</td>
        <td class="num">${esc(a.hours || '—')}</td>
        <td>${badge(a.status)}</td>
        <td><div class="table-actions"><button class="icon-btn" title="Edit" data-att-edit="${esc(a.id)}">✏️</button></div></td>
      </tr>`).join('')}
      </tbody></table>` + paginationHTML(page, Math.ceil(rows.length / PAGE));
      bindPagination(box, rows.length, PAGE, p => { page = p; renderTable(rows); });
      $$('[data-att-edit]', box).forEach(b => b.addEventListener('click', () => {
        const rec = records.find(x => x.id === b.dataset.attEdit);
        attendanceModal(rec, { personNames }, () => VIEWS.attendance());
      }));
    };
    const apply = () => {
      const q = val('tb-search').toLowerCase();
      const from = val('tb-from'), to = val('tb-to');
      let rows = records.filter(a => {
        if (q && !(a.person + ' ' + a.personType + ' ' + a.status + ' ' + a.id).toLowerCase().includes(q)) return false;
        if (from && a.date < from) return false;
        if (to && a.date > to) return false;
        return true;
      });
      rows.sort((a, b) => b.date.localeCompare(a.date) || b.person.localeCompare(a.person));
      page = 1; renderTable(rows);
    };
    apply();
    $('#tb-search').addEventListener('input', debounce(apply, 250));
    ['tb-from', 'tb-to'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', apply);
    });
    $('#tb-action').addEventListener('click', () =>
      attendanceModal(null, { personNames }, () => VIEWS.attendance()));
  } catch (err) { main.innerHTML = errorHTML(err.message); }
};

function attendanceModal(record, ctx, onSaved) {
  const a = record || null;
  const { personNames } = ctx;
  const types = listNames('employeeTypes');
  const statuses = listNames('attendanceStatuses');
  const m = openModal(a ? 'Edit Attendance — ' + a.id : 'Mark Attendance', `
    <div class="form-grid">
      <div class="field"><label>Date <span class="req">*</span></label>${inputHTML('att-date', (a && a.date) || todayISO(), 'date')}</div>
      <div class="field"><label>Person Type</label>${selectHTML('att-type', types, a && a.personType)}</div>
      <div class="field"><label>Person <span class="req">*</span></label>${inputHTML('att-person', a && a.person, 'text', 'Name', 'list="att-person-list"')}</div>
      <div class="field"><label>Check In</label>${inputHTML('att-in', a && a.checkIn, 'time')}</div>
      <div class="field"><label>Check Out</label>${inputHTML('att-out', a && a.checkOut, 'time')}</div>
      <div class="field"><label>Hours</label><input id="att-hours" readonly placeholder="Auto"></div>
      <div class="field"><label>Status</label>${selectHTML('att-status', statuses, (a && a.status) || 'Present')}</div>
      <div class="field full"><label>Notes</label>${textareaHTML('att-notes', a && a.notes, '')}</div>
    </div>
    <datalist id="att-person-list">${personNames.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <div class="modal-foot" style="padding:14px 0 0">
      <button class="btn btn-ghost" id="att-cancel">Cancel</button>
      <button class="btn btn-primary" id="att-save">${a ? 'Save' : 'Mark Attendance'}</button>
    </div>`);
  $('#att-cancel').addEventListener('click', m.close);
  const calcHours = () => {
    const t1 = val('att-in'), t2 = val('att-out');
    const el = $('#att-hours');
    if (!t1 || !t2 || t2 <= t1) { el.value = ''; return; }
    const [h1, m1] = t1.split(':').map(Number);
    const [h2, m2] = t2.split(':').map(Number);
    const mins = (h2 * 60 + m2) - (h1 * 60 + m1);
    el.value = String(Math.round(mins / 6) / 10);
  };
  $('#att-in').addEventListener('change', calcHours);
  $('#att-out').addEventListener('change', calcHours);
  if (a && a.checkIn && a.checkOut) calcHours();
  $('#att-save').addEventListener('click', async () => {
    const person = val('att-person');
    if (!person) { setInvalid('att-person', true); toastErr('Person is required'); return; }
    calcHours();
    const payload = {
      date: val('att-date') || todayISO(), personType: val('att-type'),
      person, checkIn: val('att-in'), checkOut: val('att-out'),
      hours: val('att-hours'), status: val('att-status') || 'Present', notes: val('att-notes')
    };
    try {
      if (a) await api('updateAttendance', Object.assign({ attendanceId: a.id }, payload));
      else await api('createAttendance', payload);
      m.close(); toastOK('Attendance saved ✓');
      if (onSaved) onSaved();
    } catch (err) { toastErr(err.message); }
  });
}

/* ---------------------------------------------------------------- placements */

VIEWS.placements = async () => {
  const main = $('#main-content');
  main.innerHTML = loadingHTML();
  try {
    const [settings, placements, househelps, employers] = await Promise.all([
      getSettings(), api('listPlacements'), api('listHousehelps'), api('listEmployers')
    ]);
    const statuses = listNames('placementStatuses');
    const counts = {};
    statuses.forEach(s => { counts[s] = placements.filter(p => p.status === s).length; });
    main.innerHTML = `
    <div class="card">
      <div class="card-head"><span class="card-title">Placement workflow</span></div>
      <div class="workflow">
        <span class="wstep done">1. Employer registered</span><span class="warrow">→</span>
        <span class="wstep done">2. Househelp selected</span><span class="warrow">→</span>
        <span class="wstep ${counts['Active'] ? 'done' : 'now'}">3. Job requirements</span><span class="warrow">→</span>
        <span class="wstep">4. Terms agreed</span><span class="warrow">→</span>
        <span class="wstep">5. Contract created</span><span class="warrow">→</span>
        <span class="wstep">6. Placement active</span><span class="warrow">→</span>
        <span class="wstep">7. Payments tracked</span><span class="warrow">→</span>
        <span class="wstep">8. Complaints handled</span><span class="warrow">→</span>
        <span class="wstep">9. Replacement if needed</span><span class="warrow">→</span>
        <span class="wstep">10. Completed / terminated</span>
      </div>
    </div>
    <div class="kpi-grid">
      ${kpiCard('Active', counts['Active'] || 0, '', 'ok')}
      ${kpiCard('Pending', counts['Pending'] || 0, '', 'warn')}
      ${kpiCard('Matching', counts['Matching'] || 0, '', 'info')}
      ${kpiCard('Contract Pending', counts['Contract Pending'] || 0, '', 'warn')}
      ${kpiCard('Completed', counts['Completed'] || 0, '', 'violet')}
      ${kpiCard('Terminated', counts['Terminated'] || 0, '', 'danger')}
    </div>
    <div class="card">
      ${toolbarHTML({
        searchPlaceholder: 'Search placement, househelp, employer…',
        filters: [{ id: 'status', label: 'Status', options: statuses }],
        actionLabel: 'New Placement'
      })}
      <div class="table-wrap" id="pl-table"></div>
    </div>`;
    const box = $('#pl-table');
    let page = 1; const PAGE = 12;
    const renderTable = rows => {
      const slice = rows.slice((page - 1) * PAGE, page * PAGE);
      if (!rows.length) return box.innerHTML = emptyHTML('🤝', 'No placements yet', 'Create a placement to connect a househelp with an employer.');
      box.innerHTML = `<table class="data"><thead><tr>
        <th>Placement</th><th>Househelp</th><th>Employer</th><th>Category</th>
        <th class="num">Salary</th><th>Status</th><th>Contract</th><th></th>
      </tr></thead><tbody>
      ${slice.map(p => `<tr>
        <td class="nowrap"><span class="row-main">${esc(p.id)}</span><br><span class="row-sub">${fmtDate(p.startDate)}${p.expectedEndDate ? ' – ' + fmtDate(p.expectedEndDate) : ''}</span></td>
        <td>${esc(p.househelpName)}</td>
        <td>${esc(p.employerName)}</td>
        <td>${esc(p.category)}</td>
        <td class="num">${fmtMoney(p.salary)}</td>
        <td>${badge(p.status)}</td>
        <td>${badge(p.contractStatus)}</td>
        <td><div class="table-actions">
          <button class="icon-btn" title="Edit" data-edit="${esc(p.id)}">✏️</button>
          <button class="icon-btn" title="Terminate" data-term="${esc(p.id)}">⛔</button>
        </div></td>
      </tr>`).join('')}
      </tbody></table>` + paginationHTML(page, Math.ceil(rows.length / PAGE));
      bindPagination(box, rows.length, PAGE, p => { page = p; renderTable(rows); });
      $$('[data-edit]', box).forEach(b => b.addEventListener('click', () => placementModal(b.dataset.edit, placements, househelps, employers)));
      $$('[data-term]', box).forEach(b => b.addEventListener('click', async () => {
        if (await confirmDialog('Terminate placement?', 'The placement and its linked contract will be marked Terminated.', { danger: true, confirmText: 'Terminate' })) {
          try {
            await api('terminatePlacement', { placementId: b.dataset.term, date: todayISO(), reason: 'Terminated from the app' });
            toastOK('Placement terminated'); VIEWS.placements();
          } catch (err) { toastErr(err.message); }
        }
      }));
    };
    const apply = () => {
      const q = val('tb-search').toLowerCase();
      const fs = val('tb-filter-status');
      let rows = placements.filter(p => {
        if (q && !(p.id + ' ' + p.househelpName + ' ' + p.employerName + ' ' + p.category).toLowerCase().includes(q)) return false;
        if (fs && p.status !== fs) return false;
        return true;
      });
      page = 1; renderTable(rows);
    };
    apply();
    $('#tb-search').addEventListener('input', debounce(apply, 250));
    $('#tb-filter-status').addEventListener('change', apply);
    $('#tb-action').addEventListener('click', () => placementModal(null, placements, househelps, employers));
  } catch (err) { main.innerHTML = errorHTML(err.message); }
};

function placementModal(id, placements, househelps, employers) {
  getSettings().then(settings => {
    const p = id ? placements.find(x => x.id === id) : null;
    const availHH = househelps.filter(h => h.status === 'Available' || (p && h.id === p.househelpId));
    const m = openModal(p ? 'Edit Placement ' + p.id : 'New Placement', `
    <div class="form-grid">
      <div class="field"><label>Househelp <span class="req">*</span></label>
        <select id="pl-hh"><option value="">Select househelp…</option>
        ${availHH.map(h => `<option value="${esc(h.id)}" ${p && p.househelpId === h.id ? 'selected' : ''}>${esc(h.fullName)} (${esc(h.id)})</option>`).join('')}
        </select></div>
      <div class="field"><label>Employer / Client <span class="req">*</span></label>
        <select id="pl-emp"><option value="">Select employer…</option>
        ${employers.map(e => `<option value="${esc(e.id)}" ${p && p.employerId === e.id ? 'selected' : ''}>${esc(e.fullName)} (${esc(e.id)})</option>`).join('')}
        </select></div>
      <div class="field"><label>Househelp Category</label>
        ${selectHTML('pl-cat', listNames('househelpCategories'), p && p.category)}
        <span class="hint">Category pricing is Dee Cleaners placement pricing (not the salary).</span></div>
      <div class="field"><label>Salary (TZS)</label>${inputHTML('pl-salary', p && p.salary, 'number', '0', 'min="0"')}</div>
      <div class="field"><label>Payment Frequency</label>
        ${selectHTML('pl-freq', listNames('paymentFrequencies'), p && p.paymentFrequency, 'Monthly')}</div>
      <div class="field"><label>Agency Fee (TZS, one-time)</label>${inputHTML('pl-fee', p && p.agencyFee, 'number', '0', 'min="0"')}</div>
      <div class="field"><label>Start Date</label>${inputHTML('pl-start', (p && p.startDate) || todayISO(), 'date')}</div>
      <div class="field"><label>Expected End Date</label>${inputHTML('pl-end', p && p.expectedEndDate, 'date')}</div>
      <div class="field"><label>Status</label>${selectHTML('pl-status', listNames('placementStatuses'), (p && p.status) || 'Pending')}</div>
      <div class="field"><label>Contract Status</label>${selectHTML('pl-cstatus', listNames('contractStatuses'), (p && p.contractStatus) || 'Pending')}</div>
      <div class="field"><label>Live-in / Live-out</label>${selectHTML('pl-livein', ['Live-in', 'Live-out'], p && p.liveIn)}</div>
      <div class="field"><label>Working Hours</label>
        ${inputHTML('pl-hours', (p && p.workingHours) || settings.settings['Live-in Working Hours'] || '5:00 a.m. - 6:30 p.m.', 'text')}</div>
      <div class="field"><label>Accommodation</label>${inputHTML('pl-acc', p && p.accommodation, 'text', 'e.g. private room')}</div>
      <div class="field"><label>Meals</label>${inputHTML('pl-meals', p && p.meals, 'text', 'e.g. 3 meals a day')}</div>
      <div class="field full"><label>Job Description</label>${textareaHTML('pl-desc', p && p.jobDescription, 'Duties outlined and agreed with Dee Cleaners…', 3)}</div>
      <div class="field full"><label>Notes</label>${textareaHTML('pl-notes', p && p.notes, '')}</div>
    </div>
    <div class="modal-foot" style="padding:14px 0 0">
      <button class="btn btn-ghost" id="pl-cancel">Cancel</button>
      <button class="btn btn-primary" id="pl-save">${p ? 'Save' : 'Create Placement'}</button>
    </div>`);
    $('#pl-cancel').addEventListener('click', m.close);
    $('#pl-save').addEventListener('click', async () => {
      const hh = val('pl-hh'), emp = val('pl-emp');
      if (!hh || !emp) { toastErr('Househelp and Employer are required'); return; }
      const payload = {
        househelpId: hh, employerId: emp, category: val('pl-cat'),
        jobDescription: val('pl-desc'), salary: valNum('pl-salary'),
        paymentFrequency: val('pl-freq') || 'Monthly', startDate: val('pl-start') || todayISO(),
        expectedEndDate: val('pl-end'), status: val('pl-status') || 'Pending',
        contractStatus: val('pl-cstatus') || 'Pending', liveIn: val('pl-livein'),
        workingHours: val('pl-hours'), accommodation: val('pl-acc'),
        meals: val('pl-meals'), agencyFee: valNum('pl-fee'), notes: val('pl-notes')
      };
      try {
        if (p) await api('updatePlacement', Object.assign({ placementId: p.id }, payload));
        else await api('createPlacement', payload);
        m.close(); toastOK('Placement saved ✓'); VIEWS.placements();
      } catch (err) { toastErr(err.message); }
    });
  });
}

/* ---------------------------------------------------------------- contracts */

VIEWS.contracts = async () => {
  const main = $('#main-content');
  main.innerHTML = loadingHTML();
  try {
    const [settings, contracts, placements] = await Promise.all([
      getSettings(), api('listContracts'), api('listPlacements')
    ]);
    const statuses = listNames('contractStatuses');
    main.innerHTML = `<div class="card">
      ${toolbarHTML({
        searchPlaceholder: 'Search contract, employer, househelp…',
        filters: [{ id: 'status', label: 'Status', options: statuses }],
        actionLabel: 'New Contract'
      })}
      <div class="table-wrap" id="con-table"></div>
    </div>`;
    const box = $('#con-table');
    let page = 1; const PAGE = 12;
    const renderTable = rows => {
      const slice = rows.slice((page - 1) * PAGE, page * PAGE);
      if (!rows.length) return box.innerHTML = emptyHTML('📜', 'No contracts yet', 'Create a contract from an existing placement.');
      box.innerHTML = `<table class="data"><thead><tr>
        <th>Contract</th><th>Employer</th><th>Househelp</th><th>Start</th><th>End</th>
        <th>Status</th><th></th>
      </tr></thead><tbody>
      ${slice.map(c => `<tr>
        <td class="nowrap"><span class="row-main">${esc(c.id)}</span><br><span class="row-sub">${esc(c.placementId)}</span></td>
        <td>${esc(c.employer)}</td>
        <td>${esc(c.househelp)}</td>
        <td class="nowrap">${fmtDate(c.startDate)}</td>
        <td class="nowrap">${fmtDate(c.endDate)}</td>
        <td>${badge(c.status)}</td>
        <td><div class="table-actions">
          <button class="icon-btn" title="Print contract" data-print="${esc(c.id)}">🖨️</button>
          <button class="icon-btn" title="Edit" data-edit="${esc(c.id)}">✏️</button>
          <button class="icon-btn" title="Terminate" data-term="${esc(c.id)}">⛔</button>
        </div></td>
      </tr>`).join('')}
      </tbody></table>` + paginationHTML(page, Math.ceil(rows.length / PAGE));
      bindPagination(box, rows.length, PAGE, p => { page = p; renderTable(rows); });
      $$('[data-print]', box).forEach(b => b.addEventListener('click', () => printContract(b.dataset.print, contracts, placements)));
      $$('[data-edit]', box).forEach(b => b.addEventListener('click', () => contractModal(b.dataset.edit, contracts, placements)));
      $$('[data-term]', box).forEach(b => b.addEventListener('click', async () => {
        if (await confirmDialog('Terminate contract?', 'The contract and its placement will be marked Terminated.', { danger: true, confirmText: 'Terminate' })) {
          try {
            await api('terminateContract', { contractId: b.dataset.term, date: todayISO(), reason: 'Terminated from the app' });
            toastOK('Contract terminated'); VIEWS.contracts();
          } catch (err) { toastErr(err.message); }
        }
      }));
    };
    const apply = () => {
      const q = val('tb-search').toLowerCase();
      const fs = val('tb-filter-status');
      let rows = contracts.filter(c => {
        if (q && !(c.id + ' ' + c.employer + ' ' + c.househelp + ' ' + c.placementId).toLowerCase().includes(q)) return false;
        if (fs && c.status !== fs) return false;
        return true;
      });
      page = 1; renderTable(rows);
    };
    apply();
    $('#tb-search').addEventListener('input', debounce(apply, 250));
    $('#tb-filter-status').addEventListener('change', apply);
    $('#tb-action').addEventListener('click', () => contractModal(null, contracts, placements));
  } catch (err) { main.innerHTML = errorHTML(err.message); }
};

function contractModal(id, contracts, placements) {
  getSettings().then(settings => {
    const c = id ? contracts.find(x => x.id === id) : null;
    const open = placements.filter(p => p.status === 'Active' || p.status === 'Contract Pending' || (c && p.id === c.placementId));
    const m = openModal(c ? 'Edit Contract ' + c.id : 'New Contract', `
    <div class="form-grid">
      <div class="field"><label>Placement</label>
        <select id="c-pl"><option value="">Select placement…</option>
        ${open.map(p => `<option value="${esc(p.id)}" ${c && c.placementId === p.id ? 'selected' : ''}>${esc(p.id)} — ${esc(p.househelpName)} @ ${esc(p.employerName)}</option>`).join('')}
        </select></div>
      <div class="field"><label>Employer <span class="req">*</span></label>${inputHTML('c-emp', c && c.employer, 'text')}</div>
      <div class="field"><label>Househelp <span class="req">*</span></label>${inputHTML('c-hh', c && c.househelp, 'text')}</div>
      <div class="field"><label>Start Date</label>${inputHTML('c-start', (c && c.startDate) || todayISO(), 'date')}</div>
      <div class="field"><label>End Date</label>${inputHTML('c-end', c && c.endDate, 'date')}</div>
      <div class="field"><label>Minimum Duration</label>
        ${inputHTML('c-min', (c && c.minimumDuration) || (settings.settings['Minimum Work Duration (months)'] ? settings.settings['Minimum Work Duration (months)'] + ' months' : '3 months'), 'text')}</div>
      <div class="field"><label>Notice Required</label>
        ${inputHTML('c-notice', (c && c.noticeRequired) || 'Oral or written notice to Dee Cleaners', 'text')}</div>
      <div class="field"><label>Status</label>${selectHTML('c-status', listNames('contractStatuses'), (c && c.status) || 'Pending')}</div>
      <div class="field"><label>Employer Signature</label>${inputHTML('c-emsig', c && c.employerSignature, 'text')}</div>
      <div class="field"><label>Househelp Signature</label>${inputHTML('c-hhsig', c && c.househelpSignature, 'text')}</div>
      <div class="field"><label>Dee Cleaners Acknowledged</label>${selectHTML('c-ack', ['Yes', 'No'], (c && c.deeAck) || 'Yes')}</div>
      <div class="field"><label>Document Link</label>${inputHTML('c-doc', c && c.documentLink, 'text', 'Google Drive link (optional)')}</div>
      <div class="field full"><label>Notes</label>${textareaHTML('c-notes', c && c.notes, '')}</div>
    </div>
    <div class="modal-foot" style="padding:14px 0 0">
      <button class="btn btn-ghost" id="c-cancel">Cancel</button>
      <button class="btn btn-primary" id="c-save">${c ? 'Save' : 'Create Contract'}</button>
    </div>`);
    $('#c-pl').addEventListener('change', e => {
      const p = placements.find(x => x.id === e.target.value);
      if (p) {
        document.getElementById('c-emp').value = p.employerName;
        document.getElementById('c-hh').value = p.househelpName;
      }
    });
    $('#c-cancel').addEventListener('click', m.close);
    $('#c-save').addEventListener('click', async () => {
      const emp = val('c-emp'), hh = val('c-hh');
      if (!emp || !hh) { toastErr('Employer and Househelp are required'); return; }
      const payload = {
        placementId: val('c-pl'), employer: emp, househelp: hh,
        startDate: val('c-start') || todayISO(), endDate: val('c-end'),
        minimumDuration: val('c-min'), noticeRequired: val('c-notice'),
        status: val('c-status') || 'Pending',
        employerSignature: val('c-emsig'), househelpSignature: val('c-hhsig'),
        deeAck: val('c-ack'), documentLink: val('c-doc'), notes: val('c-notes')
      };
      try {
        if (c) await api('updateContract', Object.assign({ contractId: c.id }, payload));
        else await api('createContract', payload);
        m.close(); toastOK('Contract saved ✓'); VIEWS.contracts();
      } catch (err) { toastErr(err.message); }
    });
  });
}

/* The supplied Dee Cleaners househelp agreement terms (from the HOUSEHELP
   CLIENT FORM) — used verbatim in the printable contract document. */
const AGREEMENT_TERMS = [
  { t: '1. Service Agreement', items: [
    'The househelp is employed to perform duties as outlined in the job description provided by the employer and agreed upon by Dee Cleaners.',
    'The employer must clearly specify the househelp’s work schedule, responsibilities, and expectations at the beginning of the employment.'] },
  { t: '2. Working Hours', items: [
    'For Live-in Househelps: Standard working hours shall be from 5:00 a.m. to 6:30 p.m. with adequate meal breaks and rest periods during the day. The employer shall ensure that the househelp receives sufficient daily rest and is not required to work continuously without breaks.',
    'Any work beyond the agreed working hours shall be considered overtime and must be compensated as mutually agreed by both parties.'] },
  { t: '3. Payment Terms', items: [
    'The employer agrees to pay the househelp on time, as stipulated in the signed agreement. The payment should be made monthly/weekly, by Cash, Mobile Payments or Bank deposits.',
    'Any salary deductions must be transparent and communicated in advance, e.g., for damages or non-performance.',
    'Dee Cleaners is entitled to a one-time agency fee paid by the employer upon contract initiation.'] },
  { t: '4. Accommodation and Meals (for live-in househelps)', items: [
    'If the househelp is live-in, the employer must provide adequate accommodation (clean and safe living quarters) and sufficient meals or an allowance for food.',
    'Any additional expenses related to the househelp’s living conditions should be clearly agreed upon and documented.'] },
  { t: '5. Workplace Environment', items: [
    'The employer agrees to provide a safe, respectful, and non-hostile working environment for the househelp.',
    'Any form of harassment, abuse, or discrimination by the employer or househelp will lead to immediate termination of the agreement.'] },
  { t: '6. Termination of Employment', items: [
    'Either party may terminate this agreement by giving an oral or written notice and informing Dee Cleaners.',
    'If the employer delays or fails to pay the househelp’s salary on the agreed payment date, the househelp has the right to leave the job immediately and inform Dee Cleaners.',
    'In cases of abuse, harassment, unsafe working conditions, serious misconduct, or any situation that affects the househelp’s well-being, the househelp may terminate the agreement immediately and inform Dee Cleaners.',
    'In the event of immediate termination, Dee Cleaners must be notified within 24 hours.',
    'If the employer delays or fails to pay the househelp’s salary as agreed, Dee Cleaners reserves the right to terminate its services to the employer and may refuse to provide any replacement househelp or future placements.',
    'Dee Cleaners reserves the right to review each termination case individually and make a final decision based on the circumstances of the case.'] },
  { t: '7. Health and Safety', items: [
    'The employer must provide a safe and hygienic environment for the househelp to work in.',
    'The househelp agrees to follow all reasonable health and safety procedures while on duty.'] },
  { t: '8. Personal Conduct', items: [
    'The househelp is expected to maintain professionalism, integrity, and respect while carrying out duties.',
    'The employer agrees to treat the househelp with dignity and refrain from requesting duties outside of the agreed scope of work.'] },
  { t: '9. Confidentiality', items: [
    'Both the employer and househelp agree to keep all personal and sensitive information obtained during employment confidential. This includes personal details of the employer’s family and the househelp.'] },
  { t: '10. Dispute Resolution', items: [
    'Any disputes arising between the employer and the househelp will be mediated by Dee Cleaners.',
    'Both parties must cooperate with Dee Cleaners during mediation to resolve the issue amicably.'] },
  { t: '11. Liability', items: [
    'Dee Cleaners is a third-party facilitator and cannot be held responsible for any disputes, theft, or damages that arise after the contract has been signed by both parties.',
    'The househelp is responsible for any intentional damage or loss of property while under employment, and the employer may deduct this from the salary after fair assessment.'] },
  { t: '12. Mistreatment of Househelp', items: [
    'In cases where the househelp experiences mistreatment such as lack of food, inadequate clothing, physical abuse, or emotional abuse, the househelp reserves the right to terminate the contract immediately.',
    'Dee Cleaners must be notified of the mistreatment, and appropriate measures will be taken to resolve the issue.'] },
  { t: '13. Minimum Work Duration', items: [
    'The househelp agrees to stay with the employer for a minimum of three (3) months if all agreed-upon terms and conditions are being met.',
    'Early termination by the househelp without valid reasons will result in replacement fees or additional penalties as stipulated in the agreement.'] },
  { t: '14. Replacement Policy', items: [
    'If a Dee Cleaners househelp terminates the contract without valid reasons, Dee Cleaners will provide a replacement househelp to the employer at no additional cost.',
    'Replacement will be subject to availability and will follow the same agreed-upon terms.'] },
  { t: '15. Payment Policy', items: [
    'All payments for the househelp’s services must be made directly to Dee Cleaners’ account.',
    'Dee Cleaners will handle the disbursement of salaries to the househelp.'] },
  { t: '16. Customer Contract Breach', items: [
    'If a customer breaks the agreement, Dee Cleaners will not issue any refunds or provide another househelp.',
    'Dee Cleaners will only offer househelp services to customers who comply with the agreed-upon terms and conditions.'] },
  { t: '17. Modifications to Terms', items: [
    'Any changes or amendments to the agreed terms must be communicated in writing and signed by both the employer and the househelp. Dee Cleaners must also be informed of any modifications.'] }
];

function printContract(id, contracts, placements) {
  getSettings().then(settings => {
    const c = contracts.find(x => x.id === id);
    const p = placements.find(x => x.id === c.placementId);
    const s = settings.settings;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Contract ${esc(c.id)}</title>
      <link rel="stylesheet" href="styles.css"></head><body>
      <div class="doc-paper">
        <div class="doc-head">
          <img src="icons/logo.png" alt="Dee Cleaners">
          <div class="doc-company">
            <h1>${esc(s['Business Name'] || 'Dee Cleaners')}</h1>
            <div class="doc-tag">Househelp Service Agreement</div>
            <p>${esc(s['Phone 1'] || '')}${s['Phone 2'] ? ' / ' + esc(s['Phone 2']) : ''}<br>
            ${esc(s.Email || '')}<br>${esc(s.Address || '')}</p>
          </div>
        </div>
        <div class="doc-title">Househelp Employment Agreement — ${esc(c.id)}</div>
        <div class="doc-meta">
          <div class="m-item"><span class="k">Employer</span><span class="v">${esc(c.employer)}</span></div>
          <div class="m-item"><span class="k">Househelp</span><span class="v">${esc(c.househelp)}</span></div>
          <div class="m-item"><span class="k">Placement</span><span class="v">${esc(c.placementId)}</span></div>
          <div class="m-item"><span class="k">Start Date</span><span class="v">${fmtDate(c.startDate)}</span></div>
          <div class="m-item"><span class="k">End Date</span><span class="v">${fmtDate(c.endDate)}</span></div>
          <div class="m-item"><span class="k">Minimum Duration</span><span class="v">${esc(c.minimumDuration || '3 months')}</span></div>
          ${p ? `<div class="m-item"><span class="k">Salary</span><span class="v">${fmtMoneyTZS(p.salary)} ${esc(p.paymentFrequency || '')}</span></div>
          <div class="m-item"><span class="k">Working Hours</span><span class="v">${esc(p.workingHours || s['Live-in Working Hours'] || '')}</span></div>
          <div class="m-item"><span class="k">Arrangement</span><span class="v">${esc(p.liveIn || '')}</span></div>
          <div class="m-item"><span class="k">Accommodation</span><span class="v">${esc(p.accommodation || '—')}</span></div>
          <div class="m-item"><span class="k">Meals</span><span class="v">${esc(p.meals || '—')}</span></div>
          <div class="m-item"><span class="k">Job Description</span><span class="v">${esc(p.jobDescription || '')}</span></div>` : ''}
        </div>
        <div class="doc-terms">
          ${AGREEMENT_TERMS.map(sec => `<h5>${esc(sec.t)}</h5><ul>${sec.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}
        </div>
        <div class="doc-terms" style="margin-top:16px">
          <h5>Employer's Declaration</h5>
          <p>I, <u>${esc(c.employer)}</u>, agree to adhere to the terms and conditions listed above and treat the househelp with fairness and respect.</p>
          <h5>Househelp's Declaration</h5>
          <p>I, <u>${esc(c.househelp)}</u>, agree to perform my duties diligently and comply with the terms and conditions listed above.</p>
          <p style="margin-top:10px">By signing this form, both the employer and househelp confirm their understanding and acceptance of the above terms.</p>
        </div>
        <div class="doc-sig">
          <div class="sig"><div class="line"></div><div class="cap">Signature (Employer): ${esc(c.employerSignature || '')}</div></div>
          <div class="sig"><div class="line"></div><div class="cap">Signature (Househelp): ${esc(c.househelpSignature || '')}</div></div>
          <div class="sig"><div class="line"></div><div class="cap">Date: ${fmtDate(todayISO())}</div></div>
        </div>
        <div class="doc-footer">Dee Cleaners — ${esc(s.Address || '')} · ${esc(s['Phone 1'] || '')} · ${esc(s.Email || '')}<br>Thank you for choosing Dee Cleaners.</div>
      </div>
      <div class="doc-btns no-print" style="margin-top:16px">
        <button class="btn btn-primary" onclick="window.print()">🖨 Print / Save as PDF</button>
        <button class="btn btn-outline" onclick="window.close()">Close</button>
      </div></body></html>`;
    openPrintWindow(html);
  });
}

function openPrintWindow(html) {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { toastErr('Popup blocked — allow popups for this site to export documents.'); return; }
  // Popup documents have about:blank as base URL — point relative
  // assets (styles.css, logo) back at the app.
  const base = location.href.replace(/[^/]*$/, '');
  w.document.open();
  w.document.write(html.replace('<head>', '<head><base href="' + base + '">'));
  w.document.close();
}

/* ---------------------------------------------------------------- complaints */

VIEWS.complaints = async () => {
  const main = $('#main-content');
  main.innerHTML = loadingHTML();
  try {
    const [settings, complaints, placements] = await Promise.all([
      getSettings(), api('listComplaints'), api('listPlacements')
    ]);
    const types = listNames('complaintTypes');
    const statuses = listNames('complaintStatuses');
    main.innerHTML = `
    <div class="card">
      <div class="card-head"><span class="card-title">Complaint workflow</span></div>
      <div class="workflow">
        <span class="wstep done">Reported</span><span class="warrow">→</span>
        <span class="wstep">Under Review</span><span class="warrow">→</span>
        <span class="wstep">Mediation</span><span class="warrow">→</span>
        <span class="wstep">Resolved / Escalated</span>
      </div>
    </div>
    <div class="card">
      ${toolbarHTML({
        searchPlaceholder: 'Search client, househelp, description…',
        filters: [
          { id: 'type', label: 'Type', options: types },
          { id: 'status', label: 'Status', options: statuses }
        ],
        actionLabel: 'Report Complaint'
      })}
      <div class="table-wrap" id="cmp-table"></div>
    </div>`;
    const box = $('#cmp-table');
    let page = 1; const PAGE = 12;
    const renderTable = rows => {
      const slice = rows.slice((page - 1) * PAGE, page * PAGE);
      if (!rows.length) return box.innerHTML = emptyHTML('🕊️', 'No complaints', 'Dee Cleaners mediates disputes between employers and househelps.');
      box.innerHTML = `<table class="data"><thead><tr>
        <th>Complaint</th><th>Date</th><th>Client</th><th>Househelp</th><th>Type</th>
        <th>Severity</th><th>Status</th><th></th>
      </tr></thead><tbody>
      ${slice.map(c => `<tr>
        <td class="nowrap"><span class="row-main">${esc(c.id)}</span><br><span class="row-sub">${esc(c.description.slice(0, 40))}${c.description.length > 40 ? '…' : ''}</span></td>
        <td class="nowrap">${fmtDate(c.date)}</td>
        <td>${esc(c.client)}</td>
        <td>${esc(c.househelp)}</td>
        <td><span class="badge neutral">${esc(c.type)}</span></td>
        <td>${badge(c.severity)}</td>
        <td>${badge(c.status)}</td>
        <td><div class="table-actions">
          <button class="icon-btn" title="View / resolve" data-view="${esc(c.id)}">👁️</button>
          <button class="icon-btn" title="Edit" data-edit="${esc(c.id)}">✏️</button>
        </div></td>
      </tr>`).join('')}
      </tbody></table>` + paginationHTML(page, Math.ceil(rows.length / PAGE));
      bindPagination(box, rows.length, PAGE, p => { page = p; renderTable(rows); });
      $$('[data-view]', box).forEach(b => b.addEventListener('click', () => complaintView(b.dataset.view, complaints)));
      $$('[data-edit]', box).forEach(b => b.addEventListener('click', () => complaintModal(b.dataset.edit, complaints)));
    };
    const apply = () => {
      const q = val('tb-search').toLowerCase();
      const ft = val('tb-filter-type'), fs = val('tb-filter-status');
      let rows = complaints.filter(c => {
        if (q && !(c.id + ' ' + c.client + ' ' + c.househelp + ' ' + c.type + ' ' + c.description).toLowerCase().includes(q)) return false;
        if (ft && c.type !== ft) return false;
        if (fs && c.status !== fs) return false;
        return true;
      });
      rows.sort((a, b) => b.date.localeCompare(a.date));
      page = 1; renderTable(rows);
    };
    apply();
    $('#tb-search').addEventListener('input', debounce(apply, 250));
    ['tb-filter-type', 'tb-filter-status'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('change', apply); });
    $('#tb-action').addEventListener('click', () => complaintModal(null, complaints));
  } catch (err) { main.innerHTML = errorHTML(err.message); }
};

function complaintView(id, complaints) {
  const c = complaints.find(x => x.id === id);
  const m = openModal('Complaint ' + c.id, `
    <div class="detail-grid" style="grid-template-columns:1fr 1fr">
      ${detail('Date', fmtDateLong(c.date))}${detail('Type', c.type)}
      ${detail('Client', c.client)}${detail('Househelp', c.househelp)}
      ${detail('Placement', c.placement)}${detail('Reported By', c.reportedBy)}
      ${detail('Severity', c.severity)}${detail('Status', c.status)}
    </div>
    <div class="field" style="margin-top:12px"><label>Description</label>
      <div style="background:var(--bg);border-radius:8px;padding:11px;font-size:13px">${esc(c.description)}</div></div>
    <div class="field" style="margin-top:10px"><label>Dee Cleaners Action</label>
      <textarea id="cv-action" rows="2">${esc(c.action || '')}</textarea></div>
    <div class="field" style="margin-top:10px"><label>Resolution</label>
      <textarea id="cv-resolution" rows="2">${esc(c.resolution || '')}</textarea></div>
    <div class="field" style="margin-top:10px"><label>Status after mediation</label>
      ${selectHTML('cv-status', ['Under Review', 'Mediation', 'Resolved', 'Escalated'], c.status)}</div>
    <div class="modal-foot" style="padding:14px 0 0">
      <button class="btn btn-ghost" id="cv-cancel">Close</button>
      <button class="btn btn-primary" id="cv-save">Save Resolution</button>
    </div>`);
  $('#cv-cancel').addEventListener('click', m.close);
  $('#cv-save').addEventListener('click', async () => {
    try {
      await api('resolveComplaint', {
        complaintId: c.id, status: val('cv-status'), action: val('cv-action'),
        resolution: val('cv-resolution'), resolutionDate: todayISO()
      });
      m.close(); toastOK('Complaint updated ✓'); VIEWS.complaints();
    } catch (err) { toastErr(err.message); }
  });
}

function complaintModal(id, complaints) {
  getSettings().then(settings => {
    const c = id ? complaints.find(x => x.id === id) : null;
    const m = openModal(c ? 'Edit Complaint ' + c.id : 'Report Complaint', `
    <div class="form-grid">
      <div class="field"><label>Date</label>${inputHTML('c-date', (c && c.date) || todayISO(), 'date')}</div>
      <div class="field"><label>Reported By</label>${selectHTML('c-by', ['Employer', 'Househelp', 'Dee Cleaners'], c && c.reportedBy)}</div>
      <div class="field"><label>Client / Employer</label>${inputHTML('c-client', c && c.client, 'text')}</div>
      <div class="field"><label>Househelp</label>${inputHTML('c-hh', c && c.househelp, 'text')}</div>
      <div class="field"><label>Placement</label>${inputHTML('c-pl', c && c.placement, 'text', 'PL-0001 (optional)')}</div>
      <div class="field"><label>Complaint Type</label>${selectHTML('c-type', listNames('complaintTypes'), c && c.type)}</div>
      <div class="field"><label>Severity</label>${selectHTML('c-sev', listNames('severityLevels'), (c && c.severity) || 'Medium')}</div>
      <div class="field"><label>Status</label>${selectHTML('c-status', listNames('complaintStatuses'), (c && c.status) || 'Reported')}</div>
      <div class="field full"><label>Description <span class="req">*</span></label>${textareaHTML('c-desc', c && c.description, 'What happened?', 3)}</div>
      <div class="field full"><label>Dee Cleaners Action</label>${textareaHTML('c-action', c && c.action, 'Mediation steps taken…', 2)}</div>
      <div class="field full"><label>Resolution</label>${textareaHTML('c-res', c && c.resolution, 'How it was resolved…', 2)}</div>
    </div>
    <div class="modal-foot" style="padding:14px 0 0">
      <button class="btn btn-ghost" id="c-cancel">Cancel</button>
      <button class="btn btn-primary" id="c-save">${c ? 'Save' : 'Report'}</button>
    </div>`);
    $('#c-cancel').addEventListener('click', m.close);
    $('#c-save').addEventListener('click', async () => {
      const desc = val('c-desc');
      if (!desc) { setInvalid('c-desc', true); toastErr('Description is required'); return; }
      const payload = {
        date: val('c-date') || todayISO(), client: val('c-client'),
        househelp: val('c-hh'), placement: val('c-pl'), type: val('c-type'),
        description: desc, reportedBy: val('c-by'), severity: val('c-sev'),
        status: val('c-status'), action: val('c-action'), resolution: val('c-res')
      };
      try {
        if (c) await api('updateComplaint', Object.assign({ complaintId: c.id }, payload));
        else await api('createComplaint', payload);
        m.close(); toastOK('Complaint saved ✓'); VIEWS.complaints();
      } catch (err) { toastErr(err.message); }
    });
  });
}

/* ---------------------------------------------------------------- replacements */

VIEWS.replacements = async () => {
  const main = $('#main-content');
  main.innerHTML = loadingHTML();
  try {
    const [settings, replacements, placements, househelps] = await Promise.all([
      getSettings(), api('listReplacements'), api('listPlacements'), api('listHousehelps')
    ]);
    main.innerHTML = `<div class="card">
      ${toolbarHTML({
        searchPlaceholder: 'Search employer, reason, househelp…',
        actionLabel: 'New Replacement'
      })}
      <div class="table-wrap" id="rep-table"></div>
    </div>`;
    const box = $('#rep-table');
    let page = 1; const PAGE = 12;
    const renderTable = rows => {
      const slice = rows.slice((page - 1) * PAGE, page * PAGE);
      if (!rows.length) return box.innerHTML = emptyHTML('🔄', 'No replacement requests', 'Replacements apply when a househelp terminates without valid reasons (subject to availability).');
      box.innerHTML = `<table class="data"><thead><tr>
        <th>Replacement</th><th>Employer</th><th>Original Househelp</th><th>Reason</th>
        <th>Replacement</th><th>Status</th><th></th>
      </tr></thead><tbody>
      ${slice.map(r => `<tr>
        <td class="nowrap"><span class="row-main">${esc(r.id)}</span><br><span class="row-sub">${fmtDate(r.requestDate)}</span></td>
        <td>${esc(r.employer)}</td>
        <td>${esc(r.originalHousehelp)}</td>
        <td>${esc(r.reason)}</td>
        <td>${esc(r.replacementHousehelp || '—')}${r.replacementDate ? '<br><span class="row-sub">' + fmtDate(r.replacementDate) + '</span>' : ''}</td>
        <td>${badge(r.status)}</td>
        <td><div class="table-actions"><button class="icon-btn" data-edit="${esc(r.id)}">✏️</button></div></td>
      </tr>`).join('')}
      </tbody></table>` + paginationHTML(page, Math.ceil(rows.length / PAGE));
      bindPagination(box, rows.length, PAGE, p => { page = p; renderTable(rows); });
      $$('[data-edit]', box).forEach(b => b.addEventListener('click', () => replacementModal(b.dataset.edit, replacements, placements, househelps)));
    };
    const apply = () => {
      const q = val('tb-search').toLowerCase();
      let rows = replacements;
      if (q) rows = rows.filter(r => (r.id + ' ' + r.employer + ' ' + r.originalHousehelp + ' ' + r.reason + ' ' + r.replacementHousehelp).toLowerCase().includes(q));
      rows.sort((a, b) => b.requestDate.localeCompare(a.requestDate));
      page = 1; renderTable(rows);
    };
    apply();
    $('#tb-search').addEventListener('input', debounce(apply, 250));
    $('#tb-action').addEventListener('click', () => replacementModal(null, replacements, placements, househelps));
  } catch (err) { main.innerHTML = errorHTML(err.message); }
};

function replacementModal(id, replacements, placements, househelps) {
  const r = id ? replacements.find(x => x.id === id) : null;
  const avail = househelps.filter(h => h.status === 'Available');
  const m = openModal(r ? 'Edit Replacement ' + r.id : 'New Replacement Request', `
    <div class="form-grid">
      <div class="field"><label>Employer <span class="req">*</span></label>${inputHTML('r-emp', r && r.employer, 'text')}</div>
      <div class="field"><label>Original Placement</label>${inputHTML('r-pl', r && r.originalPlacement, 'text', 'PL-0001')}</div>
      <div class="field"><label>Original Househelp</label>${inputHTML('r-hh', r && r.originalHousehelp, 'text')}</div>
      <div class="field"><label>Request Date</label>${inputHTML('r-date', (r && r.requestDate) || todayISO(), 'date')}</div>
      <div class="field"><label>Reason</label>${textareaHTML('r-reason', r && r.reason, 'Why is a replacement needed?', 2)}</div>
      <div class="field"><label>Replacement Househelp</label>
        <select id="r-new"><option value="">Select replacement…</option>
        ${avail.map(h => `<option value="${esc(h.fullName)}" ${r && r.replacementHousehelp === h.fullName ? 'selected' : ''}>${esc(h.fullName)} (${esc(h.id)})</option>`).join('')}
        </select></div>
      <div class="field"><label>Replacement Date</label>${inputHTML('r-rd', r && r.replacementDate, 'date')}</div>
      <div class="field"><label>Status</label>${selectHTML('r-status', ['Requested', 'In Progress', 'Completed', 'Cancelled'], (r && r.status) || 'Requested')}</div>
      <div class="field full"><label>Notes</label>${textareaHTML('r-notes', r && r.notes, '')}</div>
    </div>
    <div class="modal-foot" style="padding:14px 0 0">
      <button class="btn btn-ghost" id="r-cancel">Cancel</button>
      <button class="btn btn-primary" id="r-save">${r ? 'Save' : 'Request Replacement'}</button>
    </div>`);
  $('#r-cancel').addEventListener('click', m.close);
  $('#r-save').addEventListener('click', async () => {
    const emp = val('r-emp');
    if (!emp) { setInvalid('r-emp', true); toastErr('Employer is required'); return; }
    const payload = {
      originalPlacement: val('r-pl'), originalHousehelp: val('r-hh'),
      employer: emp, reason: val('r-reason'), requestDate: val('r-date') || todayISO(),
      replacementHousehelp: val('r-new'), replacementDate: val('r-rd'),
      status: val('r-status') || 'Requested', notes: val('r-notes')
    };
    try {
      if (r) await api('updateReplacement', Object.assign({ replacementId: r.id }, payload));
      else await api('createReplacement', payload);
      m.close(); toastOK('Replacement saved ✓'); VIEWS.replacements();
    } catch (err) { toastErr(err.message); }
  });
}

/* ---------------------------------------------------------------- reports */

const REPORT_DEFS = [
  { id: 'daily', label: 'Daily Sales' },
  { id: 'weekly', label: 'Weekly Sales' },
  { id: 'monthly', label: 'Monthly Sales' },
  { id: 'yearly', label: 'Yearly Sales' },
  { id: 'pnl', label: 'Profit & Loss' },
  { id: 'outstanding', label: 'Outstanding' },
  { id: 'customers', label: 'Customers' },
  { id: 'services', label: 'Services' },
  { id: 'laundry', label: 'Laundry' },
  { id: 'househelps', label: 'Househelps' },
  { id: 'placements', label: 'Placements' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'complaints', label: 'Complaints' },
  { id: 'replacements', label: 'Replacements' },
  { id: 'payments', label: 'Payments' }
];

VIEWS.reports = async () => {
  const main = $('#main-content');
  main.innerHTML = loadingHTML();
  const defs = REPORT_DEFS;
  main.innerHTML = `
  <div class="card no-print" style="margin-bottom:14px">
    <div class="pill-row" id="report-pills">
      ${defs.map(d => `<button class="pill" data-r="${d.id}">${esc(d.label)}</button>`).join('')}
    </div>
    <div class="filter-bar">
      <input type="date" id="rp-from" aria-label="From"> <span style="color:var(--text-faint)">to</span>
      <input type="date" id="rp-to" aria-label="To">
      <span class="spacer" style="flex:1"></span>
      <button class="btn btn-outline btn-sm" id="rp-print">🖨 Print</button>
      <button class="btn btn-primary btn-sm" id="rp-pdf">⬇ Export PDF</button>
    </div>
  </div>
  <div class="card print-area" id="rp-body"></div>`;

  let current = 'daily';
  const load = async type => {
    current = type;
    $$('#report-pills .pill').forEach(p => p.classList.toggle('on', p.dataset.r === type));
    const body = $('#rp-body');
    body.innerHTML = `<div class="state-box"><div class="spinner"></div><p>Generating report…</p></div>`;
    try {
      const data = await api('getReport', {
        type,
        from: val('rp-from'),
        to: val('rp-to')
      });
      body.innerHTML = reportHTML(type, data);
    } catch (err) { body.innerHTML = errorHTML(err.message); }
  };
  $$('#report-pills .pill').forEach(p => p.addEventListener('click', () => load(p.dataset.r)));
  ['rp-from', 'rp-to'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => load(current));
  });
  $('#rp-print').addEventListener('click', () => printReportBody());
  $('#rp-pdf').addEventListener('click', () => printReportBody(true));
  load('daily');
};

function printReportBody() {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { toastErr('Popup blocked — allow popups to export documents.'); return; }
  const title = ROUTE_TITLES.reports;
  const base = location.href.replace(/[^/]*$/, '');
  w.document.open();
  w.document.write(`<!DOCTYPE html><html><head><base href="${base}"><meta charset="utf-8"><title>${esc(title)} — Dee Cleaners</title>
    <link rel="stylesheet" href="styles.css"></head><body>
    <div class="doc-paper">
      <div class="doc-head">
        <img src="icons/logo.png" alt="Dee Cleaners">
        <div class="doc-company"><h1>Dee Cleaners</h1><div class="doc-tag">Report</div>
        <p id="rp-print-date"></p></div>
      </div>
      <div id="rp-print-body"></div>
    </div>
    <div class="doc-btns"><button class="btn btn-primary" onclick="window.print()">🖨 Print / Save as PDF</button></div>
    </body></html>`);
  w.document.close();
  const body = $('#rp-body').cloneNode(true);
  body.querySelectorAll('.no-print').forEach(x => x.remove());
  w.document.getElementById('rp-print-body').innerHTML = body.innerHTML;
  w.document.getElementById('rp-print-date').textContent = 'Generated ' + fmtDateLong(todayISO()) +
    (val('rp-from') ? ' · From ' + fmtDate(val('rp-from')) : '') +
    (val('rp-to') ? ' · To ' + fmtDate(val('rp-to')) : '');
}

function reportHTML(type, d) {
  const tbl = (headers, rowsHTML) => `<div class="table-wrap"><table class="data"><thead><tr>
    ${headers.map(h => `<th${h.num ? ' class="num"' : ''}>${esc(h.t)}</th>`).join('')}</tr></thead>
    <tbody>${rowsHTML || '<tr><td colspan="' + headers.length + '" style="text-align:center;color:var(--text-faint)">No data for this period</td></tr>'}</tbody></table></div>`;
  switch (type) {
    case 'daily':
      return `<h4 style="margin-bottom:10px">Daily Sales</h4>` + tbl(
        [{ t: 'Date' }, { t: 'Orders', num: true }, { t: 'Revenue', num: true }, { t: 'Paid', num: true },
         { t: 'Transport', num: true }, { t: 'Direct Expenses', num: true }, { t: 'Other Expenses', num: true }, { t: 'Profit', num: true }],
        (d.rows || []).map(r => `<tr>
          <td><b>${fmtDateLong(r.date)}</b></td><td class="num">${r.orders}</td>
          <td class="num">${fmtMoney(r.revenue)}</td><td class="num">${fmtMoney(r.paid)}</td>
          <td class="num">${fmtMoney(r.transport)}</td><td class="num">${fmtMoney(r.directExpenses)}</td>
          <td class="num">${fmtMoney(r.otherExpenses)}</td>
          <td class="num"><b>${fmtMoney(r.profit)}</b></td></tr>`).join(''));
    case 'weekly':
    case 'monthly':
    case 'yearly':
      return `<h4 style="margin-bottom:10px">${type === 'weekly' ? 'Weekly' : type === 'monthly' ? 'Monthly' : 'Yearly'} Sales</h4>` + tbl(
        [{ t: 'Period' }, { t: 'Orders', num: true }, { t: 'Revenue', num: true }, { t: 'Paid', num: true },
         { t: 'Expenses', num: true }, { t: 'Profit', num: true }],
        (d.rows || []).map(r => `<tr><td><b>${esc(r.period)}</b></td><td class="num">${r.orders}</td>
          <td class="num">${fmtMoney(r.revenue)}</td><td class="num">${fmtMoney(r.paid)}</td>
          <td class="num">${fmtMoney(r.expenses || 0)}</td><td class="num"><b>${fmtMoney(r.profit)}</b></td></tr>`).join(''));
    case 'pnl':
      return `
        <h4 style="margin-bottom:10px">Profit & Loss</h4>
        <div class="kpi-grid">
          ${kpiCard('Revenue (service orders)', fmtMoneyTZS(d.revenue), '', '')}
          ${kpiCard('Transport fees', fmtMoneyTZS(d.transportFees), '', 'accent')}
          ${kpiCard('Direct service expenses', fmtMoneyTZS(d.directServiceExpenses), '', 'warn')}
          ${kpiCard('Other business expenses', fmtMoneyTZS(d.totalExpenses - d.directServiceExpenses), '', 'warn')}
          ${kpiCard('Net Profit', fmtMoneyTZS(d.netProfit), '', d.netProfit >= 0 ? 'ok' : 'danger')}
        </div>
        <div class="grid-2" style="margin-top:10px">
          <div class="chart-box"><h4>Expenses by category</h4>${svgHBar(d.expensesByCategory.map(x => ({ label: x.category, value: x.amount })))}</div>
          <div class="card"><h4 style="margin-bottom:10px">Breakdown</h4>
            <table class="data" style="min-width:0"><tbody>
              <tr><td>Revenue</td><td class="num"><b>${fmtMoney(d.revenue)}</b></td></tr>
              <tr><td>+ Transport fees</td><td class="num">${fmtMoney(d.transportFees)}</td></tr>
              <tr><td>− Direct service expenses</td><td class="num">${fmtMoney(d.directServiceExpenses)}</td></tr>
              ${(d.expensesByCategory || []).map(x => `<tr><td>&nbsp;&nbsp;− ${esc(x.category)}</td><td class="num">${fmtMoney(x.amount)}</td></tr>`).join('')}
              <tr style="border-top:2px solid var(--navy)"><td><b>Net Profit</b></td><td class="num"><b>${fmtMoney(d.netProfit)}</b></td></tr>
            </tbody></table>
          </div>
        </div>`;
    case 'outstanding':
      return `<h4 style="margin-bottom:10px">Outstanding Customer Payments — <span style="color:var(--danger)">${fmtMoneyTZS(d.totalOutstanding)}</span></h4>` + tbl(
        [{ t: 'Order' }, { t: 'Date' }, { t: 'Customer' }, { t: 'Service' },
         { t: 'Total', num: true }, { t: 'Paid', num: true }, { t: 'Balance', num: true }],
        (d.rows || []).map(r => `<tr><td>${esc(r.orderId)}</td><td>${fmtDate(r.date)}</td>
          <td>${esc(r.customer)}<br><span class="row-sub">${esc(r.phone)}</span></td>
          <td>${esc(r.service)}</td><td class="num">${fmtMoney(r.total)}</td>
          <td class="num">${fmtMoney(r.paid)}</td>
          <td class="num"><b style="color:var(--danger)">${fmtMoney(r.balance)}</b></td></tr>`).join(''));
    case 'customers':
      return `<h4 style="margin-bottom:10px">Customer Report</h4>` + tbl(
        [{ t: 'Customer' }, { t: 'Phone' }, { t: 'Orders', num: true }, { t: 'Total Spending', num: true },
         { t: 'Paid', num: true }, { t: 'Balance', num: true }, { t: 'Last Service' }, { t: 'Status' }],
        (d.rows || []).map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.phone)}</td>
          <td class="num">${c.orderCount}</td><td class="num">${fmtMoney(c.totalSpending)}</td>
          <td class="num">${fmtMoney(c.totalPaid)}</td><td class="num">${fmtMoney(c.balance)}</td>
          <td>${fmtDate(c.lastServiceDate)}</td><td>${badge(c.status)}</td></tr>`).join(''));
    case 'services':
      return `<h4 style="margin-bottom:10px">Service Performance</h4>` + tbl(
        [{ t: 'Service' }, { t: 'Orders', num: true }, { t: 'Revenue', num: true }],
        (d.rows || []).map(r => `<tr><td>${esc(r.service)}</td><td class="num">${r.orders}</td><td class="num">${fmtMoney(r.revenue)}</td></tr>`).join(''));
    case 'laundry':
      return `<h4 style="margin-bottom:10px">Laundry Performance — ${fmtMoneyTZS(d.totalLaundryRevenue)}</h4>` + tbl(
        [{ t: 'Laundry Service' }, { t: 'Orders', num: true }, { t: 'Revenue', num: true }],
        (d.rows || []).map(r => `<tr><td>${esc(r.service)}</td><td class="num">${r.orders}</td><td class="num">${fmtMoney(r.revenue)}</td></tr>`).join(''));
    case 'househelps':
      return `<h4 style="margin-bottom:10px">Househelp Report</h4>` + tbl(
        [{ t: 'ID' }, { t: 'Name' }, { t: 'Phone' }, { t: 'Status' }, { t: 'Current Employer' }, { t: 'Placement' }],
        (d.rows || []).map(h => `<tr><td>${esc(h.id)}</td><td>${esc(h.fullName)}</td>
          <td>${esc(h.phone)}</td><td>${badge(h.status)}</td>
          <td>${esc(h.currentEmployer || '—')}</td><td>${esc(h.currentPlacement || '—')}</td></tr>`).join(''));
    case 'placements':
      return `<h4 style="margin-bottom:10px">Placement Report</h4>` + tbl(
        [{ t: 'Placement' }, { t: 'Househelp' }, { t: 'Employer' }, { t: 'Category' },
         { t: 'Salary', num: true }, { t: 'Start' }, { t: 'Status' }],
        (d.rows || []).map(p => `<tr><td>${esc(p.id)}</td><td>${esc(p.househelpName)}</td>
          <td>${esc(p.employerName)}</td><td>${esc(p.category)}</td>
          <td class="num">${fmtMoney(p.salary)}</td><td>${fmtDate(p.startDate)}</td><td>${badge(p.status)}</td></tr>`).join(''));
    case 'contracts':
      return `<h4 style="margin-bottom:10px">Contract Report</h4>` + tbl(
        [{ t: 'Contract' }, { t: 'Employer' }, { t: 'Househelp' }, { t: 'Start' }, { t: 'End' }, { t: 'Status' }],
        (d.rows || []).map(c => `<tr><td>${esc(c.id)}</td><td>${esc(c.employer)}</td>
          <td>${esc(c.househelp)}</td><td>${fmtDate(c.startDate)}</td><td>${fmtDate(c.endDate)}</td><td>${badge(c.status)}</td></tr>`).join(''));
    case 'complaints':
      return `<h4 style="margin-bottom:10px">Complaint Report</h4>` + tbl(
        [{ t: 'Complaint' }, { t: 'Date' }, { t: 'Client' }, { t: 'Househelp' }, { t: 'Type' },
         { t: 'Severity' }, { t: 'Status' }],
        (d.rows || []).map(c => `<tr><td>${esc(c.id)}</td><td>${fmtDate(c.date)}</td>
          <td>${esc(c.client)}</td><td>${esc(c.househelp)}</td><td>${esc(c.type)}</td>
          <td>${badge(c.severity)}</td><td>${badge(c.status)}</td></tr>`).join(''));
    case 'replacements':
      return `<h4 style="margin-bottom:10px">Replacement Report</h4>` + tbl(
        [{ t: 'Replacement' }, { t: 'Employer' }, { t: 'Original Househelp' }, { t: 'Replacement' },
         { t: 'Requested' }, { t: 'Status' }],
        (d.rows || []).map(r => `<tr><td>${esc(r.id)}</td><td>${esc(r.employer)}</td>
          <td>${esc(r.originalHousehelp)}</td><td>${esc(r.replacementHousehelp || '—')}</td>
          <td>${fmtDate(r.requestDate)}</td><td>${badge(r.status)}</td></tr>`).join(''));
    case 'payments':
      return `<h4 style="margin-bottom:10px">Payment Report — ${fmtMoneyTZS(d.total)}</h4>` + tbl(
        [{ t: 'Payment' }, { t: 'Date' }, { t: 'Customer' }, { t: 'Order' },
         { t: 'Amount', num: true }, { t: 'Method' }, { t: 'Received By' }],
        (d.rows || []).map(p => `<tr><td>${esc(p.id)}</td><td>${fmtDate(p.date)}</td>
          <td>${esc(p.customer)}</td><td>${esc(p.orderId)}</td>
          <td class="num">${fmtMoney(p.amount)}</td><td>${esc(p.method)}</td><td>${esc(p.receivedBy)}</td></tr>`).join(''));
    default:
      return emptyHTML('📊', 'Unknown report');
  }
}

/* ---------------------------------------------------------------- invoices */

VIEWS.invoices = async () => {
  const main = $('#main-content');
  main.innerHTML = loadingHTML();
  try {
    const [settings, orders] = await Promise.all([getSettings(), api('listOrders')]);
    const ordered = [...orders].sort((a, b) => b.date.localeCompare(a.date));
    const requested = currentRouteParams().order;
    const initial = requested && orders.find(o => o.id === requested) ? requested : (ordered[0] ? ordered[0].id : '');
    main.innerHTML = `
    <div class="card no-print" style="margin-bottom:14px">
      <div class="field"><label>Select order to invoice</label>
        <select id="inv-order">
          <option value="">Select an order…</option>
          ${ordered.map(o => `<option value="${esc(o.id)}" ${o.id === initial ? 'selected' : ''}>${esc(o.id)} — ${esc(o.customerName)} — ${fmtMoney(o.total)} (${fmtDate(o.date)})</option>`).join('')}
        </select></div>
    </div>
    <div id="inv-preview"></div>`;
    const render = () => {
      const id = val('inv-order');
      const o = orders.find(x => x.id === id);
      const preview = $('#inv-preview');
      if (!o) { preview.innerHTML = emptyHTML('🧾', 'Select an order', 'Choose an order from the list to generate its invoice.'); return; }
      preview.innerHTML = invoiceHTML(settings, o, false);
      $('#inv-export').addEventListener('click', () => exportInvoice(settings, o));
      $('#inv-print').addEventListener('click', () => exportInvoice(settings, o, true));
    };
    $('#inv-order').addEventListener('change', render);
    render();
  } catch (err) { main.innerHTML = errorHTML(err.message); }
};

function invoiceHTML(settings, o, standalone) {
  const s = settings.settings;
  const lines = o.lineItems && o.lineItems.length
    ? o.lineItems
    : [{ service: o.service, description: o.description, qty: o.quantity, unitPrice: o.unitPrice }];
  const subtotal = lines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
  const grand = Math.max(0, subtotal - o.discount) + o.transportFee;
  const balance = Math.max(0, grand - o.amountPaid);
  const methods = listItems('paymentMethods');
  const website = s.Website;
  return `
  <div class="doc-paper" id="invoice-doc">
    <div class="doc-head">
      <img src="icons/logo.png" alt="Dee Cleaners logo">
      <div class="doc-company">
        <h1>${esc(s['Business Name'] || 'Dee Cleaners')}</h1>
        <div class="doc-tag">Cleaning · Laundry · Househelp Services</div>
        <p>${esc(s['Phone 1'] || '')}${s['Phone 2'] ? ' / ' + esc(s['Phone 2']) : ''}<br>
        ${esc(s.Email || '')}<br>${esc(s.Address || '')}${website ? '<br>' + esc(website) : ''}</p>
      </div>
    </div>
    <div class="doc-title">INVOICE</div>
    <div class="doc-meta">
      <div class="m-item"><span class="k">Invoice No.</span><span class="v">${esc(o.id)}</span></div>
      <div class="m-item"><span class="k">Date</span><span class="v">${fmtDate(o.date)}</span></div>
      <div class="m-item"><span class="k">Customer</span><span class="v">${esc(o.customerName)}</span></div>
      <div class="m-item"><span class="k">Phone</span><span class="v">${esc(o.phone)}</span></div>
      <div class="m-item"><span class="k">Email</span><span class="v">${esc(o.email || '—')}</span></div>
      <div class="m-item"><span class="k">Order Status</span><span class="v">${esc(o.orderStatus)}</span></div>
    </div>
    <table class="doc-table">
      <thead><tr><th>#</th><th>Service</th><th>Description</th><th class="num">Qty</th>
        <th class="num">Unit Price</th><th class="num">Amount</th></tr></thead>
      <tbody>
        ${lines.map((l, i) => `<tr><td>${i + 1}</td><td><b>${esc(l.service)}</b></td>
          <td>${esc(l.description || '')}</td><td class="num">${l.qty}</td>
          <td class="num">${fmtMoney(l.unitPrice)}</td><td class="num">${fmtMoney(l.qty * l.unitPrice)}</td></tr>`).join('')}
        ${o.discount ? `<tr class="tot-row"><td></td><td></td><td></td><td></td><td>Discount</td><td class="num">− ${fmtMoney(o.discount)}</td></tr>` : ''}
        ${o.transportFee ? `<tr class="tot-row"><td></td><td></td><td></td><td></td><td>Transport fee</td><td class="num">${fmtMoney(o.transportFee)}</td></tr>` : ''}
      </tbody>
    </table>
    <div class="doc-summary">
      <div class="s-row"><span>Grand Total</span><span>${fmtMoneyTZS(grand)}</span></div>
      <div class="s-row"><span>Amount Paid</span><span>${fmtMoneyTZS(o.amountPaid)}</span></div>
      <div class="s-row grand"><span>Balance Due</span><span>${fmtMoneyTZS(balance)}</span></div>
    </div>
    <div class="doc-pay">
      <h5>Payment methods</h5>
      <ul>${methods.map(m => `<li>${esc(m.name)}${m.details ? ' — ' + esc(m.details) : ''}</li>`).join('')}</ul>
    </div>
    <div class="doc-footer">Thank you for choosing Dee Cleaners.</div>
    ${standalone ? '' : `
    <div class="doc-btns no-print" style="margin-top:16px">
      <button class="btn btn-primary" id="inv-export">⬇ Export PDF</button>
      <button class="btn btn-outline" id="inv-print">🖨 Print</button>
    </div>`}
  </div>`;
}

function exportInvoice(settings, o, printNow) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${esc(o.id)} — Dee Cleaners</title>
    <link rel="stylesheet" href="styles.css"></head><body>
    ${invoiceHTML(settings, o, true)}
    <div class="doc-btns"><button class="btn btn-primary" onclick="window.print()">🖨 Print / Save as PDF</button>
    <button class="btn btn-outline" onclick="window.close()">Close</button></div>
    ${printNow ? '<script>window.onload=function(){setTimeout(function(){window.print()},400)}</script>' : ''}
    </body></html>`;
  openPrintWindow(html);
}

/* ---------------------------------------------------------------- receipts */

VIEWS.receipts = async () => {
  const main = $('#main-content');
  main.innerHTML = loadingHTML();
  try {
    const [settings, payments, orders] = await Promise.all([getSettings(), api('listPayments'), api('listOrders')]);
    const ordered = [...payments].sort((a, b) => b.date.localeCompare(a.date));
    const requested = currentRouteParams().payment;
    const initial = requested && payments.find(p => p.id === requested) ? requested : (ordered[0] ? ordered[0].id : '');
    main.innerHTML = `
    <div class="card no-print" style="margin-bottom:14px">
      <div class="field"><label>Select payment for receipt</label>
        <select id="rcp-payment">
          <option value="">Select a payment…</option>
          ${ordered.map(p => `<option value="${esc(p.id)}" ${p.id === initial ? 'selected' : ''}>${esc(p.id)} — ${esc(p.customer)} — ${fmtMoney(p.amount)} (${fmtDate(p.date)})</option>`).join('')}
        </select></div>
    </div>
    <div id="rcp-preview"></div>`;
    const render = () => {
      const id = val('rcp-payment');
      const p = payments.find(x => x.id === id);
      const preview = $('#rcp-preview');
      if (!p) { preview.innerHTML = emptyHTML('🧾', 'Select a payment', 'Choose a payment from the list to generate its receipt.'); return; }
      preview.innerHTML = receiptHTML(settings, p, orders, false);
      $('#rcp-export').addEventListener('click', () => exportReceipt(settings, p, orders));
      $('#rcp-print').addEventListener('click', () => exportReceipt(settings, p, orders, true));
    };
    $('#rcp-payment').addEventListener('change', render);
    render();
  } catch (err) { main.innerHTML = errorHTML(err.message); }
};

function receiptHTML(settings, p, orders, standalone) {
  const s = settings.settings;
  const o = orders.find(x => x.id === p.orderId);
  const remaining = o ? Math.max(0, o.total - o.amountPaid) : 0;
  return `
  <div class="doc-paper" id="receipt-doc">
    <div class="doc-head">
      <img src="icons/logo.png" alt="Dee Cleaners logo">
      <div class="doc-company">
        <h1>${esc(s['Business Name'] || 'Dee Cleaners')}</h1>
        <div class="doc-tag">Official Payment Receipt</div>
        <p>${esc(s['Phone 1'] || '')}${s['Phone 2'] ? ' / ' + esc(s['Phone 2']) : ''}<br>
        ${esc(s.Email || '')}<br>${esc(s.Address || '')}</p>
      </div>
    </div>
    <div class="doc-title">PAYMENT RECEIPT</div>
    <div class="doc-meta">
      <div class="m-item"><span class="k">Receipt No.</span><span class="v">${esc(p.id)}</span></div>
      <div class="m-item"><span class="k">Date</span><span class="v">${fmtDate(p.date)}</span></div>
      <div class="m-item"><span class="k">Customer</span><span class="v">${esc(p.customer)}</span></div>
      <div class="m-item"><span class="k">Order ID</span><span class="v">${esc(p.orderId)}</span></div>
      <div class="m-item"><span class="k">Service</span><span class="v">${esc(o ? o.service : '—')}</span></div>
      <div class="m-item"><span class="k">Order Total</span><span class="v">${o ? fmtMoneyTZS(o.total) : '—'}</span></div>
      <div class="m-item"><span class="k">Payment Method</span><span class="v">${esc(p.method)}</span></div>
      <div class="m-item"><span class="k">Reference</span><span class="v">${esc(p.reference || '—')}</span></div>
      <div class="m-item"><span class="k">Received By</span><span class="v">${esc(p.receivedBy || 'Dee Cleaners')}</span></div>
      <div class="m-item"><span class="k">Remaining Balance</span><span class="v">${fmtMoneyTZS(remaining)}</span></div>
    </div>
    <div class="doc-summary">
      <div class="s-row grand"><span>Amount Paid</span><span>${fmtMoneyTZS(p.amount)}</span></div>
    </div>
    <div class="doc-sig">
      <div class="sig"><div class="line"></div><div class="cap">Received by (signature)</div></div>
      <div class="sig"><div class="line"></div><div class="cap">Customer (signature)</div></div>
    </div>
    <div class="doc-footer">Thank you for choosing Dee Cleaners.</div>
    ${standalone ? '' : `
    <div class="doc-btns no-print" style="margin-top:16px">
      <button class="btn btn-primary" id="rcp-export">⬇ Export PDF</button>
      <button class="btn btn-outline" id="rcp-print">🖨 Print</button>
    </div>`}
  </div>`;
}

function exportReceipt(settings, p, orders, printNow) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt ${esc(p.id)} — Dee Cleaners</title>
    <link rel="stylesheet" href="styles.css"></head><body>
    ${receiptHTML(settings, p, orders, true)}
    <div class="doc-btns"><button class="btn btn-primary" onclick="window.print()">🖨 Print / Save as PDF</button>
    <button class="btn btn-outline" onclick="window.close()">Close</button></div>
    ${printNow ? '<script>window.onload=function(){setTimeout(function(){window.print()},400)}</script>' : ''}
    </body></html>`;
  openPrintWindow(html);
}

/* ---------------------------------------------------------------- services */

const SERVICE_TABS = [
  { id: 'cleaning', label: 'Cleaning', list: 'cleaningServices' },
  { id: 'sofa', label: 'Sofa Cleaning', list: 'sofaServices' },
  { id: 'laundry', label: 'Laundry', list: 'laundryServices' },
  { id: 'specialized', label: 'Specialized Cleaning', list: 'specializedServices' },
  { id: 'fumigation', label: 'Fumigation', list: 'specializedServices', filter: 'Fumigation' },
  { id: 'gardening', label: 'Gardening & Maintenance', list: 'specializedServices', filter: 'Gardening' },
  { id: 'househelp', label: 'Househelp Services', list: 'househelpCategories' }
];

VIEWS.services = async () => {
  const main = $('#main-content');
  main.innerHTML = loadingHTML();
  try {
    const settings = await getSettings();
    main.innerHTML = `
    <div class="card no-print" style="margin-bottom:14px">
      <div class="pill-row" id="svc-pills">
        ${SERVICE_TABS.map(t => `<button class="pill" data-t="${t.id}">${esc(t.label)}</button>`).join('')}
      </div>
      <p style="font-size:12px;color:var(--text-faint)">Price ranges are shown as in the catalog — staff enter the actual agreed price on the order (room size affects price: “Bei zinapungua au Kuongezeka kulingana na ukubwa wa chumba”).</p>
    </div>
    <div class="card" id="svc-body"></div>`;
    let current = 'cleaning';
    const render = tabId => {
      current = tabId;
      $$('#svc-pills .pill').forEach(p => p.classList.toggle('on', p.dataset.t === tabId));
      const tab = SERVICE_TABS.find(t => t.id === tabId);
      const list = settings.lists[tab.list];
      let items = (list.items || []);
      if (tab.filter) items = items.filter(i => String(i.name).includes(tab.filter));
      const cols = list.columns || [];
      const body = $('#svc-body');
      if (!items.length) {
        body.innerHTML = emptyHTML('🧹', 'No services', 'Add a service for this category.') +
          `<div class="no-print" style="text-align:center"><button class="btn btn-primary" id="svc-add">＋ Add Service</button></div>`;
      } else {
        body.innerHTML = `
        <div class="table-wrap"><table class="data"><thead><tr>
          <th>Service</th>
          ${cols.includes('Unit') ? '<th>Unit</th>' : ''}
          <th class="num">Price (TZS)</th>
          ${cols.includes('Category') ? '<th>Category</th>' : ''}
          <th>Active</th><th>Description</th><th></th>
        </tr></thead><tbody>
        ${items.map(i => `<tr>
          <td><span class="row-main">${esc(i.name)}</span></td>
          ${cols.includes('Unit') ? `<td>${esc(i.unit || '—')}</td>` : ''}
          <td class="num"><b>${priceRange(i)}</b></td>
          ${cols.includes('Category') ? `<td><span class="badge neutral">${esc(i.category || '—')}</span></td>` : ''}
          <td>${i.active === 'No' ? badge('No') : '<span class="badge ok">Yes</span>'}</td>
          <td style="max-width:300px"><span class="row-sub">${esc(laundryPriceNote(i) || i.description || '')}</span></td>
          <td><div class="table-actions">
            <button class="icon-btn" title="Edit" data-edit="${esc(i.name)}">✏️</button>
            <button class="icon-btn" title="Delete" data-del="${esc(i.name)}">🗑️</button>
          </div></td>
        </tr>`).join('')}
        </tbody></table></div>
        <div class="no-print" style="margin-top:12px"><button class="btn btn-primary" id="svc-add">＋ Add Service</button></div>`;
      }
      $('#svc-add').addEventListener('click', () => serviceModal(null, tab, list, items));
      $$('[data-edit]', body).forEach(b => b.addEventListener('click', () => {
        const item = items.find(i => i.name === b.dataset.edit);
        serviceModal(item, tab, list, items);
      }));
      $$('[data-del]', body).forEach(b => b.addEventListener('click', async () => {
        if (await confirmDialog('Delete service?', `Remove "${b.dataset.del}" from the list? Existing orders are not affected.`, { danger: true })) {
          try {
            await api('deleteList', { list: tab.list, name: b.dataset.del });
            invalidateSettings(); toastOK('Service removed'); VIEWS.services();
          } catch (err) { toastErr(err.message); }
        }
      }));
    };
    $$('#svc-pills .pill').forEach(p => p.addEventListener('click', () => render(p.dataset.t)));
    render('cleaning');
  } catch (err) { main.innerHTML = errorHTML(err.message); }
};

function priceRange(i) {
  const lo = Number(i.minprice), hi = Number(i.maxprice);
  const hasLo = lo > 0, hasHi = hi > 0;
  if (hasLo && hasHi && lo === hi) return fmtMoney(lo);
  if (hasLo && hasHi) return fmtMoney(lo) + ' – ' + fmtMoney(hi);
  const lp = Number(i.lightprice), hp = Number(i.heavyprice), ip = Number(i.ironingprice);
  const parts = [];
  if (lp > 0) parts.push('Light ' + fmtMoney(lp));
  if (hp > 0) parts.push('Heavy ' + fmtMoney(hp));
  if (ip > 0) parts.push('+ Ironing ' + fmtMoney(ip));
  if (parts.length) return parts.join(' · ');
  return 'Set in Settings';
}
function laundryPriceNote(i) {
  const lp = Number(i.lightprice), hp = Number(i.heavyprice), ip = Number(i.ironingprice);
  const parts = [];
  if (lp > 0) parts.push('Light ' + fmtMoney(lp));
  if (hp > 0) parts.push('Heavy ' + fmtMoney(hp));
  if (ip > 0) parts.push('+Ironing ' + fmtMoney(ip));
  return parts.length > 1 ? parts.join(' | ') : '';
}

function serviceModal(item, tab, list, items) {
  const isLaundry = tab.id === 'laundry';
  const hasPrices = ['cleaning', 'sofa', 'specialized', 'fumigation', 'gardening', 'househelp'].includes(tab.id);
  const m = openModal(item ? 'Edit Service — ' + item.name : 'Add Service — ' + tab.label, `
    <div class="form-grid">
      <div class="field"><label>Service Name <span class="req">*</span></label>${inputHTML('s-name', item && item.name, 'text')}${tab.filter ? `<span class="hint">Filed under ${esc(tab.filter)} services.</span>` : ''}</div>
      <div class="field"><label>Active</label>${selectHTML('s-active', ['Yes', 'No'], (item && item.active) || 'Yes')}</div>
      ${hasPrices ? `
      <div class="field"><label>Minimum Price (TZS)</label>${inputHTML('s-min', item && item.minprice, 'number', '0', 'min="0"')}</div>
      <div class="field"><label>Maximum Price (TZS)</label>${inputHTML('s-max', item && item.maxprice, 'number', '0', 'min="0"')}</div>
      ` : ''}
      ${isLaundry ? `
      <div class="field"><label>Unit</label>${selectHTML('s-unit', ['Piece', 'Pair', 'Bundle', 'Item'], item && item.unit)}</div>
      <div class="field"><label>Light Price (TZS)</label>${inputHTML('s-light', item && item.lightprice, 'number', '0', 'min="0"')}</div>
      <div class="field"><label>Heavy Price (TZS)</label>${inputHTML('s-heavy', item && item.heavyprice, 'number', '0', 'min="0"')}</div>
      <div class="field"><label>Ironing Price (TZS)</label>${inputHTML('s-iron', item && item.ironingprice, 'number', '0', 'min="0"')}</div>
      ` : ''}
      ${tab.list === 'cleaningServices' ? `<div class="field"><label>Category</label>
        ${selectHTML('s-cat', ['Cleaning', 'Empty Rooms', 'Rooms With Furniture Cleaning'], item && item.category)}</div>` : ''}
      <div class="field full"><label>Description</label>${textareaHTML('s-desc', item && item.description, 'Pricing notes, e.g. tiered prices', 2)}</div>
    </div>
    <div class="modal-foot" style="padding:14px 0 0">
      <button class="btn btn-ghost" id="s-cancel">Cancel</button>
      <button class="btn btn-primary" id="s-save">${item ? 'Save' : 'Add Service'}</button>
    </div>`);
  $('#s-cancel').addEventListener('click', m.close);
  $('#s-save').addEventListener('click', async () => {
    let name = val('s-name');
    if (!name) { setInvalid('s-name', true); toastErr('Name is required'); return; }
    // Fumigation/Gardening tabs share the Specialized list and are filtered by
    // keyword — keep the keyword in the name so the service stays visible there
    if (tab.filter && !String(name).toLowerCase().includes(String(tab.filter).toLowerCase())) {
      name = name + ' (' + tab.filter + ')';
    }
    const newItem = { name, active: val('s-active') || 'Yes', description: val('s-desc') };
    if (hasPrices) { newItem.minprice = valNum('s-min'); newItem.maxprice = valNum('s-max'); }
    if (isLaundry) {
      newItem.unit = val('s-unit');
      newItem.lightprice = valNum('s-light');
      newItem.heavyprice = valNum('s-heavy');
      newItem.ironingprice = valNum('s-iron');
    }
    if (tab.list === 'cleaningServices') newItem.category = val('s-cat');
    try {
      if (item) {
        if (item.name !== name) await api('renameList', { list: tab.list, oldName: item.name, newName: name });
        await api('updateList', { list: tab.list, name, item: newItem });
      } else {
        await api('addList', { list: tab.list, item: newItem });
      }
      invalidateSettings(); m.close(); toastOK('Service saved ✓'); VIEWS.services();
    } catch (err) { toastErr(err.message); }
  });
}

/* ---------------------------------------------------------------- settings */

VIEWS.settings = async () => {
  const main = $('#main-content');
  main.innerHTML = loadingHTML();
  try {
    const settings = await getSettings();
    const s = settings.settings;
    const infoFields = ['Business Name', 'Phone 1', 'Phone 2', 'Email', 'Address', 'Website', 'Social Media'];
    const cfg = getApiConfig();
    main.innerHTML = `
    <div class="card">
      <div class="card-head"><span class="card-title">Business Information</span></div>
      <div class="form-grid">
        ${infoFields.map((k, i) => `<div class="field"><label>${esc(k)}</label>
          <input id="bi-${i}" value="${esc(s[k] !== undefined ? s[k] : '')}"></div>`).join('')}
        <div class="field"><label>Currency</label><input id="bi-currency" value="${esc(s.Currency || 'TZS')}" disabled></div>
        <div class="field"><label>Default Transport Policy</label><input id="bi-transport" value="${esc(s['Default Transport Policy'] || '')}"></div>
        <div class="field full"><label>Room Pricing Note (catalog rule)</label><input id="bi-room" value="${esc(s['Room Pricing Note'] || '')}"></div>
        <div class="field"><label>Live-in Working Hours</label><input id="bi-hours" value="${esc(s['Live-in Working Hours'] || '')}"></div>
        <div class="field"><label>Minimum Work Duration (months)</label><input id="bi-min" type="number" value="${esc(s['Minimum Work Duration (months)'] || 3)}"></div>
      </div>
      <div style="margin-top:14px"><button class="btn btn-primary" id="bi-save">Save Business Info</button></div>
    </div>

    <div class="card">
      <div class="card-head"><span class="card-title">Payment Methods</span>
        <button class="btn btn-outline btn-sm" id="pm-add">＋ Add</button></div>
      <div class="table-wrap" id="pm-table"></div>
    </div>

    <div class="card">
      <div class="card-head"><span class="card-title">Househelp Settings — Categories</span></div>
      <div class="table-wrap" id="hc-table"></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><span class="card-title">Reference Lists</span></div>
        <div id="ref-lists"></div>
      </div>
      <div class="card">
        <div class="card-head"><span class="card-title">API Connection</span></div>
        <div class="form-grid" style="grid-template-columns:1fr">
          <div class="field"><label>API URL</label><input id="api-url" value="${esc(cfg.apiUrl)}" placeholder="http://localhost:8787/api">
            <span class="hint">Mock server: http://localhost:8787/api — or your Apps Script Web App URL.</span></div>
          <div class="field"><label>API Key (optional)</label><input id="api-key" type="password" value="${esc(cfg.apiKey)}"></div>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" id="api-save">Save & Connect</button>
          <button class="btn btn-outline" id="api-test">Test Connection</button>
          <button class="btn btn-ghost" id="api-disconnect">Disconnect</button>
        </div>
        <p style="font-size:11.5px;color:var(--text-faint);margin-top:10px">
          The API key is stored only on this device. Business data always lives in Google Sheets — this app never keeps its own database.</p>
      </div>
    </div>`;

    // business info save
    $('#bi-save').addEventListener('click', async () => {
      const updates = {};
      infoFields.forEach((k, i) => { updates[k] = val('bi-' + i); });
      updates['Default Transport Policy'] = val('bi-transport');
      updates['Room Pricing Note'] = val('bi-room');
      updates['Live-in Working Hours'] = val('bi-hours');
      updates['Minimum Work Duration (months)'] = Number(val('bi-min')) || 3;
      try {
        await api('updateSettings', { settings: updates });
        invalidateSettings(); toastOK('Settings saved ✓');
      } catch (err) { toastErr(err.message); }
    });

    // payment methods
    const renderPM = () => {
      const methods = listItems('paymentMethods');
      $('#pm-table').innerHTML = `<table class="data" style="min-width:0"><thead><tr><th>Method</th><th>Details (account / number)</th><th></th></tr></thead><tbody>
        ${methods.map(m => `<tr><td><b>${esc(m.name)}</b></td><td><input value="${esc(m.details || '')}" style="border:1px solid var(--blue-border);border-radius:6px;padding:5px 9px;width:100%" data-pmd="${esc(m.name)}" placeholder="Leave empty if not provided"></td>
        <td><div class="table-actions">
          <button class="icon-btn" title="Rename" data-pmr="${esc(m.name)}">✏️</button>
          <button class="icon-btn" title="Delete" data-pmdd="${esc(m.name)}">🗑️</button></div></td></tr>`).join('')}
      </tbody></table>`;
      $$('[data-pmd]', $('#pm-table')).forEach(inp => inp.addEventListener('change', async () => {
        try {
          await api('updateList', { list: 'paymentMethods', name: inp.dataset.pmd, item: { details: inp.value } });
          invalidateSettings(); toastOK('Payment method updated ✓');
        } catch (err) { toastErr(err.message); }
      }));
      $$('[data-pmr]', $('#pm-table')).forEach(b => b.addEventListener('click', async () => {
        const name = prompt('New name for ' + b.dataset.pmr + ':', b.dataset.pmr);
        if (name && name !== b.dataset.pmr) {
          try {
            await api('renameList', { list: 'paymentMethods', oldName: b.dataset.pmr, newName: name });
            invalidateSettings(); renderPM(); toastOK('Renamed ✓');
          } catch (err) { toastErr(err.message); }
        }
      }));
      $$('[data-pmdd]', $('#pm-table')).forEach(b => b.addEventListener('click', async () => {
        if (await confirmDialog('Delete payment method?', `Remove "${b.dataset.pmdd}"?`, { danger: true })) {
          try {
            await api('deleteList', { list: 'paymentMethods', name: b.dataset.pmdd });
            invalidateSettings(); renderPM(); toastOK('Removed ✓');
          } catch (err) { toastErr(err.message); }
        }
      }));
    };
    renderPM();
    $('#pm-add').addEventListener('click', async () => {
      const name = prompt('Payment method name (e.g. HaloPesa):');
      if (!name) return;
      try {
        await api('addList', { list: 'paymentMethods', item: { name, details: '' } });
        invalidateSettings(); renderPM(); toastOK('Added ✓');
      } catch (err) { toastErr(err.message); }
    });

    // househelp categories
    const renderHC = () => {
      const cats = listItems('househelpCategories');
      $('#hc-table').innerHTML = `<table class="data" style="min-width:0"><thead><tr>
        <th>Category</th><th class="num">Min (TZS)</th><th class="num">Max (TZS)</th><th>Description</th><th>Active</th><th></th></tr></thead><tbody>
        ${cats.map(c => `<tr>
          <td><b>${esc(c.name)}</b></td>
          <td class="num">${fmtMoney(c.minprice)}</td><td class="num">${fmtMoney(c.maxprice)}</td>
          <td><span class="row-sub">${esc(c.description || '')}</span></td>
          <td>${c.active === 'No' ? badge('No') : '<span class="badge ok">Yes</span>'}</td>
          <td><div class="table-actions"><button class="icon-btn" title="Edit" data-hce="${esc(c.name)}">✏️</button></div></td>
        </tr>`).join('')}
      </tbody></table>
      <p style="font-size:11.5px;color:var(--text-faint);margin-top:8px">Category prices are Dee Cleaners placement/service pricing — househelp salaries are set per placement.</p>`;
      $$('[data-hce]', $('#hc-table')).forEach(b => b.addEventListener('click', () => {
        const c = listItems('househelpCategories').find(x => x.name === b.dataset.hce);
        hcModal(c);
      }));
    };
    const hcModal = c => {
      const m = openModal('Househelp Category — ' + c.name, `
        <div class="form-grid">
          <div class="field"><label>Name</label>${inputHTML('hc-name', c.name, 'text')}</div>
          <div class="field"><label>Active</label>${selectHTML('hc-active', ['Yes', 'No'], c.active)}</div>
          <div class="field"><label>Min Price (TZS)</label>${inputHTML('hc-min', c.minprice, 'number', '0')}</div>
          <div class="field"><label>Max Price (TZS)</label>${inputHTML('hc-max', c.maxprice, 'number', '0')}</div>
          <div class="field full"><label>Description</label>${inputHTML('hc-desc', c.description, 'text')}</div>
        </div>
        <div class="modal-foot" style="padding:14px 0 0">
          <button class="btn btn-ghost" id="hc-cancel">Cancel</button>
          <button class="btn btn-primary" id="hc-save">Save</button></div>`);
      $('#hc-cancel').addEventListener('click', m.close);
      $('#hc-save').addEventListener('click', async () => {
        try {
          const name = val('hc-name');
          if (name !== c.name) await api('renameList', { list: 'househelpCategories', oldName: c.name, newName: name });
          await api('updateList', { list: 'househelpCategories', name, item: { name, active: val('hc-active'), minprice: valNum('hc-min'), maxprice: valNum('hc-max'), description: val('hc-desc') } });
          invalidateSettings(); m.close(); renderHC(); toastOK('Category saved ✓');
        } catch (err) { toastErr(err.message); }
      });
    };
    renderHC();

    // reference lists (statuses etc.)
    const refLists = [
      { key: 'orderStatuses', label: 'Order Statuses' },
      { key: 'placementStatuses', label: 'Placement Statuses' },
      { key: 'contractStatuses', label: 'Contract Statuses' },
      { key: 'househelpStatuses', label: 'Househelp Statuses' },
      { key: 'complaintStatuses', label: 'Complaint Statuses' },
      { key: 'complaintTypes', label: 'Complaint Types' },
      { key: 'expenseCategories', label: 'Expense Categories' }
    ];
    $('#ref-lists').innerHTML = refLists.map(rl => `
      <div style="margin-bottom:14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <b style="font-size:12.5px">${esc(rl.label)}</b>
          <button class="btn btn-outline btn-sm" data-refadd="${rl.key}">＋</button></div>
        <div style="display:flex;flex-wrap:wrap;gap:6px" data-refwrap="${rl.key}">
          ${listItems(rl.key).map(i => `<span class="badge neutral" style="gap:7px">${esc(i.name)}
            <span style="cursor:pointer" data-refdel="${esc(rl.key)}" data-refname="${esc(i.name)}" title="Delete">✕</span></span>`).join('')}
        </div></div>`).join('');
    $$('[data-refadd]', main).forEach(b => b.addEventListener('click', async () => {
      const name = prompt('New item for ' + b.dataset.refadd + ':');
      if (!name) return;
      try {
        await api('addList', { list: b.dataset.refadd, item: { name } });
        invalidateSettings(); VIEWS.settings();
      } catch (err) { toastErr(err.message); }
    }));
    $$('[data-refdel]', main).forEach(s => s.addEventListener('click', async () => {
      if (await confirmDialog('Delete list item?', `Remove "${s.dataset.refname}"?`, { danger: true })) {
        try {
          await api('deleteList', { list: s.dataset.refdel, name: s.dataset.refname });
          invalidateSettings(); VIEWS.settings();
        } catch (err) { toastErr(err.message); }
      }
    }));

    // API config
    $('#api-save').addEventListener('click', async () => {
      const url = val('api-url');
      if (!url) { setInvalid('api-url', true); toastErr('API URL is required'); return; }
      saveApiConfig(url, val('api-key'));
      settingsCache = null;
      try { await api('getSettings'); toastOK('Connected ✓'); location.hash = '#/dashboard'; router(); }
      catch (err) { toastErr(err.message); }
    });
    $('#api-test').addEventListener('click', async () => {
      try { await api('getSettings'); toastOK('API is reachable ✓'); }
      catch (err) { toastErr(err.message); }
    });
    $('#api-disconnect').addEventListener('click', async () => {
      if (await confirmDialog('Disconnect?', 'Remove the API URL from this device?', { danger: true })) {
        saveApiConfig('', '');
        settingsCache = null;
        router();
      }
    });
  } catch (err) { main.innerHTML = errorHTML(err.message); }
};

/* ==========================================================================
 * 8. Router & boot
 * ========================================================================== */

async function router() {
  const h = location.hash || '#/dashboard';
  window.__deePrevHash = window.__deeLastHash !== undefined ? window.__deeLastHash : h;
  window.__deeLastHash = h;
  if (!apiConfigured()) {
    setActiveNav('settings');
    VIEWS.connect();
    return;
  }
  const route = currentRoute();
  setActiveNav(route);
  const view = VIEWS[route] || VIEWS.dashboard;
  try { await view(); }
  catch (err) {
    $('#main-content').innerHTML = errorHTML(err.message);
  }
}

window.addEventListener('hashchange', router);

$('#menu-btn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
document.addEventListener('click', e => {
  if (window.innerWidth <= 860 && $('#sidebar').classList.contains('open') &&
      !e.target.closest('.sidebar') && e.target.id !== 'menu-btn' && !e.target.closest('#bn-more')) {
    $('#sidebar').classList.remove('open');
  }
});

(async function boot() {
  renderNav();
  await router();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
