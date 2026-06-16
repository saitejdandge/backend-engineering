# Basic commands

| command                                               | use                                         |
| ----------------------------------------------------- | ------------------------------------------- |
| `docker ps`                                           | View running containers                     |
| `docker ps - a`                                       | view all containers including stopped ones' |
| `docker stop my-web-server`                           | stop a container                            |
| `docker start my-web-server`                          | start a container                           |
| `docker rm my-web-server`                             | delete a container                          |
| `docker run --name my-web-server -p 8080:80 -d nginx` | start a nginx container                     |

# MySQL setup


| command                                                                                                                                                                                                             | use                           | More details                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `docker run --name local-mysql -e MYSQL_ROOT_PASSWORD=password -p 3306:3306 -d mysql:latest`                                                                                                                        | Setup a my sql instance       | - **Host:** `127.0.0.1` or `localhost`<br>    <br>- **Port:** `3306`<br>    <br>- **Username:** `root` |
| `docker exec -it local-mysql mysql -u root -p `                                                                                                                                                                     | Connect to the mysql instance |                                                                                                        |
| CREATE TABLE users (<br>    id INT AUTO_INCREMENT PRIMARY KEY,<br>    username VARCHAR(50) NOT NULL UNIQUE,<br>    email VARCHAR(100) NOT NULL UNIQUE,<br>    created_at TIMESTAMP DEFAULT  CURRENT_TIMESTAMP<br>); | Create a sample table         |                                                                                                        |
| INSERT INTO users (username, email) VALUES <br>('johndoe', 'john@example.com'),<br>('janedoe', 'jane@example.com'),<br>('coder123', 'coder123@example.com');<br>                                                    | Insert into table             |                                                                                                        |

## Creating million records

#### Create procedure

```sql
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

#### Calling the procedure

```sql
CALL LoadUserData();
```

## Recording the performance of database

```sql
SET profiling = 1;
```

```sql
DELETE FROM users WHERE username LIKE 'user_%';
```

```sql
SHOW PROFILES;
```

|**Query_ID**|**Duration**|**Query**|
|---|---|---|
|1|0.00012500|SET profiling = 1|
|2|**4.87342100**|DELETE FROM users WHERE username LIKE 'user_%'|

auto incremented primary key
(12.431 sec) -> creation
(17.156 sec) -> deletion

uuid primary key
(36.875 sec) -> creation
(18.309 sec) -> deletion