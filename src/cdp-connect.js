const CDP = require('chrome-remote-interface');

function connectCdp(target, timeoutMs = 8000) {
  return Promise.race([
    CDP({ target }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`CDP 连接超时 ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

module.exports = { connectCdp };
