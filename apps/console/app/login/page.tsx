"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveSession } from "../../src/session";
import { Button, Field, PageHeader, Panel, Shell } from "../../src/ui";

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
        <PageHeader
          eyebrow="Operator access"
          title="Use API token"
          body="Paste a tenant token and tenant ID for the current browser session."
        />
        <form className="mt-5 grid gap-4" onSubmit={submit}>
          <Field label="API token" required value={apiToken} onChange={setApiToken} />
          <Field label="Tenant ID" required value={tenantId} onChange={setTenantId} />
          <Button type="submit">Save session</Button>
        </form>
      </Panel>
    </Shell>
  );
}
