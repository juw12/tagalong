/* Tagalong live sync.
   Each trip with live sync on has a random 256-bit key. The key travels only inside invite links (the part after #,
   which browsers never send to a server). Every change is packed, encrypted with AES-GCM under that key and
   published to free public MQTT brokers as a retained message. The brokers only ever see ciphertext on a topic
   derived from a hash of the key. Peers merge what they receive with the same rule as invite links. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Live = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* Two independent free brokers. Every peer uses both, so one going down does not split the group. */
  const BROKERS = ["wss://broker.emqx.io:8084/mqtt", "wss://broker.hivemq.com:8884/mqtt"];
  const TOPIC = "tagalong/v1/";
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  /* ---------- base64url and crypto ---------- */

  function toBase64Url(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  const fromBase64Url = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));

  function newKey() {
    return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  }
  async function topicFor(key) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode("tagalong-room:" + key)));
    return TOPIC + Array.from(digest.subarray(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  const cryptoKey = (key) => crypto.subtle.importKey("raw", fromBase64Url(key), "AES-GCM", false, ["encrypt", "decrypt"]);
  async function seal(key, text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cryptoKey(key), encoder.encode(text)));
    const out = new Uint8Array(1 + iv.length + sealed.length);
    out[0] = 1;
    out.set(iv, 1);
    out.set(sealed, 1 + iv.length);
    return out;
  }
  async function unseal(key, bytes) {
    if (bytes[0] !== 1) throw new Error("unknown format");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(1, 13) }, await cryptoKey(key), bytes.subarray(13));
    return decoder.decode(plain);
  }

  /* ---------- MQTT 3.1.1 packets (QoS 0 only) ---------- */

  function concat(parts) {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(size);
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
  function remainingLength(length) {
    const bytes = [];
    do {
      let digit = length % 128;
      length = Math.floor(length / 128);
      if (length > 0) digit |= 128;
      bytes.push(digit);
    } while (length > 0);
    return Uint8Array.from(bytes);
  }
  function utf8(text) {
    const bytes = encoder.encode(text);
    return concat([Uint8Array.of(bytes.length >> 8, bytes.length & 255), bytes]);
  }
  const packet = (firstByte, body) => concat([Uint8Array.of(firstByte), remainingLength(body.length), body]);

  const connectPacket = (clientId, keepAlive) =>
    packet(0x10, concat([utf8("MQTT"), Uint8Array.of(4, 0x02, keepAlive >> 8, keepAlive & 255), utf8(clientId)]));
  const subscribePacket = (id, topic) => packet(0x82, concat([Uint8Array.of(id >> 8, id & 255), utf8(topic), Uint8Array.of(0)]));
  const publishPacket = (topic, payload, retain) => packet(0x30 | (retain ? 1 : 0), concat([utf8(topic), payload]));
  const pingPacket = () => Uint8Array.of(0xc0, 0);

  /* Splits a byte stream into packets; a WebSocket frame may hold part of one packet or several. */
  function packetReader() {
    let buffer = new Uint8Array(0);
    return function read(chunk) {
      buffer = concat([buffer, chunk]);
      const packets = [];
      for (;;) {
        if (buffer.length < 2) break;
        let length = 0;
        let factor = 1;
        let index = 1;
        let done = false;
        while (index < buffer.length && index <= 4) {
          const byte = buffer[index++];
          length += (byte & 127) * factor;
          factor *= 128;
          if (!(byte & 128)) {
            done = true;
            break;
          }
        }
        if (!done || buffer.length < index + length) break;
        const type = buffer[0] >> 4;
        const flags = buffer[0] & 15;
        const body = buffer.slice(index, index + length);
        buffer = buffer.slice(index + length);
        const item = { type, flags, body };
        if (type === 3) {
          const topicLength = (body[0] << 8) | body[1];
          item.topic = decoder.decode(body.subarray(2, 2 + topicLength));
          const skip = 2 + topicLength + ((flags >> 1) & 3 ? 2 : 0);
          item.payload = body.slice(skip);
          item.retain = Boolean(flags & 1);
        }
        packets.push(item);
      }
      return packets;
    };
  }

  /* ---------- a room: one trip, all brokers ---------- */

  function Room(options) {
    const { key, brokers, onMessage, onStatus } = options;
    const links = [];
    let topic = "";
    let last = null;
    let stopped = false;
    const report = () => onStatus && onStatus({ up: links.filter((link) => link.ready).length, total: links.length });

    function open(url, link) {
      let socket;
      try {
        socket = new WebSocket(url, "mqtt");
      } catch (error) {
        return retry(url, link);
      }
      socket.binaryType = "arraybuffer";
      link.socket = socket;
      link.ready = false;
      const read = packetReader();
      socket.onopen = () => socket.send(connectPacket("tg-" + Math.random().toString(36).slice(2, 12), 30));
      socket.onmessage = (event) => {
        for (const item of read(new Uint8Array(event.data))) {
          if (item.type === 2) {
            if (item.body[1] !== 0) return socket.close();
            link.ready = true;
            link.tries = 0;
            socket.send(subscribePacket(1, topic));
            if (last) socket.send(publishPacket(topic, last, true));
            report();
          } else if (item.type === 3 && item.topic === topic && item.payload.length) {
            onMessage(item.payload);
          }
        }
      };
      socket.onclose = () => {
        link.ready = false;
        report();
        retry(url, link);
      };
      socket.onerror = () => {};
    }
    function retry(url, link) {
      if (stopped) return;
      link.tries = (link.tries || 0) + 1;
      clearTimeout(link.wait);
      link.wait = setTimeout(() => open(url, link), Math.min(30000, 1000 * 2 ** Math.min(link.tries, 5)));
    }
    const ping = setInterval(() => {
      for (const link of links) if (link.ready) link.socket.send(pingPacket());
    }, 25000);

    topicFor(key).then((name) => {
      topic = name;
      for (const url of brokers) {
        const link = { url, ready: false };
        links.push(link);
        open(url, link);
      }
      report();
    });

    return {
      publish(payload) {
        last = payload;
        for (const link of links) if (link.ready) link.socket.send(publishPacket(topic, payload, true));
      },
      stop() {
        stopped = true;
        clearInterval(ping);
        for (const link of links) {
          clearTimeout(link.wait);
          if (link.socket) {
            link.socket.onclose = null;
            try {
              link.socket.close();
            } catch (error) {}
          }
        }
      },
      status: () => ({ up: links.filter((link) => link.ready).length, total: links.length }),
    };
  }

  return {
    BROKERS, newKey, topicFor, seal, unseal, Room,
    connectPacket, subscribePacket, publishPacket, packetReader, remainingLength,
  };
});
