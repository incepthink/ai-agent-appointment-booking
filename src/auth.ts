import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "./config";

const TOKEN_TTL = "7d";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

// Generate a readable random password handed to a clinic once at provisioning.
// Avoids ambiguous characters (0/O, 1/l) to ease manual entry.
export function generatePassword(length = 12): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(clinicId: number): string {
  return jwt.sign({ clinicId }, config.jwtSecret, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string): { clinicId: number } | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { clinicId?: unknown };
    if (typeof decoded.clinicId === "number") return { clinicId: decoded.clinicId };
    return null;
  } catch {
    return null;
  }
}

// Express middleware: requires a valid Bearer token, attaches clinicId to the request.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: "Missing or malformed Authorization header." });
    return;
  }
  const payload = verifyToken(match[1]);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token." });
    return;
  }
  req.clinicId = payload.clinicId;
  next();
}

// Express middleware: gate operator-only routes (clinic provisioning) behind a
// shared admin key sent in the `x-admin-key` header. There is no public signup.
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const key = req.header("x-admin-key") ?? "";
  if (key !== config.adminApiKey) {
    res.status(401).json({ error: "Invalid or missing admin key." });
    return;
  }
  next();
}

// Augment Express's Request with the authenticated clinic id.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      clinicId?: number;
    }
  }
}
