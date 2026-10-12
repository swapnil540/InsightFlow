from pathlib import Path

import pandas as pd

from textutil import normalize, text_hash


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
RAW_CSV = DATA_DIR / "raw_feedback.csv"
UNIQUE_CSV = DATA_DIR / "unique_reviews.csv"
COUNTS_CSV = DATA_DIR / "unique_counts.csv"


def main():
    df = pd.read_csv(RAW_CSV)
    required_columns = {"review", "category"}
    missing = required_columns - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {sorted(missing)}")

    df = df[["review", "category"]].copy()
    df["review"] = df["review"].map(lambda value: normalize(value))
    df["category"] = df["category"].map(lambda value: str(value).strip())
    df = df[df["review"].str.len() > 0].copy()

    cross_category = (
        df.groupby("review", dropna=False)["category"]
        .nunique()
        .reset_index(name="category_count")
    )
    conflicts = cross_category[cross_category["category_count"] > 1]
    if not conflicts.empty:
        print("Detected review texts under multiple categories:")
        print(conflicts.head(10).to_string(index=False))
        raise ValueError("A review text appears in more than one category; check the source data.")

    summary = df.groupby("category").size().reset_index(name="raw_count")
    unique_rows = (
        df.drop_duplicates(subset=["review"], keep="first")
        .sort_values(["category", "review"])
        .reset_index(drop=True)
    )
    unique_rows = unique_rows[["review", "category"]]
    UNIQUE_CSV.parent.mkdir(parents=True, exist_ok=True)
    unique_rows.to_csv(UNIQUE_CSV, index=False)

    counts = (
        df.groupby(["review", "category"], as_index=False)
        .size()
        .rename(columns={"size": "count"})
    )
    counts["text_hash"] = counts["review"].map(text_hash)
    counts = counts[["text_hash", "review", "category", "count"]]
    counts.to_csv(COUNTS_CSV, index=False)

    category_unique = (
        unique_rows.groupby("category").size().reset_index(name="unique_count")
    )

    print("Sanity report")
    print("- raw rows:", len(df))
    print("- unique review texts:", len(unique_rows))
    print("- category counts (unique):")
    print(category_unique.to_string(index=False))
    print("- duplicate review texts:", len(df) - len(unique_rows))
    print(f"- unique CSV written to: {UNIQUE_CSV}")
    print(f"- counts CSV written to: {COUNTS_CSV}")


if __name__ == "__main__":
    main()
