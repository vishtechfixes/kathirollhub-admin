// ============================================================
//  admin/js/export.js
//  Data export to CSV — Firebase-first, LocalStorage fallback
//
//  Exports:
//    initExport()
//    getExportCounts()
//    exportCSV(type)             — full export
//    exportCSVRange(type, from, to) — date range export
// ============================================================

import { getAllUsers, getAllBills, getMenu } from './admin.js';

// ── Firebase ─────────────────────────────────────────────────
let db, collFn, getDDocsFn,
    queryFn, orderByFn, whereFn,
    FIREBASE_READY = false;

// ============================================================
//  initExport()
// ============================================================
export async function initExport() {
  try {
    const cfg = await import('../../shared/firebase-config.js');
    db          = cfg.db;
    collFn      = cfg.collection;
    getDDocsFn  = cfg.getDocs;
    queryFn     = cfg.query;
    orderByFn   = cfg.orderBy;
    whereFn     = cfg.where;
    FIREBASE_READY = true;
    console.log('[export.js] Firebase connected ✅');
  } catch (e) {
    FIREBASE_READY = false;
    console.warn('[export.js] Firebase offline — LocalStorage fallback', e.message);
  }
}

// ============================================================
//  getExportCounts()
//  Export page pe stat cards ke liye record counts
// ============================================================
export async function getExportCounts() {
  const [users, bills, menu] = await Promise.all([
    getAllUsers(),
    getAllBills(),
    getMenu(),
  ]);
  const points = JSON.parse(localStorage.getItem('krh_pts_history') || '[]');
  return {
    customers: users.length,
    bills:     bills.length,
    menu:      menu.length,
    points:    points.length,
  };
}

// ============================================================
//  exportCSV(type)
//  type: 'customers' | 'bills' | 'menu' | 'points'
//  Downloads a .csv file
// ============================================================
export async function exportCSV(type) {
  const today = new Date().toISOString().slice(0,10);
  const { headers, rows, filename } = await _buildCSV(type, null, null, today);
  _download(filename, headers, rows);
  return { filename, rows: rows.length };
}

// ============================================================
//  exportCSVRange(type, from, to)
//  Date range filter — from & to are 'YYYY-MM-DD' strings
// ============================================================
export async function exportCSVRange(type, from, to) {
  const today    = new Date().toISOString().slice(0,10);
  const fromDate = from || null;
  const toDate   = to   || today;
  const { headers, rows, filename } = await _buildCSV(type, fromDate, toDate, today);
  _download(filename, headers, rows);
  return { filename, rows: rows.length };
}

// ============================================================
//  INTERNAL — _buildCSV
// ============================================================
async function _buildCSV(type, fromDate, toDate, today) {
  let headers = [], rows = [], filename = '';

  // ── Date filter helper ──────────────────────────────────
  function inRange(dateStr) {
    if (!fromDate && !toDate) return true;
    const d = dateStr ? dateStr.slice(0,10) : '';
    if (!d) return true;
    if (fromDate && d < fromDate) return false;
    if (toDate   && d > toDate)   return false;
    return true;
  }

  if (type === 'customers') {
    // ─────────────────────────────────────────────────────
    //  CUSTOMERS
    // ─────────────────────────────────────────────────────
    let users = await getAllUsers();
    if (fromDate || toDate) {
      users = users.filter(u => inRange(u.joined));
    }
    headers  = ['Name','Mobile','DOB','Area','Veg/Non-veg','Visits','Points',
                'Saved ₹','Referrals','Referred By','Joined','Fav Items','Fraud Flag'];
    rows     = users.map(u => [
      u.name        || '',
      u.mobile      || '',
      u.dob         || '',
      u.area        || '',
      u.vegPref     || '',
      u.visits      || 0,
      u.points      || 0,
      u.saved        || 0,
      u.referrals   || 0,
      u.referredBy  || '',
      u.joined      || '',
      (u.favItems || []).join(' | '),
      u.fraudFlag   ? 'Yes' : 'No',
    ]);
    filename = 'customers-' + today + '.csv';

  } else if (type === 'bills') {
    // ─────────────────────────────────────────────────────
    //  BILLS
    // ─────────────────────────────────────────────────────
    let bills = await getAllBills();
    if (fromDate || toDate) {
      bills = bills.filter(b => inRange(b.time));
    }
    headers = ['Bill ID','Name','Mobile','Items','Amount ₹','Discount ₹',
               'Final ₹','Offer','Payment','Visit No','Date','Time'];
    rows    = bills.map(b => {
      const dt   = b.time ? new Date(b.time) : null;
      const date = dt ? dt.toLocaleDateString('en-IN') : '';
      const time = dt ? dt.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : '';
      const itemsStr = Array.isArray(b.items)
        ? b.items.map(i => i.name + ' x' + i.qty).join(' | ')
        : '';
      return [
        b.id         || '',
        b.name       || '',
        b.mobile     || '',
        itemsStr,
        b.amt        || 0,
        b.discount   || 0,
        b.final      || 0,
        b.offer      || '',
        b.payment    || '',
        b.visitNumber|| '',
        date, time,
      ];
    });
    filename = 'bills-' + today + '.csv';

  } else if (type === 'menu') {
    // ─────────────────────────────────────────────────────
    //  MENU / INVENTORY
    // ─────────────────────────────────────────────────────
    const menu = await getMenu();
    headers    = ['Name','Emoji','Type','Category','Price ₹','Cost ₹',
                  'Margin %','Discount %','Stock','Available','Show On App','Added'];
    rows       = menu.map(m => {
      const margin = m.cost && m.price
        ? Math.round((m.price - m.cost) / m.price * 100)
        : '';
      return [
        m.name       || '',
        m.emoji      || '',
        m.type       || '',
        m.category   || '',
        m.price      || 0,
        m.cost       || 0,
        margin,
        m.discount   || 0,
        m.stock      || 0,
        m.available  !== false ? 'Yes' : 'No',
        m.showOnApp  !== false ? 'Yes' : 'No',
        m.addedAt    ? m.addedAt.slice(0,10) : '',
      ];
    });
    filename = 'inventory-' + today + '.csv';

  } else if (type === 'points') {
    // ─────────────────────────────────────────────────────
    //  POINTS HISTORY
    // ─────────────────────────────────────────────────────
    let hist = JSON.parse(localStorage.getItem('krh_pts_history') || '[]');
    if (fromDate || toDate) {
      hist = hist.filter(h => inRange(h.time));
    }
    // Also try Firebase
    if (FIREBASE_READY && hist.length === 0) {
      try {
        const snap = await getDDocsFn(
          queryFn(collFn(db, 'rollhub_transactions'), orderByFn('time', 'desc'))
        );
        hist = snap.docs.map(d => d.data());
        if (fromDate || toDate) hist = hist.filter(h => inRange(h.time));
      } catch(e) { /* use LS */ }
    }
    headers  = ['Name','Mobile','Points','Reason','Date','Time'];
    rows     = hist.map(h => {
      const dt   = h.time ? new Date(h.time) : null;
      const date = dt ? dt.toLocaleDateString('en-IN') : '';
      const time = dt ? dt.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : '';
      return [
        h.name   || '',
        h.mobile || '',
        h.amount || 0,
        h.reason || '',
        date, time,
      ];
    });
    filename = 'points-' + today + '.csv';
  }

  return { headers, rows, filename };
}

// ============================================================
//  _download(filename, headers, rows)
//  Build CSV string aur browser download trigger karo
// ============================================================
function _download(filename, headers, rows) {
  // BOM for Excel to correctly show Hindi/Unicode text
  const BOM = '\uFEFF';

  const escape = (val) => {
    const s = String(val === null || val === undefined ? '' : val);
    // Wrap in quotes if contains comma, quote, or newline
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  const lines = [
    headers.map(escape).join(','),
    ...rows.map(row => row.map(escape).join(',')),
  ];

  const csv  = BOM + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}