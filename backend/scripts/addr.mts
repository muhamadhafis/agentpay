import { privateKeyToAccount } from "viem/accounts";
import fs from "node:fs";
const rd = (f: string) =>
  ("0x" + fs.readFileSync(f, "utf8").trim().replace(/^0x/, "")) as `0x${string}`;
const a = privateKeyToAccount(rd(process.env.W2F!));
const b = privateKeyToAccount(rd(process.env.W3F!));
console.log(JSON.stringify({ a: a.address, b: b.address }));
