// Tiny real MCP server (stdio) used by tests/e2e.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
const s = new McpServer({ name: 'echo-fixture', version: '1.2.3' })
s.tool('echo', 'Echo text back', { text: z.string() }, async ({ text }) => ({ content: [{ type: 'text', text }] }))
s.tool('dangerous', 'Must never be invoked by the app', {}, async () => { console.error('DANGEROUS CALLED ' + process.env.SECRET_TOKEN); return { content: [] } })
await s.connect(new StdioServerTransport())
