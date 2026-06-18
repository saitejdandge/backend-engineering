# Testing Strategy

## The Testing Pyramid

```
        /\
       /E2E\          ← Few, slow, expensive, high confidence
      /\
     /  Integ  \      ← Some, moderate speed, test integration points
    /\
   /  Unit Tests  \   ← Many, fast, cheap, test behavior in isolation
  /\
```

The pyramid is a guide, not a law. The right ratio depends on your system. But the general principle holds: fast tests at the bottom, slow tests at the top.

---

## Unit Tests

Test a single unit of behavior in isolation. Mock/stub all dependencies.

### What Makes a Good Unit Test

- **Fast:** Milliseconds. No I/O, no network, no DB.
- **Isolated:** Tests one thing. Failure pinpoints the issue.
- **Deterministic:** Same input → same output every time. No randomness, no time dependency.
- **Self-describing:** Test name explains what behavior is being verified.

### The AAA Pattern

```python
def test_order_total_includes_tax():
    # Arrange
    order = Order(items=[
        OrderItem(product_id="p1", price=100.0, quantity=2),
        OrderItem(product_id="p2", price=50.0, quantity=1),
    ])
    tax_rate = 0.1

    # Act
    total = order.calculate_total_with_tax(tax_rate)

    # Assert
    assert total == 275.0  # (200 + 50) * 1.1
```

### Test Naming Convention

Name the test as a specification: `test_<unit>_<scenario>_<expected_result>`

```python
def test_create_order_with_empty_items_raises_validation_error():
def test_payment_retry_succeeds_on_third_attempt():
def test_user_is_locked_after_five_failed_logins():
```

### Test Doubles

- **Mock:** Pre-programmed with expectations. Verifies interactions. (was this method called? with what args?)
- **Stub:** Returns canned responses. No verification.
- **Fake:** Lightweight working implementation (in-memory repo instead of DB).
- **Spy:** Records calls, lets you verify after the fact.

```python
from unittest.mock import Mock, patch

def test_order_creation_publishes_event():
    # Arrange
    mock_event_bus = Mock()
    mock_repo = Mock()
    mock_repo.save.return_value = Order(id="order-123")
    
    use_case = CreateOrderUseCase(repo=mock_repo, event_bus=mock_event_bus)
    
    # Act
    use_case.execute(CreateOrderCommand(user_id="user-1", items=[...]))
    
    # Assert
    mock_event_bus.publish.assert_called_once()
    published_event = mock_event_bus.publish.call_args[0][0]
    assert isinstance(published_event, OrderCreatedEvent)
    assert published_event.order_id == "order-123"
```

### Property-Based Testing

Instead of hand-crafted examples, generate many random inputs and verify properties hold for all.

```python
from hypothesis import given, strategies as st

@given(
    amount=st.floats(min_value=0, max_value=1_000_000),
    quantity=st.integers(min_value=1, max_value=100)
)
def test_order_total_always_non_negative(amount, quantity):
    item = OrderItem(price=amount, quantity=quantity)
    order = Order(items=[item])
    assert order.total() >= 0

@given(
    items=st.lists(st.builds(OrderItem, price=st.floats(min_value=0), quantity=st.integers(min_value=1)))
)
def test_order_total_equals_sum_of_items(items):
    order = Order(items=items)
    expected = sum(i.price * i.quantity for i in items)
    assert abs(order.total() - expected) < 0.001  # float tolerance
```

---

## Integration Tests

Test that components work correctly together. Includes real (or realistic) dependencies — actual DB, actual Redis, but typically not external services.

### Testcontainers

Spin up real dependencies as Docker containers in tests. Disposable, fast, realistic.

```python
import pytest
from testcontainers.postgres import PostgresContainer

@pytest.fixture(scope="session")
def postgres():
    with PostgresContainer("postgres:15") as pg:
        yield pg

@pytest.fixture
def db(postgres):
    engine = create_engine(postgres.get_connection_url())
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)

def test_order_repository_saves_and_retrieves_order(db):
    repo = PostgresOrderRepository(db)
    order = Order(id="123", user_id="user-1", items=[])
    
    repo.save(order)
    retrieved = repo.find_by_id("123")
    
    assert retrieved.id == order.id
    assert retrieved.user_id == order.user_id
```

### What to Integration Test

- Repository implementations (does SQL work correctly?)
- Cache interactions (does Redis serialization/deserialization work?)
- Message queue producers and consumers (does Kafka message format serialize correctly?)
- HTTP clients against real (or mocked) external services

---

## Contract Testing

Test the contract between services without spinning up both services together.

### Consumer-Driven Contract Testing (Pact)

The consumer defines what it expects from the provider. Provider verifies it satisfies those expectations.

```python
# Consumer side: defines what it expects
from pact import Consumer, Provider

pact = Consumer('order-service').has_pact_with(Provider('inventory-service'))

pact.given('product exists').upon_receiving('a request for product 123') \
    .with_request('GET', '/products/123') \
    .will_respond_with(200, body={'id': '123', 'stock': 50})

# Provider side: verifies it satisfies the contract
# (run as part of inventory-service's CI pipeline)
```

**Why this matters at staff level:** Without contract tests, integration issues only surface when both services are deployed together. Contract tests catch breaking changes before they reach staging.

---

## E2E Tests

Test complete user flows from the outside. Slowest, most brittle, most confidence.

### What to E2E Test

Only critical user journeys:
- New user can sign up, add an item to cart, and complete checkout
- Existing user can view order history
- Admin can process a refund

Don't write E2E tests for every feature. Use integration/unit tests instead.

### E2E Test Design Principles

- **Independent:** Each test cleans up after itself. Tests don't share state.
- **Deterministic:** Use test-specific data. Don't depend on production data or ordering.
- **Stable selectors:** Use data-testid attributes, not CSS classes or text content that changes.
- **Fast failure:** Set appropriate timeouts. Don't wait 30 seconds for something that should take 1.

### Tools

- **Playwright:** Modern, supports all major browsers, fast, good TypeScript support.
- **Cypress:** JavaScript-focused, excellent DX, good for frontend-heavy apps.
- **REST Assured / Postman:** API-level E2E testing.
- **k6 / Gatling:** Load testing as a form of E2E validation under stress.

---

## Test Coverage

Coverage measures what percentage of code is executed by tests.

**Don't use coverage as a goal in itself.** 100% coverage with bad tests is worthless. 70% coverage with good tests that cover critical paths is valuable.

**What coverage tells you:**
- Which code is never tested (potential hidden bugs)
- Which code was deleted but tests still reference it

**What coverage doesn't tell you:**
- Whether tests are meaningful
- Whether error cases are covered
- Whether the right behavior is asserted

**Reasonable targets:**
- Core business logic: 90%+
- Infrastructure/adapters: 70%+
- Generated code / third-party wrappers: exempt

### Mutation Testing

The gold standard for test quality. Introduces small bugs (mutations) into the code and checks if tests catch them.

```python
# Original:
def is_adult(age: int) -> bool:
    return age >= 18

# Mutation 1: >= changed to >
def is_adult(age: int) -> bool:
    return age > 18   # Tests should catch this!

# Mutation 2: 18 changed to 17
def is_adult(age: int) -> bool:
    return age >= 17  # Tests should catch this!
```

Tools: **mutmut** (Python), **PIT** (Java).

---

## Test-Driven Development (TDD)

Write the test first, then write the code to make it pass.

**Red → Green → Refactor:**
1. **Red:** Write a failing test for the next piece of behavior
2. **Green:** Write the minimum code to make the test pass
3. **Refactor:** Clean up code and tests while keeping tests green

**Benefits:**
- Forces you to think about the interface before the implementation
- Results in naturally testable code (no untestable God classes)
- Tests serve as executable documentation
- Prevents over-engineering (you only write code that's needed)

**TDD is not always appropriate:** UI prototyping, exploratory coding, performance optimization. But it's highly effective for business logic, APIs, and anything with well-defined behavior.

---

## Testing in Production

Test techniques that run against real production traffic:

- **Canary analysis:** Compare error rate and latency between canary and stable versions
- **Shadow testing:** Send a copy of real traffic to new service, compare responses without affecting users
- **A/B testing:** Compare business metrics between two versions with real users
- **Chaos engineering:** Intentionally break things (see Reliability Engineering notes)
- **Synthetic monitoring:** Run real transactions against production on a schedule (check that checkout actually works every 5 minutes)


---

## Related

[[Clean Architecture & SOLID]]
