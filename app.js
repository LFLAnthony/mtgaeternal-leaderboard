// Shared data loading for the MTGA Eternal Leaderboard site.
// All data comes from the Google Sheet's "Publish to web" CSV links below.
// Google refreshes published data roughly every 5 minutes.

const DATA_URLS = {
  Historic: "https://docs.google.com/spreadsheets/d/e/2PACX-1vT9q8VgLjtuoNKjLlFCwII3nEIbxuZTxwKdUe-Z9Uim6T_UclJ9_HrSqxGHVIOq5qShvWaJwoFHZ2jt/pub?gid=1791637227&single=true&output=csv",
  Timeless: "https://docs.google.com/spreadsheets/d/e/2PACX-1vT9q8VgLjtuoNKjLlFCwII3nEIbxuZTxwKdUe-Z9Uim6T_UclJ9_HrSqxGHVIOq5qShvWaJwoFHZ2jt/pub?gid=1101559365&single=true&output=csv",
  Eternal:  "https://docs.google.com/spreadsheets/d/e/2PACX-1vT9q8VgLjtuoNKjLlFCwII3nEIbxuZTxwKdUe-Z9Uim6T_UclJ9_HrSqxGHVIOq5qShvWaJwoFHZ2jt/pub?gid=1328688826&single=true&output=csv",
  Matches:  "https://docs.google.com/spreadsheets/d/e/2PACX-1vT9q8VgLjtuoNKjLlFCwII3nEIbxuZTxwKdUe-Z9Uim6T_UclJ9_HrSqxGHVIOq5qShvWaJwoFHZ2jt/pub?gid=1690870926&single=true&output=csv",
};

const LADDERS = ["Historic", "Timeless", "Eternal"];

// ---------- CSV ----------
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Turns CSV rows into objects keyed by header text, so renaming or
// reordering unrelated columns in the sheet doesn't break the site.
function toObjects(rows) {
  const header = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const o = {};
    header.forEach((h, i) => { o[h] = (r[i] || "").trim(); });
    return o;
  });
}

function pick(o, ...names) {
  for (const n of names) if (o[n] !== undefined && o[n] !== "") return o[n];
  return "";
}
const num = v => { const n = Number(String(v).replace(/,/g, "")); return isNaN(n) ? 0 : n; };

async function loadCSV(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Couldn't load data (" + res.status + ")");
  return toObjects(parseCSV(await res.text()));
}

// ---------- Ladders ----------
// Players with zero games on a ladder are left out; ranks are renumbered.
async function loadLadder(name) {
  const rows = await loadCSV(DATA_URLS[name]);
  const players = rows
    .filter(r => pick(r, "PlayerID"))
    .map(r => ({
      id: pick(r, "PlayerID"),
      name: pick(r, "Display Name") || pick(r, "PlayerID"),
      elo: num(pick(r, "Elo Rating", "Elo")),
      provisional: /^yes$/i.test(pick(r, "Provisional?")),
      mw: num(pick(r, "Match Wins", "Match Win", "Match W")),
      ml: num(pick(r, "Match Losses", "Match Loss", "Match L")),
      md: num(pick(r, "Match Draws", "Match Draw", "Match D")),
      gw: num(pick(r, "Game Wins", "Game W")),
      gl: num(pick(r, "Game Losses", "Game L")),
      ew: num(pick(r, "Event Wins")),
    }))
    .filter(p => p.gw + p.gl > 0)
    .sort((a, b) => b.elo - a.elo);
  players.forEach((p, i) => { p.rank = i + 1; });
  return players;
}

async function loadAllLadders() {
  const lists = await Promise.all(LADDERS.map(loadLadder));
  const out = {};
  LADDERS.forEach((l, i) => { out[l] = lists[i]; });
  return out;
}

// ---------- Matches ----------
function parseDate(s) {
  const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

async function loadMatches() {
  const rows = await loadCSV(DATA_URLS.Matches);
  return rows
    .filter(r => pick(r, "Match ID") && pick(r, "Winner") && pick(r, "P1 Format Elo After"))
    .map(r => ({
      id: pick(r, "Match ID"),
      seq: num(pick(r, "Match ID").replace(/\D/g, "")),
      date: parseDate(pick(r, "Timestamp")),
      p1: pick(r, "Player 1 ID"), p2: pick(r, "Player 2 ID"),
      g1: num(pick(r, "P1 Games Won")), g2: num(pick(r, "P2 Games Won")),
      format: pick(r, "Format"),
      finals: /^true$/i.test(pick(r, "Finals Match?")),
      winner: pick(r, "Winner"),
      event: pick(r, "Notes"),
      fmt: [num(r["P1 Format Elo Before"]), num(r["P1 Format Elo After"]), num(r["P2 Format Elo Before"]), num(r["P2 Format Elo After"])],
      ete: [num(r["P1 Eternal Before"]), num(r["P1 Eternal After"]), num(r["P2 Eternal Before"]), num(r["P2 Eternal After"])],
    }))
    .sort((a, b) => a.seq - b.seq);
}

// One match, seen from one player's side.
function perspective(m, id) {
  const me1 = m.p1 === id;
  return {
    match: m,
    opp: me1 ? m.p2 : m.p1,
    my: me1 ? m.g1 : m.g2,
    their: me1 ? m.g2 : m.g1,
    result: m.winner === "Draw" ? "D" : (m.winner === id ? "W" : "L"),
    fmtBefore: me1 ? m.fmt[0] : m.fmt[2], fmtAfter: me1 ? m.fmt[1] : m.fmt[3],
    eteBefore: me1 ? m.ete[0] : m.ete[2], eteAfter: me1 ? m.ete[1] : m.ete[3],
  };
}

// ---------- Helpers ----------
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function playerUrl(id) { return "player.html?id=" + encodeURIComponent(id); }
function fmtDate(d) { return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : ""; }
function fmtShort(d) { return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""; }
function signed(n) { return n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "±0"; }
function deltaClass(n) { return n > 0 ? "up" : n < 0 ? "down" : "flat"; }

function showError(el, err) {
  el.innerHTML = '<div class="notice">Couldn’t load the leaderboard data. Try refreshing in a minute.<br><small>' + esc(err.message || err) + "</small></div>";
}
