"use client";

import { useEffect, useState } from "react";
import { trackerSnippet } from "../../src/api";
import { readSession } from "../../src/session";
import type { Session } from "../../src/types";
import { Button, EmptyState, Panel, Shell } from "../../src/ui";

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
        <h1 className="text-2xl font-semibold">Connector</h1>
        {!writeKey ? <EmptyState title="No write key" body="Create a tenant first to generate the connector snippet." /> : null}
        {writeKey ? (
          <Panel>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">Browser snippet</h2>
              <Button onClick={() => void copySnippet()}>{copied ? "Copied" : "Copy"}</Button>
            </div>
            <pre className="mt-4 overflow-x-auto rounded-md bg-ink p-4 text-sm text-white"><code>{snippet}</code></pre>
          </Panel>
        ) : null}
      </div>
    </Shell>
  );
}
