import jwt from "jsonwebtoken";
import { NextFunction, Request, Response } from "express";

const JWT_SECRET = process.env.JWT_SECRET || "cabrasgo_secret_token_auth_vi_region";

export interface AuthPayload {
  userId: string;
  role: "PASSENGER" | "DRIVER" | "ADMIN" | "DISPATCHER";
  driverId?: string | null;
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthPayload;
  } catch {
    return null;
  }
}

export interface AuthedRequest extends Request {
  auth?: AuthPayload;
}

export function requireAuth(...roles: AuthPayload["role"][]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Falta token de autenticación" });
    }
    const payload = verifyToken(header.slice(7));
    if (!payload) return res.status(401).json({ error: "Token inválido" });
    if (roles.length && !roles.includes(payload.role)) {
      return res.status(403).json({ error: "Rol no autorizado" });
    }
    req.auth = payload;
    next();
  };
}
