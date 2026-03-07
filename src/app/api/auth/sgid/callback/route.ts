import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createSgidClient } from "../route";
import { getBaseUrl } from "@/lib/get-base-url";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const base = getBaseUrl() || "http://localhost:3000";
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/auth/callback?error=no_code", base));
  }

  const jar = await cookies();
  const codeVerifier = jar.get("sgid_code_verifier")?.value;
  const nonce = jar.get("sgid_nonce")?.value;

  if (!codeVerifier) {
    return NextResponse.redirect(
      new URL("/auth/callback?error=invalid_session", base),
    );
  }

  try {
    const sgid = createSgidClient();

    const { accessToken, sub } = await sgid.callback({
      code,
      codeVerifier,
      nonce,
    });

    const { data } = await sgid.userinfo({ accessToken, sub });

    const rawName = data["myinfo.name"];
    const name = typeof rawName === "string" ? rawName : "";

    const response = name
      ? NextResponse.redirect(
          new URL(`/auth/callback?name=${encodeURIComponent(name)}`, base),
        )
      : NextResponse.redirect(new URL("/auth/callback?error=no_name", base));

    response.cookies.delete("sgid_code_verifier");
    response.cookies.delete("sgid_nonce");

    return response;
  } catch (err) {
    console.error("[sgID] callback error:", err);
    return NextResponse.redirect(new URL("/auth/callback?error=failed", base));
  }
}
