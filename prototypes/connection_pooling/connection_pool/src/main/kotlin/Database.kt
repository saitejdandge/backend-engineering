package com.example

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import java.sql.Connection

object Database {
    private lateinit var dataSource: HikariDataSource

    fun init(config: DatabaseConfig) {
        val hikariConfig = HikariConfig().apply {
            jdbcUrl = config.jdbcUrl
            username = config.username
            password = config.password
            maximumPoolSize = config.maximumPoolSize
            driverClassName = "com.mysql.cj.jdbc.Driver"
            poolName = "connection-pool"
        }
        dataSource = HikariDataSource(hikariConfig)
    }

    fun getConnection(): Connection = dataSource.connection

    fun close() {
        if (::dataSource.isInitialized) {
            dataSource.close()
        }
    }

    fun poolStats(): Map<String, Any> {
        val pool = dataSource.hikariPoolMXBean
        return mapOf(
            "active" to pool.activeConnections,
            "idle" to pool.idleConnections,
            "total" to pool.totalConnections,
            "waiting" to pool.threadsAwaitingConnection,
        )
    }
}
