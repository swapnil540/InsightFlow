import argparse
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

from adaption import Adaption


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
PIPELINE_DIR = ROOT / "pipeline"
OUT_DIR = PIPELINE_DIR / "out"
INPUT_CSV = DATA_DIR / "unique_reviews.csv"
TAXONOMY_JSON = ROOT / "config" / "taxonomy.json"
STATE_FILE = OUT_DIR / "smoke_test_state.json"
SAMPLE_CSV = OUT_DIR / "smoke_test_input.csv"
RESULT_CSV = OUT_DIR / "smoke_test_result.csv"
SAMPLE_SIZE = 50
RANDOM_SEED = 20261012
IDEMPOTENCY_KEY = "insightflow-phase1-smoke-20261012-v1"
IMPORT_TIMEOUT_SECONDS = 900
RUN_TIMEOUT_SECONDS = 6 * 60 * 60
POLL_INTERVAL_SECONDS = 10
NEGATION_PATTERN = re.compile(r"not a victim|no signs of fraud", re.IGNORECASE)
COMPLETION_COLUMN_CANDIDATES = {
    "completion",
    "enhanced_completion",
    "generated_completion",
    "response",
    "output",
}


def object_dict(value):
    """Convert SDK response models to JSON-friendly dictionaries."""
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return value
    return {"value": str(value)}


def print_object(title, value):
    print(title)
    print(json.dumps(object_dict(value), indent=2, ensure_ascii=False, default=str))


def build_prompt():
    taxonomy = json.loads(TAXONOMY_JSON.read_text(encoding="utf-8"))
    topic_keys = [topic["key"] for topic in taxonomy]
    if not topic_keys:
        raise ValueError(f"No topic keys found in {TAXONOMY_JSON}")

    topics = ", ".join(topic_keys)
    return (
        "You are a customer-feedback analyst. You get a customer review and its "
        "original category. Return ONLY valid JSON with these keys: sentiment "
        "(positive, neutral, negative or mixed), sentimentScore (number from -1 "
        f"to 1), topic (exactly one of: {topics}), severity (integer 1-5, where "
        "5 means fraud, financial harm or safety), isComplaint (true or false), "
        "issueSummary (8 to 12 words), suggestedAction (one sentence). Handle "
        "negation correctly: 'I was not a victim of fraud' and 'No signs of "
        "fraudulent activity' are positive and not complaints."
    )


def allocate_quotas(frame):
    counts = frame["category"].value_counts().to_dict()
    raw_quotas = {
        category: SAMPLE_SIZE * count / len(frame)
        for category, count in counts.items()
    }
    quotas = {category: int(value) for category, value in raw_quotas.items()}

    remaining = SAMPLE_SIZE - sum(quotas.values())
    ranked = sorted(
        raw_quotas,
        key=lambda category: raw_quotas[category] - quotas[category],
        reverse=True,
    )
    for category in ranked[:remaining]:
        quotas[category] += 1
    return quotas


def make_stratified_sample(frame):
    if len(frame) < SAMPLE_SIZE:
        raise ValueError(
            f"Expected at least {SAMPLE_SIZE} unique reviews, found {len(frame)}."
        )
    if frame[["review", "category"]].isnull().any().any():
        raise ValueError("Input data contains an empty review or category.")

    negation_rows = frame[frame["review"].map(lambda text: bool(NEGATION_PATTERN.search(text)))]
    forced_count = min(3, len(negation_rows))
    forced = negation_rows.sample(n=forced_count, random_state=RANDOM_SEED)

    quotas = allocate_quotas(frame)
    forced_counts = forced["category"].value_counts().to_dict()
    for category, count in forced_counts.items():
        quotas[category] = max(quotas[category], count)

    while sum(quotas.values()) > SAMPLE_SIZE:
        reducible = [
            category
            for category, quota in quotas.items()
            if quota > forced_counts.get(category, 0)
        ]
        if not reducible:
            raise ValueError("Cannot fit required negation rows into the smoke sample.")
        category = max(reducible, key=lambda key: quotas[key] - forced_counts.get(key, 0))
        quotas[category] -= 1

    selected = [forced]
    for index, (category, quota) in enumerate(quotas.items()):
        category_rows = frame[frame["category"] == category]
        forced_category = forced[forced["category"] == category]
        remaining_rows = category_rows.drop(index=forced_category.index)
        needed = quota - len(forced_category)
        if needed:
            selected.append(
                remaining_rows.sample(
                    n=needed,
                    random_state=RANDOM_SEED + index + 1,
                )
            )

    sample = pd.concat(selected).sample(frac=1, random_state=RANDOM_SEED)
    if len(sample) != SAMPLE_SIZE:
        raise RuntimeError(f"Expected {SAMPLE_SIZE} sample rows, created {len(sample)}.")
    return sample[["review", "category"]].reset_index(drop=True)


def wait_for_import(client, dataset_id):
    deadline = time.monotonic() + IMPORT_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        status = client.datasets.get_status(dataset_id)
        print_object("Import status:", status)
        if status.status == "failed":
            raise RuntimeError(f"Adaption import failed: {status.error_data}")
        if status.row_count is not None:
            print(f"Import complete: {status.row_count} rows.")
            return status
        time.sleep(POLL_INTERVAL_SECONDS)
    raise TimeoutError(
        f"Adaption import did not report row_count within "
        f"{IMPORT_TIMEOUT_SECONDS} seconds."
    )


def load_state():
    if not STATE_FILE.exists():
        raise FileNotFoundError(
            f"{STATE_FILE} does not exist. Run the estimate step before launching."
        )
    return json.loads(STATE_FILE.read_text(encoding="utf-8"))


def save_state(state):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def run_estimate(client, prompt):
    if STATE_FILE.exists():
        state = load_state()
        dataset_id = state["dataset_id"]
        print(f"Reusing uploaded smoke-test dataset: {dataset_id}")
    else:
        source = pd.read_csv(INPUT_CSV)
        sample = make_stratified_sample(source)
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        sample.to_csv(SAMPLE_CSV, index=False)
        print(f"Smoke sample saved: {SAMPLE_CSV}")
        print("Sample rows per category:")
        print(sample["category"].value_counts().to_string())

        negation_count = sample["review"].map(
            lambda text: bool(NEGATION_PATTERN.search(text))
        ).sum()
        print(f"Negation-style rows included: {negation_count}")

        upload = client.datasets.upload_file(str(SAMPLE_CSV))
        print_object("Upload response:", upload)
        dataset_id = upload.dataset_id
        state = {"dataset_id": dataset_id}
        save_state(state)
        wait_for_import(client, dataset_id)

    column_mapping = {
        "universal_prompt": prompt,
        "context": ["review", "category"],
    }
    recipes = {
        "recipes": {
            "deduplication": True,
            "prompt_rephrase": False,
            "reasoning_traces": False,
        }
    }
    blueprint = "Output only a single valid JSON object. No markdown fences, no commentary."
    brand_controls = {
        "blueprint": blueprint,
        "hallucination_mitigation": False,
    }
    job_specification = {
        "max_rows": SAMPLE_SIZE,
        "idempotency_key": IDEMPOTENCY_KEY,
    }
    estimate = client.datasets.adapt(
        dataset_id,
        column_mapping=column_mapping,
        recipe_specification=recipes,
        brand_controls=brand_controls,
        job_specification=job_specification,
        estimate=True,
    )
    print_object("Full Adaption estimate response:", estimate)
    estimate_data = object_dict(estimate)
    print("Estimated credits:", estimate_data.get("estimated_credits_consumed"))
    print("Estimated minutes:", estimate_data.get("estimatedMinutes"))

    state.update(
        {
            "dataset_id": dataset_id,
            "prompt": prompt,
            "column_mapping": column_mapping,
            "recipes": recipes,
            "brand_controls": brand_controls,
            "job_specification": job_specification,
            "estimate": estimate_data,
        }
    )
    save_state(state)
    print(
        "\nEstimate complete. No adaptation run was launched. "
        "After reviewing the estimate, approve in chat; then run this script "
        "with --launch to use credits."
    )


def print_progress(future):
    while not future.done():
        print("Adaption run is still processing...")
        time.sleep(POLL_INTERVAL_SECONDS)
    return future.result()


def parse_completion(value):
    if not isinstance(value, str):
        return False
    cleaned = value.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        return False
    return isinstance(parsed, dict)


def print_result_summary(path):
    result = pd.read_csv(path)
    print("Downloaded columns:", list(result.columns))
    print("First five rows:")
    print(result.head(5).to_string(index=False))

    matching_columns = [
        column
        for column in result.columns
        if column.lower() in COMPLETION_COLUMN_CANDIDATES
    ]
    if len(matching_columns) != 1:
        raise RuntimeError(
            "Could not identify exactly one generated-completion column. "
            f"Downloaded columns were: {list(result.columns)}"
        )

    completion_column = matching_columns[0]
    parsed = result[completion_column].map(parse_completion)
    total = len(parsed)
    success_count = int(parsed.sum())
    rate = success_count / total if total else 0
    print(f"Generated completion column: {completion_column}")
    print(f"JSON parse success: {success_count}/{total} ({rate:.1%})")

    input_sample = pd.read_csv(SAMPLE_CSV)
    negation_mask = input_sample["review"].map(
        lambda text: bool(NEGATION_PATTERN.search(text))
    )
    negation_reviews = input_sample.loc[negation_mask, "review"]
    print("Negation-row results:")
    if negation_reviews.empty:
        print("No negation-style rows were present in the sample.")
    else:
        matching = result[result["review"].isin(negation_reviews)]
        print(matching[["review", completion_column]].to_string(index=False))


def run_adaptation(client):
    state = load_state()
    dataset_id = state["dataset_id"]
    print(f"Launching approved smoke test for dataset {dataset_id}...")
    launch = client.datasets.adapt(
        dataset_id,
        column_mapping=state["column_mapping"],
        recipe_specification=state["recipes"],
        brand_controls=state["brand_controls"],
        job_specification=state["job_specification"],
        estimate=False,
    )
    print_object("Launch response:", launch)

    with ThreadPoolExecutor(max_workers=1) as executor:
        wait_future = executor.submit(
            client.datasets.wait_for_completion,
            dataset_id,
            timeout=RUN_TIMEOUT_SECONDS,
        )
        status = print_progress(wait_future)

    print_object("Final status:", status)
    state["run_id"] = getattr(launch, "run_id", None)
    state["final_status"] = object_dict(status)

    evaluation = client.datasets.get_evaluation(dataset_id)
    print_object("Full evaluation response:", evaluation)
    state["evaluation"] = object_dict(evaluation)

    download = client.datasets.download(dataset_id, file_format="csv")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    download.write_to_file(str(RESULT_CSV))
    print(f"Downloaded CSV: {RESULT_CSV}")
    print_result_summary(RESULT_CSV)
    save_state(state)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--launch",
        action="store_true",
        help="Launch the saved estimate (only after explicit approval in chat).",
    )
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    if not os.getenv("ADAPTION_API_KEY"):
        raise RuntimeError("ADAPTION_API_KEY is missing from the local environment.")

    client = Adaption()
    prompt = build_prompt()
    if args.launch:
        run_adaptation(client)
    else:
        run_estimate(client, prompt)


if __name__ == "__main__":
    main()
