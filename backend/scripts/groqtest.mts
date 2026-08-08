const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
  method: "POST",
  headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}`, "content-type": "application/json" },
  body: JSON.stringify({
    model: process.env.GROQ_MODEL,
    messages: [
      { role: "system", content: 'You are an AI judge. Return JSON {score: 1-10, reason: string}' },
      { role: "user", content: "Task: t\nSubmission: hasil" },
    ],
  }),
});
console.log("status:", res.status);
const t = await res.text();
console.log(t.slice(0, 600));
