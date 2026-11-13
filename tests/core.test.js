const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core.js");

const sum = (list) => list.reduce((a, b) => a + b, 0);
const member = (id) => ({ id, name: id.toUpperCase(), u: 1, c: 1 });

function sampleTrip() {
  return {
    id: "t1", u: 10, name: "Tokyo", start: "2026-01-10", end: "2026-01-12", currency: "USD", rates: { JPY: 0.0065 },
    stops: [{ country: "JP", city: "Tokyo" }], transport: "flight",
    members: [member("a"), member("b"), member("c")],
    events: [],
    expenses: [
      { id: "e1", u: 1, title: "Dinner", amount: 100, currency: "USD", paidBy: "a", split: "even", among: ["a", "b", "c"] },
      { id: "e2", u: 1, title: "Taxi", amount: 10000, currency: "JPY", paidBy: "b", split: "shares", shares: { a: 2, b: 1, c: 0 } },
      {
        id: "e3", u: 1, title: "Izakaya", currency: "USD", paidBy: "c", split: "items", tax: 4.37, tip: 9,
        items: [
          { name: "Sake", amount: 20, who: ["a", "b"] },
          { name: "Yakitori", amount: 33.33, who: ["a", "b", "c"] },
          { name: "Nobody's dish", amount: 50, who: [] },
        ],
      },
    ],
  };
}

test("allocate always adds up to the total", () => {
  for (const [total, weights] of [[100, [1, 1, 1]], [1, [1, 1, 1]], [999, [3, 2, 2]], [0, [1, 2]], [7, [0, 0]], [10001, [1, 7, 13, 2]]]) {
    const parts = Core.allocate(total, weights);
    assert.equal(sum(parts), sum(weights) ? total : 0);
    assert.ok(parts.every((part) => Number.isInteger(part) && part >= 0));
  }
  assert.deepEqual(Core.allocate(100, [1, 1, 1]), [34, 33, 33]);
});

test("every split type adds up exactly to the bill", () => {
  const trip = sampleTrip();
  const even = Core.expenseParts(trip.expenses[0]);
  assert.equal(even.total, 10000);
  assert.equal(sum(even.parts), 10000);

  const shares = Core.expenseParts(trip.expenses[1]);
  assert.deepEqual(shares.ids, ["a", "b"]);
  assert.equal(sum(shares.parts), 10000);
  assert.deepEqual(shares.parts, [6667, 3333]);

  const items = Core.expenseParts(trip.expenses[2]);
  assert.equal(items.total, 2000 + 3333 + 437 + 900, "unassigned items are left out of the bill");
  assert.equal(sum(items.parts), items.total);
  const byId = Object.fromEntries(items.ids.map((id, index) => [id, items.parts[index]]));
  assert.ok(byId.a > byId.c, "the person who shared the sake pays more");
});

test("foreign expenses convert once and still add up", () => {
  const trip = sampleTrip();
  const taxi = Core.inTripCurrency(trip.expenses[1], trip);
  assert.equal(taxi.total, 6500);
  assert.equal(sum(taxi.parts), 6500);
  const noRate = Core.inTripCurrency({ ...trip.expenses[1], currency: "EUR" }, trip);
  assert.equal(noRate.total, 0);
});

test("balances sum to zero and settle-up clears them in at most n-1 payments", () => {
  const trip = sampleTrip();
  const balance = Core.balances(trip);
  assert.equal(sum(Object.values(balance)), 0);
  assert.equal(Core.spent(trip), 10000 + 6500 + 6670);
  const payments = Core.settle(balance);
  assert.ok(payments.length <= trip.members.length - 1);
  for (const payment of payments) {
    trip.expenses.push({ id: Core.uid(), u: 2, kind: "settle", from: payment.from, to: payment.to, amount: Core.fromMinor(payment.amount, "USD") });
  }
  assert.ok(Object.values(Core.balances(trip)).every((value) => value === 0));
  assert.equal(Core.spent(trip), 10000 + 6500 + 6670, "settlements are not spending");
});

test("random bills never lose a cent", () => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let round = 0; round < 300; round++) {
    const ids = ["a", "b", "c", "d", "e"].slice(0, 2 + Math.floor(random() * 4));
    const trip = { currency: "USD", rates: {}, members: ids.map(member), expenses: [] };
    for (let n = 0; n < 6; n++) {
      trip.expenses.push({
        id: "x" + n, title: "x", amount: Math.round(random() * 100000) / 100, currency: "USD",
        paidBy: ids[Math.floor(random() * ids.length)], split: "even", among: ids.filter(() => random() > 0.3),
      });
    }
    const balance = Core.balances(trip);
    assert.equal(sum(Object.values(balance)), 0);
    const payments = Core.settle(balance);
    assert.ok(payments.length <= ids.length - 1);
    assert.equal(sum(payments.map((p) => p.amount)), sum(Object.values(balance).filter((v) => v > 0)));
  }
});

test("zero-decimal currencies stay whole", () => {
  const parts = Core.expenseParts({ amount: 1000, currency: "JPY", split: "even", among: ["a", "b", "c"] });
  assert.deepEqual(parts.parts, [334, 333, 333]);
});

test("free gaps on a clock day", () => {
  const free = Core.gaps([{ time: "09:00", dur: 60 }, { time: "13:00", dur: 90 }, { time: "13:30", dur: 30 }, { time: "" }]);
  assert.deepEqual(free, [{ from: 480, to: 540 }, { from: 600, to: 780 }, { from: 870, to: 1320 }]);
  assert.deepEqual(Core.gaps([]), [{ from: 480, to: 1320 }]);
});

test("merge keeps the newest edit, is order-independent, and merges votes per person", () => {
  const base = sampleTrip();
  base.events = [{ id: "v1", u: 1, c: 1, title: "Shrine", day: "", votes: { a: 5 } }];
  const mine = structuredClone(base);
  const theirs = structuredClone(base);
  mine.events[0].title = "Meiji Shrine";
  mine.events[0].u = 20;
  mine.events[0].votes = { a: 5, b: 30 };
  theirs.events[0].votes = { a: -40, c: 25 };
  theirs.events.push({ id: "v2", u: 15, c: 2, title: "Ramen", day: "2026-01-11", block: "evening" });
  theirs.expenses[0] = { ...theirs.expenses[0], x: true, u: 50 };
  theirs.name = "Tokyo 2026";
  theirs.u = 99;

  const ab = Core.mergeTrip(mine, theirs);
  const ba = Core.mergeTrip(theirs, mine);
  assert.deepEqual(ab, ba);
  assert.equal(ab.name, "Tokyo 2026");
  assert.equal(ab.events.length, 2);
  assert.equal(ab.events[0].title, "Meiji Shrine");
  assert.deepEqual(ab.events[0].votes, { a: -40, b: 30, c: 25 });
  assert.equal(ab.expenses.find((expense) => expense.id === "e1").x, true, "a delete survives the merge");
  assert.deepEqual(Core.mergeTrip(ab, ab), ab, "merging twice changes nothing");
});

test("share link round-trips the whole trip", async () => {
  const trip = sampleTrip();
  trip.name = "Tōkyō & 京都 🚅";
  const payload = await Core.packTrip(trip);
  assert.match(payload, /^[zj][A-Za-z0-9_-]+$/);
  assert.deepEqual(await Core.unpackTrip(payload), trip);
  await assert.rejects(Core.unpackTrip("zAAAA"));
});

test("history counts countries, cities, return visits, transport and companions", () => {
  const trips = [
    { id: "1", start: "2023-03-01", end: "2023-03-05", stops: [{ country: "ID", city: "Ubud" }, { country: "ID", city: "Canggu" }], transport: "flight", members: [member("me"), member("mei")] },
    { id: "2", start: "2024-06-01", end: "2024-06-03", stops: [{ country: "ID", city: "Ubud" }, { country: "SG", city: "" }], transport: "road", members: [member("me"), member("mei"), { ...member("gone"), x: true }] },
    { id: "3", start: "2030-01-01", end: "2030-01-09", stops: [{ country: "JP", city: "Tokyo" }, { country: "ID", city: "Bali" }], transport: "flight", members: [member("me")] },
  ];
  const stats = Core.history(trips, "2026-11-13", { 1: "me", 2: "me", 3: "me" });
  assert.equal(stats.trips, 2);
  assert.equal(stats.days, 8);
  assert.equal(stats.countries.length, 2);
  assert.deepEqual(stats.countries[0], { code: "ID", visits: 2, cities: ["Ubud", "Canggu"] });
  assert.equal(stats.cities, 2);
  assert.equal(stats.returnVisits, 1);
  assert.equal(stats.flights, 1);
  assert.equal(stats.roadTrips, 1);
  assert.deepEqual(stats.planned, ["JP"]);
  assert.deepEqual(stats.companions, [["MEI", 2]]);
});

test("calendar export and receipt paste", () => {
  const ics = Core.toICS({
    events: [
      { id: "1", title: "Sushi; omakase", day: "2026-01-10", time: "19:30", dur: 90, place: "Ginza" },
      { id: "2", title: "Wander", day: "2026-01-11", block: "morning" },
      { id: "3", title: "Idea only", day: "" },
      { id: "4", title: "Deleted", day: "2026-01-11", x: true },
    ],
  });
  assert.match(ics, /DTSTART:20260110T193000\r\nDTEND:20260110T210000/);
  assert.match(ics, /SUMMARY:Sushi\\; omakase/);
  assert.match(ics, /DTSTART;VALUE=DATE:20260111\r\nDTEND;VALUE=DATE:20260112/);
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 2);

  const receipt = Core.parseReceipt("Ramen  12.50\n2x Gyoza: $9\nBeer 1.234,50\nSubtotal 30.00\nGST 2.10\nService charge 3\nTOTAL 35.10\nthank you");
  assert.deepEqual(receipt.items, [{ name: "Ramen", amount: 12.5 }, { name: "2x Gyoza", amount: 9 }, { name: "Beer", amount: 1234.5 }]);
  assert.equal(receipt.tax, 2.1);
  assert.equal(receipt.tip, 3);
});

test("dates do not drift across months or DST", () => {
  assert.deepEqual(Core.dayList("2026-02-27", "2026-03-02"), ["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
  assert.equal(Core.dayList("2026-03-05", "2026-03-01").length, 0);
  assert.equal(Core.blockOf("11:59"), "morning");
  assert.equal(Core.blockOf("17:00"), "evening");
});
