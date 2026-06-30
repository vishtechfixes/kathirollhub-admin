// ============================================================
//  admin/js/feedback.js
//  Customer Feedback management
//  Firebase-first → LocalStorage fallback
//
//  Exports:
//    initFeedbackFirebase()
//    getAllFeedback()
//    getFeedbackById(id)
//    toggleFeedbackStatus(id, status)
//    deleteFeedback(id)
//    addFeedback(data)          ← customer side se call hota hai
//    getFeedbackStats()
// ============================================================

// ── LocalStorage key ─────────────────────────────────────────
const LS_KEY = 'krh_feedback';

// ── Firebase ─────────────────────────────────────────────────
let db, docFn, collFn,
    getDDocsFn, getDocFn,
    setDocFn, addDocFn,
    updateDocFn, deleteDocFn,
    queryFn, orderByFn, whereFn,
    FIREBASE_READY = false;

// ============================================================
//  initFeedbackFirebase()
//  feedback.html load hote hi call karo
// ============================================================
export async function initFeedbackFirebase() {
  try {
    const cfg   = await import('../../shared/firebase-config.js');
    db           = cfg.db;
    docFn        = cfg.doc;
    collFn       = cfg.collection;
    getDDocsFn   = cfg.getDocs;
    getDocFn     = cfg.getDoc;
    setDocFn     = cfg.setDoc;
    addDocFn     = cfg.addDoc;
    updateDocFn  = cfg.updateDoc;
    deleteDocFn  = cfg.deleteDoc;
    queryFn      = cfg.query;
    orderByFn    = cfg.orderBy;
    whereFn      = cfg.where;
    FIREBASE_READY = true;
    console.log('[feedback.js] Firebase connected ✅');
  } catch (e) {
    FIREBASE_READY = false;
    console.warn('[feedback.js] Firebase failed — LocalStorage mode', e.message);
  }
}

// ============================================================
//  getAllFeedback()
//  Firestore rollhub_help collection se sab tickets fetch karo
//  Sorted: newest first
// ============================================================
export async function getAllFeedback() {
  if (FIREBASE_READY) {
    try {
      const snap = await getDDocsFn(
        queryFn(
          collFn(db, 'rollhub_help'),
          orderByFn('time', 'desc')
        )
      );
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Sync to LS
      localStorage.setItem(LS_KEY, JSON.stringify(items));
      return items;
    } catch (e) {
      console.warn('[getAllFeedback] Firestore failed:', e.message);
    }
  }
  // LocalStorage fallback
  return _lsGet().sort((a, b) => new Date(b.time) - new Date(a.time));
}

// ============================================================
//  getFeedbackById(id)
// ============================================================
export async function getFeedbackById(id) {
  if (FIREBASE_READY) {
    try {
      const snap = await getDocFn(docFn(db, 'rollhub_help', id));
      if (snap.exists()) return { id: snap.id, ...snap.data() };
    } catch (e) {
      console.warn('[getFeedbackById] failed:', e.message);
    }
  }
  return _lsGet().find(f => f.id === id) || null;
}

// ============================================================
//  toggleFeedbackStatus(id, status)
//  status: 'pending' | 'resolved'
// ============================================================
export async function toggleFeedbackStatus(id, status) {
  const updates = {
    status,
    resolvedAt: status === 'resolved' ? new Date().toISOString() : null,
  };

  if (FIREBASE_READY) {
    try {
      await updateDocFn(docFn(db, 'rollhub_help', id), updates);
    } catch (e) {
      console.warn('[toggleFeedbackStatus] Firestore failed:', e.message);
    }
  }

  // LocalStorage sync
  _lsPatch(id, updates);
  return { success: true };
}

// ============================================================
//  deleteFeedback(id)
// ============================================================
export async function deleteFeedback(id) {
  if (FIREBASE_READY) {
    try {
      await deleteDocFn(docFn(db, 'rollhub_help', id));
    } catch (e) {
      console.warn('[deleteFeedback] Firestore failed:', e.message);
    }
  }

  // LocalStorage sync
  const all = _lsGet().filter(f => f.id !== id);
  localStorage.setItem(LS_KEY, JSON.stringify(all));
  return { success: true };
}

// ============================================================
//  addFeedback(data)
//  Customer side se submit hota hai
//  data = { name, mobile, type, message, rating, time }
//
//  Types: 'complaint' | 'query' | 'suggestion' | 'compliment'
// ============================================================
export async function addFeedback(data) {
  const entry = {
    ...data,
    id:     data.id     || Date.now().toString(),
    status: data.status || 'pending',
    time:   data.time   || new Date().toISOString(),
  };

  if (FIREBASE_READY) {
    try {
      // Use setDoc so id matches Firestore doc id
      await setDocFn(docFn(db, 'rollhub_help', entry.id), entry);
    } catch (e) {
      console.warn('[addFeedback] Firestore failed:', e.message);
    }
  }

  // LocalStorage sync
  const all = _lsGet();
  all.unshift(entry);
  localStorage.setItem(LS_KEY, JSON.stringify(all));
  return { success: true, id: entry.id };
}

// ============================================================
//  getFeedbackStats()
//  Dashboard / sidebar badge ke liye
// ============================================================
export async function getFeedbackStats() {
  const all = await getAllFeedback();
  return {
    total:      all.length,
    pending:    all.filter(f => f.status !== 'resolved').length,
    complaint:  all.filter(f => f.type === 'complaint').length,
    query:      all.filter(f => f.type === 'query').length,
    suggestion: all.filter(f => f.type === 'suggestion').length,
    compliment: all.filter(f => f.type === 'compliment').length,
    resolved:   all.filter(f => f.status === 'resolved').length,
  };
}

// ============================================================
//  PRIVATE HELPERS
// ============================================================

function _lsGet() {
  return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
}

function _lsPatch(id, updates) {
  const all = _lsGet();
  const idx = all.findIndex(f => f.id === id);
  if (idx !== -1) {
    all[idx] = { ...all[idx], ...updates };
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  }
}