// Preview always uses this checkout's SQLite database and loopback interface.
process.env.DATABASE_URL = '';
process.env.HOST = '127.0.0.1';
process.env.PORT = '3101';
process.env.HOOPDUELS_TOKEN_SECRET = 'isolated-hoopduels-design-preview';
require('../server');
