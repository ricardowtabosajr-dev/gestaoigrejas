const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const config = require('../config');
const prisma = require('../lib/prisma');
const { HttpError, wrap } = require('../lib/http');
const { audit } = require('../lib/audit');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

const passwordSchema = z.string().min(8, 'Mínimo de 8 caracteres').regex(/[A-Za-z]/, 'Inclua letras').regex(/\d/, 'Inclua números');

router.post('/login', loginLimiter, wrap(async (req, res) => {
  const { email, password } = z.object({ email: z.string().trim().toLowerCase(), password: z.string().min(1) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  const invalid = new HttpError(401, 'E-mail ou senha inválidos');
  if (!user || !user.active) {
    await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali'); // tempo constante
    throw invalid;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new HttpError(429, 'Conta bloqueada temporariamente. Tente mais tarde.');
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    const fails = user.failedLogins + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: fails >= MAX_FAILS ? 0 : fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60000) : null },
    });
    throw invalid;
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const token = jwt.sign({ sub: String(user.id) }, config.jwtSecret, { algorithm: 'HS256', expiresIn: config.jwtExpiresIn });
  req.user = { id: user.id };
  await audit(req, 'LOGIN', 'User', user.id);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role.name, mustChangePw: user.mustChangePw } });
}));

router.get('/me', authenticate, (req, res) => {
  const { permissions, ...rest } = req.user;
  res.json({ ...rest, permissions: [...permissions] });
});

router.post('/change-password', authenticate, wrap(async (req, res) => {
  const { current, next } = z.object({ current: z.string(), next: passwordSchema }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!(await bcrypt.compare(current, user.passwordHash))) throw new HttpError(400, 'Senha atual incorreta');
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(next, 12), mustChangePw: false } });
  await audit(req, 'UPDATE', 'User', user.id, ['password']);
  res.json({ ok: true });
}));

module.exports = { router, passwordSchema };
