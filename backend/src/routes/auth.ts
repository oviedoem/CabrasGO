import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { signToken } from "../lib/auth";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    return res.status(400).json({ error: "email y password son requeridos" });
  }
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { driverProfile: true },
  });
  if (!user) return res.status(401).json({ error: "Credenciales inválidas" });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Credenciales inválidas" });

  const token = signToken({
    userId: user.id,
    role: user.role as any,
    driverId: user.driverProfile?.id ?? null,
  });

  res.json({
    token,
    user: {
      id: user.id,
      rut: user.rut,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      ratingAvg: user.ratingAvg,
      driverId: user.driverProfile?.id ?? null,
    },
  });
});

// Convenience: list seeded demo accounts for the login screen (no secrets beyond
// the shared demo password, which is documented in the README).
authRouter.get("/demo-accounts", async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { email: true, firstName: true, lastName: true, role: true },
    orderBy: { role: "asc" },
  });
  res.json({ password: "cabrasgo2025", users });
});
