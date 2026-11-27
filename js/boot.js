// Runs before first paint: picks this phone's theme so there is no flash.
// Theme is stored per device. All keys are prefixed homeos- (shared origin).
(function () {
  var K_THEME = 'homeos-theme';
  var K_DIM = 'homeos-dim';
  var CLASSES = { night: 't-night', blush: 't-cozy t-blush', roast: 't-cozy t-roast' };
  var BAR = { night: '#272D3F', dim: '#1C2030', blush: '#FBEFF1', roast: '#4A3F38' };
  // Home screen icon per theme. iPhone reads it once, when the app is added to the home screen.
  var ICON = { night: 'icons/apple-touch-icon.png?v=3', blush: 'icons/apple-touch-icon-blush.png?v=1', roast: 'icons/apple-touch-icon-roast.png?v=2' };

  function read(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function write(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  // Local preview overrides (screenshots only). Ignored on any non-local host.
  var override = null;
  var h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || /\.localhost$/.test(h)) {
    var q = new URLSearchParams(location.search);
    if (q.get('preview')) {
      override = {};
      if (q.get('theme')) override.theme = q.get('theme');
      if (q.get('dim')) override.dim = q.get('dim') !== '0';
      var c = /^(\d{1,2}):(\d{2})$/.exec(q.get('clock') || '');
      if (c) { var d = new Date(); d.setHours(+c[1], +c[2], 0, 0); override.clock = d; }
    }
  }

  // ?look=blush|roast|night picks this phone's theme before installing, so the home screen icon matches.
  var look = new URLSearchParams(location.search).get('look');
  if (look && CLASSES[look] && !override) write(K_THEME, look);

  function now() { return override && override.clock ? new Date(override.clock) : new Date(); }

  function state() {
    var theme = (override && override.theme) || read(K_THEME, 'night');
    if (!CLASSES[theme]) theme = 'night';
    var dimOn = override && override.dim != null ? override.dim : read(K_DIM, '1') === '1';
    return { theme: theme, dimOn: dimOn };
  }

  function isDimHour(d) { var hr = d.getHours(); return hr >= 22 || hr < 6; }

  function apply() {
    var s = state();
    s.dimmed = s.theme === 'night' && s.dimOn && isDimHour(now());
    document.documentElement.className = CLASSES[s.theme] + (s.dimmed ? ' t-dim' : '');
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', BAR[s.dimmed ? 'dim' : s.theme]);
    var i = document.querySelector('link[rel="apple-touch-icon"]');
    if (i) i.setAttribute('href', ICON[s.theme]);
    return s;
  }

  window.homeosTheme = {
    apply: apply,
    now: now,
    isPreview: !!override,
    setTheme: function (t) { if (CLASSES[t]) { if (override) override.theme = t; else write(K_THEME, t); } return apply(); },
    setDim: function (on) { if (override) override.dim = on; else write(K_DIM, on ? '1' : '0'); return apply(); }
  };
  apply();
})();
