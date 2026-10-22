// Generate admin credentials.
//   npm run admin:hash              -> asks for a password, prints ADMIN_PASSWORD_HASH
//   npm run admin:hash -- --generate -> also creates a random password, ADMIN_PATH
//                                       and SESSION_SECRET (prints them once)

import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { hashPassword } from "../src/utils/password.js";

const generate = process.argv.includes("--generate");

async function ask(question) {
  if (!process.stdin.isTTY) {
    // Piped input: read the first line.
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) return line;
    return "";
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => rl.output.write(s.includes(question) ? s : "*");
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  process.stdout.write("\n");
  return answer;
}

let password;
if (generate) {
  password = randomBytes(18).toString("base64url");
} else {
  password = await ask("Admin password (min 12 characters): ");
  if (password.length < 12) {
    console.error("Password must be at least 12 characters.");
    process.exit(1);
  }
}

const hash = await hashPassword(password);
console.log("\nAdd these to your environment (e.g. Vercel → Settings → Environment Variables):\n");
if (generate) {
  console.log(`ADMIN_USERNAME=librarian`);
  console.log(`ADMIN_PATH=lib-desk-${randomBytes(6).toString("hex")}`);
  console.log(`SESSION_SECRET=${randomBytes(48).toString("base64url")}`);
}
console.log(`ADMIN_PASSWORD_HASH=${hash}`);
if (generate) console.log(`\nPassword (shown once, store it in a password manager): ${password}`);
