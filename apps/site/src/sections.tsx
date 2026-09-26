import type { ReactNode } from 'react';
import { DEMO_VIDEO_URL, GITHUB_URL } from './config';

export function Hero() {
  return (
    <section className="hero" id="top">
      <p className="eyebrow">ETHGlobal Tokyo 2026 · Intercepta: Safe Agent-to-Agent Payments with x402</p>
      <h1>Risksir</h1>
      <p className="lead">
        Risksir is a closed-loop risk-policy engine for x402 agents: Intercepta supplies live payment risk, while each organisation can test, version and improve how its agents respond to that risk before money is signed.
      </p>
      <p className="cta">
        <a className="btn primary" href={GITHUB_URL} target="_blank" rel="noreferrer">
          GitHub repo
        </a>
        <a className="btn" href={DEMO_VIDEO_URL} target="_blank" rel="noreferrer">
          Demo video
        </a>
      </p>
      <p className="muted small" data-testid="site-note">
        This page is static. It only displays evidence recorded from earlier test runs on Base Sepolia (testnet). It never signs, pays or calls Intercepta.
      </p>
    </section>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="section" id={id}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function Problem() {
  return (
    <Section id="problem" title="The problem">
      <ul className="plain">
        <li>Autonomous agents need more than a universal risk verdict: the same signal can mean different actions for different payment values, counterparties and organisations.</li>
        <li>Today an agent either signs or it does not; nothing decides between pay, cap, hold, ask a human and deny for this company.</li>
        <li>After an incident, a policy change should be replay-tested and owner-approved, not guessed, so it does not overcorrect and block normal commerce.</li>
      </ul>
    </Section>
  );
}

const PAYMENT_STEPS = [
  ['x402 402 response', 'the seller quotes a price and a payTo'],
  ['Live Intercepta screen', 'the exact selected payTo, before any signer call'],
  ['Active policy + context', 'amount, counterparty history, organisation profile'],
  ['One action', 'PAY · CAP · HOLD · ASK_HUMAN · DENY'],
  ['Signer gate', 'only an approved attempt is signed; HOLD and DENY mean zero signer calls'],
];
const LOOP_STEPS = [
  ['Incident', 'the owner labels a case as bad'],
  ['Candidate policies', 'at least two, built server-side'],
  ['Replay', 'over labelled cases, metrics with numerators and denominators'],
  ['Owner approves', 'bound to the replay report'],
  ['Policy v(N+1)', 'immutable version, rollback available'],
  ['Next payment', 'a fresh live screen, decided by v(N+1)'],
];

function Flow({ label, steps }: { label: string; steps: string[][] }) {
  return (
    <div className="flow-block">
      <h3>{label}</h3>
      <ol className="flow" aria-label={label}>
        {steps.map(([name, note]) => (
          <li key={name}>
            <strong>{name}</strong>
            <span className="muted small">{note}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function HowItWorks() {
  return (
    <Section id="how" title="How it works">
      <Flow label="Every payment attempt" steps={PAYMENT_STEPS} />
      <Flow label="After an incident" steps={LOOP_STEPS} />
    </Section>
  );
}

export function Claims() {
  return (
    <Section id="claims" title="Claim boundaries">
      <div className="claims">
        <div className="panel">
          <h3>What this shows</h3>
          <ul className="plain">
            <li>Intercepta evidence returned by the live API controlled whether the signer was called, for the attempts shown.</li>
            <li>Replay reports the counterfactual action on labelled cases, with the provenance of each case stated.</li>
            <li>Testnet settlement on Base Sepolia, with a mainnet address screened.</li>
            <li>Recorded, controlled-variant and synthetic data, each labelled as what it is.</li>
          </ul>
        </div>
        <div className="panel">
          <h3>What it does not mean</h3>
          <ul className="plain">
            <li>
              <strong>CLEAR does not mean safe.</strong> It means no disqualifying signal was returned for that address at that time.
            </li>
            <li>The tier is a Risksir policy threshold on Intercepta&apos;s score and traits, not an Intercepta verdict.</li>
            <li>Replay metrics are not real prevented losses.</li>
            <li>A testnet settlement does not prove mainnet wrongdoing or a seller&apos;s real-world identity.</li>
            <li>Not claimed: that Intercepta lacks custom rules or cannot learn, that we invented backtesting, or that this is the first safe x402 layer.</li>
          </ul>
        </div>
        <div className="panel">
          <h3>Trust model</h3>
          <ul className="plain">
            <li>Base Sepolia only, with small spend limits per payment and per session.</li>
            <li>The buyer agent is a deterministic task runner: no LLM has signing, approval or activation rights.</li>
            <li>The signer signs only when a stored decision binds the identical quote; the key is read in one module. This is code-path isolation in one process, not a security boundary.</li>
            <li>Only a replay-tested, owner-approved policy version can govern future payments.</li>
          </ul>
        </div>
      </div>
    </Section>
  );
}

export function Footer() {
  return <footer className="footer muted small">Built for ETHGlobal Tokyo 2026 — Intercepta: Safe Agent-to-Agent Payments with x402</footer>;
}
