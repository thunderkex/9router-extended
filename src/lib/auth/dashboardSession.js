import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";
import { getSettings } from "@/lib/localDb";

const DEFAULT_PASSWORD = "123456";

function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, "jwt-secret");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {}
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const generated = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, generated, { mode: 0o600 });
  return generated;
}

const SECRET = new TextEncoder().encode(loadJwtSecret());

export function shouldUseSecureCookie(request) {
  const forceSecureCookie = process.env.AUTH_COOKIE_SECURE === "true";
  const forwardedProto = request?.headers?.get?.("x-forwarded-proto");
  const isHttpsRequest = forwardedProto === "https";
  return forceSecureCookie || isHttpsRequest;
}

export async function createDashboardAuthToken(claims = {}) {
  return new SignJWT({ authenticated: true, ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(SECRET);
}

export async function verifyDashboardAuthToken(token) {
  if (!token) return false;
  try {
    await jwtVerify(token, SECRET);
    return true;
  } catch {
    return false;
  }
}

export async function getDashboardAuthSession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload;
  } catch {
    return null;
  }
}

export async function setDashboardAuthCookie(cookieStore, request, claims = {}) {
  const token = await createDashboardAuthToken(claims);
  cookieStore.set("auth_token", token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "lax",
    path: "/",
  });
}

export function clearDashboardAuthCookie(cookieStore) {
  cookieStore.delete("auth_token");
}

// Verify the current dashboard password (re-auth for sensitive actions).
export async function verifyDashboardPassword(password) {
  if (typeof password !== "string" || !password) return false;
  const settings = await getSettings();
  const storedHash = settings?.password;
  if (storedHash) return bcrypt.compare(password, storedHash);
  const initialPassword = process.env.INITIAL_PASSWORD || DEFAULT_PASSWORD;
  return password === initialPassword;
}

/**
 * Production boot check — call once at server startup.
 *
 * Warns if the dashboard password still matches the known default ("123456").
 * Remote access is automatically blocked until the password is changed.
 * Operators in headless cloud environments can set STRICT_PRODUCTION_GUARD=true
 * to strictly fail fast on boot.
 */
export async function checkDefaultPasswordGuard() {
  if (process.env.INITIAL_PASSWORD) return;

  const settings = await getSettings();
  const storedHash = settings?.password;

  const isDefault = !storedHash || (await bcrypt.compare(DEFAULT_PASSWORD, storedHash));
  if (isDefault) {
    if (process.env.STRICT_PRODUCTION_GUARD === "true") {
      console.error(
        "\n[9Router] FATAL: Production boot refused.\n" +
        "  The dashboard password is still set to the public default (\"123456\").\n" +
        "  Set INITIAL_PASSWORD environment variable to a strong secret or disable STRICT_PRODUCTION_GUARD.\n"
      );
      process.exit(1);
    }

    console.warn(
      "\n⚠️  [9Router Security Notice]\n" +
      "  The dashboard password is currently set to the default (\"123456\").\n" +
      "  👉 Open http://localhost:20128/dashboard/profile in your browser to set a strong password via GUI.\n" +
      "  🔒 Remote access is blocked until the password is changed.\n"
    );
  }
}
