require('dotenv').config();

/** @type {Object.<string, import('knex').Knex.Config>} */
module.exports = {
  development: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'quizdb',
      user: process.env.DB_USER || 'quizuser',
      password: process.env.DB_PASSWORD || 'quizpassword',
    },
    migrations: {
      directory: './src/migrations',
    },
  },
  production: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    },
    migrations: {
      directory: './src/migrations',
    },
  },
};
