import admin from "firebase-admin";

const token = process.env.FIREBASE_ID_TOKEN;

if (!token) {
  console.error("Missing FIREBASE_ID_TOKEN env var.");
  process.exit(1);
}

if (admin.apps.length === 0) {
  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID ??
    process.env.FIREBASE_PROJECT_ID ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    undefined;
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId,
  });
}

async function main(): Promise<void> {
  try {
    const idToken = token as string;
    const claims = await admin.auth().verifyIdToken(idToken, true);
    const { uid, sub, tenantId, tenant_id, role, aud, iss, exp, iat } =
      claims as Record<string, unknown>;
    console.log(
      JSON.stringify(
        { uid, sub, tenantId, tenant_id, role, aud, iss, exp, iat },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Token verification failed.", error);
    process.exit(1);
  }
}

void main();
