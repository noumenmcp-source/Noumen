"use client";

import Link from "next/link";
import { Shell } from '../../src/ui'

export default function ActivationHub() {
  return (
    <Shell>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8">
          <p className="text-sm font-medium text-muted">Activation hub</p>
          <h1 className="font-serif text-3xl font-bold text-ink">Take action on your base.</h1>
        </header>

        <section>
          <p className="text-sm font-medium text-muted mb-3">Core activation</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/activation/audiences"
              className="block rounded-lg border border-line bg-panel p-5 shadow-card transition-colors hover:border-gold group"
            >
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted mb-1">Audiences</p>
              <h2 className="font-semibold text-ink group-hover:text-gold transition-colors">Target segments</h2>
              <p className="text-sm text-muted mt-1">Evaluate rules and inspect member samples.</p>
              <div className="mt-4 text-right">
                <span className="font-mono text-muted group-hover:text-gold text-sm">→</span>
              </div>
            </Link>

            <Link
              href="/activation/journeys"
              className="block rounded-lg border border-line bg-panel p-5 shadow-card transition-colors hover:border-gold group"
            >
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted mb-1">Journeys</p>
              <h2 className="font-semibold text-ink group-hover:text-gold transition-colors">Automated flows</h2>
              <p className="text-sm text-muted mt-1">Run a deterministic journey preview.</p>
              <div className="mt-4 text-right">
                <span className="font-mono text-muted group-hover:text-gold text-sm">→</span>
              </div>
            </Link>

            <Link
              href="/activation/destinations"
              className="block rounded-lg border border-line bg-panel p-5 shadow-card transition-colors hover:border-gold group"
            >
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted mb-1">Destinations</p>
              <h2 className="font-semibold text-ink group-hover:text-gold transition-colors">Reverse-ETL</h2>
              <p className="text-sm text-muted mt-1">Review supported activation targets.</p>
              <div className="mt-4 text-right">
                <span className="font-mono text-muted group-hover:text-gold text-sm">→</span>
              </div>
            </Link>

            <Link
              href="/activation/analytics"
              className="block rounded-lg border border-line bg-panel p-5 shadow-card transition-colors hover:border-gold group"
            >
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted mb-1">Analytics</p>
              <h2 className="font-semibold text-ink group-hover:text-gold transition-colors">Attribution</h2>
              <p className="text-sm text-muted mt-1">Read funnel and retention activation signals.</p>
              <div className="mt-4 text-right">
                <span className="font-mono text-muted group-hover:text-gold text-sm">→</span>
              </div>
            </Link>
          </div>
        </section>

        <section className="mt-6">
          <p className="text-sm font-medium text-muted mb-3">Intelligence</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/funnels"
              className="block rounded-lg border border-line bg-panel p-5 shadow-card transition-colors hover:border-gold group"
            >
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted mb-1">Funnels</p>
              <h2 className="font-semibold text-ink group-hover:text-gold transition-colors">Conversion funnels</h2>
              <p className="text-sm text-muted mt-1">Build a funnel and inspect per-step dropoff.</p>
              <div className="mt-4 text-right">
                <span className="font-mono text-muted group-hover:text-gold text-sm">→</span>
              </div>
            </Link>

            <Link
              href="/cohorts"
              className="block rounded-lg border border-line bg-panel p-5 shadow-card transition-colors hover:border-gold group"
            >
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted mb-1">Cohorts</p>
              <h2 className="font-semibold text-ink group-hover:text-gold transition-colors">Retention cohorts</h2>
              <p className="text-sm text-muted mt-1">Compute cohorts by day/week/month.</p>
              <div className="mt-4 text-right">
                <span className="font-mono text-muted group-hover:text-gold text-sm">→</span>
              </div>
            </Link>

            <Link
              href="/leads"
              className="block rounded-lg border border-line bg-panel p-5 shadow-card transition-colors hover:border-gold group"
            >
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted mb-1">Lead Scoring</p>
              <h2 className="font-semibold text-ink group-hover:text-gold transition-colors">Lead scoring</h2>
              <p className="text-sm text-muted mt-1">Run fit/engagement scoring over profiles.</p>
              <div className="mt-4 text-right">
                <span className="font-mono text-muted group-hover:text-gold text-sm">→</span>
              </div>
            </Link>

            <Link
              href="/deliverability"
              className="block rounded-lg border border-line bg-panel p-5 shadow-card transition-colors hover:border-gold group"
            >
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted mb-1">Deliverability</p>
              <h2 className="font-semibold text-ink group-hover:text-gold transition-colors">Email health</h2>
              <p className="text-sm text-muted mt-1">Validate SPF/DMARC/DKIM and suppression.</p>
              <div className="mt-4 text-right">
                <span className="font-mono text-muted group-hover:text-gold text-sm">→</span>
              </div>
            </Link>
          </div>
        </section>
      </div>
    </Shell>
  )
}
