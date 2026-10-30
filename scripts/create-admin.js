import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";

const input=z.object({email:z.email(),name:z.string().min(2),password:z.string().min(14)});
const parsed=input.safeParse({email:process.env.ADMIN_EMAIL,name:process.env.ADMIN_NAME,password:process.env.ADMIN_PASSWORD});
if(!parsed.success){console.error("Set ADMIN_EMAIL, ADMIN_NAME and a 14+ character ADMIN_PASSWORD.");process.exit(1);}
const db=new PrismaClient();
try {
  const passwordHash=await bcrypt.hash(parsed.data.password,12);
  await db.user.create({data:{email:parsed.data.email.toLowerCase(),name:parsed.data.name,passwordHash,role:UserRole.ADMIN}});
  console.log("Admin account created.");
} finally { await db.$disconnect(); }