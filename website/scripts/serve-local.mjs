import http from "http"
import fs from "fs"
import path from "path"
import serveHandler from "serve-handler"

const port = Number(process.env.PORT ?? 8080)
const output = path.resolve("public")
// Match GitHub Pages subpath used in production builds
const baseDir = process.env.BASE_DIR ?? "/backend-engineering"

const server = http.createServer(async (req, res) => {
  const url = req.url?.split("?")[0] ?? "/"

  // Redirect site root to the GitHub Pages subpath
  if (baseDir && (url === "/" || url === "")) {
    res.writeHead(302, { Location: `${baseDir}/` })
    res.end()
    return
  }

  // /backend-engineering must redirect to /backend-engineering/ so relative CSS/JS paths resolve
  if (baseDir && url === baseDir) {
    res.writeHead(302, { Location: `${baseDir}/` })
    res.end()
    return
  }

  if (baseDir && !req.url?.startsWith(baseDir)) {
    res.writeHead(404)
    res.end("Not found")
    return
  }

  if (baseDir) {
    req.url = req.url?.slice(baseDir.length) || "/"
  }

  const serve = async () => {
    await serveHandler(req, res, {
      public: output,
      directoryListing: false,
      cleanUrls: true,
      headers: [
        {
          source: "**/*.*",
          headers: [{ key: "Content-Disposition", value: "inline" }],
        },
      ],
    })
  }

  const redirect = (newPath) => {
    res.writeHead(302, { Location: `${baseDir}${newPath}` })
    res.end()
  }

  let fp = req.url?.split("?")[0] ?? "/"

  if (fp.endsWith("/")) {
    const indexFp = path.posix.join(fp, "index.html")
    if (fs.existsSync(path.posix.join(output, indexFp))) {
      req.url = fp
      return serve()
    }

    let base = fp.slice(0, -1)
    if (path.extname(base) === "") {
      base += ".html"
    }
    if (fs.existsSync(path.posix.join(output, base))) {
      return redirect(fp.slice(0, -1))
    }
  } else {
    let base = fp
    if (path.extname(base) === "") {
      base += ".html"
    }
    if (fs.existsSync(path.posix.join(output, base))) {
      req.url = fp
      return serve()
    }

    const indexFp = path.posix.join(fp, "index.html")
    if (fs.existsSync(path.posix.join(output, indexFp))) {
      return redirect(`${fp}/`)
    }
  }

  return serve()
})

server.listen(port, () => {
  console.log(`Quartz preview: http://localhost:${port}${baseDir}/`)
  console.log("Press Ctrl+C to stop")
})
