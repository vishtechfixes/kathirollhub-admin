// ============================================================
//  admin/js/firebase.js
//  Firebase ka central connection point
//  Ye file shared/firebase-config.js se db aur auth import
//  karke re-export karti hai taaki har admin page sirf
//  isi ek file se import kare.
//
//  Usage in any admin page:
//    import { db, auth, SHOP_ID } from './firebase.js';
// ============================================================

// Re-export everything from the shared config
export {
  db,
  auth,
  SHOP_ID,

  // Firestore functions
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  increment,
  serverTimestamp,
} from '../../shared/firebase-config.js';