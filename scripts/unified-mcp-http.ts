import 'dotenv/config';
import { startMcpHttpServer } from '../src/mcp/unifiedServer';

const port = parseInt(process.env.MCP_HTTP_PORT || '8850', 10);
const authToken = process.env.MCP_SHARED_MCP_TOKEN || process.env.MCP_WORKER_AUTH_TOKEN || '';

startMcpHttpServer(port, { authToken });
