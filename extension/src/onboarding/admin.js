'use strict';

/*
 * Administrator guide.
 *
 * The person installing the extension usually cannot do any of this themselves —
 * it is IFS configuration work. So the page's job is to be forwardable: copy it
 * as plain text into an e-mail or ticket, or print it to PDF and attach it.
 */

const $ = (id) => document.getElementById(id);

function setMsg(text, kind) {
  const el = $('copyMsg');
  el.textContent = text || '';
  el.className = 'msg' + (kind ? ' ' + kind : '');
}

/*
 * Flatten the page to plain text. Tables become aligned rows rather than a run-on
 * line, because the field list is the part most likely to be pasted into a ticket
 * and it is useless if the columns collapse.
 */
function asPlainText() {
  const lines = ['IFS STICKY NOTES — ADMINISTRATOR SETUP', ''];

  document.querySelectorAll('.card, footer.foot').forEach((block) => {
    const num = block.querySelector('.n');
    const heading = block.querySelector('h3');
    if (heading) {
      lines.push('');
      lines.push(((num ? num.textContent.trim() + '. ' : '') + heading.textContent.trim()).toUpperCase());
      lines.push('');
    }

    block.querySelectorAll('p, li, table').forEach((node) => {
      if (node.closest('table') && node.tagName !== 'TABLE') return; // cells handled below
      if (node.tagName === 'TABLE') {
        node.querySelectorAll('tr').forEach((tr) => {
          const cells = [...tr.children].map((td) => td.textContent.trim());
          lines.push('  ' + cells[0].padEnd(16) + cells.slice(1).join('  |  '));
        });
        lines.push('');
        return;
      }
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      if (!text) return;
      lines.push(node.tagName === 'LI' ? '  - ' + text : text);
    });
  });

  return lines.join('\n');
}

$('copyAll').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(asPlainText());
    setMsg('Copied. Paste it into an e-mail or a ticket for your IFS administrator.', 'ok');
  } catch (_) {
    setMsg('Could not copy — use Print / save as PDF instead.', 'err');
  }
});

$('print').addEventListener('click', () => window.print());
