import crypto from "node:crypto";
import { promisify } from "node:util";

// Password hashing via Node's built-in scrypt (salted, memory-hard KDF) — no
// extra dependency, keeps the frozen-lockfile Docker build intact. Stored as
// "salt:derivedKey" in hex.
const scryptAsync = promisify(crypto.scrypt);

export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.randomBytes(16).toString("hex");
	const derived = (await scryptAsync(password, salt, 64)) as Buffer;
	return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(
	password: string,
	stored: string,
): Promise<boolean> {
	const [salt, key] = stored.split(":");
	if (!salt || !key) return false;
	const keyBuffer = Buffer.from(key, "hex");
	const derived = (await scryptAsync(password, salt, 64)) as Buffer;
	return (
		keyBuffer.length === derived.length &&
		crypto.timingSafeEqual(keyBuffer, derived)
	);
}
