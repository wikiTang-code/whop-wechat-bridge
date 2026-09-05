/**
 * P2-11 monitoring.js — stub for P2-D.
 * P2-E (Gemini): implement 5s/30s poll, fill DOM per docs/p2-11-dom-contract.md.
 * Do not invent pushP95 sparklines; respect ingestRssMb === null.
 */
(function () {
  'use strict';
  const label = document.getElementById('refresh-label');
  if (label) label.textContent = '刷新: 待 P2-E';
  console.info('[monitoring] DOM skeleton ready; await P2-E poller');
})();
