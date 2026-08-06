import re

import requests

TRACKER_URL = "https://www.mlbtraderumors.com/{season}/01/{season}-arbitration-tracker.html"

# MLBTR's tracker lists every arbitration-eligible player for the season as
# an <li> under a team heading: bold-linked name, then "(service.time):" then
# the settlement/hearing outcome. e.g.
#   <li><strong><a href="...">Reid Detmers</a></strong> (3.159): No agreement...</li>
# The service-time figure is MLB's own accrued-days number (years.days, e.g.
# 3.159 = 3 years, 159 days) -- the actual input to the CBA's Arb1/2/3 and
# Super Two rules, not something derivable from any stats API.
_ENTRY_RE = re.compile(r"<li><strong><a[^>]*>([^<]+)</a></strong>\s*\(([\d.]+)\):")


def fetch_service_times(season: int) -> dict[str, float]:
    """Returns {player_name: service_time} for every player in that season's
    MLBTR arbitration tracker, keyed by the name as printed on the page.
    Matching to player_id happens in ingest.py against players.full_name --
    this module only knows about MLBTR's own text."""
    resp = requests.get(
        TRACKER_URL.format(season=season), timeout=30, headers={"User-Agent": "Mozilla/5.0"}
    )
    resp.raise_for_status()
    resp.encoding = "utf-8"
    return {name.strip(): float(svc) for name, svc in _ENTRY_RE.findall(resp.text)}


# Same tracker entries as above, but also captures the free-text outcome
# (everything between "):" and "</li>") so a real settled dollar figure can
# be pulled out of it for historical seasons -- fetch_service_times only
# needs the service-time number for the live/current year.
_HISTORICAL_ENTRY_RE = re.compile(
    r"<li><strong><a[^>]*>([^<]+)</a></strong>\s*\(([\d.]+)\):(.*?)</li>", re.DOTALL
)
_DOLLAR_RE = re.compile(r"\$([\d,.]+)\s*(MM|M|K)\b")

# Older tracker posts don't follow the current {season}/01/{season}-
# arbitration-tracker.html URL pattern. 2023's slug has an extra "mlb-".
# 2022's deadline (delayed by that offseason's lockout) lives under a
# bespoke "arbtracker2022" URL using a different page template entirely
# (no <li><strong> structure at all) -- not scraped here, not worth
# bespoke parsing for one extra year of data.
_HISTORICAL_URL_OVERRIDES = {
    2023: "https://www.mlbtraderumors.com/2023/01/2023-mlb-arbitration-tracker.html",
}


_YEAR_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
}
# Players who avoid arbitration by signing a multi-year extension get an
# entry like "six-year, $73MM extension" -- that $73MM is the deal TOTAL,
# not a single-season salary (Sean Murphy's real 2023 AAV was ~$12.2MM).
# Without this, a bare dollar-figure regex reads the total as if it were
# one year's pay, badly inflating the comp pool. MLBTR spells out the year
# count in words ("six-year") rather than digits, so this matches both.
_YEARS_DOLLAR_RE = re.compile(
    r"(\d+|one|two|three|four|five|six|seven|eight|nine|ten)[\s-]*year,?\s*\$([\d,.]+)\s*(MM|M|K)\b",
    re.IGNORECASE,
)
# Backstop for whatever the years-pattern above doesn't catch (unusual
# phrasing, a dollar figure referring to something else in the entry
# entirely): the real all-time arbitration record is Skubal's $32MM
# (2026) -- anything parsed above this is almost certainly a mis-read
# multi-year total or an unrelated number, not a real single-season salary.
MAX_PLAUSIBLE_SINGLE_SEASON_SALARY = 40_000_000


def _parse_dollar(text: str) -> float | None:
    years_match = _YEARS_DOLLAR_RE.search(text)
    if years_match:
        years = _YEAR_WORDS.get(years_match.group(1).lower()) or int(years_match.group(1))
        amount = float(years_match.group(2).replace(",", ""))
        unit = years_match.group(3)
        total = amount * (1_000_000 if unit.upper() == "MM" or unit == "M" else 1_000)
        return total / years if years > 0 else None
    match = _DOLLAR_RE.search(text)
    if not match:
        return None
    amount = float(match.group(1).replace(",", ""))
    unit = match.group(2)
    salary = amount * (1_000_000 if unit in ("MM", "M") else 1_000)
    if salary > MAX_PLAUSIBLE_SINGLE_SEASON_SALARY:
        return None
    return salary


def fetch_historical_outcomes(season: int) -> list[dict]:
    """Returns [{name, service_time, salary}] for a past season's tracker.
    salary is the real settled/awarded dollar figure, or None if this
    particular post never resolved to a clean one (~10% of entries in
    practice -- an unresolved hearing as of publication, or a multi-year/
    option deal MLBTR described in prose instead of a plain "$X agreement").
    Entries with salary=None should be dropped by the caller, not guessed at."""
    url = _HISTORICAL_URL_OVERRIDES.get(season, TRACKER_URL.format(season=season))
    resp = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    resp.encoding = "utf-8"
    return [
        {"name": name.strip(), "service_time": float(svc), "salary": _parse_dollar(outcome)}
        for name, svc, outcome in _HISTORICAL_ENTRY_RE.findall(resp.text)
    ]
