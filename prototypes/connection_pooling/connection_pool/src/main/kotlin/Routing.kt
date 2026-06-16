package com.example

import io.ktor.server.application.*
import io.ktor.server.response.*
import io.ktor.server.routing.*

fun Application.configureRouting() {
    routing {
        get("/") {
            call.respondText("Hello, World!")
        }

        get("/db/ping") {
            for (i in 1..100){
            Database.getConnection().use { connection ->
                connection.createStatement().use { statement ->
                    statement.executeQuery("SELECT 1").use { resultSet ->
                        val value = if (resultSet.next()) resultSet.getInt(1) else -1
                        val pool = Database.poolStats()
                        call.respondText(
                            "status=${if (value == 1) "ok" else "error"}, result=$value, pool=$pool",
                        )
                    }
                }
            }
        }
        }
    }
}