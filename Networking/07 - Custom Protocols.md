# Custom Protocols

## When to Build a Custom Protocol

Most systems should use HTTP/REST, gRPC, or WebSockets. Build custom only when:

- **Binary efficiency is critical** — game state updates, IoT telemetry (thousands of small messages/sec where HTTP overhead matters)
- **Ultra-low latency** — trading systems, real-time games (microseconds matter)
- **Existing protocols don't model your data well** — streaming sensor data, custom multiplexed streams
- **HTTP overhead is a bottleneck** — proven by measurement, not assumption

**Don't build custom protocols for:** Normal web services, microservices, anything where gRPC works.

---

## Anatomy of a Protocol

Every protocol needs to solve:

1. **Framing:** Where does one message end and the next begin?
2. **Encoding:** How are data types represented as bytes?
3. **Error detection:** How do we know if data was corrupted?
4. **Versioning:** How do we evolve the protocol without breaking clients?

---

## Framing Strategies

TCP is a **byte stream** — it has no concept of message boundaries. You send 100 bytes and 100 bytes; the receiver might get 200 bytes in one read, or 50+150, or 1 byte at a time. Your protocol must reconstruct messages.

### Length-Prefixed Framing

Most common. Each message starts with its length.

```
┌──────────┬────────────────────────────┐
│  4 bytes │    N bytes                 │
│  Length  │    Payload                 │
└──────────┴────────────────────────────┘
```

```kotlin
// Writer
fun writeMessage(out: OutputStream, payload: ByteArray) {
    val buf = ByteBuffer.allocate(4 + payload.size)
    buf.putInt(payload.size)   // 4-byte length prefix
    buf.put(payload)
    out.write(buf.array())
}

// Reader
fun readMessage(input: InputStream): ByteArray {
    val lenBytes = ByteArray(4)
    input.readFully(lenBytes)
    val len = ByteBuffer.wrap(lenBytes).int
    val payload = ByteArray(len)
    input.readFully(payload)
    return payload
}

// Extension function for InputStream
fun InputStream.readFully(buf: ByteArray) {
    var offset = 0
    while (offset < buf.size) {
        val n = read(buf, offset, buf.size - offset)
        if (n == -1) throw EOFException()
        offset += n
    }
}
```

**Variant: 2-byte length** (max 65535 bytes per message — good for small messages, saves 2 bytes overhead).

### Delimiter Framing

Messages separated by a special byte sequence (e.g., `\n`, `\r\n`, `\0`).

Used by: HTTP/1.1 headers (CRLF), Redis RESP protocol (CRLF), SMTP, Telnet.

```kotlin
fun readLine(input: InputStream): String {
    val buf = StringBuilder()
    var b: Int
    while (input.read().also { b = it } != -1) {
        if (b == '\n'.code) break
        if (b != '\r'.code) buf.append(b.toChar())
    }
    return buf.toString()
}
```

**Problem:** The delimiter byte can't appear in the payload without escaping.

### Fixed-Length Messages

Every message is exactly N bytes. Simple but inflexible.

Used by: UDP game packets (each packet is 64 bytes of game state).

---

## Binary Encoding

### Manual Binary Protocol

```kotlin
// Protocol: | version(1) | type(1) | userId(8) | timestamp(8) | dataLen(4) | data(N) |
data class Message(
    val version: Byte,
    val type: Byte,
    val userId: Long,
    val timestamp: Long,
    val data: ByteArray
)

fun Message.encode(): ByteArray {
    val buf = ByteBuffer.allocate(22 + data.size)
        .put(version)
        .put(type)
        .putLong(userId)
        .putLong(timestamp)
        .putInt(data.size)
        .put(data)
    return buf.array()
}

fun decode(bytes: ByteArray): Message {
    val buf = ByteBuffer.wrap(bytes)
    return Message(
        version = buf.get(),
        type = buf.get(),
        userId = buf.long,
        timestamp = buf.long,
        data = ByteArray(buf.int).also { buf.get(it) }
    )
}
```

### Protocol Buffers (Preferred Binary Format)

Variable-length encoding. Fields identified by numbers not names (compact). Used by gRPC.

```protobuf
// game.proto
message GameState {
    int64 game_id = 1;
    int64 timestamp_ms = 2;
    repeated PlayerPosition players = 3;
}

message PlayerPosition {
    int32 player_id = 1;
    float x = 2;
    float y = 3;
    float velocity_x = 4;
    float velocity_y = 5;
}
```

```kotlin
// build.gradle.kts
implementation("com.google.protobuf:protobuf-kotlin:3.25.1")

// Generated code usage
val state = GameState.newBuilder()
    .setGameId(12345)
    .setTimestampMs(System.currentTimeMillis())
    .addPlayers(PlayerPosition.newBuilder()
        .setPlayerId(1)
        .setX(100.5f)
        .setY(200.3f)
        .build())
    .build()

val bytes = state.toByteArray()          // ~20 bytes
val decoded = GameState.parseFrom(bytes) // back to object
```

### MessagePack

JSON-compatible but binary. No schema needed (unlike Protobuf).

```kotlin
// build.gradle.kts: implementation("org.msgpack:msgpack-core:0.9.6")

val packer = MessagePack.newDefaultBufferPacker()
packer.packMapHeader(3)
packer.packString("userId"); packer.packLong(123L)
packer.packString("action"); packer.packString("jump")
packer.packString("ts"); packer.packLong(System.currentTimeMillis())
val bytes = packer.toByteArray()  // ~35 bytes vs ~65 bytes JSON
```

---

## Full Custom Protocol Example: Game Server

```kotlin
// Protocol design for a real-time multiplayer game

// Message types
enum class MessageType(val id: Byte) {
    JOIN_GAME(0x01),
    LEAVE_GAME(0x02),
    PLAYER_MOVE(0x03),
    GAME_STATE(0x04),
    PING(0x05),
    PONG(0x06),
    ERROR(0xFF.toByte())
}

// Header: | magic(2) | version(1) | type(1) | seqNum(4) | payloadLen(4) |
// Total header: 12 bytes

data class Header(
    val magic: Short = 0x4754,  // "GT" for GameTech
    val version: Byte = 1,
    val type: MessageType,
    val seqNum: Int,
    val payloadLen: Int
)

class GameProtocol {
    companion object {
        const val HEADER_SIZE = 12
        const val MAGIC = 0x4754.toShort()
    }

    fun encode(type: MessageType, seqNum: Int, payload: ByteArray): ByteArray {
        val buf = ByteBuffer.allocate(HEADER_SIZE + payload.size)
        buf.putShort(MAGIC)
        buf.put(1)                    // version
        buf.put(type.id)
        buf.putInt(seqNum)
        buf.putInt(payload.size)
        buf.put(payload)
        return buf.array()
    }

    fun decodeHeader(bytes: ByteArray): Header {
        val buf = ByteBuffer.wrap(bytes, 0, HEADER_SIZE)
        val magic = buf.short
        require(magic == MAGIC) { "Invalid magic: $magic" }
        return Header(
            magic = magic,
            version = buf.get(),
            type = MessageType.values().first { it.id == buf.get() },
            seqNum = buf.int,
            payloadLen = buf.int
        )
    }
}

// Client: read loop
class GameClient(private val socket: Socket) {
    private val proto = GameProtocol()
    private val input = socket.inputStream
    private val output = socket.outputStream

    fun readMessage(): Pair<Header, ByteArray> {
        val headerBytes = ByteArray(GameProtocol.HEADER_SIZE)
        input.readFully(headerBytes)
        val header = proto.decodeHeader(headerBytes)
        val payload = ByteArray(header.payloadLen)
        input.readFully(payload)
        return header to payload
    }

    fun sendMove(seqNum: Int, x: Float, y: Float) {
        val payload = ByteBuffer.allocate(8)
            .putFloat(x).putFloat(y).array()
        output.write(proto.encode(MessageType.PLAYER_MOVE, seqNum, payload))
        output.flush()
    }
}
```

---

## Protocol Versioning

**Backwards compatibility rule:** Always be able to parse older versions. New fields are optional.

**Strategies:**

1. **Version in header:** Check version, run appropriate parser. Clean but requires maintaining old code.

2. **Extensibility via optional fields:** New fields at the end, tagged as optional. Unknown fields are ignored.

3. **Capability negotiation:** Client sends capabilities in handshake. Server responds with what it supports.

```kotlin
// Handshake message
data class Handshake(
    val clientVersion: Int,
    val supportedFeatures: Set<Feature>
)

data class HandshakeAck(
    val serverVersion: Int,
    val negotiatedFeatures: Set<Feature>  // intersection of client + server
)

enum class Feature { COMPRESSION, ENCRYPTION, MULTIPLEXING }
```

---

## Implementing Multiplexing (Like HTTP/2)

Multiple logical streams over one TCP connection. Avoids head-of-line blocking.

```kotlin
// Stream frame: | streamId(4) | flags(1) | payloadLen(4) | payload(N) |
// flags: 0x01 = END_STREAM, 0x02 = PRIORITY

data class Frame(
    val streamId: Int,
    val flags: Byte,
    val payload: ByteArray
)

class Multiplexer(private val socket: Socket) {
    private val streams = ConcurrentHashMap<Int, Channel<Frame>>()
    private val output = socket.outputStream
    private val lock = ReentrantLock()

    // Write to a specific stream
    fun write(streamId: Int, data: ByteArray, endStream: Boolean = false) {
        val flags = if (endStream) 0x01.toByte() else 0x00
        val frame = ByteBuffer.allocate(9 + data.size)
            .putInt(streamId)
            .put(flags)
            .putInt(data.size)
            .put(data)
            .array()
        lock.withLock {
            output.write(frame)
            output.flush()
        }
    }

    // Read loop — demultiplex frames to stream channels
    fun startReadLoop() = Thread {
        val input = socket.inputStream
        while (!socket.isClosed) {
            val header = ByteArray(9)
            input.readFully(header)
            val buf = ByteBuffer.wrap(header)
            val streamId = buf.int
            val flags = buf.get()
            val len = buf.int
            val payload = ByteArray(len).also { input.readFully(it) }
            
            streams.getOrPut(streamId) { Channel(capacity = 100) }
                .trySend(Frame(streamId, flags, payload))
        }
    }.start()
}
```

---

## Redis RESP Protocol (Real-World Example)

Redis uses a simple text protocol called RESP (REdis Serialization Protocol). Studying it teaches good protocol design.

```
# Simple string: +OK\r\n
# Error: -ERR unknown command\r\n
# Integer: :42\r\n
# Bulk string: $6\r\nfoobar\r\n
# Array: *2\r\n$3\r\nGET\r\n$3\r\nkey\r\n

# Command: SET foo bar
*3\r\n$3\r\nSET\r\n$3\r\nfoo\r\n$3\r\nbar\r\n
```

Lessons:
- Text protocol is human-readable and debuggable with netcat
- Type indicator as first byte (+ - : $ *)
- Variable-length bulk strings avoid delimiter escaping
- Arrays for commands make parsing uniform

```kotlin
// Parse RESP response
fun parseResp(input: InputStream): Any? {
    return when (val type = input.read().toChar()) {
        '+' -> input.readLine()          // simple string
        '-' -> throw RedisException(input.readLine())  // error
        ':' -> input.readLine().toLong()  // integer
        '$' -> {                          // bulk string
            val len = input.readLine().toInt()
            if (len == -1) return null    // null bulk string
            val data = ByteArray(len).also { input.readFully(it) }
            input.read(); input.read()   // consume \r\n
            String(data)
        }
        '*' -> {                          // array
            val count = input.readLine().toInt()
            (1..count).map { parseResp(input) }
        }
        else -> throw ProtocolException("Unknown type: $type")
    }
}
```

---

## Performance: Protocol Benchmarking

```kotlin
// Benchmark different encodings for the same data
data class Event(val userId: Long, val action: String, val timestamp: Long)

fun benchmarkEncodings() {
    val event = Event(123456789L, "page_view", System.currentTimeMillis())
    
    // JSON: ~60 bytes
    val json = """{"userId":123456789,"action":"page_view","timestamp":${event.timestamp}}"""
    
    // MessagePack: ~35 bytes, 2-3x faster serialize/deserialize
    // Protobuf: ~20 bytes, 5-10x faster than JSON
    // Custom binary: ~21 bytes, maximal control
    
    // For 1M events/sec:
    // JSON: 60MB/s bandwidth, ~500ns/serialize
    // Protobuf: 20MB/s bandwidth, ~50ns/serialize
    // Custom: 21MB/s bandwidth, ~10ns/serialize
}
```
