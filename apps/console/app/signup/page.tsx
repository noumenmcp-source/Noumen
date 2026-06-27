"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signup } from "../../src/api";
import { saveSession, sessionFromSignup } from "../../src/session";
import { Button, ErrorState, Field, PageHeader, Panel, Shell } from "../../src/ui";

export default function SignupPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const account = await signup(companyName, ownerEmail);
      saveSession(sessionFromSignup(account.apiToken, account.tenant));
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell>
      <Panel className="mx-auto max-w-xl">
        <PageHeader
          eyebrow="Sales-led onboarding"
          title="Create a US tenant"
          body="Creates a free-plan tenant, owner record, write key, and API token."
        />
        <form className="mt-5 grid gap-4" onSubmit={submit}>
          <Field label="Company name" required value={companyName} onChange={setCompanyName} />
          <Field label="Owner email" required type="email" value={ownerEmail} onChange={setOwnerEmail} />
          {error ? <ErrorState message={error} /> : null}
          <Button disabled={loading} type="submit">{loading ? "Creating..." : "Create tenant"}</Button>
        </form>
      </Panel>
    </Shell>
  );
}
