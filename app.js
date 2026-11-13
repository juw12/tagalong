/* Tagalong UI. State lives in localStorage; nothing is sent anywhere. */
(function () {
  "use strict";
  const C = window.Core;
  const WORLD = window.WORLD;
  const KEY = "tagalong.v1";
  const TABS = ["plan", "ideas", "places", "money", "group"];
  const PUBLIC_URL = "https://juw12.github.io/tagalong/";
  const BLOCKS = [["morning", "Morning"], ["afternoon", "Afternoon"], ["evening", "Evening"]];
  const TRANSPORT = [["", "Not set"], ["flight", "Flight"], ["road", "Road trip"], ["train", "Train"], ["boat", "Boat"]];
  const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "SGD", "IDR", "MYR", "THB", "AUD", "CAD", "CNY", "HKD", "TWD", "KRW", "INR", "VND", "PHP", "CHF", "NZD", "AED"];
  const COUNTRY = Object.fromEntries(WORLD.c.map((row) => [row[0], row[1]]));
  const ARROW_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const TAG_ICON = '<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><g transform="rotate(-18 16 16)"><path d="M12 7h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H12l-9-9z" fill="currentColor"/><circle cx="11.5" cy="16" r="2.4" fill="var(--paper)"/></g></svg>';

  const $ = (selector, root) => (root || document).querySelector(selector);
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const today = () => C.isoDate(new Date());
  const options = (pairs, selected) => pairs.map(([value, label]) => `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`).join("");
  const plural = (count, word) => count + " " + word + (count === 1 ? "" : "s");

  let state = load();
  const ui = { day: {}, list: {}, undo: null, link: "", draft: null, pending: null, timer: 0, mapBox: null, repaintLater: false };

  function load() {
    const fresh = { trips: [], mine: {}, name: "", theme: "auto", currency: "USD" };
    try {
      return { ...fresh, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
    } catch (error) {
      return fresh;
    }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (error) {
      toast("This browser's storage is full, so the last change was not saved.");
    }
  }
  function mutate(change, undoText) {
    const before = JSON.stringify(state.trips);
    change();
    save();
    render();
    syncRooms();
    if (undoText) {
      toast(undoText, () => {
        state.trips = JSON.parse(before);
        save();
        render();
      });
    }
  }
  const stamp = (record) => {
    record.u = Date.now();
    return record;
  };
  const findTrip = (id) => state.trips.find((trip) => trip.id === id);
  const people = (trip) => C.live(trip.members);
  const nameOf = (trip, id) => (trip.members.find((member) => member.id === id) || { name: "Someone" }).name;
  const me = (trip) => state.mine[trip.id];
  const canPlan = (trip) => C.can(trip, me(trip), "schedule");
  const isBoss = (trip) => C.isOrganizer(trip, me(trip));
  const youMark = (trip, member) => (member.id === me(trip) && member.name.toLowerCase() !== "you" ? " (you)" : "");
  const photo = (trip) => localStorage.getItem("tagalong.photo." + trip.id) || "";

  function fmtDay(iso, long) {
    return C.parseDate(iso).toLocaleDateString(undefined, long ? { weekday: "long", day: "numeric", month: "long" } : { day: "numeric", month: "short", year: "numeric" });
  }
  function fmtRange(trip) {
    if (!trip.start) return "No dates yet";
    return trip.start === trip.end ? fmtDay(trip.start) : fmtDay(trip.start) + " to " + fmtDay(trip.end);
  }
  function placeOf(trip) {
    const parts = (trip.stops || []).filter((stop) => stop.country).map((stop) => (stop.city ? stop.city + ", " : "") + COUNTRY[stop.country]);
    return parts.join(" · ");
  }
  function statusOf(trip) {
    const now = today();
    if (!trip.start) return "No dates yet";
    if (trip.end < now) return "Finished";
    if (trip.start <= now) return "Day " + C.dayList(trip.start, now).length + " of " + C.dayList(trip.start, trip.end).length;
    const away = C.dayList(now, trip.start).length - 1;
    return away === 1 ? "Tomorrow" : "In " + away + " days";
  }
  function fmtDuration(mins) {
    const hours = Math.floor(mins / 60);
    return (hours ? hours + " h" : "") + (hours && mins % 60 ? " " : "") + (mins % 60 ? (mins % 60) + " min" : "");
  }
  const mapsLink = (place) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(place);

  /* ---------- routing and shell ---------- */

  function route() {
    const hash = location.hash.replace(/^#\/?/, "");
    if (hash.startsWith("join=")) return { view: "join", payload: hash.slice(5) };
    const parts = hash.split("/");
    if (parts[0] === "t" && findTrip(parts[1])) return { view: "trip", trip: findTrip(parts[1]), tab: TABS.includes(parts[2]) ? parts[2] : "plan" };
    if (parts[0] === "passport") return { view: "passport" };
    return { view: "home" };
  }

  function render() {
    const current = route();
    if (current.view === "join") return void join(current.payload);
    const dark = document.documentElement.dataset.theme === "dark";
    const nav = (href, label, active) => `<a href="${href}"${active ? ' aria-current="page"' : ""}>${label}</a>`;
    const body = current.view === "trip" ? viewTrip(current.trip, current.tab) : current.view === "passport" ? viewPassport() : viewHome();
    $("#app").innerHTML = `
      <header class="top">
        <a class="brand" href="#/">${TAG_ICON}<span>Tagalong</span></a>
        <nav aria-label="Main">${nav("#/", "Trips", current.view !== "passport")}${nav("#/passport", "Passport", current.view === "passport")}</nav>
        <button class="icon-btn" data-act="theme" aria-label="Switch to ${dark ? "light" : "dark"} theme">${dark ? "Light" : "Dark"}</button>
      </header>
      <main id="main" tabindex="-1">${body}</main>
      <footer class="foot">Free, no account. Your trips stay on this device until you share a link.</footer>`;
    $('meta[name="theme-color"]').content = dark ? "#16140f" : "#f5f0e6";
    tuneDays(true);
    document.title = (current.view === "trip" ? current.trip.name + " · " : current.view === "passport" ? "Passport · " : "") + "Tagalong";
  }

  /* Day strip: keep the chosen day in view and show a fade plus arrow while more days sit off-screen. */
  function tuneDays(reveal) {
    const strip = $(".days");
    if (!strip) return;
    const pressed = $('[aria-pressed="true"]', strip);
    if (reveal && pressed) {
      const box = strip.getBoundingClientRect();
      const chip = pressed.getBoundingClientRect();
      if (chip.right > box.right - 48) strip.scrollLeft += chip.right - box.right + 56;
      else if (chip.left < box.left) strip.scrollLeft -= box.left - chip.left + 8;
    }
    const moreEnd = strip.scrollWidth - strip.clientWidth - strip.scrollLeft > 4;
    strip.parentElement.classList.toggle("more-end", moreEnd);
    strip.parentElement.classList.toggle("more-start", strip.scrollLeft > 4);
    $(".days-more", strip.parentElement).hidden = !moreEnd;
  }

  /* Passport map: a box around the countries that matter, so a phone does not show them as specks. */
  function zoomBox(codes) {
    const spots = WORLD.c.filter((row) => codes.has(row[0]));
    if (!spots.length) return null;
    const xs = spots.map((row) => row[3]);
    const ys = spots.map((row) => row[4]);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    let width = Math.max(right - left + 220, 360);
    const height = Math.max(bottom - top + 170, width * 0.75);
    width = Math.max(width, (height * 4) / 3);
    if (width >= WORLD.w * 0.8 || height > WORLD.h) return null;
    const x = Math.min(Math.max((left + right - width) / 2, 0), WORLD.w - width);
    const y = Math.min(Math.max((top + bottom - height) / 2, 0), WORLD.h - height);
    return [x, y, width, height].map(Math.round).join(" ");
  }

  /* ---------- home ---------- */

  function tripCard(trip) {
    const names = people(trip).map((member) => member.name);
    const image = photo(trip);
    return `<a class="tag${trip.end && trip.end < today() ? " done" : ""}" href="#/t/${trip.id}/plan">
      ${image ? `<img class="tag-photo" src="${image}" alt="">` : ""}
      <span class="tag-status">${esc(statusOf(trip))}</span>
      <h3>${esc(trip.name)}</h3>
      <span class="tag-line">${esc(placeOf(trip) || "Somewhere")}</span>
      <span class="tag-line">${esc(fmtRange(trip))}</span>
      <span class="tag-line people">${esc(names.join(", "))}</span>
    </a>`;
  }

  function viewHome() {
    const now = today();
    const ahead = state.trips.filter((trip) => !trip.end || trip.end >= now).sort((a, b) => (a.start || "9") < (b.start || "9") ? -1 : 1);
    const done = state.trips.filter((trip) => trip.end && trip.end < now).sort((a, b) => (a.end < b.end ? 1 : -1));
    if (!state.trips.length) {
      return `<section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Group trips without the group-chat mess</p>
          <h1>One link. Everyone's in.</h1>
          <p class="lead">Build the days together, vote on what's worth doing, and split every bill to the cent. Nobody signs up for anything, and it keeps working with no signal.</p>
          <div class="row">
            <button class="btn primary" data-act="new-trip">Start a trip</button>
            <button class="btn" data-act="sample">Look around a sample trip</button>
          </div>
        </div>
        <figure class="ticket">
          <figcaption>
            <span class="eyebrow">The sample trip</span>
            <strong>Tokyo, finally</strong>
            <span class="tag-line">5 days · 4 people · no accounts</span>
          </figcaption>
          <ol class="ticket-rows">
            <li><span>Plan</span><b>First-night izakaya</b><i>Day 1, evening</i></li>
            <li><span>Vote</span><b>Shibuya Sky at sunset</b><i>3 of 4 want this</i></li>
            <li><span>Settle</span><b data-preview="settle">Sam pays You ${C.money(23255, "JPY")}</b><i>3 payments clear everyone</i></li>
          </ol>
          <span class="stamp ticket-stamp" aria-hidden="true"><strong>Japan</strong><span>Next up</span></span>
          <button class="ticket-open" data-act="open-sample" aria-label="Open the sample trip">Open this trip ${ARROW_ICON}</button>
        </figure>
        <ol class="steps">
          <li><strong>Plan</strong> each day by the clock or just morning, afternoon, evening.</li>
          <li><strong>Share</strong> a link. It carries the whole trip, so there is no server and no login.</li>
          <li><strong>Settle</strong> with the fewest payments. Finished trips stamp your private passport.</li>
        </ol>
      </section>`;
    }
    return `<div class="page-head">
        <h1>Trips</h1>
        <div class="row">
          <button class="btn primary" data-act="new-trip">New trip</button>
          <button class="btn" data-act="past-trip">Log a past trip</button>
        </div>
      </div>
      ${ahead.length ? `<h2 class="section-title">Coming up</h2><div class="tags">${ahead.map(tripCard).join("")}</div>` : `<p class="note">Nothing coming up. Time to fix that.</p>`}
      ${done.length ? `<h2 class="section-title">Been there</h2><div class="tags">${done.map(tripCard).join("")}</div>` : ""}
      ${state.trips.some((trip) => trip.sample) ? `<p class="note">The sample trips are only on this device. <button class="link" data-act="clear-sample">Remove them</button></p>` : ""}`;
  }

  /* ---------- trip ---------- */

  function viewTrip(trip, tab) {
    const ideas = C.live(trip.events).filter((event) => !event.day).length;
    const saved = C.live(trip.places).length;
    const labels = { plan: "Plan", ideas: "Ideas" + (ideas ? " (" + ideas + ")" : ""), places: "Places" + (saved ? " (" + saved + ")" : ""), money: "Money", group: "Group" };
    const image = photo(trip);
    const views = { plan: viewPlan, ideas: viewIdeas, places: viewPlaces, money: viewMoney, group: viewGroup };
    return `<div class="trip-head${image ? " has-photo" : ""}"${image ? ` style="background-image:linear-gradient(rgba(20,18,14,.35),rgba(20,18,14,.78)),url(${image})"` : ""}>
        <p class="eyebrow">${esc(statusOf(trip))}</p>
        <h1>${esc(trip.name)}</h1>
        <p class="sub">${esc([fmtRange(trip), placeOf(trip), plural(people(trip).length, "person").replace("persons", "people")].filter(Boolean).join(" · "))}</p>
        <div class="trip-actions">
          <button class="btn small invite" data-act="invite">Invite</button>
          ${trip.live && trip.live.key ? `<span class="live-pill" data-live-status="${trip.id}">${esc(liveText(trip))}</span>` : ""}
          ${trip.locked ? `<span class="live-pill">Plan locked</span>` : ""}
        </div>
      </div>
      <nav class="tabs" aria-label="Trip sections">
        ${TABS.map((name) => `<a href="#/t/${trip.id}/${name}"${name === tab ? ' aria-current="page"' : ""}${name === "ideas" ? ' data-drop-day=""' : ""}>${labels[name]}</a>`).join("")}
      </nav>
      <section class="tab tab-${tab}">${views[tab](trip)}</section>`;
  }

  function eventRow(trip, event, showTime) {
    const linked = C.live(trip.expenses).filter((expense) => expense.eventId === event.id);
    const cost = linked.reduce((sum, expense) => sum + C.inTripCurrency(expense, trip).total, 0);
    const detail = [event.place, event.note].filter(Boolean).join(" · ");
    return `<article class="event" draggable="${canPlan(trip)}" data-event="${event.id}">
      <button class="event-main" data-act="edit-event" data-id="${event.id}" aria-label="Edit ${esc(event.title)}">
        ${showTime && event.time ? `<span class="when">${event.time}<small>${fmtDuration(Number(event.dur) || 60)}</small></span>` : ""}
        <span class="what"><strong>${esc(event.title)}</strong>${detail ? `<small>${esc(detail)}</small>` : ""}${linked.length ? `<small class="cost">${C.money(cost, trip.currency)} logged</small>` : ""}</span>
      </button>
      ${event.place ? `<a class="map" href="${mapsLink(event.place)}" target="_blank" rel="noopener" aria-label="Open ${esc(event.place)} in Google Maps">Map</a>` : ""}
    </article>`;
  }

  function viewPlan(trip) {
    const days = C.dayList(trip.start, trip.end);
    if (!days.length) return `<p class="note">This trip has no dates yet. <button class="link" data-act="edit-trip">Add dates</button> to plan day by day, or park things under Ideas for now.</p>`;
    const now = today();
    const day = days.includes(ui.day[trip.id]) ? ui.day[trip.id] : days.includes(now) ? now : days[0];
    ui.day[trip.id] = day;
    const all = C.live(trip.events);
    const here = all.filter((event) => event.day === day).sort((a, b) => (a.time || "99") < (b.time || "99") ? -1 : (a.time || "99") > (b.time || "99") ? 1 : (a.c || 0) - (b.c || 0));
    const byClock = (trip.dayModes || {})[day] === "clock";
    const open = canPlan(trip);
    const strip = days.map((iso, index) => {
      const date = C.parseDate(iso);
      const count = all.filter((event) => event.day === iso).length;
      return `<button class="day" data-act="day" data-day="${iso}" data-drop-day="${iso}" aria-pressed="${iso === day}" aria-label="${esc(fmtDay(iso, true))}, ${plural(count, "plan")}">
        <small>Day ${index + 1}</small><b>${date.toLocaleDateString(undefined, { weekday: "short" })} ${date.getDate()}</b><i>${count ? plural(count, "plan") : "open"}</i>
      </button>`;
    }).join("");

    let body;
    if (byClock) {
      const rows = here.filter((event) => event.time).map((event) => ({ at: C.minutes(event.time), html: eventRow(trip, event, true) }));
      for (const gap of open ? C.gaps(here) : []) {
        rows.push({
          at: gap.from - 0.5,
          html: `<button class="gap" data-act="add-event" data-day="${day}" data-time="${C.clock(gap.from)}">
            <span>${C.clock(gap.from)} to ${C.clock(gap.to)}</span><span>${fmtDuration(gap.to - gap.from)} free. Fill it</span></button>`,
        });
      }
      const loose = here.filter((event) => !event.time);
      body = `<div class="timeline">${rows.sort((a, b) => a.at - b.at).map((row) => row.html).join("")}</div>
        ${loose.length ? `<h3 class="block-title">No time yet</h3>${loose.map((event) => eventRow(trip, event, false)).join("")}` : ""}`;
    } else {
      body = `<div class="blocks">${BLOCKS.map(([key, label]) => {
        const inBlock = here.filter((event) => (event.time ? C.blockOf(event.time) : event.block || "morning") === key);
        return `<section class="block" data-drop-day="${day}" data-drop-block="${key}">
          <h3 class="block-title">${label}</h3>
          ${inBlock.map((event) => eventRow(trip, event, true)).join("") || `<p class="hollow">Nothing yet</p>`}
          ${open ? `<button class="btn ghost" data-act="add-event" data-day="${day}" data-block="${key}" aria-label="Add to ${label.toLowerCase()}">Add</button>` : ""}
        </section>`;
      }).join("")}</div>`;
    }
    return `<div class="days-wrap"><div class="days">${strip}</div><button class="days-more" data-act="days-next" aria-label="Show later days" hidden>${ARROW_ICON}</button></div>
      <div class="day-head">
        <h2>${esc(fmtDay(day, true))}</h2>
        ${open ? `<div class="seg" role="group" aria-label="How to lay out this day">
          <button data-act="mode" data-mode="" aria-pressed="${!byClock}">Loose</button>
          <button data-act="mode" data-mode="clock" aria-pressed="${byClock}">By the clock</button>
        </div>` : ""}
      </div>
      ${open ? "" : `<p class="note">The organizers locked the plan. You can still add ideas, vote, save places and log expenses.</p>`}
      ${body}`;
  }

  function viewIdeas(trip) {
    const votesOf = (event) => Object.entries(event.votes || {}).filter(([, stampValue]) => stampValue > 0).map(([id]) => id);
    const ideas = C.live(trip.events).filter((event) => !event.day).sort((a, b) => votesOf(b).length - votesOf(a).length || (a.c || 0) - (b.c || 0));
    const list = ideas.map((event) => {
      const voters = votesOf(event);
      const mine = voters.includes(me(trip));
      const detail = [event.place, event.note].filter(Boolean).join(" · ");
      return `<article class="idea" draggable="${canPlan(trip)}" data-event="${event.id}">
        <button class="vote" data-act="vote" data-id="${event.id}" aria-pressed="${mine}" aria-label="${mine ? "Remove your vote for" : "Vote for"} ${esc(event.title)}, ${plural(voters.length, "vote")}"><span aria-hidden="true">&#9650;</span><b>${voters.length}</b></button>
        <div class="what"><strong>${esc(event.title)}</strong>${detail ? `<small>${esc(detail)}</small>` : ""}
          <small>${voters.length ? esc(voters.map((id) => nameOf(trip, id)).join(", ")) + (voters.length === 1 && nameOf(trip, voters[0]).toLowerCase() !== "you" ? " wants this" : " want this") : "No votes yet"}</small></div>
        <button class="btn small" data-act="edit-event" data-id="${event.id}" aria-label="${canPlan(trip) ? "Schedule" : "Details of"} ${esc(event.title)}">${canPlan(trip) ? "Schedule" : "Details"}</button>
      </article>`;
    }).join("");
    return `<form class="quick" data-form="quick-idea">
        <input name="title" required maxlength="80" placeholder="Something worth doing, e.g. sunset at the lookout" aria-label="New idea">
        <button class="btn primary">Add idea</button>
      </form>
      ${list || `<p class="note">Ideas wait here until the group agrees. Everyone gets one vote per idea; the favourites float to the top, then you give them a day.</p>`}`;
  }

  function splitLabel(trip, expense) {
    if (expense.split === "items") return "by item";
    if (expense.split === "shares") return "by shares";
    const count = (expense.among || []).length;
    return count === people(trip).length ? "split evenly" : "split " + count + " ways";
  }

  function viewMoney(trip) {
    const expenses = C.live(trip.expenses).sort((a, b) => (b.c || 0) - (a.c || 0));
    const balance = C.balances(trip);
    const payments = C.settle(balance);
    const total = C.spent(trip);
    const cur = trip.currency;
    let myShare = 0;
    const rows = expenses.map((expense) => {
      if (expense.kind === "settle") {
        return `<div class="expense settle"><span class="what"><strong>${esc(nameOf(trip, expense.from))} paid back ${esc(nameOf(trip, expense.to))}</strong><small>Settle-up</small></span>
          <span class="amount">${C.money(C.toMinor(expense.amount, cur), cur)}</span>
          <button class="btn small" data-act="delete-expense" data-id="${expense.id}" aria-label="Remove this payment">Remove</button></div>`;
      }
      const split = C.inTripCurrency(expense, trip);
      const mineIndex = split.ids.indexOf(me(trip));
      if (mineIndex >= 0) myShare += split.parts[mineIndex];
      const foreign = expense.currency !== cur;
      const missingRate = foreign && !Number((trip.rates || {})[expense.currency]);
      return `<button class="expense" data-act="edit-expense" data-id="${expense.id}" data-minor="${split.total}">
        <span class="what"><strong>${esc(expense.title)}</strong><small>${esc(nameOf(trip, expense.paidBy))} paid, ${splitLabel(trip, expense)}${foreign ? " · " + C.money(C.expenseParts(expense).total, expense.currency) : ""}</small>
          ${missingRate ? `<small class="warn">Needs a ${expense.currency} rate to count</small>` : ""}</span>
        <span class="amount">${C.money(split.total, cur)}</span>
      </button>`;
    }).join("");
    const balanceRows = people(trip).map((member) => {
      const value = balance[member.id] || 0;
      const words = value > 0 ? "gets back " + C.money(value, cur) : value < 0 ? "owes " + C.money(-value, cur) : "all square";
      return `<li class="${value > 0 ? "plus" : value < 0 ? "minus" : ""}" data-balance="${value}"><span>${esc(member.name)}${youMark(trip, member)}</span><span>${words}</span></li>`;
    }).join("");
    const settleRows = payments.map((payment) => `<li>
        <span><strong>${esc(nameOf(trip, payment.from))}</strong> pays <strong>${esc(nameOf(trip, payment.to))}</strong> <b class="amount">${C.money(payment.amount, cur)}</b></span>
        <button class="btn small" data-act="mark-paid" data-from="${payment.from}" data-to="${payment.to}" data-amount="${payment.amount}">Mark paid</button>
      </li>`).join("");
    return `<div class="money-top">
        <dl class="totals">
          <div><dt>Group spent</dt><dd data-total="${total}">${C.money(total, cur)}</dd></div>
          <div><dt>Your share</dt><dd>${C.money(myShare, cur)}</dd></div>
        </dl>
        <button class="btn primary" data-act="add-expense">Add expense</button>
      </div>
      <div class="money-grid">
        <div>
          <h2 class="section-title">Who owes whom</h2>
          <ul class="balances">${balanceRows}</ul>
          ${payments.length
            ? `<h2 class="section-title">Settle up in ${plural(payments.length, "payment")}</h2><ul class="settle-list">${settleRows}</ul>`
            : expenses.length ? `<p class="note good">Everyone is square.</p>` : ""}
        </div>
        <div>
          <h2 class="section-title">Expenses</h2>
          ${rows || `<p class="note">Log the first shared cost. Split it evenly, by shares, or item by item with tax and tip, in any currency.</p>`}
        </div>
      </div>`;
  }

  function viewGroup(trip) {
    const mine = me(trip);
    const boss = isBoss(trip);
    const named = trip.members.some((member) => !member.x && member.role === "organizer");
    const organizers = C.organizers(trip);
    const members = people(trip).map((member) => {
      const leads = named && organizers.includes(member.id);
      const self = member.id === mine;
      const buttons = [];
      if (boss || self) buttons.push(`<button class="btn small" data-act="rename-member" data-id="${member.id}" aria-label="Rename ${esc(member.name)}">Rename</button>`);
      if (boss && !self) {
        buttons.push(leads
          ? `<button class="btn small" data-act="set-role" data-id="${member.id}" data-role="member" aria-label="Make ${esc(member.name)} a member">Make member</button>`
          : `<button class="btn small" data-act="set-role" data-id="${member.id}" data-role="organizer" aria-label="Make ${esc(member.name)} an organizer">Make organizer</button>`);
        buttons.push(`<button class="btn small" data-act="remove-member" data-id="${member.id}" aria-label="Remove ${esc(member.name)}">Remove</button>`);
      }
      return `<li>
        <span>${esc(member.name)}${youMark(trip, member)}${leads ? ` <span class="role">Organizer</span>` : ""}</span>
        <span class="row">${buttons.join("")}</span>
      </li>`;
    }).join("");
    const liveOn = Boolean(trip.live && trip.live.key);
    const status = rooms[trip.id] ? rooms[trip.id].status : null;
    const heard = rooms[trip.id] && rooms[trip.id].heard;
    return `<div class="group-grid">
      <div class="panel">
        <h2 class="section-title">Invite the group</h2>
        <p class="note">The link carries the whole trip. Whoever opens it gets their own copy, offline included.${liveOn ? " Live sync is on, so their copy stays in step with yours." : " To sync up later, send a fresh link: opening it merges both sides and keeps the newest edit of everything."}</p>
        <div class="row">
          <button class="btn primary" data-act="share">Invite link</button>
          <button class="btn" data-act="ics">Add to calendar</button>
        </div>
        <form class="quick" data-form="merge-link">
          <input name="link" required placeholder="Paste a link someone sent you" aria-label="Link to merge">
          <button class="btn">Merge</button>
        </form>
      </div>
      <div class="panel">
        <h2 class="section-title">Live sync</h2>
        ${liveOn
          ? `<p class="note"><b data-live-status="${trip.id}">${esc(liveText(trip))}</b>${status ? ` · ${status.up} of ${status.total} relays` : ""}${heard ? ` · last change from the group at ${new Date(heard).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</p>
             <p class="note">Changes reach everyone who opened an invite link, within seconds while they are online and the next time they open the app if not. Everything is locked with a key that only exists inside your invite links; the free public relays that pass it on see scrambled bytes.</p>
             ${boss ? `<button class="btn" data-act="live-off">Turn live sync off</button>` : ""}`
          : `<p class="note">Off. Turn it on and every change reaches the group within seconds, no account needed. It uses free public relays, end-to-end encrypted with a key that only travels inside your invite links.</p>
             ${boss ? `<button class="btn primary" data-act="live-on">Turn on live sync</button>` : `<p class="note">An organizer can turn it on.</p>`}`}
      </div>
      <div class="panel">
        <h2 class="section-title">People</h2>
        <label class="field">You are
          <select data-change="me">${options(people(trip).map((member) => [member.id, member.name]), mine)}</select>
        </label>
        <ul class="members">${members}</ul>
        <form class="quick" data-form="add-member">
          <input name="name" required maxlength="40" placeholder="Add someone by name" aria-label="New person's name">
          <button class="btn">Add</button>
        </form>
        <p class="note small">Organizers edit the trip, people and roles, and can lock the plan. Roles are kept by the app on every copy; they are not a password.</p>
      </div>
      <div class="panel">
        <h2 class="section-title">This trip</h2>
        ${boss ? `<label class="check switch"><input type="checkbox" data-change="lock"${trip.locked ? " checked" : ""}>Lock the plan: only organizers change days and times. Everyone can still add ideas, vote and log expenses.</label>` : trip.locked ? `<p class="note">The organizers locked the plan.</p>` : ""}
        <div class="row">
          ${C.can(trip, mine, "trip") ? `<button class="btn" data-act="edit-trip">Edit details</button>` : ""}
          <label class="btn file">Cover photo<input type="file" accept="image/*" data-change="photo"></label>
          <button class="btn danger" data-act="delete-trip">${boss ? "Delete trip" : "Remove from this device"}</button>
        </div>
      </div>
    </div>`;
  }

  /* ---------- places ---------- */

  function viewPlaces(trip) {
    const places = C.live(trip.places).sort((a, b) => (b.c || 0) - (a.c || 0));
    const lists = C.collections(trip.places);
    const filter = lists.some(([name]) => name === ui.list[trip.id]) ? ui.list[trip.id] : "";
    const listOf = (place) => (place.list || "Saved").trim() || "Saved";
    const shown = places.filter((place) => !filter || listOf(place) === filter);
    const planned = new Set(C.live(trip.events).map((event) => event.placeId).filter(Boolean));
    const chips = lists.length > 1
      ? `<div class="lists" role="group" aria-label="Collections">${[["", "All", places.length]].concat(lists.map(([name, count]) => [name, name, count])).map(([value, label, count]) =>
          `<button data-act="list" data-list="${esc(value)}" aria-pressed="${value === filter}">${esc(label)} <b>${count}</b></button>`).join("")}</div>`
      : "";
    const rows = shown.map((place) => {
      const detail = [listOf(place), place.address].filter(Boolean).join(" · ");
      return `<article class="event place">
        <button class="event-main" data-act="edit-place" data-id="${place.id}" aria-label="Edit ${esc(place.name)}">
          <span class="what"><strong>${esc(place.name)}</strong><small>${esc(detail)}</small>${place.note ? `<small>${esc(place.note)}</small>` : ""}</span>
        </button>
        <a class="map" href="${mapsLink(place.address || place.name)}" target="_blank" rel="noopener" aria-label="Open ${esc(place.name)} in Google Maps">Map</a>
        ${planned.has(place.id) ? `<span class="tagline">In ideas</span>` : `<button class="btn small" data-act="place-idea" data-id="${place.id}" aria-label="Add ${esc(place.name)} to ideas">To ideas</button>`}
      </article>`;
    }).join("");
    return `<div class="money-top">
        <p class="note">Save places as you find them and sort them into collections: food, sights, a friend's tips. One tap turns a place into an idea the group can vote on.</p>
        <button class="btn primary" data-act="add-place">Save a place</button>
      </div>
      ${chips}
      ${rows || `<p class="note">No places yet. Save the ramen shop someone mentioned, the lookout from that video, the hotel shortlist.</p>`}`;
  }

  /* ---------- passport ---------- */

  function viewPassport() {
    const stats = C.history(state.trips, today(), state.mine);
    const been = new Set(stats.countries.map((country) => country.code));
    const next = new Set(stats.planned);
    const shapes = [];
    const dots = [];
    for (const [code, name, path, x, y] of WORLD.c) {
      const cls = been.has(code) ? "been" : next.has(code) ? "next" : "";
      if (path) shapes.push(`<path d="${path}"${cls ? ` class="${cls}"` : ""}><title>${esc(name)}</title></path>`);
      else if (cls) dots.push(`<circle cx="${x}" cy="${y}" r="6" class="${cls}"><title>${esc(name)}</title></circle>`);
    }
    const box = zoomBox(new Set([...been, ...next]));
    const zoomed = Boolean(box) && (ui.zoom == null ? matchMedia("(max-width: 599px)").matches : ui.zoom);
    const viewBox = ui.mapBox || (zoomed ? box : `0 0 ${WORLD.w} ${WORLD.h}`);
    const figures = [
      [stats.countries.length, "Countries"], [stats.cities, "Cities"], [stats.trips, "Trips"], [stats.days, "Days away"],
      [stats.returnVisits, "Return visits"], [stats.flights, "Flights"], [stats.roadTrips, "Road trips"],
    ];
    const stamps = stats.countries.map((country) => `<li class="stamp">
        <strong>${esc(COUNTRY[country.code] || country.code)}</strong>
        <span>${country.visits > 1 ? plural(country.visits, "visit") : "1 visit"}</span>
        ${country.cities.length ? `<small>${esc(country.cities.join(", "))}</small>` : ""}
      </li>`).join("");
    const done = state.trips.filter((trip) => trip.end && trip.end < today()).sort((a, b) => (a.end < b.end ? 1 : -1));
    return `<div class="page-head">
        <div><h1>Passport</h1><p class="sub">Where you have been. Kept on this device, seen by nobody else.</p></div>
        <div class="row"><button class="btn primary" data-act="past-trip">Log a past trip</button></div>
      </div>
      <dl class="figures">${figures.map(([value, label]) => `<div><dd>${value}</dd><dt>${label}</dt></div>`).join("")}</dl>
      <figure class="map-wrap">
        <svg class="world" viewBox="${viewBox}" tabindex="0" role="img" aria-label="World map with ${plural(stats.countries.length, "country").replace("countrys", "countries")} visited. Drag to move, pinch or use the plus and minus keys to zoom.">${shapes.join("")}${dots.join("")}</svg>
        <div class="map-tools" role="group" aria-label="Map zoom">
          <button class="icon-btn" data-act="map-in" aria-label="Zoom in">+</button>
          <button class="icon-btn" data-act="map-out" aria-label="Zoom out">&minus;</button>
        </div>
        <figcaption>
          <span><span class="key been"></span>Been there <span class="key next"></span>Planned</span>
          ${box ? `<button class="link" data-act="map-zoom" data-zoom="${zoomed && !ui.mapBox ? 0 : 1}">${zoomed && !ui.mapBox ? "Whole world" : "Zoom to my trips"}</button>` : `<button class="link" data-act="map-zoom" data-zoom="0">Whole world</button>`}
        </figcaption>
      </figure>
      ${stamps
        ? `<h2 class="section-title">Stamps</h2><ul class="stamps">${stamps}</ul>`
        : `<p class="note">No stamps yet. Log a trip you have already taken, or just use Tagalong for the next one: when a trip ends it lands here by itself.</p>`}
      ${stats.planned.length ? `<p class="note">Next up: ${esc(stats.planned.map((code) => COUNTRY[code] || code).join(", "))}.</p>` : ""}
      ${stats.companions.length ? `<h2 class="section-title">Travelled with</h2><ul class="chips">${stats.companions.map(([name, count]) => `<li>${esc(name)} <b>${plural(count, "trip")}</b></li>`).join("")}</ul>` : ""}
      ${done.length ? `<h2 class="section-title">Trip log</h2><div class="tags">${done.map(tripCard).join("")}</div>` : ""}
      <div class="panel backup">
        <h2 class="section-title">Backup</h2>
        <p class="note">Everything lives in this browser. Save a backup file before clearing site data or switching phones.</p>
        <div class="row">
          <button class="btn" data-act="export">Save backup</button>
          <label class="btn file">Restore backup<input type="file" accept="application/json,.json" data-change="import"></label>
        </div>
      </div>`;
  }

  /* ---------- sheets (dialogs) ---------- */

  function openSheet(title, body, form, footer, settings) {
    const withSave = !(settings && settings.save === false);
    const sheet = $("#sheet");
    sheet.innerHTML = `<form data-form="${form}" novalidate>
      <header><h2 id="sheet-title">${esc(title)}</h2><button type="button" class="icon-btn" data-act="close" aria-label="Close">Close</button></header>
      <div class="sheet-body">${body}</div>
      <p class="form-error" role="alert" hidden></p>
      <footer>${footer || ""}${withSave ? `<button class="btn primary">Save</button>` : ""}</footer>
    </form>`;
    if (!sheet.open) sheet.showModal();
  }
  function closeSheet() {
    const sheet = $("#sheet");
    if (sheet.open) sheet.close();
    ui.draft = null;
  }
  function formError(text) {
    const box = $("#sheet .form-error");
    box.textContent = text;
    box.hidden = false;
    return false;
  }
  const field = (label, control, cls) => `<label class="field${cls ? " " + cls : ""}">${label}${control}</label>`;
  const countryPairs = [["", "Pick a country"]].concat(WORLD.c.map((row) => [row[0], row[1]]));
  const stopRow = (stop) => `<div class="stop">
      <select name="country" aria-label="Country">${options(countryPairs, stop.country || "")}</select>
      <input name="city" placeholder="City or area" aria-label="City or area" maxlength="60" value="${esc(stop.city)}">
    </div>`;

  function tripSheet(trip, past) {
    const isNew = !trip;
    const draft = trip || { name: "", start: "", end: "", currency: state.currency, transport: "", stops: [{}] };
    ui.draft = { tripId: trip && trip.id };
    openSheet(isNew ? (past ? "Log a past trip" : "New trip") : "Trip details", `
      ${field("Trip name", `<input name="name" required maxlength="60" value="${esc(draft.name)}" placeholder="${past ? "Lisbon with Dad" : "Tokyo in spring"}">`)}
      <fieldset><legend>Where</legend><div id="stops">${(draft.stops && draft.stops.length ? draft.stops : [{}]).map(stopRow).join("")}</div>
        <button type="button" class="btn small" data-act="add-stop">Add another stop</button></fieldset>
      <div class="pair">${field("From", `<input type="date" name="start" value="${draft.start || ""}">`)}${field("To", `<input type="date" name="end" value="${draft.end || ""}">`)}</div>
      <div class="pair">${field("Money in", `<select name="currency">${options(CURRENCIES.map((code) => [code, code]), draft.currency)}</select>`)}
        ${field("Getting there", `<select name="transport">${options(TRANSPORT, draft.transport || "")}</select>`)}</div>
      ${isNew ? `<div class="pair">${field("Your name", `<input name="me" maxlength="40" value="${esc(state.name)}" placeholder="You">`)}
        ${field("Who else is coming", `<input name="others" placeholder="Mei, Arif, Sam">`)}</div>` : ""}`, "trip");
  }

  function eventSheet(trip, event, preset) {
    const isNew = !event;
    const draft = event || { title: "", day: "", block: "morning", time: "", dur: 60, place: "", note: "", ...preset };
    const days = C.dayList(trip.start, trip.end).map((iso, index) => [iso, "Day " + (index + 1) + " · " + fmtDay(iso, true)]);
    const durations = [30, 60, 90, 120, 180, 240, 360].map((mins) => [String(mins), fmtDuration(mins)]);
    ui.draft = { tripId: trip.id, id: event && event.id };
    const locked = !canPlan(trip);
    const readOnly = locked && !isNew && Boolean(draft.day);
    const timing = `${field("When", `<select name="day">${options([["", "Not scheduled (keep under Ideas)"]].concat(days), draft.day || "")}</select>`)}
      <div class="pair three">${field("Part of day", `<select name="block">${options(BLOCKS, draft.time ? C.blockOf(draft.time) : draft.block || "morning")}</select>`)}
        ${field("Start time (optional)", `<input type="time" name="time" value="${draft.time || ""}">`)}
        ${field("Lasts", `<select name="dur">${options(durations, String(draft.dur || 60))}</select>`)}</div>`;
    openSheet(readOnly ? draft.title : isNew ? "Add to the plan" : "Edit", `
      ${locked ? `<p class="note">The organizers locked the plan, so only they change days and times.</p>` : ""}
      <fieldset class="plain"${readOnly ? " disabled" : ""}>
      ${field("What", `<input name="title" required maxlength="80" value="${esc(draft.title)}" placeholder="Breakfast at the fish market">`)}
      ${locked ? `<fieldset class="plain" disabled>${timing}</fieldset>` : timing}
      ${field("Place", `<input name="place" maxlength="120" value="${esc(draft.place)}" placeholder="Name or address, opens in Google Maps">`)}
      ${field("Note", `<textarea name="note" rows="2" maxlength="300">${esc(draft.note)}</textarea>`)}
      </fieldset>`,
      "event", isNew || locked ? "" : `<button type="button" class="btn danger" data-act="delete-event">Delete</button>`, { save: !readOnly });
  }

  function expenseBody(trip, draft) {
    const group = people(trip);
    const foreign = draft.currency !== trip.currency;
    const checks = (name, chosen) => group.map((member) => `<label class="check"><input type="checkbox" name="${name}" value="${member.id}"${chosen.includes(member.id) ? " checked" : ""}>${esc(member.name)}</label>`).join("");
    let split;
    if (draft.split === "shares") {
      split = `<fieldset><legend>Shares (0 leaves someone out)</legend><div class="shares">${group.map((member) => field(esc(member.name), `<input type="number" inputmode="decimal" min="0" step="any" name="share-${member.id}" value="${draft.shares[member.id] == null ? 1 : draft.shares[member.id]}">`)).join("")}</div></fieldset>`;
    } else if (draft.split === "items") {
      split = `<fieldset><legend>Items</legend>
        ${draft.items.map((item, index) => `<div class="item">
          <div class="pair"><input name="item-name" aria-label="Item ${index + 1} name" placeholder="Item" value="${esc(item.name)}">
          <input name="item-amount" aria-label="Item ${index + 1} price" type="number" inputmode="decimal" min="0" step="any" placeholder="0.00" value="${esc(item.amount)}"></div>
          <div class="checks">${checks("item-who-" + index, item.who)}</div></div>`).join("")}
        <button type="button" class="btn small" data-act="add-item">Add item</button>
        <div class="pair">${field("Tax", `<input name="tax" type="number" inputmode="decimal" min="0" step="any" value="${esc(draft.tax)}">`)}${field("Tip or service", `<input name="tip" type="number" inputmode="decimal" min="0" step="any" value="${esc(draft.tip)}">`)}</div>
        <div class="row scan-row">
          <label class="btn small file">Scan a receipt<input type="file" accept="image/*" data-change="scan" aria-label="Scan a receipt photo"></label>
          <span class="scan-status note" role="status">${esc(draft.scanNote || "")}</span>
        </div>
        <details${draft.receipt ? " open" : ""}><summary>Paste or check the receipt text</summary>
          ${field("One line per item, price at the end", `<textarea name="receipt" rows="4" placeholder="Ramen 12.50&#10;Gyoza 9&#10;Service 10%? Type the amount: Service 2.15">${esc(draft.receipt)}</textarea>`)}
          <button type="button" class="btn small" data-act="parse-receipt">Turn lines into items</button></details>
      </fieldset>`;
    } else {
      split = `<fieldset><legend>Split between</legend><div class="checks">${checks("among", draft.among)}</div></fieldset>`;
    }
    const events = [["", "Not linked"]].concat(C.live(trip.events).map((event) => [event.id, event.title]));
    return `${field("What for", `<input name="title" required maxlength="80" value="${esc(draft.title)}" placeholder="Dinner, taxi, tickets">`)}
      <div class="pair three">
        ${draft.split === "items" ? "" : field("Amount", `<input name="amount" type="number" inputmode="decimal" min="0" step="any" required value="${esc(draft.amount)}" placeholder="0.00">`)}
        ${field("Currency", `<select name="currency" data-change="expense-redraw">${options(CURRENCIES.map((code) => [code, code]), draft.currency)}</select>`)}
        ${field("Paid by", `<select name="paidBy">${options(group.map((member) => [member.id, member.name]), draft.paidBy)}</select>`)}
      </div>
      ${foreign ? field(`Rate: 1 ${draft.currency} in ${trip.currency}`, `<input name="rate" type="number" inputmode="decimal" min="0" step="any" value="${esc(draft.rate)}" placeholder="What your bank charged">`) : ""}
      <div class="seg wide" role="group" aria-label="How to split">
        ${[["even", "Evenly"], ["shares", "By shares"], ["items", "By item"]].map(([key, label]) => `<button type="button" data-act="split" data-split="${key}" aria-pressed="${draft.split === key}">${label}</button>`).join("")}
      </div>
      ${split}
      ${field("Linked to", `<select name="eventId">${options(events, draft.eventId || "")}</select>`)}`;
  }
  function readExpense(trip, draft) {
    const data = new FormData($("#sheet form"));
    const text = (name) => String(data.get(name) || "").trim();
    draft.title = text("title");
    draft.currency = text("currency");
    draft.paidBy = text("paidBy");
    draft.eventId = text("eventId");
    if (data.has("rate")) draft.rate = text("rate");
    else draft.rate = (trip.rates || {})[draft.currency] || "";
    if (data.has("amount")) draft.amount = text("amount");
    if (draft.split === "even") draft.among = data.getAll("among");
    if (draft.split === "shares") draft.shares = Object.fromEntries(people(trip).map((member) => [member.id, Number(data.get("share-" + member.id)) || 0]));
    if (draft.split === "items") {
      const amounts = data.getAll("item-amount");
      draft.items = data.getAll("item-name").map((name, index) => ({ name: String(name).trim(), amount: amounts[index], who: data.getAll("item-who-" + index) }));
      draft.tax = text("tax");
      draft.tip = text("tip");
      draft.receipt = text("receipt");
    }
  }
  function expenseSheet(trip, expense) {
    const everyone = people(trip).map((member) => member.id);
    const draft = expense
      ? { among: everyone, shares: {}, items: [], tax: "", tip: "", receipt: "", ...JSON.parse(JSON.stringify(expense)), rate: (trip.rates || {})[expense.currency] || "" }
      : { title: "", amount: "", currency: trip.currency, paidBy: me(trip) || everyone[0], split: "even", among: everyone, shares: {}, items: [], tax: "", tip: "", receipt: "", eventId: "", rate: "" };
    if (!draft.items.length) draft.items = [{ name: "", amount: "", who: everyone }];
    ui.draft = { tripId: trip.id, id: expense && expense.id, expense: draft };
    openSheet(expense ? "Edit expense" : "Add expense", expenseBody(trip, draft), "expense", expense ? `<button type="button" class="btn danger" data-act="delete-expense" data-id="${expense.id}">Delete</button>` : "");
  }
  function redrawExpense(change) {
    const trip = findTrip(ui.draft.tripId);
    const draft = ui.draft.expense;
    readExpense(trip, draft);
    if (change) change(draft, trip);
    $("#sheet .sheet-body").innerHTML = expenseBody(trip, draft);
  }

  const inviteBase = () => (window.Capacitor || location.protocol === "capacitor:" ? PUBLIC_URL : location.origin + location.pathname);
  async function inviteSheet(trip) {
    ui.link = inviteBase() + "#join=" + (await C.packTrip(trip));
    const liveOn = Boolean(trip.live && trip.live.key);
    openSheet("Invite to " + trip.name, `
      <p class="note">The link carries the whole trip${liveOn ? " and its live sync key, so everyone who opens it stays in step with you" : ""}. Anyone with the link can join, so send it only to the group.</p>
      <label class="field">Invite link<input id="invite-link" readonly value="${esc(ui.link)}"></label>
      <p class="copy-state note" role="status"></p>`, "invite",
      `${navigator.share ? `<button type="button" class="btn" data-act="native-share">Share</button>` : ""}<button type="button" class="btn primary" data-act="copy-link">Copy link</button>`, { save: false });
    const input = $("#invite-link");
    input.focus();
    input.select();
  }

  function placeSheet(trip, place) {
    const draft = place || { name: "", list: ui.list[trip.id] || "", address: "", note: "" };
    ui.draft = { tripId: trip.id, id: place && place.id };
    const lists = C.collections(trip.places).map(([name]) => `<option value="${esc(name)}"></option>`).join("");
    openSheet(place ? "Edit place" : "Save a place", `
      ${field("Name", `<input name="name" required maxlength="80" value="${esc(draft.name)}" placeholder="Afuri ramen">`)}
      ${field("Collection", `<input name="list" maxlength="40" list="place-lists" value="${esc(draft.list)}" placeholder="Food, Sights, Mei's tips"><datalist id="place-lists">${lists}</datalist>`)}
      ${field("Address or map link", `<input name="address" maxlength="200" value="${esc(draft.address)}" placeholder="Opens in Google Maps">`)}
      ${field("Note", `<textarea name="note" rows="2" maxlength="300">${esc(draft.note)}</textarea>`)}`,
      "place", place ? `<button type="button" class="btn danger" data-act="delete-place">Delete</button>` : "");
  }

  /* ---------- form handlers ---------- */

  const forms = {
    trip(data) {
      const name = String(data.get("name")).trim();
      const start = data.get("start");
      const end = data.get("end") || start;
      if (!name) return formError("Give the trip a name.");
      if (start && end < start) return formError("The trip ends before it starts. Check the dates.");
      const cities = data.getAll("city");
      const meta = {
        name, start, end, currency: data.get("currency"), transport: data.get("transport"),
        stops: data.getAll("country").map((country, index) => ({ country, city: String(cities[index]).trim() })).filter((stop) => stop.country),
      };
      state.currency = meta.currency;
      let target = ui.draft.tripId;
      mutate(() => {
        if (target) return void Object.assign(stamp(findTrip(target)), meta);
        const myName = String(data.get("me")).trim() || "Me";
        const names = [myName].concat(String(data.get("others")).split(/[,\n]/).map((text) => text.trim()).filter(Boolean));
        const members = names.map((memberName, index) => ({ id: C.uid(), name: memberName, c: Date.now() + index, u: Date.now() }));
        members[0].role = "organizer";
        target = C.uid();
        state.name = myName;
        state.mine[target] = members[0].id;
        state.trips.push({ id: target, u: Date.now(), rates: {}, dayModes: {}, events: [], expenses: [], members, ...meta });
      });
      location.hash = "#/t/" + target + "/" + (end && end < today() ? "group" : "plan");
      return true;
    },
    event(data) {
      const trip = findTrip(ui.draft.tripId);
      const title = String(data.get("title")).trim();
      if (!title) return formError("Say what it is.");
      const id = ui.draft.id;
      const fields = { title, place: String(data.get("place")).trim(), note: String(data.get("note")).trim() };
      const time = data.has("day") ? data.get("time") : "";
      if (data.has("day")) Object.assign(fields, { day: data.get("day"), time, block: time ? C.blockOf(time) : data.get("block"), dur: Number(data.get("dur")) });
      else if (!id) Object.assign(fields, { day: "", time: "", block: "morning", dur: 60 });
      mutate(() => {
        if (id) Object.assign(stamp(trip.events.find((event) => event.id === id)), fields);
        else trip.events.push(stamp({ id: C.uid(), c: Date.now(), votes: {}, ...fields }));
        if (fields.day) ui.day[trip.id] = fields.day;
        if (fields.day && time && (trip.dayModes || {})[fields.day] !== "clock" && !id) {
          trip.dayModes = { ...(trip.dayModes || {}), [fields.day]: "clock" };
          stamp(trip);
        }
      });
      return true;
    },
    expense() {
      const trip = findTrip(ui.draft.tripId);
      const draft = ui.draft.expense;
      readExpense(trip, draft);
      const record = { title: draft.title, currency: draft.currency, paidBy: draft.paidBy, split: draft.split, eventId: draft.eventId };
      if (!record.title) return formError("Say what it was for.");
      if (draft.split === "items") {
        record.items = draft.items.filter((item) => Number(item.amount) > 0).map((item) => ({ name: item.name || "Item", amount: Number(item.amount), who: item.who }));
        record.tax = Number(draft.tax) || 0;
        record.tip = Number(draft.tip) || 0;
        if (!record.items.length) return formError("Add at least one item with a price.");
        if (record.items.some((item) => !item.who.length)) return formError("Every item needs at least one person.");
      } else {
        record.amount = Number(draft.amount);
        if (!(record.amount > 0)) return formError("Enter the amount.");
        if (draft.split === "shares") record.shares = draft.shares;
        else record.among = draft.among;
        const anyone = draft.split === "shares" ? Object.values(draft.shares).some((share) => share > 0) : draft.among.length;
        if (!anyone) return formError("Pick at least one person to split between.");
      }
      const foreign = record.currency !== trip.currency;
      if (foreign && !(Number(draft.rate) > 0)) return formError("Enter the exchange rate so this counts in " + trip.currency + ".");
      const id = ui.draft.id;
      mutate(() => {
        if (foreign) {
          trip.rates = { ...(trip.rates || {}), [record.currency]: Number(draft.rate) };
          stamp(trip);
        }
        if (id) {
          const index = trip.expenses.findIndex((expense) => expense.id === id);
          trip.expenses[index] = stamp({ id, c: trip.expenses[index].c, ...record });
        } else trip.expenses.push(stamp({ id: C.uid(), c: Date.now(), ...record }));
      });
      return true;
    },
    join(data) {
      const trip = ui.pending;
      let who = data.get("who");
      if (!who) return formError("Pick your name, or add yourself.");
      if (who === "new") {
        const name = String(data.get("name")).trim();
        if (!name) return formError("Type your name.");
        who = C.uid();
        trip.members.push({ id: who, name, c: Date.now(), u: Date.now() });
        state.name = name;
      }
      state.trips.push(trip);
      state.mine[trip.id] = who;
      ui.pending = null;
      save();
      location.hash = "#/t/" + trip.id + "/plan";
      render();
      syncRooms();
      toast(trip.live && trip.live.key ? "You're in. Live sync is on, so your changes reach the group." : "You're in. Changes you make stay on this device until you send a link back.");
      return true;
    },
    "quick-idea"(data, form) {
      const trip = route().trip;
      mutate(() => trip.events.push(stamp({ id: C.uid(), c: Date.now(), title: String(data.get("title")).trim(), day: "", block: "morning", time: "", dur: 60, place: "", note: "", votes: me(trip) ? { [me(trip)]: Date.now() } : {} })));
      $('[data-form="quick-idea"] input').focus();
    },
    "add-member"(data) {
      const trip = route().trip;
      mutate(() => trip.members.push(stamp({ id: C.uid(), c: Date.now(), name: String(data.get("name")).trim() })));
    },
    invite: () => true,
    place(data) {
      const trip = findTrip(ui.draft.tripId);
      const name = String(data.get("name")).trim();
      if (!name) return formError("Give the place a name.");
      const fields = { name, list: String(data.get("list")).trim() || "Saved", address: String(data.get("address")).trim(), note: String(data.get("note")).trim() };
      const id = ui.draft.id;
      mutate(() => {
        trip.places = trip.places || [];
        if (id) Object.assign(stamp(trip.places.find((place) => place.id === id)), fields);
        else trip.places.push(stamp({ id: C.uid(), c: Date.now(), ...fields }));
      });
      return true;
    },
    "merge-link"(data) {
      const payload = String(data.get("link")).split("join=")[1];
      if (!payload) return void toast("That does not look like a Tagalong link.");
      location.hash = "#join=" + payload.trim();
    },
  };

  /* ---------- actions ---------- */

  const actions = {
    theme() {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      state.theme = next;
      save();
      render();
    },
    close: closeSheet,
    undo() {
      if (ui.undo) ui.undo();
      $("#toast").hidden = true;
    },
    "new-trip": () => tripSheet(null, false),
    "past-trip": () => tripSheet(null, true),
    "edit-trip"() {
      const trip = route().trip;
      if (!C.can(trip, me(trip), "trip")) return toast("Only organizers edit the trip details.");
      tripSheet(trip);
    },
    "add-stop": () => $("#stops").insertAdjacentHTML("beforeend", stopRow({})),
    sample() {
      const made = sampleTrips();
      mutate(() => state.trips.push(...made));
      location.hash = "#/t/" + made[0].id + "/plan";
    },
    "open-sample": () => actions.sample(),
    "clear-sample": () => mutate(() => (state.trips = state.trips.filter((trip) => !trip.sample)), "Sample trips removed."),
    "delete-trip"() {
      const trip = route().trip;
      mutate(() => (state.trips = state.trips.filter((other) => other !== trip)), "Deleted " + trip.name + ".");
      location.hash = "#/";
    },
    "days-next"() {
      const strip = $(".days");
      const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
      strip.scrollBy({ left: strip.clientWidth * 0.7, behavior: calm ? "auto" : "smooth" });
    },
    "map-zoom"(el) {
      ui.zoom = el.dataset.zoom === "1";
      ui.mapBox = null;
      render();
      const again = $('[data-act="map-zoom"]');
      if (again) again.focus();
    },
    day(el) {
      ui.day[route().trip.id] = el.dataset.day;
      render();
      const pressed = $('.day[aria-pressed="true"]');
      if (pressed) pressed.focus();
    },
    mode(el) {
      const trip = route().trip;
      if (!canPlan(trip)) return toast("The organizers locked the plan.");
      mutate(() => {
        trip.dayModes = { ...(trip.dayModes || {}), [ui.day[trip.id]]: el.dataset.mode };
        stamp(trip);
      });
    },
    "add-event": (el) => eventSheet(route().trip, null, { day: el.dataset.day, block: el.dataset.block || "morning", time: el.dataset.time || "" }),
    "edit-event"(el) {
      const trip = route().trip;
      eventSheet(trip, trip.events.find((event) => event.id === el.dataset.id));
    },
    "delete-event"() {
      const trip = findTrip(ui.draft.tripId);
      const event = trip.events.find((item) => item.id === ui.draft.id);
      closeSheet();
      mutate(() => (stamp(event).x = true), "Deleted " + event.title + ".");
    },
    vote(el) {
      const trip = route().trip;
      const who = me(trip);
      if (!who) return toast("Pick who you are under Group first.");
      const event = trip.events.find((item) => item.id === el.dataset.id);
      mutate(() => {
        event.votes = { ...(event.votes || {}) };
        event.votes[who] = (event.votes[who] > 0 ? -1 : 1) * Date.now();
      });
      const again = $('.vote[data-id="' + event.id + '"]');
      if (again) again.focus();
    },
    "add-expense": () => expenseSheet(route().trip),
    "edit-expense"(el) {
      const trip = route().trip;
      expenseSheet(trip, trip.expenses.find((expense) => expense.id === el.dataset.id));
    },
    "delete-expense"(el) {
      const trip = route().trip;
      const expense = trip.expenses.find((item) => item.id === el.dataset.id);
      closeSheet();
      mutate(() => (stamp(expense).x = true), "Removed.");
    },
    split: (el) => redrawExpense((draft) => (draft.split = el.dataset.split)),
    "add-item": () => redrawExpense((draft, trip) => draft.items.push({ name: "", amount: "", who: people(trip).map((member) => member.id) })),
    "parse-receipt": () => redrawExpense((draft, trip) => {
      if (applyReceipt(draft, trip)) draft.receipt = "";
    }),
    "mark-paid"(el) {
      const trip = route().trip;
      const amount = C.fromMinor(Number(el.dataset.amount), trip.currency);
      mutate(() => trip.expenses.push(stamp({ id: C.uid(), c: Date.now(), kind: "settle", from: el.dataset.from, to: el.dataset.to, amount })), "Marked as paid.");
    },
    "rename-member"(el) {
      const trip = route().trip;
      const member = trip.members.find((item) => item.id === el.dataset.id);
      if (!isBoss(trip) && member.id !== me(trip)) return toast("Only organizers rename other people.");
      const name = (prompt("New name for " + member.name, member.name) || "").trim();
      if (name) mutate(() => (stamp(member).name = name));
    },
    "remove-member"(el) {
      const trip = route().trip;
      const member = trip.members.find((item) => item.id === el.dataset.id);
      if (!isBoss(trip)) return toast("Only organizers remove people.");
      if (C.organizers(trip).length === 1 && C.organizers(trip)[0] === member.id) return toast("Make someone else an organizer first.");
      const used = C.live(trip.expenses).some((expense) => JSON.stringify(expense).includes(member.id));
      if (used) return toast(member.name + " is part of an expense, so they stay in the group. Settle up first.");
      if (people(trip).length < 2) return toast("A trip needs at least one person.");
      mutate(() => (stamp(member).x = true), "Removed " + member.name + ".");
    },
    invite: () => inviteSheet(route().trip),
    share: () => inviteSheet(route().trip),
    async "copy-link"() {
      const input = $("#invite-link");
      const status = $("#sheet .copy-state");
      let copied = true;
      try {
        await navigator.clipboard.writeText(input.value);
      } catch (error) {
        copied = false;
      }
      input.focus();
      input.select();
      status.textContent = copied ? "Copied. Paste it in your group chat." : "Select the link above and copy it.";
    },
    async "native-share"() {
      const trip = findTrip(ui.draft && ui.draft.tripId) || route().trip;
      try {
        await navigator.share({ title: trip.name + " on Tagalong", text: "Join our trip plan: " + trip.name, url: $("#invite-link").value });
      } catch (error) {}
    },
    "live-on"() {
      const trip = route().trip;
      if (!isBoss(trip)) return toast("Only organizers turn live sync on.");
      if (!window.Live || !window.crypto || !crypto.subtle) return toast("This browser cannot do encrypted live sync. Invite links still work.");
      mutate(() => {
        trip.live = { key: Live.newKey() };
        stamp(trip);
      });
      toast("Live sync is on. Send the group a fresh invite link so their copies join.");
    },
    "live-off"() {
      const trip = route().trip;
      if (!isBoss(trip)) return toast("Only organizers turn live sync off.");
      mutate(() => {
        trip.live = null;
        stamp(trip);
      });
      toast("Live sync is off for everyone.");
    },
    "set-role"(el) {
      const trip = route().trip;
      const mine = me(trip);
      if (!isBoss(trip)) return toast("Only organizers change roles.");
      const target = trip.members.find((member) => member.id === el.dataset.id);
      const promote = el.dataset.role === "organizer";
      mutate(() => {
        if (!trip.members.some((member) => !member.x && member.role === "organizer")) {
          const self = trip.members.find((member) => member.id === mine);
          if (self) stamp(self).role = "organizer";
        }
        stamp(target).role = promote ? "organizer" : "member";
      }, promote ? target.name + " is now an organizer." : target.name + " is now a member.");
    },
    list(el) {
      ui.list[route().trip.id] = el.dataset.list;
      render();
      const again = $('.lists [aria-pressed="true"]');
      if (again) again.focus();
    },
    "add-place": () => placeSheet(route().trip),
    "edit-place"(el) {
      const trip = route().trip;
      placeSheet(trip, trip.places.find((place) => place.id === el.dataset.id));
    },
    "delete-place"() {
      const trip = findTrip(ui.draft.tripId);
      const place = trip.places.find((item) => item.id === ui.draft.id);
      closeSheet();
      mutate(() => (stamp(place).x = true), "Deleted " + place.name + ".");
    },
    "place-idea"(el) {
      const trip = route().trip;
      const place = trip.places.find((item) => item.id === el.dataset.id);
      mutate(() => trip.events.push(stamp({
        id: C.uid(), c: Date.now(), title: place.name, day: "", block: "morning", time: "", dur: 60,
        place: place.address || place.name, note: place.note || "", placeId: place.id,
        votes: me(trip) ? { [me(trip)]: Date.now() } : {},
      })), "Added " + place.name + " to Ideas.");
    },
    "map-in": () => zoomMap($("svg.world"), 0.7, 0.5, 0.5),
    "map-out": () => zoomMap($("svg.world"), 1 / 0.7, 0.5, 0.5),
    ics() {
      const trip = route().trip;
      download(trip.name + ".ics", C.toICS(trip), "text/calendar");
    },
    export: () => download("tagalong-backup-" + today() + ".json", JSON.stringify({ app: "tagalong", trips: state.trips, mine: state.mine, name: state.name }), "application/json"),
  };

  const changes = {
    me(el) {
      state.mine[route().trip.id] = el.value;
      save();
      render();
    },
    "expense-redraw": () => redrawExpense(),
    lock(el) {
      const trip = route().trip;
      if (!isBoss(trip)) return;
      mutate(() => {
        trip.locked = el.checked;
        stamp(trip);
      }, el.checked ? "Plan locked. Only organizers change days and times." : "Plan unlocked.");
    },
    async scan(el) {
      const file = el.files[0];
      if (!file) return;
      const say = (text) => {
        const status = $("#sheet .scan-status");
        if (status) status.textContent = text;
      };
      say("Reading the receipt on this device...");
      try {
        const text = await readReceipt(file, (percent) => say("Reading the receipt on this device... " + percent + "%"));
        let found = 0;
        redrawExpense((draft, trip) => {
          draft.receipt = text.trim();
          found = applyReceipt(draft, trip);
          draft.scanNote = found
            ? "Found " + plural(found, "item") + ". Check them against the receipt below."
            : "No prices found. Check the text below and fix it, or type the lines.";
        });
      } catch (error) {
        say("Could not read that photo. Try a sharp, flat, well-lit photo, or type the lines.");
      }
    },
    photo(el) {
      const trip = route().trip;
      const file = el.files[0];
      if (!file) return;
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 960 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        try {
          localStorage.setItem("tagalong.photo." + trip.id, canvas.toDataURL("image/jpeg", 0.72));
          toast("Cover photo saved on this device. Photos are not sent with invite links.");
        } catch (error) {
          toast("That photo is too large for this browser's storage.");
        }
        URL.revokeObjectURL(image.src);
        render();
      };
      image.src = URL.createObjectURL(file);
    },
    async import(el) {
      try {
        const backup = JSON.parse(await el.files[0].text());
        if (backup.app !== "tagalong" || !Array.isArray(backup.trips)) throw new Error("wrong file");
        mutate(() => {
          for (const incoming of backup.trips) {
            const known = findTrip(incoming.id);
            if (known) Object.assign(known, C.mergeTrip(known, incoming));
            else state.trips.push(incoming);
          }
          state.mine = { ...backup.mine, ...state.mine };
          state.name = state.name || backup.name || "";
        });
        toast("Backup restored: " + plural(backup.trips.length, "trip") + ".");
      } catch (error) {
        toast("That file is not a Tagalong backup.");
      }
    },
  };

  /* ---------- receipts: paste or scan ---------- */

  function applyReceipt(draft, trip) {
    const parsed = C.parseReceipt(draft.receipt);
    if (!parsed.items.length) return 0;
    const everyone = people(trip).map((member) => member.id);
    draft.items = parsed.items.map((item) => ({ ...item, who: everyone }));
    draft.tax = parsed.tax || "";
    draft.tip = parsed.tip || "";
    return parsed.items.length;
  }

  /* On-device OCR. The engine (Tesseract, Apache-2.0) ships with the app and loads only on the first scan. */
  let ocrWorker = null;
  let ocrProgress = () => {};
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error("could not load " + src));
      document.head.appendChild(script);
    });
  }
  async function readReceipt(file, progress) {
    ocrProgress = progress;
    if (!window.Tesseract) await loadScript("vendor/ocr/tesseract.min.js");
    if (!ocrWorker) {
      const here = (path) => new URL(path, location.href).href;
      ocrWorker = await Tesseract.createWorker("eng", 1, {
        workerPath: here("vendor/ocr/worker.min.js"),
        corePath: here("vendor/ocr/"),
        langPath: here("vendor/ocr/lang"),
        workerBlobURL: false,
        logger: (message) => {
          if (message.status === "recognizing text") ocrProgress(Math.round(message.progress * 100));
        },
      });
    }
    const result = await ocrWorker.recognize(file);
    return result.data.text;
  }

  /* ---------- live sync ---------- */

  const rooms = {};
  const relays = (() => {
    const custom = new URLSearchParams(location.search).get("relay");
    if (custom) return custom.split(",");
    return window.Live ? Live.BROKERS : [];
  })();
  function liveText(trip) {
    const entry = rooms[trip.id];
    if (!entry) return "Live sync on";
    return entry.status.up ? "Live" : navigator.onLine === false ? "Live, offline" : "Live, connecting";
  }
  function paintLive() {
    for (const el of document.querySelectorAll("[data-live-status]")) {
      const trip = findTrip(el.dataset.liveStatus);
      if (trip) el.textContent = liveText(trip);
    }
  }
  function syncRooms() {
    if (!window.Live || !window.WebSocket || !window.crypto || !crypto.subtle) return;
    const wanted = new Set();
    for (const trip of state.trips) {
      const key = trip.live && trip.live.key;
      if (!key) continue;
      wanted.add(trip.id);
      let entry = rooms[trip.id];
      if (entry && entry.key !== key) {
        entry.room.stop();
        entry = null;
      }
      if (!entry) {
        const fresh = { key, sent: "", timer: 0, heard: 0, status: { up: 0, total: relays.length } };
        fresh.room = Live.Room({
          key,
          brokers: relays,
          onMessage: (bytes) => receive(trip.id, key, bytes),
          onStatus: (status) => {
            fresh.status = status;
            paintLive();
          },
        });
        entry = rooms[trip.id] = fresh;
      }
      queuePublish(trip.id);
    }
    for (const id of Object.keys(rooms)) {
      if (wanted.has(id)) continue;
      const entry = rooms[id];
      delete rooms[id];
      const trip = findTrip(id);
      /* Tell the group that live sync was turned off, then leave. */
      if (trip) {
        C.packTrip(trip).then((packed) => Live.seal(entry.key, packed)).then((bytes) => entry.room.publish(bytes));
        setTimeout(() => entry.room.stop(), 3000);
      } else entry.room.stop();
    }
  }
  function queuePublish(id) {
    const entry = rooms[id];
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => publishNow(id), 400);
  }
  async function publishNow(id) {
    const entry = rooms[id];
    const trip = findTrip(id);
    if (!entry || !trip) return;
    const text = C.canonical(trip);
    if (text === entry.sent) return;
    entry.sent = text;
    entry.room.publish(await Live.seal(entry.key, await C.packTrip(trip)));
  }
  async function receive(id, key, bytes) {
    let incoming;
    try {
      incoming = await C.unpackTrip(await Live.unseal(key, bytes));
    } catch (error) {
      return;
    }
    const local = findTrip(id);
    const entry = rooms[id];
    if (!local || !entry || incoming.id !== id) return;
    const before = C.canonical(local);
    const merged = C.mergeTrip(local, incoming);
    const after = C.canonical(merged);
    if (after !== before) {
      Object.assign(local, merged);
      entry.heard = Date.now();
      save();
      repaint();
      syncRooms();
    }
    if (after !== C.canonical(incoming)) queuePublish(id);
    else entry.sent = after;
  }
  /* Re-draw after a live change, but never under someone's fingers while they type. */
  function repaint() {
    const active = document.activeElement;
    const inApp = active && $("#app").contains(active);
    if (inApp && /^(INPUT|TEXTAREA)$/.test(active.tagName) && active.value.trim()) {
      ui.repaintLater = true;
      return;
    }
    const form = inApp && active.closest("[data-form]");
    const key = form && active.name ? '[data-form="' + form.dataset.form + '"] [name="' + active.name + '"]' : "";
    render();
    const again = key && $(key);
    if (again) again.focus();
  }

  /* ---------- passport map: drag, pinch, ctrl+wheel, keys and buttons ---------- */

  const pointers = new Map();
  function mapBoxOf(svg) {
    const box = svg.viewBox.baseVal;
    return { x: box.x, y: box.y, w: box.width, h: box.height };
  }
  function setMapBox(svg, box) {
    const ratio = box.h / box.w;
    const w = Math.min(Math.max(box.w, 90), WORLD.w);
    const h = w * ratio;
    const centerX = box.x + box.w / 2;
    const centerY = box.y + box.h / 2;
    const x = Math.min(Math.max(centerX - w / 2, -w * 0.25), WORLD.w - w * 0.75);
    const y = Math.min(Math.max(centerY - h / 2, -h * 0.25), WORLD.h - h * 0.75);
    ui.mapBox = [x, y, w, h].map((value) => Math.round(value * 10) / 10).join(" ");
    svg.setAttribute("viewBox", ui.mapBox);
  }
  function zoomMap(svg, factor, fx, fy) {
    if (!svg) return;
    const box = mapBoxOf(svg);
    const w = box.w * factor;
    const h = box.h * factor;
    setMapBox(svg, { x: box.x + (box.w - w) * fx, y: box.y + (box.h - h) * fy, w, h });
  }
  function mapScale(svg) {
    const rect = svg.getBoundingClientRect();
    const box = mapBoxOf(svg);
    return { rect, box, perPixel: Math.max(box.w / rect.width, box.h / rect.height) };
  }
  document.addEventListener("pointerdown", (event) => {
    const svg = event.target.closest && event.target.closest("svg.world");
    if (!svg) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      svg.setPointerCapture(event.pointerId);
    } catch (error) {}
  });
  document.addEventListener("pointermove", (event) => {
    const svg = $("svg.world");
    if (!svg || !pointers.has(event.pointerId)) return;
    const previous = pointers.get(event.pointerId);
    const { rect, box, perPixel } = mapScale(svg);
    if (pointers.size === 1) {
      setMapBox(svg, { x: box.x - (event.clientX - previous.x) * perPixel, y: box.y - (event.clientY - previous.y) * perPixel, w: box.w, h: box.h });
    } else if (pointers.size === 2) {
      const other = [...pointers].find(([id]) => id !== event.pointerId)[1];
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      if (before > 4 && after > 4) {
        const fx = ((event.clientX + other.x) / 2 - rect.left) / rect.width;
        const fy = ((event.clientY + other.y) / 2 - rect.top) / rect.height;
        zoomMap(svg, before / after, fx, fy);
      }
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  });
  const lift = (event) => pointers.delete(event.pointerId);
  document.addEventListener("pointerup", lift);
  document.addEventListener("pointercancel", lift);
  document.addEventListener("wheel", (event) => {
    const svg = event.target.closest && event.target.closest("svg.world");
    if (!svg || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    zoomMap(svg, Math.exp(Math.max(-0.5, Math.min(0.5, event.deltaY * 0.004))), (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  }, { passive: false });
  document.addEventListener("keydown", (event) => {
    const svg = event.target.closest && event.target.closest("svg.world");
    if (!svg) return;
    const box = mapBoxOf(svg);
    const step = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] }[event.key];
    if (step) {
      event.preventDefault();
      setMapBox(svg, { x: box.x + step[0] * box.w, y: box.y + step[1] * box.h, w: box.w, h: box.h });
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomMap(svg, 0.7, 0.5, 0.5);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomMap(svg, 1 / 0.7, 0.5, 0.5);
    }
  });

  /* Keep a toast off whatever the person is working with. */
  function placeToast(box) {
    box.classList.remove("top");
    const focused = document.activeElement;
    if (!focused || focused === document.body || box.contains(focused)) return;
    const a = focused.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right) box.classList.add("top");
  }

  /* ---------- helpers: join, toast, download, sample ---------- */

  async function join(payload) {
    let incoming;
    history.replaceState(null, "", location.pathname + location.search + "#/");
    try {
      incoming = await C.unpackTrip(payload);
    } catch (error) {
      render();
      return toast("That link is cut off or damaged. Ask for it again.");
    }
    const known = findTrip(incoming.id);
    if (known) {
      Object.assign(known, C.mergeTrip(known, incoming));
      save();
      location.hash = "#/t/" + known.id + "/plan";
      render();
      syncRooms();
      return toast("Merged the newest changes from that link.");
    }
    ui.pending = incoming;
    render();
    const group = C.live(incoming.members);
    openSheet("You're invited: " + incoming.name, `
      <p class="note">${esc([fmtRange(incoming), placeOf(incoming)].filter(Boolean).join(" · "))}. Opening this keeps a copy on your device. No account needed.</p>
      <fieldset><legend>Who are you?</legend><div class="checks column">
        ${group.map((member) => `<label class="check"><input type="radio" name="who" value="${member.id}">${esc(member.name)}</label>`).join("")}
        <label class="check"><input type="radio" name="who" value="new">Someone new</label></div></fieldset>
      ${field("Your name, if you are new", `<input name="name" maxlength="40" value="${esc(state.name)}">`)}`, "join");
    $("#sheet .btn.primary").textContent = "Join trip";
  }

  function toast(text, undo) {
    const box = $("#toast");
    box.innerHTML = `<span>${esc(text)}</span>${undo ? '<button class="btn small" data-act="undo">Undo</button>' : ""}`;
    box.hidden = false;
    placeToast(box);
    ui.undo = undo || null;
    clearTimeout(ui.timer);
    ui.timer = setTimeout(() => (box.hidden = true), undo ? 9000 : 5000);
  }

  function download(name, text, type) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type }));
    link.download = name.replace(/[\\/:*?"<>|]/g, "-");
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function sampleTrips() {
    const now = today();
    let tick = Date.now();
    const make = (name) => ({ id: C.uid(), name, c: tick++, u: 1 });
    const trip = (name, startOffset, length, stops, transport, names, currency) => {
      const members = names.map(make);
      members[0].role = "organizer";
      const record = { id: C.uid(), u: 1, sample: true, name, start: C.addDays(now, startOffset), end: C.addDays(now, startOffset + length - 1), stops, transport, currency, rates: {}, dayModes: {}, members, events: [], expenses: [], places: [] };
      state.mine[record.id] = members[0].id;
      return record;
    };
    const tokyo = trip("Tokyo, finally", 12, 5, [{ country: "JP", city: "Tokyo" }], "flight", ["You", "Mei", "Arif", "Sam"], "JPY");
    const [you, mei, arif, sam] = tokyo.members.map((member) => member.id);
    const day = (index) => C.addDays(tokyo.start, index);
    const event = (fields) => {
      const record = { id: C.uid(), c: tick++, u: 1, block: "morning", time: "", dur: 60, place: "", note: "", votes: {}, ...fields };
      tokyo.events.push(record);
      return record;
    };
    event({ title: "Land at Haneda", day: day(0), block: "afternoon", note: "Mei lands 40 minutes after everyone else" });
    event({ title: "Check in and drop bags", day: day(0), block: "afternoon", place: "Asakusa, Tokyo" });
    const dinner = event({ title: "First-night izakaya", day: day(0), block: "evening", place: "Hoppy Street, Asakusa" });
    event({ title: "Tsukiji outer market breakfast", day: day(1), time: "08:30", dur: 90, place: "Tsukiji Outer Market" });
    const teamlab = event({ title: "teamLab Planets", day: day(1), time: "13:00", dur: 120, place: "teamLab Planets Tokyo", note: "Booked. Wear shorts, you wade through water" });
    event({ title: "Omoide Yokocho yakitori", day: day(1), time: "19:00", dur: 120, place: "Omoide Yokocho, Shinjuku" });
    tokyo.dayModes[day(1)] = "clock";
    event({ title: "Meiji Shrine walk", day: day(2), block: "morning", place: "Meiji Jingu" });
    event({ title: "Shibuya Sky at sunset", day: "", place: "Shibuya Sky", note: "Tickets sell out about two weeks ahead", votes: { [you]: 3, [mei]: 3, [sam]: 3 } });
    event({ title: "Day trip to Nikko", day: "", note: "Two hours each way by train", votes: { [arif]: 3, [you]: 3 } });
    event({ title: "Ghibli Museum", day: "", place: "Ghibli Museum, Mitaka", votes: { [mei]: 3 } });
    event({ title: "Karaoke until the last train", day: "", votes: {} });
    const everyone = [you, mei, arif, sam];
    const place = (name, list, address, note) => tokyo.places.push({ id: C.uid(), c: tick++, u: 1, name, list, address, note });
    place("Afuri ramen", "Food", "Afuri Ebisu, Tokyo", "Yuzu shio ramen. Short queue before 11:00");
    place("Fuunji", "Food", "Fuunji, Shinjuku", "Tsukemen. Cash only");
    place("Golden Gai", "Night", "Golden Gai, Shinjuku", "Tiny bars, some charge a seat fee");
    place("Yanaka Ginza", "Walks", "Yanaka Ginza, Tokyo", "Old shopping street, good on a Sunday");
    const expense = (fields) => tokyo.expenses.push({ id: C.uid(), c: tick++, u: 1, currency: "JPY", eventId: "", ...fields });
    expense({ title: "Apartment deposit", amount: 60000, paidBy: you, split: "even", among: everyone });
    expense({ title: "teamLab tickets", amount: 15200, paidBy: mei, split: "even", among: everyone, eventId: teamlab.id });
    expense({
      title: "First-night izakaya", paidBy: arif, split: "items", tax: 1180, tip: 0, eventId: dinner.id,
      items: [
        { name: "Yakitori set", amount: 4800, who: everyone },
        { name: "Sake flight", amount: 3600, who: [you, sam] },
        { name: "Highballs", amount: 2400, who: [mei, arif, sam] },
        { name: "Edamame and rice", amount: 1000, who: everyone },
      ],
    });
    return [
      tokyo,
      trip("Johor food run", -64, 2, [{ country: "MY", city: "Johor Bahru" }], "road", ["You", "Arif"], "MYR"),
      trip("Bali reset", -210, 6, [{ country: "ID", city: "Ubud" }, { country: "ID", city: "Canggu" }], "flight", ["You", "Mei"], "IDR"),
      trip("Seoul long weekend", -520, 4, [{ country: "KR", city: "Seoul" }], "flight", ["You", "Sam"], "KRW"),
      trip("Bali, the first time", -930, 7, [{ country: "ID", city: "Ubud" }, { country: "ID", city: "Uluwatu" }], "flight", ["You", "Mei", "Arif"], "IDR"),
    ];
  }

  /* ---------- events ---------- */

  document.addEventListener("click", (event) => {
    const el = event.target.closest("[data-act]");
    if (el && actions[el.dataset.act]) actions[el.dataset.act](el);
  });
  document.addEventListener("change", (event) => {
    const el = event.target.closest("[data-change]");
    if (el && changes[el.dataset.change]) changes[el.dataset.change](el);
  });
  document.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-form]");
    if (!form) return;
    event.preventDefault();
    const inSheet = Boolean(form.closest("#sheet"));
    const ok = forms[form.dataset.form](new FormData(form), form);
    if (inSheet && ok) closeSheet();
  });
  $("#sheet").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeSheet();
  });
  $("#sheet").addEventListener("close", () => {
    ui.draft = null;
    ui.pending = null;
  });

  document.addEventListener("dragstart", (event) => {
    const el = event.target.closest && event.target.closest("[data-event]");
    if (!el) return;
    event.dataTransfer.setData("text/plain", el.dataset.event);
    event.dataTransfer.effectAllowed = "move";
  });
  document.addEventListener("dragover", (event) => {
    const zone = event.target.closest && event.target.closest("[data-drop-day]");
    if (!zone) return;
    event.preventDefault();
    zone.classList.add("over");
  });
  document.addEventListener("dragleave", (event) => {
    const zone = event.target.closest && event.target.closest("[data-drop-day]");
    if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove("over");
  });
  document.addEventListener("drop", (event) => {
    const zone = event.target.closest && event.target.closest("[data-drop-day]");
    const current = route();
    if (!zone || current.view !== "trip") return;
    event.preventDefault();
    const moved = current.trip.events.find((item) => item.id === event.dataTransfer.getData("text/plain"));
    if (!moved) return;
    if (!canPlan(current.trip)) return void toast("The organizers locked the plan.");
    mutate(() => {
      moved.day = zone.dataset.dropDay;
      if (zone.dataset.dropBlock) {
        moved.block = zone.dataset.dropBlock;
        moved.time = "";
      }
      stamp(moved);
    }, zone.dataset.dropDay ? "Moved " + moved.title + "." : "Moved " + moved.title + " back to Ideas.");
  });

  document.addEventListener("scroll", (event) => {
    if (event.target.classList && event.target.classList.contains("days")) tuneDays(false);
  }, true);
  window.addEventListener("resize", () => tuneDays(false));
  document.addEventListener("focusout", () => {
    if (!ui.repaintLater) return;
    setTimeout(() => {
      const active = document.activeElement;
      if (active && $("#app").contains(active) && /^(INPUT|TEXTAREA)$/.test(active.tagName) && active.value.trim()) return;
      ui.repaintLater = false;
      render();
    }, 0);
  });
  window.addEventListener("online", paintLive);
  window.addEventListener("offline", paintLive);

  window.addEventListener("hashchange", () => {
    $("#toast").hidden = true;
    ui.link = "";
    render();
    window.scrollTo(0, 0);
  });

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.register("sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) toast("Tagalong was updated. Reload to get the new version.");
    });
  }

  if (new URLSearchParams(location.search).has("demo") && !state.trips.length) {
    state.trips.push(...sampleTrips());
    save();
  }
  render();
  syncRooms();
})();
