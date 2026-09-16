const http = require("http");
const TOKEN = process.env.SMOKE_TOKEN;
http.createServer((req, res) => {
  const p = http.request(
    { hostname: "localhost", port: 3001, path: req.url, method: req.method,
      headers: { ...req.headers, host: "localhost:3001", cookie: `authjs.session-token=${TOKEN}` } },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); },
  );
  p.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(p);
}).listen(3005, () => console.log("proxy on 3005"));
