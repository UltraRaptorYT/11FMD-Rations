import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

function secretsMatch(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function requireApiSecret(request: Request) {
  const expectedSecret = process.env.API_SECRET?.trim();

  if (!expectedSecret) {
    console.error("API_SECRET is not configured");
    return NextResponse.json(
      { error: "API authentication is not configured" },
      { status: 500 },
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, token] = authorization.split(" ", 2);

  if (
    scheme.toLowerCase() !== "bearer" ||
    !token ||
    !secretsMatch(token, expectedSecret)
  ) {
    return NextResponse.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: { "WWW-Authenticate": "Bearer" },
      },
    );
  }

  return null;
}
