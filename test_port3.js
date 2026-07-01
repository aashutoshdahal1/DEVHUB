const net = require("net");
async function isPortFree(port) {
  const check = (host) => new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => { srv.close(); resolve(true); });
    if (host) srv.listen(port, host);
    else srv.listen(port);
  });

  return (await check("127.0.0.1")) && (await check("::1")) && (await check());
}
async function run() {
  console.log("Port 8080 free?", await isPortFree(8080));
}
run();
