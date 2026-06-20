import http from 'http'
import app from './app.js';
import { config } from './config/env.js';
import { logger } from './lib/logger.js';
// import { setupWebSocket } from './websocket/wsServer.js'


const server = http.createServer(app) 
// setupWebSocket(server)

server.listen(config.port, () => {
  logger.info(`Server is running in on port ${config.port}`);
});
