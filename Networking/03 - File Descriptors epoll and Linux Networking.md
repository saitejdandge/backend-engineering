# File Descriptors, epoll & Linux Networking Internals

## Everything is a File

In Linux, almost everything is represented as a **file descriptor (fd)** — an integer that references a kernel object.

```
fd 0 = stdin
fd 1 = stdout  
fd 2 = stderr
fd 3 = first TCP socket your app opens
fd 4 = second TCP socket
...
```

A file descriptor is just an index into the **file descriptor table** maintained by the kernel for each process. The table entry points to the actual kernel object (socket, file, pipe, device).

```c
// What happens when you open a socket:
int fd = socket(AF_INET, SOCK_STREAM, 0);  // creates socket, returns fd=3
connect(fd, &server_addr, sizeof(server_addr));  // TCP handshake
write(fd, "GET / HTTP/1.1\r\n", 16);  // send data
read(fd, buffer, 4096);  // receive data
close(fd);  // release fd
```

### fd Limits

**Per-process limit:** `ulimit -n` (default 1024, often raised to 65536 or 1048576)

**System-wide limit:** `/proc/sys/fs/file-max`

```bash
# Check current limits
ulimit -n           # per-process soft limit
cat /proc/sys/fs/file-max  # system-wide

# Raise per-process limit
ulimit -n 1048576

# Permanent: /etc/security/limits.conf
* soft nofile 1048576
* hard nofile 1048576
```

**C10K problem:** How do you handle 10,000 concurrent connections? Each connection = 1 fd. Not the fd limit that's the bottleneck — it's the I/O model.

---

## I/O Models: select → poll → epoll

### select() — The Original (Broken)

```c
fd_set read_fds;
FD_ZERO(&read_fds);
FD_SET(fd1, &read_fds);
FD_SET(fd2, &read_fds);

select(max_fd + 1, &read_fds, NULL, NULL, &timeout);
// Kernel checks ALL fds 0..max_fd — O(N) scan
```

**Problems:**
- Max 1024 fds hardcoded (`FD_SETSIZE`)
- Copies fd_set between user space and kernel on every call — O(N)
- After returning, must scan all fds to find which are ready — O(N)
- O(N) per call where N = all monitored fds

### poll() — Slightly Better

```c
struct pollfd fds[N];
fds[0] = {fd1, POLLIN, 0};
fds[1] = {fd2, POLLIN, 0};

poll(fds, N, timeout);
// Still copies all N fds to kernel each call
// Still O(N) scan on return
```

No 1024 limit, but still O(N) per call. With 10,000 connections, each poll() scans all 10,000.

### epoll — The Modern Solution (Linux 2.5.44+)

**Key insight:** Register interest once. Only get notified when something is ready.

```c
// Create epoll instance
int epfd = epoll_create1(0);  // returns fd for epoll instance

// Register fd for monitoring (O(1) per registration)
struct epoll_event ev = {EPOLLIN, {.fd = fd1}};
epoll_ctl(epfd, EPOLL_CTL_ADD, fd1, &ev);

// Wait for events (blocks until something is ready)
struct epoll_event events[64];
int nready = epoll_wait(epfd, events, 64, -1);  // timeout=-1 = block forever

// Only iterate over READY fds
for (int i = 0; i < nready; i++) {
    handle(events[i].data.fd);
}
```

**Why it's O(1):**
- Kernel maintains a red-black tree of monitored fds — O(log N) to add/remove
- When a fd becomes ready, kernel adds it to a ready list
- `epoll_wait` returns only the ready fds — you only process what has work

```
1,000,000 open connections, 100 ready right now:
- select/poll: scan 1,000,000
- epoll: iterate 100
```

### Edge-Triggered vs Level-Triggered

**Level-triggered (default):** `epoll_wait` returns a fd as long as it has data. If you don't read all data, it keeps notifying you.

**Edge-triggered (EPOLLET):** `epoll_wait` returns a fd ONCE when new data arrives. You must read until `EAGAIN` (no more data). Harder to use but more efficient.

---

## How Nginx/Redis Use epoll

### The Event Loop Pattern

```
while (true) {
    events = epoll_wait(epfd, events, MAX_EVENTS, -1)
    for event in events:
        if event.fd == listen_fd:
            new_conn = accept()
            epoll_ctl(ADD, new_conn, EPOLLIN)
        else:
            data = read(event.fd)
            process(data)
            write(event.fd, response)
}
```

This is essentially what Nginx, Redis, and Node.js do. One thread, one event loop, millions of connections.

**Why it works:** Most connections are idle. A connection that's waiting for a database query doesn't need a thread — it just needs to be in the epoll interest list. When the response arrives, epoll wakes up the event loop to handle it.

---

## Sockets Deep Dive

### Socket Types

```c
// TCP socket (SOCK_STREAM)
int tcp_fd = socket(AF_INET, SOCK_STREAM, 0);

// UDP socket (SOCK_DGRAM)
int udp_fd = socket(AF_INET, SOCK_DGRAM, 0);

// Unix domain socket (local IPC)
int unix_fd = socket(AF_UNIX, SOCK_STREAM, 0);
```

Unix domain sockets communicate between processes on the same machine via a file path — no TCP overhead. Nginx uses them to talk to PHP-FPM or upstream services locally.

### Socket Options

```c
// Reuse address (crucial for server restart without waiting)
int opt = 1;
setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

// Keep-alive: detect dead connections
setsockopt(fd, SOL_SOCKET, SO_KEEPALIVE, &opt, sizeof(opt));

// TCP_NODELAY: disable Nagle's algorithm (send small packets immediately)
// Important for low-latency protocols (games, Redis CLI)
setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &opt, sizeof(opt));

// Set receive buffer size
int buf = 4 * 1024 * 1024;  // 4MB
setsockopt(fd, SOL_SOCKET, SO_RCVBUF, &buf, sizeof(buf));
```

### TCP Buffer Sizes

Each TCP connection has:
- **Send buffer** (`SO_SNDBUF`): kernel buffers outgoing data before ACK
- **Receive buffer** (`SO_RCVBUF`): kernel buffers incoming data before app reads

Default: ~128KB each. For high-throughput file transfer, increase to 4-16MB.

Autotuning: Linux kernel automatically adjusts TCP buffers based on RTT and bandwidth (`net.ipv4.tcp_rmem` / `net.ipv4.tcp_wmem`).

---

## io_uring (Linux 5.1+)

The newest I/O interface. Even more efficient than epoll for certain workloads.

**Problem with epoll:** Still requires syscalls for each read/write. Syscall = kernel/user space context switch = overhead.

**io_uring:** Shared ring buffers between userspace and kernel. Submit batches of I/O operations without syscalls. Kernel completes them and posts results to completion ring.

```
Submission ring: userspace writes I/O requests here
Completion ring: kernel writes I/O results here
// Zero-copy, zero syscall for batched I/O
```

Used by: modern io libraries (io_uring-backed async Rust, Java Netty 5), high-performance databases, storage engines.

Not yet mainstream but represents the future of Linux I/O.

---

## /proc/net — Inspecting Network State

```bash
# All TCP connections and their state
cat /proc/net/tcp
ss -s                    # socket summary
ss -tnp                  # TCP, numeric, with process

# Count connections by state
ss -tn | awk '{print $1}' | sort | uniq -c

# TCP socket queue depths (Recv-Q = unread data, Send-Q = unsent)
ss -tn | head -20

# Network interface stats
cat /proc/net/dev
ip -s link

# Connection tracking (for NAT/firewall)
cat /proc/net/nf_conntrack | wc -l
```

### TCP States to Know

| State | Meaning |
|---|---|
| LISTEN | Server waiting for connections |
| SYN_SENT | Client sent SYN, waiting for SYN-ACK |
| ESTABLISHED | Connection active |
| TIME_WAIT | Connection closed, waiting 2×MSL before freeing fd |
| CLOSE_WAIT | Remote closed, local hasn't yet |

**TIME_WAIT buildup:** After a connection closes, the socket stays in TIME_WAIT for 2×MSL (default 60s on Linux). Under high connection churn, you can exhaust ephemeral ports.

Fix:
```bash
# Reuse TIME_WAIT sockets
echo 1 > /proc/sys/net/ipv4/tcp_tw_reuse

# Or reduce time_wait duration
echo 30 > /proc/sys/net/ipv4/tcp_fin_timeout
```

---

## Kernel Tuning for High-Connection Servers

```bash
# /etc/sysctl.conf

# Backlog queue for new connections (increase for high-traffic servers)
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535

# Ephemeral port range (for outgoing connections)
net.ipv4.ip_local_port_range = 1024 65535

# TCP keepalive (detect dead connections faster)
net.ipv4.tcp_keepalive_time = 120      # seconds before first probe
net.ipv4.tcp_keepalive_intvl = 10      # interval between probes
net.ipv4.tcp_keepalive_probes = 3      # probes before declaring dead

# File descriptor limit
fs.file-max = 2097152

# Receive/send buffer autotuning
net.core.rmem_max = 134217728    # 128MB max receive buffer
net.core.wmem_max = 134217728    # 128MB max send buffer
net.ipv4.tcp_rmem = 4096 87380 67108864
net.ipv4.tcp_wmem = 4096 65536 67108864
```

---

## Practical: Tracing Network Issues

```bash
# Is the port listening?
ss -tlnp | grep 8080

# Packet capture on port 8080
tcpdump -i any -n port 8080 -w capture.pcap

# Count SYN packets (SYN flood detection)
tcpdump -i eth0 'tcp[tcpflags] & tcp-syn != 0' | wc -l

# Connection latency to a host
hping3 -S -p 443 google.com -c 10  # TCP ping

# Trace route with latency per hop
traceroute -T -p 443 google.com   # TCP traceroute

# strace to see syscalls (fd operations)
strace -p <pid> -e trace=read,write,accept,epoll_wait
```
