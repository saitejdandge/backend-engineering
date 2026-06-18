```agsl
cd /Users/sdandge/Desktop/backend-engineering/prototypes/pessimistic_cc/main

go mod init pessimistic_cc
go get github.com/lib/pq
go get github.com/olekukonko/tablewriter

go get github.com/olekukonko/tablewriter@v0.0.5
go mod tidy

go run main.go
```

### Setup docker
```
docker run --name my-postgres \
  -e POSTGRES_USER=admin \
  -e POSTGRES_PASSWORD=secret \
  -e POSTGRES_DB=mydb \
  -p 5433:5432 \
  -d postgres:16
```

### Connect to DB
```agsl
docker exec -it my-postgres psql -U admin -d mydb
```

### intellij
![p.png](p.png)


### show databases
```agsl
SELECT datname FROM pg_database;
```

#### cleanup bookings
```agsl
UPDATE bookings SET user_id = NULL, status = 'available';
```