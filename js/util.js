/**
 * NEURAL COMMAND // AI SPIDER OS — v11
 * js/util.js — Utilidades compartidas: texto, seguridad, normalización y lingüística.
 *
 * Módulo puro (sin DOM al cargar): se puede probar en Node con `require`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NCUtil = Object.assign(root.NCUtil || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // ── Stopwords ES (núcleo funcional, sin términos de dominio) ──────────────
  const STOPWORDS = new Set((
    'el la los las un una unos unas de del al a y o u e en con por para por_que que se le les lo ' +
    'su sus mi mis tu tus nuestro nuestra nos os me te os es son fue fue_ron era eran ser estar esta ' +
    'estan estan_? este estos estas ese esos esas esa como cuando donde cual cuales quien quienes ' +
    'mas pero sin no ni si ya muy tambien también solo sólo sobre entre hasta desde hacia mediante ' +
    'durante todo toda todos todas cada otro otra otros otras tanto tanta tan asi así entonces ' +
    'porque pues ademas además embargo obstante mismo misma mismos mismas hay ha han hubo tiene ' +
    'tienen puede pueden podria podría debe deben hacer hace hacen sido sido_? siendo estando'
  ).split(/\s+/).filter(Boolean));

  const STOPWORDS_EN = new Set((
    'the a an of to in on for with and or but if then than that this these those is are was were be ' +
    'been being it its as at by from into over under about not no can could should would may might ' +
    'we you they he she them our your their there here which who whom what when where why how'
  ).split(/\s+/).filter(Boolean));

  // ── Normalización ─────────────────────────────────────────────────────────
  function normalize(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')   // quita diacríticos: "definición" → "definicion"
      .replace(/[“”„«»]/g, '"')
      .replace(/[‘’]/g, "'");
  }

  /** Stemmer ligero para español (determinista, sin diccionario). */
  function stem(word) {
    let t = normalize(word).replace(/[^a-z0-9%.,+-]/g, '');
    t = t.replace(/^[^a-z0-9]+|[^a-z0-9%]+$/g, '');
    if (!t) return '';
    if (/\d/.test(t)) return t;              // cifras y métricas se conservan
    // Flexiones que, si solo se quitara «es», no pasarían por el mismo
    // sufijo que el singular: variables/variable, latencias/latencia.
    if (/(?:ables|ibles|encias|ancias)$/.test(t)) t = t.slice(0, -1);
    // Los singulares breves se conservan íntegros; sus plurales también.
    else if (t.length === 5 && /(?:as|os)$/.test(t)) t = t.slice(0, -1);
    if (t.length <= 4) return t;
    return t
      .replace(/(aciones|iciones|amiento|imiento|idades|adores|adoras|ismos|istas)$/, '')
      .replace(/(acion|icion|mente|adora|ador|ante|encia|ancia|able|ible|idad|ivos|ivas)$/, '')
      .replace(/(ando|iendo|aron|ieron|aban|ian|adas|idos|es|os|as|a|o|e)$/, '');
  }

  function isStopword(w) {
    return STOPWORDS.has(w) || STOPWORDS_EN.has(w);
  }

  /** Palabras normalizadas (sin stem), en orden. */
  function words(text) {
    return normalize(text).split(/[^a-z0-9%.,+-]+/).map(w => w.replace(/^[.,+-]+|[.,+-]+$/g, '')).filter(Boolean);
  }

  /** Tokens indexables: minúsculas, sin acentos, sin stopwords, con stem. */
  function tokens(text) {
    const out = [];
    for (const w of words(text)) {
      if (w.length < 3) continue;
      if (isStopword(w)) continue;
      if (/^\d+$/.test(w) && w.length < 2) continue;
      out.push(stem(w));
    }
    return out;
  }

  /** Igual que tokens() pero conserva el término original para resaltado. */
  function analyze(text) {
    const raw = [], stems = [];
    for (const w of words(text)) {
      if (w.length < 3 || isStopword(w)) continue;
      raw.push(w);
      stems.push(stem(w));
    }
    return { raw, stems };
  }

  // ── Seguridad ─────────────────────────────────────────────────────────────
  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"'`]/g, c => HTML_ESCAPES[c]);
  }

  const escapeAttr = escapeHtml;

  function unescapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'").replace(/&#96;/g, '`').replace(/&amp;/g, '&');
  }

  /**
   * Markdown mínimo y seguro: escapa primero, luego aplica formato.
   * Nunca inyecta HTML del usuario ni del documento.
   */
  function safeMarkdown(md) {
    const safe = escapeHtml(md);
    const lines = safe.split(/\n/);
    const out = [];
    let inList = false;
    const inline = s => s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[(\d+)\]/g, '<span class="cite-ref">[$1]</span>');
    for (const line of lines) {
      const li = line.match(/^\s*[-*]\s+(.*)$/);
      const ol = line.match(/^\s*(\d+)\.\s+(.*)$/);
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (li) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + inline(li[1]) + '</li>');
        continue;
      }
      if (ol) {
        if (!inList) { out.push('<ul class="ol">'); inList = true; }
        out.push('<li>' + inline(ol[2]) + '</li>');
        continue;
      }
      if (inList) { out.push('</ul>'); inList = false; }
      if (h) {
        const level = Math.min(4, h[1].length) + 2;
        out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      } else if (line.trim() === '') {
        out.push('');
      } else {
        out.push('<div>' + inline(line) + '</div>');
      }
    }
    if (inList) out.push('</ul>');
    return out.join('');
  }

  // ── Evaluador aritmético seguro (sin eval / Function) ────────────────────
  /**
   * Evalúa expresiones aritméticas con + - * / % ^ ( ), unarios y funciones
   * sencillas (sqrt, log, ln, abs, sin, cos, tan, round, floor, ceil).
   * Devuelve null si la expresión no es válida.
   */
  function evaluateArithmetic(input) {
    const src = String(input || '').replace(/,/g, '.').replace(/\s+/g, '');
    if (!src || !/^[0-9+\-*/%^().a-z]+$/i.test(src)) return null;

    const tokens = src.match(/((?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)|([a-z]+)|([+\-*/%^()])/gi);
    if (!tokens || tokens.join('') !== src) return null;
    let i = 0;
    const peek = () => tokens[i];
    const next = () => tokens[i++];

    const FN = {
      sqrt: Math.sqrt, log: Math.log10, ln: Math.log, abs: Math.abs,
      sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp,
      round: Math.round, floor: Math.floor, ceil: Math.ceil, pi: () => Math.PI
    };

    function parseExpr() {
      let left = parseTerm();
      if (left === null) return null;
      while (peek() === '+' || peek() === '-') {
        const op = next();
        const right = parseTerm();
        if (right === null) return null;
        left = op === '+' ? left + right : left - right;
      }
      return left;
    }

    function parseTerm() {
      let left = parseUnary();
      if (left === null) return null;
      while (peek() === '*' || peek() === '/' || peek() === '%') {
        const op = next();
        const right = parseUnary();
        if (right === null) return null;
        if (op === '*') left *= right;
        else if (op === '/') left /= right;
        else left %= right;
      }
      return left;
    }

    function parseUnary() {
      if (peek() === '-') { next(); const v = parseUnary(); return v === null ? null : -v; }
      if (peek() === '+') { next(); return parseUnary(); }
      return parsePower();
    }

    function parsePower() {
      const base = parseAtom();
      if (base === null) return null;
      if (peek() === '^') {
        next();
        const exp = parseUnary();
        if (exp === null) return null;
        return Math.pow(base, exp);
      }
      return base;
    }

    function parseAtom() {
      const t = peek();
      if (t === undefined) return null;
      if (t === '(') {
        next();
        const v = parseExpr();
        if (v === null || next() !== ')') return null;
        return v;
      }
      if (/^[a-z]+$/i.test(t)) {
        const name = t.toLowerCase();
        next();
        if (name === 'pi') return Math.PI;
        if (!Object.hasOwn(FN, name)) return null;
        if (next() !== '(') return null;
        const arg = parseExpr();
        if (arg === null || next() !== ')') return null;
        return FN[name](arg);
      }
      if (/^(?:\d|\.\d)/.test(t)) { next(); return parseFloat(t); }
      return null;
    }

    const result = parseExpr();
    if (result === null || i !== tokens.length) return null;
    if (typeof result !== 'number' || !isFinite(result)) return null;
    return result;
  }

  // ── Hash / identidad ──────────────────────────────────────────────────────
  function hash(str) {
    const clean = normalize(str).replace(/[^a-z0-9]/g, '');
    let h = 2166136261;
    for (let i = 0; i < clean.length; i++) {
      h ^= clean.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  /** SHA-256 hex (para fingerprints de documentos); requiere crypto.subtle. */
  async function sha256(text) {
    try {
      if (!globalThis.crypto || !globalThis.crypto.subtle) return null;
      const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      return null;
    }
  }

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  // ── Texto ─────────────────────────────────────────────────────────────────
  function truncate(s, n) {
    const t = String(s == null ? '' : s);
    if (t.length <= n) return t;
    return t.slice(0, Math.max(0, n - 1)).trimEnd() + '…';
  }

  function words3(s) {
    return String(s || '').trim().split(/\s+/).slice(0, 3).join(' ');
  }

  function sentenceSplit(text) {
    return String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/([.!?…])\s+(?=[A-ZÁÉÍÓÚÑ¿¡"“])/g, '$1\u0001')
      .split(/\u0001|\n+/)
      .map(s => s.trim())
      .filter(s => s.length > 2);
  }

  function isHeading(line) {
    const t = String(line || '').trim();
    if (!t || t.length > 90) return false;
    if (/^#{1,6}\s+\S/.test(t) || /^\d+(?:\.\d+)*\.?\s+\S/.test(t)) return true;
    if (/[.!?;:,]$/.test(t) && t.split(/\s+/).length > 6) return false;
    if (/^(cap[ií]tulo|secci[oó]n|tema|unidad|parte|introducci[oó]n|conclusi[oó]n|resumen|objetivos|metodolog[ií]a|resultados|bibliograf[ií]a|anexo)\b/i.test(t)) return true;
    if (/^(\d+(\.\d+)*)\s+\S/.test(t)) return true;
    if (/^[A-ZÁÉÍÓÚÑ0-9 ,\-–—:()]{6,}$/.test(t) && t === t.toUpperCase()) return true;
    return false;
  }

  function jaccard(a, b) {
    if (!a || !b) return 0;
    const A = a instanceof Set ? a : new Set(a);
    const B = b instanceof Set ? b : new Set(b);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    for (const x of A) if (B.has(x)) inter++;
    return inter / (A.size + B.size - inter);
  }

  function trigrams(text) {
    const s = ' ' + normalize(text).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
    const out = new Set();
    for (let i = 0; i <= s.length - 3; i++) out.add(s.slice(i, i + 3));
    return out;
  }

  /** Similitud difusa por trigramas de caracteres (0..1). Tolera erratas y flexiones. */
  function trigramSim(a, b) {
    return jaccard(trigrams(a), trigrams(b));
  }

  function cosine(a, b) {
    if (!a || !b || !a.length || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
  }

  function formatMs(ms) {
    if (ms == null || !isFinite(ms)) return '—';
    if (ms < 1000) return Math.round(ms) + ' ms';
    return (ms / 1000).toFixed(2) + ' s';
  }

  function pct(x) {
    return Math.round((Number(x) || 0) * 100) + '%';
  }

  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function groupBy(arr, keyFn) {
    const out = new Map();
    for (const item of arr || []) {
      const k = keyFn(item);
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(item);
    }
    return out;
  }

  /** Muestra determinista repartida hasta el último elemento, sin mutar la lista. */
  function sampleEvenly(list, limit) {
    const n = Math.min(list.length, limit);
    return Array.from({ length: n }, (_, i) => list[Math.floor(i * (list.length - 1) / Math.max(1, n - 1))]);
  }

  function mean(arr) {
    if (!arr || !arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function percentile(arr, p) {
    if (!arr || !arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
    return s[idx];
  }

  function todayKey(d) {
    const dt = d ? new Date(d) : new Date();
    return dt.toISOString().slice(0, 10);
  }

  function dayDiff(a, b) {
    const A = new Date(a), B = new Date(b);
    return Math.round((B - A) / 86400000);
  }

  return {
    STOPWORDS, STOPWORDS_EN,
    normalize, stem, isStopword, words, tokens, analyze,
    escapeHtml, escapeAttr, unescapeHtml, safeMarkdown,
    hash, sha256, uid,
    truncate, words3, sentenceSplit, isHeading,
    jaccard, trigrams, trigramSim, cosine,
    formatMs, pct, debounce, groupBy, sampleEvenly, mean, percentile, todayKey, dayDiff,
    evaluateArithmetic
  };
});
