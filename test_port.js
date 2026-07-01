const net = require("net");
function check(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", (err) => resolve(err.message));
    srv.once("listening", () => { srv.close(); resolve("free"); });
    if (host) srv.listen(port, host);
    else srv.listen(port);
  });
}
async function run() {
  console.log("127.0.0.1:", await check(8080, "127.0.0.1"));
  console.log("::1:", await check(8080, "::1"));
  console.log("none:", await check(8080));
}
run();
