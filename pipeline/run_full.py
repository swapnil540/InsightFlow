import argparse
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import time

import pandas as pd
from dotenv import load_dotenv

from adaption import Adaption

from smoke_test import build_prompt, object_dict, print_object, wait_for_import


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
OUT_DIR = ROOT / "pipeline" / "out"
INPUT_CSV = DATA_DIR / "unique_reviews.csv"
STATE_FILE = OUT_DIR / "full_run_state.json"
OUTPUT_CSV = OUT_DIR / "adapted_analysis.csv"
RUN_METADATA_FILE = DATA_DIR / "adaption_run.json"
RETEST_STATE_FILE = OUT_DIR / "summary_retest_state.json"
RETEST_OUTPUT_CSV = OUT_DIR / "adapted_analysis_retest.csv"
RETEST_METADATA_FILE = DATA_DIR / "adaption_retest_run.json"
IDEMPOTENCY_KEY = "insightflow-phase1-full-20261012-v1"
RETEST_IDEMPOTENCY_KEY = "insightflow-phase1-full-summary-retest-20261012-v1"
IMPORT_TIMEOUT_SECONDS = 900
RUN_TIMEOUT_SECONDS = 24 * 60 * 60
POLL_INTERVAL_SECONDS = 15
BLUEPRINT = "Output only a single valid JSON object. No markdown fences, no commentary."


def utc_now():
    return datetime.now(timezone.utc)


def write_state(state, path=STATE_FILE):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2), encoding="utf-8")


def read_state(path=STATE_FILE):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def make_configuration(row_count):
    prompt = build_prompt()
    return {
        "prompt": prompt,
        "column_mapping": {
            "universal_prompt": prompt,
            "context": ["review", "category"],
        },
        "recipes": {
            "recipes": {
                "deduplication": True,
                "prompt_rephrase": False,
                "reasoning_traces": False,
            }
        },
        "brand_controls": {
            "blueprint": BLUEPRINT,
            "hallucination_mitigation": False,
        },
        "job_specification": {
            "max_rows": row_count,
            "idempotency_key": IDEMPOTENCY_KEY,
        },
    }


def make_retest_configuration(row_count):
    configuration = make_configuration(row_count)
    original_prompt = configuration["prompt"]
    revised_prompt = original_prompt.replace(
        "issueSummary (8 to 12 words)",
        "issueSummary (exactly 8 to 12 words; count the words before returning)",
    )
    if revised_prompt == original_prompt:
        raise ValueError("Could not strengthen the issueSummary prompt text.")

    configuration["prompt"] = revised_prompt
    configuration["column_mapping"]["universal_prompt"] = revised_prompt
    configuration["brand_controls"]["blueprint"] = (
        BLUEPRINT
        + " The issueSummary must contain exactly 8 to 12 whitespace-separated "
        "words; count and verify them before returning."
    )
    configuration["job_specification"]["idempotency_key"] = (
        RETEST_IDEMPOTENCY_KEY
    )
    return configuration


def upload_or_resume(client, state):
    if state and state.get("dataset_id"):
        print(f"Reusing saved dataset ID: {state['dataset_id']}")
    else:
        upload = client.datasets.upload_file(str(INPUT_CSV))
        print_object("Upload response:", upload)
        state = {
            "dataset_id": upload.dataset_id,
            "rows_in": len(pd.read_csv(INPUT_CSV)),
        }
        write_state(state)
        print(f"Saved dataset ID to {STATE_FILE}")

    wait_for_import(client, state["dataset_id"])
    return state


def estimate_run(client, state, configuration):
    if state.get("run_id"):
        raise RuntimeError(
            "A full run has already been launched for this dataset; "
            "use --launch to resume waiting instead of requesting an estimate."
        )

    state["configuration"] = configuration
    write_state(state)
    estimate = client.datasets.adapt(
        state["dataset_id"],
        column_mapping=configuration["column_mapping"],
        recipe_specification=configuration["recipes"],
        brand_controls=configuration["brand_controls"],
        job_specification=configuration["job_specification"],
        estimate=True,
    )
    print_object("Full-run Adaption estimate response:", estimate)
    estimate_data = object_dict(estimate)
    state["estimate"] = estimate_data
    write_state(state)
    print("Estimated credits:", estimate_data.get("estimated_credits_consumed"))
    print(
        "Estimated minutes:",
        estimate_data.get("estimatedMinutes", estimate_data.get("estimated_minutes")),
    )
    print(
        "\nEstimate complete. No full adaptation run was launched. "
        "After reviewing the estimate, approve in chat; then run this script "
        "with --launch."
    )


def estimate_summary_retest(client):
    original_state = read_state()
    if not original_state or not original_state.get("run_id"):
        raise RuntimeError(
            "The original full run must be complete before a summary re-test."
        )

    state = read_state(RETEST_STATE_FILE)
    if state and state.get("run_id"):
        raise RuntimeError(
            "The summary re-test has already launched; use --retest-launch to resume."
        )
    if not state:
        state = {
            "dataset_id": original_state["dataset_id"],
            "rows_in": original_state["rows_in"],
        }
    wait_for_import(client, state["dataset_id"])
    configuration = state.get("configuration") or make_retest_configuration(
        state["rows_in"]
    )
    state["configuration"] = configuration
    write_state(state, RETEST_STATE_FILE)
    print("Prompt revision: issueSummary is now exactly 8-12 words.")
    print("Revised universal prompt:")
    print(configuration["prompt"])
    print("Revised blueprint:")
    print(configuration["brand_controls"]["blueprint"])

    estimate = client.datasets.adapt(
        state["dataset_id"],
        column_mapping=configuration["column_mapping"],
        recipe_specification=configuration["recipes"],
        brand_controls=configuration["brand_controls"],
        job_specification=configuration["job_specification"],
        estimate=True,
    )
    print_object("Summary re-test estimate response:", estimate)
    estimate_data = object_dict(estimate)
    state["estimate"] = estimate_data
    write_state(state, RETEST_STATE_FILE)
    print(
        "Estimated credits:",
        estimate_data.get(
            "estimated_credits_consumed",
            estimate_data.get("estimatedCreditsConsumed"),
        ),
    )
    print(
        "Estimated minutes:",
        estimate_data.get("estimatedMinutes", estimate_data.get("estimated_minutes")),
    )
    print(
        "\nRe-test estimate complete. No re-test run was launched. "
        "A separate explicit approval is required before using --retest-launch."
    )


def wait_with_progress(client, dataset_id):
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            client.datasets.wait_for_completion,
            dataset_id,
            timeout=RUN_TIMEOUT_SECONDS,
        )
        while not future.done():
            print("Full Adaption run is still processing...")
            time.sleep(POLL_INTERVAL_SECONDS)
        return future.result()


def optional_actual_credits(*responses):
    actual_credit_fields = (
        "actual_credits_consumed",
        "actualCreditsConsumed",
        "credits_consumed_actual",
        "creditsConsumedActual",
    )
    for response in responses:
        data = object_dict(response)
        for field in actual_credit_fields:
            if data.get(field) is not None:
                return data[field]
    return None


def score_fields(evaluation, run_id):
    data = object_dict(evaluation)
    raw_results = data.get("raw_results", {})
    metrics = raw_results.get("metrics", {})
    source = metrics.get("config_source") or raw_results.get("input_path")
    if source and run_id not in source:
        print(
            "Warning: evaluation output path does not match this run ID; "
            "quality scores will be recorded as unavailable."
        )
        return {
            "score_before": None,
            "score_after": None,
            "improvement_percent": None,
            "evaluation_matches_run": False,
            "evaluation_source": source,
        }

    quality = data.get("quality", {})
    return {
        "score_before": quality.get("score_before"),
        "score_after": quality.get("score_after"),
        "improvement_percent": quality.get("improvement_percent"),
        "evaluation_matches_run": True if source else None,
        "evaluation_source": source,
    }


def run_or_resume(
    client,
    state,
    output_csv=OUTPUT_CSV,
    metadata_file=RUN_METADATA_FILE,
    state_file=STATE_FILE,
):
    if not state.get("estimate"):
        raise RuntimeError(
            "No full-run estimate is saved. Run the estimate step and review it first."
        )
    if not state.get("configuration"):
        raise RuntimeError("Saved run state is missing its configuration.")

    if not state.get("run_id"):
        state.setdefault("launch_started_at", utc_now().isoformat())
        write_state(state, state_file)
        configuration = state["configuration"]
        launch = client.datasets.adapt(
            state["dataset_id"],
            column_mapping=configuration["column_mapping"],
            recipe_specification=configuration["recipes"],
            brand_controls=configuration["brand_controls"],
            job_specification=configuration["job_specification"],
            estimate=False,
        )
        print_object("Full-run launch response:", launch)
        state["run_id"] = getattr(launch, "run_id", None)
        if not state["run_id"]:
            raise RuntimeError("Adaption launch response did not include a run_id.")
        state["launch_response"] = object_dict(launch)
        write_state(state, state_file)
    else:
        print(f"Resuming saved Adaption run ID: {state['run_id']}")

    final_status = wait_with_progress(client, state["dataset_id"])
    print_object("Final run status:", final_status)
    state["final_status"] = object_dict(final_status)

    download = client.datasets.download(state["dataset_id"], file_format="csv")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    download.write_to_file(str(output_csv))
    print(f"Downloaded adapted CSV: {output_csv}")
    rows_out = len(pd.read_csv(output_csv))
    print(f"Rows downloaded: {rows_out}")

    evaluation = client.datasets.get_evaluation(state["dataset_id"])
    print_object("Full evaluation response:", evaluation)
    scores = score_fields(evaluation, state["run_id"])

    finished_at = utc_now()
    started_at = datetime.fromisoformat(state["launch_started_at"])
    elapsed_minutes = round((finished_at - started_at).total_seconds() / 60, 2)
    estimate = state["estimate"]
    estimated_credits = estimate.get(
        "estimated_credits_consumed",
        estimate.get("estimatedCreditsConsumed"),
    )
    metadata = {
        "datasetId": state["dataset_id"],
        "runId": state["run_id"],
        "status": getattr(final_status, "status", None),
        "rowsIn": state["rows_in"],
        "rowsOut": rows_out,
        "scoreBefore": scores["score_before"],
        "scoreAfter": scores["score_after"],
        "improvementPercent": scores["improvement_percent"],
        "evaluationMatchesRun": scores["evaluation_matches_run"],
        "evaluationSource": scores["evaluation_source"],
        "estimatedCredits": estimated_credits,
        "actualCredits": optional_actual_credits(
            state.get("launch_response", {}),
            object_dict(final_status),
        ),
        "minutes": elapsed_minutes,
        "timestamp": finished_at.isoformat(),
        "configuration": {
            "prompt": state["configuration"]["prompt"],
            "columnMapping": state["configuration"]["column_mapping"],
            "recipes": state["configuration"]["recipes"],
            "blueprint": state["configuration"]["brand_controls"]["blueprint"],
            "brandControls": state["configuration"]["brand_controls"],
            "jobSpecification": state["configuration"]["job_specification"],
        },
    }
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    metadata_file.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    state["run_metadata"] = metadata
    state["evaluation"] = object_dict(evaluation)
    write_state(state, state_file)

    print("Saved run metadata:", metadata_file)
    print("Final status:", metadata["status"])
    if metadata["status"] == "failed":
        print(
            f"Run failed after processing {rows_out} rows; the partial CSV was "
            f"saved to {output_csv}."
        )


def main():
    parser = argparse.ArgumentParser()
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument(
        "--launch",
        action="store_true",
        help="Launch or resume only after explicit approval of the full-run estimate.",
    )
    actions.add_argument(
        "--retest-estimate",
        action="store_true",
        help="Estimate one stricter issue-summary prompt re-test; does not launch.",
    )
    actions.add_argument(
        "--retest-launch",
        action="store_true",
        help="Launch/resume the re-test only after separate estimate approval.",
    )
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    if not os.getenv("ADAPTION_API_KEY"):
        raise RuntimeError("ADAPTION_API_KEY is missing from the local environment.")
    if not INPUT_CSV.exists():
        raise FileNotFoundError(f"Unique-review input was not found: {INPUT_CSV}")

    reviews = pd.read_csv(INPUT_CSV)
    required_columns = {"review", "category"}
    missing = required_columns - set(reviews.columns)
    if missing:
        raise ValueError(f"Input CSV is missing columns: {sorted(missing)}")
    if reviews.empty:
        raise ValueError("Unique-review input is empty; refusing to upload it.")

    client = Adaption()
    if args.retest_estimate:
        estimate_summary_retest(client)
        return
    if args.retest_launch:
        state = read_state(RETEST_STATE_FILE)
        if not state:
            raise FileNotFoundError(
                f"No summary re-test estimate state found at {RETEST_STATE_FILE}"
            )
        wait_for_import(client, state["dataset_id"])
        run_or_resume(
            client,
            state,
            output_csv=RETEST_OUTPUT_CSV,
            metadata_file=RETEST_METADATA_FILE,
            state_file=RETEST_STATE_FILE,
        )
        return

    state = upload_or_resume(client, read_state())
    configuration = state.get("configuration") or make_configuration(len(reviews))

    if args.launch:
        run_or_resume(client, state)
    else:
        estimate_run(client, state, configuration)


if __name__ == "__main__":
    main()
