// One-off CLI to assign login credentials to an EXISTING clinic (e.g. the seeded
// Sunrise / Harbor clinics that ship without an email/password).
//
//   npm run provision -- <CODE> <email>
//
// Generates a random password, stores its hash on the clinic, and prints the
// email + plaintext password once. The password is not recoverable afterwards;
// the clinic can change it later from the dashboard Settings page.
import { hashPassword, generatePassword } from "./auth";
import { setClinicCredentials } from "./clinics";

async function main() {
  const [code, email] = process.argv.slice(2);
  if (!code || !email) {
    console.error("Usage: npm run provision -- <CLINIC_CODE> <email>");
    process.exit(1);
  }

  const password = generatePassword();
  const passwordHash = await hashPassword(password);
  const clinic = setClinicCredentials(code, email, passwordHash);

  if (!clinic) {
    console.error(`No clinic found with code "${code}". Check the code and try again.`);
    process.exit(1);
  }

  console.log("\nClinic credentials provisioned:");
  console.log(`  Clinic:   ${clinic.name} [${clinic.code}]`);
  console.log(`  Email:    ${clinic.email}`);
  console.log(`  Password: ${password}`);
  console.log("\nStore these now — the password is not recoverable.\n");
}

main();
