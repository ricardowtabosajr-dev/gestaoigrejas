const { PrismaClient } = require('@prisma/client');

// Reaproveita o cliente entre invocações "quentes" (serverless) e recarregamentos (dev).
const g = globalThis;
module.exports = g.__prisma || (g.__prisma = new PrismaClient());
