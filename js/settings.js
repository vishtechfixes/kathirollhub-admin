// ============================================================
//  admin/js/settings.js  —  Firebase-FIRST version
//
//  SETUP REQUIRED before this works:
//  1. shared/firebase-config.js mein apni Firebase keys daalo
//  2. Firestore Database enable karo (Firebase console)
//  3. Rules set karo (read/write: true for now)
//
//  Flow:
//    Page load → Firestore settings/config fetch → inputs fill
//    Save btn  → Firestore setDoc (merge:true) → toast
//    Customer dashboard ka onSnapshot yahan ke change pe fire
// ============================================================

// ── Imports ──────────────────────────────────────────────────
import {
  getSettings, saveSettings,    // LocalStorage fallback helpers
  getShopInfo, saveShopInfo,
  getAdminPass, setAdminPass,
} from './admin.js';

// Firebase — ye lines tab kaam karengi jab firebase-config.js
// mein sahi keys hongi. Agar nahi hain, graceful fallback hoga.
let db, docFn, setDocFn, getDocFn, FIREBASE_READY = false;

async function initFirebase() {
  try {
    const cfg = await import('../../shared/firebase-config.js');
    db         = cfg.db;
    docFn      = cfg.doc;
    setDocFn   = cfg.setDoc;
    getDocFn   = cfg.getDoc;
    FIREBASE_READY = true;
    console.log('[Settings] Firebase connected ✅');
  } catch (e) {
    console.warn('[Settings] Firebase not connected — LocalStorage fallback active.', e.message);
    FIREBASE_READY = false;
  }
}

// Firestore document paths
const SHOP_ID   = 'kathi-roll-hub';   // shared/constants.js se match karo
const COLL_SETT = 'settings';
const DOC_CFG   = 'config';
const COLL_SHOP = 'shop';

// ============================================================
//  LOAD — page boot pe Firestore se fill karo
// ============================================================
async function load() {
  setStatus('loading');
  showStatusBar('⏳ Settings load ho rahi hain...', 'info');

  let sh = {}, s = {};

  if (FIREBASE_READY) {
    try {
      // Fetch both docs in parallel
      const [cfgSnap, shopSnap] = await Promise.all([
        getDocFn(docFn(db, COLL_SETT, DOC_CFG)),
        getDocFn(docFn(db, COLL_SHOP, SHOP_ID)),
      ]);
      s  = cfgSnap.exists()  ? cfgSnap.data()  : {};
      sh = shopSnap.exists() ? shopSnap.data() : {};

      // Keep LocalStorage in sync (offline fallback)
      saveSettings(s);
      saveShopInfo(sh);

      showStatusBar('✅ Firebase se load hua', 'ok', 2000);
    } catch (err) {
      console.error('[Settings] Firestore load failed:', err);
      // Fall back to LocalStorage
      s  = getSettings();
      sh = getShopInfo();
      showStatusBar('⚠️ Firebase error — LocalStorage se load kiya', 'warn', 3000);
    }
  } else {
    // Firebase not configured — use LocalStorage
    s  = getSettings();
    sh = getShopInfo();
    showStatusBar('ℹ️ LocalStorage mode (Firebase keys nahi hain)', 'info', 3000);
  }

  fillInputs(sh, s);
  updatePreview();
  markClean();
}

// ── Fill all inputs from data ─────────────────────────────────
function fillInputs(sh, s) {
  // Shop info
  sv('s-name',  sh.name    || '');
  sv('s-loc',   sh.loc     || '');
  sv('s-wa',    sh.waNumber|| '');
  sv('s-insta', sh.insta   || '');
  sv('s-grev',  sh.grev    || '');
  sv('s-zomato',sh.zomato  || '');

  // Feature toggles (default: ON, unless explicitly set to false)
  sc('ft-welcome',  s.feature_welcomeDiscount !== false);
  sc('ft-birthday', s.feature_birthdayOffer   !== false);
  sc('ft-streak',   s.feature_visitStreak     !== false);

  // Offer defaults
  sv('o-disc',  s.defaultWelcomeDisc    || 10);
  sv('o-ppv',   s.defaultPerVisitPts    || 5);
  sv('o-goal',  s.defaultVisitThreshold || 5);
  sv('o-reward',s.defaultVisitReward    || 'FREE Roll ya Momos');
  sv('o-wpts',  s.defaultWelcomePts     || 200);
  sv('o-ref',  (s.defaultRefSteps       || [50, 120, 200]).join(','));

  // Social task points
  sv('o-insta-pts',  s.pts_instagram || 25);
  sv('o-google-pts', s.pts_google    || 30);
  sv('o-wa-pts',     s.pts_whatsapp  || 20);
  sv('o-zomato-pts', s.pts_zomato    || 20);

  // Fraud prevention
  sv('f-max-visits', s.fraud_maxVisitsPerDay  || 1);
  sv('f-min-order',  s.fraud_minOrderValue    || 100);
  sv('f-max-ref',    s.fraud_maxReferrals     || 10);
  sv('f-ref-cool',   s.fraud_referralCooldown || 0);

  // Marketing / Announcement
  sc('m-show-ann', s.announcement_show || false);
  sv('m-ann-text', s.announcement_text || '');
  sv('m-ann-icon', s.announcement_icon || '📢');
  sv('m-ann-sub',  s.announcement_sub  || '');

  // Notifications
  sc('n-bday',     s.notif_bday    !== false);
  sc('n-inactive', s.notif_inactive!== false);
  sc('n-social',   s.notif_social  !== false);
  sc('n-stock',    s.notif_stock   !== false);
}

// ============================================================
//  SAVE ALL → Firestore setDoc (merge:true)
//  Jab ye fire hota hai → customer dashboard ka onSnapshot
//  listener turant trigger hota hai → UI update bina refresh
// ============================================================
window.saveAll = async function () {
  const name = gv('s-name').trim();
  if (!name) { showToast('❌ Shop name zaroor dalein'); return; }

  // Disable save button during save
  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Saving...'; }

  try {
    // ── Build data objects ──────────────────────────────
    const shopData = {
      name,
      loc:      gv('s-loc').trim(),
      waNumber: gv('s-wa').trim(),
      insta:    gv('s-insta').trim(),
      grev:     gv('s-grev').trim(),
      zomato:   gv('s-zomato').trim(),
    };

    const refSteps = gv('o-ref')
      .split(',').map(x => parseInt(x.trim())).filter(Boolean);

    const settingsData = {
      // Feature toggles
      feature_welcomeDiscount: gc('ft-welcome'),
      feature_birthdayOffer:   gc('ft-birthday'),
      feature_visitStreak:     gc('ft-streak'),

      // Offer defaults
      defaultWelcomeDisc:    parseInt(gv('o-disc'))   || 10,
      defaultPerVisitPts:    parseInt(gv('o-ppv'))    || 5,
      defaultVisitThreshold: parseInt(gv('o-goal'))   || 5,
      defaultVisitReward:    gv('o-reward').trim()    || 'FREE Roll ya Momos',
      defaultWelcomePts:     parseInt(gv('o-wpts'))   || 200,
      defaultRefSteps:       refSteps.length ? refSteps : [50, 120, 200],

      // Social task points
      pts_instagram: parseInt(gv('o-insta-pts'))  || 25,
      pts_google:    parseInt(gv('o-google-pts')) || 30,
      pts_whatsapp:  parseInt(gv('o-wa-pts'))     || 20,
      pts_zomato:    parseInt(gv('o-zomato-pts')) || 20,

      // Fraud prevention
      fraud_maxVisitsPerDay:  parseInt(gv('f-max-visits')) || 1,
      fraud_minOrderValue:    parseInt(gv('f-min-order'))  || 100,
      fraud_maxReferrals:     parseInt(gv('f-max-ref'))    || 10,
      fraud_referralCooldown: parseInt(gv('f-ref-cool'))   || 0,

      // Marketing announcement
      announcement_show: gc('m-show-ann'),
      announcement_text: gv('m-ann-text').trim(),
      announcement_icon: gv('m-ann-icon').trim() || '📢',
      announcement_sub:  gv('m-ann-sub').trim(),

      // Notification flags
      notif_bday:     gc('n-bday'),
      notif_inactive: gc('n-inactive'),
      notif_social:   gc('n-social'),
      notif_stock:    gc('n-stock'),

      // Metadata
      updatedAt: new Date().toISOString(),
    };

    // ── Save to Firestore ───────────────────────────────
    if (FIREBASE_READY) {
      await Promise.all([
        setDocFn(docFn(db, COLL_SETT, DOC_CFG), settingsData, { merge: true }),
        setDocFn(docFn(db, COLL_SHOP, SHOP_ID),  shopData,     { merge: true }),
      ]);
      // ↑ Ye setDoc fire hote hi customer ka onSnapshot trigger
      //   hoga → dashboard announcement banner turant update!
    }

    // ── Always save to LocalStorage (offline sync) ──────
    saveSettings(settingsData);
    saveShopInfo(shopData);

    markClean();
    showToast('✅ Settings save ho gayi!' + (FIREBASE_READY ? ' (Firestore ✅)' : ' (LocalStorage)'));

    // Update sidebar location text in parent frame
    try {
      parent.document.getElementById('sb-location').textContent =
        shopData.loc || shopData.name;
    } catch (e) { /* not in iframe */ }

  } catch (err) {
    console.error('[Settings] Save failed:', err);
    showToast('❌ Save fail hua: ' + err.message);
  } finally {
    if (saveBtn) {
      saveBtn.disabled    = false;
      saveBtn.textContent = '💾 Save All Settings';
    }
  }
};

// ============================================================
//  ANNOUNCEMENT LIVE PREVIEW
// ============================================================
function updatePreview() {
  const text = gv('m-ann-text').trim();
  const icon = gv('m-ann-icon').trim() || '📢';
  const sub  = gv('m-ann-sub').trim();
  const show = gc('m-show-ann');
  const prev = document.getElementById('ann-preview');
  if (!prev) return;

  if (show && text) {
    prev.style.display = 'flex';
    const iEl = document.getElementById('ann-preview-icon');
    const tEl = document.getElementById('ann-preview-text');
    const sEl = document.getElementById('ann-preview-sub');
    if (iEl) iEl.textContent = icon;
    if (tEl) tEl.textContent = text;
    if (sEl) sEl.textContent = sub;
  } else {
    prev.style.display = 'none';
  }
}
window.updatePreview = updatePreview;

// ============================================================
//  PASSWORD CHANGE
// ============================================================
window.changePw = function () {
  const cur  = gv('pw-cur');
  const nw   = gv('pw-new');
  const conf = gv('pw-confirm');
  const ok   = el('pw-ok');
  const err  = el('pw-err');
  if (ok)  ok.style.display  = 'none';
  if (err) err.style.display = 'none';

  if (cur !== getAdminPass()) {
    if (err) { err.textContent = '❌ Current password galat hai.'; err.style.display = 'block'; }
    return;
  }
  if (nw.length < 8) {
    if (err) { err.textContent = '❌ Min 8 characters chahiye.'; err.style.display = 'block'; }
    return;
  }
  if (nw !== conf) {
    if (err) { err.textContent = '❌ Passwords match nahi kar rahe.'; err.style.display = 'block'; }
    return;
  }

  setAdminPass(nw);
  if (ok) { ok.textContent = '✅ Password change ho gaya!'; ok.style.display = 'block'; }
  ['pw-cur', 'pw-new', 'pw-confirm'].forEach(id => { const e = el(id); if (e) e.value = ''; });
  const bar = el('pw-bar'); if (bar) bar.style.width = '0%';
  const lbl = el('pw-lbl'); if (lbl) lbl.textContent = '';
  showToast('🔒 Password updated!');
};

window.pwStrength = function () {
  const pw  = gv('pw-new');
  const bar = el('pw-bar');
  const lbl = el('pw-lbl');
  if (!bar || !lbl) return;
  let s = 0;
  if (pw.length >= 8)          s++;
  if (/[A-Z]/.test(pw))        s++;
  if (/[0-9]/.test(pw))        s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const lvl = [
    ['', 'var(--border)'],
    ['Weak',   'var(--red)'],
    ['Fair',   'var(--orange)'],
    ['Good',   '#ca8a04'],
    ['Strong', 'var(--green)'],
  ];
  bar.style.width      = s * 25 + '%';
  bar.style.background = lvl[s][1];
  lbl.textContent      = lvl[s][0];
  lbl.style.color      = lvl[s][1];
};

window.toggleEye = function (id) {
  const e = el(id);
  if (e) e.type = e.type === 'password' ? 'text' : 'password';
};

// ============================================================
//  DANGER ZONE
// ============================================================
window.delBills = function () {
  if (!confirm('⚠️ Sab bills permanently delete ho jaayenge!')) return;
  localStorage.removeItem('krh_bills');
  // Firebase: await deleteDoc / batch delete (add later)
  showToast('✅ Sab bills delete ho gaye');
};

window.delAll = function () {
  if (!confirm('⚠️ SACH MEIN? Customers, bills, menu, settings — sab delete!')) return;
  if (!confirm('LAST CHANCE — permanent delete!')) return;
  ['krh_users','krh_bills','krh_menu','krh_settings',
   'krh_shop','krh_feedback','krh_pts_history'].forEach(k =>
    localStorage.removeItem(k)
  );
  showToast('💀 Reset ho gaya. Refresh ho raha hai...');
  setTimeout(() => location.reload(), 2000);
};

// ============================================================
//  DIRTY TRACKING
// ============================================================
function markDirty() {
  const e = el('save-msg');
  if (!e) return;
  e.textContent = '⚠️ Unsaved changes — save karo!';
  e.className   = 'save-msg err';
}

function markClean() {
  const e = el('save-msg');
  if (!e) return;
  e.textContent = '✓ Saved';
  e.className   = 'save-msg ok';
  setTimeout(() => {
    e.textContent = 'Koi unsaved changes nahi';
    e.className   = 'save-msg';
  }, 3000);
}

// ============================================================
//  STATUS BAR (Firebase / LocalStorage indicator)
// ============================================================
function setStatus(type) {
  const firebaseSection = el('firebase-status-section');
  if (!firebaseSection) return;
  if (type === 'loading') {
    firebaseSection.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:20px">⏳</span>
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--txt)">Firebase se connect ho raha hai...</div>
        </div>
      </div>`;
  }
}

// Called after load() finishes — update the Firebase section in HTML
function updateFirebaseSection() {
  const sec = el('firebase-status-section');
  if (!sec) return;
  if (FIREBASE_READY) {
    sec.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:14px">
        <span style="font-size:28px">🔥</span>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700;color:var(--green);margin-bottom:6px">
            Firebase Firestore — Connected ✅
          </div>
          <div style="font-size:13px;color:var(--txt2);line-height:1.6;margin-bottom:14px">
            Settings Firestore ke <code style="background:var(--bg);padding:2px 6px;border-radius:4px">settings/config</code>
            document mein save ho rahe hain.<br/>
            Admin change kare → customer dashboard <strong>turant update</strong> hoga (onSnapshot).
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <span class="badge badge-green">✅ Firestore Active</span>
            <span class="badge badge-blue">Real-time Sync ON</span>
            <span class="badge badge-gray">Multi-device</span>
          </div>
        </div>
      </div>`;
  } else {
    sec.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:14px">
        <span style="font-size:28px">⚠️</span>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700;color:#ca8a04;margin-bottom:6px">
            Firebase Keys Nahi Hain — LocalStorage Mode
          </div>
          <div style="font-size:13px;color:var(--txt2);line-height:1.6;margin-bottom:14px">
            <strong>Firebase setup ke liye:</strong>
            <ol style="margin-left:16px;margin-top:8px;line-height:2.2">
              <li>
                <a href="https://console.firebase.google.com" target="_blank"
                   style="color:var(--blue)">console.firebase.google.com</a> pe
                   naya project banao
              </li>
              <li>Firestore Database enable karo (Mumbai region)</li>
              <li>Project Settings → Web App → Config copy karo</li>
              <li>
                <code style="background:var(--bg);padding:2px 6px;border-radius:4px">shared/firebase-config.js</code>
                mein keys paste karo
              </li>
              <li>Page refresh karo — Firebase active ho jaayega</li>
            </ol>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <span class="badge badge-yellow">⚠️ LocalStorage Mode</span>
            <span class="badge badge-gray">Single Device Only</span>
          </div>
        </div>
      </div>`;
  }
}

// ============================================================
//  TOAST
// ============================================================
function showToast(msg, dur = 3000) {
  const t = el('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

function showStatusBar(msg, type = 'info', autoDismiss = 0) {
  const bar = el('save-msg');
  if (!bar) return;
  const styles = {
    info: 'save-msg',
    ok:   'save-msg ok',
    warn: 'save-msg err',
    err:  'save-msg err',
  };
  bar.textContent = msg;
  bar.className   = styles[type] || 'save-msg';
  if (autoDismiss) {
    setTimeout(() => {
      bar.textContent = 'Koi unsaved changes nahi';
      bar.className   = 'save-msg';
    }, autoDismiss);
  }
}

// ============================================================
//  HELPERS
// ============================================================
const el  = id  => document.getElementById(id);
const gv  = id  => (el(id) || {}).value || '';
const sv  = (id, v)  => { const e = el(id); if (e) e.value   = v; };
const gc  = id  => el(id)?.checked === true;
const sc  = (id, v)  => { const e = el(id); if (e) e.checked = v; };

// ============================================================
//  BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Try Firebase connect
  await initFirebase();

  // 2. Load data
  await load();

  // 3. Update Firebase status section
  updateFirebaseSection();

  // 4. Dirty tracking
  document.querySelectorAll('input, textarea').forEach(e => {
    e.addEventListener('input',  markDirty);
    e.addEventListener('change', markDirty);
  });

  // 5. Live announcement preview listeners
  ['m-ann-text','m-ann-icon','m-ann-sub','m-show-ann'].forEach(id => {
    el(id)?.addEventListener('input',  updatePreview);
    el(id)?.addEventListener('change', updatePreview);
  });
});