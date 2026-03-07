import { NextResponse } from "next/server";
import SgidClient, { generatePkcePair } from "@opengovsg/sgid-client";
import { getBaseUrl } from "@/lib/get-base-url";

export const runtime = "nodejs";

export function createSgidClient() {
  return new SgidClient({
    clientId: process.env.SGID_CLIENT_ID!,
    clientSecret: process.env.SGID_CLIENT_SECRET!,
    privateKey: process.env.SGID_PRIVATE_KEY!,
    redirectUri: `${getBaseUrl()}/api/auth/sgid/callback`,
  });
}

export async function GET() {
  const sgid = createSgidClient();
  const { codeChallenge, codeVerifier } = generatePkcePair();

  const { url, nonce } = sgid.authorizationUrl({
    scope: ["openid", "myinfo.name"],
    codeChallenge,
  });

  const response = NextResponse.redirect(url);

  response.cookies.set("sgid_code_verifier", codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  if (nonce) {
    response.cookies.set("sgid_nonce", nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
  }

  return response;
}
