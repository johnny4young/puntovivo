const net = require("node:net");
const originalConnect = net.Socket.prototype.connect;
const local = (host) =>
  ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
net.Socket.prototype.connect = function (...args) {
  const opts = net._normalizeArgs(args)[0];
  if (opts.path || !local(opts.host || "localhost"))
    throw new Error("Synthetic browser lane denies external/IPC sockets");
  return originalConnect.apply(this, args);
};
const originalFetch = global.fetch;
global.fetch = function (input, init) {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !local(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error("Synthetic browser lane denies external fetch");
  return originalFetch(input, init);
};
