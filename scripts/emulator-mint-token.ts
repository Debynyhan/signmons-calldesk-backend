const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "localhost:9099";
const apiKey = process.env.FIREBASE_EMULATOR_API_KEY ?? "fake-api-key";
const email = process.env.FIREBASE_TEST_EMAIL ?? "test-user@signmons.dev";
const password = process.env.FIREBASE_TEST_PASSWORD ?? "test-password";

const baseUrl = `http://${emulatorHost}/identitytoolkit.googleapis.com/v1`;

async function jsonPost<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `Emulator request failed: ${response.status} ${JSON.stringify(payload)}`,
    );
  }
  return payload as T;
}

async function main(): Promise<void> {
  try {
    await jsonPost("/accounts:signUp", {
      email,
      password,
      returnSecureToken: true,
    });
  } catch (error) {
    // Ignore "EMAIL_EXISTS" so we can reuse the same test user.
    const message = String(error);
    if (!message.includes("EMAIL_EXISTS")) {
      throw error;
    }
  }

  const signIn = await jsonPost<{ idToken: string }>(
    "/accounts:signInWithPassword",
    {
      email,
      password,
      returnSecureToken: true,
    },
  );

  console.log(signIn.idToken);
}

void main().catch((error) => {
  console.error("Failed to mint emulator token.", error);
  process.exit(1);
});
