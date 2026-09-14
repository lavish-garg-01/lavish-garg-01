import Link from "next/link";

export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <Link href="/" className={`brand ${inverse ? "brand-inverse" : ""}`} aria-label="Job Hunter home">
      <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
      <span>Job Hunter</span>
      <span className="beta-badge">Copilot</span>
    </Link>
  );
}
