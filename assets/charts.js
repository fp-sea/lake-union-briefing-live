/* Lake Union Rowing Weather Briefing — client-side rendering.
 *
 * Three jobs, all of them deliberately on this side of the wire:
 *
 *   1. Preferences (theme, wind unit, temperature unit) in ONE stored object,
 *      not three mechanisms that can drift apart in localStorage.
 *   2. Unit conversion of every number already in the HTML. The canonical value
 *      rides in a data attribute (data-ms, data-c) so a conversion never has to
 *      reverse a rounded display string and slowly lose a digit.
 *   3. The §7 meteograms, drawn as SVG from the JSON the harvester precomputed.
 *
 * Why draw here rather than render PNGs server-side the way the sibling pages
 * do: the unit toggle and the theme switch then cost a redraw instead of a
 * re-harvest, and a matplotlib PNG cannot be dark-moded at all. The cost is this
 * file. The payoff is that "show me that in knots, in dark" is instant and
 * needs no second set of numbers kept in sync with the first.
 *
 * No dependencies. Everything below is plain DOM and SVG.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- prefs
  // 12-hour with am/pm is the default: this page is read by people getting up
  // in the dark to go rowing, not by aviators. 24-hour is one click away.
  // mph, not knots. Knots is the marine convention and the sibling Salish Sea
  // page uses it, but this is a freshwater lake in a US city and every other
  // wind number its readers see — phone forecast, car radio, NWS point forecast
  // — is in mph. Matching the surrounding world beats matching the sibling.
  // `compact` is off by default on every screen size, including phones. It
  // folds away the explanatory notes and the forward-looking blocks so a
  // section fits one screenshot — which is a thing a reader asks for
  // deliberately, not a thing a narrow viewport should decide for them.
  var DEFAULTS = { theme: null, wind: 'mph', temp: 'f', time: '12', compact: false };
  var root = document.documentElement;

  function readPrefs() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('prefs') || '{}')); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function writePrefs(p) {
    try { localStorage.setItem('prefs', JSON.stringify(p)); } catch (e) { /* private mode */ }
  }
  var prefs = readPrefs();

  // ------------------------------------------------------------ conversion
  // Canonical units upstream of this file, fixed in the harvester: wind m/s,
  // temperature degrees C, visibility metres, precipitation mm/h.
  var WIND = {
    kt:  { f: 1.9438445, label: 'kt' },
    mph: { f: 2.2369363, label: 'mph' }
  };

  function windValue(ms, unit) { return ms * WIND[unit].f; }
  function tempValue(c, unit) { return unit === 'c' ? c : c * 9 / 5 + 32; }
  // A temperature DIFFERENCE — a dewpoint depression, a forecast change. The
  // offset does not apply: 4.1 C of difference is 7.4 F of difference, not 39.4.
  // Separate function and separate class, because getting this wrong produces a
  // number that looks perfectly reasonable and is simply not the right one.
  function tempDelta(c, unit) { return unit === 'c' ? c : c * 9 / 5; }

  /* Clock formatting. Input is always canonical 24-hour "HH:MM".
   *
   * The two edge cases are the ones that make hand-rolled 12-hour clocks wrong,
   * and they are at opposite ends of the day: midnight is 12 am, not 0 am, and
   * noon is 12 pm, not 0 pm. `h % 12 || 12` handles both — the `|| 12` catches
   * the zero that the modulo produces for hours 0 and 12 alike.
   */
  function formatTime(hhmm, fmt) {
    if (!hhmm) return '';
    var parts = String(hhmm).split(':');
    var h = parseInt(parts[0], 10), m = parts[1] || '00';
    if (isNaN(h)) return hhmm;
    if (fmt === '24') return (h < 10 ? '0' : '') + h + ':' + m;
    var suffix = h < 12 ? 'am' : 'pm';
    // Narrow no-break space before the suffix: "6:04 am" must never wrap across
    // two lines, which is exactly what a narrow table cell does given the chance.
    return (h % 12 || 12) + ':' + m + ' ' + suffix;
  }

  function applyTimes() {
    var f = prefs.time;
    document.querySelectorAll('.u-time').forEach(function (el) {
      var hhmm = el.getAttribute('data-hhmm');
      el.textContent = formatTime(hhmm, f);
      // The machine-readable value stays in datetime= regardless of what the
      // reader sees, so assistive tech and any future parsing get the canonical
      // form rather than the localised display string.
      el.setAttribute('datetime', hhmm);
    });
    root.setAttribute('data-timefmt', f);
    document.querySelectorAll('[data-time-fmt]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-time-fmt') === f));
    });
  }

  function applyUnits() {
    var w = prefs.wind, t = prefs.temp;
    document.querySelectorAll('.u-wind').forEach(function (el) {
      var dp = parseInt(el.getAttribute('data-dp') || '0', 10);
      el.textContent = windValue(parseFloat(el.getAttribute('data-ms')), w).toFixed(dp);
    });
    document.querySelectorAll('.u-temp').forEach(function (el) {
      var dp = parseInt(el.getAttribute('data-dp') || '0', 10);
      el.textContent = tempValue(parseFloat(el.getAttribute('data-c')), t).toFixed(dp);
    });
    document.querySelectorAll('.u-tempd').forEach(function (el) {
      var dp = parseInt(el.getAttribute('data-dp') || '0', 10);
      el.textContent = tempDelta(parseFloat(el.getAttribute('data-c')), t).toFixed(dp);
    });
    document.querySelectorAll('.tile-unit').forEach(function (el) {
      var kind = el.getAttribute('data-unit');
      el.textContent = kind === 'wind' ? WIND[w].label : (t === 'c' ? '°C' : '°F');
    });
    applyOutlook();
    root.setAttribute('data-wind', w);
    root.setAttribute('data-temp', t);
    document.querySelectorAll('[data-wind-unit]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-wind-unit') === w));
    });
    document.querySelectorAll('[data-temp-unit]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-temp-unit') === t));
    });
  }

  // ---------------------------------------------------------------- theme
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  function currentTheme() { return root.getAttribute('data-theme') || (mq.matches ? 'dark' : 'light'); }

  function wireTheme() {
    var btn = document.getElementById('themetoggle');
    if (!btn) return;
    function label() {
      var dark = currentTheme() === 'dark';
      btn.textContent = dark ? 'Light' : 'Dark';
      btn.setAttribute('aria-pressed', String(dark));
    }
    btn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      prefs.theme = next; writePrefs(prefs);
      label(); drawAll();
      wireSpread();
    });
    // Follow the system only while the reader has NOT chosen — once they have,
    // their choice outranks the OS switching itself at sunset.
    mq.addEventListener('change', function () {
      if (!root.getAttribute('data-theme')) { label(); drawAll(); wireSpread(); }
    });
    label();
  }

  /* A tile only gets an expander if it has something folded away.
   *
   * Run repeatedly rather than once at init: applyAges creates the staleness
   * note minutes later, so a tile with nothing to fold at load can acquire
   * something to fold. Self-healing and cheap — it does nothing on a tile that
   * already has its button. */
  function ensureExpanders() {
    document.querySelectorAll('.tile').forEach(function (tile) {
      var has = tile.querySelector('.tile-outlook, .tile-stale-note');
      var btn = tile.querySelector('.tile-expand');
      if (has && !btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tile-expand';
        btn.setAttribute('data-expand', '');
        btn.textContent = 'detail';
        tile.appendChild(btn);
      } else if (!has && btn) {
        btn.remove();
      }
    });
  }

  function applyCompact() {
    root.classList.toggle('compact', !!prefs.compact);
    var btn = document.getElementById('compacttoggle');
    if (btn) {
      btn.setAttribute('aria-pressed', String(!!prefs.compact));
      // Names what pressing it will DO, like the theme button beside it, and
      // the pressed styling says which state you are in now. One without the
      // other leaves the reader guessing: "Compact" on a button could equally
      // mean "you are compact" or "become compact".
      btn.textContent = prefs.compact ? 'Full' : 'Compact';
      btn.setAttribute('aria-label', prefs.compact
        ? 'Switch back to the full layout'
        : 'Compact layout, for fitting a section on one screen');
    }
    ensureExpanders();
  }

  /* The section links, collapsed behind a button on a narrow screen.
   *
   * Progressive enhancement on purpose: the markup ships as a plain list and
   * the stylesheet wraps it, so a reader with no JavaScript gets all sixteen
   * links on three lines rather than a horizontal scrollbar. This only takes
   * that over when it can offer something better — the same sixteen links
   * behind one tap, and 53 px of sticky header back.
   *
   * Bound to the same 760 px the stylesheet's mobile block uses, and re-run on
   * resize so rotating a phone into landscape restores the plain bar.
   */
  function wireJumpMenu() {
    var nav = document.querySelector('.jump');
    var links = nav && nav.querySelector('.jump-links');
    if (!nav || !links) return;
    var mq = window.matchMedia('(max-width: 760px)');
    var btn = null;

    function close() {
      nav.classList.remove('menu-open');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }

    function apply() {
      if (mq.matches) {
        if (!btn) {
          btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'jump-menu';
          btn.setAttribute('aria-expanded', 'false');
          btn.setAttribute('aria-controls', 'jumplinks');
          btn.textContent = 'Sections';
          btn.addEventListener('click', function () {
            var open = nav.classList.toggle('menu-open');
            btn.setAttribute('aria-expanded', String(open));
          });
          links.id = links.id || 'jumplinks';
          // Into the preferences row, not onto a row of its own — a third row
          // would cost more sticky height than collapsing the links saves.
          var prefs = nav.querySelector('.jump-prefs');
          prefs.insertBefore(btn, prefs.firstChild);
          // Jumping to a section is the end of using the menu; leaving it open
          // would cover the heading the reader just asked for.
          links.addEventListener('click', function (ev) {
            if (ev.target.closest('a')) close();
          });
        }
        nav.classList.add('has-menu');
      } else {
        nav.classList.remove('has-menu', 'menu-open');
      }
    }

    mq.addEventListener('change', function () { close(); apply(); });
    apply();
  }

  /* Is this page older than its own schedule allows?
   *
   * The page states its rebuild times in five places and, until this, checked
   * them nowhere. A failed build serves the last good page indefinitely: the
   * ages go on ticking up truthfully, nothing is stale enough to be obviously
   * wrong, and the whole value of the thing — that it is current — quietly
   * stops being true. A scheduled build HAD been failing for a day before
   * anyone looked at the run list.
   *
   * GRACE is generous on purpose. GitHub runs scheduled jobs late as a matter
   * of routine — commonly five to fifteen minutes, occasionally far more, as
   * the workflow's own comment says — and a banner that cries wolf on an
   * ordinary late run is worse than no banner, because it trains the reader to
   * ignore the one that matters.
   */
  function wireOverdue() {
    var box = document.querySelector('[data-overdue]');
    var genAttr = root.getAttribute('data-generated');
    var slotAttr = root.getAttribute('data-slots');
    if (!box || !genAttr || !slotAttr) return;
    var GRACE_MIN = 90;

    function check() {
      var gen = Date.parse(genAttr);
      if (isNaN(gen)) return;
      var now = new Date();
      var slots = slotAttr.split(',').map(function (t) {
        return t.split(':').map(Number); });

      // The most recent slot that is already GRACE past due. Walk back through
      // today and yesterday so an overnight failure is caught at dawn, which
      // is exactly when this page is read.
      var due = null;
      for (var back = 0; back < 2 && due === null; back++) {
        for (var i = slots.length - 1; i >= 0; i--) {
          var d = new Date(now);
          d.setDate(d.getDate() - back);
          d.setHours(slots[i][0], slots[i][1], 0, 0);
          if (now - d >= GRACE_MIN * 60000) { due = d; break; }
        }
      }
      if (due === null || gen >= due.getTime()) { box.hidden = true; return; }

      var lateMin = Math.round((now - gen) / 60000);
      var hh = Math.floor(lateMin / 60), mm = lateMin % 60;
      box.innerHTML = '<strong>This page is overdue.</strong> It was built ' +
        (hh ? hh + ' h ' + (mm < 10 ? '0' : '') + mm + ' m' : mm + ' m') +
        ' ago, and the ' + fmtSlot(due) + ' rebuild has not landed. Every ' +
        'reading below is from the older run — the ages are honest, but the ' +
        'forecast is not as current as this page normally is.';
      box.hidden = false;
    }

    function fmtSlot(d) {
      var hh = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      return formatTime(hh, prefs.time) + tzSuffix();
    }

    check();
    // On the same minute tick as the ages, so a page left open crosses into
    // overdue on its own rather than waiting for a reload that may never come.
    setInterval(check, 60000);
    document.querySelectorAll('[data-time-fmt]').forEach(function (b) {
      b.addEventListener('click', function () { setTimeout(check, 0); });
    });
  }

  /* Has NWS amended the point forecast since this page was built?
   *
   * The page rebuilds three times a day; the gridpoint is republished roughly
   * hourly and amended between. So the official, human-supervised forecast —
   * the most important thing here — can be up to seven hours further along
   * than what is shown, and until this the page had no way to know.
   *
   * A HEAD request, not a fetch of the forecast. Last-Modified carries exactly
   * the same instant as the body's updateTime, it is on the CORS safelist so
   * it can be read cross-origin, and the response has no body: the check costs
   * a few hundred bytes against a public service rather than 192 KB.
   *
   * NOTHING IS REDRAWN. The page states its own issue times everywhere and
   * several sections compare the gridpoint against HRRR at one moment — the
   * gust ratio, the lightning three-source chart, the practice planner. Pulling
   * fresh NWS numbers into a page whose model half is from the last build would
   * quietly turn those comparisons into nonsense. This says the forecast has
   * moved; it does not move it.
   */
  function wireForecastCheck() {
    var el = document.querySelector('[data-fcheck]');
    if (!el) return;
    var url = el.getAttribute('data-url');
    var builtIso = el.getAttribute('data-built');
    if (!url || url === 'None' || !builtIso) return;
    var built = Date.parse(builtIso);
    if (isNaN(built)) return;

    var notice = document.querySelector('[data-fnotice]');

    // Two places, two lengths. The table cell is one column of four in a table
    // that scrolls sideways on a phone, so it gets a marker; the sentence goes
    // above the table where it can actually be read.
    function say(cls, mark, sentence, title) {
      el.className = 'fcheck ' + cls;
      el.textContent = ' \u00b7 ' + mark;
      if (title) el.title = title;
      if (!notice) return;
      if (sentence) { notice.innerHTML = sentence; notice.hidden = false; }
      else { notice.hidden = true; notice.textContent = ''; }
    }

    function check() {
      say('fcheck-wait', 'checking\u2026', null);
      fetch(url, { method: 'HEAD' }).then(function (r) {
        var lm = r.headers.get('Last-Modified');
        if (!r.ok || !lm) throw new Error('no Last-Modified');
        var theirs = Date.parse(lm);
        if (isNaN(theirs)) throw new Error('unparseable');
        var now = new Date();
        var hh = ('0' + now.getHours()).slice(-2) + ':' +
                 ('0' + now.getMinutes()).slice(-2);
        var checked = 'checked ' + formatTime(hh, prefs.time) + tzSuffix();
        // A minute of slack: the two stamps come from different clocks and an
        // equal-but-for-rounding pair is not an amendment.
        if (theirs - built > 60000) {
          var d = new Date(theirs);
          var thh = ('0' + d.getHours()).slice(-2) + ':' +
                    ('0' + d.getMinutes()).slice(-2);
          var lateMin = Math.round((theirs - built) / 60000);
          var at = formatTime(thh, prefs.time) + tzSuffix();
          say('fcheck-new', 'amended ' + at,
              '<strong>The point forecast has been amended.</strong> NWS republished ' +
              'it at ' + at + ', ' + fmtAge(lateMin) + ' after this page was built \u2014 ' +
              'so the point forecast below is the earlier version. Everything from the ' +
              'model is unaffected: it comes from a different source and is as current ' +
              'as this page is.',
              'Checked against ' + url);
        } else {
          say('fcheck-ok', checked + ', current', null,
              'NWS last published this grid at ' + lm);
        }
      }).catch(function () {
        // Silent about the reason, explicit about the state: an unanswered
        // check is not the same as a confirmed all-clear, and must not be
        // rendered as one.
        say('fcheck-fail', 'could not check', null);
      });
    }

    check();
    // Every quarter hour, and only while the tab is actually being looked at.
    // The grid is republished about hourly and this is somebody else's public
    // service; a tab left open all morning should not poll it.
    setInterval(function () {
      if (document.visibilityState === 'visible') check();
    }, 15 * 60000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') check();
    });
  }

  function wireCompact() {
    var btn = document.getElementById('compacttoggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      prefs.compact = !prefs.compact; writePrefs(prefs);
      applyCompact();
      // The charts are sized from their container, which just changed width in
      // the practice table and can change height anywhere — redraw rather than
      // leave a chart scaled to a box it is no longer in.
      drawAll(); wireSpread();
    });
    // Per-tile and per-row expanders. One handler on the strip rather than one
    // per control: the tiles are re-rendered by other code paths, and listeners
    // attached to individual nodes would be lost the first time that happened.
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest && ev.target.closest('[data-expand]');
      if (!t) return;
      var box = t.closest('.tile, .plan-row');
      if (box) box.classList.toggle('open');
    });
  }

  function wireUnits() {
    document.querySelectorAll('[data-time-fmt]').forEach(function (b) {
      b.addEventListener('click', function () {
        prefs.time = b.getAttribute('data-time-fmt'); writePrefs(prefs);
        // Charts too: their x-axis labels are clock times like everything else.
        // applyOutlook too: the wind badge's sparkline labels its left edge
        // with a clock time, which this toggle reformats like every other.
        applyTimes(); drawAll(); applyOutlook();
        wireSpread();
      });
    });
    document.querySelectorAll('[data-wind-unit]').forEach(function (b) {
      b.addEventListener('click', function () {
        prefs.wind = b.getAttribute('data-wind-unit'); writePrefs(prefs);
        applyUnits(); drawAll();
        wireSpread();
      });
    });
    document.querySelectorAll('[data-temp-unit]').forEach(function (b) {
      b.addEventListener('click', function () {
        prefs.temp = b.getAttribute('data-temp-unit'); writePrefs(prefs);
        applyUnits(); drawAll();
        wireSpread();
      });
    });
  }

  /* The glance strip's "next 12 hours", recomputed against the reader's clock.
   *
   * Server-rendered too, so it works without JavaScript — but that version is
   * anchored to the BUILD, and this page is built three times a day. Read at
   * lunchtime, a strip built at 05:00 would still be describing the window from
   * 05:00, which for the one tile people look at first is the whole value gone.
   *
   * It reads the same §6 payload the forecast charts draw from, so the tile and
   * the chart below it cannot disagree.
   */
  var OUTLOOK_DOMAIN = 'lake_union';
  // 12 mph, canonical. Mirrors WATCH_MS in src/process/outlook.py — the server
  // renders this line too, for readers without JavaScript, and the two must
  // agree or the page contradicts itself on a reload.
  var WATCH_MS = 12 * 0.44704;
  function isNortherly(b) {
    if (!num(b)) return false;
    var d = ((b % 360) + 360) % 360;
    return d >= 315 || d <= 45;
  }

  /* The next twelve hours as a shape, in the wind badge.
   *
   * The badge already says the range, the gust peak, the direction at the peak
   * and whether the two forecasts agree. What none of that can say is which
   * WAY it is going: "3-5 mph" reads the same whether the wind is steady,
   * climbing all morning, or spiking in an hour and dropping. For someone
   * deciding when to launch, that is the part worth having.
   *
   * Sustained only. A gust line would be a third thing to separate in a box
   * this size, and the badge already names the gust peak in words.
   *
   * Positioned by TIMESTAMP, not by index: the point forecast and the model
   * start at different hours and publish different counts, so laying them out
   * by array position would slide one against the other and invent a
   * disagreement that is not in the data.
   */
  function sparkPoints(times, vals, from, to) {
    var out = [];
    for (var i = 0; i < (times || []).length; i++) {
      var t = Date.parse(times[i]);
      if (isNaN(t) || t < from || t > to) continue;
      if (num((vals || [])[i])) out.push([t, vals[i]]);
    }
    return out;
  }

  function drawWindSpark(host, fc, from, to) {
    host.textContent = '';
    var a = sparkPoints(fc.times, fc.wind, from, to);
    var m = DATA && DATA.wind && DATA.wind[OUTLOOK_DOMAIN] &&
            DATA.wind[OUTLOOK_DOMAIN].hourly;
    // The model reaches 18 hours and the page can sit for nine, so it may not
    // cover this window at all. Drawing one line is better than drawing none.
    var b = m ? sparkPoints(m.times, m.mean, from, to) : [];
    if (a.length < 2 && b.length < 2) { host.hidden = true; return; }
    host.hidden = false;

    // The plot sits in the top 24; the bottom eight carry the word "now", so
    // it can never collide with a line that peaks in the first hour.
    var W = 150, H = 34, PLOT = 24, P = 2;
    /* ONE zero-based scale for both.
     *
     * Not each normalised to its own range: if the model says 15 and the
     * gridpoint says 8, that gap is the single most useful thing in the
     * picture, and per-series normalisation would draw them on top of each
     * other and hide exactly the disagreement this badge exists to flag.
     * Zero-based for the same reason a bar chart is — a line that starts at
     * the minimum turns a one-mile-an-hour wobble into a mountain. */
    var top = 0.5;
    a.concat(b).forEach(function (p) { if (p[1] > top) top = p[1]; });

    /* The 12 mph line, when the wind is anywhere near it.
     *
     * Same WATCH_MS the badge's own sentence is written against, so the shape
     * and "sustained stays under 12 mph" cannot disagree.
     *
     * Only drawn once the run gets within half of it, and the scale is
     * stretched to fit it only then. Pinning every day to a 12 mph ceiling
     * would squash a two-to-four mile-an-hour morning into a flat smear at the
     * bottom — and telling those two hours apart is the entire reason this
     * picture exists. A day nowhere near the threshold does not need the line;
     * the sentence underneath already says so in words. */
    var showWatch = top >= WATCH_MS * 0.5;
    if (showWatch) top = Math.max(top, WATCH_MS);

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%',
                          preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    function line(pts, dashed) {
      if (pts.length < 2) return;
      var d = '';
      pts.forEach(function (pt, i) {
        var x = P + (pt[0] - from) / (to - from) * (W - 2 * P);
        var y = (PLOT - P) - (pt[1] / top) * (PLOT - 2 * P);
        d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
      });
      svg.appendChild(el('path', {
        d: d, fill: 'none', stroke: css('--chart-line'),
        'stroke-width': dashed ? 1.2 : 1.6,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        opacity: dashed ? 0.55 : 1,
        // Solid is the point forecast, dashed the model — the pairing §7's
        // smoke chart already uses for a value and its second opinion.
        'stroke-dasharray': dashed ? '3 2' : null }));
    }
    svg.appendChild(el('line', { x1: P, x2: W - P, y1: PLOT - P, y2: PLOT - P,
                                 stroke: css('--line'), 'stroke-width': 1 }));
    if (showWatch) {
      var wy = (PLOT - P) - (WATCH_MS / top) * (PLOT - 2 * P);
      svg.appendChild(el('line', {
        x1: P, x2: W - P, y1: wy.toFixed(1), y2: wy.toFixed(1),
        stroke: css('--chart-extreme'), 'stroke-width': 1,
        'stroke-dasharray': '4 3', opacity: 0.8 }));
    }

    /* The left edge is the reader's own clock on a FORECAST axis, and it is
     * labelled with the time rather than with the word "now".
     *
     * "now" was wrong in a way that mattered. The badge's headline directly
     * above is a MEASUREMENT — 8 mph from SEAW1, minutes old — and the line
     * starts wherever the forecast has this hour, which on an ordinary day is
     * a different number entirely. A label reading "now" under one and beside
     * the other invites reading the left end of the line as the current wind.
     * It is not: it is where the forecast stands at this moment.
     *
     * A clock time cannot be mistaken for a wind reading, and it still says
     * the window is anchored to the reader — if it matches their watch, that
     * is self-evident without a word for it.
     *
     * The rule stays, because there is a visible gap between it and the first
     * point: the forecast is hourly, so the first plotted hour can be up to
     * fifty-nine minutes to the right of where the reader is standing. */
    svg.appendChild(el('line', { x1: P, x2: P, y1: 1, y2: PLOT - P,
                                 stroke: css('--chart-axis'), 'stroke-width': 1,
                                 opacity: 0.85 }));
    var at = new Date(from);
    var lab = el('text', { x: P, y: H - 1, 'font-size': 7.5,
                           fill: css('--ink-3') });
    lab.textContent = formatTime(
      String(at.getHours()).padStart(2, '0') + ':' +
      String(at.getMinutes()).padStart(2, '0'), prefs.time);
    svg.appendChild(lab);

    line(b, true);
    line(a, false);
    host.appendChild(svg);

    // The shape in words. The svg is aria-hidden, so this carries it for a
    // reader who is not looking at pictures.
    host.setAttribute('title', sparkWords(a, b, showWatch));
  }

  /* Rising, falling or steady — measured on the ends, said in the page's own
   * units. "Steady" needs a threshold or every line is rising by a hundredth;
   * 1 mph over twelve hours is under the resolution the gridpoint publishes. */
  function sparkWords(a, b, showWatch) {
    var STEADY = 0.44704;   // 1 mph, canonical
    function trend(p, name) {
      if (p.length < 2) return null;
      var d = p[p.length - 1][1] - p[0][1];
      var w = Math.abs(d) < STEADY ? 'steady' : (d > 0 ? 'rising' : 'easing');
      return name + ' ' + w;
    }
    var parts = [trend(a, 'point forecast'), trend(b, 'model')].filter(Boolean);
    if (!parts.length) return '';
    var say = 'Forecast for the next hours: ' + parts.join(', ');
    // Only when it is on screen. Describing a rule that was left off — because
    // the wind is nowhere near it — sends a reader looking for a line that is
    // not there and implies the picture is broken.
    if (showWatch) say += '. The dashed rule is ' +
                          Math.round(WATCH_MS / 0.44704) + ' mph.';
    return say;
  }

  /* When the badge names the model as well as the point forecast.
   *
   * The two always differ a little, and a badge carrying two ranges every day
   * is a badge nobody finishes reading. So the model is named only when it
   * would change the reading — and both halves of that matter:
   *
   *   FACTOR  half again as strong. Below that the two are telling the same
   *           story with different rounding.
   *   FLOOR   and strong enough to matter at all. A model saying 6 mph where
   *           the gridpoint says 3 is twice as much of nothing; printing it
   *           trains a reader to skip the clause on the day it is 24.
   *
   * The floor is half the watch threshold, which is the same fraction the
   * sparkline uses to decide the 12 mph rule is worth drawing. One number,
   * one reason, two places.
   */
  var MODEL_FACTOR = 1.5;
  var MODEL_FLOOR = WATCH_MS * 0.5;

  /* The model's own view of the same window: range, gust and the bearing at
   * its windiest hour — the same three facts the point forecast line gives,
   * because a reader comparing them needs them in the same shape.
   *
   * Named rather than blended into one wide range. Two forecasts disagreeing
   * is not one forecast's uncertainty, and this page has a measured finding
   * that HRRR gusts run about 1.8x the gridpoint's for the same hours — see
   * §7's "Are these gusts believable?". Averaging that away would bury the
   * thing that section exists to surface.
   */
  function modelOutlook(from, to) {
    var m = DATA && DATA.wind && DATA.wind[OUTLOOK_DOMAIN] &&
            DATA.wind[OUTLOOK_DOMAIN].hourly;
    if (!m || !m.times) return null;
    var w = [], g = [], dir = null, best = -Infinity;
    for (var i = 0; i < m.times.length; i++) {
      var t = Date.parse(m.times[i]);
      if (isNaN(t) || t < from || t > to) continue;
      var v = (m.mean || [])[i];
      if (!num(v)) continue;
      w.push(v);
      if (num((m.gust_max || [])[i])) g.push(m.gust_max[i]);
      if (v > best) { best = v; dir = (m.dir_mean || [])[i]; }
    }
    if (!w.length) return null;
    return { lo: Math.min.apply(null, w), hi: Math.max.apply(null, w),
             gust: g.length ? Math.max.apply(null, g) : null, dir: dir };
  }

  function applyOutlook() {
    var tiles = document.querySelectorAll('.tile-outlook[data-outlook]');
    if (!tiles.length || !FORECAST) return;
    var s = FORECAST[OUTLOOK_DOMAIN];
    if (!s || !s.times) return;

    var now = Date.now();
    tiles.forEach(function (box) {
      var span = parseInt(box.getAttribute('data-span') || '12', 10);
      var end = now + span * 3600 * 1000;
      var idx = [];
      for (var i = 0; i < s.times.length; i++) {
        var t = Date.parse(s.times[i]);
        if (!isNaN(t) && t >= now && t <= end) idx.push(i);
      }
      var body = box.querySelector('.tile-outlook-body');
      if (!body) return;
      var spark = box.querySelector('[data-spark]');
      if (!idx.length) {
        // The payload ran out before the window did — a page left open past the
        // end of its own forecast. Say so rather than summarising nothing.
        box.classList.add('outlook-spent');
        body.textContent = 'beyond this forecast';
        if (spark) spark.hidden = true;
        return;
      }
      box.classList.remove('outlook-spent');

      function pick(key) {
        var out = [];
        for (var k = 0; k < idx.length; k++) {
          var v = (s[key] || [])[idx[k]];
          if (num(v)) out.push(v);
        }
        return out;
      }

      if (box.getAttribute('data-outlook') === 'wind') {
        // Same `now` and `end` the text above is summarised from, so the shape
        // and the range can never describe different hours.
        if (spark) drawWindSpark(spark, s, now, end);
        var w = pick('wind'), g = pick('gust');
        if (!w.length) { body.textContent = '—'; return; }
        var lo = Math.min.apply(null, w), hi = Math.max.apply(null, w);
        var unit = WIND[prefs.wind].label;
        var txt = Math.round(windValue(lo, prefs.wind)) + '\u2013' +
                  Math.round(windValue(hi, prefs.wind)) + ' ' + unit;
        if (g.length) {
          txt += ', gusts ' + Math.round(windValue(Math.max.apply(null, g), prefs.wind));
        }
        // Direction at the WINDIEST hour: the hour that decides which shore is
        // sheltered. A range of bearings would read "variable" and say nothing.
        var peak = idx[0], best = -Infinity;
        for (var q = 0; q < idx.length; q++) {
          var v = (s.wind || [])[idx[q]];
          if (num(v) && v > best) { best = v; peak = idx[q]; }
        }
        var d = (s.dir || [])[peak];
        if (num(d) && hi >= 0.3) {
          txt += ', from ' + POINT16[Math.round((d % 360) / 22.5) % 16];
        }

        /* The model's numbers, when it is telling a different story.
         *
         * The badge summarised the point forecast alone while every other part
         * of the page treats the two as co-equal — the planner gives them a row
         * each, the watch line below consults both, and the sparkline directly
         * above draws both. On 2026-09-10 that had the badge reading "1-3 mph,
         * gusts 5" over hours the model put at 3-10 with gusts to 24, with the
         * picture above the sentence already showing the gap. A badge that
         * contradicts its own chart is worse than one that says less.
         */
        var mo = modelOutlook(now, end);
        if (mo) {
          var mPeak = Math.max(mo.hi, mo.gust || 0);
          var diverges = mo.hi >= hi * MODEL_FACTOR ||
                         (mo.gust !== null && g.length &&
                          mo.gust >= Math.max.apply(null, g) * MODEL_FACTOR);
          if (diverges && mPeak >= MODEL_FLOOR) {
            // No unit repeated: it is the same scale as the figures before it,
            // and the toggle moves both.
            txt += ' \u00b7 model ' + Math.round(windValue(mo.lo, prefs.wind)) +
                   '\u2013' + Math.round(windValue(mo.hi, prefs.wind));
            if (mo.gust !== null) {
              txt += ', gusts ' + Math.round(windValue(mo.gust, prefs.wind));
            }
            if (num(mo.dir) && mo.hi >= 0.3) {
              txt += ', from ' + POINT16[Math.round((mo.dir % 360) / 22.5) % 16];
            }
          }
        }
        body.textContent = txt;

        /* The watch line, and the tile's colour.
         *
         * The tile's NUMBER is an observation; its colour is about the hours
         * ahead, because that is what the reader is deciding on. A crew reading
         * "4 mph" in calm ink at 05:00 and meeting 15 mph at 07:00 has been
         * told the truth and warned of nothing.
         *
         * Counted in hours, not as a percentage: "over 12 for four hours from
         * 2 pm" is something to plan around; "33 per cent of the window" is a
         * number that has to be translated first.
         */
        /* The watch, from BOTH forecasts.
         *
         * The point forecast is NWS's gridpoint — human-reviewed, coarse in
         * time. The model is HRRR at 3 km, independent physics. They are
         * genuinely different answers to the same question, so agreement is
         * worth something and disagreement is worth more: a reader should be
         * able to tell "both say 13" from "only the model says 13".
         *
         * If EITHER crosses, the watch is on. Nothing here talks the other
         * down — a model that disagrees is not evidence of calm.
         *
         * Sustained only. Gusts touch 12 on most days here, and a watch that
         * fires on every gust is a watch nobody reads.
         */
        function overIn(series, key, dirKey) {
          var out = [];
          if (!series || !series.times) return out;
          var t0 = now, t1 = now + span * 3600 * 1000;
          for (var k = 0; k < series.times.length; k++) {
            var tt = Date.parse(series.times[k]);
            if (isNaN(tt) || tt < t0 || tt > t1) continue;
            var v = (series[key] || [])[k];
            if (num(v) && v >= WATCH_MS) {
              out.push({ iso: series.times[k], dir: (series[dirKey] || [])[k], v: v });
            }
          }
          return out;
        }
        var nwsOver = overIn(s, 'wind', 'dir');
        var mdl = (DATA && DATA.wind && DATA.wind[OUTLOOK_DOMAIN]
                   && DATA.wind[OUTLOOK_DOMAIN].hourly) || null;
        var mdlOver = overIn(mdl, 'mean', 'dir_mean');

        var watch = box.querySelector('[data-watch]');
        var all = nwsOver.concat(mdlOver);
        var on = all.length > 0;
        // The agreement finishes the sentence rather than sitting under it as a
        // label. "BOTH QUIET" repeated what the line above already said and
        // left "both" undefined — two forecasts are consulted and the tile
        // never told anyone that.
        var agree = !on || (nwsOver.length && mdlOver.length)
          ? 'point forecast and model agree on that'
          : nwsOver.length ? 'in the NWS point forecast only; the model stays under'
                           : 'in the HRRR model only; the point forecast stays under';
        if (watch) {
          var mph = Math.round(WATCH_MS * 2.2369363);
          if (!on) {
            watch.textContent = 'sustained stays under ' + mph + ' mph \u2014 ' + agree;
          } else {
            var hours = Math.max(nwsOver.length, mdlOver.length);
            // The direction at the windiest hour of whichever source is windier
            // — the wind that decides the outing, not an average of two guesses.
            var peakEntry = all.reduce(function (a, b) { return b.v > a.v ? b : a; });
            var nOrth = all.filter(function (e) { return isNortherly(e.dir); }).length;
            var txt = 'sustained over ' + mph + ' mph for ' + hours + ' h';
            if (num(peakEntry.dir)) {
              txt += ', from ' + POINT16[Math.round((peakEntry.dir % 360) / 22.5) % 16];
            }
            if (nOrth) txt += ' \u2014 northerly, worst through the Fremont Cut and the Ship Canal';
            txt += ' \u2014 ' + agree;
            watch.textContent = txt;
          }
          watch.classList.toggle('on', on);
        }
        var tile = box.closest('.tile');
        var overIdx = on ? [1] : [];
        if (tile) {
          // Never LOWER the tile: an active NWS advisory has already outranked
          // the derived state server-side, and a quiet forecast is not evidence
          // that the advisory has lifted.
          if (overIdx.length && tile.classList.contains('st-ok')) {
            tile.classList.remove('st-ok');
            tile.classList.add('st-watch');
          }
        }
      } else {
        // The feels-like tile ranges its OWN series, not the air temperature.
        // They are equal for most of the year here — the gridpoint hours carry
        // no humidity, so only wind chill can fire — and reading `temp` for
        // both would make that equality an artifact of the code rather than a
        // fact about the weather, which is the one thing these two tiles exist
        // side by side to show.
        var key = box.getAttribute('data-outlook') === 'feels_like' ? 'feels' : 'temp';
        var tv = pick(key);
        if (!tv.length && key === 'feels') { tv = pick('temp'); }
        if (!tv.length) { body.textContent = '—'; return; }
        body.textContent =
          Math.round(tempValue(Math.min.apply(null, tv), prefs.temp)) + '\u2013' +
          Math.round(tempValue(Math.max.apply(null, tv), prefs.temp)) + ' ' +
          (prefs.temp === 'c' ? '\u00b0C' : '\u00b0F');
      }
    });
  }

  /* Ages, computed in the browser rather than baked into the HTML.
   *
   * This page is STATIC and rebuilds three times a day, so anything phrased as
   * "62 min ago" at build time is a lie by the time it is read: a page built at
   * 20:41 and opened at 05:00 would still claim the observation was an hour
   * old, and the reader has no way to tell. On a page whose whole job is to
   * inform a decision about going on the water, an eight-hour-old reading
   * presented as fresh is the worst thing here.
   *
   * So the server emits the ABSOLUTE timestamp and a build-time fallback, and
   * the age is worked out against the reader's own clock. Re-run on a timer as
   * well, because this page gets left open on a phone at the dock.
   *
   * The fallback text says "at build" for exactly the no-JavaScript case: it is
   * less useful and it is still true, which is the right way round.
   */
  function applyAges() {
    var now = Date.now();
    document.querySelectorAll('.u-age[data-since]').forEach(function (el) {
      var t = Date.parse(el.getAttribute('data-since'));
      if (isNaN(t)) return;
      var mins = Math.floor((now - t) / 60000);
      var suffix = el.getAttribute('data-suffix') || '';
      // A future timestamp means clock skew between here and the source, not a
      // forecast: say so rather than printing a negative duration.
      el.textContent = mins < 0 ? 'just now'
        : fmtAge(mins) + (suffix ? ' ' + suffix : '');
      el.title = 'at ' + new Date(t).toLocaleString();
    });
    applyStaleness(now);
    markCurrentHour(now);
    applyOutlook();
  }

  /* Which bar on the UV curve is the hour the reader is in.
   *
   * Client-side for the usual reason: the curve is a rolling window fetched at
   * build, so "now" is wherever the reader is in it, not where the build was.
   * On a page opened seven hours after its last rebuild, the marked bar is the
   * difference between a chart of the day and a chart of your outing.
   */
  function markCurrentHour(now) {
    var bars = document.querySelectorAll('.uvbar[data-hour]');
    if (!bars.length) return;
    var best = null, bestGap = Infinity;
    bars.forEach(function (b) {
      var t = Date.parse(b.getAttribute('data-hour'));
      if (isNaN(t)) return;
      // The bar whose hour has started most recently; a bar in the future is
      // never "now", so only past-or-equal hours are eligible.
      var gap = now - t;
      if (gap >= 0 && gap < bestGap) { bestGap = gap; best = b; }
    });
    bars.forEach(function (b) { b.classList.toggle('now', b === best); });
  }

  /* The glance strip's freshness limits, applied against the reader's clock.
   *
   * Each tile publishes the limit its own FIELD is judged by — 90 minutes for
   * wind, twelve hours for water temperature, because a lake takes days to move
   * a degree and wind on this water turns over inside an hour. Those limits
   * already gate what gets built; what the build cannot do is notice a reading
   * crossing its limit AFTERWARDS, which on a page rebuilt three times a day is
   * most of the reading's life.
   *
   * A tile past its limit keeps its number rather than blanking it. The last
   * known wind, clearly marked four hours old, is more use at 05:00 than a dash
   * — and a dash would also read as "no sensor", which is a different and
   * wronger claim. What changes is that it stops presenting itself as current.
   */
  function applyStaleness(now) {
    document.querySelectorAll('.tile[data-max-age][data-since]').forEach(function (tile) {
      var t = Date.parse(tile.getAttribute('data-since'));
      var limit = parseInt(tile.getAttribute('data-max-age'), 10);
      if (isNaN(t) || isNaN(limit)) return;
      var mins = Math.floor((now - t) / 60000);
      var stale = mins > limit;
      tile.classList.toggle('tile-stale', stale);
      var note = tile.querySelector('.tile-stale-note');
      if (stale && !note) {
        note = document.createElement('div');
        note.className = 'tile-stale-note';
        // Before the outlook, not after it: the note is about the OBSERVATION,
        // and below the forecast line it reads as a comment on the forecast.
        tile.insertBefore(note, tile.querySelector('.tile-outlook'));
      }
      if (note) {
        note.textContent = stale
          ? 'older than this reading stays useful (' + fmtAge(limit) + ')' : '';
        note.hidden = !stale;
      }
    });
  }

  function fmtAge(m) {
    if (m < 60) return m + ' min';
    if (m < 60 * 36) return Math.floor(m / 60) + ' h ' + ('0' + (m % 60)).slice(-2) + ' m';
    return Math.floor(m / 1440) + ' d ' + Math.floor((m % 1440) / 60) + ' h';
  }

  /* Disclosure panels.
   *
   * Nothing is remembered here, deliberately. An earlier version persisted
   * whether the orientation map had been opened, which sounded like a courtesy
   * and defeated the point: one exploratory click and the panel is open on
   * every future visit, which is the opposite of hidden by default. It is a
   * reference — consulted occasionally, not carried around — so it starts
   * closed every time.
   */
  function wireDisclosures() {
    /* Safari restores the open state of <details> across a reload.
     *
     * It treats it as form state, the way it restores a text field or a
     * checkbox, so a panel opened once comes back open on every refresh even
     * though the HTML says nothing of the kind and nothing here is stored. It
     * survives a normal reload and a back/forward restore, which is why it read
     * as "the map keeps reopening" rather than as a caching problem.
     *
     * The markup is the authority: whatever the server wrote is what the reader
     * gets. Applied to every panel, not just the map, because the hourly tables
     * and the forecaster's discussion are restored the same way.
     */
    // Restoration can land after this script runs, so the reset is applied more
    // than once — but never after the reader has touched a panel. Closing one
    // that someone deliberately opened would be a worse bug than the one being
    // fixed, and this page loads cameras and eighteen radar frames, so `load`
    // can fire seconds late.
    var userActed = false;
    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('summary')) userActed = true;
    }, true);

    function resetToMarkup() {
      if (userActed) return;
      document.querySelectorAll('details').forEach(function (d) {
        // NOT `d.open = d.hasAttribute('open')`. `open` is a REFLECTED
        // attribute: setting the property sets the attribute, so by the time
        // this runs the restored state and the authored state are the same
        // thing and the check is a no-op. The intent has to be declared
        // somewhere the restoration cannot reach — an attribute of our own.
        d.open = d.getAttribute('data-start') === 'open';
      });
    }
    resetToMarkup();
    document.addEventListener('DOMContentLoaded', resetToMarkup);
    // bfcache: coming back with the back button restores the whole DOM, state
    // and all, without re-running the script.
    window.addEventListener('pageshow', function (e) {
      resetToMarkup();
      if (e.persisted) openForHash();
    });

    /* Following the jump link must not land on an empty heading.
     *
     * The nav points at the <h2>, which stays outside the panel so the anchor
     * and the section order survive. Collapsed, that means clicking "Map" would
     * scroll to a title with nothing under it — the reader has arrived at the
     * thing they asked for and it looks broken. Opening it on arrival costs
     * nothing and is what they meant.
     */
    function openForHash() {
      var id = (location.hash || '').slice(1);
      if (!id) return;
      var h = document.getElementById(id);
      if (!h) return;
      var next = h.nextElementSibling;
      if (next && next.tagName === 'DETAILS' && !next.open) {
        next.open = true;                 // the toggle handler records the choice
      }
    }
    openForHash();
    window.addEventListener('hashchange', openForHash);
  }

  // ----------------------------------------------------------------- tabs
  // Keyboard-operable, per the accessibility note in the spec's Global UI
  // section: arrow keys move between tabs in a strip, not just clicks.
  function wireTabs() {
    document.querySelectorAll('.tabs').forEach(function (group) {
      var strip = group.querySelector(':scope > .tabstrip');
      if (!strip) return;
      var tabs = Array.prototype.slice.call(strip.querySelectorAll('button[data-tab]'));

      function select(btn) {
        tabs.forEach(function (t) {
          var on = t === btn;
          t.setAttribute('aria-selected', String(on));
          t.tabIndex = on ? 0 : -1;
          var panel = document.getElementById(t.getAttribute('data-tab'));
          if (panel) panel.hidden = !on;
        });
        // A chart in a hidden panel has zero width, so it cannot be measured
        // and lays out wrong. Draw on reveal instead of on load.
        drawAll();
        wireSpread();
      }

      tabs.forEach(function (t, i) {
        t.tabIndex = t.getAttribute('aria-selected') === 'true' ? 0 : -1;
        t.addEventListener('click', function () { select(t); });
        t.addEventListener('keydown', function (e) {
          var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          var next = tabs[(i + d + tabs.length) % tabs.length];
          next.focus(); select(next);
        });
      });
    });
  }

  // --------------------------------------------------------------- charts
  function payload(id) {
    var el = document.getElementById(id);
    try { return el ? JSON.parse(el.textContent) : null; } catch (e) { return null; }
  }
  var DATA = payload('met-data');
  var FORECAST = payload('forecast-data');

  var NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    return n;
  }
  function css(name) {
    return getComputedStyle(root).getPropertyValue(name).trim();
  }

  var W = 760;                      // viewBox width; the SVG scales to its host
  // t:34 leaves room for TWO rows above the plot: the day label, and below it
  // the panel label with its summary. At t:20 there was room for one, so moving
  // the date clear of the summary pushed it to y=-12 — off the top of the
  // viewBox, where it was clipped rather than fixed. A collision that becomes
  // an absence is not an improvement.
  //
  // r:36 leaves room for the rain-and-cloud panel's RIGHT-hand axis. At r:14 the
  // cloud labels were drawn past the edge of the viewBox and simply vanished, so
  // the dashed line had no scale at all — the reader could see cloud rising and
  // falling with no way to read a number off it. The margin is global rather
  // than per-panel because every panel shares one x() and one time axis; a panel
  // with its own right edge would misalign the midnight rules above it.
  var M = { l: 58, r: 36, t: 34 };

  /* A round axis maximum at or above v.
   *
   * The ladder needs steps between 2.5 and 5, which the textbook 1/2/5/10 one
   * does not have: a 22 mph gust needs 25.1 after headroom, the old ladder
   * rounded that to 50, and more than half the panel was empty while the wind
   * line sat squashed along the bottom looking like nothing was happening.
   */
  var NICE = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  function niceMax(v) {
    if (!(v > 0)) return 1;
    var pow = Math.pow(10, Math.floor(Math.log10(v)));
    var n = v / pow;
    for (var i = 0; i < NICE.length; i++) if (n <= NICE[i]) return NICE[i] * pow;
    return 10 * pow;
  }

  /* Axes, gridlines and the time labels, shared by all three chart kinds.
     Returns the scales so each kind only has to draw its own marks. */
  function frame(svg, times, yMax, plotH, unitLabel, yTicks, dp) {
    var H = M.t + plotH;
    var x = function (i) { return M.l + (W - M.l - M.r) * (times.length < 2 ? 0 : i / (times.length - 1)); };
    var y = function (v) { return M.t + plotH - (plotH * Math.min(v, yMax) / yMax); };

    var g = el('g', {});
    var n = yTicks || 4;
    for (var i = 0; i <= n; i++) {
      var v = yMax * i / n, yy = y(v);
      g.appendChild(el('line', { x1: M.l, x2: W - M.r, y1: yy, y2: yy,
                                stroke: css('--chart-grid'), 'stroke-width': 1 }));
      var t = el('text', { x: M.l - 6, y: yy + 3.5, 'text-anchor': 'end',
                           fill: css('--chart-axis'), 'font-size': 10 });
      // Unit on the TOP tick, not floating above the panel — above it, it sat
      // a few pixels from that tick's own number, both left of the axis.
      var num = dp !== undefined ? v.toFixed(dp)
        : (v >= 100 ? Math.round(v) : (Math.round(v * 10) / 10));
      t.textContent = (i === n) ? num + ' ' + unitLabel : String(num);
      g.appendChild(t);
    }

    svg.appendChild(g);
    // The SAME time axis and day rules the stacked panels use. These charts had
    // their own sparser labelling and no day boundary at all, so precipitation,
    // visibility and smoke were read against a different scale from the wind
    // chart directly above them — and on a 48-hour lead there was nothing to
    // say where one day ended.
    nowBand(svg, times, x, M.t, H);
    dayRules(svg, times, x, M.t - 4, H, null, null, M.t - 22);
    sunRules(svg, times, x, M.t, H);
    timeAxis(svg, times, x, times.length, H + 13);
    return { x: x, y: y, H: H };
  }

  function path(pts, close) {
    return pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); })
              .join(' ') + (close ? ' Z' : '');
  }

  function host(node, viewH) {
    node.textContent = '';
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + viewH, role: 'img',
                          preserveAspectRatio: 'xMidYMid meet' });
    node.appendChild(svg);
    return svg;
  }

  function empty(node, msg) {
    node.textContent = '';
    var d = document.createElement('div');
    d.className = 'chart-empty';
    d.textContent = msg;
    node.appendChild(d);
  }

  /* Wind: spread band, central line, max-gust overlay, and the direction row.
   *
   * The direction row is arrows on the SAME time axis rather than a second line
   * chart, because plotting bearing as a 0-360 line breaks visually every time
   * the wind crosses due north — a real 5-degree shift renders as a jump from
   * 355 to 5. Opacity encodes R, the mean resultant length: R near 1 means the
   * domain's cells agree on direction, R near 0 means they do not and a single
   * confident arrow would be a lie. Below LOW_R no arrow is drawn at all, only
   * a neutral dot — there is genuinely no domain-wide direction to show.
   *
   * "Spread over time" needs no separate calculation or chart: it is whatever
   * this row visually does read across — all one way is a steady forecast,
   * rotating hour to hour is an unsettled one.
   */
  var LOW_R = 0.35, SOLID_R = 0.7;
  var BARB_H = 30;

  /* THE stacked-panel chart, shared by §6's point forecast and §7's domain
   * statistics. One renderer, so a reader who has learned to read one has
   * learned the other, and the two sections cannot drift apart visually.
   *
   * Three panels on one shared time axis: wind, temperature, and rain with
   * cloud. Stacked rather than combined on twin axes — wind, temperature and
   * rain have nothing to do with each other numerically, and overlaying them
   * makes crossings look meaningful when they are an artefact of the scaling.
   * Sharing only the x-axis keeps every vertical comparison honest: "the wind
   * gets up as the rain arrives" is read across, at one time.
   *
   * Each panel carries its own small label and they are separated by real
   * whitespace, because three unlabelled traces stacked in one box is a puzzle
   * rather than a chart.
   *
   * `opts.band` draws the domain spread; a point forecast has none and passes
   * false rather than a degenerate band.
   */
  var PANEL_GAP = 30;          // room for the next panel's label
  var LABEL_DY = 9;

  function num(v) { return v !== null && v !== undefined && !isNaN(v); }

  function mapv(arr, f) {
    return (arr || []).map(function (v) { return num(v) ? v * f : null; });
  }

  /* A line that BREAKS at gaps rather than bridging them — a straight segment
   * across four missing hours is an assertion the forecast does not make. */
  function line(vals, x, y, stroke, width, dash) {
    var d = '', pen = false;
    (vals || []).forEach(function (v, i) {
      if (!num(v)) { pen = false; return; }
      d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' ';
      pen = true;
    });
    return el('path', { d: d, fill: 'none', stroke: stroke, 'stroke-width': width,
                        'stroke-dasharray': dash || null });
  }

  /* Gridlines and a y-axis for one stacked panel. `bounds` lets a panel that is
   * not zero-based (temperature) label its own range. The unit rides on the TOP
   * tick rather than floating above the panel, where it collided with that
   * tick's own number. */
  function axis(svg, top, h, max, unitLabel, ticks, y, bounds, dp) {
    var g = el('g', {});
    for (var i = 0; i <= ticks; i++) {
      var v = bounds ? bounds[0] + (bounds[1] - bounds[0]) * i / ticks : max * i / ticks;
      var yy = y(v);
      g.appendChild(el('line', { x1: M.l, x2: W - M.r, y1: yy, y2: yy,
                                 stroke: css('--chart-grid'), 'stroke-width': 1 }));
      var lab = el('text', { x: M.l - 6, y: yy + 3.5, 'text-anchor': 'end',
                             fill: css('--chart-axis'), 'font-size': 10 });
      // `dp` is for a quantity whose useful range sits below the one decimal
      // place everything else needs — rain in inches per hour, where a whole
      // wet afternoon is 0.08 and rounding to a tenth labels every tick zero.
      var nv = dp !== undefined ? v.toFixed(dp)
        : (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
      lab.textContent = (i === ticks) ? nv + ' ' + unitLabel : String(nv);
      g.appendChild(lab);
    }
    svg.appendChild(g);
  }

  /* The mirror of `axis` for a panel carrying a second quantity on its own
   * scale. Deliberately draws NO gridlines: the left axis already rules the
   * panel, and a second set at different heights turns it into graph paper.
   * Short ticks outside the plot instead, so the numbers are anchored to
   * something without adding ink inside it. */
  function rightAxis(svg, h, max, unitLabel, ticks, y, colour) {
    var g = el('g', {}), rx = W - M.r;
    for (var i = 0; i <= ticks; i++) {
      var v = max * i / ticks, yy = y(v);
      g.appendChild(el('line', { x1: rx, x2: rx + 3, y1: yy, y2: yy,
                                 stroke: colour, 'stroke-width': 1, opacity: .6 }));
      var lab = el('text', { x: rx + 5, y: yy + 3.5, 'text-anchor': 'start',
                             fill: colour, 'font-size': 10 });
      lab.textContent = (i === ticks) ? Math.round(v) + unitLabel : String(Math.round(v));
      g.appendChild(lab);
    }
    svg.appendChild(g);
  }

  /* A single extra labelled tick, for a value the reader asked for that does not
   * fall on the regular ladder — the period's lightest wind, say. Drawn in the
   * series' own colour so it is clearly an annotation on that line rather than
   * another rung of the axis, and SUPPRESSED when it would land on top of a
   * regular tick, because two numbers overprinted are worse than one missing. */
  function axisMark(svg, value, label, colour, y, avoid) {
    var yy = y(value);
    for (var i = 0; i < avoid.length; i++) {
      if (Math.abs(yy - y(avoid[i])) < 11) return false;
    }
    svg.appendChild(el('line', { x1: M.l - 4, x2: M.l, y1: yy, y2: yy,
                                 stroke: colour, 'stroke-width': 1.5 }));
    var t = el('text', { x: M.l - 6, y: yy + 3.5, 'text-anchor': 'end',
                         fill: colour, 'font-size': 10 });
    t.textContent = label;
    svg.appendChild(t);
    return true;
  }

  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
             'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var POINT16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

  /* The timestamps arrive as ISO strings that already carry the Pacific offset,
   * so their date and clock fields ARE local and are read TEXTUALLY. Handing
   * them to Date() and formatting from that would re-express them in whatever
   * timezone the reader's device is in — labelling a 7 am row "10:00 am" for
   * someone on the east coast, on a page whose entire subject is one lake. */
  /* The zone every time on this page is in. Stamped on <html> by the builder,
   * which is the only place that knows it — and it changes twice a year, so a
   * literal "PDT" in the source would be wrong for four months of it. */
  var PAGE_TZ = document.documentElement.getAttribute('data-tz') || '';

  function tzSuffix() { return PAGE_TZ ? '\u00a0' + PAGE_TZ : ''; }

  function stampOf(iso) {
    var t = String(iso);
    var y = +t.slice(0, 4), mo = +t.slice(5, 7), da = +t.slice(8, 10);
    var dow = DOW[new Date(Date.UTC(y, mo - 1, da)).getUTCDay()];
    return dow + ' ' + da + ' ' + MON[mo - 1] + ', ' +
           formatTime(t.slice(11, 16), prefs.time) + tzSuffix();
  }

  /* Crosshair readout.
   *
   * The charts answer "when does it pick up" by shape; this answers "what
   * exactly, then" without making the reader open the hourly table. It is one
   * crosshair across all the panels rather than a tooltip per series, because
   * they share a time axis and the useful question is a VERTICAL read — the
   * prose above the chart already tells people to read them across, and this is
   * that instruction made operable.
   *
   * pointermove deliberately does NOT preventDefault: on a phone that would eat
   * the scroll, and this page is read on a phone at the boathouse. The readout
   * appearing during a scroll-drag is the acceptable cost of that.
   *
   * This is not the accessible path and is not meant to be. That is the <title>
   * summary on the SVG and the "Hour by hour" table below it, which carry the
   * same numbers without needing a pointer.
   */
  /* The same crosshair for a chart drawn through frame(): one plot, one or two
   * series, one call. Without this the gesture would work on §6 and §7's stacked
   * panels and silently do nothing on the visibility and smoke charts beside
   * them, which is worse than not having it — a reader who learns an affordance
   * on one chart will try it on the next. */
  function hoverFrame(node, svg, sc, times, plotH, series) {
    wireHover(node, svg, {
      n: times.length, x: sc.x, series: series, top: M.t, bottom: M.t + plotH,
      times: times,
      stamp: function (i) { return stampOf(times[i]); } });
  }

  function wireHover(node, svg, spec) {
    if (!spec.n || !spec.series.length) return;

    var guide = el('line', { y1: spec.top, y2: spec.bottom, stroke: css('--chart-axis'),
                             'stroke-width': 1, opacity: 0, 'pointer-events': 'none' });
    svg.appendChild(guide);
    var dots = el('g', { 'pointer-events': 'none' });
    svg.appendChild(dots);

    var box = document.createElement('div');
    box.className = 'hov';
    box.hidden = true;
    node.appendChild(box);

    var slider = null;    // created at the end; showIndex keeps it in step

    // The plot's own left and right edges. Defaulted to the shared margins,
    // which is what every line chart here uses — but the profile charts put a
    // place-name gutter down the side, and a hit area measured from the wrong
    // edge maps the pointer to the wrong hour rather than failing visibly.
    var HL = spec.left === undefined ? M.l : spec.left;
    var HR = spec.right === undefined ? M.r : spec.right;

    // Last, and with an explicit pointer-events, so it sits above the data and
    // catches the pointer anywhere in the plot rather than only over a line.
    var hit = el('rect', { x: HL, y: spec.top, width: W - HL - HR,
                           height: spec.bottom - spec.top,
                           fill: 'none', 'pointer-events': 'all' });
    svg.appendChild(hit);

    function hide() {
      guide.setAttribute('opacity', 0);
      dots.textContent = '';
      box.hidden = true;
    }

    /* Split from the pointer handler so the same readout can be driven by an
     * index rather than by a clientX. The slider below the chart needs exactly
     * that, and a second drawing path would be a second crosshair to keep in
     * step with this one. */
    function showIndex(i) {
      var r = svg.getBoundingClientRect();
      if (!r.width) return;
      var scale = W / r.width;                       // viewBox units per CSS px
      i = Math.max(0, Math.min(spec.n - 1, i));
      if (slider && +slider.value !== i) slider.value = String(i);

      var gx = spec.x(i);
      guide.setAttribute('x1', gx);
      guide.setAttribute('x2', gx);
      guide.setAttribute('opacity', 0.55);

      dots.textContent = '';
      var html = '<b>' + spec.stamp(i) + '</b>';
      // A readout of one SENTENCE, not a column of values. The swatch/label/
      // value grid exists so numbers line up on a right edge; a sentence run
      // through it comes out right-aligned in a narrow column, which is the
      // one alignment prose should never have.
      if (spec.prose) {
        var only = spec.series[0], t = only && only.text(i);
        box.innerHTML = html + '<p class="hov-prose">' + (t || '\u2014') + '</p>';
        box.hidden = false;
        placeBox(i);
        return;
      }
      spec.series.forEach(function (ser) {
        var txt = ser.text(i);
        if (!txt) return;
        // The swatch may depend on the hour. A series whose SIGN changes — the
        // convergence over this water, rising in one hour and sinking the
        // next — had a fixed colour, so the readout showed a blue block beside
        // the word "sinking". A colour that contradicts the value beside it is
        // worse than no colour.
        var col = typeof ser.colour === 'function' ? ser.colour(i) : ser.colour;
        // A dashed series gets a dashed swatch. Two series drawn in one colour
        // — a value and the conditional version of the same value — are told
        // apart on the chart by the dash pattern, and a readout that renders
        // both as identical solid blocks throws that away at exactly the
        // moment the reader is asking which is which.
        var sw = ser.dashed
          ? 'background:repeating-linear-gradient(90deg,' + col + ' 0 3px,' +
            'transparent 3px 6px)'
          : 'background:' + col;
        html += '<span><i style="' + sw + '"></i>' +
                ser.name + ' <em>' + txt + '</em></span>';
        if (ser.y && ser.values && num(ser.values[i])) {
          dots.appendChild(el('circle', {
            cx: gx.toFixed(1), cy: ser.y(ser.values[i]).toFixed(1), r: 3.2,
            fill: col, stroke: css('--bg'), 'stroke-width': 1.5 }));
        }
      });
      box.innerHTML = html;
      box.hidden = false;
      placeBox(i);
    }

    /* Clamped to the host, so a reading at either end of the axis stays whole
       instead of running off the side of the panel. Its own function because
       the prose branch above returns early and needs exactly this. */
    function placeBox(i) {
      var r = svg.getBoundingClientRect();
      if (!r.width) return;
      var scale = W / r.width;
      var gx = spec.x(i);
      // Positioned from bounding rects, NOT from svg.offsetLeft: offsetLeft is
      // an HTMLElement property and SVG elements do not implement it, so that
      // arithmetic came out NaN, the assignment was rejected as an invalid
      // length, and the box silently stayed wherever static layout put it.
      var w = box.offsetWidth;
      var hostRect = node.getBoundingClientRect();
      var px = (r.left - hostRect.left) + gx / scale;
      // Beside the crosshair, not centred on it, and flipped to the other side
      // once past halfway. Centred, the box sat squarely on the hour being read
      // — the reader lost the shape at exactly the moment they asked about it.
      var avail = node.clientWidth;
      var left = px > avail / 2 ? px - 14 - w : px + 14;
      box.style.left = Math.max(0, Math.min(avail - w, left)) + 'px';
    }

    function show(ev) {
      var r = svg.getBoundingClientRect();
      if (!r.width) return;
      var scale = W / r.width;
      var frac = ((ev.clientX - r.left) * scale - HL) / (W - HL - HR);
      showIndex(Math.round(frac * (spec.n - 1)));
    }

    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('pointercancel', hide);
    // On a touch screen a press-and-hold on the plot raised the system callout
    // — "Copy image" over the chart — instead of reading the hour under the
    // finger, and a drag along it panned the page. Both are the browser
    // claiming a gesture this chart needs. touch-action stays pan-y rather than
    // none so the page still scrolls VERTICALLY over a chart, which is most of
    // what a reader does with one.
    hit.style.touchAction = 'pan-y';
    hit.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    /* A slider under the chart, for readers with no pointer to hover.
     *
     * Dragging on the plot works on a phone once the gestures above are freed,
     * but it is undiscoverable and it hides the reading under the finger. The
     * slider is a real control in the page's own flow: it says the chart can be
     * scrubbed, it does not obscure the panel, and it is reachable by keyboard,
     * which the crosshair never was. Shown only where hovering does not exist —
     * see the pointer:coarse rule in the stylesheet.
     */
    slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'chart-scrub';
    slider.min = '0';
    slider.max = String(spec.n - 1);
    slider.step = '1';
    slider.value = '0';
    slider.setAttribute('aria-label', 'Scrub the chart by hour');
    slider.addEventListener('input', function () { showIndex(+slider.value); });
    node.appendChild(slider);

    /* On a touch screen the readout opens straight away, on the hour the
     * reader is actually in — the same "you are here" the shaded band marks.
     *
     * Two reasons it is not left hidden until first touch. The readout is in
     * normal flow here rather than floating over the plot, so revealing it on
     * first touch would shove the chart up the page under the finger that
     * asked. And a slider sitting at zero beside a chart says nothing about
     * what it does; parked on the current hour, it does. */
    if (window.matchMedia &&
        matchMedia('(hover:none) and (pointer:coarse)').matches && spec.times) {
      var fi = fracIndex(spec.times, new Date().toISOString());
      if (fi !== null) showIndex(Math.round(fi));
    }
  }

  function panelLabel(svg, top, text, sub) {
    var a = el('text', { x: M.l, y: top - LABEL_DY, 'text-anchor': 'start',
                         fill: css('--ink-2'), 'font-size': 11, 'font-weight': 650 });
    a.textContent = text;
    svg.appendChild(a);
    if (sub) {
      var b = el('text', { x: M.l + text.length * 6.8 + 10, y: top - LABEL_DY,
                           'text-anchor': 'start', fill: css('--chart-axis'), 'font-size': 10 });
      b.textContent = sub;
      svg.appendChild(b);
    }
  }

  /* Midnight rules, and the day they open.
   *
   * Shared, because the stacked panels drew them and the single-series charts
   * did not — so on a 48-hour lead the wind chart showed where Tuesday ended
   * and the precipitation chart below it showed nothing.
   *
   * Boundaries come from the payload's own `day_starts`, computed server-side
   * in Pacific: a local calendar day is not something to re-derive in whatever
   * timezone the reader happens to be in.
   */
  function dayRules(svg, times, x, top, bottom, starts, labels, labelY) {
    if (!starts) {
      // Derived from the timestamps when the payload does not carry them —
      // §7's precipitation, visibility and smoke series have times and nothing
      // else. Read TEXTUALLY, which is safe here for the same reason the axis
      // labels are: these strings already carry the Pacific offset, so their
      // date field IS the local date. Parsing them into Date objects would
      // re-derive the boundary in the reader's own timezone.
      starts = []; labels = [];
      var prev = null;
      for (var k = 0; k < times.length; k++) {
        var iso = String(times[k]), date = iso.slice(0, 10);
        if (prev !== null && date !== prev) {
          starts.push(k);
          labels[k] = stampOf(iso).split(',')[0];
        }
        prev = date;
      }
    }
    (starts || []).forEach(function (i) {
      svg.appendChild(el('line', { x1: x(i), x2: x(i), y1: top, y2: bottom,
                                   stroke: css('--chart-day'), 'stroke-width': 1.5,
                                   'stroke-dasharray': '3 3' }));
      var text = (labels || [])[i];
      if (!text) return;
      // Its own row, above the panel label. Sharing a row with the panel
      // subtitle put the date on top of the wind summary whenever a midnight
      // fell under it, which on a 48-hour chart is most of them.
      var lab = el('text', { x: x(i) + 4, y: labelY === undefined ? top - 6 : labelY,
                             'text-anchor': 'start',
                             fill: css('--chart-day'), 'font-size': 10,
                             'font-weight': 600 });
      lab.textContent = text;
      svg.appendChild(lab);
    });
  }

  /* Sunrise and sunset, marked on every chart that has a time axis.
   *
   * A dawn crew's real question is not "what time is sunrise" — §3 answers that
   * — but "is the wind up before the light is". Putting the two on the same
   * axis answers it by looking, which is the whole reason these are charts.
   *
   * Positioned by INTERPOLATED index, not by nearest hour: sunrise at 06:28
   * belongs between the 06:00 and 07:00 samples, and snapping it to one of them
   * would misplace it by up to half an hour on a chart whose whole subject is
   * timing.
   *
   * Drawn faintly and unlabelled where they would crowd — this is a reference
   * line, not a reading, and on a 48-hour chart there are four of them.
   */
  var SUN = payload('sun-data') || [];

  function fracIndex(times, iso) {
    var t = Date.parse(iso);
    if (isNaN(t) || !times.length) return null;
    var first = Date.parse(times[0]), last = Date.parse(times[times.length - 1]);
    if (isNaN(first) || isNaN(last) || t < first || t > last) return null;
    for (var i = 0; i < times.length - 1; i++) {
      var a = Date.parse(times[i]), b = Date.parse(times[i + 1]);
      if (t >= a && t <= b) return b === a ? i : i + (t - a) / (b - a);
    }
    return null;
  }

  /* The hour the reader is in, as a faint band behind the data.
   *
   * Every chart here is a window into the future drawn at build time, and the
   * reader arrives somewhere inside it — up to eight hours in, on a page
   * rebuilt three times a day. Without a mark, "where am I on this?" has to be
   * answered by reading the time axis against a clock.
   *
   * Deliberately NOT green. Green is --ok on this page — the colour of "these
   * conditions are fine" — so a green band would read as a verdict on the hour
   * it covers, worst exactly when the current hour is the windiest on the
   * chart. It reuses --chart-now, already "you are here" on the UV bars: one
   * colour, one meaning.
   *
   * A chart whose window does not contain now gets no band. That is the honest
   * answer for a run that ended before the reader opened the page, and it is
   * also the thing that tells apart "the model says no rain" from "the model
   * stopped before the rain" — the 18-hour run simply has no band once it has
   * aged out.
   */
  var NOW_BANDS = [];

  function nowBand(svg, times, x, top, bottom) {
    if (!times || times.length < 2) return;
    var r = el('rect', { y: top, height: bottom - top, fill: css('--chart-now'),
                         opacity: .12, visibility: 'hidden' });
    // First child, so it sits behind the gridlines as a background rather than
    // washing over the data it is meant to locate.
    svg.insertBefore(r, svg.firstChild);
    NOW_BANDS.push({ rect: r, times: times, x: x });
    placeNowBand(NOW_BANDS[NOW_BANDS.length - 1]);
  }

  function placeNowBand(b) {
    var fi = fracIndex(b.times, new Date().toISOString());
    if (fi === null) { b.rect.setAttribute('visibility', 'hidden'); return; }
    var i = Math.floor(fi);
    var x0 = b.x(i), x1 = b.x(Math.min(i + 1, b.times.length - 1));
    if (!(x1 > x0)) { b.rect.setAttribute('visibility', 'hidden'); return; }
    b.rect.setAttribute('x', x0);
    b.rect.setAttribute('width', x1 - x0);
    b.rect.setAttribute('visibility', 'visible');
  }

  /* A tab left open at the dock is the normal case, not the exception, and a
   * band that marked the hour the page LOADED would quietly become a lie an
   * hour later — worse than no mark, because it looks authoritative. It moves
   * on the same minute tick that already ages the readings, so the band is
   * always the reader's real current hour whether or not they reloaded.
   *
   * Bands belonging to charts that have since been redrawn are dropped rather
   * than updated: drawAll() replaces the whole SVG on resize and on revealing
   * a tab, orphaning the old rect.
   */
  function refreshNowBands() {
    NOW_BANDS = NOW_BANDS.filter(function (b) { return b.rect.isConnected; });
    NOW_BANDS.forEach(placeNowBand);
  }

  function sunRules(svg, times, x, top, bottom) {
    if (!SUN.length || !times || !times.length) return;
    SUN.forEach(function (d) {
      [["sunrise_iso", "sunrise"], ["sunset_iso", "sunset"]].forEach(function (pair) {
        var iso = d[pair[0]];
        if (!iso) return;
        var fi = fracIndex(times, iso);
        if (fi === null) return;
        var px = x(Math.floor(fi)) + (x(Math.min(Math.floor(fi) + 1, times.length - 1))
                                      - x(Math.floor(fi))) * (fi - Math.floor(fi));
        svg.appendChild(el('line', { x1: px, x2: px, y1: top, y2: bottom,
                                     stroke: css('--chart-sun'), 'stroke-width': 1,
                                     'stroke-dasharray': '1 3', opacity: .75 }));
      });
    });
  }

  /* Time labels along the bottom. Denser than the first version, which put four
   * labels across 48 hours — not enough to read a time off the chart without
   * counting. Aims for one roughly every 90 px and snaps to a round number of
   * hours so ticks land on sensible clock times. */
  /* One zone label per axis, at the right-hand end.
   *
   * Once, not on every tick: twenty-two ticks reading "09:00 PDT" is noise, and
   * a reader needs the zone established rather than repeated. Before this
   * nothing on any chart said it at all, which left anyone outside Pacific time
   * — or anyone who had simply forgotten — with no way to tell what these
   * hours were.
   */
  function timeAxis(svg, times, x, n, y) {
    if (PAGE_TZ) {
      var z = el('text', { x: W - M.r, y: y + 13, 'text-anchor': 'end',
                           fill: css('--chart-axis'), 'font-size': 9, opacity: .8 });
      z.textContent = PAGE_TZ;
      svg.appendChild(z);
    }
    var want = Math.max(4, Math.round((W - M.l - M.r) / 90));
    var raw = Math.max(1, Math.round(n / want));
    var step = [1, 2, 3, 4, 6, 8, 12, 24].reduce(function (best, c) {
      return Math.abs(c - raw) < Math.abs(best - raw) ? c : best; }, 24);
    for (var j = 0; j < n; j += step) {
      var t = el('text', { x: x(j), y: y,
                           'text-anchor': j === 0 ? 'start' : (j >= n - step / 2 ? 'end' : 'middle'),
                           fill: css('--chart-axis'), 'font-size': 10 });
      t.textContent = formatTime(String(times[j]).slice(11, 16), prefs.time);
      svg.appendChild(t);
    }
  }

  function drawPanels(node, s, opts) {
    if (!s || !s.times || !s.times.length) return empty(node, 'No data.');
    opts = opts || {};
    var u = prefs.wind, f = WIND[u].f;
    var n = s.times.length;

    // Pressure is a FOURTH panel and only the model has it: the NWS gridpoint
    // carries no pressure field at all, so §6 draws three panels and §7 draws
    // four. The height is computed rather than fixed so the chart does not
    // reserve empty space on the section that has nothing to put there.
    var hasPress = !!(s.pressure && s.pressure.filter(num).length);
    var windH = 96, tempH = 62, rainH = 56, pressH = 48;
    var top1 = M.t;
    var arrowsTop = top1 + windH + 4;
    var top2 = arrowsTop + BARB_H + PANEL_GAP;
    var top3 = top2 + tempH + PANEL_GAP;
    var top4 = top3 + rainH + PANEL_GAP;
    var viewH = (hasPress ? top4 + pressH : top3 + rainH) + 24;
    var svg = host(node, viewH);
    var x = function (i) { return M.l + (W - M.l - M.r) * (n < 2 ? 0 : i / (n - 1)); };

    // Spans the whole stack, so one band locates the reader on wind,
    // temperature, rain and pressure at once rather than four separate marks.
    nowBand(svg, s.times, x, top1, hasPress ? top4 + pressH : top3 + rainH);
    dayRules(svg, s.times, x, top1 - 4,
             hasPress ? top4 + pressH : top3 + rainH,
             s.day_starts, s.day_labels, top1 - 22);
    sunRules(svg, s.times, x, top1, hasPress ? top4 + pressH : top3 + rainH);

    // --- 1. wind ------------------------------------------------------------
    var wv = mapv(s.mean || s.wind, f), gv = mapv(s.gust_max || s.gust, f);
    var lo = opts.band ? mapv(s.lo, f) : null, hi = opts.band ? mapv(s.hi, f) : null;
    var gm = opts.band ? mapv(s.gust_mean, f) : null;
    // The axis top is the period's actual peak gust, not a rounded number above
    // it, so the top label IS the maximum — the same treatment temperature gets.
    // It also wastes no headroom, which is what niceMax's 15 per cent was for.
    //
    // The BOTTOM stays at zero, and that is not an oversight. Zero means calm,
    // which is a real and readable state on this water; an axis starting at the
    // period's lightest hour would magnify a dead-flat morning into a dramatic
    // rise, and on a wind chart that is not a cosmetic error. The minimum is
    // marked on the axis instead, where it can be read without lying about the
    // shape.
    var gvr = gv.filter(num), wvr = wv.filter(num);
    var hir = (hi || []).filter(num);
    var peak = Math.max.apply(null, gvr.concat(wvr, hir).length
                              ? gvr.concat(wvr, hir) : [1]);
    var wMax = peak || 1;
    var wy = function (v) { return top1 + windH - windH * Math.min(v, wMax) / wMax; };

    // The range in words as well as on the axis. The axis top is the peak, but
    // the LOW end usually is not readable there: on this water the lightest hour
    // is normally near calm, so its mark lands on the zero tick and is
    // suppressed. Rather than leave the reader to squint at a line near the
    // floor, the subtitle states both ends outright — it is always legible, it
    // never collides, and it survives a narrow phone.
    var wMin = wvr.length ? Math.min.apply(null, wvr) : null;
    var gPeak = gvr.length ? Math.max.apply(null, gvr) : null;
    var range = wMin === null ? (opts.band ? 'domain mean, spread and peak gust'
                                           : 'sustained and gusts')
      : (opts.band ? 'domain mean ' : 'sustained ') +
        wMin.toFixed(1) + '\u2013' + Math.max.apply(null, wvr).toFixed(1) + ' ' +
        WIND[u].label + (gPeak === null ? ''
          : (opts.band ? ', peak gust ' : ', gusting to ') + gPeak.toFixed(1));
    panelLabel(svg, top1, 'Wind', range);
    axis(svg, top1, windH, wMax, WIND[u].label, 3, wy);

    /* The 12 mph watch level, drawn on the panel itself.
     *
     * Deliberately quiet: a thin dashed rule and a small label, not a red band.
     * It is a WATCH and not a limit — the same 13 mph is nothing to a senior
     * four and a lot to a novice single — so the chart marks where the question
     * changes and leaves the answer to the person reading it.
     *
     * Only drawn when the axis actually reaches it. On a calm day the rule
     * would otherwise sit above every value, turning a quiet forecast into a
     * chart apparently dominated by a threshold nothing goes near.
     */
    var watchDisp = WATCH_MS * WIND[u].f;
    if (watchDisp <= wMax) {
      var wyw = wy(watchDisp);
      svg.appendChild(el('line', { x1: M.l, x2: W - M.r, y1: wyw, y2: wyw,
                                   stroke: css('--chart-watch'), 'stroke-width': 1,
                                   'stroke-dasharray': '2 4', opacity: .85 }));
      // A halo in the chart's own background colour, painted under the glyphs.
      // The label sits at the right edge of the wind panel, which is exactly
      // where the gust trace usually runs — without this it is legible on a
      // calm day and unreadable on the days it matters.
      var wl = el('text', { x: W - M.r - 3, y: wyw - 3, 'text-anchor': 'end',
                            fill: css('--chart-watch'), 'font-size': 9,
                            stroke: css('--bg'), 'stroke-width': 3,
                            'paint-order': 'stroke' });
      wl.textContent = Math.round(watchDisp) + ' ' + WIND[u].label + ' watch';
      svg.appendChild(wl);
    }
    // And still marked on the axis when it is far enough from a regular tick to
    // be read there — which is exactly when the wind never drops to calm, the
    // case where the number is most worth having.
    if (wMin !== null) {
      axisMark(svg, wMin, wMin.toFixed(1), css('--chart-line'), wy,
               [0, wMax / 3, 2 * wMax / 3, wMax]);
    }
    if (lo && hi) {
      var up = [], dn = [];
      hi.forEach(function (v, i) { if (num(v)) up.push([x(i), wy(v)]); });
      for (var q = lo.length - 1; q >= 0; q--) if (num(lo[q])) dn.push([x(q), wy(lo[q])]);
      if (up.length) svg.appendChild(el('path', { d: path(up.concat(dn), true),
                                                  fill: css('--chart-band'), stroke: 'none' }));
    }
    svg.appendChild(line(gv, x, wy, css('--chart-extreme'), 1.6, '5 3'));
    if (gm) svg.appendChild(line(gm, x, wy, css('--chart-extreme'), 1, '2 3'));
    svg.appendChild(line(wv, x, wy, css('--chart-line'), 2));

    var ag = el('g', {});
    var astep = Math.max(1, Math.round(n / 22));
    for (var i = 0; i < n; i += astep) {
      var d = (s.dir_mean || s.dir || [])[i];
      var spd = (s.mean || s.wind)[i];
      if (d === null || d === undefined || !num(spd) || spd < 0.3) continue;
      var r = s.dir_r ? s.dir_r[i] : 1;
      var op = r >= SOLID_R ? 1 : (r < LOW_R ? 0 : 0.35 + 0.65 * (r - LOW_R) / (SOLID_R - LOW_R));
      if (!op) {
        ag.appendChild(el('circle', { cx: x(i), cy: arrowsTop + BARB_H / 2, r: 2,
                                      fill: css('--chart-axis'), opacity: .45 }));
        continue;
      }
      ag.appendChild(el('path', {
        d: 'M0 -7 L0 7 M0 7 L-2.8 3 M0 7 L2.8 3',
        stroke: css('--chart-arrow'), 'stroke-width': 1.5, fill: 'none',
        'stroke-linecap': 'round', opacity: op.toFixed(2),
        // The arrow FLIES WITH the wind, which is what every weather map and
        // marine app does: a southerly points up the page. `d` is the direction
        // the wind comes FROM, the glyph points south unrotated, and SVG rotates
        // clockwise — so rotate(d) puts the head on bearing d + 180, the way the
        // air is actually moving.
        //
        // The head used to sit on bearing d instead, which agreed with the
        // tables word for word and disagreed with every other chart the reader
        // has ever seen. Matching the tables is not worth being the one page
        // where the arrows mean the opposite thing.
        //
        // Described by the arithmetic rather than in the old wording on
        // purpose: the guard against that wording is a substring search, and a
        // comment quoting the phrase it is disowning reads to a search exactly
        // like the bug still being there.
        transform: 'translate(' + x(i).toFixed(1) + ',' + (arrowsTop + BARB_H / 2) +
                   ') rotate(' + (((d % 360) + 360) % 360) + ')' }));
    }
    svg.appendChild(ag);

    /* A key for the arrow row, in the axis gutter beside it.
     *
     * The arrows fly DOWNWIND, the way most weather maps draw them, while the
     * tables state the direction the wind comes FROM because that is how a
     * forecast is spoken. Those are the same fact 180 degrees apart, so an
     * unlabelled arrow is a coin-flip between two readings and the reader has
     * no way to tell which they are looking at. This key fixes the frame: it
     * says which way is north, and the prose beside the chart says which way
     * the arrows fly. (This comment described the opposite convention for a
     * while after the arrows were flipped — the glyph was right and the note
     * beside it was not.)
     */
    var keyY = arrowsTop + BARB_H / 2;
    svg.appendChild(el('path', {
      d: 'M0 -6 L0 6 M0 6 L-2.4 2.6 M0 6 L2.4 2.6',
      stroke: css('--chart-axis'), 'stroke-width': 1.2, fill: 'none',
      'stroke-linecap': 'round',
      transform: 'translate(' + (M.l - 30) + ',' + keyY + ') rotate(180)' }));
    var kn = el('text', { x: M.l - 24, y: keyY + 3.5, 'text-anchor': 'start',
                          fill: css('--chart-axis'), 'font-size': 9 });
    kn.textContent = 'N';
    svg.appendChild(kn);

    // Built up panel by panel, so each series is registered next to the scale
    // it was drawn against rather than reconstructed afterwards from memory.
    var hov = [
      { name: 'Wind', colour: css('--chart-line'), values: wv, y: wy,
        text: function (i) {
          return num(wv[i]) ? wv[i].toFixed(1) + ' ' + WIND[u].label : null; } },
      { name: 'Gust', colour: css('--chart-extreme'), values: gv, y: wy,
        text: function (i) {
          return num(gv[i]) ? gv[i].toFixed(1) + ' ' + WIND[u].label : null; } },
      { name: 'From', colour: css('--chart-arrow'),
        text: function (i) {
          var d = (s.dir_mean || s.dir || [])[i];
          if (d === null || d === undefined) return null;
          return POINT16[Math.round((d % 360) / 22.5) % 16] +
                 ' (' + Math.round(d) + '\u00b0)'; } }
    ];

    // --- 2. temperature -----------------------------------------------------
    var tv = (s.temp || []).map(function (c) { return num(c) ? tempValue(c, prefs.temp) : null; });
    var real = tv.filter(num);
    if (real.length) {
      // The axis runs from the period's coldest hour to its warmest, so the
      // bottom and top labels ARE the min and max — no reading them off a line.
      // It replaces a padded range labelled "not zero-based", which spent a
      // caption explaining what the axis was not, instead of saying what it was.
      var tLo = Math.min.apply(null, real), tHi = Math.max.apply(null, real);
      // A flat period would divide by zero, and a line pinned to one edge reads
      // as a trend that isn't there; give it a degree either side and centre it.
      if (tHi - tLo < 0.5) { tLo -= 1; tHi += 1; }
      var ty = function (v) { return top2 + tempH - tempH * (v - tLo) / (tHi - tLo); };
      panelLabel(svg, top2, 'Temperature', opts.band ? 'domain mean' : null);
      axis(svg, top2, tempH, null, prefs.temp === 'c' ? '°C' : '°F', 2, ty, [tLo, tHi]);
      svg.appendChild(line(tv, x, ty, css('--chart-temp'), 2));
      hov.push({ name: 'Temp', colour: css('--chart-temp'), values: tv, y: ty,
                 text: function (i) {
                   return num(tv[i]) ? tv[i].toFixed(1) +
                     (prefs.temp === 'c' ? ' °C' : ' °F') : null; } });
    }

    // --- 3. rain and cloud --------------------------------------------------
    // Two quantities on one panel because they ARE related — cloud is where
    // rain comes from — and because the reader is looking at their SHAPES, not
    // comparing their values. Rain takes the left axis and the bars; cloud is a
    // faint dashed line on its own right-hand 0-100% scale, labelled as such.
    var isPct = !!s.precip_pct;
    // Rates arrive canonical in mm/h and are converted here, at the point of
    // display; the percentage series is a percentage in any system of units.
    var pv = isPct ? s.precip_pct : (s.precip_max || []).map(rainIn);
    var pvr = pv.filter(num);
    // The floor goes on the INPUT, not the output: niceMax answers 1 for a
    // zero argument, so flooring afterwards left a dry day on a 1.00 in/h axis
    // — a scale on which a real hour of rain would be an invisible sliver.
    var pMax = isPct ? 100
      : niceMax(Math.max(RAIN_MIN_IN,
                         (pvr.length ? Math.max.apply(null, pvr) : 0) * 1.2));
    var py = function (v) { return top3 + rainH - rainH * Math.min(v, pMax) / pMax; };
    // Which mark is which, said outright. "how overcast" described the cloud
    // line without ever saying it WAS a line, so on a panel holding bars and a
    // line the reader had to guess which one it was talking about.
    panelLabel(svg, top3, isPct ? 'Rain and cloud' : 'Rain rate and cloud',
               (isPct ? 'bars, chance of rain' : 'bars, rain rate') +
               '; dashed line, % cloud cover');
    axis(svg, top3, rainH, pMax, isPct ? '% rain' : 'in/h', 2, py, null,
         isPct ? undefined : 2);

    var bw = Math.max(1.5, (W - M.l - M.r) / n - 1);
    pv.forEach(function (v, i) {
      if (!num(v) || v <= 0) return;
      svg.appendChild(el('rect', { x: (x(i) - bw / 2).toFixed(1), y: py(v).toFixed(1),
                                   width: bw.toFixed(1),
                                   height: (top3 + rainH - py(v)).toFixed(1),
                                   fill: css('--chart-precip'), opacity: .75 }));
    });
    hov.push({ name: isPct ? 'Rain' : 'Rain rate', colour: css('--chart-precip'),
               values: pv, y: py,
               text: function (i) {
                 if (!num(pv[i])) return null;
                 return isPct ? Math.round(pv[i]) + '%' : rainText(pv[i]); } });

    var cv = s.cloud || s.sky_pct || [];
    if (cv.filter(num).length) {
      var cy = function (v) { return top3 + rainH - rainH * v / 100; };
      svg.appendChild(line(cv, x, cy, css('--chart-cloud'), 1.6, '4 2'));
      // Cloud is a percentage on its own right-hand scale, in the cloud line's
      // own colour so there is no doubt which axis belongs to which mark. The
      // previous version wrote two bare labels at W - M.r + 3, three pixels
      // inside a 14px margin, so most of "0% cloud" fell off the viewBox.
      rightAxis(svg, rainH, 100, '%', 2, cy, css('--chart-cloud'));
      hov.push({ name: 'Cloud', colour: css('--chart-cloud'), values: cv, y: cy,
                 text: function (i) {
                   return num(cv[i]) ? Math.round(cv[i]) + '%' : null; } });
    }

    // --- 4. pressure --------------------------------------------------------
    if (hasPress) {
      var pv2 = s.pressure;
      var pr = pv2.filter(num);
      var pLo = Math.min.apply(null, pr), pHi = Math.max.apply(null, pr);
      // Like temperature, the axis spans the period's own range: sea-level
      // pressure moves a few millibars against a value near 1013, so a
      // zero-based axis would draw every system as a flat line. And like
      // temperature, a dead-flat period would divide by zero.
      if (pHi - pLo < 1) { pLo -= 1; pHi += 1; }
      var py2 = function (v) { return top4 + pressH - pressH * (v - pLo) / (pHi - pLo); };
      /* The TREND is the reading, not the value. Three millibars in twelve
       * hours is a front; the same three millibars sitting still is a nice day.
       *
       * Measured as the largest EXCURSION, not as last-minus-first, which is
       * what this did and which is blind to the most interesting shape a
       * barogram has. A low that crosses mid-run — pressure down seven
       * millibars and back up — leaves the endpoints where it found them, and
       * the old arithmetic called that "steady over the run" while the line on
       * screen plainly was not. Even a run that does drift can be understated:
       * the one this was rewritten against nets 3.6 mb and contains a 9.1 mb
       * fall.
       *
       * So: the deepest fall from any earlier high, and the largest rise from
       * any earlier low. When both are real the run had two phases and gets
       * described as two, in the order they happen.
       */
      var pFall = 0, pRise = 0, hiSoFar = -Infinity, loSoFar = Infinity;
      var fallAt = 0, riseAt = 0;
      for (var pk = 0; pk < pr.length; pk++) {
        hiSoFar = Math.max(hiSoFar, pr[pk]);
        if (hiSoFar - pr[pk] > pFall) { pFall = hiSoFar - pr[pk]; fallAt = pk; }
        loSoFar = Math.min(loSoFar, pr[pk]);
        if (pr[pk] - loSoFar > pRise) { pRise = pr[pk] - loSoFar; riseAt = pk; }
      }
      var trend;
      if (pFall < 1 && pRise < 1) {
        trend = 'steady over the run';
      } else if (Math.min(pFall, pRise) < 1.5) {
        // One direction, with at most a wobble the other way.
        trend = (pFall >= pRise ? 'falling ' : 'rising ')
              + Math.max(pFall, pRise).toFixed(1) + ' mb over the run';
      } else {
        // Both phases are real, so both are named, in the order they happen.
        //
        // Ordered by where each phase ENDS, not by where the global extremes
        // sit. Comparing the extremes gets a V backwards whenever the recovery
        // finishes above the starting value: the highest point is then the last
        // sample, which reads as "rose first" for a run that plainly fell first.
        trend = (fallAt < riseAt)
          ? 'down ' + pFall.toFixed(1) + ' mb, then back up ' + pRise.toFixed(1)
          : 'up ' + pRise.toFixed(1) + ' mb, then down ' + pFall.toFixed(1);
      }
      panelLabel(svg, top4, 'Pressure', trend);
      axis(svg, top4, pressH, null, 'mb', 2, py2, [pLo, pHi], 1);
      svg.appendChild(line(pv2, x, py2, css('--chart-pressure'), 2));
      hov.push({ name: 'Pressure', colour: css('--chart-pressure'), values: pv2, y: py2,
                 text: function (i) {
                   return num(pv2[i]) ? pv2[i].toFixed(1) + ' mb' : null; } });
    }

    timeAxis(svg, s.times, x, n, (hasPress ? top4 + pressH : top3 + rainH) + 16);
    svg.appendChild(describe(summarise(s, wv, gv, real, pv, isPct, u)));
    wireHover(node, svg, { n: n, x: x, series: hov, top: top1 - 4,
                           bottom: hasPress ? top4 + pressH : top3 + rainH,
                           times: s.times,
                           stamp: function (i) { return stampOf(s.times[i]); } });

    legend(node, opts.band
      ? [['line', 'domain mean wind'], ['band', '10th-90th percentile across the domain'],
         ['dash', 'peak gust anywhere; fine dashes are the average gust'],
         ['arrow', 'arrows fly WITH the wind, north up \u2014 a southerly points up the page; the tables name where it comes FROM'],
         ['temp', 'temperature line spans the period\u2019s own min and max'],
         ['bar', 'bars are rain rate'], ['cloud', 'dashed line is % cloud cover (right axis)'],
         ['rule', 'dashed rule is midnight; fine dotted rules are sunrise and sunset'],
         ['now', 'the shaded hour is the one you are reading in'],
         ['hover', 'point at the chart for exact values at one time']]
      : [['line', 'wind'], ['dash', 'gusts'], ['arrow', 'arrows fly WITH the wind, north up \u2014 a southerly points up the page; the tables name where it comes FROM'],
         ['temp', 'temperature line spans the period\u2019s own min and max'],
         ['bar', 'bars are chance of rain'],
         ['cloud', 'dashed line is % cloud cover (right axis)'],
         ['pressure', 'sea-level pressure — the TREND is the reading, not the value'],
         ['rule', 'dashed rule is midnight; fine dotted rules are sunrise and sunset'],
         ['now', 'the shaded hour is the one you are reading in'],
         ['hover', 'point at the chart for exact values at one time']]);
  }

  function summarise(s, wv, gv, temps, pv, isPct, u) {
    var w = wv.filter(num), g = gv.filter(num), p = pv.filter(num);
    var bits = [];
    if (w.length) bits.push('Wind ' + Math.min.apply(null, w).toFixed(0) + ' to ' +
      Math.max.apply(null, w).toFixed(0) + ' ' + WIND[u].label);
    if (g.length) bits.push('gusting to ' + Math.max.apply(null, g).toFixed(0));
    if (temps.length) bits.push('temperature ' + Math.min.apply(null, temps).toFixed(0) +
      ' to ' + Math.max.apply(null, temps).toFixed(0));
    if (p.length) bits.push(isPct
      ? 'highest chance of rain ' + Math.max.apply(null, p) + ' per cent'
      : 'rain rate peaking at ' + Math.max.apply(null, p).toFixed(2) + ' inches an hour');
    return bits.join(', ') + '.';
  }

  function drawPrecip(node, s) {
    if (!s || !s.times || !s.times.length) return empty(node, 'No precipitation data.');
    var plotH = 120, viewH = M.t + plotH + 22;
    var svg = host(node, viewH);
    var mx = s.max.map(rainIn), mn = s.mean.map(rainIn);
    var yMax = niceMax(Math.max(RAIN_MIN_IN, Math.max.apply(null, mx) * 1.15));
    var sc = frame(svg, s.times, yMax, plotH, 'in/h', 4, 2);
    svg.appendChild(el('path', { d: path(mx.map(function (v, i) { return [sc.x(i), sc.y(v)]; })),
                                 fill: 'none', stroke: css('--chart-extreme'),
                                 'stroke-width': 1.6, 'stroke-dasharray': '5 3' }));
    svg.appendChild(el('path', { d: path(mn.map(function (v, i) { return [sc.x(i), sc.y(v)]; })),
                                 fill: 'none', stroke: css('--chart-line'), 'stroke-width': 2 }));
    svg.appendChild(describe('Precipitation rate. Corridor mean peaking at ' +
      Math.max.apply(null, mn).toFixed(2) + ' inches per hour, with a maximum anywhere in the corridor of ' +
      Math.max.apply(null, mx).toFixed(2) + '.'));
    hoverFrame(node, svg, sc, s.times, plotH, [
      { name: 'Mean', colour: css('--chart-line'), values: mn, y: sc.y,
        text: function (i) { return rainText(mn[i]); } },
      { name: 'Max', colour: css('--chart-extreme'), values: mx, y: sc.y,
        text: function (i) { return rainText(mx[i]); } }]);
    legend(node, [['line', 'solid line is the corridor mean'],
                  ['dash', 'dashed line is the maximum anywhere in the corridor'],
                  ['now', 'the shaded hour is the one you are reading in'],
                  ['hover', 'point at the chart for exact values at one time']]);
  }

  /* Visibility, in STATUTE miles and capped at 10+.
   *
   * Two things the first version got wrong. It plotted kilometres, which is not
   * what anyone here judges distance in; and it plotted the raw model value,
   * which runs to 25 miles on a clear day — so a clear afternoon drew a line
   * near the top of a 30-unit axis and every genuinely interesting value, the
   * ones under a mile, was squashed into the bottom eighth of the panel.
   *
   * Surface observations are reported capped at "10 or more" for exactly this
   * reason: past ten miles the number carries no operational meaning. Capping
   * the axis there puts the whole panel where the decisions are.
   */
  var VIS_CAP_MI = 10;
  var M_PER_MILE = 1609.344;

  /* Rain rate in inches per hour, not millimetres.
   *
   * Everything else this page shows a reader is in the units they think in —
   * miles per hour, Fahrenheit, statute miles — and a rain rate in millimetres
   * was the last metric holdout. The models publish kg/m2/s, which is
   * millimetres per hour by another name, so the conversion happens here at the
   * point of display rather than in the harvester, where the canonical value
   * belongs.
   *
   * The cost is precision at the bottom of the range: a drizzle of 0.1 mm/h is
   * 0.004 in/h and rounds to 0.00 at the two decimal places the axis can carry.
   * That is reported as "trace" rather than as zero, because zero and
   * not-quite-measurable are different answers to "will I get wet".
   */
  var MM_PER_INCH = 25.4;
  var RAIN_MIN_IN = 0.02;          // floor for the axis: 0.5 mm/h, a light hour

  function rainIn(mm) { return num(mm) ? mm / MM_PER_INCH : null; }
  function rainText(inph) {
    if (!num(inph)) return null;
    if (inph > 0 && inph < 0.005) return 'trace';
    return inph.toFixed(2) + ' in/h';
  }

  function drawVis(node, s) {
    if (!s || !s.times || !s.times.length) return empty(node, 'No visibility data.');
    var mi = s.min.map(function (m) { return num(m) ? m / M_PER_MILE : null; });
    var real = mi.filter(num);
    if (!real.length) return empty(node, 'No visibility data.');

    var plotH = 120, viewH = M.t + plotH + 22;
    var svg = host(node, viewH);
    var sc = frame(svg, s.times, VIS_CAP_MI, plotH, 'miles', 5);

    // Everything at or above the cap is drawn ON the cap line, and the panel
    // says so — pretending to distinguish 17 miles from 25 would be precision
    // the reader cannot use and the model does not really have.
    var capped = mi.map(function (v) { return num(v) ? Math.min(v, VIS_CAP_MI) : null; });
    svg.appendChild(line(capped, sc.x, sc.y, css('--chart-extreme'), 2));

    // Reference lines at the distances that actually change a decision.
    [{ mi: 1, label: 'fog' }, { mi: 3, label: 'poor' }].forEach(function (ref) {
      svg.appendChild(el('line', { x1: M.l, x2: W - M.r, y1: sc.y(ref.mi), y2: sc.y(ref.mi),
                                   stroke: css('--chart-extreme'), 'stroke-width': 1,
                                   'stroke-dasharray': '2 4', opacity: .5 }));
      var lab = el('text', { x: W - M.r - 3, y: sc.y(ref.mi) - 3, 'text-anchor': 'end',
                             fill: css('--chart-axis'), 'font-size': 9, opacity: .85 });
      lab.textContent = ref.label + ' below ' + ref.mi + ' mi';
      svg.appendChild(lab);
    });

    var worst = Math.min.apply(null, real);
    svg.appendChild(describe('Visibility, minimum anywhere in the corridor. Lowest ' +
      (worst >= VIS_CAP_MI ? 'ten miles or more' : worst.toFixed(1) + ' miles') + '.'));
    hoverFrame(node, svg, sc, s.times, plotH, [
      { name: 'Visibility', colour: css('--chart-extreme'), values: capped, y: sc.y,
        text: function (i) {
          if (!num(mi[i])) return null;
          // Reported against the cap, exactly as the line is drawn: claiming
          // 24.9 miles from a chart whose axis stops at 10 would be a number
          // the panel is not showing.
          return mi[i] >= VIS_CAP_MI ? '10+ miles' : mi[i].toFixed(1) + ' miles'; } }]);
    legend(node, [['extreme', 'the line is the minimum anywhere in the corridor'],
                  ['cap', 'flat at the top means 10 miles or more — clear'],
                  ['now', 'the shaded hour is the one you are reading in'],
                  ['hover', 'point at the chart for exact values at one time']]);
  }

  /* Near-surface smoke. Drawn against the EPA's PM2.5 breakpoints rather than
   * auto-scaled, because the number only means anything relative to them: on a
   * clear day the values are effectively zero and an auto-scaled axis would
   * magnify rounding noise into an alarming-looking curve.
   */
  var SMOKE_BANDS = [
    { to: 12,   label: 'good' },
    { to: 35.4, label: 'moderate' },
    { to: 55.4, label: 'unhealthy for sensitive groups' },
    { to: 150,  label: 'unhealthy' }
  ];

  /* Surface smoke, with the column drawn against it.
   *
   * The column is NOT given its own axis in mg/m2. A second scale is a thing
   * the reader has to learn before the chart says anything, and the question
   * being asked has a natural common unit: what would be at the surface if
   * that column mixed down. So the column is plotted as its implied surface
   * concentration, in the same ug/m3 as the line beside it, against the same
   * EPA rules. The gap between the two lines is then the whole signal — they
   * meet when the air is well mixed, and the faint one rides far above when a
   * plume is sitting on top of a shallow layer. The raw mg/m2 is still in the
   * hover, because that is the number the model actually published.
   */
  function drawSmoke(node, s) {
    if (!s || !s.times || !s.times.length) return empty(node, 'No smoke data.');
    var vals = s.max.map(function (v) { return v === null ? null : v; });
    var real = vals.filter(num);
    if (!real.length) return empty(node, 'No smoke data.');
    var peak = Math.max.apply(null, real);

    var cols = s.col_max || [], pbls = s.pbl || [];
    var implied = s.times.map(function (t, i) {
      if (!num(cols[i])) return null;
      var h = Math.max(pbls[i] || SMOKE_NOMINAL_MIX_M, SMOKE_MIN_MIX_M);
      return Math.round(cols[i] * 1000 / h * 100) / 100;
    });
    var impReal = implied.filter(num);
    var impPeak = impReal.length ? Math.max.apply(null, impReal) : 0;

    var plotH = 110, viewH = M.t + plotH + 22;
    var svg = host(node, viewH);
    // Always show at least the "good" band, so a clean day reads as a flat line
    // near the floor of a meaningful scale rather than as a magnified wiggle.
    // The implied line is inside the scale too: it is the one that matters on
    // exactly the days it would otherwise run off the top.
    var yMax = niceMax(Math.max(peak * 1.2, impPeak * 1.2, 15));
    var sc = frame(svg, s.times, yMax, plotH, 'ug/m3', 3);

    SMOKE_BANDS.forEach(function (b) {
      if (b.to > yMax) return;
      svg.appendChild(el('line', { x1: M.l, x2: W - M.r, y1: sc.y(b.to), y2: sc.y(b.to),
                                   stroke: css('--chart-extreme'), 'stroke-width': 1,
                                   'stroke-dasharray': '2 4', opacity: .5 }));
      var lab = el('text', { x: W - M.r - 3, y: sc.y(b.to) - 3, 'text-anchor': 'end',
                             fill: css('--chart-axis'), 'font-size': 9, opacity: .8 });
      lab.textContent = b.label;
      svg.appendChild(lab);
    });

    // Drawn UNDER the surface line and dashed, because it is the conditional
    // one: what would be here, not what is.
    if (impReal.length) {
      svg.appendChild(el('path', {
        d: path(implied.map(function (v, i) { return [sc.x(i), sc.y(num(v) ? v : 0)]; })),
        fill: 'none', stroke: css('--chart-line'), 'stroke-width': 1.5,
        'stroke-dasharray': '4 3', opacity: .55 }));
    }

    svg.appendChild(el('path', {
      d: path(vals.map(function (v, i) { return [sc.x(i), sc.y(num(v) ? v : 0)]; })),
      fill: 'none', stroke: css('--chart-line'), 'stroke-width': 2 }));

    svg.appendChild(describe('Near-surface smoke, peaking at ' + peak.toFixed(1) +
      ' micrograms per cubic metre' +
      (peak < 12 ? ', which is within the good air-quality band.' : '.') +
      (impPeak > peak * 1.5
        ? ' The column overhead holds more, peaking at an implied ' +
          impPeak.toFixed(1) + ' if it mixed down to the surface.' : '')));

    var series = [
      { name: 'PM2.5', colour: css('--chart-line'), values: vals, y: sc.y,
        text: function (i) {
          if (!num(vals[i])) return null;
          // The band as well as the number: 8 micrograms means nothing to most
          // readers, "good" does, and the chart's own rules are labelled that way.
          var band = '';
          for (var b = 0; b < SMOKE_BANDS.length; b++) {
            if (vals[i] <= SMOKE_BANDS[b].to) { band = ' \u00b7 ' + SMOKE_BANDS[b].label; break; }
          }
          return vals[i].toFixed(1) + ' \u00b5g/m\u00b3' + band; } }];
    if (impReal.length) {
      series.push({ name: 'if mixed down', colour: css('--chart-line'),
        values: implied, y: sc.y, dashed: true,
        text: function (i) {
          if (!num(implied[i])) return null;
          // Both numbers: the model published a column loading, and this line
          // is a derived quantity. Showing only the derived one would hide
          // which of the two came out of HRRR.
          // The depth ACTUALLY used, not the model's raw one. At 9 pm HRRR
          // gives 133 m, the floor makes it 500, and printing the 133 invited
          // a reader to redo the arithmetic and find it did not reconcile.
          var used = Math.max(pbls[i] || SMOKE_NOMINAL_MIX_M, SMOKE_MIN_MIX_M);
          return implied[i].toFixed(1) + ' \u00b5g/m\u00b3 \u00b7 ' +
                 cols[i].toFixed(2) + ' mg/m\u00b2 aloft \u00b7 ' +
                 Math.round(used) + ' m layer' +
                 (num(pbls[i]) && pbls[i] < SMOKE_MIN_MIX_M
                   ? ' (floored, model says ' + Math.round(pbls[i]) + ')' : ''); } });
    }
    hoverFrame(node, svg, sc, s.times, plotH, series);
    legend(node, [['line', 'the solid line is surface smoke, the maximum anywhere in the corridor'],
                  ['band', 'the dashed line is the whole column overhead, drawn as what it ' +
                           'would be at the surface if it mixed down'],
                  ['band', 'dotted rules are EPA PM2.5 category thresholds'],
                  ['now', 'the shaded hour is the one you are reading in'],
                  ['hover', 'point at the chart for exact values at one time']]);
  }

  function describe(text) {
    var t = el('title', {});
    t.textContent = text;
    return t;
  }

  // Sixteen points, matching src/process/compass.py so the alt text and the
  // tables cannot describe the same bearing differently. Spelled out rather
  // than abbreviated: "north-north-west" reads in a sentence, "NNW" does not.
  var SPOKEN = ['north', 'north-north-east', 'north-east', 'east-north-east',
                'east', 'east-south-east', 'south-east', 'south-south-east',
                'south', 'south-south-west', 'south-west', 'west-south-west',
                'west', 'west-north-west', 'north-west', 'north-north-west'];
  function compass(deg) {
    return 'from the ' + SPOKEN[Math.round((deg % 360) / 22.5) % 16];
  }
  function confidence(r) {
    return r >= SOLID_R ? 'consistent across the domain'
         : r >= LOW_R ? 'only loosely consistent across the domain'
         : 'with no consistent direction across the domain';
  }

  function legend(node, items) {
    var d = document.createElement('div');
    d.className = 'muted';
    d.style.fontSize = '.78rem';
    d.style.marginTop = '4px';
    d.textContent = items.map(function (i) { return i[1]; }).join(' · ');
    node.appendChild(d);
  }

  function drawAll() {
    document.querySelectorAll('.chart-host').forEach(function (node) {
      // Skip anything inside a hidden tab panel: it has no width yet, so it
      // would be measured and laid out wrong. It gets drawn when revealed.
      if (node.offsetParent === null) return;
      var kind = node.getAttribute('data-chart');
      var lead = node.getAttribute('data-lead');
      var dom = node.getAttribute('data-domain');
      if (kind === 'forecast') {
        drawPanels(node, FORECAST && FORECAST[dom], { band: false });
      } else if (kind === 'wind') {
        drawPanels(node, DATA && DATA.wind && DATA.wind[dom] && DATA.wind[dom][lead],
                   { band: true });
      } else if (kind === 'precip') {
        drawPrecip(node, DATA && DATA.precip && DATA.precip[lead]);
      } else if (kind === 'vis') {
        drawVis(node, DATA && DATA.visibility && DATA.visibility[lead]);
      } else if (kind === 'smoke') {
        drawSmoke(node, DATA && DATA.smoke && DATA.smoke[lead]);
      } else if (kind === 'ltgtimeline') {
        drawLtgTimeline(node);
      } else if (kind === 'instability') {
        drawInstability(node);
      } else if (kind === 'czprofile') {
        drawCzProfile(node);
      }
    });
  }


  /* Three lightning sources, one hour axis.
   *
   * The page has three independent ways to notice lightning and they do not
   * cover the same hours: the gridpoint forecast runs 48 hours, HRRR's
   * lightning field 18 from its own init, and the forecasters' discussion is
   * prose with no hours at all. Every surface used to consult a different
   * subset, and a window past HRRR's reach was reported as unanswerable by the
   * one row built to answer it.
   *
   * So the sources are drawn as SEPARATE ROWS rather than merged into one risk
   * line. Merging would put the interesting cases — one source flagging while
   * another is silent, or absent — behind a single colour, and "silent" and
   * "absent" are the two this page most needs to keep apart.
   */
  /* "Wed 2 Sep" for an axis label. Same shape stampOf uses, without the
   * clock — the hour is already on the tick below it. */
  function dayLabelOf(iso) {
    var t = String(iso);
    var y = +t.slice(0, 4), mo = +t.slice(5, 7), da = +t.slice(8, 10);
    var dow = DOW[new Date(Date.UTC(y, mo - 1, da)).getUTCDay()];
    return dow + ' ' + da + ' ' + MON[mo - 1];
  }

  /* The model's lightning band, narrowed to the hours still AHEAD.
   *
   * lightning.json's `peak` is the maximum over the whole run and the tile is
   * rendered from it at build time. This page rebuilds at 04:00, 13:00 and
   * 20:00, so a build sits for up to nine hours — long enough for the tile to
   * still be reporting "the model shows some lightning potential nearby" on
   * the strength of an hour that ended before breakfast.
   *
   * Everything else here already recomputes against the reader's clock: the
   * next-12-hours outlook, the ages, the shaded now band. This was the one
   * frozen number, and it is the one where "the model showed something" and
   * "the model shows something ahead of you" are different claims.
   *
   * An hour counts as ahead until it ENDS. The hour you are in is still the
   * hour you are in.
   */
  function refreshLightningModel() {
    var tl = PLAN && PLAN.ltg_timeline;
    if (!tl || !tl.available) return;
    var row = (tl.rows || []).filter(function (r) { return r.key === 'model'; })[0];
    if (!row) return;

    var RANK = { no_reach: -1, none: 0, trace: 1, possible: 2, likely: 3, strong: 4 };
    var WORD = tl.labels || {};
    var now = Date.now(), HOUR = 3600000;
    var run = 'none', ahead = 'none', aheadFrom = null, peakAt = null;

    tl.hours.forEach(function (h, i) {
      var st = row.states[i];
      if (st === 'no_reach' || st === undefined) return;
      if (RANK[st] > RANK[run]) { run = st; peakAt = h; }
      if (Date.parse(h) + HOUR > now) {
        if (RANK[st] > RANK[ahead]) { ahead = st; }
        if (st !== 'none' && aheadFrom === null) aheadFrom = h;
      }
    });

    // The run carried nothing at all, so there is nothing to re-narrow and no
    // model line for the server to have rendered. Saying "model: none" here
    // would ADD a source the tile deliberately leaves out when it is silent.
    if (run === 'none') return;

    var passed = RANK[run] > RANK[ahead];
    var text;
    if (ahead === 'none') {
      // The BAND NAME here, not tl.labels — those are whole sentences ("the
      // model shows some lightning potential nearby"), which read as gibberish
      // dropped into the middle of another one.
      text = passed
        ? 'nothing left in the model — its ' + run + ' hour was ' + stampOf(peakAt)
        : 'nothing in the model ahead';
    } else {
      text = (WORD[ahead] || ahead) +
             (aheadFrom ? ' — from ' + stampOf(aheadFrom) : '') +
             (passed ? '; the run\u2019s peak has passed' : '');
    }

    var full = document.querySelector('[data-ltg-model] a');
    if (full) full.textContent = text;
    var comp = document.querySelector('[data-ltg-model-c] a');
    if (comp) {
      // The compact line keeps every source named; only the model half moves.
      var parts = comp.textContent.split('\u00b7').map(function (x) { return x.trim(); });
      var rest = parts.filter(function (x) { return x.indexOf('model') !== 0; });
      var head = ahead === 'none'
        ? (passed ? 'model: peak passed' : 'model: none')
        : 'model: ' + ahead;
      comp.textContent = [head].concat(rest).join(' \u00b7 ');
    }

    /* If the MODEL is what set this tile's level, relaxing the model relaxes
     * the tile. Only then — a gridpoint thunderstorm is not made safe by
     * HRRR's hour having passed. */
    var tile = document.querySelector('.tile[data-ltg-source="model"]');
    if (tile && passed) {
      // The headline was "lightning potential possible", built from the run's
      // peak. With that hour gone it is a claim about the past in the largest
      // type on the tile, so it moves with the level.
      var val = tile.querySelector('.tile-value');
      if (val) {
        val.textContent = ahead === 'none'
          ? 'no lightning ahead in the model'
          : 'lightning potential ' + ahead;
      }
      // "model shows potential from 2:00 pm" — the hour it STARTED, which is
      // now history. The line under it already says what is left.
      var when = tile.querySelector('[data-ltg-when]');
      if (when) when.hidden = (ahead === 'none');
      if (ahead === 'none') {
        tile.classList.remove('st-watch', 'st-alert');
        tile.classList.add('st-note');
      }
    }
  }

  /* CAPE and CIN on one axis, as two rows.
   *
   * Not one line each on a shared scale: they are different quantities with
   * opposite meanings, and the only comparison worth making between them is
   * "is there energy AND is the cap off", which two aligned rows answer at a
   * glance and two overlaid curves do not.
   */
  /* Stull's most favourable cap band (Practical Meteorology, Table 14-4),
   * mirroring CIN_BANDS in src/process/instability.py — a cap in this range
   * holds long enough for real energy to build and still breaks when
   * something lifts the air. Below it energy releases as it arrives; above
   * it, nothing gets through. A test asserts these against the Python. */
  /* A magnitude ramp, drawn the way the cells are drawn.
   *
   * These charts carry magnitude as OPACITY over the page's own accent, and
   * that means the direction of LIGHTNESS flips between themes: over a light
   * page a strong cell is darker than a weak one, over a dark page it is
   * brighter. Both are correct — each theme picks an accent that stands out
   * against its own background — but it made every caption saying "darker is
   * more" false in one of the two themes, which is how they were written.
   *
   * The invariant across themes is PROMINENCE, not lightness: a strong cell
   * is the high-contrast one either way. So the key shows the ramp instead of
   * naming a direction. Built from the same discrete opacities the cells use
   * and composited against the page behind it, so it is automatically right in
   * whichever theme the reader is in — a picture cannot be wrong about this
   * the way a word can.
   */
  var RAMP_STEPS = [0.16, 0.37, 0.58, 0.79, 1];

  function rampSwatch(colourVar, reverse) {
    var wrap = document.createElement('span');
    wrap.className = 'ltg-key-ramp';
    var steps = reverse ? RAMP_STEPS.slice().reverse() : RAMP_STEPS;
    steps.forEach(function (op) {
      var i = document.createElement('i');
      i.style.background = css(colourVar);
      i.style.opacity = op;
      wrap.appendChild(i);
    });
    return wrap;
  }

  var CIN_BEST_LO = 20, CIN_BEST_HI = 60;

  function drawInstability(node) {
    var d = CONV && CONV.hours;
    node.textContent = '';
    if (!CONV || !CONV.available || !d || !d.length) return empty(node, 'No run to show.');

    var n = d.length, GUT = 74, RH = 26, GAP = 8, TOP = 30, BOT = 26;
    var W = 760, H = TOP + 2 * (RH + GAP) + BOT;
    var cw = (W - GUT - 8) / n;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%',
                          role: 'img', 'aria-label': 'CAPE and CIN by hour' });

    var capes = d.map(function (h) { return h.cape; }).filter(num);
    var caps = d.map(function (h) { return Math.abs(h.cin || 0); }).filter(num);
    // Each row states its own range rather than being scaled to a threshold —
    // the same convention §8's spread strips use.
    var capeTop = Math.max(300, capes.length ? Math.max.apply(null, capes) : 0);
    var cinTop = Math.max(25, caps.length ? Math.max.apply(null, caps) : 0);

    dayRow(svg, d, GUT, cw, TOP, H, BOT);

    [['CAPE', 'cape', capeTop, '--cape-ink', false],
     ['Cap (CIN)', 'cin', cinTop, '--cin-ink', true]].forEach(function (row, r) {
      var y = TOP + r * (RH + GAP);
      var lab = el('text', { x: 0, y: y + RH / 2 + 4, fill: css('--ink-2'),
                             'font-size': 10, 'font-weight': 600 });
      lab.textContent = row[0];
      svg.appendChild(lab);
      var sub = el('text', { x: 0, y: y + RH / 2 + 15, fill: css('--chart-axis'),
                             'font-size': 8.5 });
      sub.textContent = '0\u2013' + Math.round(row[2]) + (r ? ' J/kg cap' : ' J/kg');
      svg.appendChild(sub);

      d.forEach(function (h, i) {
        var raw = h[row[1]];
        var x = GUT + i * cw;
        var tip = el('title');
        tip.textContent = stampOf(h.iso) + ' \u2014 ' + (h.text || '');
        if (!num(raw)) {
          var gap = el('rect', { x: x, y: y, width: Math.max(1, cw), height: RH,
                                 fill: 'transparent' });
          gap.appendChild(tip); svg.appendChild(gap); return;
        }
        var mag = row[4] ? Math.abs(raw) : raw;
        var op = mag <= 0 ? 0.07 : Math.max(0.16, Math.min(1, mag / row[2]));
        var cell = el('rect', {
          x: x + 0.5, y: y, width: Math.max(1, cw - 1), height: RH, rx: 1,
          fill: css(row[3]),
          // Opacity carries the magnitude, floored so a real-but-small value
          // is still visibly not nothing — the trace-band lesson.
          opacity: op });
        cell.appendChild(tip);
        svg.appendChild(cell);

        // The favourable cap band, outlined. Opacity is a MONOTONIC encoding
        // and the cap is not a monotonic quantity: Stull's 20-60 J/kg is the
        // most favourable band, not the palest and not the darkest, so no
        // amount of shading can say where it is. See src/process/instability.py.
        if (row[4] && mag >= CIN_BEST_LO && mag < CIN_BEST_HI) {
          var mark = el('rect', {
            x: x + 0.5, y: y + 0.5, width: Math.max(1, cw - 1), height: RH - 1,
            rx: 1, fill: 'none', stroke: css('--chart-extreme'),
            'stroke-width': 1.5, 'stroke-dasharray': '3 2' });
          mark.appendChild(tip.cloneNode(true));
          svg.appendChild(mark);
        }

        /* The number, in the cell.
         *
         * These cells carried their values in an SVG <title>, which is a
         * hover tooltip — and there is no hover on a phone, so on the device
         * most of this page is read on the figure had no numbers in it at
         * all. Opacity alone cannot be read back to a value anyway: it says
         * "more" and "less" against a range stated in the gutter, which is
         * enough to find the shape of a day and not enough to know whether a
         * cell is 300 or 900.
         *
         * Ink flips on the dark cells rather than being one colour with a
         * halo: the fill IS the page's own accent at full strength there, and
         * dark text on it fails at exactly the hours worth reading.
         */
        var val = el('text', {
          x: x + cw / 2, y: y + RH / 2 + 3.4, 'text-anchor': 'middle',
          'font-size': 10, 'font-weight': 600,
          fill: css(op >= 0.55 ? '--bg' : '--ink-2'),
          'pointer-events': 'none' });
        val.textContent = Math.round(mag);
        svg.appendChild(val);
      });
    });

    nowBand(svg, d.map(function (h) { return h.iso; }),
            function (i) { return GUT + i * cw + cw / 2; }, TOP - 4, H - BOT + 2);
    node.appendChild(svg);

    /* The numbers are in the cells now, but the READING was not.
     *
     * Each cell's <title> carries instability.summarise() — "490 J/kg,
     * marginal instability, under a moderate cap of 41 J/kg: the most
     * favourable cap, it lets energy build and still breaks" — which is the
     * interpretation this whole section exists to give, and it was reachable
     * only by hovering. Printing the values fixed knowing WHAT the numbers
     * are; this is what they mean.
     */
    wireHover(node, svg, {
      n: n, x: function (i) { return GUT + i * cw + cw / 2; },
      left: GUT, right: 8, top: TOP, bottom: TOP + 2 * RH + GAP,
      series: [{ name: 'Reading', colour: css('--cape-ink'),
                 text: function (i) { return d[i].text || null; } }],
      prose: true,
      times: d.map(function (h) { return h.iso; }),
      stamp: function (i) { return stampOf(d[i].iso); } });

    /* A visual key, not only a sentence.
     *
     * The favourable-cap outline is the reason this is needed rather than
     * nice: on a run where no hour lands in that band — most of them — there
     * is nothing outlined anywhere in the figure, and a caption pointing at
     * "the outlined band" then names something the reader cannot find. The key
     * shows the mark whether or not the data happens to use it today.
     */
    var vkey = document.createElement('div');
    vkey.className = 'ltg-key';
    var vg = document.createElement('div');
    vg.className = 'ltg-key-group';
    var vb = document.createElement('b');
    vb.textContent = 'Rows';
    vg.appendChild(vb);
    var vbox = document.createElement('div');
    vbox.className = 'ltg-key-items';
    [['--cape-ink', 'CAPE \u2014 the energy available, none to most'],
     ['--cin-ink', 'cap (CIN) \u2014 the lid over it, none to most']
    ].forEach(function (k) {
      var sp = document.createElement('span');
      sp.appendChild(rampSwatch(k[0], false));
      sp.appendChild(document.createTextNode(k[1]));
      vbox.appendChild(sp);
    });
    var best = document.createElement('span');
    best.innerHTML = '<i class="inst-key-best"></i>cap of ' + CIN_BEST_LO + '\u2013' +
      CIN_BEST_HI + ' J/kg \u2014 the favourable band';
    vbox.appendChild(best);
    vg.appendChild(vbox);
    vkey.appendChild(vg);
    node.appendChild(vkey);

    var key = document.createElement('p');
    key.className = 'ltg-hint';
    // The old sentence here read "a dark CAPE cell under a pale one is the
    // combination worth noticing", which is a MONOTONIC reading of the cap —
    // less cap, more danger — and the cap does not work that way. An open cap
    // is not the dangerous case: energy releases as fast as it arrives, in
    // scattered weak convection, and never accumulates. That contradicted this
    // page's own CIN bands, and the tooltip beside it, which call 20-60 J/kg
    // the most favourable cap there is.
    // Written in quantities rather than in how the cells look. The previous
    // version said "darker is more", which is true over a light page and false
    // over a dark one; the key now shows the ramp, so the caption does not have
    // to name a direction at all and can talk about the weather instead.
    key.textContent = 'Both rows are in J/kg, and stronger colour is more. CAPE is the ' +
      'energy; the cap is what has to break for anything to reach it — and more cap is ' +
      'not simply worse. High CAPE under a heavy cap is energy that cannot be reached, ' +
      'but under no cap at all it leaks away as fast as it builds. The combination worth ' +
      'noticing is high CAPE over a cap in the outlined band, ' + CIN_BEST_LO + '\u2013' +
      CIN_BEST_HI + ' J/kg: enough to let energy accumulate, little enough to break. ' +
      ((window.matchMedia && matchMedia('(hover:none) and (pointer:coarse)').matches)
        ? 'Drag the slider for what any hour adds up to.'
        : 'Point at any hour for what it adds up to.');
    node.appendChild(key);
  }

  /* Readings off one hour of the convergence profile.
   *
   * These exist so the chart can be read without a pointer. A latitude is not
   * a place to anyone deciding whether to drive north, so every one of them is
   * named by the nearest landmark the section already labels the axis with —
   * the same names, from the same list, rather than a second set that could
   * drift from the marks drawn on the field.
   */
  // Bare numbers on the scale the hint states once, under the chart. Repeating
  // "x10^-5 s^-1" on all three rows pushed the longest of them past the width
  // of a phone, and the unit is the same on every one of them.
  function czSay(v) {
    return (Math.abs(v) * 1e5).toFixed(1) + ' ' + (v >= 0 ? 'rising' : 'sinking');
  }

  function czPlace(la) {
    var best = null;
    (CONV.landmarks || []).forEach(function (m) {
      var dd = Math.abs(m[0] - la);
      if (!best || dd < best[0]) best = [dd, m[1]];
    });
    return best ? best[1] : la.toFixed(1) + '\u00b0N';
  }

  /* The band this water sits in — by name, not by a hard-coded latitude, so
   * moving the landmark moves the row this reports. */
  function czHomeRow(lats) {
    var home = null;
    (CONV.landmarks || []).forEach(function (m) {
      if (/lake union/i.test(m[1])) home = m[0];
    });
    if (home === null) return -1;
    var best = -1, bd = 1e9;
    lats.forEach(function (la, r) {
      var dd = Math.abs(la - home);
      if (dd < bd) { bd = dd; best = r; }
    });
    return best;
  }

  function czCell(h, r) {
    var v = h && (h.profile || [])[r];
    return num(v) ? czSay(v) : null;
  }

  /* The strongest cell of one sign in an hour, with where it is. `sign` is +1
   * for convergence and -1 for subsidence; null when the whole column is the
   * other way, which is itself the answer and not a gap. */
  function czExtreme(h, lats, sign) {
    var prof = (h && h.profile) || [], best = null;
    prof.forEach(function (v, r) {
      if (!num(v) || v * sign <= 0) return;
      if (!best || Math.abs(v) > Math.abs(best[0])) best = [v, lats[r]];
    });
    if (!best) return sign > 0 ? 'none anywhere' : 'none anywhere';
    return czSay(best[0]) + ' \u00b7 ' + czPlace(best[1]);
  }

  /* The convergence profile: latitude up, time across.
   *
   * A zone is a BAND, so the chart has to have a spatial axis or it cannot
   * show one. Blue is convergence, warm is subsidence, and the thing to look
   * for is a run of blue with warm above and below it.
   */
  function drawCzProfile(node) {
    var d = CONV && CONV.hours;
    node.textContent = '';
    if (!CONV || !CONV.available || !d || !d.length) return empty(node, 'No run to show.');
    var lats = (d[0] && d[0].lats) || [];
    if (!lats.length) return empty(node, 'No profile in this run.');

    var n = d.length, rows = lats.length;
    var GUT = 138, RH = 15, TOP = 30, BOT = 26;   // place name, then degree
    var W = 760, H = TOP + rows * RH + BOT;
    var cw = (W - GUT - 8) / n;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%',
                          role: 'img', 'aria-label': 'Convergence by latitude and hour' });

    // Symmetric about zero, so convergence and subsidence of equal size read
    // as equally strong. Scaled to the run's own extreme and stated below.
    var all = [];
    d.forEach(function (h) { (h.profile || []).forEach(function (v) {
      if (num(v)) all.push(Math.abs(v)); }); });
    var top = all.length ? Math.max.apply(null, all) : 1e-5;

    dayRow(svg, d, GUT, cw, TOP, H, BOT);

    var lo = lats[0] - 0.05, hi = lats[lats.length - 1] + 0.05;
    function yFor(la) {
      return TOP + (1 - (la - lo) / (hi - lo)) * (rows * RH);
    }

    lats.forEach(function (la, r) {
      var y = TOP + (rows - 1 - r) * RH;          // north at the top
      // The degrees, back alongside the place names. A latitude is not a
      // location to anyone deciding whether to drive north — but a place name
      // alone leaves the axis unmeasurable, and the profile is a spatial
      // quantity whose spacing is worth being able to read.
      if (r % 2 === 0) {
        var deg = el('text', { x: GUT - 6, y: y + RH / 2 + 3, 'text-anchor': 'end',
                               fill: css('--chart-axis'), 'font-size': 8.5 });
        deg.textContent = la.toFixed(1) + '\u00b0';
        svg.appendChild(deg);
      }
      d.forEach(function (h, i) {
        var v = (h.profile || [])[r];
        var x = GUT + i * cw;
        var tip = el('title');
        // A MAGNITUDE and a word, not a signed number and the same word. The
        // sign said "subsidence" a second time, in a notation the reader has
        // to decode — the reason src/process/instability.py drops HRRR's CIN
        // sign at its own edge, and the readout below says it this way too.
        tip.textContent = stampOf(h.iso) + ' \u2014 ' + la.toFixed(2) + '\u00b0N, ' +
          (num(v) ? (Math.abs(v) * 1e5).toFixed(1) + '\u00d710\u207b\u2075 s\u207b\u00b9 ' +
                    (v >= 0 ? 'convergence' : 'subsidence') : 'no value');
        var cell = el('rect', { x: x + 0.5, y: y, width: Math.max(1, cw - 1),
                                height: RH - 0.5, rx: 0.5,
                                fill: num(v) ? (v >= 0 ? css('--cz-conv') : css('--cz-div'))
                                             : css('--line-2'),
                                opacity: num(v)
                                  ? Math.max(0.08, Math.min(1, Math.abs(v) / top))
                                  : 0.25 });
        cell.appendChild(tip);
        svg.appendChild(cell);
      });
    });

    /* Places, over the field rather than under it.
     *
     * The names sit at the right-hand end of their own rule, inside the plot:
     * the gutter holds the degrees, and a name long enough to be useful
     * ("Seattle / Lake Union") does not fit beside a number in the same
     * column. Each gets a backing panel because it is drawn over a coloured
     * field it must stay legible against. */
    (CONV.landmarks || []).forEach(function (m) {
      var la = m[0], name = m[1];
      if (la < lo || la > hi) return;
      var y = yFor(la);
      svg.appendChild(el('line', { x1: GUT, x2: W - 8, y1: y, y2: y,
                                   stroke: css('--chart-axis'), 'stroke-width': 1,
                                   'stroke-dasharray': '2 4', opacity: 0.85 }));
      // A leader from the name to its rule, so a label sitting between two
      // row centres still reads as belonging to one line.
      svg.appendChild(el('line', { x1: GUT - 34, x2: GUT, y1: y, y2: y,
                                   stroke: css('--chart-axis'), 'stroke-width': 1,
                                   opacity: 0.35 }));
      // In the GUTTER, to the left of the degree it belongs to, so the axis
      // reads outward: place, then latitude, then the field. Inside the plot
      // they needed a backing panel to stay legible over the colour, and at
      // the right-hand edge they fell past the horizontal scroll on a phone —
      // the number and the place are two halves of one axis and belong
      // together, outside the data.
      var t = el('text', { x: 0, y: y + 3.5, 'text-anchor': 'start',
                           fill: css('--ink-2'), 'font-size': 8.5,
                           'font-weight': 600 });
      t.textContent = name;
      svg.appendChild(t);
    });

    nowBand(svg, d.map(function (h) { return h.iso; }),
            function (i) { return GUT + i * cw + cw / 2; }, TOP - 4, H - BOT + 2);
    node.appendChild(svg);

    /* Reachable without a pointer.
     *
     * Every cell here carried its value in an SVG <title>, and the hint under
     * the chart told a phone reader to "touch and hold any cell". That does
     * not work: a long press on an SVG element raises the browser's own
     * callout over the image — the same gesture this page already had to take
     * back from the meteograms — and there is no hover on a touch screen to
     * fall back to. So the values were unreachable on the device most of this
     * page is read on.
     *
     * A hundred and forty-four cells cannot each print a number the way the
     * instability strips now do. But the question this chart is asked is not
     * "what is cell 7,3" — it is "where is the band, and is it over me". So
     * the hour is scrubbed, and the readout answers that: what is happening
     * over this water, and where the strongest rising and sinking air in the
     * Sound is at that hour. The crosshair marks the column so the shape can
     * still be read off the field itself.
     */
    var here = czHomeRow(lats);
    var hov = [];
    if (here >= 0) {
      hov.push({ name: 'Over Lake Union',
                 colour: function (i) {
                   var v = (d[i].profile || [])[here];
                   return css(num(v) && v < 0 ? '--cz-div' : '--cz-conv');
                 },
                 text: function (i) { return czCell(d[i], here); } });
    }
    hov.push({ name: 'Rising fastest', colour: css('--cz-conv'),
               text: function (i) { return czExtreme(d[i], lats, 1); } });
    hov.push({ name: 'Sinking fastest', colour: css('--cz-div'),
               text: function (i) { return czExtreme(d[i], lats, -1); } });
    wireHover(node, svg, {
      n: n, x: function (i) { return GUT + i * cw + cw / 2; },
      left: GUT, right: 8, top: TOP, bottom: TOP + rows * RH,
      series: hov, times: d.map(function (h) { return h.iso; }),
      stamp: function (i) { return stampOf(d[i].iso); } });

    var key = document.createElement('div');
    key.className = 'ltg-key';
    var g = document.createElement('div');
    g.className = 'ltg-key-group';
    var b = document.createElement('b');
    b.textContent = 'Scale';
    g.appendChild(b);
    var box = document.createElement('div');
    box.className = 'ltg-key-items';
    [['--cz-conv', 'convergence, air rising \u2014 weak to strong'],
     ['--cz-div', 'subsidence, air sinking \u2014 weak to strong']].forEach(function (k) {
      var sp = document.createElement('span');
      sp.appendChild(rampSwatch(k[0], false));
      sp.appendChild(document.createTextNode(k[1]));
      box.appendChild(sp);
    });
    g.appendChild(box);
    key.appendChild(g);
    node.appendChild(key);

    var hint = document.createElement('p');
    hint.className = 'ltg-hint';
    // "Darkest is" was false over a dark page, where the strongest cell is the
    // brightest one. The scale's own extreme is a number; which cell carries
    // it is what the ramp in the key above shows.
    hint.textContent = 'Full strength is ' + (top * 1e5).toFixed(1) +
      '\u00d710\u207b\u2075 s\u207b\u00b9, this run\u2019s own extreme \u2014 the scale is ' +
      'the run\u2019s, not a threshold. ' +
      ((window.matchMedia && matchMedia('(hover:none) and (pointer:coarse)').matches)
        ? 'Drag the slider for any hour \u2014 it reports this water first, then where ' +
          'the strongest rising and sinking air in the Sound is, on that same ' +
          '\u00d710\u207b\u2075 s\u207b\u00b9 scale.'
        : 'Point at any hour for the same three readings, on that same ' +
          '\u00d710\u207b\u2075 s\u207b\u00b9 scale, or at any single cell for its own value.');
    node.appendChild(hint);
  }

  /* The day labels shared by both charts above. */
  function dayRow(svg, rows, GUT, cw, TOP, H, BOT) {
    var last = null;
    rows.forEach(function (h, i) {
      var iso = String(h.iso), day = iso.slice(0, 10);
      if (iso.slice(11, 13) === '00') {
        svg.appendChild(el('line', { x1: GUT + i * cw, x2: GUT + i * cw, y1: TOP - 6,
                                     y2: H - BOT + 4, stroke: css('--chart-axis'),
                                     'stroke-dasharray': '2 3', 'stroke-width': 1 }));
      }
      if (day !== last) {
        last = day;
        var t = el('text', { x: GUT + i * cw + 2, y: TOP - 7, 'text-anchor': 'start',
                             fill: css('--ink-3'), 'font-size': 9.5, 'font-weight': 600 });
        t.textContent = dayLabelOf(h.iso);
        svg.appendChild(t);
      }
      if (i % 3 === 0) {
        var c = el('text', { x: GUT + i * cw + cw / 2, y: H - BOT + 16,
                             'text-anchor': 'middle', fill: css('--chart-axis'),
                             'font-size': 9 });
        c.textContent = formatTime(iso.slice(11, 16), prefs.time);
        svg.appendChild(c);
      }
    });
  }

  function drawLtgTimeline(node) {
    var tl = PLAN && PLAN.ltg_timeline;
    node.textContent = '';
    if (!tl || !tl.available || !tl.hours.length) {
      var p = document.createElement('p');
      p.className = 'chart-empty';
      p.textContent = 'No lightning source answered for this build.';
      node.appendChild(p);
      return;
    }

    var n = tl.hours.length;
    var GUT = 96, RH = 22, GAP = 6, TOP = 30, BOT = 26;   // TOP leaves the day row
    var ROWS = tl.rows.length + 1;                 // + the discussion band
    var W = 760, H = TOP + ROWS * (RH + GAP) + BOT;
    var cw = (W - GUT - 8) / n;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%',
                          role: 'img', 'aria-label': 'Lightning sources by hour' });

    // The map's own table, handed over by the builder — one band, one colour,
    // whether it is painted over terrain or drawn as a cell here.
    var PAL = tl.palette || {};
    function fillFor(st) {
      if (st === 'none') return css('--line-2');
      if (st === 'flagged') return css('--st-watch-ink');
      return PAL[st] || css('--line-2');
    }
    var WORD = tl.labels || {};

    /* The words for one cell, in the vocabulary of the row's OWN source.
     *
     * `labels` is the model's band vocabulary and reads as such — "no
     * lightning in the model" — and the gridpoint row was using it, so the
     * chart said "Gridpoint forecast: no lightning in the model" and named the
     * wrong source in the one place this section exists to keep the two apart.
     * Overrides come from the payload rather than being written here, so the
     * page's words for a state stay in one place. Used by the tooltip and the
     * readout both, so those cannot drift. */
    function wordFor(row, i) {
      var st = row.states[i];
      if (!st) return null;
      if (st === 'no_reach') return 'does not reach this hour';
      var over = (tl.row_labels || {})[row.key] || {};
      var base = over[st] || WORD[st] || st;
      var d = (row.detail || [])[i];
      if (row.key === 'gridpoint' && st === 'flagged' && d) {
        return base + ' (' + String(d).replace(/_/g, ' ') + ')';
      }
      if (row.key === 'model' && d) return base + ' \u00b7 index ' + d;
      return base;
    }

    /* Day labels, like every other chart here.
     *
     * An axis of bare clock times across 49 hours reads the same at 4 pm today
     * and 4 pm tomorrow — and the whole point of this chart is that the flagged
     * run is TOMORROW while the model stops this morning. Without the day, the
     * one thing it exists to show is ambiguous. */
    var lastDay = null;
    tl.hours.forEach(function (iso, i) {
      var hh = String(iso).slice(11, 13);
      var day = String(iso).slice(0, 10);
      if (hh === '00') {
        svg.appendChild(el('line', { x1: GUT + i * cw, x2: GUT + i * cw, y1: TOP - 6,
                                     y2: H - BOT + 4, stroke: css('--chart-axis'),
                                     'stroke-dasharray': '2 3', 'stroke-width': 1 }));
      }
      // The first hour on the axis, and every midnight after it.
      if (day !== lastDay) {
        lastDay = day;
        var d = el('text', { x: GUT + i * cw + 2, y: TOP - 7, 'text-anchor': 'start',
                             fill: css('--ink-3'), 'font-size': 9.5,
                             'font-weight': 600 });
        d.textContent = dayLabelOf(iso);
        svg.appendChild(d);
      }
      if (i % 3 === 0) {
        var t = el('text', { x: GUT + i * cw + cw / 2, y: H - BOT + 16,
                             'text-anchor': 'middle', fill: css('--chart-axis'),
                             'font-size': 9 });
        t.textContent = formatTime(String(iso).slice(11, 16), prefs.time);
        svg.appendChild(t);
      }
    });

    tl.rows.forEach(function (row, r) {
      var y = TOP + r * (RH + GAP);
      var lab = el('text', { x: 0, y: y + RH / 2 + 4, fill: css('--ink-2'),
                             'font-size': 10, 'font-weight': 600 });
      lab.textContent = row.label;
      svg.appendChild(lab);

      row.states.forEach(function (st, i) {
        var x = GUT + i * cw;
        var tip = el('title');
        tip.textContent = stampOf(tl.hours[i]) + ' \u2014 ' + row.label + ': ' +
          wordFor(row, i);

        if (st === 'no_reach') {
          var hit = el('rect', { x: x, y: y, width: Math.max(1, cw), height: RH,
                                 fill: 'transparent' });
          hit.appendChild(tip);
          svg.appendChild(el('line', { x1: x, x2: x + cw, y1: y + RH / 2, y2: y + RH / 2,
                                       stroke: css('--line'), 'stroke-width': 1,
                                       'stroke-dasharray': '1 3' }));
          svg.appendChild(hit);
          return;
        }
        var cell = el('rect', {
          x: x + 0.5, y: y, width: Math.max(1, cw - 1), height: RH,
          fill: fillFor(st), opacity: st === 'none' ? 0.5 : 1, rx: 1 });
        cell.appendChild(tip);
        svg.appendChild(cell);
      });
    });

    /* The discussion, as a band rather than as hours.
     *
     * It is prose about western Washington with no hour attached, so it spans
     * the whole axis or none of it. Drawing it level with the other two, but
     * visibly not hour-resolved, is the honest shape: it belongs in the
     * comparison and it cannot be pinned to a column. */
    var dy = TOP + tl.rows.length * (RH + GAP);
    var dn = (tl.discussion || []).length;
    var dlab = el('text', { x: 0, y: dy + RH / 2 + 4, fill: css('--ink-2'),
                            'font-size': 10, 'font-weight': 600 });
    dlab.textContent = 'Forecaster prose';
    svg.appendChild(dlab);
    var dband = el('rect', { x: GUT + 0.5, y: dy + RH / 4,
                             width: W - GUT - 8, height: RH / 2, rx: 2,
                             fill: dn ? css('--st-note-ink') : css('--line-2'),
                             opacity: dn ? 0.35 : 0.5 });
    var dtip = el('title');
    dtip.textContent = dn
      ? dn + ' sentence' + (dn === 1 ? '' : 's') +
        ' mentioning thunder, lightning or convection \u2014 not hour-specific'
      : 'no mention of thunderstorms or lightning in the forecast discussion';
    dband.appendChild(dtip);
    svg.appendChild(dband);
    var dtext = el('text', { x: GUT + 8, y: dy + RH / 2 + 3.5,
                             fill: css('--ink-2'), 'font-size': 9 });
    dtext.textContent = dn ? dn + ' mention' + (dn === 1 ? '' : 's') +
                             ' \u2014 regional, not hour-specific'
                           : 'no mention of thunderstorms or lightning';
    svg.appendChild(dtext);

    nowBand(svg, tl.hours, function (i) { return GUT + i * cw + cw / 2; },
            TOP - 4, H - BOT + 2);
    /* The CHART scrolls sideways on a phone, not the whole panel.
     *
     * Setting overflow-x on the host made overflow-y compute to auto as well —
     * that is the CSS rule, not a quirk — so the host clipped the key and the
     * quotes sitting inside it, and the last row of swatches was cut off with
     * no scrollbar anywhere near it. Only the drawing needs the horizontal
     * room; everything under it is ordinary prose that wraps. */
    var scroller = document.createElement('div');
    scroller.className = 'ltgtl-scroll';
    scroller.appendChild(svg);
    node.appendChild(scroller);

    /* Reachable without a pointer, like the two charts below it.
     *
     * Every cell here held its reading in an SVG <title>, which is a hover
     * tooltip and nothing at all on a touch screen. Now that the chart fits
     * the window rather than scrolling, its labels are small enough that a
     * reader may well want the words rather than the colours — and this is the
     * one chart on the page where the answer is a decision about going out.
     *
     * One row per source, which is also what the chart is FOR: the three do
     * not always agree, and the readout puts their three answers for one hour
     * side by side without the reader tracking a column by eye.
     */
    var hov = tl.rows.map(function (row) {
      return { name: row.label, colour: function (i) {
                 var st = row.states[i];
                 return st === 'no_reach' ? css('--line') : fillFor(st);
               },
               text: function (i) { return wordFor(row, i); } };
    });
    wireHover(node, svg, {
      n: n, x: function (i) { return GUT + i * cw + cw / 2; },
      left: GUT, right: 8, top: TOP, bottom: TOP + tl.rows.length * (RH + GAP),
      series: hov, times: tl.hours,
      stamp: function (i) { return stampOf(tl.hours[i]); } });

    // A key with swatches, not the shared text legend: on this chart the
    // colour is the reading, so naming the states without showing them leaves
    // the reader to guess which orange is which.
    // TWO SCALES, labelled as two.
    //
    // The model ramp is graded and the gridpoint flag is binary, and the flag's
    // colour sits about as far from "trace" as "possible" sits from "likely" —
    // near enough to be misread if the key presents all six as one ladder.
    // Within a row there is no ambiguity (the gridpoint row only ever shows one
    // colour), so the fix is in how the key groups them, not in the paint.
    var key = document.createElement('div');
    key.className = 'ltg-key';
    function group(title, items) {
      var g = document.createElement('div');
      g.className = 'ltg-key-group';
      var h = document.createElement('b');
      h.textContent = title;
      g.appendChild(h);
      // The swatches go in their own box so they wrap against the label rather
      // than back to the left margin, which made the second line of a ladder
      // look like the start of a different one.
      var box = document.createElement('div');
      box.className = 'ltg-key-items';
      items.forEach(function (k) {
        var sp = document.createElement('span');
        // 'noreach' is a state rather than a band, and it is drawn as a broken
        // rule rather than a filled cell, so its swatch is one too.
        sp.innerHTML = (k[0] === 'noreach'
          ? '<i class="ltg-key-noreach"></i>'
          : '<i style="background:' + fillFor(k[0]) + ';opacity:' +
            (k[2] === undefined ? 1 : k[2]) + '"></i>') + k[1];
        box.appendChild(sp);
      });
      g.appendChild(box);
      key.appendChild(g);
    }
    // Gridpoint first, in the order the rows are drawn and in the order they
    // matter: it is the official forecast for this water, and the model is the
    // thing that sees past it. Both ladders are given in full whether or not
    // this build happens to reach every rung — a key that lists only what is
    // currently on screen teaches a scale that changes under the reader.
    group('Gridpoint coverage', [
      ['flagged', 'isolated \u2192 chance'],
      ['likely', 'likely, numerous'],
      ['strong', 'widespread, definite']]);
    group('HRRR index', [['none', 'covered, nothing', 0.5], ['trace', 'trace'],
                         ['possible', 'possible'], ['likely', 'likely'],
                         ['strong', 'strong']]);
    // Belongs to BOTH ladders, so it gets its own labelled row rather than
    // being appended loose under them. As a bare span outside every group it
    // sat unaligned with no heading, and read as text that had escaped from
    // somewhere else.
    group('Either source', [['noreach',
      'does not reach \u2014 this source cannot answer for those hours, ' +
      'which is not the same as it saying no']]);
    node.appendChild(key);

    // Not a key entry at all: it describes how to use the chart, not what a
    // colour means. It was the second loose span in the key, which is why it
    // looked like a caption fragment nobody had placed.
    var hint = document.createElement('p');
    hint.className = 'ltg-hint';
    hint.textContent = (window.matchMedia &&
        matchMedia('(hover:none) and (pointer:coarse)').matches)
      ? 'Drag the slider for what each source says at any hour.'
      : 'Point at any hour for what each source says.';
    node.appendChild(hint);

    /* The sentences themselves, under the chart it belongs to.
     *
     * They used to live several paragraphs away under "Everything else", which
     * is where the whole problem started: three sources, three places. If the
     * discussion is one of the three, its evidence belongs with the other two. */
    var quotes = document.createElement('div');
    quotes.className = 'ltg-quotes';
    if (dn) {
      var h = document.createElement('p');
      h.className = 'ltg-quotes-head';
      h.textContent = 'From the forecast discussion — mentions of thunder, ' +
                      'lightning or convection anywhere in western Washington:';
      quotes.appendChild(h);
      var ul = document.createElement('ul');
      tl.discussion.forEach(function (q) {
        var li = document.createElement('li');
        li.textContent = q;
        ul.appendChild(li);
      });
      quotes.appendChild(ul);
      var w = document.createElement('p');
      w.className = 'ltg-quotes-head';
      w.textContent = 'Regional, so a mention can argue against this water as ' +
                      'easily as for it — read the sentence, not the count.';
      quotes.appendChild(w);
    } else {
      var none = document.createElement('p');
      none.className = 'ltg-quotes-head';
      none.textContent = 'No mention of thunderstorms or lightning in the ' +
                         'forecast discussion.';
      quotes.appendChild(none);
    }
    node.appendChild(quotes);
  }


  /* ------------------------------------------------------------------ plan
   * The practice-window planner.
   *
   * Every other part of this page answers "what is it like now" or "what are
   * the next twelve hours". A crew with a fixed slot asks a different question:
   * what will it be like between 05:30 and 07:30 on Wednesday. That means
   * windowing every series to an arbitrary range rather than to a rolling one.
   *
   * Three rules it is built on:
   *
   * 1. NO SCORE. The page shows inputs, not verdicts, and a confident go/no-go
   *    for a dawn outing forty hours out is exactly where it would start lying.
   * 2. WIND FROM BOTH SOURCES, SEPARATELY. Where the gridpoint and HRRR
   *    disagree is the thing worth knowing, and one blended number is the one
   *    that hides it.
   * 3. SAY WHICH ROWS CANNOT ANSWER. The sources have different horizons —
   *    lightning 18 h, UV about 19, the forecasts about 44, water temperature
   *    never — so a window far enough out is answered by some rows and not
   *    others. Dropping the silent ones would turn "not forecast that far
   *    ahead" into "nothing to report", which for lightning is dangerous.
   */
  var PLAN = payload('plan-data');
  var CONV = payload('convective-data');

  function planWindow() {
    var root = document.querySelector('[data-plan]');
    if (!root) return null;
    var day = root.querySelector('[data-plan-day]').value;
    var from = root.querySelector('[data-plan-from]').value || '05:30';
    var to = root.querySelector('[data-plan-to]').value || '07:30';
    if (!day) return null;
    var a = new Date(day + 'T' + from + ':00');
    var b = new Date(day + 'T' + to + ':00');
    if (isNaN(a) || isNaN(b)) return null;
    // A window ending before it starts is read as crossing midnight, which is
    // what a pre-dawn slot entered backwards looks like.
    if (b <= a) b = new Date(b.getTime() + 24 * 3600 * 1000);
    return { a: a, b: b };
  }

  /* Values of one series inside the window, plus whether the series reaches it
   * at all. The distinction is the point: an empty list because the window is
   * quiet and an empty list because the forecast ended are different answers. */
  function planSlice(times, arrays, win) {
    if (!times || !times.length) return { reach: false, idx: [] };
    var last = Date.parse(times[times.length - 1]);
    var first = Date.parse(times[0]);
    var idx = [];
    for (var i = 0; i < times.length; i++) {
      var t = Date.parse(times[i]);
      if (t >= win.a.getTime() && t <= win.b.getTime()) idx.push(i);
    }
    return { reach: last >= win.a.getTime() && first <= win.b.getTime(),
             idx: idx, ends: last };
  }

  /* A Date as its LOCAL calendar day, not its UTC one. toISOString() would
   * roll a 17:00 PDT window forward to the next date and match the wrong
   * AirNow forecast day — the same class of bug as the lightning timeline's
   * bare astimezone(). */
  function localDate(d) {
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  /* AirNow's mm/dd/yy to the same form. Its century window is the feed's own:
   * these are forecasts a few days out, so a two-digit year is this one. */
  function usDate(s) {
    var m = /^\s*(\d{2})\/(\d{2})\/(\d{2})\s*$/.exec(s || '');
    return m ? '20' + m[3] + '-' + m[1] + '-' + m[2] : null;
  }

  /* src.process.glance._aqi_state, in the browser. */
  function aqiState(v) {
    if (v === null || v === undefined) return 'none';
    return v <= 50 ? 'ok' : v <= 150 ? 'watch' : 'alert';
  }

  /* src.process.smoke.aloft, in the browser — kept deliberately in step with
   * it, including the 500 m floor and the EPA-category trigger. */
  var SMOKE_MIN_MIX_M = 500, SMOKE_NOMINAL_MIX_M = 1000;
  var AQI_LADDER = ['good', 'moderate', 'unhealthy for sensitive groups',
                    'unhealthy', 'very unhealthy', 'hazardous'];

  function aqiCategory(a) {
    if (a === null || a === undefined) return null;
    var lim = [50, 100, 150, 200, 300];
    for (var i = 0; i < lim.length; i++) if (a <= lim[i]) return AQI_LADDER[i];
    return 'hazardous';
  }

  /* The EPA's PM2.5 breakpoints, 2024 revision — src/process/aqi.py. */
  var PM25_BP = [[0, 9.0, 0, 50], [9.1, 35.4, 51, 100], [35.5, 55.4, 101, 150],
                 [55.5, 125.4, 151, 200], [125.5, 225.4, 201, 300],
                 [225.5, 325.4, 301, 500]];

  function aqiFromPm25(c) {
    if (c === null || c === undefined || c !== c || c < 0) return null;
    for (var i = 0; i < PM25_BP.length; i++) {
      var b = PM25_BP[i];
      if (c <= b[1]) return Math.round((b[3] - b[2]) / (b[1] - b[0]) * (Math.max(c, b[0]) - b[0]) + b[2]);
    }
    return 500;
  }

  function smokeAloft(surface, col, pbl) {
    if (!num(surface) || !num(col)) return null;
    var h = Math.max(pbl || SMOKE_NOMINAL_MIX_M, SMOKE_MIN_MIX_M);
    var imp = Math.round(col * 1000 / h * 100) / 100;
    var here = aqiCategory(aqiFromPm25(surface));
    var down = aqiCategory(aqiFromPm25(imp));
    if (AQI_LADDER.indexOf(down) <= AQI_LADDER.indexOf(here)) return null;
    return { surface: surface, column: col, mix_m: Math.round(h),
             implied: imp, here: here, if_mixed: down };
  }

  function planRange(vals) {
    var v = vals.filter(num);
    if (!v.length) return null;
    return { lo: Math.min.apply(null, v), hi: Math.max.apply(null, v) };
  }

  /* "7-7 mph" is a range with nothing in it. A two-hour window often sits
   * inside one forecast hour, or spans hours the model rounds to the same
   * value, and printing both ends then invents a spread the data does not
   * have. */
  function planSpan(lo, hi, unit) {
    return (lo === hi ? String(lo) : lo + '\u2013' + hi) + (unit ? ' ' + unit : '');
  }

  /* src.process.ltgtimeline.worst_over, in the browser.
   *
   * The window is chosen client-side, so the reduction has to happen here —
   * but the STATES were computed in Python, on one axis, once. This only picks
   * the worst of each source inside the chosen hours and must keep no_reach
   * distinct from none, for the same reason the module does. */
  function ltgWorst(tl, win) {
    // Must match src.process.ltgtimeline.RANK exactly. The model row carries
    // the full band ladder now, not a trace/flagged pair — a browser copy that
    // still knew only two of them would silently rank "strong" as unknown and
    // drop it below "trace".
    var RANK = { no_reach: -1, none: 0, trace: 1, possible: 2, flagged: 2,
                 likely: 3, strong: 4 };
    var out = { any_reach: false };
    var lo = win.a.getTime(), hi = win.b.getTime();   // as planSlice reads it
    (tl.rows || []).forEach(function (row) {
      var seen = [];
      tl.hours.forEach(function (h, i) {
        var t = Date.parse(h);
        if (t >= lo && t <= hi) seen.push(row.states[i]);
      });
      var covered = seen.filter(function (s) { return s !== 'no_reach'; });
      if (!covered.length) { out[row.key] = 'no_reach'; return; }
      out.any_reach = true;
      out[row.key] = covered.reduce(function (a, b) {
        return RANK[b] > RANK[a] ? b : a; });
    });
    var real = (tl.rows || []).map(function (r) { return out[r.key]; })
                 .filter(function (s) { return s !== 'no_reach'; });
    out.worst = real.length
      ? real.reduce(function (a, b) { return RANK[b] > RANK[a] ? b : a; })
      : 'no_reach';
    return out;
  }

  function planRow(label, state, body, note) {
    // The expander ships with the row rather than being added afterwards:
    // planRender rebuilds this markup on every change of day, hour or unit,
    // and anything injected into a row would be thrown away with it.
    return '<div class="plan-row plan-' + state + '">' +
           '<span class="plan-label">' + label + '</span>' +
           '<span class="plan-body">' + body +
           (note ? '<span class="plan-sub">' + note + '</span>' +
                   '<button type="button" class="plan-expand" data-expand ' +
                   'aria-label="Show the note for this row"></button>' : '') +
           '</span></div>';
  }

  function planBeyond(label, what) {
    return planRow(label, 'beyond', 'beyond this forecast',
                   what + ' does not reach your window');
  }

  function planRender() {
    var root = document.querySelector('[data-plan]');
    var out = root && root.querySelector('[data-plan-out]');
    if (!out) return;
    var win = planWindow();
    if (!win) { out.innerHTML = ''; return; }

    var lead = Math.round((win.a - Date.now()) / 3600000);
    var leadEl = root.querySelector('[data-plan-lead]');
    if (leadEl) {
      leadEl.textContent = lead < 0 ? 'this window has started'
        : lead < 1 ? 'starting within the hour'
        : lead + ' h ahead';
      leadEl.classList.toggle('plan-far', lead >= 24);
    }

    if (win.b < new Date()) {
      // "Beyond the forecast" would be wrong and confusing here: the data is
      // not missing, the window is behind us. Rows are suppressed rather than
      // filled with past values, because this tool is for planning.
      out.innerHTML = '<div class="plan-row plan-beyond"><span class="plan-label">' +
        'That window has passed</span><span class="plan-body">Pick a later day to plan ' +
        'against.<span class="plan-sub">Everything before now is described by the sections ' +
        'above.</span></span></div>';
      return;
    }

    var rows = [];
    var fc = FORECAST && FORECAST[OUTLOOK_DOMAIN];
    var md = DATA && DATA.wind && DATA.wind[OUTLOOK_DOMAIN] &&
             (DATA.wind[OUTLOOK_DOMAIN].extended || DATA.wind[OUTLOOK_DOMAIN].hourly);
    var wu = WIND[prefs.wind], wlab = wu.label;
    var W = function (v) { return Math.round(windValue(v, prefs.wind)); };
    var T = function (v) { return Math.round(tempValue(v, prefs.temp)); };
    var tlab = prefs.temp === 'c' ? '°C' : '°F';

    // --- wind, from each source separately --------------------------------
    /* Both wind rows describe the HOME domain, Lake Union and the Ship Canal.
     * The other two are not shown as their own rows — six wind rows would bury
     * the source disagreement this section exists for — but they are not
     * ignored either, because at dawn they genuinely differ: on the run this
     * was written against, 06:00 read 5.5 mph over Lake Union and 9.3 over the
     * open lake. So the windiest of the three is named whenever it is enough
     * clear of home to change a decision.
     */
    function otherDomains(idx, homeHi) {
      if (!DATA || !DATA.wind) return null;
      var best = null;
      Object.keys(DATA.wind).forEach(function (k) {
        if (k === OUTLOOK_DOMAIN) return;
        var d = DATA.wind[k] && (DATA.wind[k].extended || DATA.wind[k].hourly);
        if (!d || !d.times) return;
        var sl = planSlice(d.times, d, win);
        if (!sl.reach || !sl.idx.length) return;
        var r = planRange(sl.idx.map(function (i) { return (d.mean || [])[i]; }));
        if (!r) return;
        if (!best || r.hi > best.hi) best = { key: k, hi: r.hi };
      });
      if (!best) return null;
      var gap = (best.hi - homeHi) * 2.2369363;
      // Two miles an hour: below that the three domains are the same water for
      // planning purposes, and naming a difference that small would imply a
      // resolution the 3 km model does not have.
      if (gap < 2) return null;
      return best.key.replace(/_/g, ' ') + ' runs ' + Math.round(gap) + ' mph higher';
    }

    [['Wind, point forecast', fc, 'wind', 'gust', 'dir', null],
     ['Wind, model', md, 'mean', 'gust_max', 'dir_mean', otherDomains]].forEach(function (spec) {
      var s = spec[1];
      if (!s || !s.times) { rows.push(planBeyond(spec[0], 'that source')); return; }
      var sl = planSlice(s.times, s, win);
      if (!sl.reach) { rows.push(planBeyond(spec[0], 'that run')); return; }
      if (!sl.idx.length) { rows.push(planBeyond(spec[0], 'that run')); return; }
      var pick = function (k) { return sl.idx.map(function (i) { return (s[k] || [])[i]; }); };
      var w = planRange(pick(spec[2])), g = planRange(pick(spec[3]));
      if (!w) { rows.push(planBeyond(spec[0], 'that run')); return; }
      var body = planSpan(W(w.lo), W(w.hi), wlab);
      if (g) body += ', gusts ' + W(g.hi);
      // Direction at the windiest hour in the window, for the same reason the
      // glance tile uses it: a range of bearings reads "variable" and says
      // nothing about which shore is sheltered.
      var best = -Infinity, at = null;
      sl.idx.forEach(function (i) {
        var v = (s[spec[2]] || [])[i];
        if (num(v) && v > best) { best = v; at = (s[spec[4]] || [])[i]; }
      });
      if (num(at) && w.hi >= 0.3) body += ', from ' + POINT16[Math.round((at % 360) / 22.5) % 16];
      var over = pick(spec[2]).filter(function (v) { return num(v) && v >= WATCH_MS; }).length;
      var note = over
        ? 'over ' + Math.round(WATCH_MS * 2.2369363) + ' mph sustained for ' + over +
          ' of ' + sl.idx.length + ' h'
        : 'stays under ' + Math.round(WATCH_MS * 2.2369363) + ' mph sustained';
      var other = spec[5] && spec[5](sl.idx, w.hi);
      if (other) note += ' · ' + other;
      rows.push(planRow(spec[0], over ? 'watch' : 'ok', body, note));
    });

    /* --- has this window been holding still? ------------------------------
     * Directly under the two wind rows, because it is about the same field
     * they are: both of those give a range from ONE run, and this says how
     * far apart the last six runs are over the same hours. Named in full for
     * the same reason — "run-to-run agreement" alone does not say agreement
     * about WHAT, sitting nine rows below the thing it qualifies.
     *
     * The WORST hour inside the window, not the mean of them: an outing is
     * planned around the hour that goes wrong.
     */
    (function () {
      var sp = PLAN && PLAN.spread && PLAN.spread[OUTLOOK_DOMAIN];
      if (!sp || !sp.times || !sp.times.length) {
        rows.push(planBeyond('Wind, model run-to-run agreement', 'the recent runs')); return; }
      var worst = { sustained: null, gust: null }, minRuns = null, any = false;
      sp.times.forEach(function (t, i) {
        var ms = Date.parse(t);
        if (isNaN(ms) || ms < win.a.getTime() || ms > win.b.getTime()) return;
        ['sustained', 'gust'].forEach(function (which) {
          var h = (sp[which] || [])[i];
          if (!h || !h.n) return;
          any = true;
          minRuns = minRuns === null ? h.n : Math.min(minRuns, h.n);
          if (h.spread === null || h.spread === undefined) return;
          if (!worst[which] || h.spread > worst[which].spread) worst[which] = h;
        });
      });
      if (!any) {
        rows.push(planBeyond('Wind, model run-to-run agreement', 'the recent runs')); return; }
      if (!worst.sustained && !worst.gust) {
        // Every hour in the window is covered by a single run. There is nothing
        // to compare, and saying "0 apart" would be the confident reading drawn
        // from the least evidence.
        rows.push(planRow('Wind, model run-to-run agreement', 'note', 'only one run reaches this window',
          'nothing to compare — the other runs stop before it')); return; }
      var body = [];
      if (worst.sustained) body.push(W(worst.sustained.spread) + ' ' + wlab + ' on sustained');
      if (worst.gust) body.push(W(worst.gust.spread) + ' ' + wlab + ' on the gust');
      // Two mph of sustained disagreement is the ordinary state of a forecast
      // and not worth flagging; past that the hour has been moving.
      var loud = worst.sustained && worst.sustained.spread * 2.2369363 >= 4;
      // The count at the hour the numbers CAME from, not the minimum across the
      // window. Those differ whenever the window runs past where some runs stop,
      // and reporting the minimum said "the last 1 runs" — ungrammatical, and
      // describing an hour that contributed nothing to the figures beside it.
      var at = (worst.sustained || worst.gust).n;
      var thin = minRuns !== null && minRuns < at
        ? ' — later hours in the window are covered by as few as ' + minRuns : '';
      rows.push(planRow('Wind, model run-to-run agreement', loud ? 'watch' : 'ok',
        'up to ' + body.join(', '),
        'across ' + at + ' runs, at the worst hour in your window' + thin));
    })();

    // --- the rest, all from the point forecast unless noted ----------------
    function simple(label, key, fmt, note) {
      if (!fc || !fc.times) { rows.push(planBeyond(label, 'the forecast')); return; }
      var sl = planSlice(fc.times, fc, win);
      if (!sl.reach || !sl.idx.length) { rows.push(planBeyond(label, 'the forecast')); return; }
      var r = planRange(sl.idx.map(function (i) { return (fc[key] || [])[i]; }));
      if (!r) { rows.push(planRow(label, 'none', 'not reported')); return; }
      rows.push(planRow(label, 'ok', fmt(r), note));
    }
    simple('Air temperature', 'temp', function (r) {
      return planSpan(T(r.lo), T(r.hi), tlab); });
    simple('Feels like', 'feels', function (r) {
      return planSpan(T(r.lo), T(r.hi), tlab); },
      'wind chill only — these hours carry no humidity');
    /* Chance and amount are different questions and the page has both. A 40%
     * chance of 0.01 inches and a 40% chance of a quarter inch are the same
     * number and different mornings — one is a damp seat, the other soaks a
     * crew through. The percentage is the gridpoint's; the total is HRRR's
     * hourly rate summed across the window, so they come from different
     * models and are labelled that way rather than presented as one figure.
     */
    (function () {
      var label = 'Chance of rain';
      if (!fc || !fc.times) { rows.push(planBeyond(label, 'the forecast')); return; }
      var sl = planSlice(fc.times, fc, win);
      if (!sl.reach || !sl.idx.length) { rows.push(planBeyond(label, 'the forecast')); return; }
      var r = planRange(sl.idx.map(function (i) { return (fc.precip_pct || [])[i]; }));
      if (!r) { rows.push(planRow(label, 'none', 'not reported')); return; }
      var body = planSpan(r.lo, r.hi) + '%';

      // The accumulation, from the model's corridor MEAN rate — the mean is
      // what falls on this water, where the max is one cell and would overstate
      // a total. Each value is mm/h over one hour, so the sum is millimetres.
      var note = null;
      var pr = DATA && DATA.precip && (DATA.precip.extended || DATA.precip.hourly);
      if (pr && pr.times) {
        var ps = planSlice(pr.times, pr, win);
        if (ps.reach && ps.idx.length) {
          var mm = 0, any = false;
          ps.idx.forEach(function (i) {
            var v = (pr.mean || [])[i];
            if (num(v)) { mm += v; any = true; }
          });
          if (any) {
            var inch = mm / 25.4;
            note = inch < 0.005
              ? 'the model puts almost nothing in it — under 0.01 in over the window'
              : 'the model totals ' + inch.toFixed(2) + ' in over the window';
          }
        } else {
          note = 'no amount — the model run does not reach your window';
        }
      }
      rows.push(planRow(label, 'ok', body, note));
    })();
    simple('Cloud cover', 'sky_pct', function (r) {
      return planSpan(r.lo, r.hi) + '%'; });

    // --- fog, from the model's minimum visibility -------------------------
    (function () {
      var v = DATA && DATA.visibility &&
              (DATA.visibility.extended || DATA.visibility.hourly);
      if (!v || !v.times) { rows.push(planBeyond('Visibility', 'the model')); return; }
      var sl = planSlice(v.times, v, win);
      if (!sl.reach || !sl.idx.length) { rows.push(planBeyond('Visibility', 'that run')); return; }
      var r = planRange(sl.idx.map(function (i) { return (v.min || v.mean || [])[i]; }));
      if (!r) { rows.push(planRow('Visibility', 'none', 'not reported')); return; }
      var mi = r.lo / 1609.344;
      rows.push(planRow('Visibility', mi < 1 ? 'watch' : 'ok',
        'down to ' + (mi < 1 ? mi.toFixed(1) : Math.round(mi)) + ' miles',
        'lowest anywhere in the corridor — the fog number'));
    })();

    /* --- lightning: all three sources, in ONE row -------------------------
     *
     * This row used to read HRRR alone. HRRR's lightning field runs 18 hours
     * from its own init and the gridpoint forecast runs 48, so a window past
     * the model's reach got "beyond this forecast" — including, on the build
     * this was rewritten against, the exact five hours the official forecast
     * had flagged for thunderstorms. The row that exists to answer the
     * question was the one place on the page that never asked it.
     *
     * ONE row, not three. An earlier pass split the discussion onto a second
     * row, which put the same hazard in two places in a twelve-row table and
     * made the reader assemble it. All three sources fit in one cell: the
     * verdict as the value, and who said what as the note.
     *
     * A source that does not reach the window is reported as not reaching it,
     * never as quiet: that distinction is the whole bug.
     */
    (function () {
      var tl = PLAN && PLAN.ltg_timeline;
      var lt = PLAN && PLAN.lightning;
      if (!tl || !tl.available) {
        rows.push(planBeyond('Lightning', 'every lightning source')); return; }

      var w = ltgWorst(tl, win);
      var dn = (tl.discussion || []).length;

      if (!w.any_reach) {
        // Nothing hourly reaches. The discussion still might have something,
        // and saying so is the difference between "no answer" and "no risk".
        rows.push(planRow('Lightning', dn ? 'note' : 'beyond',
          dn ? 'only the forecast discussion reaches' : 'beyond this forecast',
          dn ? dn + ' mention' + (dn === 1 ? '' : 's') + ' in the forecast discussion, ' +
               'regional and not hour-specific \u2014 neither the official forecast nor ' +
               'HRRR reaches these hours'
             : 'neither the official forecast nor HRRR reaches these hours'));
        return;
      }

      var GRID_SAYS = {
        flagged: 'thunderstorms in the official forecast',
        likely: 'thunderstorms likely in the official forecast',
        strong: 'thunderstorms expected in the official forecast'
      };
      var MODEL_SAYS = {
        trace: 'a trace in HRRR, below a watch',
        possible: 'lightning potential in HRRR',
        likely: 'organised lightning potential in HRRR',
        strong: 'strong lightning potential in HRRR'
      };

      // Who said what, in one sentence: what fired, what was quiet, what could
      // not answer. All three sources appear in every reading.
      var said = [], quiet = [];
      if (GRID_SAYS[w.gridpoint]) said.push(GRID_SAYS[w.gridpoint]);
      else if (w.gridpoint === 'no_reach') said.push('the official forecast does not reach');
      else quiet.push('the official forecast');

      if (MODEL_SAYS[w.model]) said.push(MODEL_SAYS[w.model] + ' within ' + lt.radius_nm + ' nm');
      else if (w.model === 'no_reach') said.push('HRRR does not reach these hours');
      else quiet.push('HRRR within ' + lt.radius_nm + ' nm');

      if (dn) said.push(dn + ' mention' + (dn === 1 ? '' : 's') +
                        ' in the forecast discussion (regional)');
      else quiet.push('the forecast discussion');

      var note = said.concat(quiet.length ? ['nothing from ' + quiet.join(' or ')] : [])
                     .join('; ');

      // likely and strong are an ALERT in src.process.lightning.STATE, on
      // EITHER ladder — organised lightning in the model and "thunderstorms
      // likely" from a forecaster are both past a watch.
      if (w.worst === 'likely' || w.worst === 'strong') {
        rows.push(planRow('Lightning', 'alert',
          w.worst === 'strong' ? 'thunderstorms expected' : 'thunderstorms likely', note));
      } else if (w.worst === 'flagged' || w.worst === 'possible') {
        rows.push(planRow('Lightning', 'watch',
          w.gridpoint !== 'none' && w.gridpoint !== 'no_reach'
            ? 'thunderstorms forecast' : 'potential in the model', note));
      } else if (w.worst === 'trace' || (w.worst === 'none' && dn)) {
        rows.push(planRow('Lightning', 'note',
          w.worst === 'trace' ? 'trace potential' : 'nothing flagged, but see the discussion',
          note));
      } else {
        rows.push(planRow('Lightning', 'ok', 'nothing flagged', note));
      }
    })();

    /* --- air quality, from AirNow's forecasters --------------------------
     * A DAY's peak, not this window's, and the row says so. AirNow forecasts
     * one number per day and the planner picks a day, so the two line up
     * exactly — but a dawn window is nowhere near a daytime peak, which makes
     * this a ceiling on the window rather than a reading of it.
     */
    (function () {
      var fc = PLAN && PLAN.aqi_forecast;
      if (!fc || !fc.length) { rows.push(planBeyond('Air quality', 'the AirNow forecast')); return; }
      // planWindow rolls a backwards window past midnight, so a pre-dawn slot
      // entered the wrong way round straddles two forecast days. Take the
      // worse of them: the window really does cover both.
      var days = {}, d;
      for (d = new Date(win.a.getTime()); d <= win.b; d.setDate(d.getDate() + 1)) {
        days[localDate(d)] = true;
      }
      days[localDate(win.b)] = true;
      var hit = fc.filter(function (f) { return days[usDate(f.date)]; });
      if (!hit.length) { rows.push(planBeyond('Air quality', 'the AirNow forecast')); return; }
      var worst = hit.reduce(function (a, b) { return b.aqi > a.aqi ? b : a; });
      var span = hit.length > 1 ? 'across ' + hit.length + ' days' : 'all of ' + worst.label;
      rows.push(planRow('Air quality', aqiState(worst.aqi),
        worst.aqi + ', ' + String(worst.category || '').toLowerCase(),
        'AirNow\u2019s forecast peak for ' + span + ' \u2014 the highest the ' +
        (worst.parameter ? String(worst.parameter) + ' ' : '') +
        'index is expected to reach, over the whole day and over ' +
        ((PLAN && PLAN.aqi_area) || 'the reporting area') + '. Your window is a slice of ' +
        'that, so read it as a ceiling. Measured air quality is under Hazards.'));
    })();

    /* --- smoke, as smoke mass ---------------------------------------------
     * NOT on the AQI scale. This row used to print "AQI 0-1, good" while
     * Hazards printed AirNow's "AQI 53, Moderate" — two numbers, one named
     * scale, fifty apart, and only one of them an air quality index. This is
     * modelled smoke mass and now says so in the unit it is measured in.
     */
    (function () {
      var sm = PLAN && PLAN.smoke;
      if (!sm || !sm.length) { rows.push(planBeyond('Smoke', 'the model')); return; }
      var sl = planSlice(sm.map(function (h) { return h.iso; }), {}, win);
      if (!sl.reach || !sl.idx.length) { rows.push(planBeyond('Smoke', 'that run')); return; }
      var ug = planRange(sl.idx.map(function (i) { return sm[i].ugm3; }));
      if (!ug) { rows.push(planRow('Smoke', 'none', 'not reported')); return; }
      // Smoke the column is holding above a window that reads clean at the
      // surface — the case a surface field alone cannot report.
      var up = null;
      sl.idx.forEach(function (i) {
        var v = smokeAloft(sm[i].ugm3, sm[i].col, sm[i].pbl);
        if (v && (!up || v.implied > up.implied)) up = v;
      });
      var note = 'Modelled smoke only \u2014 HRRR-Smoke at 8\u00a0m, the maximum anywhere ' +
                 'in the corridor. Not a measurement and not total PM2.5: it is blind to ' +
                 'traffic and wood smoke, so outside a fire it reads far below the ' +
                 'monitored number under Hazards.';
      if (up) {
        note += ' Overhead the column holds ' + up.column + '\u00a0mg/m\u00b2, which ' +
                'mixed through the model\u2019s ' + up.mix_m + '\u00a0m layer would be ' +
                up.implied + '\u00a0\u00b5g/m\u00b3 here \u2014 ' + up.if_mixed +
                '. It is aloft, not down.';
      }
      rows.push(planRow('Smoke', up ? 'watch' : (ug.hi >= 9.1 ? 'watch' : 'ok'),
        planSpan(+ug.lo.toFixed(1), +ug.hi.toFixed(1)) + ' \u00b5g/m\u00b3' +
        (ug.hi < 0.5 ? ', none' : '') + (up ? ' \u2014 smoke aloft' : ''),
        note));
    })();

    // --- UV, only when it can speak ---------------------------------------
    (function () {
      var uv = PLAN && PLAN.uv;
      if (!uv || !uv.length) { rows.push(planBeyond('UV', 'the EPA feed')); return; }
      var sl = planSlice(uv.map(function (h) { return h.iso; }), {}, win);
      if (!sl.reach || !sl.idx.length) {
        rows.push(planBeyond('UV', "the EPA's rolling window")); return; }
      var r = planRange(sl.idx.map(function (i) { return uv[i].value; }));
      if (!r) { rows.push(planRow('UV', 'none', 'not reported')); return; }
      rows.push(planRow('UV', r.hi >= 6 ? 'watch' : 'ok', 'peaks at ' + r.hi,
        r.hi < 3 ? 'low enough to ignore' : null));
    })();

    // --- water temperature: an observation, never a forecast --------------
    (function () {
      var wt = PLAN && PLAN.water;
      if (!wt) { rows.push(planRow('Water temperature', 'none', 'no sensor reporting')); return; }
      var age = Math.round((win.a - Date.parse(wt.observed)) / 3600000);
      var when = !isFinite(age) ? 'an observation, not a forecast'
        : age >= 1 ? 'an observation, not a forecast — read ' + age + ' h before your window'
        : 'an observation, not a forecast — the latest reading';
      rows.push(planRow('Water temperature', 'obs', T(wt.c) + ' ' + tlab,
        when + (wt.proxy ? ', and from Lake Washington as a proxy' : '')));
    })();

    /* --- light: the one row that is a relationship, not a series ---------
     *
     * Measured against CIVIL twilight, not sunrise. §3 has held from the start
     * that the launch-and-land bound is civil: there is enough ambient light to
     * see and be seen before the sun clears the horizon and for a while after
     * it drops, and a tool that used sunrise would contradict the page's own
     * reasoning by half an hour at each end.
     *
     * Symmetric on purpose. The first version reported only the dark start —
     * "starts 60 min before sunrise" — and said nothing about how far a window
     * ran past dusk, which for an evening practice is the same question and the
     * one nobody is watching the clock for.
     */
    (function () {
      if (!SUN || !SUN.length) return;
      var day = null;
      for (var i = 0; i < SUN.length; i++) {
        var r = Date.parse(SUN[i].sunrise_iso);
        if (!isNaN(r) && new Date(r).toDateString() === win.a.toDateString()) day = SUN[i];
      }
      if (!day) { rows.push(planBeyond('Light', 'the sun table')); return; }

      var ca = Date.parse(day.civil_start_iso), cb = Date.parse(day.civil_end_iso);
      if (isNaN(ca) || isNaN(cb)) { rows.push(planBeyond('Light', 'the sun table')); return; }
      var before = Math.round((ca - win.a) / 60000);   // dark at the start
      var after = Math.round((win.b - cb) / 60000);    // dark at the end

      var parts = [], notes = [];
      if (before > 0) {
        parts.push('first ' + before + ' min before civil dawn');
        notes.push('civil dawn ' + formatTime(day.civil_start, prefs.time) +
                   ', sunrise ' + formatTime(day.sunrise, prefs.time));
      }
      if (after > 0) {
        parts.push('last ' + after + ' min after civil dusk');
        notes.push('sunset ' + formatTime(day.sunset, prefs.time) +
                   ', civil dusk ' + formatTime(day.civil_end, prefs.time));
      }
      var dark = before > 0 || after > 0;
      rows.push(planRow('Light', dark ? 'watch' : 'ok',
        dark ? parts.join(' and ') + ' — lights required'
             : 'inside the usable light window throughout',
        dark ? notes.join(' · ')
             : 'civil dawn ' + formatTime(day.civil_start, prefs.time) + ' to dusk ' +
               formatTime(day.civil_end, prefs.time)));
    })();

    out.innerHTML = rows.join('');
  }

  function wirePlan() {
    var root = document.querySelector('[data-plan]');
    if (!root || !FORECAST) return;
    var sel = root.querySelector('[data-plan-day]');
    var fc = FORECAST[OUTLOOK_DOMAIN];
    if (!sel || !fc || !fc.times || !fc.times.length) { root.hidden = true; return; }

    // Offer only the days the forecast actually covers. A picker listing days
    // it cannot answer would invite the question and then refuse it.
    var days = [], seen = {};
    fc.times.forEach(function (t) {
      var d = new Date(Date.parse(t));
      var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
                '-' + String(d.getDate()).padStart(2, '0');
      if (!seen[key]) { seen[key] = 1; days.push({ key: key, d: d }); }
    });
    var today = new Date().toDateString();
    sel.innerHTML = days.map(function (o, i) {
      var lbl = o.d.toDateString() === today ? 'Today'
        : i && days[i - 1].d.toDateString() === today ? 'Tomorrow'
        : o.d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
      return '<option value="' + o.key + '">' + lbl + '</option>';
    }).join('');

    // Remembered per reader: a crew's slot is the same every week, and retyping
    // it on every visit is the difference between a tool and a demo.
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('lu-plan') || 'null'); } catch (e) {}
    if (saved) {
      if (saved.from) root.querySelector('[data-plan-from]').value = saved.from;
      if (saved.to) root.querySelector('[data-plan-to]').value = saved.to;
      if (saved.day && seen[saved.day]) sel.value = saved.day;
    }
    if (!saved || !saved.day || !seen[saved.day]) {
      // The first day whose window has not already started. Setting innerHTML
      // leaves the first option selected, so without this the planner opened on
      // today's slot — which by evening has passed, and answered every row with
      // "beyond this forecast" for a window that was simply behind us.
      var startAt = root.querySelector('[data-plan-from]').value || '05:30';
      var chosen = days[days.length - 1];
      for (var di = 0; di < days.length; di++) {
        if (new Date(days[di].key + 'T' + startAt + ':00') > new Date()) {
          chosen = days[di]; break;
        }
      }
      sel.value = chosen.key;
    }

    function changed() {
      try {
        localStorage.setItem('lu-plan', JSON.stringify({
          day: sel.value,
          from: root.querySelector('[data-plan-from]').value,
          to: root.querySelector('[data-plan-to]').value }));
      } catch (e) {}
      planRender();
    }
    root.querySelectorAll('select,input').forEach(function (el) {
      el.addEventListener('change', changed);
      el.addEventListener('input', changed);
    });
    planRender();
  }


  /* How old the echoes actually are.
   *
   * Not "how long ago you loaded the picture" — that is a fact about the
   * browser, and on a page that refreshes an image behind a cache it is not
   * the number anyone wants. This is the radar's own last volume scan,
   * subtracted from the reader's clock.
   *
   * The loop image itself cannot supply it. radar.weather.gov sends a
   * Last-Modified header and no CORS headers at all, so a fetch from this page
   * is blocked before the header can be read — verified, not assumed. But
   * api.weather.gov sends Access-Control-Allow-Origin *, and its radar-station
   * record carries latency.levelTwoLastReceivedTime: when the Level II volume
   * was last received. That is the scan time, and it is readable.
   *
   * The image lags that by processing, so this is a floor rather than an exact
   * age of the frame on screen — said in the caption rather than smuggled into
   * the number.
   */
  function radarAge() {
    var el = document.querySelector('[data-radar-age]');
    if (!el) return;
    var stn = el.getAttribute('data-station') || 'KATX';

    function paint(iso) {
      if (!iso) {
        el.className = 'radar-age unknown';
        el.textContent = 'scan time unavailable';
        el.title = 'api.weather.gov did not answer. The picture is still live; ' +
                   'only its age is unknown.';
        return;
      }
      var mins = Math.floor((Date.now() - Date.parse(iso)) / 60000);
      if (isNaN(mins)) { paint(null); return; }
      // A volume scan runs about five minutes, so anything under ten is the
      // normal state of a working radar rather than something to flag.
      var stale = mins >= 20;
      el.className = 'radar-age' + (stale ? ' stale' : '');
      el.textContent = 'last volume scan ' +
        (mins < 1 ? 'less than a minute ago' : fmtAge(mins) + ' ago');
      el.title = 'From the radar station itself (' + stn + '), against your clock. ' +
                 'The loop image is published a little after the scan, so the newest ' +
                 'frame is at least this old.';
    }

    el.className = 'radar-age unknown';
    el.textContent = 'checking scan time…';
    fetch('https://api.weather.gov/radar/stations/' + stn,
          { cache: 'no-store', headers: { Accept: 'application/geo+json' } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) {
        var lat = d && d.properties && d.properties.latency;
        RADAR_SCAN = (lat && lat.levelTwoLastReceivedTime) ||
                     (d.properties.rda && d.properties.rda.timestamp) || null;
        paint(RADAR_SCAN);
      })
      .catch(function () { paint(null); });
  }

  var RADAR_SCAN = null;

  /* Re-rendered on the minute tick without re-asking the API: the scan time
   * does not change between fetches, only its distance from now does. Asking
   * again every minute would be four hundred requests an hour from a page left
   * open at the dock, for a number that moves on its own. */
  function radarAgeTick() {
    var el = document.querySelector('[data-radar-age]');
    if (!el || !RADAR_SCAN) return;
    var mins = Math.floor((Date.now() - Date.parse(RADAR_SCAN)) / 60000);
    if (isNaN(mins)) return;
    el.className = 'radar-age' + (mins >= 20 ? ' stale' : '');
    el.textContent = 'last volume scan ' +
      (mins < 1 ? 'less than a minute ago' : fmtAge(mins) + ' ago');
  }


  /* ------------------------------------------------- §8 model variability
   * Six runs of the same forecast, drawn against each other.
   *
   * The encoding problem here is that twelve lines share one chart — six runs
   * times sustained and gust — and twelve colours would be unreadable and
   * unmappable to a legend. So nothing is encoded in hue:
   *
   *   line style  carries the VARIABLE   solid sustained, dashed gust
   *   opacity     carries RECENCY        newest opaque, oldest at a floor
   *
   * The floor matters. Fading the oldest run to near-invisible would delete
   * the very disagreement this section exists to show — an outlier six hours
   * old is exactly the line a reader needs to see.
   */
  var SPREAD = payload('spread-data');
  var SPREAD_MIN_ALPHA = 0.45;

  /* Viridis, sampled. Perceptually uniform and monotonic in lightness, so it
   * survives greyscale and every common colour-vision deficiency — unlike the
   * red-green ramp that would be the lazy choice for "agreement". Defined here
   * rather than as CSS tokens because it is one ramp used identically in both
   * themes: it reads on the light background and the dark one, which is most
   * of the reason for choosing it. */
  var VIRIDIS = ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#fde725'];

  function viridis(t) {
    if (t === null || t === undefined || t !== t) return null;
    t = Math.max(0, Math.min(1, t));
    var x = t * (VIRIDIS.length - 1), i = Math.floor(x), f = x - i;
    if (i >= VIRIDIS.length - 1) return VIRIDIS[VIRIDIS.length - 1];
    var a = VIRIDIS[i], b = VIRIDIS[i + 1], out = '#';
    for (var k = 1; k < 7; k += 2) {
      var av = parseInt(a.substr(k, 2), 16), bv = parseInt(b.substr(k, 2), 16);
      out += ('0' + Math.round(av + (bv - av) * f).toString(16)).slice(-2);
    }
    return out;
  }

  /* Ink chosen from the FILL, not from the theme.
   *
   * Viridis runs from near-black at one end to bright yellow at the other, so
   * no single text colour can sit on it: light ink on the yellow end measured
   * 1.15:1 here, which is invisible, and 107 of 208 cells were under 4.5:1.
   * These two are contrast partners for the ramp rather than theme colours —
   * a viridis yellow is yellow on a dark page too — so they are fixed, and the
   * choice is made per cell by relative luminance.
   */
  var INK_DARK = '#10161d', INK_LIGHT = '#f2f6fa';

  function relLum(hex) {
    var c = [1, 3, 5].map(function (i) {
      var v = parseInt(hex.substr(i, 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function contrast(a, b) {
    var x = relLum(a), y = relLum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  function inkOn(hex) {
    // Whichever of the two actually wins for THIS fill, not a fixed luminance
    // cut. A cut at 0.36 left the worst cell at 2.37:1; measuring both lifts the
    // floor across the whole ramp to 4.13:1.
    //
    // 4.13 and not higher because the middle of any full-range sequential scale
    // is mid-luminance, which is the worst case for black-or-white text — a
    // narrow teal band around t = 0.45 cannot reach 4.5:1 against either. The
    // numerals are semibold to make up the difference in practice, and the
    // reading is never carried by colour alone: the number is printed in the
    // cell and repeated in its title.
    if (!hex) return 'inherit';
    return contrast(hex, INK_DARK) >= contrast(hex, INK_LIGHT) ? INK_DARK : INK_LIGHT;
  }

  /* The one state that is NOT on the ramp.
   *
   * An hour reached by a single run has no spread — not zero spread, none.
   * Putting it at the bottom of a sequential scale would paint it the same
   * colour as six runs in perfect agreement: the most confident thing this
   * data can say, drawn from the least evidence it has. It gets a neutral
   * hatch instead, which cannot be mistaken for a position on the ramp. */
  function singleFill() { return 'var(--st-note-line)'; }

  function spreadAlpha(i, n) {
    if (n <= 1) return 1;
    return 1 - (1 - SPREAD_MIN_ALPHA) * (i / (n - 1));
  }

  function spreadDom(key) {
    return SPREAD && SPREAD.available && SPREAD.domains ? SPREAD.domains[key] : null;
  }

  function drawSpreadLines(node, key) {
    var d = spreadDom(key);
    if (!d || !d.times.length) return empty(node, 'No runs to compare.');
    var runs = d.runs, n = runs.length;
    var u = prefs.wind, f = WIND[u].f;
    var vals = [];
    runs.forEach(function (r) {
      (r.mean || []).concat(r.gust || []).forEach(function (v) {
        if (num(v)) vals.push(v * f); });
    });
    if (!vals.length) return empty(node, 'No runs to compare.');

    var plotH = 190, yMax = niceMax(Math.max.apply(null, vals) * 1.08);
    var sc = frame(host(node, M.t + plotH + 26), d.times, yMax, plotH,
                   WIND[u].label, 4);
    var svg = node.querySelector('svg');

    // Oldest first, so the newest run is painted last and sits on top of the
    // others rather than under them.
    for (var i = n - 1; i >= 0; i--) {
      var r = runs[i], a = spreadAlpha(i, n);
      [['mean', null], ['gust', '5 3']].forEach(function (spec) {
        var series = r[spec[0]] || [];
        var pts = [];
        for (var k = 0; k < d.times.length; k++) {
          var v = series[k];
          // A run that does not reach this hour breaks the line rather than
          // bridging it — the gap IS the information.
          if (!num(v)) { if (pts.length > 1) flushLine(svg, pts, a, spec[1]); pts = []; continue; }
          pts.push([sc.x(k), sc.y(v * f)]);
        }
        if (pts.length > 1) flushLine(svg, pts, a, spec[1]);
      });
    }

    hoverSpread(node, svg, d, sc, plotH);
    legend(node, [['line', 'solid is sustained, dashed is the gust'],
                  ['dash', 'newest run is fully opaque; older runs fade, never below '
                           + Math.round(SPREAD_MIN_ALPHA * 100) + '%'],
                  ['rule', 'a line stops where its own run stops']]);
  }

  function flushLine(svg, pts, alpha, dash) {
    var at = { d: path(pts), fill: 'none', stroke: css('--chart-line'),
               'stroke-width': 1.6, opacity: alpha };
    if (dash) at['stroke-dasharray'] = dash;
    svg.appendChild(el('path', at));
  }

  /* The same crosshair the other meteograms use, with a tooltip built for this
   * chart: every run that reaches the hovered hour, sustained then gust, newest
   * first, each labelled with its init time. A reader looking at a fan of lines
   * needs to know WHICH run is the outlier, and that is not recoverable from
   * opacity alone. */
  function hoverSpread(node, svg, d, sc, plotH) {
    var u = prefs.wind, f = WIND[u].f, lab = WIND[u].label;
    var guide = el('line', { y1: M.t, y2: M.t + plotH, stroke: css('--chart-axis'),
                             'stroke-width': 1, opacity: 0, 'pointer-events': 'none' });
    svg.appendChild(guide);
    var box = document.createElement('div');
    box.className = 'hov hov-spread';
    box.hidden = true;
    node.appendChild(box);
    var hit = el('rect', { x: M.l, y: M.t, width: W - M.l - M.r, height: plotH,
                           fill: 'none', 'pointer-events': 'all' });
    svg.appendChild(hit);

    var slider = null;

    /* Index-driven, so the slider below can drive the same readout — the same
     * split wireHover got. This chart had the crosshair and no slider, so on a
     * phone the section's own meteogram was the one chart you could not read,
     * sitting under two that you could. */
    function showIndex(i) {
      var r = svg.getBoundingClientRect();
      if (!r.width) return;
      var scale = W / r.width;
      i = Math.max(0, Math.min(d.times.length - 1, i));
      if (slider && +slider.value !== i) slider.value = String(i);
      guide.setAttribute('x1', sc.x(i)); guide.setAttribute('x2', sc.x(i));
      guide.setAttribute('opacity', 0.6);

      /* A row per RUN, always — including the runs that do not reach this
       * hour, which get a dash rather than being dropped.
       *
       * Two reasons, and they are the section's own thesis applied to its
       * readout. Dropping them made the box change height as you dragged the
       * slider, because later hours are covered by fewer runs. And a run that
       * stopped is exactly what this section exists to show: an absent row
       * says nothing, a dashed one says "this run does not go this far".
       */
      function block(title, field) {
        var rows = d.runs.map(function (run, k) {
          var v = (run[field] || [])[i];
          var meta = (SPREAD.runs || [])[k] || {};
          return '<span><i>' + (meta.init_local || '') + '</i>' +
                 (num(v) ? Math.round(v * f) + ' ' + lab
                         : '<em class="hov-none">does not reach</em>') +
                 '</span>';
        });
        return '<b>' + title + '</b>' + rows.join('');
      }
      box.innerHTML = '<div class="hov-t">' + stampOf(d.times[i]) + '</div>' +
                      block('Sustained', 'mean') + block('Max (gust)', 'gust');
      box.hidden = false;
      var bx = svg.getBoundingClientRect(), nb = node.getBoundingClientRect();
      var left = bx.left - nb.left + (sc.x(i) / scale);
      box.style.left = Math.min(Math.max(6, left + 12), nb.width - box.offsetWidth - 6) + 'px';
      box.style.top = '6px';
    }
    function show(ev) {
      var r = svg.getBoundingClientRect();
      if (!r.width) return;
      var scale = W / r.width;
      var px = (ev.clientX - r.left) * scale;
      showIndex(Math.round((px - M.l) /
                ((W - M.l - M.r) / Math.max(1, d.times.length - 1))));
    }

    hit.addEventListener('mousemove', show);
    hit.addEventListener('mouseleave', function () {
      guide.setAttribute('opacity', 0); box.hidden = true; });
    hit.addEventListener('touchmove', function (e) {
      if (e.touches[0]) show(e.touches[0]); }, { passive: true });
    // Same gestures the meteograms free up: the page still scrolls vertically
    // over the plot, and a press-and-hold reads the hour instead of raising the
    // system callout.
    hit.style.touchAction = 'pan-y';
    hit.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'chart-scrub';
    slider.min = '0';
    slider.max = String(Math.max(0, d.times.length - 1));
    slider.step = '1';
    slider.value = '0';
    slider.setAttribute('aria-label', 'Scrub the chart by hour');
    slider.addEventListener('input', function () { showIndex(+slider.value); });
    node.appendChild(slider);

    if (window.matchMedia &&
        matchMedia('(hover:none) and (pointer:coarse)').matches && d.times.length) {
      var fi = fracIndex(d.times, new Date().toISOString());
      if (fi !== null) showIndex(Math.round(fi));
    }
  }

  /* Two strips: one per-hour tick for sustained, one for gust, coloured by how
   * far apart the runs are at that hour. This is the section's headline — the
   * spaghetti shows the shape, the strips show where to look. */
  function drawSpreadStrips(node, key) {
    var d = spreadDom(key);
    if (!d || !d.times.length) { node.textContent = ''; return; }
    var u = prefs.wind, f = WIND[u].f, lab = WIND[u].label;

    /* One scale per VARIABLE, shared across all three domains.
     *
     * Not one scale for both. Sustained spread runs about 0.7 to 7 mph here and
     * gust spread 1.5 to 11, so a single ramp sized for gusts renders the
     * sustained strip as an almost uniform dark band — flattening the variable
     * a rower actually plans around into no signal at all.
     *
     * Sharing it across DOMAINS is kept, and matters: it is what stops a calm
     * basin looking as uncertain as a windy one. Each strip states its own
     * range beside it, so a colour still means a stated number rather than a
     * rank.
     */
    function topFor(which) {
      var all = [];
      Object.keys(SPREAD.domains).forEach(function (k) {
        (SPREAD.domains[k][which] || []).forEach(function (h) {
          if (h && h.spread !== null && h.spread !== undefined) all.push(h.spread * f); });
      });
      return all.length ? Math.max(2, niceMax(Math.max.apply(null, all))) : 2;
    }
    var tops = { sustained: topFor('sustained'), gust: topFor('gust') };

    var html = '';
    [['Sustained', 'sustained'], ['Gust', 'gust']].forEach(function (spec) {
      var top = tops[spec[1]];
      html += '<div class="strip"><span class="strip-lab">' + spec[0] +
              '<span class="strip-range">0\u2013' + Math.round(top) + ' ' + lab +
              '</span></span><div class="strip-row">';
      (d[spec[1]] || []).forEach(function (h, i) {
        var t = stampOf(d.times[i]);
        if (!h || !h.n) {
          html += '<i class="tick tick-none" title="' + t + ' — no run reaches this hour"></i>';
          return;
        }
        if (h.single) {
          html += '<i class="tick tick-single" title="' + t + ' — 1 run only. ' +
                  'A single value has no spread to measure."></i>';
          return;
        }
        var v = h.spread * f;
        html += '<i class="tick" style="background:' + viridis(v / top) + '" title="' +
                t + ' — ' + h.n + ' runs, ' + v.toFixed(1) + ' ' + lab + ' apart (' +
                Math.round(h.lo * f) + '–' + Math.round(h.hi * f) + ')"></i>';
      });
      html += '</div></div>';
    });

    html += '<div class="strip-key"><span class="strip-ramp" style="background:linear-gradient(90deg,' +
            VIRIDIS.join(',') + ')"></span>' +
            '<span class="muted">how far apart the runs are, over its own range above</span>' +
            '<span class="strip-swatch"><i class="tick tick-single"></i>one run only — ' +
            'no spread to measure</span>' +
            '<span class="strip-swatch"><i class="tick tick-none"></i>no run reaches it</span></div>';
    node.innerHTML = html;
  }

  /* Runs down, hours across. Value as text AND a magnitude fill, because the
   * text is what you read and the fill is what you scan. Cells past a run's own
   * reach are simply absent — that alone shows the sample-size dropoff without
   * a second encoding for it. */
  function drawSpreadValues(node, key) {
    var d = spreadDom(key);
    if (!d || !d.times.length) { node.textContent = ''; return; }
    var u = prefs.wind, f = WIND[u].f, lab = WIND[u].label;

    var mx = 0;
    Object.keys(SPREAD.domains).forEach(function (k) {
      (SPREAD.domains[k].runs || []).forEach(function (r) {
        (r.mean || []).concat(r.gust || []).forEach(function (v) {
          if (num(v)) mx = Math.max(mx, v * f); });
      });
    });
    mx = Math.max(mx, 1);

    var html = '';
    [['Sustained', 'mean'], ['Max (gust)', 'gust']].forEach(function (spec) {
      html += '<div class="grid-title">' + spec[0] + ' (' + lab + ')' +
              '<span class="grid-key"><span class="strip-ramp" style="background:' +
              'linear-gradient(90deg,' + VIRIDIS.join(',') + ')"></span>' +
              '0\u2013' + Math.round(mx) + ' ' + lab + '</span>' +
              (PAGE_TZ ? '<span class="grid-tz">hours in ' + PAGE_TZ + '</span>' : '') +
              '</div>' +
              '<div class="gridwrap"><table class="spreadtab"><thead><tr><th>Run</th>';
      d.times.forEach(function (t) {
        html += '<th>' + hhShort(t) + '</th>'; });
      html += '</tr></thead><tbody>';
      d.runs.forEach(function (r, k) {
        var meta = (SPREAD.runs || [])[k] || {};
        html += '<tr><th class="runhead">' + (meta.init_local || '') +
                '<span class="cell-sub">' + (meta.init_utc_label || '') + '</span></th>';
        (r[spec[1]] || []).forEach(function (v, i) {
          if (!num(v)) { html += '<td class="cell-out"></td>'; return; }
          var s = v * f, fill = viridis(s / mx);
          html += '<td style="background:' + fill + ';color:' + inkOn(fill) +
                  '" title="' + stampOf(d.times[i]) + '">' + Math.round(s) + '</td>';
        });
        html += '</tr>';
      });
      html += '</tbody></table></div>';
    });
    node.innerHTML = html;
  }

  /* Direction, same layout, plus one alignment row underneath.
   *
   * The arrows use the page's convention without exception: they fly WITH the
   * wind, pointing the way the air is moving, while the table states the
   * direction it comes from. The alignment row is the
   * mean resultant length R computed across the runs' domain-mean directions
   * at that hour — the same helper §7 uses across grid cells within one run,
   * called with a different input set. */
  function drawSpreadDirs(node, key) {
    var d = spreadDom(key);
    if (!d || !d.times.length) { node.textContent = ''; return; }

    var html = '<div class="grid-title">Direction' +
               (PAGE_TZ ? '<span class="grid-tz">hours in ' + PAGE_TZ + '</span>' : '') +
               '</div>' +
               '<div class="gridwrap"><table class="spreadtab spreadtab-dir">' +
               '<thead><tr><th>Run</th>';
    d.times.forEach(function (t) { html += '<th>' + hhShort(t) + '</th>'; });
    html += '</tr></thead><tbody>';
    d.runs.forEach(function (r, k) {
      var meta = (SPREAD.runs || [])[k] || {};
      html += '<tr><th class="runhead">' + (meta.init_local || '') +
              '<span class="cell-sub">' + (meta.init_utc_label || '') + '</span></th>';
      (r.dir || []).forEach(function (v, i) {
        if (!num(v)) { html += '<td class="cell-out"></td>'; return; }
        html += '<td title="' + stampOf(d.times[i]) + ' — from ' + Math.round(v) +
                '° (' + POINT16[Math.round((v % 360) / 22.5) % 16] + ')">' +
                arrowSvg(v, 1) + '</td>';
      });
      html += '</tr>';
    });

    html += '</tbody><tfoot><tr><th class="runhead">Agreement' +
            '<span class="cell-sub">across runs</span></th>';
    (d.alignment || []).forEach(function (a, i) {
      var t = stampOf(d.times[i]);
      if (!a || !a.n) { html += '<td class="cell-out"></td>'; return; }
      if (a.single) {
        html += '<td class="cell-single" title="' + t + ' — 1 run only. One direction ' +
                'always has R = 1; that is arithmetic, not agreement."><i class="tick ' +
                'tick-single"></i></td>';
        return;
      }
      // Arrow AND a number. The opacity alone is the same signal §7 uses for its
      // spatial arrows and is fine as a glance cue, but it cannot be read to a
      // value — and the value here is small and interesting: these runs usually
      // agree within about ten degrees, and the hours where they do not are the
      // ones worth seeing.
      html += '<td title="' + t + ' — ' + a.n + ' runs' +
              (a.dir !== null ? ', mean from ' + Math.round(a.dir) + '\u00b0' : '') +
              ', agreeing within \u00b1' + a.sd_deg + '\u00b0 (R = ' + a.r.toFixed(2) +
              ')">' + arrowSvg(a.dir, a.r) +
              // The degree sign in its own span so a phone can drop it. The
              // cell holds an arrow AND a number in a 12 px column there, and
              // the unit is already stated by the row's own label.
              '<span class="align-sd"><span class="pm">\u00b1</span>' + a.sd_deg +
              '<span class="deg">\u00b0</span></span></td>';
    });
    html += '</tr></tfoot></table></div>';
    node.innerHTML = html;
  }

  /* One arrow, opacity carrying R — faint when the runs disagree, exactly as
   * §7 draws its spatial arrows.
   *
   * Rotated by the bearing PLUS 180, so it flies WITH the wind, pointing the
   * way the air is moving, as on every weather map. `deg` is the direction the
   * wind comes from, which is how a forecast is spoken and how the tables
   * state it; the two are the same fact 180 degrees apart. This comment used
   * to describe the opposite convention from the one the line below it draws —
   * the last survivor of a bug fixed everywhere else on the page. */
  function arrowSvg(deg, r) {
    if (deg === null || deg === undefined) return '';
    var op = Math.max(0.25, Math.min(1, r === undefined ? 1 : r));
    return '<svg class="dirarrow" viewBox="0 0 16 16" aria-hidden="true">' +
           '<g transform="rotate(' + (deg + 180) + ' 8 8)" opacity="' + op + '">' +
           '<path d="M8 2 L8 14 M8 2 L5 6 M8 2 L11 6" fill="none" ' +
           'stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></g></svg>';
  }

  /* Through formatTime, like every other clock on this page.
   *
   * This sliced the ISO string, so §8's matrix headers stayed on 24-hour time
   * while the toggle moved everything else — the one place on the page where
   * the control silently did nothing. */
  /* An hour column header, at the width a column of two-digit numbers deserves.
   *
   * These matrices are 22 hours wide and were sized by their HEADERS, not by
   * their data: "11:00 am" is eight characters over cells holding "12", and
   * that alone pushed a table to 1453 px inside a 1134 px column — so the last
   * few hours of every run sat off the right edge of a DESKTOP window, not
   * only a phone.
   *
   * The minutes are always :00 on an hourly axis and consecutive columns make
   * the sequence obvious, so the hour and a meridiem letter carry it. Each
   * cell still holds the full stamp in its title, and the strip is labelled
   * with its zone once, above. Follows the 12/24-hour toggle like every other
   * time on this page. */
  function hhShort(iso) {
    var hhmm = String(iso).slice(11, 16);
    var h = +hhmm.slice(0, 2);
    // '24', not '24h' — the same token formatTime tests and the toggle stores.
    if (prefs.time === '24') return '<span class="hh">' + String(h).padStart(2, '0') + '</span>';
    var t = h % 12; if (!t) t = 12;
    // Wrapped in a span so the phone layout can rotate THAT rather than the
    // table cell. `writing-mode` on a <th> inside table-layout:fixed is the
    // most fragile construct on this page across engines — a cell's block
    // direction is entangled with table box layout, and WebKit has never
    // agreed with Blink about it. On an inline-block span it is ordinary.
    //
    // The meridiem is set smaller than the hour: it is a qualifier rather than
    // part of the number, and at full size a three-character header ("12p")
    // needed 17 px in a 12 px column — so the letter was what got clipped,
    // which is the one character that changes the meaning.
    return '<span class="hh">' + t +
           '<span class="mer">' + (h < 12 ? 'a' : 'p') + '</span></span>';
  }

  function wireSpread() {
    if (!SPREAD || !SPREAD.available) return;
    document.querySelectorAll('[data-spread]').forEach(function (node) {
      if (node.offsetParent === null) return;      // hidden tab: drawn on reveal
      var key = node.getAttribute('data-domain');
      var kind = node.getAttribute('data-spread');
      if (kind === 'lines') drawSpreadLines(node, key);
      else if (kind === 'strips') drawSpreadStrips(node, key);
      else if (kind === 'values') drawSpreadValues(node, key);
      else if (kind === 'dirs') drawSpreadDirs(node, key);
    });
  }

  /* Traffic cameras. These are third-party feeds that hiccup — one of the four
   * failed on a page load while the identical URL fetched fine from a script a
   * second later, which is what a rate-limited or briefly-overloaded agency
   * server looks like. A single transient failure should not leave a camera
   * showing "not responding" for the whole visit, so each one gets exactly one
   * retry with a fresh cache-buster before giving up.
   *
   * One retry, not a loop: if the feed is genuinely down, hammering it is both
   * rude and useless, and the honest fallback is to say so.
   */
  /* A camera whose current frame has to be asked for first.
   *
   * The UW roof camera writes a new timestamped path per frame and publishes
   * the current one as plain text from latest.php, which sends
   * Access-Control-Allow-Origin *. Resolving it HERE rather than at build time
   * is the same rule every other camera on this page follows: the frame is
   * current when it is looked at, not when the page was assembled.
   *
   * The resolver is cached hard by the server (max-age two days), so the
   * request carries a cache-buster of its own — without one the browser would
   * answer from cache and pin the picture to whatever frame was current on the
   * first visit, which is exactly the failure this avoids.
   */
  function resolveCamera(img) {
    var url = img.getAttribute('data-resolve');
    var base = img.getAttribute('data-resolve-base') || '';
    fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + '_=' + Date.now(),
          { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
      .then(function (path) {
        path = (path || '').trim();
        // The endpoint answers with a relative path and nothing else. Anything
        // containing markup or a scheme is an error page or a redirect notice,
        // not a frame, and must not be assigned as a src.
        if (!path || path.length > 300 || /[<>\s]/.test(path) || /^[a-z]+:/i.test(path)) {
          return Promise.reject('unexpected response');
        }
        img.setAttribute('data-bare', base + path);
        img.src = base + path;
      })
      .catch(function () {
        var fig = img.closest('.cam');
        if (fig) fig.classList.add('cam-down');
      });
  }

  function wireCameras() {
    document.querySelectorAll('.cam-img[data-resolve]').forEach(resolveCamera);
    document.querySelectorAll('.cam-img').forEach(function (img) {
      var retried = false;
      img.addEventListener('error', function () {
        if (!retried && img.getAttribute('data-bare')) {
          retried = true;
          setTimeout(function () {
            img.src = img.getAttribute('data-bare') + '?r=' + Date.now();
          }, 1200);
          return;
        }
        var fig = img.closest('.cam');
        if (fig) fig.classList.add('cam-down');
      });
      // An image that already failed before this script ran (cached error, or a
      // load that completed during parse) fires no further event, so the
      // finished-but-empty case is checked directly.
      if (img.complete && img.naturalWidth === 0 && !img.hasAttribute('data-resolve')) {
        img.dispatchEvent(new Event('error'));
      }
    });
  }

  /* The radar loop is the one thing on this page that must be current when it is
   * LOOKED at rather than when it was built — a page built at 05:00 and read at
   * noon would otherwise show seven-hour-old echoes with no hint that they were
   * stale. So the URL is emitted bare and gets a cache-buster here, at load,
   * plus a Refresh control for a reader watching a band come in.
   *
   * Same one-retry courtesy as the cameras: a transient failure should not leave
   * a permanent "not responding", and a real outage should not be hammered.
   */
  function wireRadar() {
    document.querySelectorAll('.radarimg').forEach(function (img) {
      var bare = img.getAttribute('data-bare');
      var retried = false;

      function load() {
        retried = false;
        img.src = bare + (bare.indexOf('?') < 0 ? '?' : '&') + '_=' + Date.now();
      }

      img.addEventListener('error', function () {
        if (!retried) { retried = true; setTimeout(load, 1500); return; }
        var fig = img.closest('.radarfig');
        if (fig) fig.classList.add('radar-down');
      });
      load();
    });

    document.querySelectorAll('[data-radar-refresh]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.radarimg').forEach(function (img) {
          var bare = img.getAttribute('data-bare');
          img.closest('.radarfig').classList.remove('radar-down');
          img.src = bare + (bare.indexOf('?') < 0 ? '?' : '&') + '_=' + Date.now();
        });
        // Re-ask for the scan time too. Refreshing the picture and leaving the
        // age showing the previous scan is the one combination guaranteed to
        // mislead — a fresh frame labelled with a stale time.
        radarAge();
      });
    });
  }

  /* §8's reflectivity loop.
   *
   * Frames are stacked in the DOM and revealed one at a time; stepping is a
   * class swap, so a full pass costs no decoding after the first. The scrubber
   * is the state — play just advances it — which keeps one source of truth
   * instead of a play head and a slider position that can disagree.
   *
   * It does NOT autoplay. Motion that starts on its own is a problem for
   * vestibular sensitivity and for anyone who scrolled past to read the text
   * under it, and the first frame is the useful one anyway: that is now.
   */
  function wireRefc() {
    var box = document.querySelector('.refc');
    if (!box) return;
    var frames = [].slice.call(box.querySelectorAll('.refc-frame'));
    var play = document.querySelector('[data-refc-play]');
    var scrub = document.querySelector('[data-refc-scrub]');
    var label = document.querySelector('[data-refc-label]');
    if (!frames.length || !scrub) return;

    var at = 0, timer = null;
    var STEP_MS = 420;      // one frame
    var WRAP_MS = 1100;     // the pause on the last frame before it comes round

    // Which frame is closest to the reader's own clock. The loop opens here
    // rather than at frame 1: the oldest frame is the least interesting thing
    // on the strip, and a reader who presses nothing should still be looking at
    // now. Recomputed on each label rather than cached, so the "now" tag stays
    // truthful on a page left open — the frames themselves never move.
    function nowIndex() {
      var t = Date.now(), best = -1, gap = Infinity;
      frames.forEach(function (f, k) {
        var v = Date.parse(f.getAttribute('data-valid') || '');
        if (isNaN(v)) return;
        var d = Math.abs(v - t);
        if (d < gap) { gap = d; best = k; }
      });
      // Half an hour either side of an hourly frame is that frame's hour.
      return { at: best < 0 ? 0 : best, near: gap <= 30 * 60 * 1000 };
    }

    function show(i) {
      at = ((i % frames.length) + frames.length) % frames.length;
      frames.forEach(function (f, k) { f.classList.toggle('on', k === at); });
      scrub.value = String(at);
      if (label) {
        var f = frames[at];
        // The clock follows the 12/24-hour toggle like every other time here;
        // the frames carry canonical HH:MM in an attribute for exactly this.
        var n = nowIndex();
        label.textContent = f.getAttribute('data-day') + ' ' +
          formatTime(f.getAttribute('data-hhmm'), prefs.time) + tzSuffix() +
          '  (+' + f.getAttribute('data-fhr') + ' h)' +
          (n.near && at === n.at ? '  \u00b7 now' : '');
      }
    }

    /* Stopping is separate from what is left on screen, because the two have
     * different right answers. `stop` only halts the timer — the scrubber uses
     * it to take manual control and must stay on the frame the reader dragged
     * to. Pausing is the other case, and there the still image goes back to
     * now: this is a briefing, and the picture it rests on should be the
     * weather at the reader's own clock rather than wherever the animation
     * happened to be interrupted. */
    function stop() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (play) { play.textContent = 'Play'; play.setAttribute('aria-label', 'Play the loop'); }
    }

    function pause() {
      stop();
      show(nowIndex().at);
    }

    /* Runs until it is paused.
     *
     * It used to play through once and stop — and it stopped on frame ZERO,
     * the oldest frame in the run, which is the one thing on the strip nobody
     * wants to be left looking at. A loop that has to be re-pressed to see
     * again is also the wrong shape for reading a squall line: you watch a
     * radar loop several times round.
     *
     * setTimeout rather than setInterval so the wrap can hold longer than a
     * frame. Without that beat the last frame and the first are
     * indistinguishable in motion, and a loop that restarts invisibly reads as
     * weather jumping backwards.
     */
    function start() {
      if (timer) return;
      function tick() {
        var last = at === frames.length - 1;
        show(at + 1);
        timer = setTimeout(tick, last ? WRAP_MS : STEP_MS);
      }
      timer = setTimeout(tick, STEP_MS);
      if (play) { play.textContent = 'Pause'; play.setAttribute('aria-label', 'Pause the loop'); }
    }

    if (play) play.addEventListener('click', function () { timer ? pause() : start(); });
    scrub.addEventListener('input', function () { stop(); show(+scrub.value); });
    show(nowIndex().at);

    // The clock format can change while a frame is on screen; re-label in place
    // rather than leaving one stale time among a page of converted ones.
    document.querySelectorAll('[data-time-fmt]').forEach(function (b) {
      b.addEventListener('click', function () { setTimeout(function () { show(at); }, 0); });
    });
  }

  // ----------------------------------------------------------------- init
  applyUnits();
  applyTimes();
  applyAges();
  wireTheme();
  applyCompact();
  wireCompact();
  wireOverdue();
  wireForecastCheck();
  wireJumpMenu();
  wireUnits();
  wireTabs();
  wireDisclosures();
  wireCameras();
  wirePlan();
  radarAge();
  wireRadar();
  wireRefc();
  drawAll();
  wireSpread();
  // Charts are laid out in a viewBox, so they scale without a redraw; the redraw
  // on resize is for the time-label density, which does depend on real width.
  var t = null;
  window.addEventListener('resize', function () {
    clearTimeout(t); t = setTimeout(drawAll, 150);
  });
  // Left open at the dock, a page should not go on insisting the reading is
  // twenty minutes old an hour later — nor keep the current-hour band on the
  // hour the page happened to load.
  refreshLightningModel();
  setInterval(function () { applyAges(); refreshNowBands(); radarAgeTick();
                            refreshLightningModel(); }, 60000);
})();
