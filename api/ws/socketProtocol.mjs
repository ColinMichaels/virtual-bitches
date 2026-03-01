import { createHash } from "node:crypto";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const DEFAULT_MAX_WS_MESSAGE_BYTES = 16 * 1024;

export function validateSocketUpgradeHeaders(req) {
  if (req.method !== "GET") {
    return { ok: false, status: 405, reason: "Method Not Allowed" };
  }

  const upgrade = String(req.headers.upgrade ?? "").toLowerCase();
  if (upgrade !== "websocket") {
    return { ok: false, status: 400, reason: "Bad Request" };
  }

  const connectionHeader = String(req.headers.connection ?? "").toLowerCase();
  const includesUpgrade = connectionHeader
    .split(",")
    .map((part) => part.trim())
    .includes("upgrade");
  if (!includesUpgrade) {
    return { ok: false, status: 400, reason: "Bad Request" };
  }

  const version = String(req.headers["sec-websocket-version"] ?? "");
  if (version !== "13") {
    return { ok: false, status: 426, reason: "Upgrade Required" };
  }

  const key = String(req.headers["sec-websocket-key"] ?? "").trim();
  if (!key) {
    return { ok: false, status: 400, reason: "Bad Request" };
  }

  let decodedKey;
  try {
    decodedKey = Buffer.from(key, "base64");
  } catch {
    return { ok: false, status: 400, reason: "Bad Request" };
  }
  if (decodedKey.length !== 16) {
    return { ok: false, status: 400, reason: "Bad Request" };
  }

  const acceptValue = createHash("sha1")
    .update(`${key}${WS_GUID}`)
    .digest("base64");

  return { ok: true, acceptValue };
}

export function completeSocketHandshake(socket, acceptValue) {
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptValue}`,
      "\r\n",
    ].join("\r\n")
  );
}

export function parseSocketFrame(buffer, maxMessageBytes = DEFAULT_MAX_WS_MESSAGE_BYTES) {
  if (buffer.length < 2) return null;

  const byte1 = buffer[0];
  const byte2 = buffer[1];
  const fin = (byte1 & 0x80) !== 0;
  const opcode = byte1 & 0x0f;
  const masked = (byte2 & 0x80) !== 0;
  let payloadLength = byte2 & 0x7f;
  let offset = 2;

  if (!fin) {
    return { error: "fragmented_frames_not_supported", bytesConsumed: buffer.length };
  }

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) return null;
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) return null;
    const big = buffer.readBigUInt64BE(offset);
    if (big > BigInt(maxMessageBytes)) {
      return { error: "message_too_large", bytesConsumed: buffer.length };
    }
    payloadLength = Number(big);
    offset += 8;
  }

  if (payloadLength > maxMessageBytes) {
    return { error: "message_too_large", bytesConsumed: buffer.length };
  }

  if (!masked) {
    return { error: "client_frame_not_masked", bytesConsumed: buffer.length };
  }

  if (buffer.length < offset + 4 + payloadLength) {
    return null;
  }

  const mask = buffer.subarray(offset, offset + 4);
  offset += 4;
  const payload = Buffer.from(buffer.subarray(offset, offset + payloadLength));
  for (let i = 0; i < payload.length; i += 1) {
    payload[i] ^= mask[i % 4];
  }

  return {
    opcode,
    payload,
    bytesConsumed: offset + payloadLength,
  };
}

export function writeSocketFrame(socket, opcode, payload = Buffer.alloc(0)) {
  const payloadLength = payload.length;
  let header;

  if (payloadLength < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = payloadLength;
  } else if (payloadLength <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(payloadLength, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payloadLength), 2);
  }

  socket.write(Buffer.concat([header, payload]));
}
