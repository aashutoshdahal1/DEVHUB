const net = require("net");
const srv1 = net.createServer();
srv1.listen(8081, "127.0.0.1", () => {
  const srv2 = net.createServer();
  srv2.once("error", (err) => console.log("none:", err.message));
  srv2.once("listening", () => { console.log("none: free"); srv2.close(); });
  srv2.listen(8081);
});
