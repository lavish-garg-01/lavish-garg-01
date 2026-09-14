#!/usr/bin/env python3
"""CLI wrapper around python-jobspy for the Node ingestion bridge.

Prints a JSON array of jobs to stdout.
"""

from __future__ import annotations

import argparse
import json
import sys


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="JobSpy JSON CLI for job-hunter-agent")
    parser.add_argument(
        "--site",
        default="linkedin,indeed",
        help="Comma-separated sites (linkedin,indeed,glassdoor,...)",
    )
    parser.add_argument("--search_term", "--search-term", dest="search_term", required=True)
    parser.add_argument("--location", default="Bengaluru")
    parser.add_argument(
        "--country",
        default="india",
        help="Country for Indeed / regional targeting (e.g. india)",
    )
    parser.add_argument("--results_wanted", "--results-wanted", dest="results_wanted", type=int, default=25)
    parser.add_argument("--hours_old", "--hours-old", dest="hours_old", type=int, default=168)
    parser.add_argument("--is_remote", "--is-remote", dest="is_remote", action="store_true")
    parser.add_argument(
        "--linkedin_fetch_description",
        "--linkedin-fetch-description",
        dest="linkedin_fetch_description",
        action="store_true",
        default=True,
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    try:
        from jobspy import scrape_jobs
    except Exception as exc:  # pragma: no cover
        print(json.dumps({"error": f"Failed to import jobspy: {exc}"}), file=sys.stderr)
        return 1

    sites = [part.strip() for part in str(args.site).split(",") if part.strip()]
    country = str(args.country or "india").lower()
    if country in {"in", "ind"}:
        country = "india"

    try:
        df = scrape_jobs(
            site_name=sites,
            search_term=args.search_term,
            location=args.location,
            results_wanted=args.results_wanted,
            country_indeed=country,
            hours_old=args.hours_old,
            is_remote=bool(args.is_remote),
            linkedin_fetch_description=bool(args.linkedin_fetch_description),
            description_format="markdown",
            verbose=0,
        )
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1

    if df is None or getattr(df, "empty", True):
        print("[]")
        return 0

    records = df.fillna("").to_dict(orient="records")
    jobs = []
    for row in records:
        jobs.append(
            {
                "company": row.get("company") or row.get("company_name") or "",
                "company_name": row.get("company") or row.get("company_name") or "",
                "company_url": row.get("company_url") or "",
                "title": row.get("title") or row.get("job_title") or "",
                "location": row.get("location") or "",
                "description": row.get("description") or row.get("job_description") or "",
                "job_url": row.get("job_url") or row.get("url") or "",
                "url": row.get("job_url") or row.get("url") or "",
                "date_posted": str(row.get("date_posted") or row.get("datePosted") or ""),
                "company_rating": row.get("company_rating") or row.get("rating") or "",
                "site": row.get("site") or "",
            }
        )

    print(json.dumps(jobs, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
