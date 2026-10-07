// NFL team abbreviation normalization across sources (Sleeper is the canonical form).

const ALIASES: Record<string, string> = {
  LA: "LAR",
  STL: "LAR",
  SD: "LAC",
  OAK: "LV",
  LVR: "LV",
  JAC: "JAX",
  WSH: "WAS",
  GNB: "GB",
  KAN: "KC",
  NWE: "NE",
  NOR: "NO",
  SFO: "SF",
  TAM: "TB",
  ARZ: "ARI",
  BLT: "BAL",
  CLV: "CLE",
  HST: "HOU",
};

export function normTeam(t: string | null | undefined): string | null {
  if (!t) return null;
  const up = t.trim().toUpperCase();
  if (!up || up === "FA" || up === "NA") return null;
  return ALIASES[up] ?? up;
}

export const TEAM_FULL_NAMES: Record<string, string> = {
  "Arizona Cardinals": "ARI",
  "Atlanta Falcons": "ATL",
  "Baltimore Ravens": "BAL",
  "Buffalo Bills": "BUF",
  "Carolina Panthers": "CAR",
  "Chicago Bears": "CHI",
  "Cincinnati Bengals": "CIN",
  "Cleveland Browns": "CLE",
  "Dallas Cowboys": "DAL",
  "Denver Broncos": "DEN",
  "Detroit Lions": "DET",
  "Green Bay Packers": "GB",
  "Houston Texans": "HOU",
  "Indianapolis Colts": "IND",
  "Jacksonville Jaguars": "JAX",
  "Kansas City Chiefs": "KC",
  "Las Vegas Raiders": "LV",
  "Los Angeles Chargers": "LAC",
  "Los Angeles Rams": "LAR",
  "Miami Dolphins": "MIA",
  "Minnesota Vikings": "MIN",
  "New England Patriots": "NE",
  "New Orleans Saints": "NO",
  "New York Giants": "NYG",
  "New York Jets": "NYJ",
  "Philadelphia Eagles": "PHI",
  "Pittsburgh Steelers": "PIT",
  "San Francisco 49ers": "SF",
  "Seattle Seahawks": "SEA",
  "Tampa Bay Buccaneers": "TB",
  "Tennessee Titans": "TEN",
  "Washington Commanders": "WAS",
};

/** Normalize a person's name for cross-source matching ("D.J. Moore Jr." -> "djmoore"). */
export function normName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z]/g, "");
}
