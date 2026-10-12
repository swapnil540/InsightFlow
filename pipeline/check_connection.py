import os
from pathlib import Path

from dotenv import load_dotenv

from adaption import Adaption


ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

api_key = os.getenv("ADAPTION_API_KEY")
if not api_key:
    raise RuntimeError("ADAPTION_API_KEY is missing. Add it to the local .env file first.")

client = Adaption(api_key=api_key)

print("Checking Adaption connectivity...")
response = client.datasets.list()
print(response)
