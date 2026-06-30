// ============================================================
//  admin/js/referrals.js
//  Referral tracking, approval, points distribution
//  Firebase-first, LocalStorage fallback
// ============================================================

import { getSettings, getAllUsers, updateUser, adjustPoints } from './admin.js';

// ── Firebase (ready to connect) ──────────────────────────────
let db, docFn, collFn, getDDocsFn, updateDocFn,
    queryFn, orderByFn, FIREBASE_READY = false;

async function initFirebase() {
  try {
    const cfg   = await import('../../shared/firebase-config.js');
    db           = cfg.db;
    docFn        = cfg.doc;
    collFn       = cfg.collection;
    getDDocsFn   = cfg.getDocs;
    updateDocFn  = cfg.updateDoc;
    queryFn      = cfg.query;
    orderByFn    = cfg.orderBy;
    FIREBASE_READY = true;
  } catch (e) {
    FIREBASE_READY = false;
  }
}

export { initFirebase };

// ============================================================
//  buildReferralList()
//  Users list se referral pairs banao
//  Returns array of referral objects
// ============================================================
export async function buildReferralList() {
  const users = await getAllUsers();
  const bills = JSON.parse(localStorage.getItem('krh_bills') || '[]');
  const s     = getSettings();

  const referrals = [];

  users.forEach(u => {
    if (!u.referredBy) return;                        // no referrer
    const referrer = users.find(x => x.mobile === u.referredBy);
    if (!referrer) return;                            // referrer not found

    // Has referred customer made a purchase?
    const hasBought = bills.some(b => b.mobile === u.mobile);

    // Has referrer already been rewarded for this person?
    const rewarded  = !!referrer[`refApproved_${u.mobile}`];

    // Calculate tier points
    const steps = s.referralRewards?.[referrer.mobile]?.steps
                || s.defaultRefSteps
                || [50, 120, 200];
    const refCount = referrer.referrals || 0;
    const tierPts  = steps[Math.min(refCount, steps.length - 1)];

    referrals.push({
      referrer,
      referred:      u,
      hasBought,
      rewarded,
      tierPts,
      joinDate:      u.joined,
      // unique key
      id: `${referrer.mobile}_${u.mobile}`,
    });
  });

  // Sort: pending first, then by date desc
  return referrals.sort((a, b) => {
    if (a.rewarded !== b.rewarded) return a.rewarded ? 1 : -1;
    return new Date(b.joinDate) - new Date(a.joinDate);
  });
}

// ============================================================
//  approveReferral()
//  Admin confirms → both get points
// ============================================================
export async function approveReferral(referrerMobile, referredMobile) {
  const users = JSON.parse(localStorage.getItem('krh_users') || '[]');
  const referrer = users.find(u => u.mobile === referrerMobile);
  if (!referrer) return { success: false, message: 'Referrer not found' };

  const s     = getSettings();
  const steps = s.referralRewards?.[referrerMobile]?.steps
              || s.defaultRefSteps
              || [50, 120, 200];
  const count = referrer.referrals || 0;
  const pts   = steps[Math.min(count, steps.length - 1)];

  // Give points to referrer
  const refResult = await adjustPoints(
    referrerMobile,
    pts,
    `Referral reward — ${referredMobile} ne pehla order kiya`
  );

  // Mark referral approved on referrer's profile
  await updateUser(referrerMobile, {
    referrals: count + 1,
    [`refApproved_${referredMobile}`]: true,
  });

  // Give small bonus to referred customer too (10% of referrer pts)
  const referredBonus = Math.round(pts * 0.1);
  if (referredBonus > 0) {
    await adjustPoints(
      referredMobile,
      referredBonus,
      `Referral bonus — aapko ${referrerMobile} ne refer kiya`
    );
  }

  // ── Firebase (uncomment when ready) ──────────────────────
  // if (FIREBASE_READY) {
  //   await updateDocFn(docFn(db, 'users', referrerMobile), {
  //     referrals:  count + 1,
  //     points:     increment(pts),
  //     [`refApproved_${referredMobile}`]: true,
  //   });
  // }

  return {
    success:      true,
    pts,
    referredBonus,
    referrerName: referrer.name,
    newRefCount:  count + 1,
  };
}

// ============================================================
//  getReferralStats()
// ============================================================
export async function getReferralStats() {
  const list    = await buildReferralList();
  const total   = list.length;
  const pending = list.filter(r => !r.rewarded && r.hasBought).length;
  const done    = list.filter(r => r.rewarded).length;
  const waiting = list.filter(r => !r.rewarded && !r.hasBought).length;
  const totalPts= list.filter(r => r.rewarded)
                      .reduce((a, r) => a + r.tierPts, 0);
  return { total, pending, done, waiting, totalPts };
}