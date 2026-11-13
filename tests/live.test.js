const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core.js");
const Live = require("../live.js");

const person = (id, extra) => ({ id, name: id.toUpperCase(), u: 1, c: 1, ...extra });
const baseTrip = () => ({
  id: "t1", u: 1, name: "Seoul", currency: "KRW", rates: {}, stops: [], members: [person("a", { role: "organizer" }), person("b")],
  events: [], expenses: [], places: [],
});

test("roles: organizers do everything, members follow the plan lock", () => {
  const trip = baseTrip();
  assert.deepEqual(Core.organizers(trip), ["a"]);
  assert.equal(Core.can(trip, "a", "trip"), true);
  assert.equal(Core.can(trip, "b", "trip"), false);
  assert.equal(Core.can(trip, "b", "people"), false);
  assert.equal(Core.can(trip, "b", "schedule"), true);
  trip.locked = true;
  assert.equal(Core.can(trip, "b", "schedule"), false);
  assert.equal(Core.can(trip, "a", "schedule"), true);
});

test("roles: trips from before roles keep everyone in control", () => {
  const trip = baseTrip();
  trip.members = [person("a"), person("b")];
  assert.deepEqual(Core.organizers(trip), ["a", "b"]);
  assert.equal(Core.can(trip, "b", "people"), true);
});

test("places and the plan lock merge like everything else", () => {
  const mine = baseTrip();
  const theirs = baseTrip();
  mine.places.push({ id: "p1", u: 5, c: 1, name: "Gwangjang market", list: "Food" });
  theirs.places.push({ id: "p2", u: 6, c: 2, name: "Bukchon", list: "Walks" });
  theirs.locked = true;
  theirs.u = 9;
  const merged = Core.mergeTrip(mine, theirs);
  assert.deepEqual(merged.places.map((place) => place.id), ["p1", "p2"]);
  assert.equal(merged.locked, true);
  assert.equal(Core.canonical(Core.mergeTrip(mine, theirs)), Core.canonical(Core.mergeTrip(theirs, mine)));
  assert.deepEqual(Core.collections(merged.places), [["Food", 1], ["Walks", 1]]);
});

test("live sync: sealed snapshots only open with the right key", async () => {
  const key = Live.newKey();
  const packed = await Core.packTrip(baseTrip());
  const sealed = await Live.seal(key, packed);
  assert.ok(!Buffer.from(sealed).toString("latin1").includes("Seoul"), "ciphertext must not show the trip name");
  assert.equal(await Live.unseal(key, sealed), packed);
  await assert.rejects(Live.unseal(Live.newKey(), sealed));
  const topic = await Live.topicFor(key);
  assert.match(topic, /^tagalong\/v1\/[0-9a-f]{32}$/);
  assert.ok(!topic.includes(key));
});

test("live sync: MQTT packets round-trip through the stream reader", () => {
  const payload = new Uint8Array(70000).map((_, index) => index % 251);
  const publish = Live.publishPacket("tagalong/v1/abc", payload, true);
  assert.equal(publish[0], 0x31);
  const read = Live.packetReader();
  const parts = [publish.slice(0, 3), publish.slice(3, 40000), publish.slice(40000)];
  const seen = parts.flatMap((part) => read(part));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].topic, "tagalong/v1/abc");
  assert.equal(seen[0].retain, true);
  assert.deepEqual(Array.from(seen[0].payload.slice(0, 5)), [0, 1, 2, 3, 4]);
  assert.equal(seen[0].payload.length, 70000);
  assert.deepEqual(Array.from(Live.remainingLength(321)), [0xc1, 0x02]);
  const two = read(new Uint8Array([...Live.connectPacket("x", 30), 0xd0, 0x00]));
  assert.deepEqual(two.map((item) => item.type), [1, 13]);
});
