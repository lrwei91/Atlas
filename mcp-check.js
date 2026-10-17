'use strict';
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

async function check() {
  const url = new URL(process.env.ATLAS_MCP_URL);
  const token = process.env.ATLAS_MCP_TOKEN;
  if (url.pathname !== '/note' || url.search || url.hash || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) || !token || token.length < 32) throw Error('Invalid connection settings');
  const client = new Client({ name: 'atlas-connection-check', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: 'Bearer ' + token } } }));
    const tools = (await client.listTools()).tools;
    for (const name of ['list_notes', 'search_notes', 'read_note', 'get_attachment']) if (!tools.some(tool => tool.name === name)) throw Error('Missing knowledge tool');
    const list = await client.callTool({ name: 'list_notes', arguments: { limit: 1 } });
    if (list.isError) throw Error('List failed');
    const first = JSON.parse(list.content[0].text).paths[0];
    if (!first) throw Error('No readable notes available to verify');
    const read = await client.callTool({ name: 'read_note', arguments: { path: first, maxChars: 100 } });
    if (read.isError || !JSON.parse(read.content[0].text).version) throw Error('Read failed');
    console.log('PASS: MCP initialize, four tools, scoped listing and versioned document read');
  } finally { await client.close(); }
}

check().catch(() => { console.error('MCP check failed; verify endpoint, authentication, allowed scope and readable notes'); process.exitCode = 1; });
