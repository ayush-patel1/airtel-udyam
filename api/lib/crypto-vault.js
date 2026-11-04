import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

function requiredKey(name,encoding="utf8"){
  const value=process.env[name];
  if(!value)throw Object.assign(new Error(name+" must be configured before sensitive data can be stored"),{status:503});
  const key=Buffer.from(value,encoding);
  if(name==="DATA_ENCRYPTION_KEY"&&key.length!==32)throw Object.assign(new Error("DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key"),{status:503});
  if(name==="TOKENIZATION_SECRET"&&key.length<32)throw Object.assign(new Error("TOKENIZATION_SECRET must contain at least 32 bytes"),{status:503});
  return key;
}

export function tokenizeSensitive(value,namespace="value"){
  if(value===null||value===undefined||value==="")return null;
  const secret=requiredKey("TOKENIZATION_SECRET");
  const normalised=String(value).trim().toUpperCase();
  return createHmac("sha256",secret).update(namespace+":"+normalised).digest("hex");
}

export function encryptSensitive(value,namespace="value"){
  if(value===null||value===undefined||value==="")return {ciphertext:null,token:null};
  const key=requiredKey("DATA_ENCRYPTION_KEY","base64");
  const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv);
  const encrypted=Buffer.concat([cipher.update(String(value),"utf8"),cipher.final()]);
  const tag=cipher.getAuthTag();
  return {
    ciphertext:["v1",iv.toString("base64url"),tag.toString("base64url"),encrypted.toString("base64url")].join("."),
    token:tokenizeSensitive(value,namespace)
  };
}

export function decryptSensitive(ciphertext){
  if(!ciphertext)return null;
  const [version,iv,tag,data]=String(ciphertext).split(".");
  if(version!=="v1"||!iv||!tag||!data)throw Object.assign(new Error("Encrypted data format is invalid"),{status:500});
  const key=requiredKey("DATA_ENCRYPTION_KEY","base64");
  const decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(iv,"base64url"));
  decipher.setAuthTag(Buffer.from(tag,"base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data,"base64url")),decipher.final()]).toString("utf8");
}
