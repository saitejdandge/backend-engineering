# Foundations

### Focus areas
How to approach the systems systematically, 2 mental models and frameworks. Most system design is about the details, not about drawing boxes. There is no global template for system design.

# Online offline indicator

```
user_1  ONLINE
user_2  ONLINE
user_3  OFFLINE
```

We need a way to show which users are ONLINE, and which are OFFLINE.

We need to design a offline-online indicator, do not worry about scaling at this point.  We will start with broad strokes and then find bottle necks, then go through nuances, then optimisation.

*Note: We will keep design simple for now and not focus too much on scaling*

## Database design

Let's assume if we are going to record, 
```
userId: int | isOffline: bool
```

![[Screenshot 2026-06-06 at 5.15.10 PM.png]]
## API

### Get users status API

Wherever possible, we will do a batch query,

*Note: Batch whenever & wherever possible.*

```
GET /status/users?id=x,y,z
```

### Updating user status

We have two ways (framework of opposites)

* Push based model: User push the status
* Pull based model: Server pulls from client (we can use unless if we have persistent conn)

![[Screenshot 2026-06-06 at 5.23.44 PM.png]]

**We cannot go with pull based because server has to keep track of all of these connections with clients, it's practically impossible to keep all connections**

We will go with **Push based model: User pushes the data to the servers**

![[Screenshot 2026-06-06 at 5.26.36 PM.png]]

User continuously keeps on sending heart beats to the server. (POST /heartbeat).

#### So, when is user offline: 

* When we did not receive "heartbeat" for long enough. So we need to save timestamp to know when the last heart beat is received.

#### Change in schema

```
userId: int
last_hb: timestamp

[pulse table]
```

#### When we receive heart beat from user:

We update the `last_hb`, query will look like this.
```sql
UPDATE pulse SET last_hb = now() WHERE userId=?
```

## Scale estimations

```
100 users -> 100 entries
1k users -> 1k entries
1B users (1/8 population) ->  1B entries
```

Each entry contains `user_id` => 4b, `last_hb` => 4b, total 8bytes per entry.

```
1 Million -> 10^6 ->  1MB
1 Billion -> 10^9  ->  1GB
1 Trillion -> 10^12 -> 1TB
```

so 1 billion users, 1 billion entries, each entry is 8 bytes, 
there fore total storage needed is  **1 billion entries = 8GB**

8 GB is very easy, we need not have to scale because of 8GB, 8GB is very doable.

## Framework of opposites 

Two approaches overall: 
* Dense approach, current one, where we save record for each user.
* Sparse approach,  do we really need to save record for each user ?
	*  What if we keep only *entries of online user*
	*  Storage is directly proportional to *Daily Active Users* & not total users.
	* How to delete the record offline users ?
		* Developer managed -> Cron job approach where we delete 
		* Database managed -> Can DB have TTL and support expiration.
			* Delete the entry in DB with TTL = `30s`
			* Redis (Open sourced)
			* DynamoDB

| Redis (OSS)                                                          | DynamoDB (Enterprise)                                  | Vote                                                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **Convenience**<br>Setting up redis if there is no ecoSystem is hard | **Convenience**<br>If System already has AWS ecosystem | DynamoDB                                                                                          |
| **Speed**<br>In memory storage, faster access 8GB in memory is okay  | **Speed**<br>Not as fast as Redis                      | Redis                                                                                             |
| **Restorability**<br>Redis is restorable                             | **Restorability**<br>Dynamodb is restorable            | - Both are same                                                                                   |
| **Cost:** <br>Redis is fixed cost point, we will deploy to EC2       | **Cost:** <br>DynamdoDB costs with RCU, WCU            |                                                                                                   |
| **Vendor lock-in**<br>No vendor lock in                              | **Vendor lock-in**<br>There is vendor lock-in with AWS | Redis is cloud agnostic,<br>Is it really a concern, unless<br>- Org tie ups<br>- competitions<br> |

## Socket.io library

*Note: In real world, with online-offline indicator, we generally use web-socket (socket.io) library to build this.*

Socket.io library is based on `web socket`, specification `web socket` specification doesn't really talk about heart beats. 

socket.io provides this callback for the developers to know if the `TCP conn` b/w the nodes is broken.

```js
socket.on('disconnect', {...})
socket.on('connect_error',{...})
```

But how does socket.io knows about connection status ? Socket library periodically **pings** the server.

```js
const socket = io(serverUrl,{
  pingTimeout: 3000,  // how long to wait
  pingInterval: 1000, // how frequently to send
  reconnection: true, // auto connect
  maxConnectionAttempts: 5, //max conn attempts
  maxConnectionDelay: 1000 // delay b/w attempts
})
```

*Note: Scaling web sockets is extremely hard*

## Scaling application layer

Here if we consider we have 1B users, continuously sending heart beats to our servers. 
Assuming worse case of traffic (peak), every user sends a heart beat every 30s.

1 user -> 2 hb per minute
* Peak traffic
	*  `2 Billion heart beats per minute. (peak traffic)
* Normal traffic
	* 1 million active users -> `2 Million requests/second (normal)`

Keeping **2 million connections is very hard in memory**, assuming every request to server creates a new TCP connection. Let's say each connection is 100Kb, so total in memory size would be 
```
100KB x 2 X 1 Million
10^5 x 2 x 10^6
2 X 10^9 X 10 ^2
~200 GB of memory is needed. // This is bottle-neck
```

**Instead of creating a connection every time, why can't we re-use a pool of connection**

![[Screenshot 2026-06-06 at 7.17.38 PM.png]]

Pros:
* Not overwhelming database with so many connections
	* Overwhelming database can cause `Too many connections error`
* Query is faster, because we don't have to create a new TCP connection
	* Each TCP connection is 3-way handshake, 2- way tear down

Example: HikariCP,  Generally we have 

```
minConnections:
maxConnections:
idleTimeOut
```


# Multi User blogging platform

- one user multiple blogs
- multiple users
## Database

```
Users:
	id
	name
	bio
Blogs:
	id
	author_id
	title
	is_deleted.    -> DELETE TYPE - SOFT vs HARD
	published_at
	body
```

Soft delete advantages
* Depends on context mostly user generated content might need soft deletes
* Way to recover the data. Temporarily put it in trash and delete hard later.
* Archival 
* Audibility
* Easy on database engine | No tree re-balancing

## Why re-balancing happens over delete ?

B+ tree, this is applicable to RDBMS, MySQL, Dynamo
![[Screenshot 2026-06-06 at 7.54.52 PM.png]]
Leaf nodes are ordered by primary key. Deletion also impacts the indiceis.

`One delete doesn't imply one discard`, Typically fragment of B+ tree is locked till the deletion is completed.  ALTER -> locks the entire table.

Unless we use incremental primary key, even in `insert` a node can be added in the middle and trigger the re-balancing , Typically UUID as primary key are costly.

* Insert UUID vs Monotonically increasing primary keys and batch delete & observe the time it to took to delete
	* UUID takes longer time because rebalancing triggers.


| **Approach**       | **Step 1: Creation Time (1M Inserts)** | **Step 2: Deletion Time (1M Rows)** | **Overall Performance Notes**                                                                                |
| ------------------ | -------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Auto-Increment Key | 12.431 sec                             | 17.156 sec                          | **Winner.** Clean sequential writes make creation fast, and contiguous data blocks make deletion efficient.  |
| UUID Key           | 36.875 sec                             | 18.309 sec                          | Random strings force heavy disk fragmentation (Page Splitting) during creation and slightly slower deletion. |

##### Creating auto incremented table & 1M records

```sql
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

```SQL
DELIMITER $$

CREATE PROCEDURE LoadUserData()
BEGIN
    DECLARE i INT DEFAULT 1;
    
    -- Start a transaction to make insertion blazing fast
    START TRANSACTION;
    
    WHILE i <= 1000000 DO
        INSERT INTO users (username, email) 
        VALUES (
            CONCAT('user_', i), 
            CONCAT('user_', i, '@example.com')
        );
        SET i = i + 1;
    END WHILE;
    
    -- Commit all changes to disk at once
    COMMIT;
END$$

DELIMITER ;
```

```sql
SET profiling = 1;
CALL LoadUserData();
DELETE FROM users WHERE username LIKE 'user_%';
SHOW PROFILES;
```

##### Creating UUID based table & 1M records

```sql
CREATE TABLE users_uuid_pk (
    id VARCHAR(36) PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

```sql
DELIMITER $$

CREATE PROCEDURE LoadUUIDUserData()
BEGIN
    DECLARE i INT DEFAULT 1;
    
    START TRANSACTION;
    
    WHILE i <= 1000000 DO
        INSERT INTO users_uuid_pk (id, username, email) 
        VALUES (
            UUID(), -- Generates a 36-character random UUID
            CONCAT('uuid_user_', i), 
            CONCAT('uuid_user_', i, '@example.com')
        );
        SET i = i + 1;
    END WHILE;
    
    COMMIT;
END$$

DELIMITER ;
```

```sql
SET profiling = 1;
CALL LoadUUIDUserData();
DELETE FROM users_uuid_pk WHERE username LIKE 'uuid_user_%';
SHOW PROFILES;
```
# Caching

More details -> [[01 - Caching Fundamentals]]

Caches can be on disk, caches can be on network. 
* Save expensive computation
* Save expensive I/O
* CDN is also kind of cache
* Glorified hash tables. Saving something expensive.

System metrics:
* Memory
* CPU
* Network
* Disk
 
![[Screenshot 2026-06-06 at 8.10.56 PM.png]]



---

## Related

[[2 - Foundational Topics]]
