// ============================================================
//  admin/js/auth.js
//  Admin login, logout, session check
//
//  Usage:
//    import { checkAdminStatus, adminLogin, adminLogout }
//      from './auth.js';
//
//    // Top of every protected page:
//    checkAdminStatus();   ← redirects to login if not logged in
// ============================================================

// ── Constants ────────────────────────────────────────────────
const SESSION_KEY  = 'krh_admin_session';
const PASS_KEY     = 'krh_admin_pass';
const DEFAULT_PASS = 'admin123';
const LOGIN_PAGE   = '../index.html';    // redirect target if not logged in

// ============================================================
//  getAdminPass()
//  Current stored password return karo
// ============================================================
export function getAdminPass() {
  return localStorage.getItem(PASS_KEY) || DEFAULT_PASS;
}

// ============================================================
//  setAdminPass(newPass)
//  Password change karo
// ============================================================
export function setAdminPass(newPass) {
  if (!newPass || newPass.length < 6) {
    throw new Error('Password kam se kam 6 characters ka hona chahiye');
  }
  localStorage.setItem(PASS_KEY, newPass);
}

// ============================================================
//  adminLogin(password)
//  Password verify karo aur session set karo
//  Returns: { success: true/false, message }
// ============================================================
export function adminLogin(password) {
  const correct = getAdminPass();

  if (!password) {
    return { success: false, message: 'Password daalna zaroori hai' };
  }

  if (password !== correct) {
    // Increment failed attempts
    const attempts = parseInt(sessionStorage.getItem('krh_fail') || '0') + 1;
    sessionStorage.setItem('krh_fail', String(attempts));

    if (attempts >= 5) {
      return {
        success: false,
        message: '⚠️ 5 baar galat! Thodi der baad try karo.',
        locked: true,
      };
    }

    return {
      success: false,
      message: `❌ Password galat hai. (${attempts}/5 attempts)`,
    };
  }

  // ── Login success ─────────────────────────────────────
  const session = {
    loggedIn:  true,
    loginTime: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  sessionStorage.removeItem('krh_fail');  // reset failed attempts

  return { success: true, message: '✅ Login successful!' };
}

// ============================================================
//  adminLogout()
//  Session clear karo aur login page pe redirect karo
// ============================================================
export function adminLogout() {
  localStorage.removeItem(SESSION_KEY);
  // Redirect — works from both admin/index.html and admin/pages/*.html
  const isInPages = window.location.pathname.includes('/pages/');
  window.location.href = isInPages ? '../index.html' : 'index.html';
}

// ============================================================
//  isLoggedIn()
//  Session valid hai ya nahi check karo
//  Returns: true | false
// ============================================================
export function isLoggedIn() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return false;

    const session = JSON.parse(raw);
    if (!session.loggedIn) return false;

    // Expiry check
    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      localStorage.removeItem(SESSION_KEY);
      return false;
    }

    return true;
  } catch (e) {
    return false;
  }
}

// ============================================================
//  checkAdminStatus()
//  Har protected page ke top pe call karo
//  Agar logged in nahi → login page pe redirect
//
//  Usage (admin/pages/*.html mein):
//    import { checkAdminStatus } from '../js/auth.js';
//    checkAdminStatus();
// ============================================================
export function checkAdminStatus() {
  if (!isLoggedIn()) {
    adminLogout();
    return false;
  }
  // Refresh session expiry (sliding window)
  _refreshSession();
  return true;
}

// ============================================================
//  getSessionInfo()
//  Session details return karo (debug / display ke liye)
// ============================================================
export function getSessionInfo() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// ============================================================
//  changePassword(currentPass, newPass, confirmPass)
//  Complete password change flow with validation
// ============================================================
export function changePassword(currentPass, newPass, confirmPass) {
  if (!currentPass || !newPass || !confirmPass) {
    return { success: false, message: 'Saare fields bharo' };
  }

  if (currentPass !== getAdminPass()) {
    return { success: false, message: '❌ Current password galat hai' };
  }

  if (newPass.length < 8) {
    return { success: false, message: '❌ Min 8 characters chahiye' };
  }

  if (newPass !== confirmPass) {
    return { success: false, message: '❌ Passwords match nahi kar rahe' };
  }

  if (newPass === currentPass) {
    return { success: false, message: '❌ Naya password same nahi ho sakta' };
  }

  setAdminPass(newPass);
  return { success: true, message: '✅ Password change ho gaya!' };
}

// ============================================================
//  PRIVATE
// ============================================================
function _refreshSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const session = JSON.parse(raw);
    session.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (e) { /* ignore */ }
}