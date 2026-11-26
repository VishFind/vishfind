'use strict';

/**
 * Точка входа Timeweb (часто автоматически: pm2 start server.js).
 * Слушает PORT сразу, потом грузит приложение. Express не используется.
 */
if (require.main === module) {
  require('./lib/listen-boot').startListening();
} else {
  module.exports = require('./app-server.js');
}
