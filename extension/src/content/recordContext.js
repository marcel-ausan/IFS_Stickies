'use strict';

/*
 * Record context detection.
 *
 * Aurena is a SPA. A record page URL typically looks like:
 *   https://host/main/ifsapplications/web/page/<Client>/<Page>;record=<b64>;path=<internal>...
 *
 * PRIMARY: the `record=` assignment is base64 of the business key, e.g.
 *   record=KE9yZGVyTm89J1QxMDAyOCcp  ->  (OrderNo='T10028')
 * That is stable and meaningful, so we use it as the binding key. We deliberately
 * ignore `path=` (an internal, volatile navigation path) for binding.
 *
 * FALLBACK (older/edge pages with no record=): harvest every key=value from the inline
 * assignments and any "$filter ... eq '...'" expression, then build a canonical signature.
 *
 * recordKey is the binding key for notes. luName/keyRef are best-effort extras for display.
 *
 * NOTE: This URL scheme is the fragile part of the whole solution — if Aurena
 * changes its routing on upgrade, revisit this file first. See CLAUDE.md.
 */

window.SN = window.SN || {};

(function (SN) {
  function decode(s) {
    try {
      return decodeURIComponent(s);
    } catch (_) {
      return s;
    }
  }

  // The Aurena `record=` assignment is base64 of the business key, e.g.
  // "KE9yZGVyTm89J1QxMDAyOCcp" -> "(OrderNo='T10028')". This is the stable, meaningful key.
  function decodeRecordParam(raw) {
    try {
      let b64 = decode(raw).replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return atob(b64);
    } catch (_) {
      return '';
    }
  }

  function parse() {
    const result = { luName: '', keyRef: '', recordKey: '', label: '', isRecord: false };

    // Page segment + inline assignments: /page/<client>/<page>;<assignments>
    const pageMatch = location.pathname.match(/\/page\/([^/]+)\/([^/;?#]+)(;[^?#]*)?/);
    const client = pageMatch ? decode(pageMatch[1]) : '';
    const pageName = pageMatch ? decode(pageMatch[2]) : '';
    const assignmentsStr = pageMatch && pageMatch[3] ? pageMatch[3].slice(1) : '';
    const pagePath = [client, pageName].filter(Boolean).join('/');
    const luHint = client || pageName;
    result.luName = luHint;

    // Preferred: the `record=` business key (stable across sessions, unlike the internal path=).
    const recMatch = location.href.match(/[;&?]record=([^;?#&]*)/);
    if (recMatch) {
      const decoded = decodeRecordParam(recMatch[1]);
      if (decoded) {
        result.keyRef = decoded; // e.g. (OrderNo='T10028')
        result.recordKey = pagePath + '::' + decoded;
        result.label = luHint ? luHint + '  ' + decoded : decoded;
        result.isRecord = true;
        return result;
      }
    }

    // Fallback: harvest key=value from inline assignments and any $filter (skip internal/unstable keys).
    const search = location.search ? location.search.slice(1) : '';
    const haystack = assignmentsStr + '&' + search;
    const pairs = [];

    assignmentsStr.split(/[;,]/).forEach((seg) => {
      const m = seg.match(/^([^=]+)=(.*)$/);
      if (m && !m[1].startsWith('$') && m[1] !== 'record' && m[1] !== 'path') {
        pairs.push([decode(m[1]), decode(m[2])]);
      }
    });

    const filterMatch = haystack.match(/\$filter=([^&;]+)/);
    if (filterMatch) {
      const filter = decode(filterMatch[1]);
      const re = /([A-Za-z0-9_]+)\s+eq\s+'([^']*)'/g;
      let fm;
      while ((fm = re.exec(filter))) pairs.push([fm[1], fm[2]]);
    }

    const seen = Object.create(null);
    const canonical = [];
    pairs.forEach(([k, v]) => {
      if (!(k in seen)) {
        seen[k] = v;
        canonical.push(k + '=' + v);
      }
    });
    canonical.sort();

    if (canonical.length) {
      result.keyRef = canonical.join('^') + '^';
      result.recordKey = luHint + '::' + canonical.join('^');
      result.label = luHint + ' [' + canonical.join(', ') + ']';
      result.isRecord = true;
    } else if (luHint) {
      result.recordKey = luHint + '::' + decode(location.pathname);
      result.label = luHint + ' (no record key)';
      result.isRecord = false;
    } else {
      result.recordKey = decode(location.pathname);
      result.label = 'No record detected';
      result.isRecord = false;
    }

    return result;
  }

  SN.context = { parse };
})(window.SN);
