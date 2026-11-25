// Usage: node build-data.mjs   (Node 18+). Writes data.json next to index.html.
import { writeFileSync } from 'node:fs';
const START_IDS = ['1383316903019184128', '1233491700245078016']; // 2023/24/26 chain, 2025 league
const SHEET_CSV = 'https://docs.google.com/spreadsheets/d/1PSWJMG-FgRXhDQk5qiYDcTzow9vY27E5eWJ8eRjwjzE/export?format=csv&gid=809196903';
const REG_WEEKS = 12;
const OVERRIDES = { visionscn: 'bigdawge108', matt: 'mattlangstrom', jbitey: 'jakebitey', xxcumlordxx: 'jameis69anus69' }; // merge accounts: { 'oldusername': 'newusername' }

const api = async p => { const r = await fetch('https://api.sleeper.app/v1' + p); if (!r.ok) throw new Error(r.status + ' ' + p); return r.json(); };
const who = s => { const n = (s || '').trim().replace(/^@/, '').toLowerCase(); return OVERRIDES[n] || n; };

// Walk each league chain back through previous_league_id; one league per season.
const bySeason = new Map();
for (let id of START_IDS) {
  while (id && id !== '0') {
    const l = await api('/league/' + id);
    if (bySeason.has(l.season)) console.warn('Duplicate season', l.season, '- keeping first');
    else bySeason.set(l.season, l);
    id = l.previous_league_id;
  }
}

const games = [];
for (const l of bySeason.values()) {
  const [users, rosters] = await Promise.all([api(`/league/${l.league_id}/users`), api(`/league/${l.league_id}/rosters`)]);
  const uname = Object.fromEntries(users.map(u => [u.user_id, who(u.username || u.display_name)]));
  const owner = Object.fromEntries(rosters.map(r => [r.roster_id, uname[r.owner_id]]));
  for (let w = 1; w <= REG_WEEKS; w++) {
    const groups = {};
    for (const m of await api(`/league/${l.league_id}/matchups/${w}`)) if (m.matchup_id != null) (groups[m.matchup_id] ||= []).push(m);
    const wk = []; // every team's score this week, for the median
    for (const [x, y] of Object.values(groups).filter(p => p.length === 2)) {
      if (!x.points && !y.points) continue; // unplayed week
      if (!owner[x.roster_id] || !owner[y.roster_id]) { console.warn('Missing owner', l.season, 'week', w); continue; }
      games.push({ s: +l.season, w, t: 'reg', a: owner[x.roster_id], b: owner[y.roster_id], pa: x.points, pb: y.points });
      wk.push([owner[x.roster_id], x.points], [owner[y.roster_id], y.points]);
    }
    // Second result each week: vs the league median (a tie if exactly equal).
    const s = wk.map(t => t[1]).sort((p, q) => p - q);
    const m = s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    for (const [u, p] of wk) games.push({ s: +l.season, w, t: 'med', a: u, b: null, pa: p, pb: m });
  }
}

// Playoffs from the Google Sheet tab (must be shared "anyone with the link can view").
const known = new Set(games.flatMap(g => [g.a, g.b]).filter(Boolean));
const rows = (await (await fetch(SHEET_CSV)).text()).trim().split(/\r?\n/).slice(1);
for (const row of rows) {
  const [season, round, a, b, pa, pb] = row.split(',');
  if (!season) continue;
  const r = /quarter/i.test(round) ? 'Quarterfinal' : /semi/i.test(round) ? 'Semifinal' : 'Championship';
  const bye = /^\s*bye\s*$/i.test(b) ? a : /^\s*bye\s*$/i.test(a) ? b : null;
  // A bye counts as a playoff win (earned advancement) but isn't a head-to-head matchup.
  const g = bye ? { s: +season, w: r, t: 'po', a: who(bye), b: 'bye', pa: 1, pb: 0, bye: true }
                : { s: +season, w: r, t: 'po', a: who(a), b: who(b), pa: +pa, pb: +pb };
  for (const u of [g.a, g.b]) if (u !== 'bye' && !known.has(u)) console.warn('Playoff username not found in Sleeper:', u);
  games.push(g);
}

const clean = games.filter(g => g.a !== g.b || (console.warn('Skipped self-matchup', g.s, g.w, g.a), false));
writeFileSync('data.json', JSON.stringify({ updated: new Date().toISOString(), games: clean }));
console.log(clean.length, 'games written');
