import argparse
import json
import math
import re
from collections import Counter
from pathlib import Path

import pandas as pd

from textutil import text_hash


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
OUT_DIR = ROOT / "pipeline" / "out"
INPUT_CSV = OUT_DIR / "adapted_analysis.csv"
SOURCE_COUNTS_CSV = DATA_DIR / "unique_counts.csv"
TAXONOMY_JSON = ROOT / "config" / "taxonomy.json"
RUN_METADATA_JSON = DATA_DIR / "adaption_run.json"
ANALYSIS_JSON = DATA_DIR / "adapted_analysis.json"
REPORT_TXT = DATA_DIR / "adapted_analysis_report.txt"
COMPLETION_COLUMN = "enhanced_completion"
ALLOWED_SENTIMENTS = {"positive", "neutral", "negative", "mixed"}
OPERATIONAL_TOPIC_PREFIXES = ("delivery_", "shipping_", "order_")
OPERATIONAL_FALLBACK_TOPIC = "order_processing_and_expectations"
FENCE_PATTERN = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


def parse_json_object(value):
    if not isinstance(value, str):
        return None, "completion is empty or not text"
    cleaned = value.strip()
    if cleaned.startswith("```"):
        cleaned = FENCE_PATTERN.sub("", cleaned).strip()
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as error:
        return None, f"invalid JSON: {error.msg}"
    if not isinstance(parsed, dict):
        return None, "completion JSON is not an object"
    return parsed, None


def finite_number(value):
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def validate_analysis(parsed, topic_keys):
    required = {
        "sentiment",
        "sentimentScore",
        "topic",
        "severity",
        "isComplaint",
        "issueSummary",
        "suggestedAction",
    }
    errors = []
    missing = required - set(parsed)
    if missing:
        errors.append(f"missing fields: {', '.join(sorted(missing))}")

    sentiment = parsed.get("sentiment")
    if not isinstance(sentiment, str) or sentiment not in ALLOWED_SENTIMENTS:
        errors.append("sentiment is not one of positive, neutral, negative, mixed")

    score = finite_number(parsed.get("sentimentScore"))
    if score is None:
        errors.append("sentimentScore is not a finite number")
    else:
        score = max(-1.0, min(1.0, score))

    severity_value = finite_number(parsed.get("severity"))
    if severity_value is None or not severity_value.is_integer():
        errors.append("severity is not an integer")
        severity = None
    else:
        severity = max(1, min(5, int(severity_value)))

    topic = parsed.get("topic")
    if not isinstance(topic, str) or topic not in topic_keys:
        errors.append("topic is not a taxonomy key")

    is_complaint = parsed.get("isComplaint")
    if not isinstance(is_complaint, bool):
        errors.append("isComplaint is not a boolean")

    issue_summary = parsed.get("issueSummary")
    if not isinstance(issue_summary, str) or not issue_summary.strip():
        errors.append("issueSummary is not a non-empty string")

    suggested_action = parsed.get("suggestedAction")
    if not isinstance(suggested_action, str) or not suggested_action.strip():
        errors.append("suggestedAction is not a non-empty string")

    if errors:
        return None, errors

    normalized = {
        "sentiment": sentiment,
        "sentimentScore": score,
        "topic": topic,
        "severity": severity,
        "isComplaint": is_complaint,
        "issueSummary": issue_summary.strip(),
        "suggestedAction": suggested_action.strip(),
    }
    return normalized, []


def load_sources():
    taxonomy = json.loads(TAXONOMY_JSON.read_text(encoding="utf-8"))
    topic_parents = {topic["key"]: topic["parentCategory"] for topic in taxonomy}
    if not topic_parents:
        raise ValueError(f"No topics found in {TAXONOMY_JSON}")

    source_rows = pd.read_csv(SOURCE_COUNTS_CSV)
    required = {"text_hash", "review", "category"}
    missing = required - set(source_rows.columns)
    if missing:
        raise ValueError(f"Source counts CSV is missing columns: {sorted(missing)}")

    source_by_hash = {}
    for row in source_rows.to_dict(orient="records"):
        review_hash = text_hash(row["review"])
        stored_hash = str(row["text_hash"])
        if stored_hash != review_hash:
            raise ValueError(
                f"Stored text_hash does not match the documented hash rule "
                f"for review {row['review']!r}."
            )
        if stored_hash in source_by_hash:
            raise ValueError(f"Duplicate source text_hash found: {stored_hash}")
        source_by_hash[stored_hash] = {
            "review": row["review"],
            "category": row["category"],
        }
    return topic_parents, source_by_hash


def render_report(
    run_metadata,
    rows_in,
    rows_out,
    json_parse_count,
    analysis_entries,
    invalid_rows,
    absent_rows,
    unmatched_rows,
    duplicate_rows,
    summary_warnings,
    topic_changes,
    topic_parents,
):
    sentiment_counts = Counter(
        entry["analysis"]["sentiment"] for entry in analysis_entries
    )
    topic_counts = Counter(entry["analysis"]["topic"] for entry in analysis_entries)
    mismatches = [
        entry
        for entry in analysis_entries
        if topic_parents[entry["analysis"]["topic"]] != entry["originalCategory"]
    ]
    json_rate = json_parse_count / rows_out if rows_out else 0
    valid_rate = len(analysis_entries) / rows_in if rows_in else 0

    lines = [
        "InsightFlow adapted analysis validation report",
        f"Dataset ID: {run_metadata.get('datasetId')}",
        f"Run ID: {run_metadata.get('runId')}",
        f"Run status: {run_metadata.get('status')}",
        f"Rows in: {rows_in}",
        f"Rows downloaded: {rows_out}",
        f"JSON parse success: {json_parse_count}/{rows_out} ({json_rate:.1%})",
        (
            f"Analyses passing listed field/type checks written: "
            f"{len(analysis_entries)}/{rows_in} ({valid_rate:.1%})"
        ),
        f"Invalid or missing analysis count: {len(invalid_rows) + len(absent_rows)}",
        f"Issue summaries outside 8-12 words: {len(summary_warnings)}",
        f"Rows unmatched to source hashes: {len(unmatched_rows)}",
        f"Duplicate output hashes: {len(duplicate_rows)}",
        "",
        "Sentiment distribution (valid analyses):",
    ]
    lines.extend(
        f"- {sentiment}: {sentiment_counts[sentiment]}"
        for sentiment in sorted(ALLOWED_SENTIMENTS)
    )
    lines.extend(["", "Topic distribution (valid analyses):"])
    lines.extend(
        f"- {topic}: {topic_counts[topic]}"
        for topic in sorted(topic_parents)
        if topic_counts[topic]
    )
    lines.extend(["", "Topics whose parent category differs from original category:"])
    if mismatches:
        for entry in mismatches:
            lines.append(
                f"- REVIEW: textHash={entry['textHash']}; "
                f"originalCategory={entry['originalCategory']}; "
                f"topic={entry['analysis']['topic']}; "
                f"topicParent={topic_parents[entry['analysis']['topic']]}; "
                f"review={entry['review']}"
            )
    else:
        lines.append("- None.")

    lines.extend(["", "Invalid completion rows:"])
    if invalid_rows:
        for item in invalid_rows:
            lines.append(
                f"- textHash={item.get('textHash')}; review={item.get('review')}; "
                f"problems={'; '.join(item['problems'])}"
            )
    else:
        lines.append("- None.")

    lines.extend(["", "Source reviews absent from the downloaded output:"])
    if absent_rows:
        for item in absent_rows:
            lines.append(
                f"- textHash={item['textHash']}; "
                f"originalCategory={item['category']}; review={item['review']}"
            )
    else:
        lines.append("- None.")

    lines.extend(["", "Generated rows that did not match a source hash:"])
    if unmatched_rows:
        for item in unmatched_rows:
            lines.append(
                f"- computedTextHash={item.get('textHash')}; review={item.get('review')}"
            )
    else:
        lines.append("- None.")

    lines.extend(["", "Repeated output hashes:"])
    if duplicate_rows:
        lines.extend(f"- {item}" for item in duplicate_rows)
    else:
        lines.append("- None.")

    lines.extend(["", "Post-processing topic changes:"])
    if topic_changes:
        for item in topic_changes:
            lines.append(
                f"- textHash={item['textHash']}; "
                f"originalCategory={item['originalCategory']}; "
                f"topic={item['fromTopic']} -> {item['toTopic']}; "
                f"review={item['review']}"
            )
    else:
        lines.append("- None.")

    lines.extend(["", "Issue summary length warnings (prompt requested 8-12 words):"])
    if summary_warnings:
        for item in summary_warnings:
            lines.append(
                f"- textHash={item['textHash']}; "
                f"wordCount={item['wordCount']}; "
                f"summary={item['issueSummary']}"
            )
    else:
        lines.append("- None.")
    lines.append("")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-csv", type=Path, default=INPUT_CSV)
    parser.add_argument("--run-metadata", type=Path, default=RUN_METADATA_JSON)
    parser.add_argument("--analysis-output", type=Path, default=ANALYSIS_JSON)
    parser.add_argument("--report-output", type=Path, default=REPORT_TXT)
    args = parser.parse_args()

    required_files = (
        args.input_csv,
        args.run_metadata,
        SOURCE_COUNTS_CSV,
        TAXONOMY_JSON,
    )
    missing_files = [str(path) for path in required_files if not path.exists()]
    if missing_files:
        raise FileNotFoundError(f"Required input files are missing: {missing_files}")

    run_metadata = json.loads(args.run_metadata.read_text(encoding="utf-8"))
    if run_metadata.get("status") not in {"succeeded", "failed"}:
        raise ValueError(
            f"Run status is not final: {run_metadata.get('status')!r}"
        )

    adapted = pd.read_csv(args.input_csv)
    required_columns = {"review", COMPLETION_COLUMN}
    missing_columns = required_columns - set(adapted.columns)
    if missing_columns:
        raise ValueError(
            f"Downloaded CSV is missing required columns: {sorted(missing_columns)}"
        )

    topic_parents, source_by_hash = load_sources()
    topic_keys = set(topic_parents)
    seen_hashes = set()
    analysis_entries = []
    invalid_rows = []
    unmatched_rows = []
    duplicate_rows = []
    summary_warnings = []
    topic_changes = []
    json_parse_count = 0

    for row in adapted.to_dict(orient="records"):
        review = row.get("review")
        review_hash = text_hash(review)
        source = source_by_hash.get(review_hash)
        if source is None:
            unmatched_rows.append({"textHash": review_hash, "review": review})
            continue

        if review_hash in seen_hashes:
            duplicate_rows.append(review_hash)
            continue
        seen_hashes.add(review_hash)

        parsed, parse_error = parse_json_object(row.get(COMPLETION_COLUMN))
        if parse_error:
            invalid_rows.append(
                {
                    "textHash": review_hash,
                    "review": source["review"],
                    "problems": [parse_error],
                }
            )
            continue
        json_parse_count += 1

        analysis, errors = validate_analysis(parsed, topic_keys)
        if errors:
            invalid_rows.append(
                {
                    "textHash": review_hash,
                    "review": source["review"],
                    "problems": errors,
                }
            )
            continue

        if (
            source["category"] == "Operational Issues"
            and not analysis["topic"].startswith(OPERATIONAL_TOPIC_PREFIXES)
        ):
            old_topic = analysis["topic"]
            analysis["topic"] = OPERATIONAL_FALLBACK_TOPIC
            topic_changes.append(
                {
                    "textHash": review_hash,
                    "review": source["review"],
                    "originalCategory": source["category"],
                    "fromTopic": old_topic,
                    "toTopic": OPERATIONAL_FALLBACK_TOPIC,
                }
            )

        word_count = len(analysis["issueSummary"].split())
        if not 8 <= word_count <= 12:
            summary_warnings.append(
                {
                    "textHash": review_hash,
                    "wordCount": word_count,
                    "issueSummary": analysis["issueSummary"],
                }
            )

        analysis_entries.append(
            {
                "textHash": review_hash,
                "review": source["review"],
                "originalCategory": source["category"],
                "analysis": analysis,
                "producedBy": "adaption",
                "adaptionRunId": run_metadata.get("runId"),
            }
        )

    absent_rows = [
        {
            "textHash": source_hash,
            "review": source["review"],
            "category": source["category"],
        }
        for source_hash, source in source_by_hash.items()
        if source_hash not in seen_hashes
    ]

    expected_rows = run_metadata.get("rowsIn")
    if expected_rows is not None and expected_rows != len(source_by_hash):
        raise ValueError(
            f"Run metadata says {expected_rows} input rows but the source hash "
            f"manifest contains {len(source_by_hash)}."
        )

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    args.analysis_output.parent.mkdir(parents=True, exist_ok=True)
    args.analysis_output.write_text(
        json.dumps(analysis_entries, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    report = render_report(
        run_metadata=run_metadata,
        rows_in=len(source_by_hash),
        rows_out=len(adapted),
        json_parse_count=json_parse_count,
        analysis_entries=analysis_entries,
        invalid_rows=invalid_rows,
        absent_rows=absent_rows,
        unmatched_rows=unmatched_rows,
        duplicate_rows=duplicate_rows,
        summary_warnings=summary_warnings,
        topic_changes=topic_changes,
        topic_parents=topic_parents,
    )
    args.report_output.parent.mkdir(parents=True, exist_ok=True)
    args.report_output.write_text(report, encoding="utf-8")

    print(f"Valid adapted analyses: {len(analysis_entries)}/{len(source_by_hash)}")
    print(f"JSON parse success: {json_parse_count}/{len(adapted)}")
    print(f"Invalid completions: {len(invalid_rows)}")
    print(f"Source reviews absent from output: {len(absent_rows)}")
    parent_mismatch_count = sum(
        topic_parents[entry["analysis"]["topic"]] != entry["originalCategory"]
        for entry in analysis_entries
    )
    print(f"Topic parent mismatches: {parent_mismatch_count}")
    print(f"Analysis JSON written to: {args.analysis_output}")
    print(f"Validation report written to: {args.report_output}")


if __name__ == "__main__":
    main()
