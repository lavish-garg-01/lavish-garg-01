import Link from "next/link";

export default function TestTermsPage() {
  return (
    <main className="legal-page">
      <nav><Link href="/">← Job Hunter</Link><span>PUBLIC TEST TERMS</span></nav>
      <article>
        <p className="section-kicker">Terms · test build</p>
        <h1>This preview is for product testing.</h1>
        <p className="legal-lead">The hosted experience demonstrates onboarding and workspace interactions. It is not a paid service, employment agency, guaranteed job source, or autonomous application-submission system.</p>
        <h2>Your review remains required</h2>
        <p>You are responsible for checking every resume, answer, employer form, and application before submission. The product must not invent qualifications or submit an application without explicit confirmation.</p>
        <h2>Sample and third-party content</h2>
        <p>Roles, scores, form maps, operator metrics, and company references in browser-local preview mode are labelled samples. Employer sites and third-party job portals have their own terms and may change independently.</p>
        <h2>No payment is active</h2>
        <p>Displayed launch prices describe the planned offer. This test build does not collect card or UPI details and does not start a paid subscription.</p>
        <h2>Production requirement</h2>
        <p>Founder-reviewed legal terms, support contacts, refund rules, and applicable Indian consumer and data-protection disclosures must replace these test terms before commercial launch.</p>
        <Link className="button button-dark" href="/">Back to product</Link>
      </article>
    </main>
  );
}
