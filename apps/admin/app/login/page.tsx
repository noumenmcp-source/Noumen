"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveAdminToken } from "../../src/session";

export default function LoginPage() {
  const router = useRouter();
  const [token, setToken] = useState("");

  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <form
        className="panel grid w-full max-w-sm gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (token.trim()) {
            saveAdminToken(token);
            router.replace("/tenants");
          }
        }}
      >
        <div>
          <h1 className="text-2xl font-semibold">Admin sign in</h1>
          <p className="mt-1 text-sm text-ink/70">Paste an internal admin bearer token.</p>
        </div>
        <label className="grid gap-1 text-sm">
          Admin token
          <input
            className="input"
            value={token}
            type="password"
            autoComplete="off"
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        <button className="btn" type="submit" disabled={!token.trim()}>Continue</button>
      </form>
    </main>
  );
}
