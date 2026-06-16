# Agenda

-  Scaling & proxy-sql primer
-  Delegation & Kafka essentials
-  Communication (short poll, long poll, web sockets, SSE)

# Scaling

Ability to handle large number of *concurrent* requests.

Two types of scaling

## Vertical Scaling

* Increase RAM, CPU..etc

## Horizontal scaling

 * Gives linear amplification, we can analyse `unit tech economics`

*  Always do the ==perf test== to determine numbers, it has lot to do with context, whether its CPU intensive, or I/O intensive.

* ~ infinite scale, but there is a catch. ==Stateful components== should be able to handle those many requests. Whenever we are scaling do it ==bottom up==

![[Screenshot 2026-06-07 at 11.32.31 AM.png]]*Scaling the DB first*, For example e-commerce, payments first, then e-commerce.

## Scaling databases

![[Screenshot 2026-06-07 at 11.33.44 AM.png]]

### Vertical Scaling

First we will try to do `vertical scaling`, Sometimes there is a down-time.

## Read Replicas

If we have high read throughput, we can do read-replicas. Typically replicas pull the data from master and they serve reads.

* Reads goes to replicas
* Write & Critical Reads go to master.

### Defining Topology

- Either application layer can connect to those instances of the nodes
- We can put a PG proxy in front of Database layer and configure routes.

![[Screenshot 2026-06-07 at 11.40.39 AM.png]]

## Sharding

We shard the database, if write throughput is high. Sharding can be of two types,

*If one node is not able to handle the load, observe the query pattern*, Avoid cross shard querying, Vitess -> MySQL

* Range based sharding
* Key based sharding

Either API server 
* Knows the topology
* Doesn't know the topology (API server -> connects to coordinator)

Same topology setup,  application server may create multiple connection objects for the shards and pick the up one based on the context.

Sometimes the database provider handles the partition pickups, and abstracts that logic
example: *DynamoDB, MongoDB*

## Proxy SQL Primer [[01 - What is ProxySQL]]

This is a mySQL proxy, which coordinates and ==abstracts the topology from the application layer==.

We configure database topology in this proxy based on some *rules*.

We will group the nodes based on the ==hostgroups== , For example, Let's say we have one master and three replicas. 

* Master -> host group (10)
* Read replica_1, replica_2, replica_3 -> host group(20)
* We can pass the host group ids when executing the database query, Proxy will send that request to *any* node within that host group.

![[Screenshot 2026-06-07 at 11.51.04 AM.png]]
![[Screenshot 2026-06-07 at 11.52.00 AM.png]]
![[Screenshot 2026-06-07 at 11.53.00 AM.png]]

![[Screenshot 2026-06-07 at 11.53.38 AM.png]]

### Scaling the proxy

Either the vertical scaling or horizontal scaling.

![[Screenshot 2026-06-07 at 11.56.26 AM.png]]
*L4 raw TCP load balancer just works fine*, 

Amazon RDS by default uses proxy SQL, Postgres uses PG Bouncer. Proxy can maintain connection pools.



