
// ============================================================
//  admin/js/billing.js  —  Cart-based POS billing
//  Mirrors the proven Firestore pattern from index.html Counter
// ============================================================

import { LS } from '../shared/constants.js';
import {
  db, doc, getDoc, updateDoc, addDoc, collection, query, where, getDocs
} from '../shared/firebase-config.js';

// ── State ──────────────────────────────────────────────────
let cbUser      = null;
let cbCart      = [];     // [{ id, name, price, qty, isCustom, variantName }]
let cbMenu      = [];
let cbPay       = 'cash';
let cbAppliedOffers = []; // ARRAY now — multiple offers can stack
let cbLastBill  = null;
let cbItemIdSeq = 0;

// ── Customer lookup (same pattern as Counter) ────────────────
window.cbLookup = async function() {
  const mob = document.getElementById('cb-mob').value.trim();
  if (mob.length !== 10) { cbToast('10-digit mobile dalein'); return; }

  let found = null;
  try {
    const snap = await getDoc(doc(db, 'users', mob));
    if (snap.exists()) found = { mobile: mob, ...snap.data() };
  } catch (e) { console.warn('Firestore lookup failed', e); }

  if (!found) {
    const users = JSON.parse(localStorage.getItem(LS.users) || '[]');
    found = users.find(u => u.mobile === mob);
  }

  cbUser = found;
  const foundEl = document.getElementById('cb-cust-found');
  if (!cbUser) {
    foundEl.classList.remove('show');
    cbToast('Customer nahi mila. Pehle register karwao.');
    return;
  }

  document.getElementById('cb-cust-name').textContent = cbUser.name;
  document.getElementById('cb-cust-sub').textContent =
    `${cbUser.visits || 0} visits · ${cbUser.points || 0} pts`;

  const udhaarEl = document.getElementById('cb-udhaar-alert');
  const debt = parseFloat(cbUser.totalDebt) || 0;
  if (debt > 0) {
    udhaarEl.style.display = 'block';
    udhaarEl.textContent = `🚨 Inka ₹${debt} udhaar baki hai!`;
  } else {
    udhaarEl.style.display = 'none';
  }

  foundEl.classList.add('show');

  await cbLoadOffers();
};

// ── Load Menu (called once on page init) ─────────────────────
async function cbLoadMenu() {
  try {
    const snap = await getDocs(collection(db, 'menu'));
    cbMenu = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('Menu fetch failed', e);
    cbMenu = JSON.parse(localStorage.getItem(LS.menu) || '[]');
  }
  cbRenderItemResults(cbMenu);
}

// ── Item search/filter ────────────────────────────────────────
window.cbFilterItems = function() {
  const q = document.getElementById('cb-item-search').value.trim().toLowerCase();
  const filtered = q
    ? cbMenu.filter(i => (i.name || '').toLowerCase().includes(q))
    : cbMenu;
  cbRenderItemResults(filtered);
};

function cbRenderItemResults(items) {
  const wrap = document.getElementById('cb-item-results');
  if (!items.length) {
    wrap.innerHTML = '<div style="text-align:center;padding:20px;color:var(--txt3);font-size:13px">Koi item nahi mila</div>';
    return;
  }
  wrap.innerHTML = items.map((it, idx) => {
    const isOut = it.available === false;
    const hasDisc = (parseFloat(it.discount) || 0) > 0;
    const price = parseFloat(it.price) || 0;
    const finalPrice = hasDisc ? Math.round(price * (1 - (parseFloat(it.discount) / 100))) : price;
    const hasVariants = it.variants && it.variants.length > 0;

    let priceHtml;
    if (hasVariants) {
      priceHtml = 'Variants';
    } else if (hasDisc) {
      priceHtml = '<span style="text-decoration:line-through;color:var(--txt3);font-size:11px;margin-right:4px">₹' + price + '</span>₹' + finalPrice;
    } else {
      priceHtml = '₹' + price;
    }

    const clickAttr = isOut ? '' : `onclick="cbItemClicked('${it.id}')"`;
    return `
      <div class="item-row ${isOut ? 'out' : ''}" ${clickAttr}>
        <div>
          <div class="ir-name">${it.emoji || '🌯'} ${it.name}${it.isBestSeller ? ' ⭐' : ''}</div>
          <div class="ir-sub">${isOut ? 'Out of stock' : (it.category || '')}</div>
        </div>
        <div class="ir-price">${priceHtml}</div>
      </div>`;
  }).join('');
}

// ── Item clicked → add to cart (handle variants) ──────────────
window.cbItemClicked = function(itemId) {
  const item = cbMenu.find(i => i.id === itemId);
  if (!item) return;

  if (item.variants && item.variants.length > 0) {
    // Ask which variant via simple prompt-based chooser
    const names = item.variants.map((v, i) => `${i + 1}. ${v.name} — ₹${v.price}`).join('\n');
    const choice = prompt(`"${item.name}" — variant chuno:\n${names}\n\nNumber likho:`, '1');
    const idx = parseInt(choice) - 1;
    if (isNaN(idx) || !item.variants[idx]) return;
    const v = item.variants[idx];
    cbAddToCart(item.name, v.price, v.name, item.discount || 0);
  } else {
    const hasDisc = (parseFloat(item.discount) || 0) > 0;
    const price = parseFloat(item.price) || 0;
    const finalPrice = hasDisc ? Math.round(price * (1 - (parseFloat(item.discount) / 100))) : price;
    cbAddToCart(item.name, finalPrice, null, 0);
  }
};

// ── Cart management ────────────────────────────────────────────
function cbAddToCart(name, price, variantName, discPct) {
  // If same name+variant already in cart, just bump qty
  const existing = cbCart.find(c => c.name === name && c.variantName === variantName && !c.isCustom);
  if (existing) {
    existing.qty += 1;
  } else {
    cbCart.push({
      id: 'c' + (cbItemIdSeq++),
      name, price, qty: 1,
      variantName: variantName || null,
      isCustom: false
    });
  }
  cbRenderCart();
}

window.cbQtyChange = function(cartId, delta) {
  const row = cbCart.find(c => c.id === cartId);
  if (!row) return;
  row.qty += delta;
  if (row.qty <= 0) {
    cbCart = cbCart.filter(c => c.id !== cartId);
  }
  cbRenderCart();
};

window.cbRemoveItem = function(cartId) {
  cbCart = cbCart.filter(c => c.id !== cartId);
  cbRenderCart();
};

function cbRenderCart() {
  const listEl  = document.getElementById('cb-cart-list');
  const emptyEl = document.getElementById('cb-empty-cart');
  const countEl = document.getElementById('cb-cart-count');
  const sumSec  = document.getElementById('cb-summary-section');

  const totalQty = cbCart.reduce((s, c) => s + c.qty, 0);
  countEl.textContent = totalQty ? `(${totalQty} items)` : '';

  if (!cbCart.length) {
    listEl.innerHTML = '';
    listEl.appendChild(emptyEl);
    emptyEl.style.display = 'block';
    sumSec.style.display = 'none';
    return;
  }

  listEl.innerHTML = cbCart.map(c => `
    <div class="cart-row">
      <div>
        <div class="cr-name">${c.name}${c.isCustom ? ' <span style="font-size:10px;color:var(--txt3)">(custom)</span>' : ''}</div>
        ${c.variantName ? `<div class="cr-variant">${c.variantName}</div>` : ''}
      </div>
      <div class="qty-ctrl">
        <button class="qty-btn" onclick="cbQtyChange('${c.id}',-1)">−</button>
        <span class="qty-val">${c.qty}</span>
        <button class="qty-btn" onclick="cbQtyChange('${c.id}',1)">+</button>
      </div>
      <div class="cr-price">₹${c.price * c.qty}</div>
      <button class="cr-del" onclick="cbRemoveItem('${c.id}')" title="Remove">🗑️</button>
    </div>`).join('');

  sumSec.style.display = 'block';
  cbRenderSummary();
}

// ── Custom item ─────────────────────────────────────────────
window.cbOpenCustomItem = function() {
  document.getElementById('cb-ci-name').value = '';
  document.getElementById('cb-ci-price').value = '';
  document.getElementById('cb-custom-modal').classList.add('open');
};
window.cbCloseCustomItem = function() {
  document.getElementById('cb-custom-modal').classList.remove('open');
};
window.cbAddCustomItem = function() {
  const name  = document.getElementById('cb-ci-name').value.trim();
  const price = parseFloat(document.getElementById('cb-ci-price').value) || 0;
  if (!name || price <= 0) { cbToast('Naam aur price dono dalein'); return; }

  cbCart.push({
    id: 'c' + (cbItemIdSeq++),
    name, price, qty: 1, variantName: null, isCustom: true
  });
  cbRenderCart();
  cbCloseCustomItem();
};

// ── Offers (same Firestore pattern as Counter) ────────────────
async function cbLoadOffers() {
  if (!cbUser) return;
  const mob = cbUser.mobile;
  const offersCardEl = document.getElementById('cb-offers-card');
  const listEl = document.getElementById('cb-offers-list');

  const offers = [];
  const today = new Date();
  const discPctSettings = JSON.parse(localStorage.getItem(LS.settings) || '{}');
  const welcomeDisc = discPctSettings.defaultWelcomeDisc || 10;

  if ((cbUser.visits || 0) === 0) {
    offers.push({
      label: 'Welcome Discount', pct: welcomeDisc, flat: 0,
      code: 'ROLL' + mob.slice(-4).toUpperCase(), type: 'welcome', rewardId: null
    });
  }
  const dob = cbUser.dob ? new Date(cbUser.dob) : null;
  if (dob && dob.getDate() === today.getDate() && dob.getMonth() === today.getMonth()) {
    offers.push({
      label: '🎂 Birthday Special', pct: 15, flat: 0,
      code: 'BDAY' + mob.slice(-4).toUpperCase() + today.getFullYear(), type: 'birthday', rewardId: null
    });
  }

  try {
    const snap = await getDocs(query(collection(db, 'rewards'), where('active', '==', true)));
    snap.forEach(d => {
      const rw = d.data();
      if (rw.targetMobile && rw.targetMobile !== mob) return;
      const alreadyUsed = rw.singleUse && rw.usedBy && rw.usedBy.indexOf(mob) !== -1;
      const maxedOut = rw.maxUses && (rw.usageCount || 0) >= rw.maxUses;
      const expired = rw.expiryDate && new Date(rw.expiryDate) < today;
      if (alreadyUsed || maxedOut || expired) return;

      const rType = rw.type || 'discount';
      const rVal = rw.value || rw.discountPct || 0;
      let pct = 0, flat = 0;
      if (rType === 'cashback') flat = parseFloat(rVal) || 0;
      else if (rType === 'discount') pct = parseInt(rVal) || 0;

      offers.push({
        label: (rw.targetMobile ? '💜 ' : '🎁 ') + (rw.title || rw.label || rw.name || 'Offer'),
        pct, flat, code: rw.code || '', type: 'reward', rewardId: d.id
      });
    });
  } catch (e) { console.warn('rewards fetch failed', e); }

  if (!offers.length) { offersCardEl.style.display = 'none'; return; }
  offersCardEl.style.display = 'block';
  listEl.innerHTML = '<p style="font-size:11px;color:var(--txt3);margin-bottom:8px">Multiple offers select kar sakte ho — sabhi ek saath stack honge</p>'
    + offers.map((o, i) => `
    <span class="offer-chip" onclick="cbSelectOffer(${i})" data-idx="${i}">
      ${o.label} ${o.pct > 0 ? '(' + o.pct + '%)' : (o.flat > 0 ? '(₹' + o.flat + ')' : '')}
    </span>`).join('');
  window._cbOffersCache = offers;
}

// ── Multi-select: clicking a chip toggles JUST that chip,
//    other already-selected chips stay selected (stacking) ──────
window.cbSelectOffer = function(idx) {
  const offers = window._cbOffersCache || [];
  const o = offers[idx];
  if (!o) return;

  const chips = document.querySelectorAll('.offer-chip');
  const chip = chips[idx];
  const isOn = chip.classList.contains('on');

  if (isOn) {
    // Deselect just this one
    chip.classList.remove('on');
    cbAppliedOffers = cbAppliedOffers.filter(applied => applied !== o);
  } else {
    // Select this one too, keep others as-is
    chip.classList.add('on');
    cbAppliedOffers.push(o);
  }
  cbRenderSummary();
};

// ── Summary calculation ────────────────────────────────────────
function cbSubtotal() {
  return cbCart.reduce((s, c) => s + (c.price * c.qty), 0);
}

// ── Total discount across ALL applied offers ──────────────────
function cbTotalDiscount(subtotal) {
  let disc = 0;
  cbAppliedOffers.forEach(o => {
    if (o.flat > 0) {
      disc += o.flat;
    } else if (o.pct > 0) {
      disc += Math.round(subtotal * (o.pct / 100));
    }
  });
  // Never let combined discount exceed the subtotal
  return Math.min(disc, subtotal);
}

function cbRenderSummary() {
  const subtotal = cbSubtotal();
  const disc = cbTotalDiscount(subtotal);
  const total = subtotal - disc;

  document.getElementById('cb-subtotal').textContent = '₹' + subtotal;
  const discRow = document.getElementById('cb-disc-row');
  if (disc > 0) {
    discRow.style.display = 'flex';
    document.getElementById('cb-disc-amt').textContent = '-₹' + disc;
  } else {
    discRow.style.display = 'none';
  }
  document.getElementById('cb-total').textContent = '₹' + total;
}

window.cbSelPay = function(el, method) {
  document.querySelectorAll('.pay-btn').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  cbPay = method;
};

// ── Payment status (Full Paid / Partial / Udhaar) — auto-detected ──
window.cbUpdatePaymentStatus = function() {
  const subtotal = cbSubtotal();
  const disc = cbTotalDiscount(subtotal);
  const total = subtotal - disc;
  const paidInput = document.getElementById('cb-amt-paid');
  const statusEl = document.getElementById('cb-payment-status');

  const paidVal = paidInput.value.trim();
  if (paidVal === '') { statusEl.style.display = 'none'; return; }

  const paid = parseFloat(paidVal) || 0;
  const due = Math.max(0, total - paid);

  statusEl.style.display = 'block';
  if (due <= 0) {
    statusEl.innerHTML = '<span style="color:var(--green);font-weight:700;font-size:12.5px">✅ Full Paid</span>';
  } else if (paid > 0) {
    statusEl.innerHTML = `<span style="color:#92400e;font-weight:700;font-size:12.5px">⏳ Partial — ₹${due} baki rahega (Udhaar)</span>`;
  } else {
    statusEl.innerHTML = `<span style="color:var(--red);font-weight:700;font-size:12.5px">🚨 Pura Udhaar — ₹${due}</span>`;
  }
};

// ── Confirm (single trigger — saves everything atomically) ────
window.cbConfirm = async function() {
  if (!cbUser) { cbToast('Pehle customer dhundo'); return; }
  if (!cbCart.length) { cbToast('Cart khali hai'); return; }

  const btn = document.getElementById('cb-confirm-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Saving...';

  const subtotal = cbSubtotal();
  const disc = cbTotalDiscount(subtotal);
  const final = subtotal - disc;
  const mob = cbUser.mobile;
  const nowIso = new Date().toISOString();

  // ── Payment status calculation ───────────────────────────
  const paidInputVal = document.getElementById('cb-amt-paid').value.trim();
  const amountPaid = paidInputVal === '' ? final : (parseFloat(paidInputVal) || 0);
  const amountDue = Math.max(0, final - amountPaid);
  const paymentStatus = amountDue <= 0 ? 'paid' : (amountPaid > 0 ? 'partial' : 'pending');

  const s = JSON.parse(localStorage.getItem(LS.settings) || '{}');
  const goal = s.defaultVisitThreshold || 5;
  const visitBonus = s.defaultPerVisitPts || 5;
  const perRupeeRate = s.pointsPer10Rs || 0;
  const spendPts = Math.floor((subtotal / 10) * perRupeeRate);
  const ptsAdd = visitBonus + spendPts;

  const newVisits = (cbUser.visits || 0) + 1;
  const newPoints = (cbUser.points || 0) + ptsAdd;
  const newSaved = (cbUser.saved || 0) + disc;
  const newDebt = Math.max(0, (parseFloat(cbUser.totalDebt) || 0) + amountDue);

  let saveOk = true;
  const extraFields = { totalDebt: newDebt };
  // Check ALL applied offers for welcome/birthday auto-mark (not just one)
  cbAppliedOffers.forEach(o => {
    if (o.type === 'welcome')  extraFields.couponUsed_welcome  = nowIso;
    if (o.type === 'birthday') extraFields.couponUsed_birthday = nowIso;
  });

  try {
    await updateDoc(doc(db, 'users', mob), {
      visits: newVisits, points: newPoints, saved: newSaved,
      lastVisit: nowIso, ...extraFields
    });
  } catch (e) { console.warn('customer update failed', e); saveOk = false; }

  const itemsSnapshot = cbCart.map(c => ({ name: c.name, qty: c.qty, price: c.price, variant: c.variantName || null }));

  // Build a readable label of all applied offers for the bill record
  const offerLabel = cbAppliedOffers.length
    ? cbAppliedOffers.map(o => o.type === 'reward' ? 'reward' : o.type).join('+')
    : 'none';

  let billId = null;
  try {
    const billRef = await addDoc(collection(db, 'bills'), {
      mobile: mob, name: cbUser.name, amt: subtotal, final, discount: disc,
      offer: offerLabel,
      offersApplied: cbAppliedOffers.map(o => ({ label: o.label, type: o.type, pct: o.pct, flat: o.flat, code: o.code })),
      payment: cbPay, time: nowIso, visitNumber: newVisits,
      pointsEarned: ptsAdd, items: itemsSnapshot,
      status: paymentStatus, amountPaid, amountDue
    });
    billId = billRef.id;
  } catch (e) { console.warn('bill add failed', e); saveOk = false; }

  // Mark EVERY applied reward as used (not just one)
  for (const appliedOffer of cbAppliedOffers) {
    if (appliedOffer.type !== 'reward' || !appliedOffer.rewardId) continue;
    const offerShare = appliedOffer.flat > 0
      ? appliedOffer.flat
      : Math.round(subtotal * (appliedOffer.pct / 100));
    if (offerShare <= 0) continue;
    try {
      const rwRef = doc(db, 'rewards', appliedOffer.rewardId);
      const rwDoc = await getDoc(rwRef);
      if (rwDoc.exists()) {
        const rw = rwDoc.data();
        const usedBy = rw.usedBy || [];
        if (usedBy.indexOf(mob) === -1) usedBy.push(mob);
        const amounts = rw.savedAmounts || {};
        amounts[mob] = (parseInt(amounts[mob]) || 0) + offerShare;
        await updateDoc(rwRef, {
          usageCount: (rw.usageCount || 0) + 1,
          usedBy, savedAmount: (parseInt(rw.savedAmount) || 0) + offerShare,
          savedAmounts: amounts
        });
      }
    } catch (e) { console.warn('reward mark-used failed', e); }
  }

  // LocalStorage offline fallback
  const users = JSON.parse(localStorage.getItem(LS.users) || '[]');
  const idx = users.findIndex(u => u.mobile === mob);
  if (idx !== -1) {
    users[idx].visits = newVisits; users[idx].points = newPoints; users[idx].saved = newSaved;
    localStorage.setItem(LS.users, JSON.stringify(users));
  }
  const bills = JSON.parse(localStorage.getItem(LS.bills) || '[]');
  bills.unshift({ mobile: mob, name: cbUser.name, amt: subtotal, final, discount: disc, payment: cbPay, time: nowIso, pointsEarned: ptsAdd });
  localStorage.setItem(LS.bills, JSON.stringify(bills));

  btn.disabled = false;
  btn.textContent = '✅ Confirm & Save Bill';

  if (!saveOk) {
    alert('⚠️ Kuch save nahi hua — internet check karo aur dobara try karo.');
    return;
  }

  cbLastBill = {
    name: cbUser.name, mobile: mob, amt: subtotal, final, disc, pay: cbPay,
    points: newPoints, pointsEarned: ptsAdd, visits: newVisits, billId,
    isMilestone: newVisits % goal === 0,
    rewardLabel: s.defaultVisitReward || 'FREE item',
    items: itemsSnapshot
  };

  document.querySelector('.pos-grid').style.display = 'none';
  document.getElementById('cart-success').style.display = 'block';
  document.getElementById('cs-title').textContent = cbLastBill.isMilestone ? `🎉 Visit ${newVisits} — Milestone!` : '✅ Bill Saved!';
  document.getElementById('cs-sub').textContent = cbLastBill.isMilestone
    ? `${cbUser.name} ko ${cbLastBill.rewardLabel} milega! · +${ptsAdd} pts`
    : `${cbUser.name} · ₹${final} · +${ptsAdd} pts`;

  // ── Populate itemized bill summary ─────────────────────────
  const itemsListEl = document.getElementById('cs-items-list');
  itemsListEl.innerHTML = itemsSnapshot.map(i => `
    <div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;color:var(--txt2)">
      <span>${i.name}${i.variant ? ' (' + i.variant + ')' : ''} <span style="color:var(--txt3)">x${i.qty}</span></span>
      <span style="font-weight:700;color:var(--txt)">₹${i.price * i.qty}</span>
    </div>`).join('');

  document.getElementById('cs-subtotal').textContent = '₹' + subtotal;
  const discRowEl = document.getElementById('cs-disc-row');
  if (disc > 0) {
    discRowEl.style.display = 'flex';
    document.getElementById('cs-disc-amt').textContent = '-₹' + disc;
  } else {
    discRowEl.style.display = 'none';
  }
  document.getElementById('cs-final').textContent = '₹' + final;
  document.getElementById('cs-payment').textContent = { cash: '💵 Cash', upi: '📲 UPI', card: '💳 Card' }[cbPay] || cbPay;
  document.getElementById('cs-points').textContent = '+' + ptsAdd;

  const dueRowEl = document.getElementById('cs-due-row');
  if (amountDue > 0) {
    dueRowEl.style.display = 'flex';
    document.getElementById('cs-due-amt').textContent = '₹' + amountDue;
  } else {
    dueRowEl.style.display = 'none';
  }
};

window.cbWhatsAppReceipt = function() {
  if (!cbLastBill) return;
  const b = cbLastBill;
  const sh = JSON.parse(localStorage.getItem(LS.shop) || '{}');
  const lines = b.items.map(i => `${i.name}${i.variant ? ' (' + i.variant + ')' : ''} x${i.qty} = ₹${i.price * i.qty}`).join('\n');
  const msg = encodeURIComponent(
    `🧾 *${sh.name || 'Kathi Roll Hub'} — Bill Receipt*\n────────────────\n` +
    `👤 ${b.name}\n📱 ${b.mobile}\n────────────────\n${lines}\n────────────────\n` +
    `💰 Subtotal: ₹${b.amt}\n${b.disc > 0 ? '🎁 Discount: -₹' + b.disc + '\n' : ''}✅ *Final: ₹${b.final}*\n💳 ${b.pay.toUpperCase()}\n────────────────\n` +
    `⭐ Points Earned: +${b.pointsEarned}\n⭐ Total Points: ${b.points}\nDhanyawaad! Dobara aana 🙏`
  );
  window.open(`https://wa.me/${b.mobile}?text=${msg}`, '_blank');
};

window.cbPrintReceipt = function() {
  if (!cbLastBill) return;
  const b = cbLastBill;
  const sh = JSON.parse(localStorage.getItem(LS.shop) || '{}');
  const rows = b.items.map(i => `<div class="row"><span>${i.name}${i.variant ? ' (' + i.variant + ')' : ''} x${i.qty}</span><span>₹${i.price * i.qty}</span></div>`).join('');
  const html = `<html><head><title>Receipt</title><style>
    body{font-family:monospace;width:280px;margin:0 auto;padding:16px;font-size:13px}
    .c{text-align:center} .b{font-weight:700} hr{border:none;border-top:1px dashed #000;margin:8px 0}
    .row{display:flex;justify-content:space-between}
  </style></head><body>
    <div class="c b" style="font-size:15px">${sh.name || 'Kathi Roll Hub'}</div>
    <div class="c">${sh.loc || ''}</div><hr/>
    <div class="row"><span>Customer</span><span class="b">${b.name}</span></div>
    <div class="row"><span>Mobile</span><span>${b.mobile}</span></div>
    <div class="row"><span>Date</span><span>${new Date().toLocaleString('en-IN')}</span></div><hr/>
    ${rows}<hr/>
    <div class="row"><span>Subtotal</span><span>₹${b.amt}</span></div>
    ${b.disc > 0 ? '<div class="row"><span>Discount</span><span>-₹' + b.disc + '</span></div>' : ''}
    <div class="row b" style="font-size:15px"><span>Final</span><span>₹${b.final}</span></div>
    <div class="row"><span>Payment</span><span>${b.pay.toUpperCase()}</span></div><hr/>
    <div class="row"><span>Points Earned</span><span>+${b.pointsEarned}</span></div>
    <div class="row"><span>Total Points</span><span>${b.points}</span></div><hr/>
    <div class="c">Dhanyawaad! Dobara aana 🙏</div>
  </body></html>`;
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 250);
};

window.cbNewBill = function() {
  cbUser = null; cbCart = []; cbAppliedOffers = []; cbPay = 'cash'; cbLastBill = null;
  document.getElementById('cb-mob').value = '';
  document.getElementById('cb-cust-found').classList.remove('show');
  document.getElementById('cb-udhaar-alert').style.display = 'none';
  document.getElementById('cb-item-search').value = '';
  document.getElementById('cb-amt-paid').value = '';
  document.getElementById('cb-payment-status').style.display = 'none';
  document.getElementById('cb-offers-card').style.display = 'none';
  document.querySelector('.pos-grid').style.display = 'grid';
  document.getElementById('cart-success').style.display = 'none';
  cbRenderItemResults(cbMenu);
  cbRenderCart();
};

function cbToast(msg, dur = 2500) {
  const t = document.getElementById('cb-toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

// ── Init ─────────────────────────────────────────────────────
cbLoadMenu();





