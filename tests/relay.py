"""A tiny MQTT 3.1.1 relay over WebSocket, for tests only.

It speaks the same small part of MQTT that live.js uses (QoS 0, retained messages, ping), so the live-sync gate
can run offline. It also records every payload it relays, so a test can check that only ciphertext passed through.
"""
import asyncio
import threading

import websockets


def _remaining_length(length):
    out = bytearray()
    while True:
        digit = length % 128
        length //= 128
        if length:
            digit |= 128
        out.append(digit)
        if not length:
            return bytes(out)


def _packet(first_byte, body):
    return bytes([first_byte]) + _remaining_length(len(body)) + body


def _read_packets(buffer):
    packets = []
    while len(buffer) >= 2:
        length = 0
        factor = 1
        index = 1
        done = False
        while index < len(buffer) and index <= 4:
            byte = buffer[index]
            index += 1
            length += (byte & 127) * factor
            factor *= 128
            if not byte & 128:
                done = True
                break
        if not done or len(buffer) < index + length:
            break
        packets.append((buffer[0] >> 4, buffer[0] & 15, bytes(buffer[index:index + length])))
        del buffer[:index + length]
    return packets


class Relay:
    def __init__(self):
        self.retained = {}
        self.subscribers = {}
        self.payloads = []
        self.port = None
        self._ready = threading.Event()

    async def _client(self, socket):
        buffer = bytearray()
        topics = set()
        try:
            async for message in socket:
                buffer.extend(message if isinstance(message, bytes) else message.encode())
                for kind, flags, body in _read_packets(buffer):
                    if kind == 1:
                        await socket.send(bytes([0x20, 2, 0, 0]))
                    elif kind == 8:
                        packet_id = body[:2]
                        topic_length = int.from_bytes(body[2:4], "big")
                        topic = body[4:4 + topic_length].decode()
                        topics.add(topic)
                        self.subscribers.setdefault(topic, set()).add(socket)
                        await socket.send(bytes([0x90, 3]) + packet_id + b"\x00")
                        if topic in self.retained:
                            await socket.send(self.retained[topic])
                    elif kind == 3:
                        topic_length = int.from_bytes(body[:2], "big")
                        topic = body[2:2 + topic_length].decode()
                        payload = body[2 + topic_length:]
                        self.payloads.append(payload)
                        outgoing = _packet(0x30 | (flags & 1), body)
                        if flags & 1:
                            self.retained[topic] = outgoing
                        for peer in list(self.subscribers.get(topic, ())):
                            try:
                                await peer.send(_packet(0x30, body))
                            except Exception:
                                pass
                    elif kind == 12:
                        await socket.send(bytes([0xD0, 0]))
                    elif kind == 14:
                        return
        except websockets.ConnectionClosed:
            pass
        finally:
            for topic in topics:
                self.subscribers.get(topic, set()).discard(socket)

    async def _main(self):
        async with websockets.serve(self._client, "127.0.0.1", 0, subprotocols=["mqtt"], max_size=None) as server:
            self.port = server.sockets[0].getsockname()[1]
            self._ready.set()
            await asyncio.Future()

    def start(self):
        threading.Thread(target=lambda: asyncio.run(self._main()), daemon=True).start()
        self._ready.wait(10)
        return f"ws://127.0.0.1:{self.port}/mqtt"
