


// ============================================================
//  admin/js/admin.js  —  Firebase-FIRST version
//
//  SETUP:
//  1. shared/firebase-config.js mein apni Firebase keys daalo
//  2. Firestore Database enable karo
//  3. firebase-config.js mein increment import add karo:
//     export { increment } from "https://...firebase-firestore.js";
// ============================================================

import { LS, COLLECTIONS, DEFAULTS } from '../shared/constants.js';

// ── Firebase imports ─────────────────────────────────────────
let db, docFn, collFn,
    getDocFn, getDDocsFn,
    setDocFn, updateDocFn, addDocFn, deleteDocFn,
    queryFn, whereFn, orderByFn,
    incrementFn, serverTimestampFn,
    FIREBASE_READY = false;

async function initFirebase() {
  try {
    const cfg        = await import('../shared/firebase-config.js');
    db                = cfg.db;
    docFn             = cfg.doc;
    collFn            = cfg.collection;
    getDocFn          = cfg.getDoc;
    getDDocsFn        = cfg.getDocs;
    setDocFn          = cfg.setDoc;
    updateDocFn       = cfg.updateDoc;
    addDocFn          = cfg.addDoc;
    deleteDocFn       = cfg.deleteDoc;
    queryFn           = cfg.query;
    whereFn           = cfg.where;
    orderByFn         = cfg.orderBy;
    incrementFn       = cfg.increment;        // FieldValue.increment
    serverTimestampFn = cfg.serverTimestamp;  // FieldValue.serverTimestamp
    FIREBASE_READY    = true;
    console.log('[admin.js] Firebase connected ✅');
  } catch (e) {
    FIREBASE_READY = false;
    console.warn('[admin.js] Firebase not connected — LocalStorage fallback active.', e.message);
  }
}

// Initialise on module load (await in callers if needed)
const _fbReady = initFirebase();
export const whenReady = () => _fbReady;

// ============================================================
//  AUTH
// ============================================================
export const getAdminPass = ()  => localStorage.getItem('krh_admin_pass') || 'admin123';
export const setAdminPass = (p) => localStorage.setItem('krh_admin_pass', p);
export const checkLogin   = (p) => p === getAdminPass();

// ============================================================
//  SPA PAGE ROUTER
// ============================================================
export function loadPage(name, title) {
  const frame   = document.getElementById('content-frame');
  if (frame)    frame.src = `pages/${name}.html`;

  const titleEl = document.getElementById('topbar-title');
  if (titleEl)  titleEl.textContent = title || name;

  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById('nav-' + name)?.classList.add('active');
  document.getElementById('sidebar')?.classList.remove('mobile-open');
  document.getElementById('sb-overlay')?.classList.remove('show');
}

// ============================================================
//  USERS — getAllUsers
// ============================================================
export async function getAllUsers() {
  await _fbReady;

  if (FIREBASE_READY) {
    try {
      const snap  = await getDDocsFn(collFn(db, COLLECTIONS.users));
      const users = snap.docs.map(d => ({ mobile: d.id, ...d.data() }));
      // Keep LS in sync for offline fallback
      localStorage.setItem(LS.users, JSON.stringify(users));
      return users;
    } catch (e) {
      console.warn('[getAllUsers] Firestore failed:', e.message);
    }
  }

  // LocalStorage fallback
  return JSON.parse(localStorage.getItem(LS.users) || '[]');
}

// ============================================================
//  USERS — getUser
// ============================================================
export async function getUser(mobile) {
  await _fbReady;

  if (FIREBASE_READY) {
    try {
      const snap = await getDocFn(docFn(db, COLLECTIONS.users, mobile));
      if (snap.exists()) {
        const user = { mobile: snap.id, ...snap.data() };
        // Sync to LS
        _syncUserToLS(user);
        return user;
      }
      return null;
    } catch (e) {
      console.warn('[getUser] Firestore failed:', e.message);
    }
  }

  // LocalStorage fallback
  const users = JSON.parse(localStorage.getItem(LS.users) || '[]');
  return users.find(u => u.mobile === mobile) || null;
}

// ============================================================
//  USERS — updateUser
//  Merges partial updates into existing user doc
// ============================================================
export async function updateUser(mobile, updates) {
  await _fbReady;

  if (FIREBASE_READY) {
    try {
      await updateDocFn(docFn(db, COLLECTIONS.users, mobile), updates);
      // Reflect in LS too
      _patchLS(mobile, updates);
      return { success: true };
    } catch (e) {
      console.warn('[updateUser] Firestore failed:', e.message);
    }
  }

  // LocalStorage fallback
  return _patchLS(mobile, updates);
}

// ============================================================
//  USERS — addVisit  ← THE KEY FUNCTION
//
//  Uses Firestore increment() so:
//    Admin panel click → Firestore write
//    Customer onSnapshot fires → dashboard updates instantly
//    No race conditions (atomic increment)
// ============================================================
export async function addVisit(mobile) {
  await _fbReady;

  const user = await getUser(mobile);
  if (!user) return { success: false, message: 'User not found' };

  const s       = getSettings();
  const goal    = s.visitRewards?.[mobile]?.threshold
               || s.defaultVisitThreshold
               || DEFAULTS.visitGoal;
  const reward  = s.visitRewards?.[mobile]?.reward
               || s.defaultVisitReward
               || DEFAULTS.visitReward;
  const perVisit = s.defaultPerVisitPts || DEFAULTS.perVisit || 5;

  const newV = (user.visits || 0) + 1;
  const newP = (user.points || 0) + perVisit;

  if (FIREBASE_READY) {
    try {
      // Atomic increment — no race conditions
      await updateDocFn(docFn(db, COLLECTIONS.users, mobile), {
        visits:   incrementFn(1),
        points:   incrementFn(perVisit),
        lastVisit: new Date().toISOString(),
      });
      // Sync LS with computed values
      _patchLS(mobile, { visits: newV, points: newP, lastVisit: new Date().toISOString() });
    } catch (e) {
      console.warn('[addVisit] Firestore failed, using LS:', e.message);
      _patchLS(mobile, { visits: newV, points: newP });
    }
  } else {
    _patchLS(mobile, { visits: newV, points: newP });
  }

  const milestone = newV % goal === 0;
  return {
    success:   true,
    visits:    newV,
    points:    newP,
    milestone,
    reward:    milestone ? reward : null,
  };
}

// ============================================================
//  USERS — adjustVisit (manual override, +1 or -1)
//  Used only from Customer Profile Modal's "Manual Adjustment"
//  — never from main billing flow (that uses addVisit above).
// ============================================================
export async function adjustVisit(mobile, delta) {
  await _fbReady;

  const user = await getUser(mobile);
  if (!user) return { success: false, message: 'User not found' };

  const s        = getSettings();
  const perVisit = s.defaultPerVisitPts || DEFAULTS.perVisit || 5;

  const newV = Math.max(0, (user.visits || 0) + delta);
  const ptsDelta = delta > 0 ? perVisit : -perVisit;
  const newP = Math.max(0, (user.points || 0) + ptsDelta);

  if (FIREBASE_READY) {
    try {
      await updateDocFn(docFn(db, COLLECTIONS.users, mobile), {
        visits: newV, points: newP,
      });
      _patchLS(mobile, { visits: newV, points: newP });
    } catch (e) {
      console.warn('[adjustVisit] Firestore failed, using LS:', e.message);
      _patchLS(mobile, { visits: newV, points: newP });
    }
  } else {
    _patchLS(mobile, { visits: newV, points: newP });
  }

  return { success: true, visits: newV, points: newP, name: user.name };
}

// ============================================================
//  USERS — adjustPoints
// ============================================================
export async function adjustPoints(mobile, amount, reason = 'Manual') {
  await _fbReady;

  const user = await getUser(mobile);
  if (!user) return { success: false, message: 'User not found' };

  const newP = Math.max(0, (user.points || 0) + amount);

  if (FIREBASE_READY) {
    try {
      await updateDocFn(docFn(db, COLLECTIONS.users, mobile), {
        points: incrementFn(amount),
      });
      _patchLS(mobile, { points: newP });
    } catch (e) {
      console.warn('[adjustPoints] Firestore failed:', e.message);
      _patchLS(mobile, { points: newP });
    }
  } else {
    _patchLS(mobile, { points: newP });
  }

  // Points history log (LS only — not critical for Firestore)
  const hist = JSON.parse(localStorage.getItem('krh_pts_history') || '[]');
  hist.unshift({
    mobile, name: user.name, amount, reason,
    time: new Date().toISOString()
  });
  localStorage.setItem('krh_pts_history', JSON.stringify(hist.slice(0, 500)));

  return { success: true, newPoints: newP, name: user.name };
}

// ============================================================
//  USERS — toggleFraud
// ============================================================
export async function toggleFraud(mobile) {
  const user = await getUser(mobile);
  if (!user) return { success: false };
  const flagged = !user.fraudFlag;
  await updateUser(mobile, { fraudFlag: flagged });
  return { success: true, flagged };
}

// ============================================================
//  BILLS — saveBill
// ============================================================
export async function saveBill(billData) {
  await _fbReady;

  const visitResult = await addVisit(billData.mobile);
  const user        = await getUser(billData.mobile);
  const disc        = billData.discount || 0;

  if (FIREBASE_READY) {
    try {
      await updateDocFn(docFn(db, COLLECTIONS.users, billData.mobile), {
        saved: incrementFn(disc),
      });
    } catch (e) { console.warn('[saveBill] saved increment failed:', e.message); }
  }
  _patchLS(billData.mobile, { saved: (user?.saved || 0) + disc });

  const bill = {
    ...billData,
    id:          Date.now().toString(),
    time:        new Date().toISOString(),
    visitNumber: visitResult.visits,
  };

  if (FIREBASE_READY) {
    try {
      await addDocFn(collFn(db, COLLECTIONS.bills), bill);
    } catch (e) { console.warn('[saveBill] Firestore addDoc failed:', e.message); }
  }

  // LS bills log
  const bills = JSON.parse(localStorage.getItem(LS.bills) || '[]');
  bills.unshift(bill);
  localStorage.setItem(LS.bills, JSON.stringify(bills));

  return { success: true, bill, visitResult };
}

export async function getTodayBills() {
  await _fbReady;

  if (FIREBASE_READY) {
    try {
      const today = new Date().toDateString();
      const snap  = await getDDocsFn(
        queryFn(collFn(db, COLLECTIONS.bills), orderByFn('time', 'desc'))
      );
      return snap.docs
        .map(d => d.data())
        .filter(b => new Date(b.time).toDateString() === today);
    } catch (e) { console.warn('[getTodayBills] Firestore failed:', e.message); }
  }

  const bills = JSON.parse(localStorage.getItem(LS.bills) || '[]');
  const today = new Date().toDateString();
  return bills.filter(b => new Date(b.time).toDateString() === today);
}

export async function getAllBills() {
  await _fbReady;

  if (FIREBASE_READY) {
    try {
      const snap = await getDDocsFn(
        queryFn(collFn(db, COLLECTIONS.bills), orderByFn('time', 'desc'))
      );
      const bills = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      localStorage.setItem(LS.bills, JSON.stringify(bills));
      return bills;
    } catch (e) { console.warn('[getAllBills] Firestore failed:', e.message); }
  }

  return JSON.parse(localStorage.getItem(LS.bills) || '[]');
}

// ============================================================
//  MENU / STOCK
// ============================================================
export async function getMenu() {
  await _fbReady;

  if (FIREBASE_READY) {
    try {
      const snap = await getDDocsFn(collFn(db, COLLECTIONS.menu));
      const menu = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      localStorage.setItem(LS.menu, JSON.stringify(menu));
      return menu;
    } catch (e) { console.warn('[getMenu] Firestore failed:', e.message); }
  }

  return JSON.parse(localStorage.getItem(LS.menu) || '[]');
}

export async function saveMenuItem(item) {
  await _fbReady;

  if (FIREBASE_READY) {
    try {
      await setDocFn(docFn(db, COLLECTIONS.menu, item.id), item, { merge: true });
    } catch (e) { console.warn('[saveMenuItem] Firestore failed:', e.message); }
  }

  const menu = await getMenu();
  const idx  = menu.findIndex(m => m.id === item.id);
  if (idx !== -1) menu[idx] = item; else menu.push(item);
  localStorage.setItem(LS.menu, JSON.stringify(menu));
  return { success: true };
}

export async function deleteMenuItem(id) {
  await _fbReady;

  if (FIREBASE_READY) {
    try {
      await deleteDocFn(docFn(db, COLLECTIONS.menu, id));
    } catch (e) { console.warn('[deleteMenuItem] Firestore failed:', e.message); }
  }

  const menu = (await getMenu()).filter(m => m.id !== id);
  localStorage.setItem(LS.menu, JSON.stringify(menu));
  return { success: true };
}

// ============================================================
//  SETTINGS
// ============================================================
export function getSettings() {
  return JSON.parse(localStorage.getItem(LS.settings) || '{}');
}

export function saveSettings(updates) {
  const n = { ...getSettings(), ...updates };
  localStorage.setItem(LS.settings, JSON.stringify(n));
  return n;
}

export function getShopInfo()   { return JSON.parse(localStorage.getItem(LS.shop) || '{}'); }
export function saveShopInfo(d) { localStorage.setItem(LS.shop, JSON.stringify(d)); }

// ============================================================
//  SOCIAL TASK APPROVAL
// ============================================================
export async function approveSocialTask(mobile, taskKey) {
  await _fbReady;

  const user = await getUser(mobile);
  if (!user) return { success: false };

  const s   = getSettings();
  const pts = {
    insta:  s.pts_instagram || 25,
    google: s.pts_google    || 30,
    wa:     s.pts_whatsapp  || 20,
    zomato: s.pts_zomato    || 20,
  }[taskKey] || 20;

  if (FIREBASE_READY) {
    try {
      // Atomic: mark done + add points in one write
      await updateDocFn(docFn(db, COLLECTIONS.users, mobile), {
        [`socialDone.${taskKey}`]: true,
        points: incrementFn(pts),
      });
      _patchLS(mobile, {
        socialDone: { ...(user.socialDone || {}), [taskKey]: true },
        points:     (user.points || 0) + pts,
      });
    } catch (e) {
      console.warn('[approveSocialTask] Firestore failed:', e.message);
      _patchLS(mobile, {
        socialDone: { ...(user.socialDone || {}), [taskKey]: true },
        points:     (user.points || 0) + pts,
      });
    }
  } else {
    _patchLS(mobile, {
      socialDone: { ...(user.socialDone || {}), [taskKey]: true },
      points:     (user.points || 0) + pts,
    });
  }

  return { success: true, pts, name: user.name };
}

export async function rejectSocialTask(mobile, taskKey) {
  const user = await getUser(mobile);
  if (!user) return { success: false };
  const pending = { ...(user.socialPending || {}), [taskKey]: false };
  await updateUser(mobile, { socialPending: pending });
  return { success: true };
}

// ============================================================
//  COUPON VALIDATION
// ============================================================
export async function validateCoupon(code, mobile) {
  const user = await getUser(mobile);
  if (!user) return { valid: false, message: 'Customer not found' };

  const s      = getSettings();
  const sfx    = mobile.slice(-4).toUpperCase();
  const yr     = new Date().getFullYear();
  const today  = new Date();
  const dob    = user.dob ? new Date(user.dob) : null;
  const isBday = dob
    && dob.getDate()  === today.getDate()
    && dob.getMonth() === today.getMonth();

  const map = {
    [`ROLL${sfx}`]:
      { type:'welcome',  disc: s.defaultWelcomeDisc||10, label:`Welcome ${s.defaultWelcomeDisc||10}% OFF` },
    [`BDAY${sfx}${yr}`]:
      isBday ? { type:'birthday', disc:15, label:'Birthday 15% OFF + FREE item' } : null,
    [`VIS${sfx}`]:
      { type:'visit', disc:0, label:'Visit Milestone Reward' },
    [`SPEC${sfx}`]:
      user.specialOffer?.active
        ? { type:'special', disc: user.specialOffer.discount||0, label: user.specialOffer.label }
        : null,
  };

  const hit = map[code.toUpperCase()];
  if (hit) return { valid: true, ...hit, user };

  // ── Check admin-created rewards collection ──────────────────
  try {
    const cfg = await import('../shared/firebase-config.js');
    const snap = await cfg.getDocs(
      cfg.query(cfg.collection(cfg.db, 'rewards'),
        cfg.where('code', '==', code.toUpperCase()),
        cfg.where('active', '==', true))
    );
    if (!snap.empty) {
      const rw = snap.docs[0].data();
      const rwId = snap.docs[0].id;
      // Check expiry
      if (rw.expiryDate && new Date(rw.expiryDate) < today) {
        return { valid: false, message: '❌ Yeh coupon expire ho gaya hai.' };
      }
      // Check single-use per customer
      if (rw.singleUse && rw.usedBy && rw.usedBy.includes(mobile)) {
        return { valid: false, message: '❌ Yeh coupon already use ho chuka hai.' };
      }
      // Check max uses
      if (rw.maxUses && (rw.usageCount || 0) >= rw.maxUses) {
        return { valid: false, message: '❌ Yeh coupon ki limit khatam ho gayi.' };
      }
      const rType = rw.type || 'discount';
      const rVal  = rw.value || rw.discountPct || 0;
      let labelSuffix;
      if (rType === 'cashback')  labelSuffix = '₹' + rVal + ' OFF';
      else if (rType === 'free_item') labelSuffix = 'FREE ' + rVal;
      else labelSuffix = (parseInt(rVal) || 0) + '% OFF';

      return {
        valid: true,
        type: 'reward',
        rewardId: rwId,
        discType: rType,
        disc: rType === 'discount' ? (parseInt(rVal) || 0) : 0,
        discFlat: rType === 'cashback' ? (parseFloat(rVal) || 0) : 0,
        label: (rw.title || rw.label || rw.name || 'Special Offer') + ' — ' + labelSuffix,
        user
      };
    }
  } catch (e) {
    console.warn('[validateCoupon] rewards check failed:', e.message);
  }

  return { valid: false, message: '❌ Invalid ya expired coupon code.' };
}

export async function markCouponUsed(mobile, couponType, rewardId, savedAmt) {
  await updateUser(mobile, {
    [`couponUsed_${couponType}`]: new Date().toISOString()
  });

  // ── If it's a reward-type coupon, update usage in rewards collection ──
  if (rewardId) {
    try {
      const cfg = await import('../shared/firebase-config.js');
      const ref = cfg.doc(cfg.db, 'rewards', rewardId);
      const snap = await cfg.getDoc(ref);
      if (snap.exists()) {
        const rw = snap.data();
        const usedBy = rw.usedBy || [];
        if (!usedBy.includes(mobile)) usedBy.push(mobile);
        const amt = parseInt(savedAmt) || 0;
        const prevSaved = parseInt(rw.savedAmount) || 0;
        const amounts = rw.savedAmounts || {};
        amounts[mobile] = (parseInt(amounts[mobile]) || 0) + amt;
        await cfg.updateDoc(ref, {
          usageCount: (rw.usageCount || 0) + 1,
          usedBy: usedBy,
          savedAmount: prevSaved + amt,
          savedAmounts: amounts
        });
        if (amt > 0) {
          await updateUser(mobile, { saved: (parseInt((await getUser(mobile))?.saved) || 0) + amt });
        }
      }
    } catch (e) {
      console.warn('[markCouponUsed] reward update failed:', e.message);
    }
  }

  return { success: true };
}

// ============================================================
//  REFERRAL APPROVAL
// ============================================================
export async function approveReferral(referrerMob, referredMob) {
  const ref = await getUser(referrerMob);
  if (!ref) return { success: false, message: 'Referrer not found' };

  const s     = getSettings();
  const steps = s.referralRewards?.[referrerMob]?.steps
             || s.defaultRefSteps
             || DEFAULTS.refSteps;
  const pts   = steps[Math.min(ref.referrals || 0, steps.length - 1)];

  if (FIREBASE_READY) {
    try {
      await updateDocFn(docFn(db, COLLECTIONS.users, referrerMob), {
        referrals:  incrementFn(1),
        points:     incrementFn(pts),
        [`refApproved_${referredMob}`]: true,
      });
      _patchLS(referrerMob, {
        referrals: (ref.referrals || 0) + 1,
        points:    (ref.points    || 0) + pts,
        [`refApproved_${referredMob}`]: true,
      });
    } catch (e) {
      console.warn('[approveReferral] Firestore failed:', e.message);
      _patchLS(referrerMob, {
        referrals: (ref.referrals || 0) + 1,
        points:    (ref.points    || 0) + pts,
        [`refApproved_${referredMob}`]: true,
      });
    }
  } else {
    _patchLS(referrerMob, {
      referrals: (ref.referrals || 0) + 1,
      points:    (ref.points    || 0) + pts,
      [`refApproved_${referredMob}`]: true,
    });
  }

  return { success: true, pts, name: ref.name };
}

// ============================================================
//  EXPORT CSV
// ============================================================
export async function exportCSV(type) {
  const d = new Date().toISOString().slice(0, 10);
  let h, r, fn;

  if (type === 'customers') {
    h  = ['Name','Mobile','DOB','Area','Visits','Points','Saved','Referrals','Joined','Fav Items'];
    r  = (await getAllUsers()).map(u => [
      u.name, u.mobile, u.dob, u.area,
      u.visits||0, u.points||0, u.saved||0, u.referrals||0,
      u.joined, (u.favItems||[]).join('|')
    ]);
    fn = `customers-${d}.csv`;
  } else if (type === 'bills') {
    h  = ['Name','Mobile','Amount','Final','Discount','Offer','Payment','Time'];
    r  = (await getAllBills()).map(b => [b.name,b.mobile,b.amt,b.final,b.discount,b.offer,b.payment,b.time]);
    fn = `bills-${d}.csv`;
  } else if (type === 'menu') {
    h  = ['Name','Price','Cost','Category','Discount%','Stock','Active'];
    r  = (await getMenu()).map(m => [m.name,m.price,m.cost,m.category,m.discount||0,m.stock||0,m.active]);
    fn = `menu-${d}.csv`;
  } else {
    h  = ['Name','Mobile','Amount','Reason','Time'];
    r  = JSON.parse(localStorage.getItem('krh_pts_history')||'[]').map(x => [x.name,x.mobile,x.amount,x.reason,x.time]);
    fn = `points-${d}.csv`;
  }

  const csv = [h, ...r].map(row => row.map(v => `"${v||''}"`).join(',')).join('\n');
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = fn;
  a.click();
}

// ============================================================
//  PRIVATE HELPERS
// ============================================================

/** Patch a single user in the LS array */
function _patchLS(mobile, updates) {
  const users = JSON.parse(localStorage.getItem(LS.users) || '[]');
  const idx   = users.findIndex(u => u.mobile === mobile);
  if (idx !== -1) {
    users[idx] = { ...users[idx], ...updates };
    localStorage.setItem(LS.users, JSON.stringify(users));
    return { success: true, user: users[idx] };
  }
  return { success: false, message: 'User not found in LS' };
}

/** Overwrite one user in LS */
function _syncUserToLS(user) {
  const users = JSON.parse(localStorage.getItem(LS.users) || '[]');
  const idx   = users.findIndex(u => u.mobile === user.mobile);
  if (idx !== -1) users[idx] = user; else users.push(user);
  localStorage.setItem(LS.users, JSON.stringify(users));
}

// ============================================================
//  SHARED UTILS
// ============================================================
export const fmtDate   = d => d
  ? new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })
  : '—';
export const fmtTime   = d => d
  ? new Date(d).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' })
  : '';
export const daysSince = d => d
  ? Math.floor((Date.now() - new Date(d)) / 864e5)
  : 999;
export const genCode   = (mob, type = 'welcome') => {
  const pfx = { welcome:'ROLL', birthday:'BDAY', visit:'VIS', special:'SPEC' };
  const sfx = mob.slice(-4).toUpperCase();
  return type === 'birthday'
    ? `${pfx[type]}${sfx}${new Date().getFullYear()}`
    : `${pfx[type]}${sfx}`;
};



