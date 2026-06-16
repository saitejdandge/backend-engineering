package com.example

import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationStopping
import io.ktor.server.application.log

fun Application.configureDatabase() {
    val config = environment.config.config("database")
    val dbConfig = DatabaseConfig(
        jdbcUrl = System.getenv("DB_JDBC_URL") ?: config.property("jdbcUrl").getString(),
        username = System.getenv("DB_USERNAME") ?: config.property("username").getString(),
        password = System.getenv("DB_PASSWORD") ?: config.property("password").getString(),
        maximumPoolSize = System.getenv("DB_MAX_POOL_SIZE")?.toIntOrNull()
            ?: config.propertyOrNull("maximumPoolSize")?.getString()?.toInt()
            ?: 10,
    )

    Database.init(dbConfig)
    log.info("HikariCP pool initialized for ${dbConfig.jdbcUrl}")

    monitor.subscribe(ApplicationStopping) {
        Database.close()
        log.info("HikariCP pool closed")
    }
}
