import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: "",
});

export const { signIn, signUp, signOut, useSession } = authClient;
