import mysql from "mysql2/promise";
import { config } from "dotenv";
config();
// Create a connection pool to the MySQL database using environment variables for configuration
export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});
