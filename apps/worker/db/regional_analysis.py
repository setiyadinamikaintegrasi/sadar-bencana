import json
from typing import Any
import asyncpg


async def save_regional_analysis(
    pool: asyncpg.Pool,
    question: str,
    snapshot: dict[str, Any],
    output: dict[str, Any],
) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO ai_regional_analysis_audit
               (administrative_code, model_name, prompt_version, question,
                input_snapshot, output, refused)
               VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)""",
            snapshot["administrative_code"],
            output["model"],
            output["prompt_version"],
            question,
            json.dumps(snapshot, ensure_ascii=False),
            json.dumps(output, ensure_ascii=False),
            output["refused"],
        )
