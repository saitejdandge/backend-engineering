# Clean Architecture & SOLID

## SOLID Principles (Applied, Not Just Theoretical)

### S — Single Responsibility Principle

A class/module should have only one reason to change. One responsibility = one actor that can demand changes.

```python
# BAD: UserService does too much
class UserService:
    def create_user(self, data): ...
    def send_welcome_email(self, user): ...   # Email concern
    def generate_pdf_report(self, user): ...  # Reporting concern
    def validate_password_strength(self, password): ...  # Validation concern

# GOOD: Each class has one responsibility
class UserRepository:
    def save(self, user): ...

class EmailService:
    def send_welcome(self, user): ...

class PasswordValidator:
    def validate(self, password) -> bool: ...

class UserRegistrationService:
    def __init__(self, repo, email_svc, validator):
        self.repo = repo
        self.email_svc = email_svc
        self.validator = validator
    
    def register(self, data):
        self.validator.validate(data.password)
        user = self.repo.save(User(data))
        self.email_svc.send_welcome(user)
        return user
```

**Real-world signal:** If your class has more than one of {HTTP handling, business logic, DB access, email sending}, it's violating SRP.

### O — Open/Closed Principle

Open for extension, closed for modification. Add new behavior without changing existing code.

```python
# BAD: Adding a new discount type requires modifying existing code
def calculate_discount(order, discount_type):
    if discount_type == "percentage":
        return order.total * 0.1
    elif discount_type == "fixed":
        return 10.0
    elif discount_type == "bogo":  # New type requires modifying this function
        return order.total / 2

# GOOD: New discount type = new class, no existing code changed
from abc import ABC, abstractmethod

class DiscountStrategy(ABC):
    @abstractmethod
    def calculate(self, order) -> float: ...

class PercentageDiscount(DiscountStrategy):
    def calculate(self, order): return order.total * 0.1

class FixedDiscount(DiscountStrategy):
    def calculate(self, order): return 10.0

class BogoDiscount(DiscountStrategy):          # New type: just add new class
    def calculate(self, order): return order.total / 2

def calculate_discount(order, strategy: DiscountStrategy) -> float:
    return strategy.calculate(order)
```

### L — Liskov Substitution Principle

Subtypes must be substitutable for their base types. If code works with a base class, it must work with any subclass.

```python
# VIOLATION: Square breaks the Rectangle contract
class Rectangle:
    def set_width(self, w): self.width = w
    def set_height(self, h): self.height = h
    def area(self): return self.width * self.height

class Square(Rectangle):
    def set_width(self, w):
        self.width = w
        self.height = w  # Breaks Rectangle's contract: width/height are independent
    def set_height(self, h):
        self.width = h
        self.height = h

# Code that works with Rectangle breaks with Square:
def stretch(rect: Rectangle):
    rect.set_width(5)
    rect.set_height(10)
    assert rect.area() == 50  # Fails with Square: area is 100
```

**Practical signal:** If you have `if isinstance(x, SubClass)` checks in code that works with the base class, LSP is likely violated.

### I — Interface Segregation Principle

Clients should not depend on interfaces they don't use. Prefer small, specific interfaces over large general ones.

```python
# FAT INTERFACE (bad): All implementors must implement everything
class Worker(ABC):
    def work(self): ...
    def eat(self): ...      # Robots don't eat!
    def sleep(self): ...    # Robots don't sleep!

# SEGREGATED (good): Small focused interfaces
class Workable(ABC):
    def work(self): ...

class Eatable(ABC):
    def eat(self): ...

class HumanWorker(Workable, Eatable):
    def work(self): ...
    def eat(self): ...

class RobotWorker(Workable):
    def work(self): ...     # Only implements what it needs
```

### D — Dependency Inversion Principle

High-level modules should not depend on low-level modules. Both should depend on abstractions.

```python
# BAD: High-level OrderService depends on low-level MySQLOrderRepository
class OrderService:
    def __init__(self):
        self.repo = MySQLOrderRepository()  # Concrete dependency

# GOOD: Both depend on the abstraction
class OrderRepository(ABC):
    @abstractmethod
    def save(self, order) -> Order: ...

class MySQLOrderRepository(OrderRepository):
    def save(self, order): ...  # MySQL implementation

class DynamoOrderRepository(OrderRepository):
    def save(self, order): ...  # DynamoDB implementation

class OrderService:
    def __init__(self, repo: OrderRepository):  # Depends on abstraction
        self.repo = repo
```

This is the foundation of dependency injection (DI). DI containers (Spring, Guice, FastAPI Depends) automate wiring.

---

## Clean Architecture

Robert Martin's architecture that enforces separation of concerns through dependency rules.

### The Dependency Rule

**Dependencies only point inward.** Inner layers know nothing about outer layers.

```

  Frameworks & Drivers                      ← outermost
    
    Interface Adapters                 
       
      Application (Use Cases)       
          
        Domain (Entities)          ← innermost, no dependencies
          
       
    

```

### Layers

**Domain (Entities):**
- Business rules and entities. Pure business logic.
- No framework dependencies, no DB, no HTTP.
- Depends on: nothing.
- Example: `Order`, `Payment`, `User` domain objects with business methods.

**Application (Use Cases):**
- Orchestrates domain objects to fulfill a use case.
- Defines ports (interfaces) for what it needs from the outside.
- Depends on: Domain only.
- Example: `CreateOrderUseCase`, `ProcessPaymentUseCase`.

**Interface Adapters:**
- Converts between use case data formats and external formats.
- Controllers (HTTP → use case), Presenters (use case → HTTP response), Repositories (use case port → DB).
- Depends on: Application, Domain.

**Frameworks & Drivers:**
- Flask/FastAPI, SQLAlchemy, Redis, external APIs.
- Depends on: Interface Adapters.

### Practical Example

```python
# Domain (no dependencies)
class Order:
    def __init__(self, id, user_id, items):
        self.id = id
        self.user_id = user_id
        self.items = items
        self.status = "pending"
    
    def total(self) -> float:
        return sum(item.price * item.quantity for item in self.items)
    
    def can_cancel(self) -> bool:
        return self.status == "pending"

# Application Port (interface the use case needs)
class OrderRepository(ABC):
    @abstractmethod
    def save(self, order: Order) -> None: ...
    @abstractmethod
    def find_by_id(self, order_id: str) -> Order: ...

# Application Use Case
class CreateOrderUseCase:
    def __init__(self, order_repo: OrderRepository, event_publisher: EventPublisher):
        self.order_repo = order_repo
        self.event_publisher = event_publisher
    
    def execute(self, command: CreateOrderCommand) -> Order:
        order = Order(id=generate_id(), user_id=command.user_id, items=command.items)
        self.order_repo.save(order)
        self.event_publisher.publish(OrderCreatedEvent(order.id))
        return order

# Interface Adapter (HTTP Controller)
class OrderController:
    def __init__(self, use_case: CreateOrderUseCase):
        self.use_case = use_case
    
    def create_order(self, request: HttpRequest) -> HttpResponse:
        command = CreateOrderCommand(
            user_id=request.json["user_id"],
            items=request.json["items"]
        )
        order = self.use_case.execute(command)
        return HttpResponse(status=201, body={"order_id": order.id})

# Framework & Drivers (concrete DB implementation)
class PostgresOrderRepository(OrderRepository):
    def save(self, order: Order) -> None:
        db.execute("INSERT INTO orders ...", order.id, order.user_id, ...)
    
    def find_by_id(self, order_id: str) -> Order:
        row = db.execute("SELECT * FROM orders WHERE id = %s", order_id)
        return Order(id=row.id, user_id=row.user_id, items=row.items)
```

---

## Domain-Driven Design (Key Concepts)

### Bounded Context

A clear boundary within which a particular domain model applies. The same word ("Order") can mean different things in different contexts.

```
Sales Context: Order = customer-facing purchase with line items, discounts, shipping
Fulfillment Context: Order = package to be picked, packed, and shipped
Accounting Context: Order = revenue transaction with tax implications
```

Each context has its own model, database, and service. They communicate via events, not shared tables.

### Aggregates

A cluster of objects treated as a single unit with a clear boundary and a root entity. External code can only access aggregate internals through the root.

```python
# Order is the Aggregate Root
# OrderItem is part of the Order aggregate
# External code never holds a reference directly to OrderItem

class Order:  # Aggregate Root
    def add_item(self, product_id, quantity, price):
        # All mutations go through the root
        item = OrderItem(product_id, quantity, price)
        self._items.append(item)
        self._validate_item_limit()  # Invariant enforced here
    
    def remove_item(self, product_id):
        # Business rule: can't remove if order is already shipped
        if self.status == "shipped":
            raise BusinessRuleViolation("Cannot remove items from shipped order")
        self._items = [i for i in self._items if i.product_id != product_id]
```

**Rule:** One transaction = one aggregate. Cross-aggregate changes use eventual consistency (events).

### Value Objects

Immutable objects defined by their value, not identity. No ID. If two value objects have the same values, they're equal.

```python
from dataclasses import dataclass
from typing import ClassVar

@dataclass(frozen=True)  # frozen=True makes it immutable
class Money:
    amount: float
    currency: str
    
    def __post_init__(self):
        if self.amount < 0:
            raise ValueError("Amount cannot be negative")
    
    def add(self, other: 'Money') -> 'Money':
        if self.currency != other.currency:
            raise ValueError("Cannot add different currencies")
        return Money(self.amount + other.amount, self.currency)
    
    def __str__(self):
        return f"{self.amount} {self.currency}"

# Usage
price = Money(29.99, "USD")
tax = Money(2.40, "USD")
total = price.add(tax)  # Returns new Money object, original unchanged
```


---

## Related

[[Testing Strategy]]
