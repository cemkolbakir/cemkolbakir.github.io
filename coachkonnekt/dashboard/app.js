/* CoachKonnekt private dashboard.
   Pages (hash routes):  #/  overview   #/team/<slug>  team board   #/athlete/<id>  athlete page
   Data is protected by Supabase Row Level Security: only emails listed in the staff table can read it. */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://qecbwvgftefrgeqghokr.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_bJ2cXZMoK5esEOLOSzb0yw_ZcCCXehk';
  var INVITE_URL = 'https://kolbakir.com/coachkonnekt/connect/?invite=';
  var TZ = 'Europe/Istanbul';
  var HISTORY_DAYS = 35;

  var RESET_URL = 'https://kolbakir.com/coachkonnekt/dashboard/?reset=1';
  // Arriving from a password-reset email? (Read before Supabase tidies up the address bar.)
  var linkError = /error_code=([a-z_]+)/.exec(location.hash);
  var recovering = /type=recovery/.test(location.hash) || /[?&]reset=1/.test(location.search);

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true } });
  var app = document.getElementById('app');
  var nav = document.getElementById('nav');
  var who = document.getElementById('who');
  var state = { session: null, role: null, staffName: null, teams: [], athletes: [] };

  // ------------------------------------------------------------ helpers
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fullName(a) { return ((a.first_name || '') + ' ' + (a.last_name || '')).trim() || 'Unnamed athlete'; }
  function zone(v) { return v == null ? 'none' : v >= 67 ? 'green' : v >= 34 ? 'yellow' : 'red'; }
  function zoneHex(v) { return { green: '#3ddc84', yellow: '#f5c542', red: '#ff4d5e', none: '#5b646b' }[zone(v)]; }
  function round(v, d) { if (v == null || isNaN(v)) return null; var m = Math.pow(10, d || 0); return Math.round(v * m) / m; }
  function avg(arr) { var x = arr.filter(function (v) { return v != null && !isNaN(v); }); return x.length ? x.reduce(function (s, v) { return s + v; }, 0) / x.length : null; }
  function hm(ms) { if (ms == null) return '–'; var m = Math.round(ms / 60000); return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'; }
  function dayKey(iso) { return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }); } // YYYY-MM-DD
  function fmtDay(iso) { return new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' }); }
  function fmtTime(iso) { return new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }); }
  function ago(iso) {
    if (!iso) return 'never';
    var h = (Date.now() - Date.parse(iso)) / 3600000;
    if (h < 1) return Math.max(1, Math.round(h * 60)) + ' min ago';
    if (h < 24) return Math.round(h) + ' h ago';
    return Math.round(h / 24) + ' days ago';
  }
  function relDay(iso) {
    var k = dayKey(iso), today = dayKey(new Date().toISOString()), y = dayKey(new Date(Date.now() - 864e5).toISOString());
    return k === today ? 'today' : k === y ? 'yesterday' : fmtDay(iso);
  }
  function sinceISO(days) { return new Date(Date.now() - days * 864e5).toISOString(); }

  async function fetchAll(make) {
    var out = [], from = 0;
    for (;;) {
      var res = await make().range(from, from + 999);
      if (res.error) throw res.error;
      out = out.concat(res.data || []);
      if (!res.data || res.data.length < 1000) return out;
      from += 1000;
    }
  }
  function byAthlete(rows) { var m = {}; rows.forEach(function (r) { (m[r.athlete_id] = m[r.athlete_id] || []).push(r); }); return m; }

  // ------------------------------------------------------------ metrics
  // Everything the boards show for one athlete, from their recent rows.
  function summarize(a, rec, slp, cyc) {
    rec = (rec || []).filter(function (r) { return r.score_state === 'SCORED' && r.recovery_score != null; })
      .sort(function (x, y) { return Date.parse(y.created_at) - Date.parse(x.created_at); });
    slp = (slp || []).filter(function (s) { return !s.nap && s.total_sleep_milli != null; })
      .sort(function (x, y) { return Date.parse(y.end_time || y.start_time) - Date.parse(x.end_time || x.start_time); });
    cyc = (cyc || []).filter(function (c) { return c.end_time && c.strain != null; })
      .sort(function (x, y) { return Date.parse(y.start_time) - Date.parse(x.start_time); });
    var last = rec[0] || null;
    var base = avg(rec.slice(1, 8).map(function (r) { return r.hrv_rmssd_milli; }));
    var hrvDelta = last && base ? (last.hrv_rmssd_milli - base) / base : null;
    var s = {
      athlete: a,
      recovery: last ? round(last.recovery_score) : null,
      recoveryAt: last ? last.created_at : null,
      hrv: last ? round(last.hrv_rmssd_milli) : null,
      hrvDelta: hrvDelta,
      rhr: last ? round(last.resting_heart_rate) : null,
      sleepMs: slp[0] ? slp[0].total_sleep_milli : null,
      sleepPerf: slp[0] ? round(slp[0].sleep_performance_percentage) : null,
      strain: cyc[0] ? round(cyc[0].strain, 1) : null,
      spark: rec.slice(0, 7).reverse().map(function (r) { return r.recovery_score; }),
      flags: []
    };
    var name = fullName(a);
    if (!a.connected) s.flags.push({ kind: 'sync', t: name, m: 'Disconnected from WHOOP. Send them a new invite link to reconnect.' });
    else if (!a.last_sync_at || Date.now() - Date.parse(a.last_sync_at) > 36 * 3600000) s.flags.push({ kind: 'sync', t: name, m: 'Last synced ' + ago(a.last_sync_at) });
    if (s.recovery != null && s.recovery < 34) s.flags.push({ kind: 'red', t: name, m: 'Recovery ' + s.recovery + '% (' + relDay(s.recoveryAt) + '). Keep training light.' });
    if (hrvDelta != null && hrvDelta < -0.15) s.flags.push({ kind: 'hrv', t: name, m: 'HRV ' + Math.round(-hrvDelta * 100) + '% below their 7-day average' });
    if (s.sleepMs != null && s.sleepMs < 6.5 * 3600000) s.flags.push({ kind: 'sleep', t: name, m: 'Only ' + hm(s.sleepMs) + ' of sleep' });
    return s;
  }

  // ------------------------------------------------------------ charts (plain SVG)
  function spark(values) {
    if (!values.length) return '<span class="muted">–</span>';
    var w = 96, h = 28, n = values.length;
    var pts = values.map(function (v, i) { return [n === 1 ? w / 2 : i / (n - 1) * (w - 6) + 3, h - 3 - (v / 100) * (h - 6)]; });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var last = pts[pts.length - 1];
    return '<svg width="96" height="28" viewBox="0 0 96 28" aria-hidden="true"><path d="' + d + '" fill="none" stroke="' + zoneHex(values[n - 1]) + '" stroke-width="1.75" stroke-linejoin="round"/><circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.5" fill="' + zoneHex(values[n - 1]) + '"/></svg>';
  }

  // Bars per day (0–100 recovery, coloured by zone), optional line on a second axis.
  function barChart(days, opts) {
    var W = 760, H = 240, L = 34, R = opts.line ? 40 : 10, T = 10, B = 26;
    var iw = W - L - R, ih = H - T - B, n = days.length, bw = iw / Math.max(n, 1);
    var maxBar = opts.barMax || 100;
    var lineVals = opts.line ? days.map(function (d) { return d.line; }).filter(function (v) { return v != null; }) : [];
    var lineMax = lineVals.length ? Math.max.apply(null, lineVals) * 1.15 : 1;
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label) + '">';
    [0, 0.5, 1].forEach(function (f) {
      var y = T + ih - f * ih;
      out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="#3a4248" stroke-dasharray="3 4"/>';
      out += '<text class="axis" x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + Math.round(f * maxBar) + (opts.barUnit || '') + '</text>';
      if (opts.line) out += '<text class="axis" x="' + (W - R + 6) + '" y="' + (y + 4) + '">' + Math.round(f * lineMax) + '</text>';
    });
    days.forEach(function (d, i) {
      if (d.bar == null) return;
      var h = Math.max(2, Math.min(1, d.bar / maxBar) * ih), x = L + i * bw + bw * 0.15;
      var col = opts.barColor || zoneHex(d.bar);
      out += '<rect x="' + x.toFixed(1) + '" y="' + (T + ih - h).toFixed(1) + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="' + col + '"><title>' + esc(d.title) + '</title></rect>';
    });
    if (opts.line) {
      var p = [];
      days.forEach(function (d, i) { if (d.line != null) p.push([L + i * bw + bw / 2, T + ih - (d.line / lineMax) * ih]); });
      if (p.length > 1) out += '<path d="' + p.map(function (q, i) { return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join(' ') + '" fill="none" stroke="' + opts.lineColor + '" stroke-width="2" stroke-dasharray="' + (opts.lineDash || '') + '"/>';
      p.forEach(function (q) { out += '<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="2.5" fill="' + opts.lineColor + '"/>'; });
    }
    var step = Math.ceil(n / 6);
    days.forEach(function (d, i) {
      if (i % step === 0 || i === n - 1) out += '<text class="axis" x="' + (L + i * bw + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(d.label) + '</text>';
    });
    return out + '</svg>';
  }
  function lastNDays(n) {
    var out = [];
    for (var i = n - 1; i >= 0; i--) { var iso = new Date(Date.now() - i * 864e5).toISOString(); out.push({ key: dayKey(iso), label: fmtDay(iso) }); }
    return out;
  }

  // ------------------------------------------------------------ auth
  async function boot() {
    var res = await sb.auth.getSession();
    state.session = res.data.session;
    sb.auth.onAuthStateChange(function (event, session) {
      var was = !!state.session; state.session = session;
      if (event === 'PASSWORD_RECOVERY') { recovering = true; route(); return; }
      if (was !== !!session) { state.role = null; route(); }
    });
    if (linkError) {
      recovering = false;
      history.replaceState(null, '', location.pathname);
      return renderLogin(linkError[1] === 'otp_expired' ? 'That reset link has expired or was already used. Request a new one below.' : 'That reset link did not work. Request a new one below.');
    }
    window.addEventListener('hashchange', route);
    route();
  }

  function renderLogin(msg) {
    nav.hidden = true; who.hidden = true;
    app.innerHTML =
      '<div class="login"><p class="kicker">Private</p><h1>Coach login</h1>' +
      '<p class="sub">For CoachKonnekt staff only.</p>' +
      '<form id="lf"><label>Email<input type="email" id="em" autocomplete="username" required></label>' +
      '<label>Password<input type="password" id="pw" autocomplete="current-password" required></label>' +
      '<button class="btn" id="go" type="submit">Log in</button>' +
      '<p class="err small" id="lerr" role="alert">' + esc(msg || '') + '</p>' +
      '<p class="small" style="margin:0"><a href="#" id="forgot" class="muted">Forgot your password?</a></p></form></div>';
    document.getElementById('forgot').addEventListener('click', function (e) { e.preventDefault(); renderForgot(document.getElementById('em').value.trim()); });
    document.getElementById('lf').addEventListener('submit', async function (e) {
      e.preventDefault();
      var b = document.getElementById('go'); b.disabled = true; b.textContent = 'Logging in…';
      var r = await sb.auth.signInWithPassword({ email: document.getElementById('em').value.trim(), password: document.getElementById('pw').value });
      if (r.error) { b.disabled = false; b.textContent = 'Log in'; document.getElementById('lerr').textContent = 'Wrong email or password.'; }
    });
  }

  function renderForgot(prefill) {
    nav.hidden = true; who.hidden = true;
    app.innerHTML =
      '<div class="login"><p class="kicker">Private</p><h1>Reset password</h1>' +
      '<p class="sub">Enter your staff email. We will send you a link to choose a new password.</p>' +
      '<form id="ff"><label>Email<input type="email" id="fem" autocomplete="username" required value="' + esc(prefill || '') + '"></label>' +
      '<button class="btn" id="fgo" type="submit">Send reset link</button>' +
      '<p class="small" id="fmsg" role="status"></p>' +
      '<p class="small" style="margin:0"><a href="#" id="back" class="muted">← Back to login</a></p></form></div>';
    document.getElementById('back').addEventListener('click', function (e) { e.preventDefault(); renderLogin(); });
    document.getElementById('ff').addEventListener('submit', async function (e) {
      e.preventDefault();
      var b = document.getElementById('fgo'), m = document.getElementById('fmsg');
      b.disabled = true; b.textContent = 'Sending…';
      var r = await sb.auth.resetPasswordForEmail(document.getElementById('fem').value.trim(), { redirectTo: RESET_URL });
      b.disabled = false; b.textContent = 'Send reset link';
      if (r.error && /rate|seconds/i.test(r.error.message)) { m.className = 'small err'; m.textContent = 'Too many requests. Please wait a minute and try again.'; return; }
      // Same answer whether or not the email has an account, so nobody can probe for staff emails.
      m.className = 'small z-green';
      m.textContent = 'If that email belongs to a staff account, a reset link is on its way. Check your inbox and spam folder.';
    });
  }

  async function ensureStaff() {
    if (state.role) return true;
    var r = await sb.rpc('staff_role');
    if (r.error || !r.data) {
      await sb.auth.signOut();
      renderLogin('This account does not have access to the dashboard.');
      return false;
    }
    state.role = r.data;
    var email = state.session.user.email;
    var st = await sb.from('staff').select('name').eq('email', email.toLowerCase()).maybeSingle();
    state.staffName = st.data && st.data.name;
    var t = await sb.from('teams').select('id,name,slug,sort').order('sort');
    if (t.error) throw t.error;
    state.teams = t.data;
    who.innerHTML = '<span class="email">' + esc(state.staffName || email) + '</span><span class="role">' + esc(state.role) + '</span><a class="linkbtn" href="#/account" style="text-decoration:none">Password</a><button class="linkbtn" id="out">Log out</button>';
    who.hidden = false;
    document.getElementById('out').onclick = function () { sb.auth.signOut(); };
    return true;
  }

  function renderNav(active) {
    nav.innerHTML = '<a href="#/" class="' + (active === 'home' ? 'on' : '') + '">Overview</a>' +
      state.teams.map(function (t) { return '<a href="#/team/' + esc(t.slug) + '" class="' + (active === t.slug ? 'on' : '') + '">' + esc(t.name) + '</a>'; }).join('');
    nav.hidden = false;
  }

  async function loadAthletes() {
    var r = await sb.from('athletes').select('id,first_name,last_name,email,team_id,connected,connected_at,last_sync_at,last_sync_error').order('first_name');
    if (r.error) throw r.error;
    state.athletes = r.data;
    return r.data;
  }

  async function loadHistory(ids, days, withWorkouts) {
    if (!ids.length) return { rec: {}, slp: {}, cyc: {}, wk: {} };
    var since = sinceISO(days);
    var jobs = [
      fetchAll(function () { return sb.from('recoveries').select('athlete_id,cycle_id,created_at,score_state,recovery_score,hrv_rmssd_milli,resting_heart_rate').in('athlete_id', ids).gte('created_at', since).order('created_at'); }),
      fetchAll(function () { return sb.from('sleeps').select('athlete_id,start_time,end_time,nap,score_state,sleep_performance_percentage,total_sleep_milli,total_in_bed_milli').in('athlete_id', ids).gte('start_time', since).order('start_time'); }),
      fetchAll(function () { return sb.from('cycles').select('athlete_id,start_time,end_time,score_state,strain').in('athlete_id', ids).gte('start_time', since).order('start_time'); })
    ];
    if (withWorkouts) jobs.push(fetchAll(function () { return sb.from('workouts').select('athlete_id,start_time,end_time,sport_name,score_state,strain,average_heart_rate,max_heart_rate').in('athlete_id', ids).gte('start_time', since).order('start_time', { ascending: false }); }));
    var res = await Promise.all(jobs);
    return { rec: byAthlete(res[0]), slp: byAthlete(res[1]), cyc: byAthlete(res[2]), wk: byAthlete(res[3] || []) };
  }

  // ------------------------------------------------------------ pages
  async function route() {
    if (!state.session) return renderLogin();
    try {
      if (recovering) return accountPage(true);
      if (!(await ensureStaff())) return;
      var h = location.hash.replace(/^#\/?/, '').split('/');
      if (h[0] === 'team' && h[1]) return await teamPage(h[1]);
      if (h[0] === 'athlete' && h[1]) return await athletePage(h[1]);
      if (h[0] === 'account') return accountPage();
      return await homePage();
    } catch (e) {
      console.error(e);
      app.innerHTML = '<div class="panel"><h2>Could not load data</h2><p class="err">' + esc(e.message || e) + '</p><p class="muted small">Refresh the page. If it keeps happening, check the Supabase setup.</p></div>';
    }
  }

  async function homePage() {
    renderNav('home');
    app.innerHTML = '<p class="loading">Loading teams…</p>';
    var athletes = await loadAthletes();
    var hist = await loadHistory(athletes.map(function (a) { return a.id; }), 10, false);
    var html = '<div class="head"><div><p class="kicker">Overview</p><h1>Hello' + (state.staffName ? ', ' + esc(state.staffName.split(' ')[0]) : '') + '</h1><p class="sub">Choose a team board.</p></div></div><div class="teamcards">';
    state.teams.forEach(function (t) {
      var list = athletes.filter(function (a) { return a.team_id === t.id; });
      var sums = list.map(function (a) { return summarize(a, hist.rec[a.id], hist.slp[a.id], hist.cyc[a.id]); });
      var rec = avg(sums.map(function (s) { return s.recovery; }));
      var flagged = sums.filter(function (s) { return s.flags.length; }).length;
      html += '<a class="panel teamcard" href="#/team/' + esc(t.slug) + '"><p class="kicker">Team board</p><h2>' + esc(t.name) + '</h2>' +
        '<div class="row"><span><b>' + list.length + '</b> <span class="muted">athletes</span></span>' +
        '<span class="z-' + zone(rec) + '"><span class="dot"></span><b>' + (rec == null ? '–' : Math.round(rec) + '%') + '</b> <span class="muted">avg recovery</span></span>' +
        '<span><b class="' + (flagged ? 'z-red' : '') + '">' + flagged + '</b> <span class="muted">need attention</span></span></div></a>';
    });
    html += '</div>';
    if (state.role === 'owner') html += ownerPanel(athletes);
    app.innerHTML = html;
    wireOwner();
    wireRemove();
  }

  // Owner only: every connected athlete, sync health, and moving athletes between teams.
  function ownerPanel(athletes) {
    var opts = function (sel) { return state.teams.map(function (t) { return '<option value="' + t.id + '"' + (t.id === sel ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join(''); };
    var rows = athletes.map(function (a) {
      return '<tr><td class="name"><a href="#/athlete/' + a.id + '">' + esc(fullName(a)) + '</a></td>' +
        '<td><select data-move="' + a.id + '" aria-label="Team for ' + esc(fullName(a)) + '">' + opts(a.team_id) + '</select></td>' +
        '<td>' + (a.connected ? '<span class="z-green"><span class="dot"></span>Connected</span>' : '<span class="z-red"><span class="dot"></span>Disconnected</span>') + '</td>' +
        '<td>' + esc(ago(a.last_sync_at)) + '</td><td class="small ' + (a.last_sync_error ? 'err' : 'muted') + '" style="white-space:normal;max-width:360px">' + esc(a.last_sync_error || 'OK') + '</td>' +
        '<td><button class="linkbtn danger" data-remove="' + a.id + '" data-name="' + esc(fullName(a)) + '">Remove</button></td></tr>';
    }).join('');
    return '<div style="margin-top:32px"><p class="kicker">Owner</p><h2>All athletes and sync status</h2><p class="sub small" style="margin-bottom:12px">Only you can see this section. Change a team to move an athlete between boards. Remove disconnects an athlete from WHOOP and deletes all their data.</p>' +
      '<div class="tablewrap"><table><thead><tr><th>Athlete</th><th>Team</th><th>WHOOP</th><th>Last sync</th><th>Sync message</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6" class="muted">No athletes connected yet.</td></tr>') + '</tbody></table></div></div>';
  }
  function wireOwner() {
    app.querySelectorAll('select[data-move]').forEach(function (sel) {
      sel.addEventListener('change', async function () {
        sel.disabled = true;
        var r = await sb.from('athletes').update({ team_id: sel.value }).eq('id', sel.getAttribute('data-move'));
        sel.disabled = false;
        if (r.error) alertBox('Could not move athlete: ' + r.error.message); else route();
      });
    });
  }
  // Owner: revoke WHOOP access and delete all of an athlete's data (handled by the server function).
  function wireRemove() {
    app.querySelectorAll('button[data-remove]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var name = btn.getAttribute('data-name');
        if (!confirm('Remove ' + name + '?\n\nThis disconnects CoachKonnekt from their WHOOP account and permanently deletes all their data here. They can rejoin later with a new invite link.')) return;
        btn.disabled = true; btn.textContent = 'Removing…';
        try {
          var r = await fetch(SUPABASE_URL + '/functions/v1/whoop/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.session.access_token },
            body: JSON.stringify({ athlete_id: btn.getAttribute('data-remove') })
          });
          var j = await r.json();
          if (!r.ok) throw new Error(j.error || ('Error ' + r.status));
          await route();
          alertBox(name + ' was removed.' + (j.whoop_access_revoked ? ' WHOOP access revoked.' : ' WHOOP access was already disconnected.'), true);
        } catch (e) {
          btn.disabled = false; btn.textContent = 'Remove';
          alertBox('Could not remove ' + name + ': ' + e.message);
        }
      });
    });
  }
  function alertBox(msg, ok) { var p = document.createElement('p'); p.className = ok ? 'z-green' : 'err'; p.setAttribute('role', 'status'); p.textContent = msg; app.prepend(p); }

  async function teamPage(slug) {
    var team = state.teams.filter(function (t) { return t.slug === slug; })[0];
    if (!team) { location.hash = '#/'; return; }
    renderNav(slug);
    app.innerHTML = '<p class="loading">Loading ' + esc(team.name) + '…</p>';
    var athletes = (await loadAthletes()).filter(function (a) { return a.team_id === team.id; });
    var hist = await loadHistory(athletes.map(function (a) { return a.id; }), HISTORY_DAYS, false);
    var sums = athletes.map(function (a) { return summarize(a, hist.rec[a.id], hist.slp[a.id], hist.cyc[a.id]); });

    var teamRec = avg(sums.map(function (s) { return s.recovery; }));
    var teamHrv = avg(sums.map(function (s) { return s.hrv; }));
    var teamSleep = avg(sums.map(function (s) { return s.sleepMs; }));
    var flags = [].concat.apply([], sums.map(function (s) { return s.flags.map(function (f) { f.id = s.athlete.id; return f; }); }));
    var attention = sums.filter(function (s) { return s.flags.length; }).length;

    // Team average recovery per day, last 28 days
    var days = lastNDays(28).map(function (d) {
      var vals = [];
      athletes.forEach(function (a) { (hist.rec[a.id] || []).forEach(function (r) { if (r.score_state === 'SCORED' && dayKey(r.created_at) === d.key) vals.push(r.recovery_score); }); });
      var v = avg(vals); return { label: d.label, bar: v == null ? null : Math.round(v), title: d.label + ': ' + (v == null ? 'no data' : Math.round(v) + '% (' + vals.length + ' athletes)') };
    });

    var html = '<div class="head"><div><p class="kicker">Team board · ' + esc(fmtDay(new Date().toISOString())) + '</p><h1>' + esc(team.name) + '</h1>' +
      '<p class="sub">' + athletes.length + ' athlete' + (athletes.length === 1 ? '' : 's') + ' · ' + sums.filter(function (s) { return s.recoveryAt && Date.now() - Date.parse(s.recoveryAt) < 30 * 3600000; }).length + ' with a recovery score today</p></div></div>';
    html += '<div class="grid4">' +
      tile('Team recovery', teamRec == null ? '–' : '<span class="z-' + zone(teamRec) + '">' + Math.round(teamRec) + '%</span>') +
      tile('Avg HRV', teamHrv == null ? '–' : Math.round(teamHrv) + '<small>ms</small>') +
      tile('Avg sleep', teamSleep == null ? '–' : hm(teamSleep)) +
      tile('Need attention', '<span class="' + (attention ? 'z-red' : '') + '">' + attention + '</span><small>athletes</small>') + '</div>';
    html += '<div class="grid2"><div class="panel chart"><h2>Team recovery · 28 days</h2><p class="sub small">Daily average of athletes with a score that day.</p>' +
      barChart(days, { label: 'Team average recovery per day' }) + '</div>' +
      '<div class="panel"><h2>Flags <span class="muted small">(' + flags.length + ')</span></h2>' + flagList(flags) + '</div></div>';
    html += athleteTable(sums);
    html += '<div class="panel invite" style="margin-top:16px"><h2>Invite an athlete to ' + esc(team.name) + '</h2>' +
      '<p class="sub small">Each invite link is for one athlete. It works once and expires after 2 days.</p>' +
      '<form id="invForm" class="linkrow"><input id="invName" maxlength="80" placeholder="Athlete name, e.g. Mert Demir" aria-label="Athlete name" required style="flex:1;min-width:220px">' +
      '<button class="btn" id="invGo" type="submit">Create invite link</button></form>' +
      '<div id="invNew" hidden></div>' +
      '<div id="invList"><p class="muted small">Loading invites…</p></div></div>';
    app.innerHTML = html;
    wireTable(sums);
    wireInvites(team);
  }

  // ------------------------------------------------------------ one-time invites
  function copyText(text, btn) {
    var done = function () { if (btn) { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy link'; }, 1500); } };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { prompt('Copy this link:', text); });
    else prompt('Copy this link:', text);
  }
  function inviteStatus(i) {
    if (i.cancelled_at) return ['Cancelled', 'muted'];
    if (i.used_at) return ['Used ' + fmtDay(i.used_at), 'z-green'];
    var left = Date.parse(i.expires_at) - Date.now();
    if (left <= 0) return ['Expired', 'muted'];
    var h = Math.floor(left / 3600000);
    return ['Pending · expires in ' + (h >= 1 ? h + ' h' : Math.max(1, Math.round(left / 60000)) + ' min'), 'z-yellow'];
  }
  async function loadInvites(team) {
    var box = document.getElementById('invList'); if (!box) return;
    var r = await sb.from('invites').select('id,token,athlete_name,created_by,created_at,expires_at,used_at,cancelled_at')
      .eq('team_id', team.id).order('created_at', { ascending: false }).limit(30);
    if (r.error) { box.innerHTML = '<p class="err small">Could not load invites: ' + esc(r.error.message) + '</p>'; return; }
    if (!r.data.length) { box.innerHTML = '<p class="muted small" style="margin:0">No invites yet.</p>'; return; }
    box.innerHTML = '<div class="tablewrap" style="margin-top:6px"><table style="min-width:640px"><thead><tr><th>Athlete</th><th>Created</th><th>Status</th><th></th></tr></thead><tbody>' +
      r.data.map(function (i) {
        var st = inviteStatus(i), pending = st[1] === 'z-yellow';
        return '<tr><td><b>' + esc(i.athlete_name) + '</b></td>' +
          '<td class="small muted">' + esc(fmtDay(i.created_at)) + ' ' + esc(fmtTime(i.created_at)) + (i.created_by ? ' · ' + esc(i.created_by.split('@')[0]) : '') + '</td>' +
          '<td class="small ' + st[1] + '">' + esc(st[0]) + '</td>' +
          '<td style="text-align:right">' + (pending ? '<button class="linkbtn" data-copy="' + esc(INVITE_URL + i.token) + '">Copy link</button> <button class="linkbtn danger" data-cancel="' + i.id + '" data-name="' + esc(i.athlete_name) + '">Cancel</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    box.querySelectorAll('[data-copy]').forEach(function (b) { b.onclick = function () { copyText(b.getAttribute('data-copy'), b); }; });
    box.querySelectorAll('[data-cancel]').forEach(function (b) {
      b.onclick = async function () {
        if (!confirm('Cancel the invite for ' + b.getAttribute('data-name') + '? The link will stop working.')) return;
        b.disabled = true;
        var u = await sb.from('invites').update({ cancelled_at: new Date().toISOString() }).eq('id', b.getAttribute('data-cancel'));
        if (u.error) { b.disabled = false; alertBox('Could not cancel invite: ' + u.error.message); return; }
        loadInvites(team);
      };
    });
  }
  function wireInvites(team) {
    var form = document.getElementById('invForm'); if (!form) return;
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var name = document.getElementById('invName').value.trim(); if (!name) return;
      var btn = document.getElementById('invGo'); btn.disabled = true; btn.textContent = 'Creating…';
      var r = await sb.from('invites').insert({ team_id: team.id, athlete_name: name }).select('token,expires_at').single();
      btn.disabled = false; btn.textContent = 'Create invite link';
      var out = document.getElementById('invNew');
      if (r.error) { out.hidden = false; out.innerHTML = '<p class="err small">Could not create invite: ' + esc(r.error.message) + '</p>'; return; }
      var link = INVITE_URL + r.data.token;
      out.hidden = false;
      out.innerHTML = '<p class="small z-green" style="margin:12px 0 6px">Invite link for ' + esc(name) + ' is ready. Send it to them only; it expires ' + esc(fmtDay(r.data.expires_at)) + ' at ' + esc(fmtTime(r.data.expires_at)) + '.</p>' +
        '<div class="linkrow"><code>' + esc(link) + '</code><button class="btn ghost" id="invCopy" type="button">Copy link</button></div>';
      document.getElementById('invCopy').onclick = function () { copyText(link, this); };
      document.getElementById('invName').value = '';
      loadInvites(team);
    });
    loadInvites(team);
  }

  function tile(label, val) { return '<div class="panel tile"><div class="label">' + label + '</div><div class="val">' + val + '</div></div>'; }
  function flagList(flags) {
    if (!flags.length) return '<p class="muted">No flags. Everyone looks ready.</p>';
    var ic = { red: ['!', '#ff4d5e'], hrv: ['↓', '#f5c542'], sleep: ['z', '#9b8cff'], sync: ['×', '#a3acb2'] };
    return '<ul class="flags">' + flags.map(function (f) {
      var c = ic[f.kind];
      return '<li><span class="ic" style="background:' + c[1] + '">' + c[0] + '</span><div><b><a href="#/athlete/' + f.id + '">' + esc(f.t) + '</a></b><span>' + esc(f.m) + '</span></div></li>';
    }).join('') + '</ul>';
  }

  var sortState = { key: 'recovery', dir: 1 };
  function athleteTable(sums) {
    if (!sums.length) return '<div class="panel"><p class="muted" style="margin:0">No athletes on this board yet. Create an invite link below.</p></div>';
    var cols = [['name', 'Athlete'], ['recovery', 'Recovery'], ['hrv', 'HRV vs 7d'], ['rhr', 'RHR'], ['sleep', 'Sleep'], ['strain', 'Yday strain'], [null, '7-day recovery'], ['sync', 'Last sync']];
    return '<div class="tablewrap"><table><thead><tr>' + cols.map(function (c) {
      return '<th>' + (c[0] ? '<button data-sort="' + c[0] + '">' + c[1] + (sortState.key === c[0] ? (sortState.dir > 0 ? ' ↑' : ' ↓') : '') + '</button>' : c[1]) + '</th>';
    }).join('') + '</tr></thead><tbody id="tb"></tbody></table></div>';
  }
  function wireTable(sums) {
    var tb = document.getElementById('tb'); if (!tb) return;
    var val = {
      name: function (s) { return fullName(s.athlete).toLowerCase(); }, recovery: function (s) { return s.recovery; }, hrv: function (s) { return s.hrvDelta; },
      rhr: function (s) { return s.rhr; }, sleep: function (s) { return s.sleepMs; }, strain: function (s) { return s.strain; }, sync: function (s) { return s.athlete.last_sync_at ? -Date.parse(s.athlete.last_sync_at) : null; }
    };
    function draw() {
      var f = val[sortState.key];
      var rows = sums.slice().sort(function (a, b) {
        var x = f(a), y = f(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
        return (x < y ? -1 : x > y ? 1 : 0) * sortState.dir;
      });
      tb.innerHTML = rows.map(function (s) {
        var a = s.athlete, d = s.hrvDelta;
        return '<tr class="click' + (a.connected ? '' : ' off') + '" data-id="' + a.id + '"><td class="name"><a href="#/athlete/' + a.id + '">' + esc(fullName(a)) + '</a></td>' +
          '<td class="num z-' + zone(s.recovery) + '"><span class="dot"></span><b>' + (s.recovery == null ? '–' : s.recovery + '%') + '</b> <span class="muted small">' + (s.recoveryAt ? relDay(s.recoveryAt) : '') + '</span></td>' +
          '<td class="num">' + (s.hrv == null ? '–' : s.hrv + ' ms') + (d == null ? '' : ' <span class="small ' + (d >= 0 ? 'up' : 'down') + '">' + (d >= 0 ? '▲' : '▼') + Math.abs(Math.round(d * 100)) + '%</span>') + '</td>' +
          '<td class="num">' + (s.rhr == null ? '–' : s.rhr + ' bpm') + '</td>' +
          '<td class="num">' + hm(s.sleepMs) + (s.sleepPerf == null ? '' : ' <span class="muted small">' + s.sleepPerf + '%</span>') + '</td>' +
          '<td class="num">' + (s.strain == null ? '–' : s.strain.toFixed(1)) + '</td>' +
          '<td>' + spark(s.spark) + '</td>' +
          '<td class="small ' + (a.connected ? 'muted' : 'err') + '">' + (a.connected ? esc(ago(a.last_sync_at)) : 'Disconnected') + '</td></tr>';
      }).join('');
      app.querySelectorAll('th button').forEach(function (b) {
        var k = b.getAttribute('data-sort'), label = b.textContent.replace(/ [↑↓]$/, '');
        b.textContent = label + (sortState.key === k ? (sortState.dir > 0 ? ' ↑' : ' ↓') : '');
      });
    }
    app.querySelectorAll('th button').forEach(function (b) {
      b.onclick = function () { var k = b.getAttribute('data-sort'); sortState = { key: k, dir: sortState.key === k ? -sortState.dir : 1 }; draw(); };
    });
    tb.onclick = function (e) { var tr = e.target.closest('tr[data-id]'); if (tr && e.target.tagName !== 'A') location.hash = '#/athlete/' + tr.getAttribute('data-id'); };
    draw();
  }

  async function athletePage(id) {
    app.innerHTML = '<p class="loading">Loading athlete…</p>';
    var athletes = await loadAthletes();
    var a = athletes.filter(function (x) { return x.id === id; })[0];
    if (!a) { app.innerHTML = '<div class="panel"><h2>Athlete not found</h2><p><a href="#/">Back to overview</a></p></div>'; renderNav(''); return; }
    var team = state.teams.filter(function (t) { return t.id === a.team_id; })[0];
    renderNav(team ? team.slug : '');
    var hist = await loadHistory([a.id], 30, true);
    var s = summarize(a, hist.rec[a.id], hist.slp[a.id], hist.cyc[a.id]);
    var rec = hist.rec[a.id] || [], slp = hist.slp[a.id] || [], cyc = hist.cyc[a.id] || [], wk = hist.wk[a.id] || [];

    var days = lastNDays(30).map(function (d) {
      var r = rec.filter(function (x) { return x.score_state === 'SCORED' && dayKey(x.created_at) === d.key; })[0];
      var sl = slp.filter(function (x) { return !x.nap && x.total_sleep_milli != null && dayKey(x.end_time || x.start_time) === d.key; })[0];
      var c = cyc.filter(function (x) { return x.strain != null && dayKey(x.start_time) === d.key; })[0];
      return {
        label: d.label,
        rec: r ? Math.round(r.recovery_score) : null, hrv: r ? Math.round(r.hrv_rmssd_milli) : null,
        sleepH: sl ? round(sl.total_sleep_milli / 3600000, 1) : null, strain: c ? round(c.strain, 1) : null
      };
    });
    var recDays = days.map(function (d) { return { label: d.label, bar: d.rec, line: d.hrv, title: d.label + ': recovery ' + (d.rec == null ? '–' : d.rec + '%') + ', HRV ' + (d.hrv == null ? '–' : d.hrv + ' ms') }; });
    var slpDays = days.map(function (d) { return { label: d.label, bar: d.sleepH, line: d.strain, title: d.label + ': sleep ' + (d.sleepH == null ? '–' : d.sleepH + ' h') + ', strain ' + (d.strain == null ? '–' : d.strain) }; });

    var html = '<p class="small"><a href="#/team/' + (team ? esc(team.slug) : '') + '" class="muted">← ' + esc(team ? team.name : 'Overview') + '</a></p>' +
      '<div class="head"><div><p class="kicker">' + esc(team ? team.name : 'No team') + ' · ' + (a.connected ? 'WHOOP synced ' + esc(ago(a.last_sync_at)) : 'Disconnected') + '</p><h1>' + esc(fullName(a)) + '</h1></div></div>';
    html += '<div class="grid4">' +
      tile('Recovery', s.recovery == null ? '–' : '<span class="z-' + zone(s.recovery) + '">' + s.recovery + '%</span><small>' + (s.recoveryAt ? relDay(s.recoveryAt) : '') + '</small>') +
      tile('HRV', s.hrv == null ? '–' : s.hrv + '<small>ms' + (s.hrvDelta == null ? '' : ' · ' + (s.hrvDelta >= 0 ? '+' : '') + Math.round(s.hrvDelta * 100) + '% vs 7d') + '</small>') +
      tile('Resting HR', s.rhr == null ? '–' : s.rhr + '<small>bpm</small>') +
      tile('Last sleep', hm(s.sleepMs) + (s.sleepPerf == null ? '' : '<small>' + s.sleepPerf + '% perf.</small>')) + '</div>';
    if (s.flags.length) html += '<div class="panel" style="margin-bottom:16px"><h2>Flags</h2>' + flagList(s.flags.map(function (f) { f.id = a.id; return f; })) + '</div>';
    html += '<div class="cols2"><div class="panel chart"><h2>Recovery &amp; HRV · 30 days</h2>' + barChart(recDays, { label: 'Recovery and HRV per day', line: true, lineColor: '#ffffff', lineDash: '4 4', barUnit: '' }) +
      '<div class="legend"><span><i style="background:linear-gradient(90deg,#ff4d5e,#f5c542,#3ddc84)"></i>Recovery % (bars, by zone)</span><span><i style="background:#fff"></i>HRV ms (line, right axis)</span></div></div>' +
      '<div class="panel chart"><h2>Sleep &amp; strain · 30 days</h2>' + barChart(slpDays, { label: 'Sleep hours and strain per day', barMax: 12, barUnit: 'h', barColor: '#9b8cff', line: true, lineColor: '#3aa0ff' }) +
      '<div class="legend"><span><i style="background:#9b8cff"></i>Sleep hours (bars)</span><span><i style="background:#3aa0ff"></i>Day strain (line, right axis)</span></div></div></div>';
    html += '<h2 style="margin-top:8px">Workouts · 30 days</h2>' + (wk.length ?
      '<div class="tablewrap"><table><thead><tr><th>Date</th><th>Activity</th><th>Duration</th><th>Strain</th><th>Avg HR</th><th>Max HR</th></tr></thead><tbody>' +
      wk.map(function (w) {
        var dur = w.end_time ? Date.parse(w.end_time) - Date.parse(w.start_time) : null;
        return '<tr><td>' + esc(fmtDay(w.start_time)) + ' <span class="muted small">' + esc(fmtTime(w.start_time)) + '</span></td><td>' + esc((w.sport_name || 'Activity').replace(/[-_]/g, ' ')) + '</td><td class="num">' + hm(dur) + '</td>' +
          '<td class="num">' + (w.strain == null ? '–' : round(w.strain, 1)) + '</td><td class="num">' + (w.average_heart_rate || '–') + '</td><td class="num">' + (w.max_heart_rate || '–') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted">No workouts recorded in the last 30 days.</p>');
    app.innerHTML = html;
  }

  // Change your own password while logged in.
  // Change password: from the header button, or after following a reset email (fromReset).
  function accountPage(fromReset) {
    if (fromReset) { nav.hidden = true; who.hidden = true; } else renderNav('');
    app.innerHTML = '<div class="login" style="margin-top:2vh"><p class="kicker">' + (fromReset ? 'Reset password' : 'Account') + '</p>' +
      '<h1>' + (fromReset ? 'Choose a new password' : 'Change password') + '</h1>' +
      '<p class="sub">' + esc(state.session.user.email) + '</p>' +
      '<form id="pf"><label>New password<input type="password" id="p1" autocomplete="new-password" minlength="8" required></label>' +
      '<label>Repeat new password<input type="password" id="p2" autocomplete="new-password" minlength="8" required></label>' +
      '<button class="btn" id="ps" type="submit">Save new password</button>' +
      '<p class="small" id="pmsg" role="status"></p><p class="muted small" style="margin:0">At least 8 characters.</p></form></div>';
    document.getElementById('pf').addEventListener('submit', async function (e) {
      e.preventDefault();
      var a = document.getElementById('p1').value, b = document.getElementById('p2').value, m = document.getElementById('pmsg'), btn = document.getElementById('ps');
      if (a !== b) { m.className = 'small err'; m.textContent = 'The two passwords do not match.'; return; }
      btn.disabled = true; btn.textContent = 'Saving…';
      var r = await sb.auth.updateUser({ password: a });
      btn.disabled = false; btn.textContent = 'Save new password';
      if (r.error) { m.className = 'small err'; m.textContent = 'Could not change password: ' + r.error.message; return; }
      document.getElementById('pf').reset();
      m.className = 'small z-green';
      if (fromReset) {
        recovering = false;
        history.replaceState(null, '', location.pathname + '#/');
        m.innerHTML = 'Password saved. <a href="#/" id="cont">Continue to the dashboard →</a>';
        document.getElementById('cont').addEventListener('click', function (ev) { ev.preventDefault(); route(); });
      } else {
        m.textContent = 'Password changed. Use it next time you log in.';
      }
    });
  }

  boot().catch(function (e) { console.error(e); app.innerHTML = '<p class="err">Could not start: ' + esc(e.message || e) + '</p>'; });
})();
