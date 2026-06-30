// ============================================================
//  admin/js/db.js
//  Firestore ke saath baat karne ke main CRUD functions
//  Firebase-first, LocalStorage fallback
//
//  Usage:
//    import { getData, setData, updateData, deleteData, listenData }
//      from './db.js';
//
//    // Fetch all documents from a collection:
//    const users = await getData('rollhub_customers');
//
//    // Set / create a document:
//    await setData('rollhub_customers', '9876543210', { name: 'Rahul', ... });
//
//    // Update specific fields:
//    await updateData('rollhub_customers', '9876543210', { points: 150 });
//
//    // Delete:
//    await deleteData('rollhub_customers', '9876543210');
// ============================================================

// ── Firebase ─────────────────────────────────────────────────
let db,
    docFn, collFn,
    getDocFn, getDDocsFn,
    setDocFn, addDocFn,
    updateDocFn, deleteDocFn,
    queryFn, whereFn, orderByFn, limitFn,
    onSnapshotFn, incrementFn,
    FIREBASE_READY = false;

let _initPromise = null;

// ============================================================
//  initDB()
//  Firebase connect karo — auto called on first use
// ============================================================
export async function initDB() {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      const cfg   = await import('../../shared/firebase-config.js');
      db           = cfg.db;
      docFn        = cfg.doc;
      collFn       = cfg.collection;
      getDocFn     = cfg.getDoc;
      getDDocsFn   = cfg.getDocs;
      setDocFn     = cfg.setDoc;
      addDocFn     = cfg.addDoc;
      updateDocFn  = cfg.updateDoc;
      deleteDocFn  = cfg.deleteDoc;
      queryFn      = cfg.query;
      whereFn      = cfg.where;
      orderByFn    = cfg.orderBy;
      onSnapshotFn = cfg.onSnapshot;
      incrementFn  = cfg.increment;
      FIREBASE_READY = true;
      console.log('[db.js] Firebase connected ✅');
    } catch (e) {
      FIREBASE_READY = false;
      console.warn('[db.js] Firebase offline — LocalStorage fallback', e.message);
    }
  })();

  return _initPromise;
}

// ── Auto-init on module load ──────────────────────────────────
initDB();

// ── Helper: LocalStorage key for a collection ─────────────────
function _lsKey(coll) {
  // Map Firestore collection names to LS keys
  const map = {
    rollhub_customers:   'krh_users',
    rollhub_bills:       'krh_bills',
    rollhub_inventory:   'krh_menu',
    rollhub_config:      'krh_settings',
    rollhub_help:        'krh_feedback',
    rollhub_socialTasks: 'krh_social_tasks',
    rollhub_referrals:   'krh_referrals',
    rollhub_stock:       'krh_stock',
    rollhub_rewards:     'krh_rewards',
  };
  return map[coll] || ('krh_' + coll);
}

function _lsGetAll(coll) {
  return JSON.parse(localStorage.getItem(_lsKey(coll)) || '[]');
}

function _lsSetAll(coll, data) {
  localStorage.setItem(_lsKey(coll), JSON.stringify(data));
}

// ============================================================
//  getData(collection, options?)
//  Ek collection ke saare documents fetch karo
//
//  options = {
//    orderBy:  'fieldName',
//    orderDir: 'asc' | 'desc',   (default: 'desc')
//    where:    ['field', 'op', 'value'],   e.g. ['status','==','active']
//  }
//
//  Returns: Array of objects (each has .id field = document ID)
// ============================================================
export async function getData(coll, options = {}) {
  await initDB();

  if (FIREBASE_READY) {
    try {
      const constraints = [];

      if (options.where) {
        const [field, op, val] = options.where;
        constraints.push(whereFn(field, op, val));
      }

      if (options.orderBy) {
        constraints.push(orderByFn(options.orderBy, options.orderDir || 'desc'));
      }

      const ref  = constraints.length
        ? queryFn(collFn(db, coll), ...constraints)
        : collFn(db, coll);

      const snap = await getDDocsFn(ref);
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Sync to LS
      _lsSetAll(coll, docs);
      return docs;

    } catch (e) {
      console.warn('[getData] Firestore failed:', e.message);
    }
  }

  // LS fallback
  return _lsGetAll(coll);
}

// ============================================================
//  getDoc(collection, docId)
//  Ek specific document fetch karo by ID
//
//  Returns: object | null
// ============================================================
export async function getDocData(coll, docId) {
  await initDB();

  if (FIREBASE_READY) {
    try {
      const snap = await getDocFn(docFn(db, coll, docId));
      if (snap.exists()) {
        const data = { id: snap.id, ...snap.data() };
        // Patch in LS
        const all = _lsGetAll(coll);
        const idx = all.findIndex(d => d.id === docId);
        if (idx !== -1) all[idx] = data; else all.push(data);
        _lsSetAll(coll, all);
        return data;
      }
      return null;
    } catch (e) {
      console.warn('[getDocData] Firestore failed:', e.message);
    }
  }

  return _lsGetAll(coll).find(d => d.id === docId) || null;
}

// ============================================================
//  setData(collection, docId, data, merge?)
//  Document create ya completely replace karo
//  merge = true → existing fields merge karo (default: true)
// ============================================================
export async function setData(coll, docId, data, merge = true) {
  await initDB();

  const doc = { ...data, id: docId };

  if (FIREBASE_READY) {
    try {
      await setDocFn(docFn(db, coll, docId), data, { merge });
    } catch (e) {
      console.warn('[setData] Firestore failed:', e.message);
    }
  }

  // LS sync
  const all = _lsGetAll(coll);
  const idx = all.findIndex(d => d.id === docId);
  if (idx !== -1) {
    all[idx] = merge ? { ...all[idx], ...doc } : doc;
  } else {
    all.push(doc);
  }
  _lsSetAll(coll, all);

  return { success: true };
}

// ============================================================
//  addData(collection, data)
//  Auto-ID ke saath naya document create karo
//  Returns: { success, id }
// ============================================================
export async function addData(coll, data) {
  await initDB();

  const id = data.id || Date.now().toString();
  const doc = { ...data, id };

  if (FIREBASE_READY) {
    try {
      // addDoc auto-generates ID, but we use setDoc with our ID
      await setDocFn(docFn(db, coll, id), doc);
    } catch (e) {
      console.warn('[addData] Firestore failed:', e.message);
    }
  }

  // LS sync
  const all = _lsGetAll(coll);
  all.unshift(doc);
  _lsSetAll(coll, all);

  return { success: true, id };
}

// ============================================================
//  updateData(collection, docId, updates)
//  Partial update — sirf specified fields badlo
//
//  Atomic increment ke liye:
//  import { incrementField } from './db.js';
//  await updateData('rollhub_customers', mob, { points: incrementField(10) });
// ============================================================
export async function updateData(coll, docId, updates) {
  await initDB();

  if (FIREBASE_READY) {
    try {
      await updateDocFn(docFn(db, coll, docId), updates);
    } catch (e) {
      console.warn('[updateData] Firestore failed:', e.message);
    }
  }

  // LS sync (for increment-type values, compute locally)
  const all = _lsGetAll(coll);
  const idx = all.findIndex(d => d.id === docId);
  if (idx !== -1) {
    const resolved = {};
    Object.entries(updates).forEach(([k, v]) => {
      // Handle _increment wrapper
      if (v && v.__increment) {
        resolved[k] = (all[idx][k] || 0) + v.__increment;
      } else {
        resolved[k] = v;
      }
    });
    all[idx] = { ...all[idx], ...resolved };
    _lsSetAll(coll, all);
  }

  return { success: true };
}

// ============================================================
//  deleteData(collection, docId)
//  Document permanently delete karo
// ============================================================
export async function deleteData(coll, docId) {
  await initDB();

  if (FIREBASE_READY) {
    try {
      await deleteDocFn(docFn(db, coll, docId));
    } catch (e) {
      console.warn('[deleteData] Firestore failed:', e.message);
    }
  }

  // LS sync
  const all = _lsGetAll(coll).filter(d => d.id !== docId);
  _lsSetAll(coll, all);

  return { success: true };
}

// ============================================================
//  listenData(collection, callback, options?)
//  Real-time onSnapshot listener
//  Returns: unsubscribe function
//
//  Usage:
//    const unsub = listenData('rollhub_customers', (users) => {
//      renderTable(users);
//    });
//    // Later: unsub(); // to stop listening
// ============================================================
export function listenData(coll, callback, options = {}) {
  if (!FIREBASE_READY) {
    // Fallback: call once with LS data
    callback(_lsGetAll(coll));
    return () => {}; // no-op unsubscribe
  }

  try {
    const constraints = [];

    if (options.where) {
      const [field, op, val] = options.where;
      constraints.push(whereFn(field, op, val));
    }

    if (options.orderBy) {
      constraints.push(orderByFn(options.orderBy, options.orderDir || 'desc'));
    }

    const ref = constraints.length
      ? queryFn(collFn(db, coll), ...constraints)
      : collFn(db, coll);

    return onSnapshotFn(ref, (snap) => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _lsSetAll(coll, docs);
      callback(docs);
    });

  } catch (e) {
    console.warn('[listenData] onSnapshot failed:', e.message);
    callback(_lsGetAll(coll));
    return () => {};
  }
}

// ============================================================
//  incrementField(amount)
//  Atomic increment wrapper — use with updateData()
//
//  Usage:
//    await updateData('rollhub_customers', mob, {
//      visits: incrementField(1),
//      points: incrementField(5),
//    });
// ============================================================
export function incrementField(amount) {
  // If Firebase is ready, return Firestore increment sentinel
  if (FIREBASE_READY && incrementFn) {
    return incrementFn(amount);
  }
  // Otherwise wrap for LS processing in updateData()
  return { __increment: amount };
}

// ============================================================
//  isFirebaseReady()
//  Check karo Firebase connected hai ya nahi
// ============================================================
export function isFirebaseReady() {
  return FIREBASE_READY;
}

// ============================================================
//  CONVENIENCE SHORTCUTS
//  Commonly used collection getters
// ============================================================

export const getUsers     = (opts) => getData('rollhub_customers', opts);
export const getBills     = (opts) => getData('rollhub_bills',     opts);
export const getMenuItems = (opts) => getData('rollhub_inventory', opts);
export const getStock     = (opts) => getData('rollhub_stock',     opts);
export const getRewards   = (opts) => getData('rollhub_rewards',   opts);
export const getFeedback  = (opts) => getData('rollhub_help',      opts);
export const getReferrals = (opts) => getData('rollhub_referrals', opts);
export const getSettings  = ()     => getDocData('rollhub_config', 'settings');