// ============================================================
//  admin/js/utils.js
//  Shared utility functions — formatting, toasts, ID generation
//
//  Usage:
//    import { formatCurrency, formatDate, showToast, generateBillID }
//      from './utils.js';
// ============================================================

// ============================================================
//  formatCurrency(amt)
//  Numbers ko ₹ format mein convert karo
//  formatCurrency(1200)  → "₹1,200"
//  formatCurrency(90.5)  → "₹90.50"
// ============================================================
export function formatCurrency(amt) {
  const num = parseFloat(amt) || 0;
  return '₹' + num.toLocaleString('en-IN', {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

// ============================================================
//  formatDate(date)
//  Date ko readable format mein convert karo
//  formatDate('2025-06-15')          → "15 Jun 2025"
//  formatDate(new Date())            → "15 Jun 2025"
//  formatDate('2025-06-15T10:30:00') → "15 Jun 2025"
// ============================================================
export function formatDate(date) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-IN', {
    day:   'numeric',
    month: 'short',
    year:  'numeric',
  });
}

// ============================================================
//  formatDateTime(date)
//  Date + Time dono
//  → "15 Jun 2025, 10:30 AM"
// ============================================================
export function formatDateTime(date) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-IN', {
    day:'numeric', month:'short', year:'numeric'
  }) + ', ' + d.toLocaleTimeString('en-IN', {
    hour:'2-digit', minute:'2-digit'
  });
}

// ============================================================
//  formatTime(date)
//  Sirf time → "10:30 AM"
// ============================================================
export function formatTime(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
}

// ============================================================
//  daysSince(date)
//  Kitne din pehle tha
//  daysSince('2025-06-01') → 14
// ============================================================
export function daysSince(date) {
  if (!date) return 999;
  const d = new Date(date);
  if (isNaN(d)) return 999;
  return Math.floor((Date.now() - d) / 86400000);
}

// ============================================================
//  showToast(msg, type, duration)
//  Professional looking toast notification
//
//  type: 'success' | 'error' | 'warn' | 'info'
//
//  IMPORTANT: Page ke body mein <div id="toast-container"></div>
//  hona chahiye, ya ye function apne aap banayega.
// ============================================================
export function showToast(msg, type = 'success', duration = 3000) {
  // Container — banao agar nahi hai
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = [
      'position:fixed',
      'bottom:24px',
      'left:50%',
      'transform:translateX(-50%)',
      'z-index:9999',
      'display:flex',
      'flex-direction:column',
      'gap:8px',
      'align-items:center',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(container);
  }

  // Colors per type
  const styles = {
    success: { bg: '#166534', icon: '✅' },
    error:   { bg: '#991b1b', icon: '❌' },
    warn:    { bg: '#92400e', icon: '⚠️' },
    info:    { bg: '#1e40af', icon: 'ℹ️' },
  };
  const s = styles[type] || styles.success;

  // Toast element
  const toast = document.createElement('div');
  toast.style.cssText = [
    'background:' + s.bg,
    'color:#fff',
    'font-family:Inter,sans-serif',
    'font-size:13px',
    'font-weight:700',
    'padding:11px 20px',
    'border-radius:99px',
    'box-shadow:0 4px 16px rgba(0,0,0,.2)',
    'display:flex',
    'align-items:center',
    'gap:8px',
    'opacity:0',
    'transition:opacity .25s,transform .25s',
    'transform:translateY(8px)',
    'pointer-events:none',
    'white-space:nowrap',
    'max-width:90vw',
  ].join(';');
  toast.innerHTML = '<span>' + s.icon + '</span><span>' + msg + '</span>';
  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
  });

  // Animate out and remove
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 280);
  }, duration);

  return toast;
}

// ============================================================
//  generateBillID()
//  Unique bill ID generate karo
//  Format: KRH-20250615-A3F7
//  → Date-based prefix + 4 char random suffix
// ============================================================
export function generateBillID() {
  const now    = new Date();
  const year   = now.getFullYear();
  const month  = String(now.getMonth() + 1).padStart(2, '0');
  const day    = String(now.getDate()).padStart(2, '0');
  const rand   = Math.random().toString(36).toUpperCase().slice(2, 6);
  return `KRH-${year}${month}${day}-${rand}`;
}

// ============================================================
//  generateID(prefix)
//  General purpose unique ID
//  generateID('REW') → "REW-1718445367892-A3F"
// ============================================================
export function generateID(prefix = 'ID') {
  const ts   = Date.now().toString();
  const rand = Math.random().toString(36).toUpperCase().slice(2, 5);
  return `${prefix}-${ts}-${rand}`;
}

// ============================================================
//  truncate(str, len)
//  Long strings shorten karo
//  truncate('Paneer Kathi Roll Special', 15) → "Paneer Kathi..."
// ============================================================
export function truncate(str, len = 30) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

// ============================================================
//  debounce(fn, delay)
//  Search inputs ke liye — rapid calls throttle karo
// ============================================================
export function debounce(fn, delay = 400) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ============================================================
//  copyToClipboard(text)
//  Coupon code copy karne ke liye
// ============================================================
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('📋 Copied: ' + text, 'info', 2000);
    return true;
  } catch (e) {
    showToast('Copy nahi hua — manually karo', 'warn');
    return false;
  }
}

// ============================================================
//  pluralize(count, singular, plural)
//  pluralize(1, 'customer', 'customers') → "1 customer"
//  pluralize(5, 'customer', 'customers') → "5 customers"
// ============================================================
export function pluralize(count, singular, plural) {
  return count + ' ' + (count === 1 ? singular : (plural || singular + 's'));
}