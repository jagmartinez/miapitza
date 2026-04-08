import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const buildMysqlUrlFromParts = () => {
  const host = process.env.MYSQLHOST ?? process.env.MYSQL_HOST;
  const port = process.env.MYSQLPORT ?? process.env.MYSQL_PORT ?? '3306';
  const user = process.env.MYSQLUSER ?? process.env.MYSQL_USER;
  const password = process.env.MYSQLPASSWORD ?? process.env.MYSQL_PASSWORD;
  const database = process.env.MYSQLDATABASE ?? process.env.MYSQL_DATABASE;

  if (!host || !user || !database) return null;

  const encodedUser = encodeURIComponent(user);
  const encodedPassword = encodeURIComponent(password ?? '');
  return `mysql://${encodedUser}:${encodedPassword}@${host}:${port}/${database}`;
};

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    process.env.MYSQL_URL ??
    process.env.MYSQLURL ??
    buildMysqlUrlFromParts() ??
    '';
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    'Missing DATABASE_URL. Set DATABASE_URL directly or provide MYSQL_URL / MYSQLHOST, MYSQLPORT, MYSQLUSER, MYSQLPASSWORD, MYSQLDATABASE.'
  );
}

const prisma = new PrismaClient();

export default prisma;
