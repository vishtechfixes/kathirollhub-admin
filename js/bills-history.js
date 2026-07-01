
//  admin/js/bills-history.js  —  Bill History / Ledger page
// ============================================================

import { getAllBills, fmtDate } from './admin.js';
import { db, doc, updateDoc, getDoc } from '../shared/firebase-config.js';

let allBills = [];
let filtered = [];

async function init() {
  allBills = await getAllBills();
  filtered = [...allBills];
  renderStats();
  renderTable();
}

function renderStats() {
  const today = new Date().toDateString();
  const todayBills = allBills.filter(b => new Date(b.time).toDateString() === today);
  const todayRevenue = todayBills.reduce((s, b) => s + (b.final || 0), 0);
  const pendingCount = allBills.filter(b => b.status === 'pending').length;
  const cancelledCount = allBills.filter(b => b.status === 'cancelled').length;

  document.getElementById('bh-stats').innerHTML = `
    <div class="ss"><span class="ss-icon">🧾</span><div class="ss-val">${allBills.length}</div><div class="ss-lbl">Total Bills</div></div>
    <div class="ss"><span class="ss-icon">💰</span><div class="ss-val g">₹${todayRevenue}</div><div class="ss-lbl">Aaj Revenue</div></div>
    <div class="ss"><span class="ss-icon">⏳</span><div class="ss-val y">${pendingCount}</div><div class="ss-lbl">Pending</div></div>
    <div class="ss"><span class="ss-icon">❌</span><div class="ss-val r">${cancelledCount}</div><div class="ss-lbl">Cancelled</div></div>`;
}

window.bhFilter = function() {
  const q = (document.getElementById('bh-search').value || '').toLowerCase();
  const statusF = document.getElementById('bh-status-filter').value;
  const dateF = document.getElementById('bh-date-filter').value;
  const now = new Date();

  filtered = allBills.filter(b => {
    if (q && !(b.name || '').toLowerCase().includes(q) && !(b.mobile || '').includes(q)) return false;

    const billStatus = b.status || 'paid';
    if (statusF && billStatus !== statusF) return false;

    if (dateF) {
      const billDate = new Date(b.time);
      const diffDays = Math.floor((now - billDate) / 864e5);
      if (dateF === 'today' && billDate.toDateString() !== now.toDateString()) return false;
      if (dateF === 'week' && diffDays > 7) return false;
      if (dateF === 'month' && diffDays > 30) return false;
    }
    return true;
  });
  renderTable();
};

function renderTable() {
  const tbody = document.getElementById('bh-tbody');
  document.getElementById('bh-count').textContent = `${filtered.length} bills mile`;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><span class="ei">🧾</span>Koi bill nahi mila</div></td></tr>`;
    return;
  }

  const sorted = [...filtered].sort((a, b) => new Date(b.time) - new Date(a.time));

  tbody.innerHTML = sorted.map((b, idx) => {
    const status = b.status || 'paid';
    const statusLabel = { paid: '✅ Paid', pending: '⏳ Pending', cancelled: '❌ Cancelled' }[status] || status;
    const payLabel = { cash: '💵 Cash', upi: '📲 UPI', card: '💳 Card' }[b.payment] || b.payment || '—';

    return `<tr>
      <td>
        <div style="font-size:13.5px;font-weight:700;color:var(--txt)">${b.name || '—'}</div>
        <div style="font-size:11px;color:var(--txt3)">${b.mobile || ''}</div>
      </td>
      <td class="hide-sm" style="font-size:12px;color:var(--txt3)">${fmtDate(b.time)}</td>
      <td>
        <div style="font-size:14px;font-weight:800;color:var(--txt)">₹${b.final ?? b.amt ?? 0}</div>
        ${b.amt && b.final && b.amt !== b.final ? `<div style="font-size:10.5px;color:var(--txt3);text-decoration:line-through">₹${b.amt}</div>` : ''}
      </td>
      <td class="hide-sm" style="font-size:12.5px;color:${b.discount > 0 ? 'var(--green)' : 'var(--txt3)'};font-weight:600">
        ${b.discount > 0 ? '-₹' + b.discount : '—'}
      </td>
      <td>
        <span class="status-badge ${status}">${statusLabel}</span>
        ${(b.amountDue > 0) ? `<div style="font-size:10.5px;color:var(--red);font-weight:700;margin-top:3px">₹${b.amountDue} baki</div>` : ''}
      </td>
      <td class="hide-sm" style="font-size:12.5px;color:var(--txt2)">${payLabel}</td>
      <td>
        <div style="display:flex;gap:6px">
          ${(status === 'pending' || status === 'partial') ? `<button class="btn btn-success btn-sm" onclick="bhMarkPaid(${idx})">✅ Mark Paid</button>` : ''}
          ${status !== 'cancelled' ? `<button class="btn btn-danger btn-sm" onclick="bhCancelBill(${idx})">🗑️ Cancel</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ── Cancel bill (basic version — full reversal logic comes in step 3) ──
window.bhCancelBill = async function(idx) {
  const bill = [...filtered].sort((a, b) => new Date(b.time) - new Date(a.time))[idx];
  if (!bill) return;

  const pass = prompt('Bill cancel karne ke liye Admin Password dalein:');
  if (pass === null) return;
  const adminPass = localStorage.getItem('krh_admin_pass') || 'admin123';
  if (pass !== adminPass) { bhToast('❌ Galat password'); return; }

  if (!confirm(`"${bill.name}" ka ₹${bill.final ?? bill.amt} ka bill cancel karna hai? (Points/Visit abhi automatic reverse nahi hoga — yeh Step 3 mein aayega)`)) return;

  try {
    if (bill.id) {
      await updateDoc(doc(db, 'bills', bill.id), { status: 'cancelled' });
    }
    bill.status = 'cancelled';
    const realIdx = allBills.findIndex(b => b.id === bill.id);
    if (realIdx !== -1) allBills[realIdx].status = 'cancelled';
    bhToast('✅ Bill cancel ho gaya');
    renderStats();
    renderTable();
  } catch (e) {
    bhToast('❌ Failed: ' + e.message);
  }
};

// ── Mark a pending/partial bill as fully paid — reduces customer's udhaar ──
window.bhMarkPaid = async function(idx) {
  const bill = [...filtered].sort((a, b) => new Date(b.time) - new Date(a.time))[idx];
  if (!bill || !bill.mobile) return;

  const due = parseFloat(bill.amountDue) || 0;
  if (!confirm(`"${bill.name}" ne baki ₹${due} de diye? Bill 'Paid' mark ho jayega.`)) return;

  try {
    if (bill.id) {
      await updateDoc(doc(db, 'bills', bill.id), { status: 'paid', amountDue: 0 });
    }

    // Reduce customer's totalDebt by this bill's due amount
    const custSnap = await getDoc(doc(db, 'users', bill.mobile));
    if (custSnap.exists()) {
      const custData = custSnap.data();
      const newDebt = Math.max(0, (parseFloat(custData.totalDebt) || 0) - due);
      await updateDoc(doc(db, 'users', bill.mobile), { totalDebt: newDebt });
    }

    bill.status = 'paid';
    bill.amountDue = 0;
    const realIdx = allBills.findIndex(b => b.id === bill.id);
    if (realIdx !== -1) { allBills[realIdx].status = 'paid'; allBills[realIdx].amountDue = 0; }

    bhToast('✅ Payment received — udhaar clear ho gaya!');
    renderStats();
    renderTable();
  } catch (e) {
    bhToast('❌ Failed: ' + e.message);
  }
};

function bhToast(msg, dur = 2500) {
  const t = document.getElementById('bh-toast');
  t.textContent = msg;
  t.style.opacity = '1';
  setTimeout(() => { t.style.opacity = '0'; }, dur);
}

init();





