// A stdio "MCP server" that never completes the handshake (to prove the app's timeout works and kills the process).
setInterval(() => {}, 1000)
