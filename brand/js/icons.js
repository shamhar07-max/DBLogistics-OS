/* DigitalBurj Logistics OS — icon set (24px grid, 1.75 stroke, round caps).
   Usage: <svg class="icon"><use href="#i-ship"/></svg>   (sprite is injected on load) */
(function () {
  var P = {
    today: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/>',
    customers: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 3-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17.5 14c2.8 0 4 1.8 4 4.5"/>',
    quote: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    shipment: '<path d="M3 7h18v11H3z"/><path d="M7.5 7v11M12 7v11M16.5 7v11"/>',
    ship: '<path d="M2.5 15h19l-3 5h-13z"/><path d="M6 15V9.5h9V15M9 9.5V6h3.5v3.5"/>',
    plane: '<path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/>',
    truck: '<path d="M1.5 6h12v10h-12z"/><path d="M13.5 9.5h4l3.5 3.5v3h-7.5"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    warehouse: '<path d="M3 21V9.5L12 4l9 5.5V21"/><path d="M7 21v-7h10v7M7 17.5h10"/>',
    customs: '<path d="M9.5 3h5v5.5l2.5 3.5v3H7v-3l2.5-3.5z"/><path d="M5 21h14M5 18h14"/>',
    docs: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    money: '<circle cx="12" cy="12" r="9"/><path d="M14.7 9.6c-.6-.8-1.6-1.1-2.7-1.1-1.5 0-2.6.8-2.6 2s1 1.7 2.6 2 2.6.8 2.6 2-1.1 2-2.6 2c-1.1 0-2.1-.4-2.8-1.2M12 6.5v2M12 15.5v2"/>',
    people: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 21v-1.5c0-3 3-5 7-5s7 2 7 5V21"/><path d="M9.5 3.8 12 2l2.5 1.8"/>',
    quality: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    sparkle: '<path d="M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    sliders: '<path d="M4 6h8M18 6h2M4 12h2M12 12h8M4 18h10M20 18h0"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pin: '<path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M5.5 12H3a9 9 0 0 0 18 0h-2.5M8 11h8"/>',
    scan: '<path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M12 8v8M16 8v8"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    pause: '<path d="M9 5v14M15 5v14"/>',
    play: '<path d="M7 5l12 7-12 7z"/>',
    mail: '<path d="M3 6h18v12H3z"/><path d="M3 7l9 6 9-6"/>',
    thermo: '<path d="M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z"/>',
    plug: '<path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5"/>',
    chart: '<path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8"/>',
    box: '<path d="M12 3l8 4v10l-8 4-8-4V7z"/><path d="M4 7l8 4 8-4M12 11v10"/>',
    invoice: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
    filter: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
    command: '<path d="M9 9V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.5-6 8-6s8 2 8 6"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.5-3.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14.5 3.5L20 15M20 20v-5h-5"/>',
    wifiOff: '<path d="M3 3l18 18M8.5 16.4a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 5-3M22 8.8a15 15 0 0 0-8-3.7M5 12.9a10 10 0 0 1 4-2.2M19 12.9a10 10 0 0 0-2.4-1.9M12 20h.01"/>'
  };
  var s = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">';
  for (var k in P) s += '<symbol id="i-' + k + '" viewBox="0 0 24 24">' + P[k] + '</symbol>';
  s += '</svg>';
  window.DBL_ICON = function (n, cls) { return '<svg class="icon ' + (cls || '') + '" aria-hidden="true"><use href="#i-' + n + '"/></svg>'; };
  function mount() { document.body.insertAdjacentHTML('afterbegin', s); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  window.DBL_ICON_NAMES = Object.keys(P);
})();
