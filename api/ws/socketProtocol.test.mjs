import assert from "node:assert/strict";
import {
  completeSocketHandshake,
  parseSocketFrame,
  validateSocketUpgradeHeaders,
  writeSocketFrame,
} from "./socketProtocol.mjs";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

class MockSocket {
  constructor() {
    this.writes = [];
  }

  write(data) {
    if (Buffer.isBuffer(data)) {
      this.writes.push(data);
      return true;
    }
    this.writes.push(Buffer.from(String(data), "utf8"));
    return true;
  }
}

function createUpgradeRequest(overrides = {}) {
  const base = {
    method: "GET",
    headers: {
      upgrade: "websocket",
      connection: "Upgrade",
      "sec-websocket-version": "13",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
    },
  };
  return {
    ...base,
    ...overrides,
    headers: {
      ...base.headers,
      ...(overrides.headers ?? {}),
    },
  };
}

function buildMaskedClientTextFrame(text, mask = [0x11, 0x22, 0x33, 0x44]) {
  const payload = Buffer.from(text, "utf8");
  const header = Buffer.from([0x81, 0x80 | payload.length]);
  const maskBuffer = Buffer.from(mask);
  const maskedPayload = Buffer.from(payload);
  for (let index = 0; index < maskedPayload.length; index += 1) {
    maskedPayload[index] ^= maskBuffer[index % 4];
  }
  return Buffer.concat([header, maskBuffer, maskedPayload]);
}

test("validateSocketUpgradeHeaders accepts a valid websocket upgrade request", () => {
  const result = validateSocketUpgradeHeaders(createUpgradeRequest());
  assert.equal(result.ok, true);
  assert.equal(result.acceptValue, "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});

test("validateSocketUpgradeHeaders rejects non-GET requests", () => {
  const result = validateSocketUpgradeHeaders(
    createUpgradeRequest({
      method: "POST",
    })
  );
  assert.deepEqual(result, {
    ok: false,
    status: 405,
    reason: "Method Not Allowed",
  });
});

test("validateSocketUpgradeHeaders rejects invalid websocket keys", () => {
  const result = validateSocketUpgradeHeaders(
    createUpgradeRequest({
      headers: {
        "sec-websocket-key": "short",
      },
    })
  );
  assert.deepEqual(result, {
    ok: false,
    status: 400,
    reason: "Bad Request",
  });
});

test("completeSocketHandshake writes expected HTTP 101 response", () => {
  const socket = new MockSocket();
  completeSocketHandshake(socket, "abc123");
  assert.equal(socket.writes.length, 1);
  const response = socket.writes[0].toString("utf8");
  assert(response.includes("HTTP/1.1 101 Switching Protocols"));
  assert(response.includes("Upgrade: websocket"));
  assert(response.includes("Connection: Upgrade"));
  assert(response.includes("Sec-WebSocket-Accept: abc123"));
});

test("parseSocketFrame decodes masked text payloads", () => {
  const frameBuffer = buildMaskedClientTextFrame("hello");
  const frame = parseSocketFrame(frameBuffer, 1024);
  assert(frame, "Expected parsed frame");
  assert.equal(frame.error, undefined);
  assert.equal(frame.opcode, 0x1);
  assert.equal(frame.payload.toString("utf8"), "hello");
  assert.equal(frame.bytesConsumed, frameBuffer.length);
});

test("parseSocketFrame rejects unmasked client frames", () => {
  const unmasked = Buffer.concat([Buffer.from([0x81, 0x05]), Buffer.from("hello", "utf8")]);
  const frame = parseSocketFrame(unmasked, 1024);
  assert(frame, "Expected frame parse result");
  assert.equal(frame.error, "client_frame_not_masked");
});

test("parseSocketFrame rejects oversized payload lengths", () => {
  const oversizedHeader = Buffer.from([0x81, 0xfe, 0x00, 0x0a]);
  const frame = parseSocketFrame(oversizedHeader, 8);
  assert(frame, "Expected frame parse result");
  assert.equal(frame.error, "message_too_large");
});

test("writeSocketFrame writes small payloads with base header", () => {
  const socket = new MockSocket();
  const payload = Buffer.from("ok", "utf8");
  writeSocketFrame(socket, 0x1, payload);
  assert.equal(socket.writes.length, 1);
  const written = socket.writes[0];
  assert.equal(written[0], 0x81);
  assert.equal(written[1], payload.length);
  assert.equal(written.subarray(2).toString("utf8"), "ok");
});

test("writeSocketFrame writes extended 16-bit payload lengths", () => {
  const socket = new MockSocket();
  const payload = Buffer.alloc(130, 0x7a);
  writeSocketFrame(socket, 0x2, payload);
  assert.equal(socket.writes.length, 1);
  const written = socket.writes[0];
  assert.equal(written[0], 0x82);
  assert.equal(written[1], 126);
  assert.equal(written.readUInt16BE(2), 130);
  assert.equal(written.subarray(4).length, 130);
});

async function run() {
  let failures = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`✗ ${name}`);
      console.error(error);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(`All socketProtocol tests passed (${tests.length}).`);
}

await run();
