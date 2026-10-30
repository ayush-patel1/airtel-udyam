import bcrypt from "bcryptjs";
import { z } from "zod";
import { createFirebaseStore } from "../api/lib/firebase-store.js";
const input=z.object({email:z.email(),name:z.string().min(2),password:z.string().min(14)});
const parsed=input.safeParse({email:process.env.ADMIN_EMAIL,name:process.env.ADMIN_NAME,password:process.env.ADMIN_PASSWORD});
if(!parsed.success){console.error("Set ADMIN_EMAIL, ADMIN_NAME and a 14+ character ADMIN_PASSWORD.");process.exit(1);}
const db=createFirebaseStore();
try{
 const existing=await db.user.findUnique({where:{email:parsed.data.email.toLowerCase()}});
 if(existing){console.error("An account with this email already exists.");process.exitCode=1;}
 else{const passwordHash=await bcrypt.hash(parsed.data.password,12);await db.user.create({data:{email:parsed.data.email.toLowerCase(),name:parsed.data.name,passwordHash,role:"ADMIN",active:true}});console.log("Firebase-backed admin account created.");}
}catch(error){console.error("Admin provisioning failed:",error.message);process.exitCode=1;}
