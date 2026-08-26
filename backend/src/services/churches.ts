import { db } from "../db/index.js";
import { churches, branches } from "../db/schema.js";
import { eq } from "drizzle-orm";

export async function listChurches() {
  return db.select({
    id: churches.id,
    nameAm: churches.nameAm,
    nameEn: churches.nameEn,
    denomination: churches.denomination,
    city: churches.city,
  }).from(churches).orderBy(churches.nameEn);
}

export async function listBranches(churchId: string) {
  return db.select({
    id: branches.id,
    churchId: branches.churchId,
    nameAm: branches.nameAm,
    nameEn: branches.nameEn,
  }).from(branches).where(eq(branches.churchId, churchId));
}
