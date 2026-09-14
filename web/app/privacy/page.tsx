import Link from "next/link";

export default function PrivacyNoticePage() {
  return (
    <main className="legal-page">
      <nav><Link href="/">← Job Hunter</Link><span>PUBLIC TEST NOTICE</span></nav>
      <article>
        <p className="section-kicker">Privacy notice · test build</p>
        <h1>Know where your test data lives.</h1>
        <p className="legal-lead">This hosted preview uses browser-local storage. It does not connect to the project&apos;s local SQLite API, Supabase, payments, or a production user account.</p>
        <h2>Hosted preview</h2>
        <p>Onboarding answers, sample-job actions, and profile edits are stored in this browser. Reset them from Profile → Privacy &amp; local data, or clear this site&apos;s browser storage.</p>
        <h2>Local development mode</h2>
        <p>If you intentionally configure and run the local API, candidate data and uploaded resumes are stored on your own machine in the project&apos;s configured SQLite and private-storage paths.</p>
        <h2>AI boundary</h2>
        <p>Free candidate workflows use deterministic matching and autofill. Candidate-specific AI generation is disabled for Free. Shared field-structure canonicalization is a separate platform operation and never shares another candidate&apos;s answers.</p>
        <h2>Before a real launch</h2>
        <p>A production privacy policy, retention schedule, deletion/export controls, Supabase row-level security, and verified contact details must replace this test notice before accepting public accounts or payments.</p>
        <Link className="button button-dark" href="/">Back to product</Link>
      </article>
    </main>
  );
}
