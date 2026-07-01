














// ============================================================
//  admin/js/rewards.js
//  Rewards & Coupons management
//  Firebase-first, LocalStorage fallback
// ============================================================

import { getShopInfo } from './admin.js';

// ── Firebase (ready to connect) ──────────────────────────────
let db, docFn, collFn, setDocFn, getDocFn, getDDocsFn,
    updateDocFn, deleteDocFn, addDocFn,
    queryFn, whereFn, orderByFn, FIREBASE_READY = false;

async function initFirebase() {
  try {
    const cfg  = await import('../../shared/firebase-config.js');
    db          = cfg.db;
    docFn       = cfg.doc;
    collFn      = cfg.collection;
    setDocFn    = cfg.setDoc;
    getDocFn    = cfg.getDoc;
    getDDocsFn  = cfg.getDocs;
    updateDocFn = cfg.updateDoc;
    deleteDocFn = cfg.deleteDoc;
    addDocFn    = cfg.addDoc;
    queryFn     = cfg.query;
    whereFn     = cfg.where;
    orderByFn   = cfg.orderBy;
    FIREBASE_READY = true;
  } catch (e) {
    FIREBASE_READY = false;
  }
}

// ── Auto-init Firebase on module load ────────────────────────
const _fbReady = initFirebase();

// ── LocalStorage key ─────────────────────────────────────────
const RK = 'krh_rewards';

// ── Reward types & conditions ────────────────────────────────
export const REWARD_TYPES = {
  discount:  { label: 'Discount %',    icon: '🏷️' },
  cashback:  { label: 'Cashback ₹',    icon: '💵' },
  free_item: { label: 'Free Item',     icon: '🎁' },
};

export const REWARD_CONDITIONS = {
  on_register: { label: 'On Registration',  icon: '🆕' },
  nth_visit:   { label: 'Nth Visit',         icon: '🔁' },
  birthday:    { label: 'Birthday',          icon: '🎂' },
  manual:      { label: 'Manual (Admin)',    icon: '✋' },
  date_range:  { label: 'Specific Dates',   icon: '📅' },
};

// ============================================================
//  DB HELPERS
// ============================================================

/** Get all rewards */
export async function getAllRewards() {
  await _fbReady;
  if (FIREBASE_READY) {
    try {
      const snap = await getDDocsFn(
        queryFn(collFn(db, 'rewards'), orderByFn('createdAt', 'desc'))
      );
      const rewards = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Sync to LS
      localStorage.setItem(RK, JSON.stringify(rewards));
      return rewards;
    } catch (e) {
      console.warn('Firestore read failed, using LS:', e.message);
    }
  }
  return JSON.parse(localStorage.getItem(RK) || '[]');
}

/** Create new reward */
export async function createReward(data) {
  await _fbReady;
  const reward = {
    ...data,
    id:         data.id || Date.now().toString(),
    active:     true,
    usageCount: 0,
    usedBy:     [],
    createdAt:  new Date().toISOString(),
  };

  if (FIREBASE_READY) {
    try {
      await setDocFn(docFn(db, 'rewards', reward.id), reward);
    } catch (e) {
      console.warn('Firestore write failed:', e.message);
    }
  }

  const all = JSON.parse(localStorage.getItem(RK) || '[]');
  all.unshift(reward);
  localStorage.setItem(RK, JSON.stringify(all));
  return reward;
}

/** Toggle reward active/inactive */
export async function toggleReward(id, active) {
  if (FIREBASE_READY) {
    try {
      await updateDocFn(docFn(db, 'rewards', id), { active });
    } catch (e) { console.warn(e.message); }
  }
  const all = JSON.parse(localStorage.getItem(RK) || '[]');
  const idx = all.findIndex(r => r.id === id);
  if (idx !== -1) { all[idx].active = active; localStorage.setItem(RK, JSON.stringify(all)); }
}

/** Delete reward */
export async function deleteReward(id) {
  if (FIREBASE_READY) {
    try {
      await deleteDocFn(docFn(db, 'rewards', id));
    } catch (e) { console.warn(e.message); }
  }
  const all = JSON.parse(localStorage.getItem(RK) || '[]').filter(r => r.id !== id);
  localStorage.setItem(RK, JSON.stringify(all));
}

/** Update usage when customer redeems */
export async function markRewardUsed(rewardId, customerMobile) {
  const all = JSON.parse(localStorage.getItem(RK) || '[]');
  const idx = all.findIndex(r => r.id === rewardId);
  if (idx === -1) return;

  all[idx].usageCount = (all[idx].usageCount || 0) + 1;
  if (!all[idx].usedBy) all[idx].usedBy = [];
  if (!all[idx].usedBy.includes(customerMobile)) {
    all[idx].usedBy.push(customerMobile);
  }
  localStorage.setItem(RK, JSON.stringify(all));

  if (FIREBASE_READY) {
    try {
      await updateDocFn(docFn(db, 'rewards', rewardId), {
        usageCount: all[idx].usageCount,
        usedBy:     all[idx].usedBy,
      });
    } catch (e) { console.warn(e.message); }
  }
}

/**
 * getRewardsForCustomer — called from customer dashboard
 * Returns only active rewards that apply to this user
 */
export async function getRewardsForCustomer(user) {
  const all    = await getAllRewards();
  const today  = new Date();
  const active = all.filter(r => {
    if (!r.active) return false;
    // Expiry check
    if (r.expiryDate && new Date(r.expiryDate) < today) return false;
    // Already used check (if singleUse)
    if (r.singleUse && r.usedBy?.includes(user.mobile)) return false;
    // Condition check
    if (r.condition === 'on_register') return !user.welcomeUsed;
    if (r.condition === 'birthday') {
      const dob = user.dob ? new Date(user.dob) : null;
      return dob && dob.getDate() === today.getDate() && dob.getMonth() === today.getMonth();
    }
    if (r.condition === 'nth_visit') {
      const n = parseInt(r.conditionValue) || 5;
      return (user.visits || 0) > 0 && (user.visits || 0) % n === 0;
    }
    if (r.condition === 'date_range') {
      const from = r.startDate ? new Date(r.startDate) : null;
      const to   = r.expiryDate ? new Date(r.expiryDate) : null;
      return (!from || today >= from) && (!to || today <= to);
    }
    if (r.condition === 'manual') return false; // admin assigns directly
    return true;
  });
  return active;
}

/** Auto-generate coupon code */
export function generateCode(title = '') {
  const words = title.replace(/[^a-zA-Z ]/g, '').toUpperCase().split(' ').filter(Boolean);
  const base  = words.slice(0, 2).join('').slice(0, 6) || 'KRH';
  const rand  = Math.floor(Math.random() * 900 + 100);
  return base + rand;
}