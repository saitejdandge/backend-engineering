# Delegation

> What does not need to be done in real time should not be done in real time

## Use cases

* Long running tasks (spin-up ec-2 / video encoding)
* Heavy computation queries
* Batch & Write
* Adding analytics
* Logs
*  Cache cleanups
* Anything that could be eventual

In all of these use-cases, if the task is too long, our ==HTTP connection to server may not be even alive for such long==, We will end up creating stateful systems, blocking the memory of the application. We can *Delegate & Respond* later.

## Core idea: Delegate & respond

![[Screenshot 2026-06-13 at 7.47.26 PM.png]]

## Two implementations of infra units (Broker)

### Message queues

- Homogenius consumers
- Each consumer is equally capable of processing the message.
- Mostly they **Pull the message**, process it and delete it.
- Consumers can be **Horizontally scaled**
- Visibility timeout: 
	- Consumer processed the message, before it could delete, consumer died.
	- Visibility timeout means, consumer got the message, if the message is not deleted by that time, I would resurface the message to head of the queue.
	- Helps in achieving **at least - once** processing by the consumer
	- Consumers should do `idempotent` processing.
- Example: SQS, RabbitMQ
![[Screenshot 2026-06-13 at 7.48.55 PM.png]]

#### Where Message queues can go wrong

* If consumers doesn't do idempotent processing, we will have **inconsistent** data.
* Multiple teams changes are in same consumer.
![[Screenshot 2026-06-13 at 8.00.02 PM.png]]


### Message streams

* Heterogenius consumers
* Can be replayed.
* Examples: Kafka, Kinesis
![[Screenshot 2026-06-13 at 7.49.07 PM.png]]

Same message needs to be processed by multiple consumers. here consumer for each action (like for ex: search) can have multiple homogenius consumers. this group is called consumer group.

![[Screenshot 2026-06-13 at 8.03.58 PM.png]]

### Kafka internals

Kafka is a message stream that holds the messages. Internally kafka has topic, 

* Every topic has 'n' partitions
* Message is sent to topic
* Kafka has deletion policy (like 7 days for ex)
	* Depending on the configured hash key, it is put into a partition.
* ==Within the partition, messages are ordered==
	* NO ORDERING guarantee across the partitions.
 
![[Screenshot 2026-06-13 at 8.12.18 PM.png]]

* If we increase the partition count, messages in the older partitions will not be re-hashed
* New partition will start empty
* If we have fewer consumers, consumer might get messages from multiple partitions.

#### Kafka commit

Consumer commit after processing the message.

---

## Related

[[3 - Intro to Message queues]]
