# connection_pool

Ktor server with a HikariCP connection pool backed by a local MySQL instance.

## MySQL setup

Create the database before starting the server:

```sql
CREATE DATABASE IF NOT EXISTS connection_pool;
```

Default connection settings are in `src/main/resources/application.yaml`:

| Setting | Default | Env override |
|---------|---------|--------------|
| Host | `localhost:3306` | `DB_JDBC_URL` |
| Database | `connection_pool` | *(in JDBC URL)* |
| Username | `root` | `DB_USERNAME` |
| Password | `password` | `DB_PASSWORD` |
| Pool size | `10` | `DB_MAX_POOL_SIZE` |

If your local MySQL requires a password (common with Docker installs), export it before running:

```bash
export DB_PASSWORD=your_password
./gradlew run
```

## Endpoints

| Path | Description |
|------|-------------|
| `GET /` | Health hello |
| `GET /db/ping` | Runs `SELECT 1` via HikariCP and returns pool stats |

Example:

```bash
curl http://localhost:8080/db/ping
# status=ok, result=1, pool={active=0, idle=1, total=1, waiting=0}
```

## Building & Running

| Task              | Description       |
|-------------------|-------------------|
| `./gradlew test`  | Run the tests     |
| `./gradlew build` | Build the project |
| `./gradlew run`   | Run the server    |

If the server starts successfully, you'll see the following output:

```
Application - HikariCP pool initialized for jdbc:mysql://localhost:3306/connection_pool...
Application - Responding at http://0.0.0.0:8080
```
