"use client";

import { useEffect, useState } from "react";
import { trackerSnippet } from "../../src/api";
import { readSession } from "../../src/session";
import type { Session } from "../../src/types";
import { Button, EmptyState, PageHeader, Panel, Shell } from "../../src/ui";

export default function ConnectPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => setSession(readSession()), []);

  const writeKey = session?.tenant?.writeKey ?? "";
  const snippet = writeKey ? trackerSnippet(writeKey) : "";

  async function copySnippet() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
  }

  return (
    <Shell>
      <div className="grid gap-5">
        <PageHeader
          eyebrow="First-party tracker"
          title="Connector"
          body="Install the tenant write key snippet on a customer property and send events to the live US API."
        />
        {!writeKey ? <EmptyState title="No write key" body="Create a tenant first to generate the connector snippet." /> : null}
        {writeKey ? (
          <Panel>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-medium">Browser snippet</h2>
                <p className="mt-1 text-sm text-muted">Endpoint is compiled from NEXT_PUBLIC_API_URL.</p>
              </div>
              <Button onClick={() => void copySnippet()}>{copied ? "Copied" : "Copy"}</Button>
            </div>
            <pre className="mt-4 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm leading-6 text-zinc-100"><code>{snippet}</code></pre>
          </Panel>
        ) : null}
      </div>
    </Shell>
  );
}
