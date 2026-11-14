import { eq } from "drizzle-orm";
import type { Db } from "./db.js";
import { type User, users } from "./schema.js";

export function upsertUser(
  db: Db,
  input: { sub: string; email?: string | null; name?: string | null },
): User {
  const existing = db.select().from(users).where(eq(users.oidcSub, input.sub)).get();
  if (!existing) {
    const name = input.name || (input.email || "user").split("@")[0]!;
    return db
      .insert(users)
      .values({ oidcSub: input.sub, email: input.email ?? null, name })
      .returning()
      .get();
  }
  return db
    .update(users)
    .set({ email: input.email || existing.email, name: input.name || existing.name })
    .where(eq(users.id, existing.id))
    .returning()
    .get();
}

export function devUser(db: Db, name: string): User {
  const slug = name.trim().toLowerCase();
  return upsertUser(db, { sub: `dev:${slug}`, email: `${slug}@dev.local`, name: name.trim() });
}

export function userBySub(db: Db, sub: string): User | undefined {
  return db.select().from(users).where(eq(users.oidcSub, sub)).get();
}

export function userById(db: Db, id: number): User | undefined {
  return db.select().from(users).where(eq(users.id, id)).get();
}
