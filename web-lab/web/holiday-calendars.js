// Rule-based market holiday calendars for the "Monthly business day" schedule
// generator. Computed on demand from calendar rules (Computus, nth-weekday-
// of-month, fixed-date + weekend-observed-shift) rather than a hand-typed
// date table, so it never goes stale and works for any future year.
//
// Scope and honesty note (see web-lab/docs/roadmap.md "Full business-day
// holiday calendars" gap, and the market-holidays follow-on in the project
// plan): these are the well-known fixed/nth-weekday holidays for each
// exchange's home market. They are NOT a substitute for the exchange's
// official published calendar for settlement/risk decisions. Two known
// gaps, flagged rather than silently guessed:
//   - Hong Kong (HKEX): lunar-calendar holidays (Lunar New Year, Ching Ming,
//     Mid-Autumn, Chung Yeung, Buddha's Birthday) are NOT included -- only
//     fixed-date holidays are computed. Hardcoding specific lunar dates from
//     memory risked being silently wrong, which is worse than an honest gap.
//   - Japan (JPX): the two solar-term holidays (Vernal/Autumnal Equinox Day)
//     use a published astronomical approximation valid for 2000-2099; the
//     "bridge day" rule (a weekday sandwiched between two holidays also
//     becomes a holiday) is not implemented, only the Sunday-substitute rule.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HolidayCalendars = api;
}(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const MARKETS = [
    ["weekends", "Weekends only (no market holidays)"],
    ["us", "United States — NYSE / ICE / CME / Fed"],
    ["uk", "United Kingdom — LSE"],
    ["ca", "Canada — TSX"],
    ["jp", "Japan — JPX"],
    ["hk", "Hong Kong — HKEX (fixed-date holidays only)"],
  ];

  function addDays(date, n) {
    const result = new Date(date.getTime());
    result.setUTCDate(result.getUTCDate() + n);
    return result;
  }

  function isWeekend(date) {
    const day = date.getUTCDay();
    return day === 0 || day === 6;
  }

  function sameDay(a, b) {
    return a.getTime() === b.getTime();
  }

  // Anonymous Gregorian algorithm (Meeus/Jones/Butcher) for Easter Sunday.
  function easterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
  }

  // nth (1-based) occurrence of `weekday` (0=Sun..6=Sat) in `month` (0-based).
  function nthWeekday(year, month, weekday, n) {
    const first = new Date(Date.UTC(year, month, 1));
    const offset = (weekday - first.getUTCDay() + 7) % 7;
    return new Date(Date.UTC(year, month, 1 + offset + 7 * (n - 1)));
  }

  function lastWeekday(year, month, weekday) {
    const last = new Date(Date.UTC(year, month + 1, 0));
    const offset = (last.getUTCDay() - weekday + 7) % 7;
    return addDays(last, -offset);
  }

  // Advances `date` until it is neither a weekend nor already in `taken`.
  function shiftAvoiding(date, taken) {
    let result = date;
    while (isWeekend(result) || taken.some((t) => sameDay(t, result))) {
      result = addDays(result, 1);
    }
    return result;
  }

  // US federal/NYSE convention: Saturday moves back to Friday, Sunday moves
  // forward to Monday.
  function usShift(date) {
    const day = date.getUTCDay();
    if (day === 6) return addDays(date, -1);
    if (day === 0) return addDays(date, 1);
    return date;
  }

  // Canadian statutory convention: a weekend holiday is observed the
  // following Monday.
  function caShift(date) {
    const day = date.getUTCDay();
    if (day === 6) return addDays(date, 2);
    if (day === 0) return addDays(date, 1);
    return date;
  }

  // Sunday-only substitute (Japan's furikae kyujitsu, Hong Kong's "holiday
  // in lieu"): if the date falls on Sunday, the next non-holiday weekday
  // becomes the observed holiday. Saturday is not shifted.
  function sundayShift(date, taken) {
    if (date.getUTCDay() !== 0) return date;
    let result = addDays(date, 1);
    while (result.getUTCDay() === 0 || result.getUTCDay() === 6 || taken.some((t) => sameDay(t, result))) {
      result = addDays(result, 1);
    }
    return result;
  }

  function usHolidays(year) {
    const holidays = [
      usShift(new Date(Date.UTC(year, 0, 1))), // New Year's Day
      nthWeekday(year, 0, 1, 3), // MLK Day
      nthWeekday(year, 1, 1, 3), // Presidents Day
      addDays(easterSunday(year), -2), // Good Friday
      lastWeekday(year, 4, 1), // Memorial Day
      ...(year >= 2022 ? [usShift(new Date(Date.UTC(year, 5, 19)))] : []), // Juneteenth
      usShift(new Date(Date.UTC(year, 6, 4))), // Independence Day
      nthWeekday(year, 8, 1, 1), // Labor Day
      nthWeekday(year, 10, 4, 4), // Thanksgiving
      usShift(new Date(Date.UTC(year, 11, 25))), // Christmas
    ];
    return holidays;
  }

  function ukHolidays(year) {
    const dec26 = new Date(Date.UTC(year, 11, 26));
    const boxingObserved = shiftAvoiding(dec26, []);
    const christmasObserved = shiftAvoiding(new Date(Date.UTC(year, 11, 25)), [boxingObserved]);
    const newYearObserved = shiftAvoiding(new Date(Date.UTC(year, 0, 1)), []);
    return [
      newYearObserved,
      addDays(easterSunday(year), -2), // Good Friday
      addDays(easterSunday(year), 1), // Easter Monday
      ...(year >= 1978 ? [nthWeekday(year, 4, 1, 1)] : []), // Early May bank holiday
      lastWeekday(year, 4, 1), // Spring bank holiday
      lastWeekday(year, 7, 1), // Summer bank holiday
      christmasObserved,
      boxingObserved,
    ];
  }

  function caHolidays(year) {
    return [
      caShift(new Date(Date.UTC(year, 0, 1))), // New Year's Day
      ...(year >= 2008 ? [nthWeekday(year, 1, 1, 3)] : []), // Family Day
      addDays(easterSunday(year), -2), // Good Friday
      addDays(new Date(Date.UTC(year, 4, 25)), -((new Date(Date.UTC(year, 4, 25)).getUTCDay() + 6) % 7 || 7)), // Victoria Day: Monday on/before May 24
      caShift(new Date(Date.UTC(year, 6, 1))), // Canada Day
      nthWeekday(year, 8, 1, 1), // Labour Day
      nthWeekday(year, 9, 1, 2), // Thanksgiving
      caShift(new Date(Date.UTC(year, 11, 25))), // Christmas
      caShift(new Date(Date.UTC(year, 11, 26))), // Boxing Day
    ];
  }

  // Astronomical approximation, valid 2000-2099 (Kimura's formula, widely
  // published for Japanese equinox holidays). Outside that range this falls
  // back to a fixed nominal date rather than extrapolating an unvalidated
  // formula.
  function jpVernalEquinox(year) {
    if (year < 2000 || year > 2099) return new Date(Date.UTC(year, 2, 20));
    const day = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
    return new Date(Date.UTC(year, 2, day));
  }

  function jpAutumnalEquinox(year) {
    if (year < 2000 || year > 2099) return new Date(Date.UTC(year, 8, 23));
    const day = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
    return new Date(Date.UTC(year, 8, day));
  }

  function jpHolidays(year) {
    const fixed = [
      new Date(Date.UTC(year, 0, 1)), // New Year's Day
      nthWeekday(year, 0, 1, 2), // Coming of Age Day
      new Date(Date.UTC(year, 1, 11)), // National Foundation Day
      new Date(Date.UTC(year, 1, 23)), // Emperor's Birthday
      jpVernalEquinox(year),
      new Date(Date.UTC(year, 3, 29)), // Showa Day
      new Date(Date.UTC(year, 4, 3)), // Constitution Memorial Day
      new Date(Date.UTC(year, 4, 4)), // Greenery Day
      new Date(Date.UTC(year, 4, 5)), // Children's Day
      ...(year >= 2003 ? [nthWeekday(year, 6, 1, 3)] : []), // Marine Day
      ...(year >= 2016 ? [new Date(Date.UTC(year, 7, 11))] : []), // Mountain Day
      nthWeekday(year, 8, 1, 3), // Respect for the Aged Day
      jpAutumnalEquinox(year),
      nthWeekday(year, 9, 1, 2), // Sports Day
      new Date(Date.UTC(year, 10, 3)), // Culture Day
      new Date(Date.UTC(year, 10, 23)), // Labor Thanksgiving Day
      new Date(Date.UTC(year, 11, 31)), // JPX year-end close
      new Date(Date.UTC(year, 0, 2)), // JPX new-year close
      new Date(Date.UTC(year, 0, 3)), // JPX new-year close
    ];
    const shifted = [];
    fixed.forEach((date) => shifted.push(sundayShift(date, [...fixed, ...shifted])));
    return [...fixed, ...shifted];
  }

  function hkHolidays(year) {
    const fixed = [
      new Date(Date.UTC(year, 0, 1)), // New Year's Day
      addDays(easterSunday(year), -2), // Good Friday
      addDays(easterSunday(year), -1), // Day after Good Friday
      addDays(easterSunday(year), 1), // Easter Monday
      new Date(Date.UTC(year, 4, 1)), // Labour Day
      new Date(Date.UTC(year, 6, 1)), // HKSAR Establishment Day
      new Date(Date.UTC(year, 9, 1)), // National Day
      new Date(Date.UTC(year, 11, 25)), // Christmas Day
      new Date(Date.UTC(year, 11, 26)), // Boxing Day (first weekday after Christmas)
    ];
    const shifted = [];
    fixed.forEach((date) => shifted.push(sundayShift(date, [...fixed, ...shifted])));
    return [...fixed, ...shifted];
  }

  const HOLIDAY_BUILDERS = { us: usHolidays, uk: ukHolidays, ca: caHolidays, jp: jpHolidays, hk: hkHolidays };
  const cache = new Map();

  function holidaySetForYear(marketCode, year) {
    const key = `${marketCode}:${year}`;
    if (cache.has(key)) return cache.get(key);
    const builder = HOLIDAY_BUILDERS[marketCode];
    const set = builder ? new Set(builder(year).map((date) => date.getTime())) : new Set();
    cache.set(key, set);
    return set;
  }

  function isHoliday(date, marketCode) {
    if (!marketCode || marketCode === "weekends" || !HOLIDAY_BUILDERS[marketCode]) return false;
    const year = date.getUTCFullYear();
    // Year-end holidays (US Juneteenth aside) never spill past adjacent
    // years, so checking year-1..year+1 safely covers every shift above.
    for (let y = year - 1; y <= year + 1; y += 1) {
      if (holidaySetForYear(marketCode, y).has(date.getTime())) return true;
    }
    return false;
  }

  function isBusinessDay(date, marketCode) {
    return !isWeekend(date) && !isHoliday(date, marketCode);
  }

  function followingBusinessDay(date, marketCode) {
    let result = date;
    while (!isBusinessDay(result, marketCode)) result = addDays(result, 1);
    return result;
  }

  return { MARKETS, isHoliday, isBusinessDay, followingBusinessDay };
}));
