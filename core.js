/* Tagalong core: pure logic, no DOM. Loaded by the page (window.Core) and by the Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Core = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const META = ["id", "u", "name", "start", "end", "currency", "rates", "stops", "transport", "dayModes", "sample", "locked", "live"];
  const LISTS = ["members", "events", "expenses", "places"];
  const DAY_START = 8 * 60;
  const DAY_END = 22 * 60;
  const MIN_GAP = 30;

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const live = (records) => (records || []).filter((record) => !record.x);
  const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const clock = (mins) => String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");
  const blockOf = (time) => (minutes(time) < 12 * 60 ? "morning" : minutes(time) < 17 * 60 ? "afternoon" : "evening");

  const decimalCache = {};
  function decimals(currency) {
    if (!(currency in decimalCache)) {
      try {
        decimalCache[currency] = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
      } catch (error) {
        decimalCache[currency] = 2;
      }
    }
    return decimalCache[currency];
  }
  const toMinor = (amount, currency) => Math.round((Number(amount) || 0) * 10 ** decimals(currency));
  const fromMinor = (minor, currency) => minor / 10 ** decimals(currency);
  function money(minor, currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(fromMinor(minor, currency));
    } catch (error) {
      return fromMinor(minor, currency).toFixed(2) + " " + currency;
    }
  }

  /* Split an integer total by weights so the parts always add up to the total (largest remainder). */
  function allocate(total, weights) {
    const sum = weights.reduce((a, b) => a + b, 0);
    if (!sum) return weights.map(() => 0);
    const exact = weights.map((weight) => (total * weight) / sum);
    const parts = exact.map(Math.floor);
    let left = total - parts.reduce((a, b) => a + b, 0);
    const order = exact.map((value, index) => [value - Math.floor(value), index]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    for (let k = 0; left > 0; k++, left--) parts[order[k % order.length][1]]++;
    return parts;
  }

  /* Who owes what for one expense, in the expense's own currency (minor units). */
  function expenseParts(expense) {
    const currency = expense.currency;
    if (expense.split === "items") {
      const subtotal = {};
      let itemsTotal = 0;
      for (const item of expense.items || []) {
        if (!item.who || !item.who.length) continue;
        const itemMinor = toMinor(item.amount, currency);
        itemsTotal += itemMinor;
        allocate(itemMinor, item.who.map(() => 1)).forEach((part, index) => {
          subtotal[item.who[index]] = (subtotal[item.who[index]] || 0) + part;
        });
      }
      const extras = toMinor(expense.tax, currency) + toMinor(expense.tip, currency);
      const ids = Object.keys(subtotal);
      const extraParts = allocate(extras, ids.map((id) => subtotal[id]));
      const total = ids.length ? itemsTotal + extras : 0;
      return { total, ids, parts: ids.map((id, index) => subtotal[id] + extraParts[index]) };
    }
    const weights = expense.split === "shares" ? expense.shares || {} : Object.fromEntries((expense.among || []).map((id) => [id, 1]));
    const ids = Object.keys(weights).filter((id) => Number(weights[id]) > 0);
    const total = ids.length ? toMinor(expense.amount, currency) : 0;
    return { total, ids, parts: allocate(total, ids.map((id) => Number(weights[id]))) };
  }

  /* The same expense converted once into the trip currency, then re-split so parts still add up. */
  function inTripCurrency(expense, trip) {
    const own = expenseParts(expense);
    const rate = expense.currency === trip.currency ? 1 : Number((trip.rates || {})[expense.currency]) || 0;
    const total = Math.round(fromMinor(own.total, expense.currency) * rate * 10 ** decimals(trip.currency));
    return { total, ids: own.ids, parts: allocate(total, own.parts) };
  }

  /* Positive balance = the group owes this member. Balances always sum to zero. */
  function balances(trip) {
    const balance = {};
    const add = (id, value) => {
      balance[id] = (balance[id] || 0) + value;
    };
    live(trip.members).forEach((member) => add(member.id, 0));
    for (const expense of live(trip.expenses)) {
      if (expense.kind === "settle") {
        const paid = toMinor(expense.amount, trip.currency);
        add(expense.from, paid);
        add(expense.to, -paid);
        continue;
      }
      const split = inTripCurrency(expense, trip);
      add(expense.paidBy, split.total);
      split.ids.forEach((id, index) => add(id, -split.parts[index]));
    }
    return balance;
  }

  /* Fewest practical payments: the biggest debtor pays the biggest creditor until all are square. */
  function settle(balance) {
    const debtors = [];
    const creditors = [];
    for (const [id, value] of Object.entries(balance)) {
      if (value < 0) debtors.push([id, -value]);
      if (value > 0) creditors.push([id, value]);
    }
    const bySize = (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1);
    const payments = [];
    while (debtors.length && creditors.length) {
      debtors.sort(bySize);
      creditors.sort(bySize);
      const amount = Math.min(debtors[0][1], creditors[0][1]);
      payments.push({ from: debtors[0][0], to: creditors[0][0], amount });
      debtors[0][1] -= amount;
      creditors[0][1] -= amount;
      if (!debtors[0][1]) debtors.shift();
      if (!creditors[0][1]) creditors.shift();
    }
    return payments;
  }

  function spent(trip) {
    return live(trip.expenses)
      .filter((expense) => expense.kind !== "settle")
      .reduce((sum, expense) => sum + inTripCurrency(expense, trip).total, 0);
  }

  const isoDate = (date) => date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  const parseDate = (iso) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  function addDays(iso, count) {
    const date = parseDate(iso);
    date.setDate(date.getDate() + count);
    return isoDate(date);
  }
  function dayList(start, end) {
    const days = [];
    if (!start || !end || end < start) return days;
    for (let day = start; day <= end && days.length < 370; day = addDays(day, 1)) days.push(day);
    return days;
  }

  /* Free windows of a clock day (08:00-22:00) that are at least 30 minutes long. */
  function gaps(events) {
    const timed = events.filter((event) => event.time).sort((a, b) => (a.time < b.time ? -1 : 1));
    const free = [];
    let cursor = DAY_START;
    for (const event of timed) {
      const start = minutes(event.time);
      if (start - cursor >= MIN_GAP) free.push({ from: cursor, to: start });
      cursor = Math.max(cursor, start + (Number(event.dur) || 60));
    }
    if (DAY_END - cursor >= MIN_GAP) free.push({ from: cursor, to: DAY_END });
    return free;
  }

  /* Merge two copies of a trip. Newest edit wins per record; votes merge per person. Order-independent. */
  function newer(a, b) {
    if ((a.u || 0) !== (b.u || 0)) return (a.u || 0) > (b.u || 0) ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }
  function mergeVotes(a, b) {
    const votes = { ...(a || {}) };
    for (const [id, stamp] of Object.entries(b || {})) {
      const mine = votes[id] || 0;
      if (Math.abs(stamp) > Math.abs(mine) || (Math.abs(stamp) === Math.abs(mine) && stamp > mine)) votes[id] = stamp;
    }
    return votes;
  }
  function mergeList(listA, listB) {
    const byId = new Map();
    for (const record of [...(listA || []), ...(listB || [])]) {
      const known = byId.get(record.id);
      if (!known) {
        byId.set(record.id, record);
        continue;
      }
      const winner = { ...newer(known, record) };
      if (known.votes || record.votes) winner.votes = mergeVotes(known.votes, record.votes);
      byId.set(record.id, winner);
    }
    return [...byId.values()].sort((a, b) => (a.c || 0) - (b.c || 0) || (a.id < b.id ? -1 : 1));
  }
  function mergeTrip(a, b) {
    const pickMeta = (trip) => Object.fromEntries(META.filter((key) => key in trip).map((key) => [key, trip[key]]));
    const merged = { ...newer(pickMeta(a), pickMeta(b)) };
    for (const list of LISTS) merged[list] = mergeList(a[list], b[list]);
    return merged;
  }


  /* Roles. Trips made before roles existed have no organizer, so everyone keeps full control there. */
  function organizers(trip) {
    const group = live(trip.members);
    const named = group.filter((member) => member.role === "organizer");
    return (named.length ? named : group).map((member) => member.id);
  }
  const isOrganizer = (trip, memberId) => organizers(trip).includes(memberId);
  /* What a person may do: "trip" (details, lock), "people" (remove, roles), "schedule" (days and times). */
  function can(trip, memberId, what) {
    if (isOrganizer(trip, memberId)) return true;
    if (what === "schedule") return !trip.locked;
    return false;
  }

  /* Saved places grouped into named collections, most used first. */
  function collections(places) {
    const counts = {};
    for (const place of live(places)) {
      const name = (place.list || "Saved").trim() || "Saved";
      counts[name] = (counts[name] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  }

  /* Stable text of a trip, used to tell whether a merge changed anything. */
  const canonical = (trip) => JSON.stringify(mergeTrip(trip, trip));

  /* Share link payload: the whole trip, compressed. No server involved. */
  const toBase64Url = (bytes) => {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const fromBase64Url = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
  async function pipe(bytes, transform) {
    const stream = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function packTrip(trip) {
    const bytes = new TextEncoder().encode(JSON.stringify(trip));
    if (typeof CompressionStream === "undefined") return "j" + toBase64Url(bytes);
    return "z" + toBase64Url(await pipe(bytes, new CompressionStream("deflate-raw")));
  }
  async function unpackTrip(payload) {
    let bytes = fromBase64Url(payload.slice(1));
    if (payload[0] === "z") bytes = await pipe(bytes, new DecompressionStream("deflate-raw"));
    const trip = JSON.parse(new TextDecoder().decode(bytes));
    if (!trip || !trip.id || !Array.isArray(trip.members)) throw new Error("not a trip");
    return trip;
  }

  /* Travel history from finished trips. `mine` maps trip id -> the member id that is "me". */
  function history(trips, today, mine) {
    const countries = {};
    const companions = {};
    const cities = new Set();
    const planned = new Set();
    const stats = { trips: 0, days: 0, flights: 0, roadTrips: 0 };
    for (const trip of trips) {
      const done = trip.end && trip.end < today;
      const visitedHere = new Set();
      for (const stop of trip.stops || []) {
        if (!stop.country) continue;
        if (!done) {
          planned.add(stop.country);
          continue;
        }
        const entry = (countries[stop.country] = countries[stop.country] || { code: stop.country, visits: 0, cities: [] });
        if (!visitedHere.has(stop.country)) entry.visits++;
        visitedHere.add(stop.country);
        const city = (stop.city || "").trim();
        if (city && !entry.cities.includes(city)) entry.cities.push(city);
        if (city) cities.add(stop.country + "/" + city.toLowerCase());
      }
      if (!done) continue;
      stats.trips++;
      stats.days += dayList(trip.start, trip.end).length;
      if (trip.transport === "flight") stats.flights++;
      if (trip.transport === "road") stats.roadTrips++;
      for (const member of live(trip.members)) {
        const name = member.name.trim();
        if (name && member.id !== (mine || {})[trip.id]) companions[name] = (companions[name] || 0) + 1;
      }
    }
    const visited = Object.values(countries).sort((a, b) => b.visits - a.visits || (a.code < b.code ? -1 : 1));
    return {
      ...stats,
      countries: visited,
      cities: cities.size,
      returnVisits: visited.filter((country) => country.visits > 1).length,
      planned: [...planned].filter((code) => !countries[code]),
      companions: Object.entries(companions).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)),
    };
  }

  function toICS(trip) {
    const escape = (text) => String(text || "").replace(/([\\;,])/g, "\\$1").replace(/\n/g, "\\n");
    const compact = (iso) => iso.replace(/-/g, "");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tagalong//EN"];
    for (const event of live(trip.events)) {
      if (!event.day) continue;
      lines.push("BEGIN:VEVENT", "UID:" + event.id + "@tagalong", "SUMMARY:" + escape(event.title));
      if (event.time) {
        const start = minutes(event.time);
        const end = Math.min(start + (Number(event.dur) || 60), 24 * 60 - 1);
        lines.push("DTSTART:" + compact(event.day) + "T" + clock(start).replace(":", "") + "00");
        lines.push("DTEND:" + compact(event.day) + "T" + clock(end).replace(":", "") + "00");
      } else {
        lines.push("DTSTART;VALUE=DATE:" + compact(event.day), "DTEND;VALUE=DATE:" + compact(addDays(event.day, 1)));
      }
      if (event.place) lines.push("LOCATION:" + escape(event.place));
      if (event.note) lines.push("DESCRIPTION:" + escape(event.note));
      lines.push("END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }

  /* "Ramen 12.50" lines from a pasted receipt -> items, with tax and tip pulled out and totals ignored. */
  function parseNumber(raw) {
    let text = raw;
    if (text.includes(",") && text.includes(".")) {
      const decimalComma = text.lastIndexOf(",") > text.lastIndexOf(".");
      text = decimalComma ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
    } else if (/,\d{1,2}$/.test(text)) text = text.replace(",", ".");
    else text = text.replace(/,/g, "");
    return Number(text);
  }
  function parseReceipt(text) {
    const result = { items: [], tax: 0, tip: 0 };
    for (const line of String(text).split(/\n/)) {
      const match = line.trim().match(/^(.*?)[\s:]+(?:[^\w\s.,-]{1,3}\s*)?(\d[\d.,]*)\s*$/);
      if (!match) continue;
      const name = match[1].trim();
      const amount = parseNumber(match[2]);
      if (!name || !isFinite(amount)) continue;
      if (/^(sub\s*total|total|amount|balance|change|cash|card|visa|master)/i.test(name)) continue;
      if (/\b(tax|gst|vat|ppn)\b/i.test(name)) result.tax += amount;
      else if (/\b(tip|service|gratuity)\b/i.test(name)) result.tip += amount;
      else result.items.push({ name, amount });
    }
    return result;
  }

  return {
    uid, live, minutes, clock, blockOf, decimals, toMinor, fromMinor, money, allocate, expenseParts, inTripCurrency,
    balances, settle, spent, isoDate, parseDate, addDays, dayList, gaps, mergeTrip, packTrip, unpackTrip, history,
    toICS, parseReceipt, organizers, isOrganizer, can, collections, canonical,
  };
});
