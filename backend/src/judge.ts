import type { Judge } from "./app";

/**
 * AI Judge. Default: stub deterministik untuk test.
 * Mode Groq hidup saat GROQ_API_KEY terisi.
 * ponytail: default judge deterministik (panjang content) supaya test & demo
 * jalan tanpa kunci; kunci dipakai hanya kalau ada.
 */
export const makeJudge = (opts: { apiKey?: string; model?: string } = {}): Judge => {
  const apiKey = opts.apiKey ?? process.env.GROQ_API_KEY;
  const model = opts.model ?? process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

  if (!apiKey) {
    return {
      judge: async (content, _title) => {
        const len = content.length;
        const score = Math.min(10, Math.max(1, Math.floor(len / 20)));
        return { score, reason: "deterministic stub judge" };
      },
    };
  }

  return {
    judge: async (content, title) => {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "You are an AI judge for a task marketplace. Return JSON {score: 1-10, reason: string} evaluating the submission against the task title.",
            },
            { role: "user", content: `Task: ${title}\nSubmission: ${content}` },
          ],
        }),
      });
      // 401/429 (key invalid/quota) → sama dengan tanpa key: fallback deterministik,
      // supaya demo API tetap jalan walau penyedia LLM bermasalah.
      if (!res.ok || res.status === 429 || res.status === 401) {
        if (res.status === 401) {
          const len = content.length;
          const score = Math.min(10, Math.max(1, Math.floor(len / 10)));
          return { score, reason: "groq 401 → fallback deterministic" };
        }
        return { score: 0, reason: "groq error" };
      }
      const data = (await res.json()) as {
        choices: { message: { content: string } }[];
      };
      try {
        // model kadang membungkus dengan ```json ... ``` — strip fence dulu.
        const stripped = data.choices[0].message.content
          .replace(/^```(?:json)?/m, "")
          .replace(/^```\s*$/m, "")
          .trim();
        const parsed = JSON.parse(stripped) as {
          score: number;
          reason: string;
        };
        return {
          score: Math.min(10, Math.max(0, Math.round(parsed.score))),
          reason: parsed.reason ?? "",
        };
      } catch {
        return { score: 0, reason: "invalid judge JSON" };
      }
    },
  };
};