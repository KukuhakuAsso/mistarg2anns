// scripts/webgal-sync-server.mjs
// WebGAL「编辑器同步 V1」WebSocket 服务端（极简实现，零依赖，RFC6455）
//
// WebGAL 引擎初始化时会主动连接 ws://<host>:<port>/api/webgalsync
// （subprotocol: webgal-editor-preview-sync.v1），用于与 WebGAL Craft 编辑器
// 做实时预览。这里在 Vite dev server 上实现这个端点，从而在 game/ 内容变化时
// 直接向引擎推送「按场景刷新」命令（preview.command.run-scene-content），
// 无需重建 iframe / 回到标题页。
//
// 协议要点（详见 OpenWebGAL/WebGAL 的 editorPreviewProtocol.ts）：
//   1. 引擎连上后先发  {kind:'request', type:'session.register-preview', requestId, payload:{...}}
//      服务端必须回  {kind:'response', type:'session.register-preview', requestId, payload:{}}
//   2. 注册完成后，服务端可发命令：
//      {kind:'request', type:'preview.command.run-scene-content', requestId, payload:{sceneContent}}
//      引擎会 resetStage 并直接播放该剧本内容（= 按场景刷新）
import crypto from "crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const SUBPROTOCOL = "webgal-editor-preview-sync.v1";
const WS_PATH = "/api/webgalsync";

const makeRequestId = () =>
  `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;

// —— RFC6455 帧编解码（仅需要文本帧，服务端→客户端不掩码，客户端→服务端带掩码）——
function sendFrame(socket, opcode, payload) {
  if (socket.destroyed || !socket.writable) return;
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

function wrapSocket(socket, { onText, onClose }) {
  let buffer = Buffer.alloc(0);

  const handleClose = () => {
    try {
      socket.destroy();
    } catch {
      /* noop */
    }
    onClose();
  };

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) break;
      const first = buffer[0];
      const second = buffer[1];
      const opcode = first & 0x0f;
      let len = second & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buffer.length < 4) break;
        len = buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buffer.length < 10) break;
        len = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const masked = (second & 0x80) !== 0;
      if (masked) {
        if (buffer.length < offset + 4) break;
        const maskKey = buffer.subarray(offset, offset + 4);
        offset += 4;
        if (buffer.length < offset + len) break;
        const payload = Buffer.from(buffer.subarray(offset, offset + len));
        for (let i = 0; i < payload.length; i += 1) {
          payload[i] ^= maskKey[i % 4];
        }
        buffer = buffer.subarray(offset + len);
        if (opcode === 0x8) {
          handleClose();
          return;
        }
        if (opcode === 0x9) {
          sendFrame(socket, 0xa, payload); // ping → pong
          continue;
        }
        if (opcode === 0x1) onText(payload.toString("utf8"));
      } else {
        // 客户端帧必须掩码；不掩码的直接跳过
        buffer = buffer.subarray(offset + len);
      }
    }
  });

  socket.on("close", handleClose);
  socket.on("error", () => {});

  return {
    sendText: (str) => sendFrame(socket, 0x1, Buffer.from(str, "utf8")),
    close: handleClose,
  };
}

export function createWebgalSyncServer({ logger = console } = {}) {
  /** 已完成注册握手、可接收命令的引擎连接 */
  const sockets = new Set();

  const sendEnvelope = (ws, envelope) => {
    try {
      ws.sendText(JSON.stringify(envelope));
    } catch {
      /* noop */
    }
  };

  const handleText = (ws, raw) => {
    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch {
      return;
    }
    if (!envelope || typeof envelope.kind !== "string") return;

    if (envelope.kind === "request") {
      if (envelope.type === "session.register-preview") {
        ws.registered = true;
        sockets.add(ws);
        sendEnvelope(ws, {
          kind: "response",
          type: "session.register-preview",
          requestId: envelope.requestId,
          payload: {},
        });
        logger.info("🎮 WebGAL 引擎已连接（编辑器同步 V1）");
        return;
      }
      return;
    }
    // 引擎对我们的命令/查询的回应、以及主动上报的事件，通常无需处理
    if (
      envelope.kind === "response" ||
      envelope.kind === "error" ||
      envelope.kind === "event"
    ) {
        // 可选：记录日志
        // logger.info(`← WebGAL ${envelope.kind}: ${envelope.type}`);
        return;
    }
  };

  const attach = (httpServer) => {
    httpServer.on("upgrade", (req, socket, head) => {
      let pathname;
      try {
        pathname = new URL(req.url, "http://localhost").pathname;
      } catch {
        return;
      }
      if (pathname !== WS_PATH) return; // 不是我们的路径，交给 vite 其他监听

      const key = req.headers["sec-websocket-key"];
      if (!key) {
        socket.destroy();
        return;
      }
      const accept = crypto
        .createHash("sha1")
        .update(key + GUID)
        .digest("base64");

      const headers = [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
      ];
      const requestedProto = String(req.headers["sec-websocket-protocol"] || "");
      if (requestedProto.split(",").map((s) => s.trim()).includes(SUBPROTOCOL)) {
        headers.push(`Sec-WebSocket-Protocol: ${SUBPROTOCOL}`);
      }
      socket.write(headers.join("\r\n") + "\r\n\r\n");

      const ws = wrapSocket(socket, {
        onText: (data) => handleText(ws, data),
        onClose: () => {
          ws.registered = false;
          sockets.delete(ws);
        },
      });
      ws.registered = false;
    });
  };

  const connectedCount = () => sockets.size;

  const sendCommand = (type, payload) => {
    const envelope = {
      kind: "request",
      type,
      requestId: makeRequestId(),
      payload,
    };
    let sent = 0;
    for (const ws of sockets) {
      if (!ws.registered) continue;
      sendEnvelope(ws, envelope);
      sent += 1;
    }
    if (sent > 0) {
      logger.info(`→ 已向 ${sent} 个引擎连接发送 ${type}`);
    } else {
      logger.warn(`⚠️ 无已注册引擎连接，无法发送 ${type}`);
    }
    return sent;
  };

  /** 按场景刷新：向引擎推送剧本内容，引擎会 resetStage 并直接播放 */
  const refreshScene = (sceneContent) =>
    sendCommand("preview.command.run-scene-content", { sceneContent });

  return { attach, connectedCount, refreshScene, sendCommand };
}
