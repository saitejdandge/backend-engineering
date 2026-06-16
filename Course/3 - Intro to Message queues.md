

# Motivating Example

Let's say we are building photo sharing application, There is bunch of stuff we need to do like
* Content moderation
* Image resizing
* Filtering ..etc
All these tasks are ==long running tasks==. There are bunch of problems if we just do them at server level.

![[Screenshot 2026-06-14 at 7.13.01 PM.png]]

### Problems

* Slow response, we may not even know if the connection b/w client & server is alive.
* Causes server to overload CPU, Memory over all throttles it. Can't handle heavy traffic.
* Bad user experience if the server crashes mid way.

# Solution - Message queue

> What need not be done in real time, shouldn't be done in real time.


We will add a message queue and give some breathing space to server.

![[Screenshot 2026-06-14 at 7.15.33 PM.png]]

Other end of queue, we have workers, polling the tasks and process the tasks in parallel.

* Uploads are fast now
* Failures are isolated
* Heavy traffic mean deeper queue.


# Message queue

Message queue is ==buffered queue sits between producer and consumer==. 

We ==decouple== producer and consumer

* We can scale producers and consumers independently.

![[Screenshot 2026-06-14 at 7.18.15 PM.png]]


# Acknowledgements


![[Screenshot 2026-06-14 at 7.20.58 PM.png]]

We need acknowledgements from consumers because if consumers breaks half way, we will loose on that task.

Queue will hold on messages, until consumers `ACKS` the message.

#### Slow messages

![[Screenshot 2026-06-14 at 7.23.15 PM.png]]

Let's say there is message which is very slow, consumer 1 picks the message, consumer 2 will wait on forever.

* Consumer 2 can't process the same message because of work depublication. 
* If work the consumer does is not idempotent, it could be dangerous to application.
#### SQS 

When consumer picks a message, it becomes ==invisible== for some time for other consumers.
#### Kafka

Kafka assigns each partition to exactly ==one consumer== in consumer group

#### Rabbit MQ

They do channel level pre-fetch limits and ACK's
All these implementations have a way to prevent  ==duplicate processing==

#### Tricky edge case

What if consumer crashes right before it `ACKS`, We need to make sure consumers are **idempotent**

# Delivery guarantees

* At least once - Message may be delivered more than once.
* At most once - Fire and forget; message may never arrive.
* Exactly once - Every message processed exactly one time.

We will have to design consumers naturally `idempotent`

`Atleast - Once + Idempotent consumers`  is most used.

# When to use queues ?

![[Screenshot 2026-06-14 at 7.31.17 PM.png]]


# Scaling queue

There are two sides of queue that needs scaling.

* Write throughput to the queue (producer side)
* Read throughput from the queue (consumer side)

![[Screenshot 2026-06-14 at 7.50.05 PM.png]]


![[Screenshot 2026-06-14 at 8.16.58 PM.png]]

## Scaling write throughput to queue.

We will have concept called `paritions`, These partitions are sub-queues within that queue. 

### Choosing partition key:

* Ordering is maintained at partition level
* Even distribution,  some partitions could be HOT. 

It's tricky to choosing: 'Keys giving ordering might not give equal distribution'


## Scaling read consumption

We can scale read consumption through `consumer groups`.  Each partition for a given topic will be consumed by a **consumer** within the consumer group.

### Limitations

* When we increase partitions, Older messages in the queue ==won't be rehashed== to the new partition. Every new partition starts ==fresh==.
	* Re balancing will not happen, we will get up events in new partition now.
* We cannot ==decrease the partitions==.
* We cannot have more consumers than the partitions it-self, Additional consumers added will be ==idle==. 
* If consumers are under provisioned, ==consumer== can read from multiple partitions.
* Ordering is maintained only at ==partition level==.
* ==Kafka doesn't use consistent hashing== for re-balancing because its ==append only== nature and moving messages means deleting the data, that is not supported. In addition to this, there is this concept of consumer in consumer group.

# Challenges

## What happens when producers outpace the consumers ?

This is not a capacity problem, Queue won't solve this problem, Queue just ==delays== it

* Auto scaling the consumers
* Alert based on queue depth
* Add more partitions
* Slow the producers

## When message always fails to process ?

![[Screenshot 2026-06-14 at 8.00.55 PM.png]]

Handling ==poisoned message==, we can put that message in `dead letter queue` after n retries.

## When queue it goes down ?

Modern queues have replicas, They also store these messages to ==disk==, Kafka does it.

![[Screenshot 2026-06-14 at 8.03.13 PM.png]]


* Kafka offers ==replaying==

# Common technologies.

* Kafka
	* Can act as both `streaming platform` & `message queues`
	* Durable, writes to disk
	* Scales with partitions & consumer groups.
	* Doesn't remove automatically once they are consumed, They are put in disk to replay.
* SQS
	* Fully managed
	* Standard queue - Best effort ordering + high throughputs.
	* FIFO queues - Strict ordering + low throughput
* Rabbit MQ
	* Complex message broker
	* Complex routing
