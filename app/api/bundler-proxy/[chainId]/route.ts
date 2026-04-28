import { chain } from "@/lib/web3/config";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const secretKey = process.env.BICONOMY_API_KEY;

  if (!secretKey) {
    return NextResponse.json(
      { error: "Biconomy Secret Key not configured" },
      { status: 500 },
    );
  }

  const biconomyUrl = `https://bundler.biconomy.io/api/v2/${chain.id}/${secretKey}`;

  try {
    const body = await req.json();

    const response = await fetch(biconomyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error("Bundler Proxy Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
