import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerChatEndpoints } from './chatEndpoints';
import { registerProjectEndpoints } from './projectEndpoints';
import { registerResourceEndpoints } from './resourceEndpoints';
import { registerPromptEndpoints } from './promptEndpoints';

const server = new McpServer({
  name: 'thinkcoffee',
  version: '2.0.0',
});

registerChatEndpoints(server);
registerProjectEndpoints(server);
registerResourceEndpoints(server);
registerPromptEndpoints(server);

server.connect(new StdioServerTransport());