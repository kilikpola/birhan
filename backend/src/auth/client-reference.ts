// CLIENT-SIDE REFERENCE — NOT PART OF THE BACKEND
// This file shows how the Birhan mobile app should configure its auth client.
// Copy these snippets into the React Native / Expo app.

// ---------------------------------------------------------------------------
// For React Native / Expo apps:
// ---------------------------------------------------------------------------
// import { createAuthClient } from "better-auth/client";
// import { dashClient, sentinelNativeClient } from "@better-auth/infra/native";
// import * as SecureStore from "expo-secure-store";
//
// export const authClient = createAuthClient({
//   baseURL: "https://your-api.example.com",
//   plugins: [
//     dashClient(),
//     sentinelNativeClient({
//       autoSolveChallenge: true,
//     }),
//   ],
// });

// ---------------------------------------------------------------------------
// For web dashboards (if ever built):
// ---------------------------------------------------------------------------
// import { createAuthClient } from "better-auth/client";
// import { dashClient, sentinelClient } from "@better-auth/infra/client";
//
// export const authClient = createAuthClient({
//   baseURL: "https://your-api.example.com",
//   plugins: [
//     dashClient(),
//     sentinelClient({
//       autoSolveChallenge: true,
//     }),
//   ],
// });
