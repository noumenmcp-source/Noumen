"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveSession } from "../../src/session";
import { Button, Field, Panel, Shell } from "../../src/ui";

export default function LoginPage() {
  const router = useRouter();
  const [apiToken, setApiToken] = useState("");
  const [tenantId, setTenantId] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    saveSession({ apiToken, tenant: null, tenantId });
    router.push("/");
  }

  return (
    <Shell>
      <Panel className="mx-auto max-w-xl">
        <h1 className="text-2xl font-semibold">Sign in with API token</h1>
        <p className="mt-2 text-sm text-ink/70">Paste a token and tenant ID. A token introspection endpoint is not available yet.</p>
        <form className="mt-5 grid gap-4" onSubmit={submit}>
          <Field label="API token" required value={apiToken} onChange={setApiToken} />
          <Field label="Tenant ID" required value={tenantId} onChange={setTenantId} />
          <Button type="submit">Save session</Button>
        </form>
      </Panel>
    </Shell>
  );
}
