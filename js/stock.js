// ============================================================
//  admin/js/stock.js
//  Inventory / Stock management
//  Firebase-first → LocalStorage fallback
//
//  Exports:
//    initStock()          — Firebase connect karo
//    getAllStock()         — Sab items fetch karo
//    addStockItem(item)   — Naya item add karo
//    updateStockItem(item)— Quantity / threshold update karo
//    deleteStockItem(id)  — Item permanently delete karo
//    getLowStockItems()   — Sidebar badge ke liye
// ============================================================

import { COLLECTIONS } from '../../shared/constants.js';

// ── Firebase ─────────────────────────────────────────────────
let db,
    docFn,
    collFn,
    getDDocsFn,
    getDocFn,
    setDocFn,
    updateDocFn,
    deleteDocFn,
    queryFn,
    orderByFn,
    FIREBASE_READY = false;

// ── LocalStorage key ─────────────────────────────────────────
const LS_KEY = 'krh_stock';

// ── Firestore collection name ─────────────────────────────────
// COLLECTIONS.menu = "rollhub_inventory" (constants.js se)
// Stock alag collection use karega taaki menu items se clash na ho
const STOCK_COLLECTION = 'rollhub_stock';

// ============================================================
//  initStock()
//  stock.html load hote hi yeh call hota hai
//  Firebase connect karta hai, fail hone par LS fallback
// ============================================================
export async function initStock() {
  try {
    const cfg   = await import('../../shared/firebase-config.js');
    db           = cfg.db;
    docFn        = cfg.doc;
    collFn       = cfg.collection;
    getDDocsFn   = cfg.getDocs;
    getDocFn     = cfg.getDoc;
    setDocFn     = cfg.setDoc;
    updateDocFn  = cfg.updateDoc;
    deleteDocFn  = cfg.deleteDoc;
    queryFn      = cfg.query;
    orderByFn    = cfg.orderBy;
    FIREBASE_READY = true;
    console.log('[stock.js] Firebase connected ✅');
  } catch (e) {
    FIREBASE_READY = false;
    console.warn('[stock.js] Firebase nahi mila — LocalStorage mode active.', e.message);
  }
}

// ============================================================
//  getAllStock()
//  Firestore rollhub_stock collection se sab items fetch karo
//  LocalStorage mein sync karo (offline fallback ke liye)
// ============================================================
export async function getAllStock() {
  if (FIREBASE_READY) {
    try {
      const snap  = await getDDocsFn(
        queryFn(
          collFn(db, STOCK_COLLECTION),
          orderByFn('addedAt', 'desc')
        )
      );
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Sync to LocalStorage
      localStorage.setItem(LS_KEY, JSON.stringify(items));
      return items;

    } catch (e) {
      console.warn('[getAllStock] Firestore failed, using LS:', e.message);
    }
  }

  // LocalStorage fallback
  return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
}

// ============================================================
//  addStockItem(item)
//  Naya raw material / packing item add karo
//  item = { id, name, category, unit, qty, threshold, costPerUnit, addedAt }
// ============================================================
export async function addStockItem(item) {
  const data = {
    ...item,
    addedAt:   item.addedAt   || new Date().toISOString(),
    updatedAt: item.updatedAt || new Date().toISOString(),
  };

  if (FIREBASE_READY) {
    try {
      // setDoc with item.id as document ID
      await setDocFn(docFn(db, STOCK_COLLECTION, data.id), data);
    } catch (e) {
      console.warn('[addStockItem] Firestore failed:', e.message);
      // Still save to LS below
    }
  }

  // Always save to LocalStorage
  const all = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  const idx = all.findIndex(i => i.id === data.id);
  if (idx !== -1) all[idx] = data;
  else all.unshift(data);
  localStorage.setItem(LS_KEY, JSON.stringify(all));

  return { success: true, item: data };
}

// ============================================================
//  updateStockItem(item)
//  Quantity change, threshold change, ya koi bhi field update
//  item must have { id, ...fields to update }
// ============================================================
export async function updateStockItem(item) {
  if (!item.id) return { success: false, message: 'ID missing' };

  const updates = {
    ...item,
    updatedAt: new Date().toISOString(),
  };

  if (FIREBASE_READY) {
    try {
      await updateDocFn(docFn(db, STOCK_COLLECTION, item.id), updates);
    } catch (e) {
      console.warn('[updateStockItem] Firestore failed:', e.message);
    }
  }

  // LocalStorage sync
  const all = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  const idx = all.findIndex(i => i.id === item.id);
  if (idx !== -1) {
    all[idx] = { ...all[idx], ...updates };
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  }

  return { success: true };
}

// ============================================================
//  deleteStockItem(id)
//  Item permanently delete karo — Firestore + LocalStorage dono se
// ============================================================
export async function deleteStockItem(id) {
  if (!id) return { success: false, message: 'ID missing' };

  if (FIREBASE_READY) {
    try {
      await deleteDocFn(docFn(db, STOCK_COLLECTION, id));
    } catch (e) {
      console.warn('[deleteStockItem] Firestore failed:', e.message);
    }
  }

  // LocalStorage sync
  const all = JSON.parse(localStorage.getItem(LS_KEY) || '[]')
    .filter(i => i.id !== id);
  localStorage.setItem(LS_KEY, JSON.stringify(all));

  return { success: true };
}

// ============================================================
//  getLowStockItems()
//  Sidebar badge ke liye — threshold se neeche wale items
// ============================================================
export async function getLowStockItems() {
  const all = await getAllStock();
  return all.filter(i => {
    const out = (i.qty || 0) <= 0;
    const low = (i.threshold > 0) && (i.qty <= i.threshold);
    return low || out;
  });
}

// ============================================================
//  getStockById(id)
//  Single item fetch karo (future use ke liye)
// ============================================================
export async function getStockById(id) {
  if (FIREBASE_READY) {
    try {
      const snap = await getDocFn(docFn(db, STOCK_COLLECTION, id));
      if (snap.exists()) return { id: snap.id, ...snap.data() };
    } catch (e) {
      console.warn('[getStockById] Firestore failed:', e.message);
    }
  }

  const all = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  return all.find(i => i.id === id) || null;
}

// ============================================================
//  isFirebaseReady()
//  stock.html mein status dikhane ke liye
// ============================================================
export function isFirebaseReady() {
  return FIREBASE_READY;
}